/* ============================================================
 * core/server-session.js —— 服务端会话（跨设备登录互斥 / 真互踢）
 * 职责：
 *  1. 会话身份：localStorage 里的 session_id（同一浏览器多标签共用同一个会话）
 *  2. 登记：登录 / 页面恢复时调 session_login —— 登录撤销其他设备，恢复不抢
 *  3. 心跳：每 45 秒 session_heartbeat，兼做「挂着机被封禁」的实时复查
 *  4. 实时踢人：Realtime 订阅自己那一行，被撤销时 1~2 秒内收到（心跳只是兜底）
 *  5. 事件：on('revoked' | 'banned', fn)；界面处理交给 main.js
 * 边界：
 *  - 不碰"同一个浏览器里的多标签互斥"（那是 core/auth-session.js 的活）。
 *  - 不做界面（踢下线后的提示在 ui-session-guard.js）。
 *  - 网络失败一律不踢人：只有服务端明确说 revoked / banned 才动。
 * 依赖：core/supabase.js（window.Supabase）
 * ============================================================ */
(function () {
  'use strict';

  const ID_KEY = 'fos_session_id';
  const DEFAULT_HEARTBEAT_SEC = 45;
  const REALTIME_TABLE = 'user_sessions';

  const handlers = { revoked: [], banned: [] };
  let SESSION_ID = '';
  let channel = null;
  let timer = null;
  let started = false;
  let visBound = false;

  function on(evt, fn) {
    if (!handlers[evt]) handlers[evt] = [];
    handlers[evt].push(fn);
    return fn;
  }
  function emit(evt, payload) {
    (handlers[evt] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { console.warn('[server-session] 事件 ' + evt + ' 回调异常', e); }
    });
  }

  function heartbeatMs() {
    const a = (window.Config && window.Config.auth && window.Config.auth.session) || {};
    const sec = Number(a.heartbeatSec) || DEFAULT_HEARTBEAT_SEC;
    return Math.max(10, sec) * 1000;
  }

  function newUuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* 忽略 */ }
    // 兜底：老浏览器没有 randomUUID 时手搓 v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function readId() {
    try { return localStorage.getItem(ID_KEY) || ''; } catch (e) { return ''; }
  }
  function writeId(id) {
    try { localStorage.setItem(ID_KEY, id); } catch (e) { /* 隐私模式：退化为内存会话 */ }
  }
  // 确保有会话 id；返回是否本来就存在（用来区分「恢复」与「新设备」）
  function ensureId() {
    if (SESSION_ID) return true;
    const saved = readId();
    if (saved) { SESSION_ID = saved; return true; }
    SESSION_ID = newUuid();
    writeId(SESSION_ID);
    return false;
  }
  function resetId() {
    SESSION_ID = newUuid();
    writeId(SESSION_ID);
  }

  function deviceLabel() {
    try {
      const ua = String((navigator && navigator.userAgent) || '');
      return ua.slice(0, 160);
    } catch (e) { return ''; }
  }

  const rpc = (fn, args) => window.Supabase.rpc(fn, args);

  // 服务端说被踢了 → 统一从这里上报，并且立刻停掉心跳/订阅（别再打服务端）
  function reportKick(state, data) {
    const banned = state === 'banned';
    stop();
    emit(banned ? 'banned' : 'revoked', {
      // ⚠️ reason 装的是"为什么"（kicked-by-login / 封禁原因文案），不要拿它比对是不是封禁；
      //    是不是封禁一律看 banned 布尔（调用方 main.js 也照这个来）
      banned: banned,
      reason: (data && (data.reason || data.ban_reason)) || state,
      banReason: (data && data.ban_reason) || null
    });
  }

  /* ---------- 会话登记 ---------- */
  // kick=true（登录 / 新设备首次打开）：撤销该账号其他所有会话
  // kick=false（页面刷新 / 已有 token 恢复）：只激活自己，已被撤销就如实报告被踢
  async function callLogin(kick, retried) {
    if (!window.Supabase || !window.Supabase.rpc) return { ok: false, state: 'no-client' };
    ensureId();
    let res;
    try {
      res = await rpc('session_login', {
        p_session_id: SESSION_ID,
        p_device: deviceLabel(),
        p_kick_others: !!kick
      });
    } catch (e) {
      return { ok: false, state: 'error', message: String((e && e.message) || e) };
    }
    if (res && res.error) return { ok: false, state: 'error', message: res.error.message };
    const data = (res && res.data) || {};
    const state = data.state || 'unknown';
    // 会话 id 被别的账号占了（客户端生成的 uuid 撞车）：换个 id 再来一次
    if (state === 'conflict' && !retried) {
      resetId();
      return callLogin(kick, true);
    }
    if (state === 'revoked' || state === 'banned' || state === 'unregistered') {
      reportKick(state === 'unregistered' ? 'revoked' : state, data);
    }
    return data;
  }

  // 页面启动：localStorage 已有 id = 恢复（不抢）；没有 = 新设备（抢）
  function bootstrap() { return callLogin(!readId()); }
  // 真登录（signIn / signUp 成功）：撤销其他设备
  function login() { return callLogin(true); }

  /* ---------- 心跳 ---------- */
  async function heartbeat() {
    if (!SESSION_ID || !window.Supabase || !window.Supabase.rpc) return { state: 'skip' };
    let res;
    try {
      res = await rpc('session_heartbeat', { p_session_id: SESSION_ID });
    } catch (e) {
      return { state: 'error', message: String((e && e.message) || e) }; // 网络问题：不动
    }
    if (res && res.error) return { state: 'error', message: res.error.message };
    const data = (res && res.data) || {};
    const state = data.state;
    if (state === 'revoked' || state === 'banned' || state === 'unregistered') {
      reportKick(state === 'unregistered' ? 'revoked' : state, data);
    }
    return data;
  }

  /* ---------- Realtime：秒级踢人 ---------- */
  function watchRealtime() {
    if (channel) return;
    if (!window.Supabase || !window.Supabase.getClient) return;
    let client = null;
    try { client = window.Supabase.getClient(); } catch (e) { return; }
    if (!client || !client.channel) return;
    try {
      channel = client
        .channel('user_session:' + SESSION_ID)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: REALTIME_TABLE, filter: 'id=eq.' + SESSION_ID },
          function (payload) {
            const row = payload && payload.new;
            if (!row || !row.revoked_at) return;
            reportKick(row.revoke_reason === 'banned' ? 'banned' : 'revoked', { reason: row.revoke_reason });
          })
        .subscribe();
    } catch (e) {
      channel = null; // Realtime 不可用没关系：心跳兜底
      console.warn('[server-session] Realtime 订阅失败，退回心跳兜底', e);
    }
  }

  /* ---------- 启停 ---------- */
  function startHeartbeat() {
    if (timer) return;
    timer = setInterval(function () { heartbeat(); }, heartbeatMs());
    if (!visBound && typeof document !== 'undefined' && document.addEventListener) {
      visBound = true;
      // 切回前台立刻补一次心跳：后台标签会被节流，回来第一件事就是确认自己还在不在
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') heartbeat();
      });
    }
  }

  function start() {
    if (started) return;
    started = true;
    ensureId();
    watchRealtime();
    startHeartbeat();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (channel) {
      try { channel.unsubscribe(); } catch (e) { /* 忽略 */ }
      try {
        const client = window.Supabase && window.Supabase.getClient && window.Supabase.getClient();
        if (client && client.removeChannel) client.removeChannel(channel);
      } catch (e) { /* 忽略 */ }
      channel = null;
    }
  }

  // 主动登出：只撤销自己这一条（登出只登出本设备）
  // ⚠️ 必须在 Supabase.signOut() 之前调用，否则 token 没了 RPC 直接 401
  async function logout() {
    if (!SESSION_ID || !window.Supabase || !window.Supabase.rpc) { stop(); return { ok: false }; }
    let res = null;
    try { res = await rpc('session_logout', { p_session_id: SESSION_ID }); }
    catch (e) { /* 网络问题：本地照常登出 */ }
    stop();
    return (res && res.data) || { ok: false };
  }

  /* ---------- 对外 API ---------- */
  window.ServerSession = {
    start,
    stop,
    bootstrap,
    login,
    heartbeat,
    logout,
    on,
    id: function () { return SESSION_ID; },
    // 调试用：换一个新会话 id（模拟"另一台设备"）
    resetId
  };
})();
