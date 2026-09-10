// vtest_auth_session.js —— 跨标签页会话互斥（core/auth-session.js）契约
// 覆盖：claim 让其他标签让位 / logout 广播 / 自己发的消息忽略 / 事件不重复触发 /
//       无 BroadcastChannel 时降级不崩 / 缺 ui-session-guard.js 时 main.js 的登出流程不崩。
// 说明：用一条共享"总线"模拟浏览器同源多标签 —— 每个标签一个独立 vm context
//       （独立 window/sessionStorage/BroadcastChannel），与真实浏览器一致。
const fs = require('fs'), vm = require('vm');

function makeBus() {
  const subs = [];
  return {
    make() {
      const self = { listeners: [], closed: false };
      self.addEventListener = (t, f) => { if (t === 'message') self.listeners.push(f); };
      self.removeEventListener = () => {};
      self.postMessage = (m) => {
        subs.forEach(s => { if (s !== self && !s.closed) s.listeners.forEach(f => f({ data: m })); });
      };
      self.close = () => { self.closed = true; };
      subs.push(self);
      return self;
    }
  };
}

// 造一个"标签页"：独立 context + 独立 auth-session.js 实例
function makeTab(bus) {
  const ss = {};
  const ctx = {
    console, setTimeout, clearTimeout,
    BroadcastChannel: function () { return bus.make(); },
    sessionStorage: {
      getItem: k => (k in ss ? ss[k] : null),
      setItem: (k, v) => { ss[k] = String(v); },
      removeItem: k => { delete ss[k]; }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('../js/core/auth-session.js', 'utf8'), ctx);
  return ctx;
}

const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

(async () => {
  const bus = makeBus();
  const X = makeTab(bus), Y = makeTab(bus);
  const run = (tab, code) => vm.runInContext(code, tab);

  X.AuthSession.start();
  Y.AuthSession.start();

  // —— 标签身份：两个标签必须是不同的 id（否则"自己发的消息"判定失效）——
  A(X.AuthSession.tabId !== Y.AuthSession.tabId, '两个标签的 tabId 不同');

  // —— claim：谁最后接管谁持有所有权 ——
  X.AuthSession.claim('login');
  A(X.AuthSession.isOwner() === true, 'claim 后本标签是 owner');

  let yielded = null;
  X.AuthSession.on('yield', p => { yielded = p; });
  Y.AuthSession.claim('login');
  A(yielded !== null, '其他标签 claim → 本标签收到 yield（让位）');
  A(yielded && yielded.reason === 'login', 'yield 带上对方声明的原因（login）');
  A(X.AuthSession.isOwner() === false, '让位后本标签不再是 owner');
  A(Y.AuthSession.isOwner() === true, '发起 claim 的标签成为 owner');

  // —— 已经让位的标签不再重复触发（否则会反复弹遮罩）——
  let yieldCount = 0;
  X.AuthSession.on('yield', () => { yieldCount++; });
  Y.AuthSession.claim('again');
  A(yieldCount === 0, '已让位的标签收到再次 claim 不重复触发 yield');

  // —— 自己发的消息不能弹回自己 ——
  let selfYield = 0;
  Y.AuthSession.on('yield', () => { selfYield++; });
  Y.AuthSession.claim('self');
  A(selfYield === 0, '自己 claim 不触发自己的 yield');

  // —— logout 广播：其他标签同步回登录页 ——
  let loggedOut = null;
  Y.AuthSession.on('logout', p => { loggedOut = p; });
  X.AuthSession.broadcastLogout();
  A(loggedOut !== null, '其他标签登出 → 本标签收到 logout 事件');
  A(loggedOut && loggedOut.reason === 'other-tab-logout', 'logout 带上原因 other-tab-logout');
  A(X.AuthSession.isOwner() === false, 'broadcastLogout 会清掉本标签的 owner 标记');

  // —— 无 BroadcastChannel（老浏览器/隐私模式）：降级为单标签，不能抛错 ——
  const bare = { console };
  bare.window = bare;
  vm.createContext(bare);
  vm.runInContext(fs.readFileSync('../js/core/auth-session.js', 'utf8'), bare);
  let bareOk = true;
  try { bare.AuthSession.start(); bare.AuthSession.claim(); }
  catch (e) { bareOk = false; console.error('  ' + e.message); }
  A(bareOk, '无 BroadcastChannel 时降级为单标签模式，不抛错');
  A(bare.AuthSession.isOwner() === true, '降级模式下 claim 仍能标记所有权（同页逻辑不受影响）');
  let bareLogoutOk = true;
  try { bare.AuthSession.broadcastLogout(); } catch (e) { bareLogoutOk = false; }
  A(bareLogoutOk && bare.AuthSession.isOwner() === false, '降级模式下 broadcastLogout 不抛错且清掉 owner');

  // —— 静态契约：main.js 不许裸调遮罩 API（缺 ui-session-guard.js 会把登出流程带崩）——
  const mainSrc = fs.readFileSync('../js/main.js', 'utf8');
  A(/function hideSessionGuard\(\) \{ if \(UI\.hideSessionGuard\)/.test(mainSrc),
    'main.js 用判空包装调用遮罩隐藏');
  A(/function showSessionGuard\(opts\) \{ if \(UI\.showSessionGuard\)/.test(mainSrc),
    'main.js 用判空包装调用遮罩显示');
  // 计数版断言：这两个 API 在 main.js 里只应出现在判空包装内部（各 1 处），
  // 多出来就说明有人又写了裸调用
  const bareShow = (mainSrc.match(/UI\.showSessionGuard\(/g) || []).length;
  const bareHide = (mainSrc.match(/UI\.hideSessionGuard\(/g) || []).length;
  A(bareShow === 1, 'main.js 里 UI.showSessionGuard 只出现在判空包装内（实际 ' + bareShow + ' 处）');
  A(bareHide === 1, 'main.js 里 UI.hideSessionGuard 只出现在判空包装内（实际 ' + bareHide + ' 处）');
  A(/AuthSession\.claim\('runtime-start'\)/.test(mainSrc),
    '启动玩法运行时统一 claim（所有登录路径的唯一收口）');
  A(/AuthSession\.broadcastLogout\(\)/.test(mainSrc), '登出会广播给其他标签页');

  console.log('\nALL AUTH SESSION TESTS PASSED');
})().catch(e => { console.error('EXC', e); process.exit(1); });
