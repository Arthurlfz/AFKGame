// vtest_server_session.js —— 服务端会话（core/server-session.js）契约
// 覆盖：新设备 vs 页面恢复的 kick 语义 / revoked·banned 上报 / conflict 换 id 重试 /
//       心跳网络异常绝不误踢 / logout 调对 RPC / main.js 的接线顺序（登出必须先注销会话）。
// 服务端 RPC 的 SQL 逻辑另有一套事务实测（见 supabase/migrate_user_sessions.sql 注释），
// 这里只守客户端这一半。
const fs = require('fs'), vm = require('vm');

function makeCtx() {
  const calls = [], queue = [], store = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: globalThis.crypto,
    navigator: { userAgent: 'UnitTest/1.0 (vtest_server_session)' },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: { visibilityState: 'visible', addEventListener: () => {} },
    Config: { auth: { session: { heartbeatSec: 45 } } },
    __calls: calls, __queue: queue
  };
  ctx.Supabase = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const r = queue.shift();
      if (r && r.__throw) return Promise.reject(r.__throw);
      return Promise.resolve(r || { data: {}, error: null });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('../js/core/server-session.js', 'utf8'), ctx);
  return ctx;
}
function push(ctx, data, error) { ctx.__queue.push({ data: data || {}, error: error || null }); }
function pushThrow(ctx, err) { ctx.__queue.push({ __throw: err }); }
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

