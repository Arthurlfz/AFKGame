/* ============================================================
 * equipment_simulator.js —— 装备强度模拟器（2026-09-06，手册 2.2 / 4.6）
 * 用途：模拟「胚子 / 适度打造 / 毕业打造」三档玩家在每张图的实际 atk/hp/def，
 *       供怪物数值校准与 vtest_enemy_balance 使用。禁止再用 atk×1.3 拍脑袋。
 * 原理：直接在 vm 桩里加载真实 config.js + equipment.js + pet.js，
 *       按图档/底材/稀有度/词缀权重大量采样生成整身 12 部位装备，再走 Pet.getStats 出真实属性。
 * 三档定义（手册 2.2）：
 *   poor   贫民：白蓝装 + 不打造（白 60% / 蓝 40%，底材按图档 roll）
 *   geared 正常：蓝金装 + 适度打造（按该图 rarityWeightsByTier 真实分布 roll）
 *   maxed  毕业：金装全 T1 满值 + 底材 T1（打造理论上限）
 * 用法：
 *   const SIM = require('./equipment_simulator');
 *   SIM.simulate(10, 57, 5.5, 'geared')  → { atk, hp, def }  （图10、Lv57、成长5.5）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');

function buildCtx() {
  const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('../js/equipment/equipment.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('../js/pet/pet.js', 'utf8'), ctx);
  return ctx;
}
const CTX = buildCtx();
const C = code => vm.runInContext(code, CTX);

// 按权重表抽 key（table: {key: weight}）
function rollKey(table) {
  const entries = Object.entries(table || {});
  const total = entries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) { r -= (Number(v) || 0); if (r < 0) return k; }
  return entries.length ? entries[entries.length - 1][0] : null;
}

// 生成一件装备（mode 决定档位）
function makeEquip(mode, tier, ilvl) {
  const rw = CTX.Config.equipment.rarityWeightsByTier[tier] || { white: 60, blue: 40, gold: 0 };
  let rarityId, matTier;
  if (mode === 'poor') {
    rarityId = Math.random() < 0.6 ? 'white' : 'blue';          // 贫民：白蓝装，不打造
    matTier = Number(rollKey(CTX.Config.equipment.materialTierWeights[tier])) || 3;
  } else if (mode === 'geared') {
    rarityId = rollKey(rw);                                      // 正常：该图真实稀有度分布
    matTier = Number(rollKey(CTX.Config.equipment.materialTierWeights[tier])) || 3;
  } else {                                                       // maxed 毕业：金装 + 底材 T1
    rarityId = 'gold';
    matTier = 1;
  }
  const rarity = CTX.Config.equipment.rarities.find(r => r.id === rarityId);
  const eq = CTX.Equipment.generateEquipment(rarity, tier, matTier, ilvl);
  if (mode === 'maxed') {
    // 打造上限：所有词缀 T1 + 满值（区间 max），模拟「神圣石/重铸刷到毕业」
    for (const bucket of ['prefix', 'suffix']) {
      for (const a of (eq.affixes[bucket] || [])) {
        if (a.base) continue;
        a.tier = 1;
        const range = CTX.Equipment.affixRange(a);
        a.value = range ? range.max : a.value;
      }
    }
  }
  return eq;
}

// 采样：mode 档玩家在 tier 图（等级 lv、成长 growth）的实际属性
function simulateOnce(mode, tier, lv, growth) {
  const slots = C('Equipment.SLOTS');
  const gear = {};
  for (const slot of slots) gear[slot] = makeEquip(mode, tier, lv);
  // createPet(name, icon, growth, baseHp, baseAtk, baseDef, baseSpd, lineId)
  // 参考玩家 = 均衡宠腐噜兽的基础值（与 vtest_pet_balance 的基准一致）
  const pet = C(`Pet.createPet('腐噜兽','',${growth},110,22,11,80,'腐噜兽')`);
  pet.level = lv;
  pet.growth = growth;
  pet.equipment = gear;
  pet.traits = [];
  CTX.__simPet = pet;
  const s = C('JSON.stringify(Pet.getStats(globalThis.__simPet))');
  return JSON.parse(s);
}

// 多次采样取中位数（抗随机波动）
function median(arr) { const a = arr.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function simulate(tier, lv, growth, mode, trials) {
  trials = trials || 120;
  const atks = [], hps = [], defs = [];
  for (let i = 0; i < trials; i++) {
    const s = simulateOnce(mode, tier, lv, growth);
    atks.push(s.atk); hps.push(s.hp); defs.push(s.def);
  }
  return { atk: Math.round(median(atks)), hp: Math.round(median(hps)), def: Math.round(median(defs)) };
}

module.exports = { simulate, rollKey };
