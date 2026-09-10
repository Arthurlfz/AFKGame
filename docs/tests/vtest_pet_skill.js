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
const simSkill = name => ctx.BattleSim.skillOf({ name }, ctx.Config);
A(simSkill('腐噜兽') === null, '模拟器：一阶基宠无主动技能');
A(simSkill('腐沼兽') === null, '模拟器：二阶宠无主动技能（旧版误给满威力技能）');
A(simSkill('腐沼王') === null, '模拟器：三阶淬体宠无主动技能');
A(simSkill('腐烂之母') && simSkill('腐烂之母').id === 'corrosion-spit', '模拟器：终形态解锁主动技能');
A(simSkill('腐烂之母·异变') && simSkill('腐烂之母·异变').id === 'corrosion-spit', '模拟器：变异终形态剥后缀继承技能');
A(simSkill('血月魔狐') && simSkill('血月魔狐').triggerChance === 0.13, '模拟器：技能数值原样返回（无档位缩放）');
// 神级宠（2026-09-11 用户拍板）：继承其 sprite 立绘终形态的主动技，满威力
A(simSkill('腐界母神') && simSkill('腐界母神').id === 'corrosion-spit', '模拟器：神级宠腐界母神继承腐蚀喷吐');
A(simSkill('血月神狐') && simSkill('血月神狐').id === 'blood-moon-slash', '模拟器：神级宠血月神狐继承血月斩');
A(vm.runInContext('Config.pet.evolution.skillOf("腐界母神").id', ctx) === 'corrosion-spit', 'config.skillOf：神级宠继承线主形态技能（客户端/宠物页口径）');
A(vm.runInContext('Config.pet.evolution.skillOf("莱姆")', ctx) === null, 'config.skillOf：普通非终形态宠无技能');
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
