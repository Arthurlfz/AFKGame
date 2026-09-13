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
const fs = require('fs'), vm = require('vm'), path = require('path');
const VTF=require('./vtest_files');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}

/* ---------- 可配置的 EF 桩 ----------
 * 2026-09-09 回放版：settle 响应带 script（服务器已入账的录像），客户端不再本地模拟。 */
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
    '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/battle-session.js', '../js/core/idle-bridge.js']) {
    VTF.load(ctx, f);
  }
  const C = code => vm.runInContext(code, ctx);
  const S = ms => new Promise(r => setTimeout(r, ms));
  await S(50);

  // 桩：给一个登录态，否则桥接层拿不到 token 会直接 NO_LOGIN
  C('Supabase.getSession = async () => ({ access_token: "tok-1", user: { id: "u1" } })');

  // 桩：resumeActive 恢复会话用（客户端已不本地模拟，不再需要 BattleSim 桩）
  C('Supabase.getClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: "sess-1", last_settled_at: new Date().toISOString() } }) }) }) }) }) }) });');
  C('window.Battle = window.Battle || {}; window.Battle.getCurrentArea = () => ({ id: "a1", levelRange: [1, 6] }); window.Battle.pickScaledEnemy = () => ({ name: "测试怪", level: 3 });');
  C('window.Drop = { rollReward: async () => { globalThis.__dropCalls = (globalThis.__dropCalls || 0) + 1; return { type: "none" }; } };');

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

  /* ---------- G. 战报到账通知 + 覆盖式应用（回放版） ---------- */
  C('globalThis.__notified = 0; IdleBridge.onChange = function(){ globalThis.__notified++; }');
  C('Pet.getActivePet().level = 5');
  settleResp = { fights: 10, exp: 100, endHp: 700, petMaxHp: 800, level: 5, expLeft: 10, totalFights: 100, detail: [{ win: true, lv: 6, name: '腐噜兽', exp: 23 }], ok: true };
  await C('IdleBridge.settleNow()');
  A(C('globalThis.__notified') >= 1, 'G1. 战报到账通知已发');
  await C('IdleBridge.settleNow()');
  // 2026-09-09 回放版：补账场不再重复给经验——补账经验已含在剧本回放基线（expBefore）里，
  // 这里再给一次就是第二次跳变。覆盖式应用后 exp = expLeft(10)，重复结算不变（幂等）。
  A(pet().level === 5 && pet().exp === 10, 'G2. 覆盖式应用+补账场不重复给经验（10，重复结算不变）');

  /* ---------- H. 换宠 → 收尾停机（结最后一段账 + 服务器停会话），不重开 ---------- */
  C(`(function(){
    const q = Pet.createPet('骨狼','y',5,90,32,9,105);
    q.cloudId = 'pet-222'; Pet.addPet(q); Pet.setActive(q.id);
  })()`);
  settleResp = { fights: 1, exp: 10, endHp: 300, petMaxHp: 800, level: 1, expLeft: 5, ok: true };
  await C('IdleBridge.settleNow()');
  A(C('IdleBridge.isActive()') === false, 'H1. 换宠后自动停止（不重开）');
  A(C('BattleSession.isIdle()') === true, 'H1b. 停机后战斗页占用权已交还（isIdle）');
  await S(80); // 收尾是异步的（先让出画面，再结算 → stop）：等它跑完再断言请求
  const stopCalls = calls.filter(c => c.action === 'stop').length;
  A(stopCalls === 1, 'H2. 换宠时向服务器发了 stop（' + stopCalls + ' 次）');
  A(calls.some(c => c.action === 'settle'), 'H3. 停机前先结算（EF 的 stop 只标记停止、不结算，不先结算会丢最后一段收益）');

  /* ---------- I. 网络失败不崩 ---------- */
  const r2 = await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  A(r2.ok === true, 'I0. 重新 start 成功');
  await S(60); // 等 start 的锚点结算落地（释放 settling 锁）
  failNext = true;
  const r3 = await C('IdleBridge.settleNow()');
  A(r3.error === 'NETWORK', 'I1. 网络失败返回 error 而非抛异常');
  A(C('IdleBridge.isActive()') === true, 'I2. 网络失败后仍保持挂机（下个周期继续试）');

  /* ---------- J. 会话没了 → 自愈重建（2026-09-13 改：以前是"静默停机"） ----------
   * 用户实测："点开始挂机后有时过几分钟就自己停了，控制台什么都没有"。
   * 旧行为：服务器说无会话 → 立刻本地停机、零日志。玩家点开始挂机就是"我要一直挂着"，
   * 服务器侧会话丢了不是玩家的意图 → 应该先用当前地图+宠重建会话继续挂。 */
  const realResp = settleResp;
  const startCallsBefore = calls.filter(c => c.action === 'start').length;
  settleResp = { ok: false, error: 'NO_ACTIVE_SESSION' };
  await C('IdleBridge.settleNow()');
  A(C('IdleBridge.isActive()') === true, 'J1. 服务器无会话时不再静默停机（挂机仍在跑）');
  settleResp = realResp;   // 服务器恢复正常：自愈要把挂机接回去
  await S(150);
  A(C('IdleBridge.isActive()') === true, 'J2. 自愈后挂机继续跑（不需要玩家手动重开）');
  A(calls.filter(c => c.action === 'start').length > startCallsBefore,
    'J3. 自愈向服务器重建了会话（补发 start）');

  /* J4. 反复中断到上限 → 明确停机（防"建好又被停"的死循环轰服务器） */
  settleResp = { ok: false, error: 'NO_ACTIVE_SESSION' };
  for (let i = 0; i < 8; i++) { await C('IdleBridge.settleNow()'); await S(40); }
  A(C('IdleBridge.isActive()') === false, 'J4. 会话反复中断达上限 → 停机（不再无限重试）');
  settleResp = realResp;

  /* ---------- K. 服务器录像安装 + 回放基线 + 幂等判重（回放版核心） ---------- */
  await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  await S(60);
  C('globalThis.__dropCalls = 0;');
  const scriptEvt = { type: 'fight', t0: 0, t1: 5000, win: true, enemy: { name: '腐噜兽', level: 3 }, enemyLevel: 3, enemyName: '腐噜兽', exp: 30, hpStart: 400, hpLeft: 380, petHits: 3, enemyHits: 1, petDmg: [100, 10, 10] };
  settleResp = { fights: 2, exp: 20, endHp: 500, petMaxHp: 800, level: 6, expLeft: 90, elapsedSec: 45, totalFights: 200, ok: true,
    script: { id: 'w-45', events: [scriptEvt], endHp: 500, petMaxHp: 800, totalExp: 30, level: 6, expLeft: 90, levelBefore: 5, expBefore: 10 } };
  await C('IdleBridge.settleNow()');
  A(C('IdleBridge.getScriptId()') === 'w-45', 'K1. 服务器返回的已入账录像被安装为当前剧本');
  A(pet().exp === 10 && pet().level === 5, 'K2. 装剧本时回放基线=窗前真值（exp=' + pet().exp + ' Lv.' + pet().level + '，演完正好落在 expLeft/level）');
  await C('IdleBridge.settleNow()'); // 服务器幂等重发同一段（刷新/切回前台场景）
  A(C('IdleBridge.getScriptId()') === 'w-45' && pet().exp === 10, 'K3. 同一段录像重发被忽略（不重装不重播不重复给经验）');

  /* ---------- L. 补账上限（切后台很久回来不刷屏） ---------- */
  C('globalThis.__dropCalls = 0;');
  settleResp = { fights: 50, exp: 100, endHp: 700, petMaxHp: 800, level: 5, expLeft: 10, elapsedSec: 120, totalFights: 250, ok: true,
    detail: Array.from({ length: 50 }, () => ({ win: true, lv: 6, name: '腐噜兽', exp: 23 })) };
  await C('IdleBridge.settleNow()');
  A(C('globalThis.__dropCalls') === 20, 'L1. 补账按 detail 行数计，展示上限 20 场（50 场只补 20，防止一次性刷垮日志）');

  C('IdleBridge.shutdown()'); // K/L 段重新 start 过：不停掉 rAF 桩会让 node 进程永不退出

  /* ---------- M~O. 野外战斗"卡住/怪消失"三处修复的回归（2026-09-10） ---------- */
  const SRC = fs.readFileSync('../js/core/idle-bridge.js', 'utf8');
  // M. settle 冷却的时间基准必须与比较方（rAF 时间戳 = performance.now）一致。
  //    旧代码写 Date.now()（1.7e12 量级）永远大于 performance.now() → 一次 settle 失败后
  //    剧本刷新彻底停摆，只能等 120 秒兜底结算 → 症状是"挂机卡死一两分钟又自己好了"。
  // 窗口放宽到 2500 字符：2026-09-13 起 handleSettleError 里加了自愈分支与说明注释，
  // 断言的语义没变（"冷却那行必须用 performance.now"），只是离函数头更远了。
  A(/handleSettleError[\s\S]{0,2500}performance\.now\(\) \+ SCRIPT_RETRY_MS/.test(SRC),
    'M1. settle 冷却用 performance.now（与 rAF 时间戳同基准，防冷却永不到期→挂机卡死）');
  A(SRC.indexOf('Date.now() + SCRIPT_RETRY_MS') < 0, 'M2. 不再有混用 Date.now() 写冷却的写法');

  // N. 上怪失败必须原地重试，不许继续推进（否则 t>=f.t1 会变成"空气击杀"= 宠物对着空气打）
  A(/if \(!mountShowEnemy\(f\.enemy, f\)\)/.test(SRC), 'N1. mountShowEnemy 失败有显式分支（不再被忽略）');
  A(SRC.indexOf('mountFailStreak') >= 0 && /MOUNT_FAIL_LIMIT/.test(SRC), 'N2. 连续上怪失败有上限与重新取剧本兜底');

  /* O. 行为验证：演出血条不被服务器"窗尾真值"覆盖（血条跳变 / 回血等待卡死的根因） */
  C('globalThis.__uiBars = []; window.UI = { addLog(){}, updateStatus(){}, consoleLog(){}, showLoot(){}, resetBattle(){}, updateAction(){}, updateBars(p,pm,e,em){ globalThis.__uiBars.push([p,pm,e,em]); }, animateAttack(){ return 120; }, attackRecoverMs(){ return 80; }, animateHit(){}, animateVictory(){}, showDamage(){} };');
  await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  await S(60);
  // 用宠物真实上限构造剧本血量（hpStart 必须 ≤ maxHp，否则血条会算出 >100% 的宽度）
  const mhO = C('Pet.getStats(Pet.getActivePet()).hp');
  const startHp = Math.round(mhO * 0.5), leftHp = Math.round(mhO * 0.45), tailHp = Math.round(mhO * 0.2);
  const e0 = { type: 'fight', t0: 0, t1: 8000, win: true, enemy: { name: '腐噜兽', level: 3 }, enemyLevel: 3, enemyName: '腐噜兽', exp: 30, hpStart: startHp, hpLeft: leftHp, petHits: 2, enemyHits: 2, petDmg: [10, 10] };
  settleResp = { fights: 1, exp: 10, endHp: startHp, petMaxHp: mhO, level: 5, expLeft: 10, totalFights: 300, ok: true,
    script: { id: 'w-O', events: [e0], endHp: startHp, petMaxHp: mhO, totalExp: 30, level: 5, expLeft: 10, levelBefore: 5, expBefore: 10 } };
  await C('IdleBridge.settleNow()');
  await S(120);   // 让 rAF 桩把怪挂上台（t0=0，第一帧即可）
  const dbg1 = C('IdleBridge.getDebugState()');
  A(dbg1.showEnemy === '腐噜兽', 'O1. 怪已上台（showEnemy=' + dbg1.showEnemy + '）');
  A(dbg1.showHp === startHp, 'O2. 上台时血条取本场 hpStart（' + dbg1.showHp + '）');

  // 怪在演时再来一次结算：真账 endHp 是"下一段窗口末尾"的值，绝不覆盖演出血条
  settleResp = { fights: 1, exp: 10, endHp: tailHp, petMaxHp: mhO, level: 5, expLeft: 10, totalFights: 301, ok: true };
  await C('IdleBridge.settleNow()');
  const dbg2 = C('IdleBridge.getDebugState()');
  A(pet().curHp === tailHp, 'O3. 宠物数据仍是服务器真账（curHp=' + pet().curHp + '）');
  A(dbg2.showHp === startHp, 'O4. 但演出血条不被窗尾真值覆盖（仍 ' + dbg2.showHp + '，防"血量跳变/回血等待卡死"）');
  A(dbg2.showEnemy === '腐噜兽', 'O5. 怪没被换剧本抹掉（仍在场）');

  C('IdleBridge.shutdown()');

  /* ---------- P. duringPetEdit：改宠物前先结清真账，改完自动重挂（2026-09-13） ----------
   * 用户实测"进化成功后等级突然变回去"的根因：托管期间本地 pet.level 是**演出预演值**
   * （回放基线 + 每场击杀往上加），服务器真账领先最多一个窗口；进化/合成/涅槃拿这个预演值
   * 判门槛、甚至写回云端，随后又被真账校准 → 玩家看到等级跳回去。
   * 现在这些操作统一先 shutdown()（结账 → 本地被真账校准）→ 执行 → 自动重新挂上。 */
  await C('IdleBridge.start({id:"a1"}, Pet.getActivePet())');
  await S(80);
  const beforeP = calls.length;
  const pr = await C('IdleBridge.duringPetEdit(async () => { globalThis.__petEditRan = true; return { ok: true, tag: "edited" }; })');
  A(pr && pr.ok === true && pr.tag === 'edited', 'P1. duringPetEdit 原样返回被包裹函数的结果');
  A(C('globalThis.__petEditRan') === true, 'P2. 被包裹的"改宠物"逻辑确实执行了');
  A(C('IdleBridge.isActive()') === true, 'P3. 改完宠物后挂机自动继续（不用玩家手动点开始）');
  const pCalls = calls.slice(beforeP);
  A(pCalls.some(c => c.action === 'stop'), 'P4. 执行前先把服务器会话停掉（最后一段账已结清）');
  A(pCalls.filter(c => c.action === 'start').length >= 1, 'P5. 执行后重新 start 会话（同图同宠接回去）');
  C('IdleBridge.shutdown()');

  /* ---------- Q. 静态守值：不许再有"无理由的静默停机" ---------- */
  A(/NO_ACTIVE_SESSION'\)\s*\{\s*recoverSession\(\)/.test(SRC), 'Q1. NO_ACTIVE_SESSION 走自愈（不再静默停机）');
  A(SRC.indexOf('stopLocal()') < 0, 'Q2. 停机一律带原因（不再出现无参 stopLocal() 静默停机）');
  A(/window\.IdleBridge\s*=\s*\{[\s\S]{0,400}duringPetEdit/.test(SRC), 'Q3. duringPetEdit 已对外暴露（供进化/合成/涅槃调用）');

  /* ---------- R. 静态守值：挂机时间不再凭空消失（服务端，2026-09-13） ---------- */
  const EF = fs.readFileSync('../../supabase/functions/battle-settle/index.ts', 'utf8');
  const CORE = fs.readFileSync('../../supabase/functions/_shared/settle-core.mjs', 'utf8');
  A(EF.indexOf('MAX_CATCHUP_SECONDS') >= 0 && EF.indexOf('GRACE_SETTLE_SECONDS') < 0,
    'R1. 补账上限不再是 120 秒（浏览器冻结 / 电脑休眠时不丢挂机时间）');
  A(EF.indexOf('p_cursor: cursorIso') >= 0 && /cursorIso = new Date\(fromMs \+ \(Number\(plan\.result\.coveredMs\)/.test(EF),
    'R2. 结算游标 = 上次游标 + 本次真正算掉的时间（不是 now，不会跨过没算的时间）');
  A(CORE.indexOf('coveredMs') >= 0, 'R3. settle-core 上报 coveredMs（没算完的秒数留在账上，下次继续补）');

  /* ---------- S. "托管期间客户端不许写宠物等级/经验"的静态守值（2026-09-13） ----------
   * 背景：托管挂机期间本地 level/exp 是**演出预演值**（云端真账领先最多一个窗口），
   * 任何一处"顺手把本地值写回云端"都会改坏真账：经验/等级倒退，随后被真账校准 → 玩家看到等级跳回去。
   * 规则：写 level/exp 的入口**必须**有闸（托管期间不写）或走 IdleBridge.duringPetEdit。
   * 这条测试的作用 = 以后谁新加一个写入入口，这里当场红，逼他先想清楚用哪道闸。 */
  const jsRoot = path.join(__dirname, '..', 'js');
  const walkJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkJs(p) : (e.name.endsWith('.js') ? [p] : []);
  });
  const ALL_FILES = walkJs(jsRoot);
  const srcOf = n => (ALL_FILES.find(p => path.basename(p) === n) ? fs.readFileSync(ALL_FILES.find(p => path.basename(p) === n), 'utf8') : '');
  // 名单：每个入口旁边写清"闸在哪"，不许只写文件名了事（S5~S7 会抽查闸是否真的存在）
  const ALLOW = {
    'main.js': 'flushPetProgress 内有 serverManaged() 闸',
    'ui-dev.js': 'savePet 内有 IdleBridge.isActive() 闸',
    'pet_merge.js': '涅槃/合成走 IdleBridge.duringPetEdit 包裹',
    'pet_evolve.js': '进化走 IdleBridge.duringPetEdit 包裹',
    'tutorial_mode.js': '引导顶等级走 IdleBridge.duringPetEdit 包裹'
  };
  // 判定：**在 updatePet(...) 的实参里**出现 level:/exp:（只认"这次调用真的在写等级/经验"，
  // 不认文件里别处的 level: —— 否则 setCloudPets 那种只补 traits 的调用会被误伤）
  const writesLevelExp = src => {
    const re = /updatePet\(([\s\S]{0,400}?)\)/g;
    let m;
    while ((m = re.exec(src))) { if (/\b(level|exp)\s*:/.test(m[1])) return true; }
    return false;
  };
  const suspects = [];
  for (const p of ALL_FILES) {
    if (writesLevelExp(fs.readFileSync(p, 'utf8'))) suspects.push(path.basename(p));
  }
  const unguarded = suspects.filter(n => !ALLOW[n]);
  A(unguarded.length === 0,
    'S1. 客户端写 pets.level/exp 的入口全在"有闸名单"里（漏网：' + (unguarded.join('、') || '无') + '；在册：' + suspects.filter(n => ALLOW[n]).join('、') + '）');
  A(/serverManaged\(\)/.test(srcOf('main.js')), 'S2. main.js 的等级写入确有"托管期间不写"的闸（flushPetProgress）');
  A(/IdleBridge\.isActive/.test(srcOf('ui-dev.js')), 'S3. 开发面板的等级写入确有托管闸');
  A(/duringPetEdit/.test(srcOf('pet_evolve.js')) && /duringPetEdit/.test(srcOf('pet_merge.js')) && /duringPetEdit/.test(srcOf('tutorial_mode.js')),
    'S4. 进化/合成/涅槃/引导顶等级 都走 IdleBridge.duringPetEdit（先结清真账再改宠物）');

  console.log('\nALL IDLE BRIDGE TESTS PASSED');process.exit(0);
})().catch(e => { console.error('FAIL: 未捕获异常 ' + (e && e.stack || e)); process.exit(1) });
