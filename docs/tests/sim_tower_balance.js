/* ============================================================
 * sim_tower_balance.js —— 通天塔难度校准（一次性脚本，数值定稿后删除）
 * 2026-09-10 v3：怪改「Lv60 起步、每层提升」+ 全部怪会技能 + 属性加强后重校。
 *
 * 与 v2 的两个关键改进：
 *  1. **直接调 ctx.TowerEngine.mobEnemyStats()** 造怪，不再自己复制一套缩放公式
 *     （v2 的副本已经和引擎漂移过：引擎加了 mobsPerFloor/技能，脚本没跟上 → 校准偏软）。
 *  2. 技能会真实进入模拟（battle-sim.mjs 已同步塔怪技能），所以量到的是"真难度"。
 *
 * 验收区间（用户拍板）：低档 ~6 层 / 中档 ≈20 层（上不到顶）/ 满配（涅槃5）白图能通、剩血 10~30%
 * 跑法：cd docs/tests && node sim_tower_balance.js [runs] [--combo=per:hpK]
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ARGS = process.argv.slice(2);
const RUNS = Number(ARGS.find(a => /^\d+$/.test(a))) || 12;
const FIXED = (ARGS.find(a => /^--combo=/.test(a)) || '').split('=')[1] || '';

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
function lcg(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildCtx() {
  const ctx = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: {}, location: { href: 'http://x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    Math: Object.create(Math)
  };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['../js/core/config.js', '../js/pet/enemy-data.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
                   '../js/core/battle-session.js', '../js/tower/tower-config.js', '../js/tower/tower-affix.js', '../js/tower/tower-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  }
  return ctx;
}
/* 真造一套 12 件金装（图 10 档 / 底材 T5 / ilvl 100）——不用代理点数 */
function rollGearSet(ctx) {
  const E = ctx.Equipment;
  const gold = (ctx.Config.equipment.rarities || []).find(r => r.id === 'gold') || (ctx.Config.equipment.rarities || [])[0];
  const eq = {};
  let guard = 0;
  while (Object.keys(eq).length < 12 && guard++ < 4000) {
    const it = E.generateEquipment(gold, 10, 5, 100);
    if (!it || !it.slot || eq[it.slot]) continue;
    eq[it.slot] = it;
  }
  return eq;
}
function buildProfiles(ctx) {
  const P = ctx.Config.pet;
  const god = (P.godPets.list || []).find(g => g.name === '腐界母神');
  const fake = '腐界母神';
  if (!P.starters.find(s => s.name === fake)) {
    P.starters.push({ name: fake, growth: 5, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, statCoeff: god.statCoeff });
  }
  const list = [
    { key: '低档·成长30裸装', pet: { name: '腐烂之母', lineId: '腐噜兽', level: 60, growth: 30, baseHp: 110, baseAtk: 22, baseDef: 11, baseSpd: 80 }, gear: false },
    { key: '中档·成长100+12金装', pet: { name: '腐烂之母', lineId: '腐噜兽', level: 60, growth: 100, baseHp: 110, baseAtk: 22, baseDef: 11, baseSpd: 80 }, gear: true },
    { key: '涅槃1', pet: { name: god.name, lineId: fake, level: 60, growth: 150, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, baseSpd: god.speed }, gear: true },
    { key: '涅槃3', pet: { name: god.name, lineId: fake, level: 60, growth: 250, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, baseSpd: god.speed }, gear: true },
    { key: '涅槃5·满配', pet: { name: god.name, lineId: fake, level: 60, growth: 350, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, baseSpd: god.speed }, gear: true }
  ];
  return list;
}
function statsOf(SIM, ctx, profile) {
  if (profile.gear && !profile._equip) profile._equip = rollGearSet(ctx);
  const pet = profile.gear ? Object.assign({}, profile.pet, { equipment: profile._equip }) : profile.pet;
  return Object.assign({}, SIM.petStats(pet, ctx.Config));
}
function runProfile(SIM, ctx, TC, profiles, runs) {
  const per = Number(TC.mobsPerFloor) || 1;
  const out = [];
  for (const p of profiles) {
    const stats = statsOf(SIM, ctx, p);
    const reached = [], hpPct = [];
    for (let r = 0; r < runs; r++) {
      let hp = stats.hp, best = 0, dead = false;
      for (let f = 1; f <= TC.floors && !dead; f++) {
        for (let m = 1; m <= per; m++) {
          const en = ctx.TowerEngine.mobEnemyStats(f, m, null);   // ← 与引擎同源
          const cfg = ctx.Config;
          cfg.battle.areaEnemyStats['tower-sim'] = { hp: en.hp, atk: en.atk, def: en.def };
          const area = { id: 'tower-sim', levelRange: [en.level, en.level], difficulty: 1, enemyMult: 1 };
          const res = SIM.simulateFight({ pet: p.pet, stats, area, enemyData: en, config: cfg, rnd: lcg(7919 * (r + 1) + f * 31 + m), curHp: hp });
          if (!res.win) { hp = 0; dead = true; break; }
          hp = res.petHpLeft;
          if (hp <= 0) { dead = true; break; }
        }
        if (!dead) best = f;
      }
      reached.push(best); hpPct.push(hp / stats.hp * 100);
    }
    reached.sort((a, b) => a - b);
    const cleared = reached.filter(x => x >= TC.floors).length;
    const clearHp = hpPct.filter((_, i) => reached[i] >= TC.floors).sort((a, b) => a - b);
    out.push({
      key: p.key, stats,
      median: reached[Math.floor(reached.length / 2)],
      p10: reached[Math.floor(reached.length * 0.1)],
      p90: reached[Math.floor((reached.length - 1) * 0.9)],
      clearRate: cleared / reached.length,
      clearHpMedian: clearHp.length ? clearHp[Math.floor(clearHp.length / 2)] : null
    });
  }
  return out;
}

