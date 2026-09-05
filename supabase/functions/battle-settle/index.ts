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
import { settlePlan, hashSeed } from '../_shared/settle-core.mjs';

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

  // 2) 结算窗口 = 现在 - last_settled_at（惰性结算游标，只进不退）
  //    口径（2026-09-04 最终确认）：页面活着就挂——切后台/最小化不影响，前端继续 settle；
  //    页面关闭后没人来结算，下次回来只补「最近 GRACE 秒」= 页面还活着的最后一段，更早的作废
  //    （即"关了页面就没有了"，不需要离线收益，也不需要前端可见性暂停）。
  const lastSettled = new Date(session.last_settled_at).getTime();
  const elapsedSec = Math.max(0, Math.floor((Date.now() - lastSettled) / 1000));
  if (elapsedSec <= 0) return json({ ok: true, fights: 0, exp: 0, elapsedSec: 0 });
  const settleSec = Math.min(elapsedSec, GRACE_SETTLE_SECONDS);

  // 3) 读出战宠物
  const { data: petRow, error: petErr } = await supabase
    .from('pets')
    .select('*')
    .eq('id', session.pet_id)
    .maybeSingle();
  if (petErr) return json({ ok: false, error: 'PET_QUERY_FAILED', detail: petErr.message }, 500);
  if (!petRow) return json({ ok: false, error: 'PET_NOT_FOUND' });

  // 4) 读装备（容错：失败按裸装结算，P1 不阻塞）
  let equipItems = [];
  const equipRef = (petRow.equipment && typeof petRow.equipment === 'object') ? petRow.equipment : {};
  const equipIds = Object.values(equipRef).filter(x => x);
  if (equipIds.length) {
    const { data: items, error: eqErr } = await supabase
      .from('equip_items')
      .select('*')
      .in('id', equipIds);
    if (!eqErr && items) equipItems = items;
  }

  // 5) 结算计划（纯计算：快照 → 模拟 → 经验 → patch）
  const plan = settlePlan({
    session,
    petRow,
    equipItems,
    seconds: settleSec,
    seed: hashSeed(uid, session.id, session.last_settled_at),
    config: runtimeConfig,
    enemyList
  });

  // 6) 写库：会话累计 + 结算日志（battle_settle RPC，幂等）
  const { data: settleRes, error: settleErr } = await supabase.rpc('battle_settle', {
    p_session_id: session.id,
    p_fights: plan.result.totalFights,
    p_exp: plan.result.totalExp,
    p_detail: JSON.stringify(plan.detail),
    p_now: now,
    p_expected_last_settled_at: session.last_settled_at
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

  // 奖励由服务器直接入账。battle_settle 已用游标幂等，重复请求不会再次走到这里。
  // 当前先落材料；装备/宠物蛋沿用同一 detail 结构接入对应表。
  const rewardTotals: Record<string, number> = {};
  for (const reward of (plan.detail || []).map((x: any) => x.reward)) {
    if (reward && reward.type === 'material' && reward.material) {
      rewardTotals[reward.material] = (rewardTotals[reward.material] || 0) + Math.max(1, Math.floor(Number(reward.qty) || 1));
    }
  }
  for (const [material, amount] of Object.entries(rewardTotals)) {
    const { error: rewardErr } = await supabase.rpc('add_material', {
      p_name: material,
      p_amount: amount
    });
    if (rewardErr) return json({ ok: false, error: 'REWARD_GRANT_FAILED', detail: rewardErr.message }, 500);
  }

  return json({
    ok: true,
    elapsedSec: settleSec,
    ...plan.summary,
    expLeft: plan.petPatch.exp,       // 升级/封顶后的剩余经验（前端经验条）
    detail: plan.detail,              // 最近 50 场剧本：[{win,lv,name,exp,hp}]（前端演出）
    batchSeq: settleRes?.batch_seq ?? null,
    totalFights: settleRes?.total_fights ?? session.total_fights + plan.result.totalFights,
    totalExp: settleRes?.total_exp ?? session.total_exp + plan.result.totalExp
  });
});
