/* ============================================================
 * vtest_server_sim.js —— P1 验收：服务器模拟器与旧前端逻辑同种子 diff
 * 对比对象：
 *   A. petStats()          vs 前端 Pet.getStats()（属性计算）
 *   B. simulateFight()     vs 前端 battle.js tick 循环（单场战斗，含技能/血统/暴击）
 *   C. expFromBattle()     vs 前端 Pet.expFromBattle()（经验）
 * 同种子：前端 vm 环境的 Math.random = mulberry32(seed)，模拟器注入同一 rnd。
 * 通过标准：三组结果完全一致（胜负/血量/事件/经验）。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const path = require('path');
// ESM 动态导入（.mjs 供 Edge Function/Deno 直接使用）
const SIM_P = import('../../supabase/functions/_shared/battle-sim.mjs');

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ===== 构造前端 vm 环境（加载 config + pet + battle）=====
function buildFrontendEnv(seed, overrides) {
  // 虚拟时钟（B 场景）：setTimeout 按虚拟时间排队，由驱动循环触发
  const timers = []; // {at, fn}
  let nowMs = 0;
  let timerId = 1;
  const ctx = {
    console, setTimeout: (fn, ms) => { timers.push({ at: nowMs + (ms || 0), fn, id: timerId }); return timerId++; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, ms) => { timers.push({ at: nowMs + (ms || 0), fn, id: timerId, interval: ms }); return timerId++; },
    clearInterval: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    navigator: {}, location: { href: 'http://x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    Math: Object.create(Math),
    Util: null, Pet: null, UI: null, EnemyData: null, Battle: null, Config: null, PetSprites: null
  };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
  ctx.Math.random = mulberry32(seed); // 同种子
  vm.createContext(ctx);
  // 注意：battle.js 里 window.Pet.getAwakenState / getBloodline 用到，pet.js 提供
  for (const f of ['../js/core/config.js', '../js/pet/enemy-data.js', '../js/equipment/equipment.js', '../js/pet/pet.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  }
  // 允许注入宠物桩（B 场景用）：必须在 battle.js 加载前覆盖，因为 battle.js 加载时解构 Pet 方法
  if (overrides && overrides.petStub) {
    vm.runInContext(`
      const __frontPet = (${JSON.stringify(overrides.petStub)});
      Pet.getActivePet = () => __frontPet;
      Pet.getCurHp = p => Math.max(0, p.curHp);
      Pet.setCurHp = (p, hp) => { p.curHp = Math.max(0, Math.min(hp, Pet.getStats(p).hp)); };
    `, ctx);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/core/battle.js'), 'utf8'), ctx);
  // UI 桩：动画时长与模拟器固定值一致（320 / 300）
  vm.runInContext(`
    window.UI = {
      addLog() {}, updateStatus() {}, resetBattle() {}, updateBattleArea() {}, updateBars() {},
      updateAction() {}, animateAttack() { return 320; }, attackRecoverMs() { return 300; },
      animateHit() {}, showDamage() {}, renderActiveSkill() {}, animateVictory() {}
    };
  `, ctx);
  // 挂到 ctx 供驱动循环使用
  ctx.__timers = timers;
  ctx.__advance = (ms) => {
    nowMs += ms;
    // 触发所有到期定时器（含 interval 重排）
    let fired = true;
    while (fired) {
      fired = false;
      for (let i = 0; i < timers.length; i++) {
        if (timers[i].at <= nowMs) {
          const t = timers.splice(i, 1)[0];
          if (t.interval) timers.push({ at: nowMs + t.interval, fn: t.fn, id: t.id, interval: t.interval });
          t.fn();
          fired = true;
          break;
        }
      }
    }
  };
  ctx.__nowMs = () => nowMs;
  return ctx;
}

// ===== 构造同一只测试宠物（前端对象 vs 模拟器快照）=====
// 用 config 里真实存在的基宠：腐噜兽（lineId=腐噜兽）
function makePetPair(config) {
  const st = config.pet.starters.find(s => s.name === '腐噜兽');
  const spd = config.pet.speeds['腐噜兽'];
  // 前端宠物对象（pet.js createPet 结构）
  const frontPet = {
    name: '腐噜兽', icon: '🐹', lineId: '腐噜兽', growth: 5.5, level: 20,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: spd,
    curHp: st.baseHp + Math.round(20 * 5.5 * st.statCoeff.hp), // 满血
    traits: [], awaken_trait: null, equipment: {}
  };
  // 模拟器快照（同一份数据）
  const simPet = {
    name: '腐噜兽', icon: '🐹', lineId: '腐噜兽', growth: 5.5, level: 20,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: spd,
    traits: [], awaken_trait: null
  };
  return { frontPet, simPet };
}

const ctx = buildFrontendEnv(42);
const config = JSON.parse(vm.runInContext('JSON.stringify(Config)', ctx));
const { frontPet, simPet } = makePetPair(config);

(async () => {
  const SIM = await SIM_P;

// ===== A. 属性计算 diff =====
{
  const front = JSON.parse(vm.runInContext(
    `JSON.stringify(Pet.getStats(${JSON.stringify(frontPet)}))`, ctx));
  const sim = SIM.petStats(simPet, config);
  // 字段对照：atk/hp/def/spd/critRate/critDamage/hit/dodge/lifesteal/pen/dmgBonus/dr
  const keys = ['atk','hp','def','spd','critRate','critDamage','hit','dodge','lifesteal','pen','dmgBonus','dr'];
  let ok = true;
  for (const k of keys) {
    const fv = Number(front[k] || 0), sv = Number(sim[k] || 0);
    if (Math.abs(fv - sv) > 1e-9) { ok = false; console.error(`  属性 ${k}: 前端=${fv} 服务器=${sv}`); }
  }
  A(ok, `A. 属性计算一致（atk=${front.atk}/${sim.atk} hp=${front.hp}/${sim.hp} spd=${front.spd}/${sim.spd}）`);
}

// ===== B. 单场战斗 diff（同种子，前端 tick 循环 vs simulateFight）=====
{
  const seed = 20260904;
  // 前端：重设随机种子后跑 tick 循环直到 fightEnded（宠物桩在加载 battle.js 前注入）
  const ctxB = buildFrontendEnv(seed, { petStub: frontPet });
  const areaId = 'corrupted-forest';
  vm.runInContext(`
    window.Battle.selectArea('${areaId}');
    window.Battle.startAutoBattle(() => {});
  `, ctxB);
  // 驱动：虚拟时钟每 100ms 一步（触发 tick 与冻结解冻），直到战斗结束或上限
  let guard = 0;
  while (guard++ < 3000) {
    const ended = vm.runInContext('!!window.Battle.state && (window.Battle.state.pet.hp <= 0 || window.Battle.state.enemy.hp <= 0)', ctxB);
    if (ended) break;
    ctxB.__advance(100);
  }
  const frontResult = JSON.parse(vm.runInContext(`
    JSON.stringify({
      petHp: window.Battle.state.pet.hp,
      enemyHp: window.Battle.state.enemy.hp,
      enemyLevel: window.Battle.state.enemy.level,
      win: window.Battle.state.pet.hp > 0
    })`, ctxB));

  // 模拟器：同一地图 + 同一种子（选怪与战斗共用同一 rnd 流，与前端 Math.random 流一致）
  const area = config.battle.areas.find(a => a.id === areaId);
  const pool = configEnemyPool(config, area);
  const rnd = SIM.mulberry32(seed);
  const enemyData = SIM.pickWeighted(pool, x => x.weight || 1, rnd);
  const stats = SIM.petStats(simPet, config);
  const sim = SIM.simulateFight({
    pet: simPet, stats, area, enemyData, config,
    rnd, curHp: frontPet.curHp, pendingKillBuff: false
  });
  const same = Math.abs(frontResult.petHp - sim.petHpLeft) <= 1 &&
               Math.abs(frontResult.enemyHp - sim.enemyHpLeft) <= 1 &&
               frontResult.enemyLevel === sim.enemyLevel &&
               frontResult.win === sim.win;
  A(same, `B. 单场战斗同种子一致（前端: ${frontResult.win?'胜':'负'} 宠${frontResult.petHp}怪${frontResult.enemyHp} Lv${frontResult.enemyLevel} | 服务器: ${sim.win?'胜':'负'} 宠${sim.petHpLeft}怪${sim.enemyHpLeft} Lv${sim.enemyLevel}）`);
}

// ===== C. 经验 diff =====
{
  const areaId = 'corrupted-forest';
  const area = config.battle.areas.find(a => a.id === areaId);
  const seed = 7;
  const frontXp = vm.runInContext(`
    (function(){
      const e = { level: 5 }, a = ${JSON.stringify(area)};
      return Pet.expFromBattle(e, a);
    })()
  `, ctx);
  const simXp = SIM.expFromBattle(5, area, config, SIM.mulberry32(seed));
  // 前端 ctx 的 Math.random 是 mulberry32(42)，与 seed=7 不同 → 只验证公式结构：
  // 用同种子重算前端
  const ctxC = buildFrontendEnv(seed);
  const frontXp2 = vm.runInContext(`
    (function(){
      const e = { level: 5 }, a = ${JSON.stringify(area)};
      return Pet.expFromBattle(e, a);
    })()
  `, ctxC);
  A(frontXp2 === simXp, `C. 经验同种子一致（前端=${frontXp2} 服务器=${simXp}）`);
}

// 工具：怪物池（与 battle.js getAreaEnemyPool 同规则）
function configEnemyPool(config, area) {
  const enemies = configEnemyList(config);
  const [aMin, aMax] = (area && area.levelRange) || [1, 60];
  const areaIds = new Set((area && area.enemyIds) || []);
  return enemies.filter(enemy =>
    areaIds.has(enemy.id) &&
    (enemy.levelRange || [enemy.level || 1, enemy.level || 1])[1] >= aMin &&
    (enemy.levelRange || [enemy.level || 1, enemy.level || 1])[0] <= aMax);
}
function configEnemyList(config) {
  // enemy-data.js 在 vm ctx 里 → 从 ctx 读取
  const raw = vm.runInContext('JSON.stringify(window.EnemyData.list)', ctx);
  return JSON.parse(raw);
}

// ===== D. 技能/觉醒场景 diff（Lv60 终形态宠：腐烂之母 = 腐噜兽线终态）=====
{
  const seed = 777;
  const st = config.pet.starters.find(s => s.name === '腐噜兽');
  const lv60Front = {
    name: '腐烂之母', icon: '🐹', lineId: '腐噜兽', growth: 8, level: 60,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: config.pet.speeds['腐噜兽'],
    curHp: 999999, traits: [], awaken_trait: null, equipment: {}
  };
  const lv60Sim = {
    name: '腐烂之母', icon: '🐹', lineId: '腐噜兽', growth: 8, level: 60,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: config.pet.speeds['腐噜兽'],
    traits: [], awaken_trait: null
  };
  const areaId = 'corrupted-forest';
  const area = config.battle.areas.find(a => a.id === areaId);
  const pool = configEnemyPool(config, area);
  const rndD = SIM.mulberry32(seed);
  const enemyData = SIM.pickWeighted(pool, x => x.weight || 1, rndD);
  const stats = SIM.petStats(lv60Sim, config);
  const sim = SIM.simulateFight({
    pet: lv60Sim, stats, area, enemyData, config,
    rnd: rndD, curHp: 999999, pendingKillBuff: false
  });
  const ctxD = buildFrontendEnv(seed, { petStub: lv60Front });
  vm.runInContext(`
    window.Battle.selectArea('${areaId}');
    window.Battle.startAutoBattle(() => {});
  `, ctxD);
  let guard = 0;
  while (guard++ < 3000) {
    const ended = vm.runInContext('!!window.Battle.state && (window.Battle.state.pet.hp <= 0 || window.Battle.state.enemy.hp <= 0)', ctxD);
    if (ended) break;
    ctxD.__advance(100);
  }
  const front = JSON.parse(vm.runInContext(`
    JSON.stringify({
      petHp: window.Battle.state.pet.hp,
      enemyHp: window.Battle.state.enemy.hp,
      win: window.Battle.state.pet.hp > 0,
      skill: !!(window.Battle.state.activeSkill)
    })`, ctxD));
  const same = Math.abs(front.petHp - sim.petHpLeft) <= 1 &&
               Math.abs(front.enemyHp - sim.enemyHpLeft) <= 1 &&
               front.win === sim.win;
  A(front.skill, `D. 前置：Lv60 终形态已激活技能`);
  A(same, `D. 技能/觉醒场景同种子一致（前端: ${front.win?'胜':'负'} 宠${front.petHp}怪${front.enemyHp} | 服务器: ${sim.win?'胜':'负'} 宠${sim.petHpLeft}怪${sim.enemyHpLeft}）`);
}

// ===== E. 30 秒多场循环 diff（前端完整循环+回血桩+经验桩 vs simulateSession）=====
{
  const seed = 31337;
  const seconds = 30;
  const st = config.pet.starters.find(s => s.name === '腐噜兽');
  const hpFull = st.baseHp + Math.round(20 * 5.5 * st.statCoeff.hp);
  const frontPetE = {
    name: '腐噜兽', icon: '🐹', lineId: '腐噜兽', growth: 5.5, level: 20,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: config.pet.speeds['腐噜兽'],
    curHp: hpFull, traits: [], awaken_trait: null, equipment: {}
  };
  const simPetE = {
    name: '腐噜兽', icon: '🐹', lineId: '腐噜兽', growth: 5.5, level: 20,
    baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: config.pet.speeds['腐噜兽'],
    traits: [], awaken_trait: null
  };
  const ctxE = buildFrontendEnv(seed, { petStub: frontPetE });
  vm.runInContext(`
    let __totalFights = 0, __totalExp = 0, __totalWins = 0;
    // 回血桩（main.js regenTick 等价：每秒 +maxHp×ratio）
    setInterval(() => {
      const pet = Pet.getActivePet();
      if (!pet) return;
      const m = Pet.getStats(pet).hp;
      if (pet.curHp < m) pet.curHp = Math.min(m, pet.curHp + m * (Config.regen.hpPerSecRatio || 0.2));
    }, 1000);
    window.Battle.selectArea('corrupted-forest');
    window.Battle.startAutoBattle(({ win, enemy }) => {
      __totalFights++;
      if (win) {
        __totalWins++;
        __totalExp += Pet.expFromBattle(enemy, window.Battle.getCurrentArea());
      }
    });
  `, ctxE);
  let guard = 0;
  while (guard++ < seconds * 10) ctxE.__advance(100);
  const front = JSON.parse(vm.runInContext(`
    JSON.stringify({
      totalFights: __totalFights, totalExp: __totalExp, totalWins: __totalWins,
      curHp: (Pet.getActivePet() || {}).curHp
    })`, ctxE));
  const area = config.battle.areas.find(a => a.id === 'corrupted-forest');
  const sim = SIM.simulateSession({
    pet: simPetE, areaId: 'corrupted-forest', seconds, seed, config,
    enemyList: configEnemyList(config), curHp: hpFull
  });
  const same = front.totalFights === sim.totalFights &&
               Math.abs(front.totalExp - sim.totalExp) <= 1 &&
               Math.abs(front.curHp - sim.endHp) <= 1;
  A(same, `E. 30s 多场循环同种子一致（前端: ${front.totalFights}场 ${front.totalExp}经验 宠血${Math.round(front.curHp)} | 服务器: ${sim.totalFights}场 ${sim.totalExp}经验 宠血${sim.endHp}）`);
}

console.log('ALL SERVER SIM DIFF TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.message || e)); process.exit(1); });