(async () => {
  const ctx = buildCtx();
  const SIM = await import('../js/core/battle-sim.mjs');
  const TC = ctx.Config.tower;
  const profiles = buildProfiles(ctx);
  const baseHp = TC.baseStats.hp;
  const lv1 = ctx.TowerEngine.mobEnemyStats(1, 1, null), lv30 = ctx.TowerEngine.mobEnemyStats(30, 5, null);
  console.log(`塔怪：第1层 Lv${lv1.level}（血 ${lv1.hp} 攻 ${lv1.atk}） → 第30层守卫 Lv${lv30.level}（血 ${lv30.hp} 攻 ${lv30.atk}）`);
  console.log(`技能：杂兵「${lv1._towerSkillName || '—'}」/ 守卫「${lv30._towerSkillName || '—'}」  ·  baseStats.hp=${baseHp}\n`);

  /* 关键结构：旧曲线「怪等级 10→100」里，等级爬升贡献了 10 倍强度（第1层 0.10 → 第30层 1.00），
   * 这正是第 1 层很软的原因。改 Lv60→120 后等级只贡献 2 倍（0.50→1.00），
   * 缺的 5 倍必须靠【起点更低 + 每层更陡】补回来，否则裸装玩家第 1 层就死（用户自己的宠就在这一档）。
   * 所以下面扫的是 start × perFloor（hp 先固定 ×1.0）。 */
  const combos = FIXED
    ? [FIXED.split(':').map(Number)]
    : [[0.08, 0.16, 0.85], [0.08, 0.16, 0.72], [0.08, 0.15, 0.85], [0.07, 0.155, 0.85]];

  for (const [start, per, k] of combos) {
    TC.curve.difficultyStart = start;
    TC.curve.difficultyPerFloor = per;
    const savedHp = TC.baseStats.hp;
    TC.baseStats.hp = Math.round(baseHp * k);
    const res = runProfile(SIM, ctx, TC, profiles, RUNS);
    const low = res[0], mid = res[1], n5 = res[4];
    const ok = low.median >= 4 && low.median <= 9 && mid.median >= 17 && mid.median <= 22 && n5.clearRate >= 0.45
      && n5.clearHpMedian != null && n5.clearHpMedian >= 12 && n5.clearHpMedian <= 38;
    console.log(`${ok ? '★' : ' '} start=${start} per=${per} hp×${k}（hp=${TC.baseStats.hp}）`);
    for (const p of res) {
      const hpTxt = p.clearHpMedian == null ? '—' : p.clearHpMedian.toFixed(1) + '%';
      console.log(`     ${p.key.padEnd(20)} | 中位 ${String(p.median).padStart(2)} 层 (p10 ${p.p10}/p90 ${p.p90}) | 通关率 ${(p.clearRate * 100).toFixed(0)}% | 通关剩血 ${hpTxt}`);
    }
    TC.baseStats.hp = savedHp;
  }
  console.log(`\n当前 config：per=${TC.curve.difficultyPerFloor} baseStats.hp=${baseHp}（上面 ★ 是达标的组合）`);
})();
