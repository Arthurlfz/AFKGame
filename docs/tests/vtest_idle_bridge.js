/* ============================================================
 * vtest_idle_bridge.js —— 服务器权威挂机桥接层（idle-bridge.js）测试
 * 从 tests/ 目录运行：node vtest_idle_bridge.js
 * 覆盖：
 *   A. 总开关（?noidle=1 关闭 / 默认开启）
 *   B. start 前置校验（无宠 / 无图 / 无 cloudId）
 *   C. start 成功 → isActive
 *   D. settle 覆盖式应用（exp / level / curHp 以服务器为准）
 *   E. 覆盖式 = 幂等：服务器值不变时连点两次不会累加
 *   F. 满级不覆盖 exp（经验池归本地，服务器那套是晶石计数会重复）
 *   G. 补场数计算（服务器场数 − 本地实打场数）
 *   H. 换宠 → 停止且不自动重开
 *   I. 网络失败 → 返回 error 不崩
 *   J. 无 active 会话 → 安静退场不再重试
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}

/* ---------- 可配置的 EF 桩 ---------- */
let settleResp = { fights: 3, exp: 90, endHp: 500, petMaxHp: 800, level: 2, expLeft: 40, ok: true };
let failNext = false;
const calls = [];
const mkRes = obj => ({ ok: true, status: 200, json: async () => obj });

