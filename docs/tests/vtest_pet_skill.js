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
vm.runInContext(fs.readFileSync('../js/core/battle-session.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/battle.js', 'utf8'), ctx);
const A = (ok, message) => { if (!ok) { console.error('FAIL: ' + message); process.exit(1); } console.log('PASS: ' + message); };
// 回归（2026-09-11）：三份战斗核的技能解锁 = 终形态专属。
// 旧实现沿进化树走到终形态、非终阶也按档位给技能（skillTierScale 未配置 → 满威力），
// 导致二阶宠在挂机（服务器模拟）里放技能，与「终形态 Lv60 解锁」设计和客户端战斗矛盾。
vm.runInContext(fs.readFileSync('../js/core/battle-sim.global.js', 'utf8'), ctx);
// 回归（2026-09-11 第二版·用户拍板「技能跟血统线走，不本末倒置」）：
// 三份战斗核的技能 = 分支固有技，按进化阶段分档：一阶 I / 二三阶 II / 终阶·神级 III 满档。
const scaleCfg = vm.runInContext('Config.pet.evolution.skillTierScale', ctx);
A(Array.isArray(scaleCfg) && scaleCfg.length === 3, '档位缩放表已配置（3 档）');
const simSkill = pet => ctx.BattleSim.skillOf(typeof pet === 'string' ? { name: pet } : pet, ctx.Config);
A(simSkill('腐噜兽') === null, '基宠（未选分支）无主动技能');
A(simSkill('腐沼兽') && simSkill('腐沼兽').tier === 1 && simSkill('腐沼兽').triggerChance === 0.12 && simSkill('腐沼兽').damageMultiplier === 1.25,
  '一阶腐沼兽：I 档（概率×0.6=12%、倍率×0.5=1.25）');
A(simSkill('腐沼王') && simSkill('腐沼王').tier === 2 && simSkill('腐沼王').triggerChance === 0.16 && simSkill('腐沼王').damageMultiplier === 1.38,
  '二阶/三阶腐沼王：II 档（概率×0.8=16%、倍率×0.75=1.375→显示 1.38）');
A(simSkill('腐烂之母') && simSkill('腐烂之母').tier === 3 && simSkill('腐烂之母').triggerChance === 0.2 && simSkill('腐烂之母').damageMultiplier === 1.5,
  '终形态腐烂之母：III 满档（原值）');
A(simSkill('腐烂之母·异变') && simSkill('腐烂之母·异变').tier === 3, '变异终形态剥后缀继承满档');
A(simSkill('腐界母神') && simSkill('腐界母神').tier === 3 && simSkill('腐界母神').id === 'corrosion-spit', '神级宠腐界母神：III 满档');
A(simSkill({ name: '腐沼兽', evolveStage: 2 }).damageMultiplier === 1.25 && simSkill({ name: '腐沼兽', evolveStage: 4 }).damageMultiplier === 1.38,
  '带阶段的宠物对象按 evolveStage 定档（2→I、4→II）');
A(vm.runInContext('Config.pet.evolution.skillOf("腐界母神").tier', ctx) === 3, 'config.skillOf：神级宠满档（客户端/宠物页口径）');
A(vm.runInContext('Config.pet.evolution.skillOf({name:"腐沼兽",evolveStage:2}).tier', ctx) === 1, 'config.skillOf：一阶 I 档');
A(vm.runInContext('Config.pet.evolution.skillOf("莱姆")', ctx) === null, 'config.skillOf：查无此名 → 无技能');
ctx.Battle.selectArea('test-area');
ctx.Battle.startAutoBattle(() => {});
A(ctx.Battle.state.activeSkill?.id === 'corrosion-spit', 'Lv60 腐烂之母在开战时解锁腐蚀喷吐');
A(ctx.Battle.useActiveSkill() === true && ctx.Battle.state.skillQueued, '点击主动技能只排队，不抢占行动条');
const hpBefore = ctx.Battle.state.enemy.hp;
// 2026-09-09 递减对抗：普攻 = atk²/(atk+def)；技能 = 普攻 + floor(普攻 × (倍率−1))，此处 1.5 倍 ≡ floor(普攻 × 1.5)
const _pa = ctx.Battle.state.pet.atk, _ed = ctx.Battle.state.enemy.def;
const expectedDamage = Math.floor(Math.round(_pa * _pa / (_pa + _ed)) * 1.5);
const advancePetTurn = () => { for (let i = 0; i < 13; i++) fightTick(); };
advancePetTurn();
A(ctx.Battle.state.skillQueued === false && ctx.Battle.state.skillCooldown === 3, '下一次我方行动释放技能并进入 3 回合冷却');
A(ctx.Battle.state.enemy.hp === hpBefore - expectedDamage, '腐蚀喷吐按 150% 普攻伤害结算');
advancePetTurn(); advancePetTurn(); advancePetTurn();
A(ctx.Battle.state.skillCooldown === 0, '冷却按三次后续我方行动递减至零');
ctx.Battle.stopAutoBattle();
console.log('ALL PET SKILL TESTS PASSED');
