/* ============================================================
 * vtest_trial_server.js —— 副本「服务端权威」接线契约（2026-09-23 立）
 *
 * 守的是这几条（错一条就是资产事故）：
 *   ① 服务端路径**不本地发奖**（服务器已发过，本地再来一次 = 静默双倍）
 *   ② 服务端路径**不消耗本地资格**（免费次数/门票归服务器账本）
 *   ③ 结算结果**照抄服务器**（层数/奖励/通关，不许本地重算）
 *   ④ 服务器失败就**如实报错并中止**，绝不回退到本地再打一遍（回退 = 可能双份）
 *   ⑤ 开关关掉 → 回到原来的本地路径（应急可切回）
 *   ⑥ 回放事件流完整（floor / floorClear / settle），UI 不改就能播
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');

const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

/* ---------- 桩 ---------- */
let fetchCalls = [];
let fetchReply = null;
const memStore = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise,
  AbortController, Math, JSON,
  fetch: async (url, init) => {
    fetchCalls.push({ url, init });
    return { ok: true, status: 200, json: async () => fetchReply };
  },
  crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  localStorage: {
    getItem: k => (k in memStore ? memStore[k] : null),
    setItem: (k, v) => { memStore[k] = String(v); },
    removeItem: k => { delete memStore[k]; }
  }
};
ctx.window = ctx;
ctx.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
vm.createContext(ctx);

let grants = 0;            // Materials.gain 次数（本地发奖次数）
let consumed = 0;          // TrialAccess.consumeEntry 次数（本地资格消耗次数）
const events = [];

