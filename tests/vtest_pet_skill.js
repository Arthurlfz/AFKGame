// vtest_pet_skill.js —— 主动技能自动触发（替代普攻）+ 变异宠继承本体技能
const fs = require('fs'), vm = require('vm');
const els = {};
function el() { return { hidden: false, disabled: false, textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector() { return null; } }; }
let fightTick = null;
const pet = { name: '腐烂之母', icon: 'x', level: 60 };
const ctx = {
  console, window: null,
  setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
  setInterval: fn => { fightTick = fn; return 1; }, clearInterval() {},
  document: { getElementById: id => els[id] || (els[id] = el()) },
  Math: Object.create(Math),
  Config: null,
  Util: { pickWeighted: list => list[0] },
  Pet: {
    getActivePet: () => pet,
    getStats: () => ({ hp: 100, atk: 20, def: 10, spd: 100, critRate: 0, critDamage: 1.5, hit: 100, dodge: 0, lifesteal: 0 }),
    getCurHp: () => 100, setCurHp() {}
  },
  UI: { addLog() {}, updateStatus() {}, resetBattle() {}, updateBattleArea() {}, updateBars() {}, updateAction() {}, animateAttack() { return 0; }, animateHit() {}, showDamage() {}, renderSkillInfo() {} },
  EnemyData: { list: [{ id: 'test-enemy', name: '测试怪', icon: 'x', levelRange: [1, 100], spd: 0, enemyType: 'normal' }] }
};
// 随机序列：第一个值喂给技能触发判定，后续喂给命中/暴击判定
let randSeq = [];
ctx.window = ctx;
ctx.Math.random = () => randSeq.length ? randSeq.shift() : 0.9;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
ctx.Config.battle.areas = [{ id: 'test-area', levelRange: [1, 100], enemyIds: ['test-enemy'], difficulty: 1, recGrowth: 3 }];
ctx.Config.battle.areaEnemyStats = { 'test-area': { hp: 1000, atk: 1, def: 10 } };
vm.runInContext(fs.readFileSync('../js/core/battle.js', 'utf8'), ctx);
const A = (ok, message) => { if (!ok) { console.error('FAIL: ' + message); process.exit(1); } console.log('PASS: ' + message); };
// 行动条满 100，speedScale=12、spd=100 → 一次 tick 加 8.33，13 次 tick 触发宠物行动
const advancePetTurn = () => { for (let i = 0; i < 13; i++) fightTick(); };

// ---- 1. Lv60 终形态开战解锁技能 ----
ctx.Battle.selectArea('test-area');
ctx.Battle.startAutoBattle(() => {});
A(ctx.Battle.state.activeSkill?.id === 'corrosion-spit', 'Lv60 腐烂之母开战解锁腐蚀喷吐');

// ---- 2. 变异宠继承本体技能（名字带「·异变」后缀） ----
ctx.Battle.stopAutoBattle();
pet.name = '腐烂之母·异变';
ctx.Battle.startAutoBattle(() => {});
A(ctx.Battle.state.activeSkill?.id === 'corrosion-spit', '变异宠「腐烂之母·异变」继承本体技能腐蚀喷吐');
ctx.Battle.stopAutoBattle();

// ---- 3. 等级不足不解锁 ----
pet.name = '腐烂之母'; pet.level = 59;
ctx.Battle.startAutoBattle(() => {});
A(ctx.Battle.state.activeSkill == null, 'Lv59 未达 60 级不解锁技能');
ctx.Battle.stopAutoBattle();

// ---- 4. 自动触发：概率内判定命中 → 技能替代普攻、按倍率结算 ----
pet.level = 60;
ctx.Battle.startAutoBattle(() => {});
const hpBefore = ctx.Battle.state.enemy.hp;
randSeq = [0.05, 0.05]; // 技能触发(0.05<0.30) + 命中(0.05<0.95) + 不暴击(0.05<0为假)
advancePetTurn(); // 宠物行动条满 → 行动
const base = Math.max(1, ctx.Battle.state.pet.atk - ctx.Battle.state.enemy.def);
const expected = base + Math.floor(base * (1.5 - 1)); // 150% 普攻
A(ctx.Battle.state.enemy.hp === hpBefore - expected, `腐蚀喷吐按 150% 普攻伤害结算（掉 ${hpBefore - ctx.Battle.state.enemy.hp}）`);
ctx.Battle.stopAutoBattle();

// ---- 5. 概率未命中 → 普通攻击（无技能加成） ----
ctx.Battle.startAutoBattle(() => {});
const hp2 = ctx.Battle.state.enemy.hp;
randSeq = [0.9, 0.05]; // 技能不触发(0.9<0.3为假) + 命中 + 不暴击
advancePetTurn();
A(ctx.Battle.state.enemy.hp === hp2 - base, `未触发时按普攻结算（掉 ${hp2 - ctx.Battle.state.enemy.hp}）`);
ctx.Battle.stopAutoBattle();

// ---- 6. 16 技能期望上限校验（期望 = 触发概率 × (总倍率-1)） ----
const SK = ctx.Config.pet.evolution.activeSkills;
A(Object.keys(SK).length === 16, `activeSkills 共 ${Object.keys(SK).length} 个技能（应为 16）`);
let maxExp = 0, minExp = 1;
for (const k in SK) {
  const s = SK[k];
  const exp = s.triggerChance * (s.damageMultiplier - 1);
  maxExp = Math.max(maxExp, exp);
  minExp = Math.min(minExp, exp);
  A(typeof s.triggerChance === 'number' && s.triggerChance > 0 && s.triggerChance < 1, `${s.name} 触发概率合法（${Math.round(s.triggerChance * 100)}%）`);
}
A(maxExp <= 0.25, `16 技能期望上限 ${Math.round(maxExp * 100)}% ≤ 25%（锚点 13%~18%，多段/附加略高）`);

ctx.Battle.stopAutoBattle();
console.log('ALL PET SKILL TESTS PASSED');
