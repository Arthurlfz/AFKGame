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
import { petStats } from '../_shared/battle-sim.mjs';
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
    // 23505 = unique_violation：同一次点击被重放 / 连点
    if (String(insErr.code) === '23505') return json({ ok: false, error: 'DUPLICATE_RUN' });
    return json({ ok: false, error: 'RUN_INSERT_FAILED', detail: insErr.message }, 500);
  }

  // ③ 原子扣票；失败 → 删掉占位行（不留幽灵记录），门票不少扣
  const { data: spent, error: spendErr } = await supabase.rpc('spend_material', {
    p_name: cfg.ticketName || '资源试炼门票',
    p_amount: 1
  });
  const spentOk = !spendErr && spent !== false && !(spent && spent.ok === false);
  if (!spentOk) {
    await supabase.from('resource_trial_runs').delete().eq('run_id', runId).eq('user_id', uid);
    return json({ ok: false, error: 'NO_TICKET', detail: spendErr?.message || '' });
  }

  // ④ 服务端算属性 → 服务端判定成败（客户端只拿到结果）
  let stats: any = { atk: 1, def: 0, hp: 1 };
  try {
    const equipRef = (petRow.equipment && typeof petRow.equipment === 'object') ? petRow.equipment : {};
    const equipIds = Object.values(equipRef).filter((x: any) => typeof x === 'string' && UUID_RE.test(x)) as string[];
    let equipItems: any[] = [];
    if (equipIds.length) {
      const { data: items } = await supabase.from('equip_items').select('*').in('id', equipIds);
      if (items) equipItems = items.map(itemRowToEquip);
    }
    const byId = new Map(equipItems.map(it => [String(it.id), it]));
    const pet = petFromRow(petRow, byId, serverConfig as any);
    stats = petStats(pet, serverConfig as any);
  } catch (e) {
    // 属性算不出来（脏装备引用等）：票已扣，按裸装兜底结算，不能吞掉玩家的门票
    console.error('[resource-trial] 属性计算失败，按裸装兜底:', e);
  }

  const plan = planTrial({ stats, route, petLevel, cfg });

  // ⑤ 原子发奖（每种材料一次 add_material）；发奖失败要如实返回，客户端提示重试
  for (const item of (plan.reward || [])) {
    const { error: rewardErr } = await supabase.rpc('add_material', {
      p_name: item.name,
      p_amount: Math.max(1, Math.floor(Number(item.qty) || 1))
    });
    if (rewardErr) {
      return json({
        ok: false, error: 'REWARD_GRANT_FAILED', detail: rewardErr.message,
        cleared: plan.cleared, rounds: plan.rounds, hpPercent: plan.hpPercent
      }, 500);
    }
  }

  // 记录结果（占位行补完；失败也不影响已发的奖励）
  await supabase.from('resource_trial_runs').update({
    cleared: plan.cleared,
    rounds: plan.rounds,
    reward: plan.reward
  }).eq('run_id', runId).eq('user_id', uid);

  return json({
    ok: true,
    cleared: plan.cleared,
    rounds: plan.rounds,
    hpPercent: plan.hpPercent,
    reward: plan.reward,
    routeId,
    petLevel
  });
}