ctx.Supabase = {
  getSession: async () => ({ access_token: 'test-jwt' }),
  getClient: () => null
};
ctx.Pet = {
  getActivePet: () => ({ id: 1, name: '测试宠', cloudId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', level: 60 }),
  getStats: () => ({ hp: 30000 }),
  getCurHp: () => 30000,
  setCurHp() {}
};
ctx.Materials = {
  getQuantity: () => 5,
  gain: () => { grants++; },
  spend: async () => ({ ok: true })
};
ctx.Battle = { canBeginTrial: () => true, beginTrialFloor: () => true };
ctx.Quest = { reportType: () => {} };
vm.runInContext(fs.readFileSync(__dirname + '/../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/core/battle-session.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-server.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-access.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-rewards.js', 'utf8'), ctx);

/* UI 桩：记录演出调用（2026-09-23 翻车根因就是**没摆怪物、没演出**） */
let uiCalls = { resetBattle: 0, updateBars: 0, showDamage: 0, animateAttack: 0, updateAction: 0 };
let lastAttackAt = 0, firstDamageAt = 0, firstAttackAt = 0;   // 出手 → 命中的时序（守"伤害不得早于命中时刻"）
const actions = [];                                           // updateAction 的入参序列（守"出手时进度条冻住"）
ctx.UI = {
  resetBattle: () => { uiCalls.resetBattle++; },
  updateBars: () => { uiCalls.updateBars++; },
  showDamage: () => { uiCalls.showDamage++; if (!firstDamageAt) firstDamageAt = Date.now(); },
  // 桩：命中时刻 = 前摇 300ms；后摇 = 200ms（真实 act.js 由 animateAttack 返回值 / attackRecoverMs 给）
  animateAttack: () => { uiCalls.animateAttack++; lastAttackAt = Date.now(); if (!firstAttackAt) firstAttackAt = Date.now(); return 300; },
  attackRecoverMs: () => 200,
  updateAction: (a, b) => { uiCalls.updateAction++; actions.push([Number(a) || 0, Number(b) || 0]); }
};
ctx.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 4);   // node 里没有 RAF
ctx.cancelAnimationFrame = id => clearTimeout(id);
vm.runInContext(fs.readFileSync(__dirname + '/../js/ui/battle/show.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-engine.js', 'utf8'), ctx);

// 本地发奖与本地资格都套一层计数（真实模块，不改行为）
const realSettle = ctx.TrialRewards.settle;
ctx.TrialRewards.settle = (route, c) => realSettle(route, c);
const realConsume = ctx.TrialAccess.consumeEntry;
ctx.TrialAccess.consumeEntry = (id) => { consumed++; return realConsume(id); };

const C = code => vm.runInContext(code, ctx);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const serverReply = (over) => Object.assign({
  ok: true, replayed: false, usedFree: true, cleared: false,
  maxFloor: 7, tierFloor: 5, hpPercent: 12,
  reward: [{ name: '进化素材', qty: 3 }],
  floors: [
    { floor: 1, level: 10, enemy: { hp: 900, atk: 1, def: 1, hit: 1, dodge: 1 }, win: true, petHpLeft: 25000,
      events: [{ t: 0, by: 'pet', dmg: 500, crit: true }, { t: 320, by: 'enemy', dmg: 300 }, { t: 640, by: 'pet', dmg: 500 }] },
    { floor: 2, level: 14, enemy: { hp: 1200, atk: 1, def: 1, hit: 1, dodge: 1 }, win: true, petHpLeft: 18000,
      events: [{ t: 0, by: 'pet', dmg: 700 }, { t: 320, by: 'enemy', dmg: 400 }, { t: 640, by: 'pet', dmg: 700 }] },
    { floor: 3, level: 19, enemy: { hp: 2000, atk: 1, def: 1, hit: 1, dodge: 1 }, win: false, petHpLeft: 0,
      events: [{ t: 0, by: 'enemy', dmg: 9000, crit: true }, { t: 320, by: 'pet', dmg: 600, miss: true }] }
  ]
}, over || {});

(async () => {
  /* ============ 0. 开关默认开 ============ */
  A(ctx.TrialServer && typeof ctx.TrialServer.start === 'function', 'TrialServer 已挂载（start / freeLeftOf / newRunId）');
  A(typeof ctx.Config.resourceTrials.serverAuthority === 'boolean',
    `服务端权威开关存在（当前值 ${ctx.Config.resourceTrials.serverAuthority}）`);
  // ⚠️ 开关当前是 false（2026-09-23 因实机问题回滚）——本测试下面测的是"开关打开时"的行为，
  //    所以这里显式打开；**不改默认值**（默认值由 trial-config.js 决定，属人决策）。
  C('Config.resourceTrials.serverAuthority = true');

  /* ============ 1. 服务端路径：走网络、不发奖、不消耗本地资格 ============ */
  fetchCalls = []; grants = 0; consumed = 0; events.length = 0; uiCalls = { resetBattle: 0, updateBars: 0, showDamage: 0, animateAttack: 0, updateAction: 0 };
  fetchReply = serverReply();
  C('Config.resourceTrials.floorDelayMs = 1');
  C('Config.resourceTrials.replayMinMs = 1; Config.resourceTrials.replayMaxMs = 5');   // 测试提速
  let r = ctx.TrialEngine.start('temper', { onEvent: e => events.push(e) });
  await sleep(400);
  r = await r;

  A(fetchCalls.length === 1, `点一次副本 = 只发一次服务器请求（${fetchCalls.length}）`);
  A(fetchCalls[0].url.indexOf('/resource-trial') >= 0, '请求打在 resource-trial 这个 EF 上');
  A(String(fetchCalls[0].init.headers.Authorization || '').indexOf('Bearer ') === 0, '带的是玩家自己的登录令牌');
  A(grants === 0, '🔴 服务端路径**没有本地发奖**（本地再发一次 = 静默双倍收益）');
  A(consumed === 0, '🔴 服务端路径**没有消耗本地资格**（免费次数/门票归服务器账本）');

  /* ============ 2. 结果照抄服务器 ============ */
  A(r && r.ok === true && r.maxFloor === 7, `结算层数照抄服务器（${r && r.maxFloor}）`);
  A(r && r.cleared === false && r.reward.length === 1 && r.reward[0].name === '进化素材',
    '奖励照抄服务器（不本地重算档位）');

  /* ============ 3. 回放事件流完整 ============ */
  const types = events.map(e => e.type);
  A(types.indexOf('start') >= 0 && types.indexOf('settle') >= 0, '回放有 start / settle（UI 不改就能播）');
  A(types.filter(t => t === 'floor').length === 3, `逐层播报 = 3 层（服务器给了 3 层）`);
  A(types.filter(t => t === 'floorClear').length === 2 && types.filter(t => t === 'floorFail').length === 1,
    '2 层通过 + 1 层倒下，与服务器战报一致');
  A(ctx.TrialEngine.getState().running === false, '播完即收尾（不卡住战斗页）');

  /* ============ 3b. 演出必须真的发生（2026-09-23 翻车根因：没摆怪物、没演战斗、行动条不跑） ============ */
  A(uiCalls.resetBattle === 3, `每层都把怪物/宠物摆进战斗区（resetBattle ${uiCalls.resetBattle}/3 层）—— 没有它 = "怪物看不到"`);
  A(uiCalls.animateAttack > 0 && uiCalls.showDamage > 0,
    `有出手动作与伤害飘字（animateAttack ${uiCalls.animateAttack} / showDamage ${uiCalls.showDamage}）—— 没有它 = "几秒就打完"`);
  A(uiCalls.updateBars > 3, `血条在演（updateBars ${uiCalls.updateBars} 次，不只是开头一次）`);
  A(uiCalls.updateAction > 3, `🔴 行动条在跑（updateAction ${uiCalls.updateAction} 次）—— 用户实测缺的就是它（"完全没看到出手进度条在跑"）`);
  /* 前停/后停与冻结（2026-09-23 用户点名缺的两件事）：
   *   前停 = 出手到命中之间有 animateAttack 给的前摇（桩里 300ms）
   *   后停 = 出手后该方行动条冻住 attackRecoverMs() 那么久（桩里 200ms） */
  A(firstDamageAt - firstAttackAt >= 250,
    `伤害不得早于出手动画的命中时刻（实测 ${firstDamageAt - firstAttackAt}ms ≥ 250ms）—— 这就是"攻击前停"`);
  const bothFrozen = actions.some((p, i) => i > 0 && p[0] === actions[i - 1][0] && p[1] === actions[i - 1][1]);
  A(bothFrozen,
    '🔴 出手期间**双方**行动条一起冻住（整段演出停住，与挂机托管演出同口径）—— 用户："宠物出手的时候怪物的进度条也需要暂停"');
  /* 行动条按**真实速度**推（2026-09-23 用户："出手速度完全乱了，进度条没有按照真实的来吗"）：
   * 战报时间轴原样使用（不压缩），条速 = 双方 spd / speedScale —— 速度快的一方先满。 */
  A(actions.some(p => p[0] > 0) && actions.some(p => p[1] > 0),
    '双方行动条都真的被填过（按 spd/speedScale 推，不是静止的假进度）');

  /* ============ 4. 服务器失败 → 如实报错，绝不回退本地 ============ */
  fetchCalls = []; grants = 0; consumed = 0; events.length = 0;
  fetchReply = { ok: false, error: 'NO_TICKET' };
  r = await ctx.TrialEngine.start('temper', { onEvent: e => events.push(e) });
  A(r && r.ok === false && r.error === 'NO_TICKET', '服务器说没票 → 如实把原因带回给玩家');
  A(events.filter(e => e.type === 'floor').length === 0, '🔴 失败时**没有回退到本地再打一遍**（不产生层事件）');
  A(grants === 0 && consumed === 0, '失败时也没动本地的钱和资格');

  /* ============ 5. 开关关掉 → 回到本地路径（应急可切回） ============ */
  C('Config.resourceTrials.serverAuthority = false');
  fetchCalls = []; grants = 0; consumed = 0;
  events.length = 0;
  fetchReply = serverReply();
  C('Config.resourceTrials.floorDelayMs = 1');
  ctx.TrialEngine.start('temper', { onEvent: e => events.push(e) });   // 本地路径会真开层，等它自己走完
  await sleep(300);
  A(fetchCalls.length === 0, '关掉开关后**完全不打服务器**（本地算法接管）');
  A(consumed === 1, '关掉开关后回到本地资格消耗（1 次）');

  console.log('ALL TRIAL SERVER TESTS PASSED');
  // 第 5 段走的是本地路径，里面有余留的轮询定时器 —— 不强制退出进程会挂着（看着像卡死）
  process.exit(0);
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