(async () => {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: id => clearTimeout(id),
    performance: { now: () => Date.now() },
    navigator: {}, location: { href: 'http://x', search: '' }, localStorage: mem,
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: el() },
    addEventListener() {}, removeEventListener() {}, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto: global.crypto, AbortController, Blob, FormData, Headers, Request, Response
  };
  ctx.window = ctx;
  ctx.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    calls.push(body);
    if (failNext) { failNext = false; throw new Error('boom'); }
    if (body.action === 'start') return mkRes({ ok: true, session_id: 'sess-1', status: 'active' });
    if (body.action === 'stop') return mkRes({ ok: true, status: 'stopped' });
    if (body.action === 'settle') return mkRes(settleResp);
    return mkRes({ ok: false, error: 'BAD_ACTION' });
  };
  vm.createContext(ctx);

  for (const f of ['../js/vendor/supabase.min.js', 'vstub.js', '../js/core/config.js', '../js/core/supabase.js',
    '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/idle-bridge.js']) {
    VTF.load(ctx, f);
  }
  const C = code => vm.runInContext(code, ctx);
  const S = ms => new Promise(r => setTimeout(r, ms));
  await S(50);

  // 桩：给一个登录态，否则桥接层拿不到 token 会直接 NO_LOGIN
  C('Supabase.getSession = async () => ({ access_token: "tok-1", user: { id: "u1" } })');

  // 桩：让 buildNextScript 在沙箱里能跑通（真实环境靠 idle_sessions 表 + battle.js）
  // 必须在第一次 settle 之前装好——loadSim 会把首次加载结果缓存，之后再补就晚了
  C('Supabase.getClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: "sess-1", last_settled_at: new Date().toISOString() } }) }) }) }) }) }) });');
  C('window.Battle = window.Battle || {}; window.Battle.getCurrentArea = () => ({ id: "a1", levelRange: [1, 6] }); window.Battle.pickScaledEnemy = () => ({ name: "测试怪", level: 3 });');
  C('window.Drop = { rollReward: async () => { globalThis.__dropCalls = (globalThis.__dropCalls || 0) + 1; return { type: "none" }; } };');
  C('window.BattleSim = { simulateSessionScript: function (input) { globalThis.__simCalls = globalThis.__simCalls || []; globalThis.__simCalls.push(input); return { events: [{ type: "fight", t0: 0, t1: 5000, win: true, enemy: { name: "腐噜兽", level: 3 }, enemyLevel: 3, enemyName: "腐噜兽", exp: 10, hpStart: 100, hpLeft: 80 }], endHp: 80, petMaxHp: 100, totalExp: 10 }; } };');

  /* ---------- A. 总开关 ---------- */
  A(C('IdleBridge.enabled') === true, 'A1. 默认开启服务器托管挂机');
  A(C('IdleBridge.isActive()') === false, 'A2. 初始未激活');

  /* ---------- 造一只带 cloudId 的宠物 ---------- */
  C(`(function(){
    const p = Pet.createPet('血狐','x',5,85,30,8,110);
    p.cloudId = 'pet-111'; p.curHp = 800; p.level = 1; p.exp = 0;
    Pet.addPet(p); Pet.setActive(p.id); globalThis.__pid = p.id;
  })()`);
  const pet = () => C('Pet.getActivePet()');

  /* ---------- B. 前置校验 ---------- */
  A((await C('IdleBridge.start(null, null)')).error === 'NO_AREA_OR_PET', 'B1. 无图无宠 → NO_AREA_OR_PET');
  A((await C('IdleBridge.start({id:"a1"}, {name:"x"})')).error === 'NO_AREA_OR_PET', 'B2. 宠物无 cloudId → NO_AREA_OR_PET');
  A(calls.length === 0, 'B3. 前置校验失败不发请求');

  /* ---------- C. start 成功 ---------- */
  const r1 = await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  A(r1.ok === true, 'C1. start 成功');
  A(C('IdleBridge.isActive()') === true, 'C2. start 后 isActive=true');
  A(calls.some(c => c.action === 'start'), 'C3. 发出 start 请求');
  await S(60); // 等 start 内部 fire-and-forget 的锚点结算落地（占住 settling 锁）

  /* ---------- D. 覆盖式应用 ---------- */
  // 用宠物真实血上限来构造服务器返回值（setCurHp 会 clamp 到上限，构造值不能超）
  const maxHp = C('Pet.getStats(Pet.getActivePet()).hp');
  const endHp = Math.round(maxHp * 0.6);
  settleResp = { fights: 3, exp: 90, endHp: endHp, petMaxHp: maxHp, level: 2, expLeft: 40, ok: true };
  await C('IdleBridge.settleNow()');
  A(pet().level === 2, 'D1. 等级被服务器覆盖（Lv.' + pet().level + '）');
  A(pet().exp === 40, 'D2. 经验被服务器覆盖（exp=' + pet().exp + '）');
  A(pet().curHp === endHp, 'D3. 血量被服务器覆盖（hp=' + pet().curHp + '，上限 ' + maxHp + '）');

  /* ---------- E. 覆盖式 = 幂等（连点不累加） ---------- */
  await C('IdleBridge.settleNow()');
  A(pet().exp === 40, 'E1. 服务器值不变时连点第二次，exp 不累加（' + pet().exp + '）');
  A(pet().level === 2, 'E2. 等级不累加');

  /* ---------- F. 满级不覆盖 exp ---------- */
  C('Pet.getActivePet().level = Config.pet.maxLevel; Pet.getActivePet().exp = 777');
  settleResp = { fights: 2, exp: 50, endHp: 400, petMaxHp: 800, level: 60, expLeft: 9999, ok: true };
  await C('IdleBridge.settleNow()');
  A(pet().exp === 777, 'F1. 满级时 exp 留本地不动（经验池归本地管，服务器是晶石计数）');

  /* ---------- G. 战报到账通知 + 覆盖式应用（剧本驱动版） ---------- */
  C('globalThis.__notified = 0; IdleBridge.onChange = function(){ globalThis.__notified++; }');
  C('Pet.getActivePet().level = 5');
  settleResp = { fights: 10, exp: 100, endHp: 700, petMaxHp: 800, level: 5, expLeft: 10, totalFights: 100, detail: [{ win: true, lv: 6, name: '腐噜兽', exp: 23 }], ok: true };
  await C('IdleBridge.settleNow()');
  A(C('globalThis.__notified') >= 1, 'G1. 战报到账通知已发');
  await C('IdleBridge.settleNow()');
  A(pet().level === 5 && pet().exp === 10, 'G2. 服务器值不变 → 覆盖式应用不产生漂移');

  /* ---------- H. 换宠 → 停止不重开 ---------- */
  C(`(function(){
    const q = Pet.createPet('骨狼','y',5,90,32,9,105);
    q.cloudId = 'pet-222'; Pet.addPet(q); Pet.setActive(q.id);
  })()`);
  settleResp = { fights: 1, exp: 10, endHp: 300, petMaxHp: 800, level: 1, expLeft: 5, ok: true };
  await C('IdleBridge.settleNow()');
  A(C('IdleBridge.isActive()') === false, 'H1. 换宠后自动停止（不重开）');
  const stopCalls = calls.filter(c => c.action === 'stop').length;
  A(stopCalls === 1, 'H2. 换宠时向服务器发了 stop（' + stopCalls + ' 次）');

  /* ---------- I. 网络失败不崩 ---------- */
  const r2 = await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  A(r2.ok === true, 'I0. 重新 start 成功');
  await S(60); // 等 start 的锚点结算落地（释放 settling 锁）
  failNext = true;
  const r3 = await C('IdleBridge.settleNow()');
  A(r3.error === 'NETWORK', 'I1. 网络失败返回 error 而非抛异常');
  A(C('IdleBridge.isActive()') === true, 'I2. 网络失败后仍保持挂机（下个周期继续试）');

  /* ---------- J. 会话没了 → 安静退场 ---------- */
  const realResp = settleResp;
  settleResp = { ok: false, error: 'NO_ACTIVE_SESSION' };
  await C('IdleBridge.settleNow()');
  A(C('IdleBridge.isActive()') === false, 'J1. 服务器无会话 → 停止不再重试');
  settleResp = realResp;

  /* ---------- K. 剧本时长 = 真实结算窗口（不再固定 30 秒） ---------- */
  await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  await S(60);
  C('globalThis.__simCalls = []; globalThis.__dropCalls = 0;');
  settleResp = { fights: 2, exp: 20, endHp: 500, petMaxHp: 800, level: 5, expLeft: 10, elapsedSec: 45, totalFights: 200, ok: true };
  await C('IdleBridge.settleNow()');
  const lastSim = C('globalThis.__simCalls[globalThis.__simCalls.length-1]');
  A(lastSim && lastSim.seconds === 45, 'K1. 下一段剧本时长用上次窗口真实秒数 45（服务器按真实时间记账，演出必须同长度）');
  A(C('globalThis.__dropCalls') === 2, 'K2. 服务器打了 2 场、演出 0 场 → 补发 2 次掉落（不掉在空气里）');

  /* ---------- L. 补发上限（切后台很久回来不刷屏） ---------- */
  C('globalThis.__dropCalls = 0;');
  settleResp = { fights: 50, exp: 100, endHp: 700, petMaxHp: 800, level: 5, expLeft: 10, elapsedSec: 120, totalFights: 250, ok: true };
  await C('IdleBridge.settleNow()');
  A(C('globalThis.__dropCalls') === 20, 'L1. 补发上限 20 场（50 场只补 20，防止一次性刷垮日志）');

  console.log('\nALL IDLE BRIDGE TESTS PASSED');
})().catch(e => { console.error('FAIL: 未捕获异常 ' + (e && e.stack || e)); process.exit(1) });
