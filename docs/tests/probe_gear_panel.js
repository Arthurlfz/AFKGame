/* ============================================================
 * probe_gear_panel.js —— 一次性探针：真实 12 件金装的面板分布
 * 目的：塔的难度校准原来用「金装代理值」（命中100/闪避50/暴击20%/吸血18%…）是拍的，
 *       这里用 Equipment.generateEquipment 真造 12 件（图 10 档 / 底材 T5 / ilvl 100）
 *       采样多套，打出攻/血/防/速/暴击/暴伤/命中/闪避/吸血/穿透/伤害加成/减伤的分布，
 *       再把「中位数那套」喂回塔的 sim，校准才站得住。
 * 跑法：cd docs/tests && node probe_gear_panel.js [sets]
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SETS = Number(process.argv[2]) || 200;

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
function buildCtx(seed) {
  const rnd = (() => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const ctx = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: {}, location: { href: 'http://x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    Math: Object.create(Math)
  };
  ctx.Math.random = rnd;
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['../js/core/config.js', '../js/equipment/equipment.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  }
  return ctx;
}

// 造满 12 个部位的一套金装
function rollSet(ctx) {
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

const KEYS = ['atk', 'hp', 'def', 'spd', 'critRate', 'critDamage', 'hit', 'dodge', 'lifesteal', 'pen', 'dmgBonus', 'dr'];
function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }
function report(label, rows) {
  console.log('── ' + label);
  for (const k of KEYS) {
    const vals = rows.map(r => r[k]).sort((a, b) => a - b);
    const f = v => (k === 'critRate' || k === 'critDamage' || k === 'lifesteal') ? (v * 100).toFixed(1) + '%' : Math.round(v);
    console.log(`   ${k.padEnd(11)} p10 ${String(f(pct(vals, 0.1))).padStart(7)} | 中位 ${String(f(pct(vals, 0.5))).padStart(7)} | p90 ${String(f(pct(vals, 0.9))).padStart(7)}`);
  }
}

(async () => {
  const ctx = buildCtx(20260910);
  const SIM = await import('../js/core/battle-sim.mjs');
  const P = ctx.Config.pet;
  const god = (P.godPets.list || []).find(g => g.name === '腐界母神');
  const fake = '腐界母神';
  if (!P.starters.find(s => s.name === fake)) {
    P.starters.push({ name: fake, growth: 5, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, statCoeff: god.statCoeff });
  }

  const petDefs = [
    { label: '低档·普通成长30·无装备', pet: { name: '腐烂之母', lineId: '腐噜兽', level: 60, growth: 30, baseHp: 110, baseAtk: 22, baseDef: 11, baseSpd: 80 }, gear: false },
    { label: '中档·普通成长100·12金装', pet: { name: '腐烂之母', lineId: '腐噜兽', level: 60, growth: 100, baseHp: 110, baseAtk: 22, baseDef: 11, baseSpd: 80 }, gear: true },
    { label: '满配·神级涅槃5(成长350)·12金装', pet: { name: god.name, lineId: fake, level: 60, growth: 350, baseHp: god.baseHp, baseAtk: god.baseAtk, baseDef: god.baseDef, baseSpd: god.speed }, gear: true }
  ];

  for (const d of petDefs) {
    const rows = [];
    let zero = null;
    for (let i = 0; i < SETS; i++) {
      const pet = Object.assign({}, d.pet);
      if (d.gear) pet.equipment = rollSet(ctx);
      const s = SIM.petStats(pet, ctx.Config);
      rows.push(s);
      if (!zero) zero = s;
    }
    report(d.label + `（样本 ${SETS} 套）`, rows);
    if (!d.gear) console.log('   （无装备，仅一行参考）');
    console.log('');
  }
  console.log('对比原「金装代理值」：命中 100 / 闪避 50 / 暴击 20% / 暴伤 190% / 吸血 18% / 速度 +20');
})();
