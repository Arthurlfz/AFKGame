/* ============================================================
 * core/auth-session.js —— 登录会话互斥（跨标签页）
 * 职责：
 *  1. 标签页身份：每个标签一个 id（存 sessionStorage —— 刷新后 id 不变，新标签才是新 id）
 *  2. 所有权广播（BroadcastChannel: fos-auth）：
 *       claim   我接管玩法运行时 → 其他标签让位（停运行时 + 显示遮罩）
 *       logout  我登出            → 其他标签同步回登录页
 *  3. 订阅 Supabase onAuthStateChange：会话结束（refresh 失败 / 被服务端 revoke）统一上报
 * 边界：
 *  - 不碰服务端（服务端会话表 + 异地踢人是下一批的事），只管同一个浏览器里的多个标签页。
 *  - 不负责界面（遮罩在 ui-session-guard.js，由 main.js 串起来）。
 *  - BroadcastChannel 不可用（老浏览器/隐私模式）时静默降级为单标签模式，不报错。
 * 依赖：无
 * ============================================================ */
(function () {
  'use strict';

  const CH_NAME = 'fos-auth';
  const TAB_KEY = 'fos_tab_id';
  const SELF_SIGN_OUT_GRACE_MS = 5000; // 自己发起登出后，这段时间内的 SIGNED_OUT 事件不上报

  function newTabId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 标签 id：sessionStorage 是「每个标签独立、刷新保留」的，正好当标签身份用
  let MY_ID = newTabId();
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved) MY_ID = saved;
    else sessionStorage.setItem(TAB_KEY, MY_ID);
  } catch (e) { /* 无 sessionStorage（隐私模式）：退化成内存 id，不影响同页逻辑 */ }

  let channel = null;
  let started = false;
  let owner = false;        // 本标签是否持有玩法运行时（唯一事实源）
  let selfSignOutAt = 0;    // 自己发起登出的时刻（用来过滤自己触发的 SIGNED_OUT）
  const handlers = { yield: [], logout: [] }; // yield=被别人顶掉；logout=会话结束/别处登出

  function on(evt, fn) {
    if (!handlers[evt]) handlers[evt] = [];
    handlers[evt].push(fn);
    return fn;
  }
  function emit(evt, payload) {
    (handlers[evt] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { console.warn('[auth-session] 事件 ' + evt + ' 回调异常', e); }
    });
  }

  function open() {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
      channel = new BroadcastChannel(CH_NAME);
      channel.addEventListener('message', onMessage);
    } catch (e) {
      channel = null;
      console.warn('[auth-session] BroadcastChannel 不可用，已降级为单标签模式');
    }
    return channel;
  }

  function post(msg) {
    const ch = open();
    if (!ch) return;
    try { ch.postMessage(Object.assign({ tabId: MY_ID }, msg)); } catch (e) { /* 忽略 */ }
  }

  function onMessage(e) {
    const m = e && e.data;
    if (!m || !m.type || m.tabId === MY_ID) return; // 忽略格式不对的与自己发的
    if (m.type === 'claim') {
      if (!owner) return; // 本标签本来就没在跑（已是让位状态）：不重复触发
      owner = false;
      emit('yield', { by: m.tabId, reason: m.reason || 'claim' });
    } else if (m.type === 'logout') {
      owner = false;
      emit('logout', { by: m.tabId, reason: 'other-tab-logout' });
    }
  }

  // 宣示所有权（登录成功 / 恢复会话 / 遮罩上点「在此标签页继续」）：其他标签收到后让位
  function claim(reason) {
    owner = true;
    post({ type: 'claim', reason: reason || 'claim' });
    return true;
  }
  function release() { owner = false; }
  function isOwner() { return owner; }

  // 自己发起的登出（main.js 会自己清理）：标记一下，避免 SIGNED_OUT 事件又触发一轮清理
  function markSelfSignOut() { selfSignOutAt = Date.now(); }

  // 通知其他标签：本标签已登出，都回登录页
  function broadcastLogout() {
    owner = false;
    post({ type: 'logout' });
  }

  // 订阅 Supabase 会话事件。
  // ⚠️ 回调里【禁止】再调 supabase 的 auth 方法（SDK 内部持锁 → 会死锁卡住整个 auth 流程），
  //    这里只把事件转出去，真正的清理动作由 main.js 做。
  function watchAuthState() {
    const S = window.Supabase;
    if (!S || !S.getClient) return;
    let client = null;
    try { client = S.getClient(); } catch (e) { return; }
    if (!client || !client.auth || !client.auth.onAuthStateChange) return;
    try {
      client.auth.onAuthStateChange(function (event) {
        if (event !== 'SIGNED_OUT') return;
        if (Date.now() - selfSignOutAt < SELF_SIGN_OUT_GRACE_MS) return; // 自己登出，已处理过
        owner = false;
        emit('logout', { by: 'server', reason: 'session-ended' });
      });
    } catch (e) {
      console.warn('[auth-session] onAuthStateChange 订阅失败', e);
    }
  }

  function start() {
    if (started) return;
    started = true;
    open();
    watchAuthState();
  }

  /* ---------- 对外 API ---------- */
  window.AuthSession = {
    tabId: MY_ID,
    start,
    claim,
    release,
    isOwner,
    markSelfSignOut,
    broadcastLogout,
    on
  };
})();
