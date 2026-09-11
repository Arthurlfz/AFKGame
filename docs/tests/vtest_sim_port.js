/* ============================================================
 * vtest_sim_port.js —— battle.js（塔/副本实时战斗）与 battle-sim（挂机结算）的伤害公式行为等价守护
 *
 * 为什么需要（2026-09-11 审计第 4 批）：
 *   战核实际有 4 份：core/battle.js、core/battle-sim.mjs、core/battle-sim.global.js（生成品）、
 *   supabase/functions/_shared/battle-sim.mjs。
 *   只有 battle-sim ⇄ _shared/battle-sim 这一对有 vtest_sim_sync 守着；
 *   battle.js ⇄ battle-sim 的关系只是注释里写的「与 battle.js calcDamage 同源 / 逐随机数一致」
 *   —— **没有任何测试守**。改 battle.js 的公式不会红，但挂机（服务端 sim）和塔/副本（battle.js）
 *   里同一个宠物会打出不同数字，玩家侧就是"同一只宠在塔里和挂机里强度不一样"。
 *
 * 为什么用行为对比而不是源码 diff：
 *   两者签名本就不同（battle.js 闭包读 Config + Math.random；sim 注入 config + rnd），
 *   toString() 永远不可能相等。用同一套随机序列喂两边、比对返回结构，才是真正在守
 *   「同输入 → 同输出」这条不变量。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const els = {};
const pet = { name: '测试宠', icon: 'x', level: 10, growth: 10, baseHp: 100, baseAtk: 20, baseDef: 10, baseSpd: 50, lineId: '测试宠' };
function el() { return { hidden: false, disabled: false, textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector() { return null; } }; }

const ctx = {
  console, window: null,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [] },
  Math: Object.create(Math),
  Config: null,
  Util: { pickWeighted: list => list[0], randInt: (a, b) => a },
  Pet: {
    getActivePet: () => pet,
    getStats: () => ({ hp: 9999, atk: 50, def: 10, spd: 100, critRate: 0, critDamage: 1.5, hit: 100, dodge: 0, lifesteal: 0 }),
    getCurHp: () => 9999, setCurHp() {}
  },
  UI: {
    addLog() {}, updateStatus() {}, resetBattle() {}, updateBattleArea() {}, updateBars() {}, updateAction() {},
    animateAttack() { return 0; }, attackRecoverMs() { return 0; }, animateHit() {}, showDamage() {}, renderActiveSkill() {}
  },
  EnemyData: { list: [{ id: 'e', name: '测试怪', icon: 'x', levelRange: [1, 100], spd: 100, enemyType: 'normal' }] }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
ctx.Config.battle.areas = [{ id: 'a', levelRange: [1, 100], enemyIds: ['e'], difficulty: 1, recGrowth: 3 }];
ctx.Config.battle.areaEnemyStats = { a: { hp: 99999, atk: 1, def: 0 } };
vm.runInContext(fs.readFileSync('../js/core/battle-session.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/battle.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/battle-sim.global.js', 'utf8'), ctx);

const A = (ok, m) => { if (!ok) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

// 同一套随机序列喂两边：battle.js 用 Math.random（闭包），sim 用注入的 rnd
function runFront(att, def, rnds) {
  let i = 0;
  const old = ctx.Math.random;
  ctx.Math.random = () => (i < rnds.length ? rnds[i++] : 0.5);
  try { return ctx.Battle.calcDamage(att, def); } finally { ctx.Math.random = old; }
}
function runSim(att, def, rnds) {
  let i = 0;
  const rnd = () => (i < rnds.length ? rnds[i++] : 0.5);
  return ctx.BattleSim.calcDamage(att, def, ctx.Config, rnd);
}

const att = o => Object.assign({ atk: 100, hit: 100, critRate: 0.1, critDamage: 2, pen: 0, dmgBonus: 0, lifesteal: 0 }, o);
const def = o => Object.assign({ def: 50, dodge: 0, dr: 0, hp: 500 }, o);

const CASES = [
  ['普通命中',            att({}),                       def({}),                          [0.50, 0.90]],
  ['未命中（dodge 拉满）',  att({ hit: 10 }),              def({ dodge: 500 }),              [0.99, 0.10]],
  ['暴击',                att({}),                       def({}),                          [0.10, 0.00]],
  ['带穿透',              att({ pen: 80 }),              def({}),                          [0.50, 0.90]],
  ['穿透超过防御',         att({ pen: 999 }),             def({}),                          [0.50, 0.90]],
  ['带伤害加成',           att({ dmgBonus: 50 }),          def({}),                          [0.50, 0.90]],
  ['带受伤减免',           att({}),                       def({ dr: 40 }),                   [0.50, 0.90]],
  ['减免超上限（>90）',     att({}),                       def({ dr: 999 }),                  [0.50, 0.90]],
  ['带吸血',              att({ lifesteal: 0.25 }),       def({}),                          [0.50, 0.90]],
  ['全部拉满',            att({ atk: 9999, critRate: 1, critDamage: 3, pen: 50, dmgBonus: 100, lifesteal: 0.5 }),
                          def({ def: 300, dodge: 100, dr: 50 }),                              [0.50, 0.00]]
];

/* A. 逐 case 比对：两边必须给出完全一样的 {damage,isCrit,isMiss,heal} */
let bad = [];
for (const [name, a, d, rnds] of CASES) {
  const f = runFront(a, d, rnds);
  const s = runSim(a, d, rnds);
  const same = JSON.stringify(f) === JSON.stringify(s);
  if (!same) bad.push(`${name}\n      前端 ${JSON.stringify(f)}\n      sim  ${JSON.stringify(s)}`);
}
A(bad.length === 0,
  bad.length === 0
    ? `A. battle.js 与 battle-sim 的 calcDamage 行为完全等价（${CASES.length} 个用例：命中/未命中/暴击/穿透/加成/减免/吸血）`
    : '伤害公式漂移（battle.js 与 battle-sim 输出不同）→\n      ' + bad.join('\n      '));

/* B. 随机数消耗次数必须一致（否则同种子模拟会整体错位，不只是这一场不同） */
function rndCalls(fn, rnds) {
  let i = 0;
  const old = ctx.Math.random;
  ctx.Math.random = () => { i++; return 0.5; };
  try { fn(); } finally { ctx.Math.random = old; }
  return i;
}
const fCalls = rndCalls(() => ctx.Battle.calcDamage(att({}), def({})), []);
let sCalls = 0;
ctx.BattleSim.calcDamage(att({}), def({}), ctx.Config, () => { sCalls++; return 0.5; });
A(fCalls === sCalls, `B. 随机数消耗次数一致（前端 ${fCalls} 次 / sim ${sCalls} 次）—— 次数不同会让同种子模拟整体错位`);

console.log('ALL SIM PORT TESTS PASSED');
