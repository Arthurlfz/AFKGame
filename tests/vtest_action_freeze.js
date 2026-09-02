// vtest_action_freeze.js —— 出手演出期间，出手那一方的行动条必须冻住，立绘归位后才继续走
//   （老 bug：tick 恒温 100ms 一直累加，人还在半路下一次已经在蓄力，看着像连招乱放不像回合制）
//   （红线：只冻结出手方。试过全场冻结，双方轮流播演出 = 每回合串行等，60 秒从 9 场掉到 7 场）
const fs = require('fs'), vm = require('vm');
const pet = { name: '测试宠', icon: 'x', level: 10 };
const els = {};
const timers = []; // {ms, fn}：所有 setTimeout，用来手动"等"完演出
let tick = null;
function el() { return { hidden: false, disabled: false, textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector() { return null; } }; }
const ctx = {
  console, window: null,
  setTimeout: (fn, ms) => { timers.push({ ms, fn }); return timers.length; },
  clearTimeout() {}, setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
  document: { getElementById: id => els[id] || (els[id] = el()) },
  Math: Object.create(Math),
  Config: null,
  Util: { pickWeighted: list => list[0] },
  Pet: {
    getActivePet: () => pet,
    getStats: () => ({ hp: 9999, atk: 50, def: 10, spd: 100, critRate: 0, critDamage: 1.5, hit: 100, dodge: 0, lifesteal: 0 }),
    getCurHp: () => 9999, setCurHp() {}
  },
  UI: {
    addLog() {}, updateStatus() {}, resetBattle() {}, updateBattleArea() {}, updateBars() {}, updateAction() {},
    animateAttack() { return 320; },   // 前摇 + 冲刺 = 320ms（命中那一刻）
    attackRecoverMs() { return 300; }, // 后摇归位 300ms
    animateHit() {}, showDamage() {}, renderSkillInfo() {}
  },
  EnemyData: { list: [{ id: 'e', name: '测试怪', icon: 'x', levelRange: [1, 100], spd: 100, enemyType: 'normal' }] }
};
ctx.window = ctx; ctx.Math.random = () => 0;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
ctx.Config.battle.areas = [{ id: 'a', levelRange: [1, 100], enemyIds: ['e'], difficulty: 1, recGrowth: 3 }];
ctx.Config.battle.areaEnemyStats = { a: { hp: 99999, atk: 1, def: 0 } };
vm.runInContext(fs.readFileSync('../js/core/battle.js', 'utf8'), ctx);
const A = (ok, m) => { if (!ok) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };
const S = () => ctx.Battle.state;
// 手动"等"完一次演出：执行对应的冻结定时器（= 命中 + 归位），按入队顺序取
const settle = () => { const i = timers.findIndex(x => x.ms === 620); if (i < 0) return false; timers.splice(i, 1)[0].fn(); return true; };

/* —— 场景一：双方同速，各冻各的 —— */
ctx.Battle.selectArea('a');
ctx.Battle.startAutoBattle(() => {});
timers.length = 0;
// spd 100 / speedScale 12 → 每次 tick +8.33，13 次满条（浮点累加，12 次差一点点）
for (let i = 0; i < 13; i++) tick();
A(S().petAction === 0 && S().enemyAction === 0, '双方同时满条时各出各的手（不互相吞回合）');
A(timers.filter(t => t.ms === 620).length === 2, '冻结时长各自 = 命中时刻(320) + 归位后摇(300)');

tick(); tick(); tick();
A(S().petAction === 0 && S().enemyAction === 0, '演出期间两条行动条都一动不动');

// 只解冻我方：敌方还在演出，不该被带着走
A(settle(), '我方演出结束，解冻');
tick();
A(S().petAction > 0 && S().enemyAction === 0, '只解冻出手方（演完的先走，没演完的继续冻）');
A(settle(), '敌方演出结束，解冻');
tick();
A(S().enemyAction > 0, '敌方演完自己归位，才继续蓄力');
A(settle() === false, '没有多余的冻结定时器（一次出手 = 一次冻结）');

/* —— 场景二：我方出手时，对手不受牵连 —— */
ctx.Battle.stopAutoBattle();
ctx.EnemyData.list[0].spd = 50; // 敌方半速：我方演出期间它本该攒到一半
ctx.Battle.startAutoBattle(() => {});
timers.length = 0;
for (let i = 0; i < 13; i++) tick();   // 我方满条出手；敌方约 54
const enemyMid = S().enemyAction;
A(S().petAction === 0 && enemyMid > 40 && enemyMid < 100, '我方起手时敌方正攒到一半');
for (let i = 0; i < 6; i++) tick();    // 我方演出未完（620ms ≈ 6 个 tick）
A(S().petAction === 0, '我方演出期间自己的行动条冻住');
A(S().enemyAction > enemyMid, '对手不受牵连，该蓄力照蓄力（全场冻结会把节奏拖成一半，不能这么写）');

ctx.Battle.stopAutoBattle();
ctx.Battle.startAutoBattle(() => {});
timers.length = 0;
tick();
A(S().petAction > 0, '停止再开不残留冻结状态（否则挂机会卡死在第一手）');

const srcBattle = fs.readFileSync('../js/core/battle.js', 'utf8');
const srcUi = fs.readFileSync('../js/ui/ui-battle.js', 'utf8');
A(/if \(!freeze\.pet\)/.test(srcBattle) && /if \(!freeze\.enemy\)/.test(srcBattle), 'battle.js 的 tick 按侧跳过累加（不是整场早退）');
A(/attackRecoverMs/.test(srcBattle), 'battle.js 向表现层讨要归位时长（命中不等于演完）');
A(/UI\.attackRecoverMs\s*=/.test(srcUi), 'ui-battle.js 对外导出归位时长');

console.log('ALL ACTION FREEZE TESTS PASSED');
