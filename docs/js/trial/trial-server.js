/* ============================================================
 * trial/trial-server.js —— 副本的服务端权威通道（单一职责）
 * 职责：
 *  1. 调 Edge Function `resource-trial` 结算一整局副本（成败与奖励由服务器判定）
 *  2. 查「今天这条路线还剩几次免费」（直接读账本，不新增 RPC）
 * 不负责：资格守门（trial-access）、层推进（trial-engine）、任何 UI 渲染。
 *
 * 🔴 权威口径（红线 5）：服务器已经扣过票 / 发过奖，**客户端这条路径一律不再发奖、不再扣票**，
 *    只把结果播出来。本地再发一次 = 静默双倍收益。
 * 幂等：runId 由调用方每次点击生成并复用（连点/超时重发 → 服务器回放上次结果，不会重复发奖）。
 * 依赖：supabase（getSession）
 * ============================================================ */
(function () {
  'use strict';

  const FN_URL = 'https://asklogeayzlqpeejuvjj.supabase.co/functions/v1/resource-trial';
  const TIMEOUT_MS = 20000;

  const cfg = () => (window.Config && window.Config.resourceTrials) || {};
  const on = () => cfg().serverAuthority !== false;   // 默认开（服务端权威是上线前必做）

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // 兜底（老 webview）：够随机、够唯一即可，服务器只校验 uuid 形状
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async function token() {
    if (!window.Supabase || !window.Supabase.getSession) return null;
    try {
      const s = await window.Supabase.getSession();
      return (s && s.access_token) || null;
    } catch (e) { return null; }
  }

  /* 结算一局。入参 { routeId, petId?, runId? }；
   * 返回 { ok:true, cleared, maxFloor, floors[], hpPercent, reward[], tierFloor, usedFree, replayed? }
   *   或 { ok:false, error, detail? }。
   * ⚠️ 失败一律如实返回，**绝不回退到本地再算一遍**（回退 = 可能出现双份奖励）。 */
  async function start(opts) {
    opts = opts || {};
    const jwt = await token();
    if (!jwt) return { ok: false, error: '未登录，无法进入副本' };
    const runId = opts.runId || uuid();
    const body = { routeId: opts.routeId, runId };
    if (opts.petId) body.petId = opts.petId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || data.ok !== true) {
        return { ok: false, error: (data && data.error) || 'HTTP_' + res.status, detail: (data && data.detail) || '' };
      }
      return Object.assign({ ok: true, runId }, data);
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      return { ok: false, error: aborted ? 'TIMEOUT' : 'NETWORK', detail: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  /* 今天这条路线还剩几次免费（读服务端账本，与 EF 的判定同一口径：北京时间 12:00 换日）。
   * 失败（未登录 / 网络问题）返回 null —— 调用方按"未知"处理，别当成 0。 */
  async function freeLeftOf(routeId) {
    const limit = Number(cfg().freeEntriesPerDay) || 0;
    if (limit <= 0) return 0;
    const S = window.Supabase;
    if (!S || !S.getClient) return null;
    const client = S.getClient();
    if (!client) return null;
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0));
    if (now < dayStart) dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    try {
      const r = await client.from('resource_trial_runs')
        .select('id', { count: 'exact', head: true })
        .eq('route_id', routeId)
        .gte('created_at', dayStart.toISOString());
      if (r && typeof r.count === 'number') return Math.max(0, limit - r.count);
      return null;
    } catch (e) { return null; }
  }

  window.TrialServer = { start, freeLeftOf, newRunId: uuid, isOn: on, FN_URL };
})();
