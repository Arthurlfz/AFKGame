/* ============================================================
 * battle-settle —— 挂机战斗服务器权威结算（Edge Function, Deno）
 * 部署：supabase functions deploy battle-settle
 * 入口：POST /battle-settle  body: { action, areaId?, petId? }
 *   action ∈ start | pause | resume | stop | settle
 * 设计（2026-09-04 最终口径）：
 *   - 「页面活着就挂」：start 记 started_at，前端每 5~10s settle 一次；
 *     切后台 / 最小化 / 被遮挡都不影响（前端不因可见性暂停，服务器惰性结算兜住）。
 *   - 「关了就没有」：页面关闭后无人结算；下次回来只补最近 GRACE 秒（2 分钟），
 *     更早的离线时间作废 → 不需要离线收益，也不需要前端可见性暂停机制。
 *   - 时间权威：全部由服务器 now() 驱动，客户端时间一律忽略。
 *   - 结算权威：场数/经验由 battle-sim（与前端同种子一致的数值引擎）算出，
 *     写入 battle_logs（幂等 batch_seq）与 pets（cur_hp / exp / level）。
 * 鉴权：Supabase Auth JWT（Bearer token），仅本人可操作。
 * ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import serverConfig from '../_shared/config-server.mjs';
import enemyList from '../_shared/enemy-data-server.mjs';
import { settlePlan, hashSeed, num } from '../_shared/settle-core.mjs';

function mergeConfig(base: any, override: any): any {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? mergeConfig(base?.[k] || {}, v) : v;
  }
  return out;
}

// 允许跨域（前端 netlify 静态页调用）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// 结算宽限窗口：页面关闭后回来，只补最近这一段的挂机时间（秒）。
// 在线时前端每 5~10s 结算一次，远小于宽限 → 全算；切后台被浏览器节流（最多 1 分钟 1 次）也覆盖；
// 关页面回来后间隔远超宽限 → 只补最后 2 分钟（= 最后在线段），离线部分作废。
const GRACE_SETTLE_SECONDS = 120;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

Deno.serve(async (req) => {
  /* ⚠️ 全局 try/catch（2026-09-08 血泪）：
   * 之前 handler 任何一处抛异常（如 pets/equip_items 行里出现脏引用）都会变成
   * Deno 未捕获异常 → 网关返回【裸 500，无 error/detail】→ 前端和开发者都无从定位，
   * 只能看 Postgres 日志盲猜。现在异常必须带着 error/detail 回到响应体。
   * （2026-09-08 现场取证：Postgres 每 1.2s 报一次 `invalid input syntax for type uuid: "null"`，
   *   与前端 500 完全同步 —— 脏 uuid 引用进了查询。见下方 equipIds 白名单过滤。） */
  try {
    return await handle(req);
  } catch (e) {
    console.error('[battle-settle] 未捕获异常:', e);
    return json({
      ok: false,
      error: 'INTERNAL',
      detail: String((e && (e as Error).message) || e)
    }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  // 鉴权：JWT 里拿 user id
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

  let runtimeConfig = serverConfig;
  const { data: cfgRow } = await supabase.from('game_config_overrides').select('config').eq('id', true).maybeSingle();
  if (cfgRow?.config && userData.user.email === '776492620@qq.com') runtimeConfig = mergeConfig(serverConfig, cfgRow.config);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'BAD_JSON' }); }
  const action = String(body.action || '');
  if (!['start', 'pause', 'resume', 'stop', 'settle'].includes(action)) {
    return json({ ok: false, error: 'BAD_ACTION' });
  }

  const now = new Date().toISOString(); // 服务器权威时间

  // ---------- start / pause / resume / stop：状态机直接走 RPC ----------
  if (action !== 'settle') {
    const { data, error } = await supabase.rpc('battle_session', {
      p_action: action,
      p_area_id: body.areaId || null,
      p_pet_id: body.petId || null,
      p_now: now
    });
    if (error) return json({ ok: false, error: 'RPC_FAILED', detail: error.message }, 500);
    return json({ ok: true, ...data });
  }

  // ---------- settle：核心结算 ----------
  // 1) 找当前 active 会话（本人，未停止）
  const { data: session, error: sessErr } = await supabase
    .from('idle_sessions')
    .select('*')
    .eq('user_id', uid)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sessErr) return json({ ok: false, error: 'SESSION_QUERY_FAILED', detail: sessErr.message }, 500);
  if (!session) return json({ ok: false, error: 'NO_ACTIVE_SESSION' });

  // 2) 结算（2026-09-09 架构改版：服务器唯一模拟器 + 先记账后放片）
  //    - pending_script 未到期 → 幂等原样再发（刷新/重连不重复记账）；
  //    - 到期/不存在 → 补账窗（游标到现在的真实时间）+ 剧本窗（接下来 SCRIPT_WINDOW_SECONDS）
  //      一次算好、一次入账，游标直接跳到剧本窗尾，录像下发客户端纯回放。
  //      玩家看到的每场战斗/每个数字 = 服务器已入账的数字（实时结算，无校准无漂移）。
  const SCRIPT_WINDOW_SECONDS = 30; // 剧本窗时长（客户端回放时长 = 服务器的记账步长）
  const PENDING_GRACE_MS = 2000;    // 剧本到期宽容（客户端回放节奏有毫秒级抖动）
  const pending: any = (session as any).pending_script || null;
  const nowMs = Date.now();
  const lastSettledMs = new Date(session.last_settled_at).getTime();
  if (pending && pending.script && pending.until
      && nowMs < new Date(pending.until).getTime() - PENDING_GRACE_MS) {
    const sc: any = pending.script;
    return json({
      ok: true, elapsedSec: 0, fights: 0, exp: 0,
      endHp: sc.endHp, petMaxHp: sc.petMaxHp, level: sc.level, expLeft: sc.expLeft,
      detail: [], script: sc,
      totalFights: session.total_fights, totalExp: session.total_exp
    });
  }
  const gapSec = Math.min(Math.max(0, Math.floor((nowMs - lastSettledMs) / 1000)), GRACE_SETTLE_SECONDS);

  // 3) 读出战宠物
  const { data: petRow, error: petErr } = await supabase
    .from('pets')
    .select('*')
    .eq('id', session.pet_id)
    .maybeSingle();
  if (petErr) return json({ ok: false, error: 'PET_QUERY_FAILED', detail: petErr.message }, 500);
  if (!petRow) return json({ ok: false, error: 'PET_NOT_FOUND' });

  // 4) 读装备（容错：失败按裸装结算，P1 不阻塞）
  // ⚠️ 白名单过滤：equipment jsonb 里若混入脏引用（"null"/数字/坏串），
  //    .in('id', ...) 会把整条查询炸成 invalid uuid —— postgres 日志里的 500 元凶之一。
  let equipItems = [];
  const equipRef = (petRow.equipment && typeof petRow.equipment === 'object') ? petRow.equipment : {};
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const equipIds = Object.values(equipRef).filter((x: any) => typeof x === 'string' && UUID_RE.test(x));
  if (equipIds.length) {
    const { data: items, error: eqErr } = await supabase
      .from('equip_items')
      .select('*')
      .in('id', equipIds);
    if (!eqErr && items) equipItems = items;
  }

  // 5) 结算计划（纯计算：补账窗 + 剧本窗链式模拟 → 已入账录像 + 落库 patch）
  const plan = settlePlan({
    session,
    petRow,
    equipItems,
    config: runtimeConfig,
    enemyList,
    gapSeconds: gapSec,
    gapSeed: gapSec > 0 ? hashSeed(uid, session.id, session.last_settled_at) : 0,
    nextSeconds: SCRIPT_WINDOW_SECONDS,
    nextSeed: hashSeed(uid, session.id, now),
    bossState: { lastBossFight: (session as any).last_boss_fight ?? null }
  });

  // 剧本装饰：身份 + 回放基线（客户端从「窗前真值」重演到「窗后真值」，漂移为零）
  const script: any = plan.script;
  const untilIso = new Date(nowMs + SCRIPT_WINDOW_SECONDS * 1000).toISOString();
  script.id = now;
  script.until = untilIso;
  script.level = plan.exp.level;              // 窗后真值（applyResult 兜底校准用）
  script.expLeft = plan.petPatch.exp;
  script.levelBefore = plan.result.scriptLevelBefore; // 窗前真值（回放起点基线）
  script.expBefore = plan.result.scriptExpBefore;

  // 6) 写库：会话累计 + 结算日志 + pending_script（一次 RPC 原子提交，幂等）
  //    游标直接跳到剧本窗尾（p_cursor）——这段战斗已全部入账，下次 settle 只补窗尾之后的账。
  const { data: settleRes, error: settleErr } = await supabase.rpc('battle_settle', {
    p_session_id: session.id,
    p_fights: plan.result.totalFights,
    p_exp: plan.result.totalExp,
    // ⚠️ 不要 JSON.stringify！参数声明为 jsonb，传字符串进 PostgREST 会变成
    //    「JSON 字符串」而不是数组，落库即 jsonb string（2026-09-11 审计踩实）。
    // ⚠️ 截断只在这里（写入审计日志时）做：logDetail 同时被上面的发奖归集读取，
    //    若在 settle-core 里就截断，场次 >100 时被切掉的掉落会静默不发（2026-09-11 第 1 批 P2）。
    p_detail: (plan.logDetail || []).slice(-100),
    p_now: now,
    p_expected_last_settled_at: session.last_settled_at,
    p_last_boss_fight: plan.result.bossState && plan.result.bossState.lastBossFight != null
      ? plan.result.bossState.lastBossFight : null,
    p_cursor: untilIso,
    // 同上：必须传对象。曾经 JSON.stringify 过 → pending_script 落库成字符串 →
    // 下面读回来的 pending.script 恒为 undefined → 幂等分支永不命中 →
    // 每次 settle 都重新入账一个 30 秒剧本窗，产出被放大 1.4~2.1 倍。
    p_pending_script: { id: script.id, until: untilIso, script }
  });
  if (settleErr) return json({ ok: false, error: 'SETTLE_RPC_FAILED', detail: settleErr.message }, 500);
  if (settleRes && settleRes.error === 'STALE_SETTLE_CURSOR') {
    return json({ ok: false, error: 'SETTLE_ALREADY_ADVANCED' });
  }

  // 7) 宠物写回（双条件防越权）
  //    缺列容错：老库可能缺 exp 等附加列（前端 supabase.js 有 missingPetCols 同款机制），
  //    报错含列名 → 剔除该列重试，本体结算不能因附加列缺失而失败。
  let petUpd = plan.petPatch;
  let petUpdErr = null;
  try {
    const r1 = await supabase.from('pets').update(petUpd).eq('id', petRow.id).eq('user_id', uid);
    petUpdErr = r1.error;
    if (petUpdErr) {
      const msg = String(petUpdErr.message || '');
      const drop = ['exp', 'cur_hp', 'level'].find(c => msg.indexOf(c) >= 0);
      if (drop) {
        const next = { ...petUpd };
        delete next[drop];
        const r2 = await supabase.from('pets').update(next).eq('id', petRow.id).eq('user_id', uid);
        petUpdErr = r2.error;
        petUpd = next;
      }
    }
  } catch (e) {
    petUpdErr = e;
  }
  if (petUpdErr) return json({ ok: false, error: 'PET_UPDATE_FAILED', detail: petUpdErr.message }, 500);

  // 奖励由服务器直接入账（补账窗 + 剧本窗一起）。battle_settle 已用游标幂等，重复请求不会再次走到这里。
  // 当前先落材料；装备/宠物蛋沿用同一 detail 结构接入对应表。
  const rewardTotals: Record<string, number> = {};
  const equipDrops: any[] = [];
  const eggDrops: Record<string, number> = {};
  for (const reward of (plan.logDetail || []).map((x: any) => x.reward)) {
    if (!reward) continue;
    if (reward.type === 'material' && reward.material) {
      rewardTotals[reward.material] = (rewardTotals[reward.material] || 0) + Math.max(1, Math.floor(Number(reward.qty) || 1));
    } else if (reward.type === 'equipment' && reward.eq) {
      // 2026-09-11 甲：装备掉落入包。产出由 _shared/equip-gen-server.mjs 生成 ——
      // 那份是从前端 equipment.js 构建期抽取的，与前端是同一套逻辑（vtest_equip_gen 守）。
      equipDrops.push(reward.eq);
    } else if (reward.type === 'egg' && reward.baseName) {
      eggDrops[reward.baseName] = (eggDrops[reward.baseName] || 0) + 1;
    } else if (reward.type === 'boss') {
      // 2026-09-11 对齐前端 drop.js：boss = 必掉一件未鉴定装备 + 本图区域材料×5 + 稀有道具骰
      if (reward.eq) equipDrops.push(reward.eq);
      if (reward.material && reward.material.material) {
        rewardTotals[reward.material.material] = (rewardTotals[reward.material.material] || 0) + Math.max(1, Number(reward.material.qty) || 1);
      }
      for (const bi of (reward.bossItems || [])) {
        if (bi && bi.name) rewardTotals[bi.name] = (rewardTotals[bi.name] || 0) + Math.max(1, Number(bi.qty) || 1);
      }
    }
  }
  for (const [material, amount] of Object.entries(rewardTotals)) {
    const { error: rewardErr } = await supabase.rpc('add_material', {
      p_name: material,
      p_amount: amount
    });
    if (rewardErr) return json({ ok: false, error: 'REWARD_GRANT_FAILED', detail: rewardErr.message }, 500);
  }
  if (equipDrops.length) {
    const rows = equipDrops.map((eq: any) => ({
      user_id: uid,
      name: eq.name,
      slot: eq.slot,
      base_stat: eq.base,
      // ⚠️ affixes 是 jsonb：这里【必须传对象】。JSON.stringify 过会落成 jsonb 字符串
      //（2026-09-11 审计 P0-1 就是这么炸的）。_ilvl 与前端 Items.saveItem 同一约定。
      affixes: Object.assign({}, eq.affixes, { _ilvl: eq.ilvl != null ? eq.ilvl : null }),
      tier: eq.tier,
      rarity: eq.rarity && eq.rarity.id ? eq.rarity.id : 'white',
      locked: false,
      identified: eq.identified !== false,
      soul_affix: null
    }));
    const { error: eqErr } = await supabase.from('equip_items').insert(rows);
    if (eqErr) return json({ ok: false, error: 'EQUIP_GRANT_FAILED', detail: eqErr.message }, 500);
  }
  for (const [baseName, n] of Object.entries(eggDrops)) {
    // ⚠️ pet_egg.owner_id 是 text 列（不是 uuid）—— 见 docs/fos-cloud 技能的类型对照表
    const rows = Array.from({ length: n }, () => ({ owner_id: String(uid), egg_type: baseName, status: '未孵化' }));
    const { error: eggErr } = await supabase.from('pet_egg').insert(rows);
    if (eggErr) return json({ ok: false, error: 'EGG_GRANT_FAILED', detail: eggErr.message }, 500);
  }

  return json({
    ok: true,
    elapsedSec: gapSec,
    ...plan.summary,
    fights: plan.summary.gapFights,   // 刚补账的场次（客户端没看到的，detail 与之对应）
    exp: plan.summary.gapExp,
    expLeft: plan.petPatch.exp,       // 升级/封顶后的剩余经验（前端经验条）
    detail: plan.detail,              // 补账明细（客户端只展示掉落，经验已在回放基线里）
    script,                           // 已入账的演出录像（客户端纯回放）
    batchSeq: settleRes?.batch_seq ?? null,
    totalFights: settleRes?.total_fights ?? session.total_fights + plan.result.totalFights,
    totalExp: settleRes?.total_exp ?? session.total_exp + plan.result.totalExp
  });
}
