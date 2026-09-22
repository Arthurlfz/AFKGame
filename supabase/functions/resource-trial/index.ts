/* ============================================================
 * resource-trial —— 资源试炼服务器权威结算（Edge Function, Deno）
 * 部署：supabase functions deploy resource-trial
 * 入口：POST /resource-trial  body: { routeId, runId, petId? }
 *
 * 为什么必须服务端化（2026-09-09）：
 *   本地 MVP 里成败与奖励都在浏览器算 —— 玩家改内存/断网重放就能白拿奖励。
 *   现在五条硬要求（交接文档 HANDOFF 第 4 节）：
 *     ① 服务端校验门票余额并原子扣除   ② 服务端校验宠物 / 路线 / 等级 / 轮数
 *     ③ 服务端决定成功失败，客户端不能伪造   ④ 服务端原子发放奖励并防重复结算
 *     ⑤ 失败路径有明确返回（不静默）
 * 幂等：runId 由客户端每次点击生成（uuid），唯一约束挡住重放/连点。
 * 鉴权：Supabase Auth JWT，全程用用户自己的 token 操作（RLS 生效）。
 * ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import serverConfig from '../_shared/config-server.mjs';
import { petStats, mulberry32 } from '../_shared/battle-sim.mjs';
import { petFromRow, itemRowToEquip } from '../_shared/settle-core.mjs';
import { planTrial, findRoute } from '../_shared/trial-core.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// 全局 try/catch（battle-settle 血泪）：异常必须带着 detail 回响应体，不能变裸 500
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[resource-trial] 未捕获异常:', e);
    return json({ ok: false, error: 'INTERNAL', detail: String((e as Error)?.message || e) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ ok: false, error: 'NO_AUTH' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ ok: false, error: 'BAD_TOKEN' }, 401);
  const uid = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'BAD_JSON' }); }
  const routeId = String(body.routeId || '');
  const runId = String(body.runId || '');
  if (!UUID_RE.test(runId)) return json({ ok: false, error: 'BAD_RUN_ID' });

  const cfg = (serverConfig as any).resourceTrials || {};
  if (cfg.enabled === false) return json({ ok: false, error: 'TRIAL_DISABLED' });

  // ① 路线与等级校验（不通过一律不扣票）
  const route = findRoute(cfg, routeId);
  if (!route) return json({ ok: false, error: 'BAD_ROUTE' });

  // 出战宠物：优先用 body.petId，否则取当前 is_active 的那只（都必须属于本人）
  let petRow: any = null;
  if (body.petId && UUID_RE.test(String(body.petId))) {
    const { data } = await supabase.from('pets').select('*').eq('id', body.petId).eq('user_id', uid).maybeSingle();
    petRow = data;
  } else {
    const { data } = await supabase.from('pets').select('*').eq('user_id', uid).eq('is_active', true).maybeSingle();
    petRow = data;
  }
  if (!petRow) return json({ ok: false, error: 'PET_NOT_FOUND' });

  const petLevel = Number(petRow.level) || 1;
  if (petLevel < (Number(route.minLevel) || 1)) {
    return json({ ok: false, error: 'LEVEL_TOO_LOW', need: route.minLevel });
  }

  // ② 先插占位行（run_id 唯一）→ 重复提交在这里被挡住，不会走到扣票
  const { error: insErr } = await supabase.from('resource_trial_runs').insert({
    run_id: runId, user_id: uid, pet_id: petRow.id, route_id: routeId
  });
  if (insErr) {
    // 23505 = unique_violation：同一次点击被重放 / 连点。
    // ⚠️ 不能只回一个错 —— 票已经扣了、奖已经发了，玩家会以为"点了没反应"。
    // 正确做法：把上次那局已入账的结果原样回给他（重放 = 只读，不再扣票、不再发奖）。
    if (String(insErr.code) === '23505') {
      const { data: old } = await supabase.from('resource_trial_runs')
        .select('cleared,rounds,reward,route_id')
        .eq('run_id', runId).eq('user_id', uid).maybeSingle();
      if (old) {
        return json({
          ok: true, replayed: true,
          cleared: old.cleared, rounds: old.rounds, reward: old.reward,
          routeId: old.route_id
        });
      }
      return json({ ok: false, error: 'DUPLICATE_RUN' });
    }
    return json({ ok: false, error: 'RUN_INSERT_FAILED', detail: insErr.message }, 500);
  }

  /* ③ 每日免费次数（2026-09-23）：以前这个次数只存在客户端 localStorage，
   *    服务端无条件扣票 ⇒ 副本权威化后玩家的免费那一次会被白扣。
   *    现在由服务端自己数：当天（北京时间 12:00 换日，= UTC 04:00）该玩家该路线已跑几局。
   *    ⚠️ 计数**包含刚插进来的占位行**：并发两下 → 第二下数到 2 → 走扣票，不会白嫖两次免费。 */
  const freeLimit = Number(cfg.freeEntriesPerDay) || 0;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0));
  if (now < dayStart) dayStart.setUTCDate(dayStart.getUTCDate() - 1); // 北京时间还没到 12:00 → 仍算上一试炼日
  const { count: todayRuns } = await supabase.from('resource_trial_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid).eq('route_id', routeId).gte('created_at', dayStart.toISOString());
  const useFree = freeLimit > 0 && (Number(todayRuns) || 0) <= freeLimit;

  let spentOk = true;
  if (!useFree) {
    const { data: spent, error: spendErr } = await supabase.rpc('spend_material', {
      p_name: cfg.ticketName || '资源试炼门票',
      p_amount: 1
    });
    spentOk = !spendErr && spent !== false && !(spent && spent.ok === false);
    if (!spentOk) {
      // 扣票失败 → 删掉占位行（不留幽灵记录），门票不少扣、免费次数也不浪费
      await supabase.from('resource_trial_runs').delete().eq('run_id', runId).eq('user_id', uid);
      return json({ ok: false, error: 'NO_TICKET', detail: spendErr?.message || '' });
    }
  }

  // ④ 服务端算属性 → 服务端判定成败（客户端只拿到结果）
  let stats: any = { atk: 1, def: 0, hp: 1 };
  let pet: any = null;
  try {
    const equipRef = (petRow.equipment && typeof petRow.equipment === 'object') ? petRow.equipment : {};
    const equipIds = Object.values(equipRef).filter((x: any) => typeof x === 'string' && UUID_RE.test(x)) as string[];
    let equipItems: any[] = [];
    if (equipIds.length) {
      const { data: items } = await supabase.from('equip_items').select('*').in('id', equipIds);
      if (items) equipItems = items.map(itemRowToEquip);
    }
    const byId = new Map(equipItems.map(it => [String(it.id), it]));
    pet = petFromRow(petRow, byId, serverConfig as any);
    stats = petStats(pet, serverConfig as any);
  } catch (e) {
    // 属性算不出来（脏装备引用等）：票已扣，按裸装兜底结算，不能吞掉玩家的门票
    console.error('[resource-trial] 属性计算失败，按裸装兜底:', e);
  }
  if (!pet) pet = petFromRow(petRow, new Map(), serverConfig as any);

  // ④b 服务端逐层真跑整局（20 层同源；血量跨层累计、层间不回血）
  // 随机源由 runId 派生：同一个 runId 重放必得同一结果（幂等，DUPLICATE_RUN 回放才有意义）
  const seed = parseInt(String(runId).replace(/-/g, '').slice(0, 8), 16) || 1;
  const plan = planTrial({
    pet, stats, route, petLevel, cfg,
    config: serverConfig as any,
    rnd: mulberry32(seed)
  });

  // ⑤ 原子发奖（每种材料一次 add_material）；发奖失败要如实返回，客户端提示重试
  for (const item of (plan.reward || [])) {
    const { error: rewardErr } = await supabase.rpc('add_material', {
      p_name: item.name,
      p_amount: Math.max(1, Math.floor(Number(item.qty) || 1))
    });
    if (rewardErr) {
      return json({
        ok: false, error: 'REWARD_GRANT_FAILED', detail: rewardErr.message,
        cleared: plan.cleared, maxFloor: plan.maxFloor, floors: plan.floors, hpPercent: plan.hpPercent
      }, 500);
    }
  }

  // 记录结果（占位行补完；失败也不影响已发的奖励）
  await supabase.from('resource_trial_runs').update({
    cleared: plan.cleared,
    rounds: plan.floors,      // 逐层战绩（客户端照它回放演出）
    reward: plan.reward,
    used_free: useFree
  }).eq('run_id', runId).eq('user_id', uid);

  return json({
    ok: true,
    usedFree: useFree,        // 客户端据此显示"免费第 N 次 / 扣了 1 张门票"
    cleared: plan.cleared,
    maxFloor: plan.maxFloor,
    floors: plan.floors,      // [{ floor, level, enemy, win, petHpLeft }]
    hpPercent: plan.hpPercent,
    reward: plan.reward,
    tierFloor: plan.tierFloor,
    routeId,
    petLevel
  });
}