(async () => {
  /* ---------- 1. 首次打开（localStorage 无 id）= 新设备 → 撤销其他设备 ---------- */
  const X = makeCtx();
  push(X, { ok: true, state: 'active' });
  const r1 = await X.ServerSession.bootstrap();
  A(r1.state === 'active', '首次 bootstrap 返回 active');
  A(X.__calls[0].fn === 'session_login', 'bootstrap 调用 session_login');
  A(X.__calls[0].args.p_kick_others === true, '新设备首次打开 → kick=true（撤销该账号其他设备）');
  A(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(X.__calls[0].args.p_session_id),
    '会话 id 是合法 uuid');
  A(X.localStorage.getItem('fos_session_id') === X.__calls[0].args.p_session_id, '会话 id 已落 localStorage');

  /* ---------- 2. 页面恢复（localStorage 有 id）→ 不抢别人的会话 ---------- */
  X.__calls.length = 0;
  push(X, { ok: true, state: 'active' });
  await X.ServerSession.bootstrap();
  A(X.__calls[0].args.p_kick_others === false, '页面恢复 → kick=false（不抢别人的会话，否则两台设备互相踢）');
  A(X.__calls[0].args.p_session_id === X.localStorage.getItem('fos_session_id'), '恢复沿用同一个 session_id');

  /* ---------- 3. 真登录 → 撤销其他设备 ---------- */
  X.__calls.length = 0;
  push(X, { ok: true, state: 'active' });
  await X.ServerSession.login();
  A(X.__calls[0].args.p_kick_others === true, '真登录 → kick=true');
  A(typeof X.__calls[0].args.p_device === 'string' && X.__calls[0].args.p_device.length > 0, '登记时带设备信息');

  /* ---------- 4. 服务端说被踢 → 上报 revoked ---------- */
  let kicked = null;
  X.ServerSession.on('revoked', p => { kicked = p; });
  push(X, { ok: false, state: 'revoked', reason: 'kicked-by-login' });
  await X.ServerSession.bootstrap();
  A(kicked && kicked.reason === 'kicked-by-login', '服务端返回 revoked → 触发 revoked 事件');

  /* ---------- 5. 封禁 → 上报 banned ---------- */
  const Y = makeCtx();
  let bannedEvt = null, revokedEvt = null;
  Y.ServerSession.on('banned', p => { bannedEvt = p; });
  Y.ServerSession.on('revoked', p => { revokedEvt = p; });
  push(Y, { ok: false, state: 'banned', ban_reason: '开挂' });
  await Y.ServerSession.bootstrap();
  A(bannedEvt !== null, '服务端返回 banned → 触发 banned 事件');
  A(revokedEvt === null, 'banned 不走 revoked 事件（否则界面会说成「其他设备登录」）');
  A(bannedEvt.banned === true, 'banned 事件带 banned=true（调用方靠它区分文案，不靠 reason）');
  A(bannedEvt.banReason === '开挂', 'banned 事件带封禁原因原文');

  /* ---------- 5b. unregistered：清 localStorage 换个新 id 想绕过互踢 → 也按被踢处理 ---------- */
  const U = makeCtx();
  U.localStorage.setItem('fos_session_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); // 伪装"本地有 id"
  let uKick = false;
  U.ServerSession.on('revoked', () => { uKick = true; });
  push(U, { ok: false, state: 'unregistered' });
  await U.ServerSession.bootstrap();
  A(U.__calls[0].args.p_kick_others === false, '本地有 id → 走恢复语义（kick=false）');
  A(uKick, '服务端回 unregistered → 按被踢处理（换新 id 绕过互踢的路被堵死）');

  /* ---------- 6. session_id 撞车（conflict）→ 换 id 重试一次 ---------- */
  const Z = makeCtx();
  push(Z, { ok: false, state: 'conflict' });
  push(Z, { ok: true, state: 'active' });
  const rz = await Z.ServerSession.bootstrap();
  A(rz.state === 'active', 'conflict 时换新 id 重试并成功');
  A(Z.__calls.length === 2, 'conflict 只重试一次（不无限递归）');
  A(Z.__calls[0].args.p_session_id !== Z.__calls[1].args.p_session_id, '重试时换了新的 session_id');

  /* ---------- 7. 心跳：正常 / 网络异常 / 明确被踢 ---------- */
  const W = makeCtx();
  let wKick = 0;
  W.ServerSession.on('revoked', () => { wKick++; });
  W.ServerSession.on('banned', () => { wKick++; });
  W.ServerSession.start();
  W.ServerSession.stop();  // 只为拿到 session_id：下面手动驱动心跳，定时器不用真跑
  push(W, { ok: true, state: 'active' });
  await W.ServerSession.heartbeat();
  A(wKick === 0, '心跳正常不踢人');

  pushThrow(W, new Error('network down'));
  const hbThrow = await W.ServerSession.heartbeat();
  A(hbThrow.state === 'error', '网络异常时心跳返回 error');
  A(wKick === 0, '⚠️ 心跳网络异常绝不误踢（一次抖动不能把玩家踢下线）');

  push(W, null, { message: 'rpc failed' });
  const hbErr = await W.ServerSession.heartbeat();
  A(hbErr.state === 'error', 'RPC 报错时心跳返回 error');
  A(wKick === 0, 'RPC 报错也不误踢');

  push(W, { ok: false, state: 'revoked', reason: 'kicked-by-login' });
  await W.ServerSession.heartbeat();
  A(wKick === 1, '心跳返回 revoked → 踢下线（心跳是 Realtime 的兜底）');

  /* ---------- 8. 登出：调 session_logout 并带上自己的 id ---------- */
  const V = makeCtx();
  V.ServerSession.start();
  push(V, { ok: true });
  const lo = await V.ServerSession.logout();
  A(V.__calls[0].fn === 'session_logout', 'logout 调用 session_logout');
  A(V.__calls[0].args.p_session_id === V.ServerSession.id(), 'logout 带自己的 session_id');
  A(lo.ok === true, 'logout 返回 ok');
  V.ServerSession.stop(); // 清掉心跳定时器，别让进程挂住

  /* ---------- 9. main.js 接线（顺序错了就会踩"token 没了 RPC 401"） ---------- */
  const mainSrc = fs.readFileSync('../js/main.js', 'utf8');
  A(/ServerSession\.on\('revoked', onKickedByServer\)/.test(mainSrc), 'main.js 订阅 revoked');
  A(/ServerSession\.on\('banned', onKickedByServer\)/.test(mainSrc), 'main.js 订阅 banned');
  A(/await ServerSession\.login\(\)/.test(mainSrc), '登录流程登记服务端会话（撤销其他设备）');
  A(/await ServerSession\.bootstrap\(\)/.test(mainSrc), '页面启动走 bootstrap（自动区分恢复/新设备）');
  const iLogout = mainSrc.indexOf('ServerSession.logout()');
  const iSignOut = mainSrc.indexOf('const { error } = await Supabase.signOut();', mainSrc.indexOf('async function onLogout'));
  A(iLogout > -1 && iSignOut > -1 && iLogout < iSignOut,
    'session_logout 必须早于 Supabase.signOut()（token 没了 RPC 直接 401）');

  console.log('\nALL SERVER SESSION TESTS PASSED');
})().catch(e => { console.error('EXC', e); process.exit(1); });
