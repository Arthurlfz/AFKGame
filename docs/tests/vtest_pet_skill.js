// vtest_pet_skill.js —— 腐噜兽终形态手动主动技能底座
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
  UI: { addLog() {}, updateStatus() {}, resetBattle() {}, updateBattleArea() {}, updateBars() {}, updateAction() {}, animateAttack() { return 0; }, animateHit() {}, showDamage() {}, renderActiveSkill() {} },
  EnemyData: { list: [{ id: 'test-enemy', name: '测试怪', icon: 'x', levelRange: [1, 100], spd: 0, enemyType: 'normal' }] }
};
ctx.window = ctx; ctx.Math.random = () => 0;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
ctx.Config.battle.areas = [{ id: 'test-area', levelRange: [1, 100], enemyIds: ['test-enemy'], difficulty: 1, recGrowth: 3 }];
ctx.Config.battle.areaEnemyStats = { 'test-area': { hp: 1000, atk: 1, def: 10 } };
vm.runInContext(fs.readFileSync('../js/core/battle.js', 'utf8'), ctx);
const A = (ok, message) => { if (!ok) { console.error('FAIL: ' + message); process.exit(1); } console.log('PASS: ' + message); };
ctx.Battle.selectArea('test-area');
ctx.Battle.startAutoBattle(() => {});
A(ctx.Battle.state.activeSkill?.id === 'corrosion-spit', 'Lv60 腐烂之母在开战时解锁腐蚀喷吐');
A(ctx.Battle.useActiveSkill() === true && ctx.Battle.state.skillQueued, '点击主动技能只排队，不抢占行动条');
const hpBefore = ctx.Battle.state.enemy.hp;
const expectedDamage = Math.floor((ctx.Battle.state.pet.atk - ctx.Battle.state.enemy.def) * 1.5);
const advancePetTurn = () => { for (let i = 0; i < 13; i++) fightTick(); };
advancePetTurn();
A(ctx.Battle.state.skillQueued === false && ctx.Battle.state.skillCooldown === 3, '下一次我方行动释放技能并进入 3 回合冷却');
A(ctx.Battle.state.enemy.hp === hpBefore - expectedDamage, '腐蚀喷吐按 150% 普攻伤害结算');
advancePetTurn(); advancePetTurn(); advancePetTurn();
A(ctx.Battle.state.skillCooldown === 0, '冷却按三次后续我方行动递减至零');
ctx.Battle.stopAutoBattle();
console.log('ALL PET SKILL TESTS PASSED');
