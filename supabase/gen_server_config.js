/* ============================================================
 * gen_server_config.js —— 从前端 config.js + enemy-data.js 提取服务器快照
 * 输出：
 *   supabase/functions/_shared/config-server.mjs    —— 战斗数值（纯数据，函数已剔除）
 *   supabase/functions/_shared/enemy-data-server.mjs —— 怪物池
 * 用途：Edge Function 结算时使用与前端完全一致的数值来源。
 * 运行：node gen_server_config.js
 * 注意：config.js 里的函数（skillOf/formInfoOf 等）会被 JSON 化剔除，
 *       battle-sim.mjs 已自行实现这些函数逻辑，不需要函数本身。
 * ============================================================ */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/core/config.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/pet/enemy-data.js'), 'utf8'), ctx);

const C = vm.runInContext('Config', ctx);

// 只提取战斗结算需要的段（白名单，防把无关 UI 配置带进服务器）
const serverConfig = {
  pet: {
    starters: C.pet.starters,
    statCoeff: C.pet.statCoeff,
    petProfiles: C.pet.petProfiles,
    defaultPetProfile: C.pet.defaultPetProfile,
    speeds: C.pet.speeds,
    legacyBase: C.pet.legacyBase,
    maxLevel: C.pet.maxLevel,
    expPool: C.pet.expPool,
    babyGrowth: C.pet.babyGrowth,
    // 神级宠（2026-09-06 手册 2.6）：battle-sim 需要按名字/线取 ×1.5 成长系数与速度
    godPets: {
      minGrowth: C.pet.godPets.minGrowth,
      list: C.pet.godPets.list
    },
    evolution: {
      maxEvolveTimes: C.pet.evolution.maxEvolveTimes,
      stages: C.pet.evolution.stages,
      tree: C.pet.evolution.tree,
      activeSkills: C.pet.evolution.activeSkills,
      skillTierScale: C.pet.evolution.skillTierScale
      // skillTierScale（2026-09-11）：技能档位缩放表，battle-sim skillOf 按阶段取档
    }
  },
  exp: C.exp,
  battle: {
    speedScale: C.battle.speedScale,
    areas: C.battle.areas,
    areaEnemyStats: C.battle.areaEnemyStats,
    typeMult: C.battle.typeMult,
    levelScaleClamp: C.battle.levelScaleClamp,
    critRate: C.battle.critRate,
    critMultiplier: C.battle.critMultiplier,
    stopHpRatio: C.battle.stopHpRatio,
    nextFightDelay: C.battle.nextFightDelay
  },
  regen: C.regen,
  // 装备（2026-09-11 甲）：服务端掉落装备需要它。equip-gen-server.mjs（由 gen_equip_gen.js
  // 从前端 equipment.js 抽取）读这一段的 rarities / affixIlvlGates / affixCountByIlvl /
  // 各属性 T 阶表 / baseTierMultipliers / slotAffixWeights 等。
  equipment: C.equipment,
  // 掉落（2026-09-11 甲）：挂机掉落从「服务端硬编码 18% 材料」改为读前端这一套单池。
  // 只带掉落需要的三段，不带 C.drop.quests（145 条任务，会让服务端配置白白胖几百 KB）。
  // ⚠️ 改了这里就等于改了玩家的实际产出速度 —— 调数值只动 config.drop.poolByStage。
  drop: {
    pool: C.drop.pool,
    poolByStage: C.drop.poolByStage,
    areaMaterials: C.drop.areaMaterials
  },
  petTraits: C.petTraits,
  traitHatch: C.traitHatch,
  bloodlinePassive: C.bloodlinePassive,
  awakenBonus: C.awakenBonus,
  awakenSkillDamage: C.awakenSkillDamage,
  // 资源试炼（2026-09-09 服务端正式化）：试炼的成败与奖励由服务器判定，
  // 必须与前端 Config.resourceTrials 同源 —— 改前端配置后重跑本脚本即可同步。
  resourceTrials: C.resourceTrials
};

const json = JSON.stringify(serverConfig, null, 2);
const mjs = `// 由 gen_server_config.js 自动生成（勿手改）—— 与 docs/js/core/config.js 战斗数值同源\n` +
  `// 生成时间：${new Date().toISOString()}\n` +
  `const serverConfig = ${json};\n` +
  `export default serverConfig;\n`;
fs.writeFileSync(path.join(ROOT, 'supabase/functions/_shared/config-server.mjs'), mjs, 'utf8');
console.log('OK: config-server.mjs (' + mjs.length + ' bytes)');

const enemyJson = vm.runInContext('JSON.stringify(window.EnemyData.list)', ctx);
const emjs = `// 由 gen_server_config.js 自动生成（勿手改）—— 与 docs/js/pet/enemy-data.js 同源\n` +
  `// 生成时间：${new Date().toISOString()}\n` +
  `const enemyList = ${enemyJson};\n` +
  `export default enemyList;\n`;
fs.writeFileSync(path.join(ROOT, 'supabase/functions/_shared/enemy-data-server.mjs'), emjs, 'utf8');
console.log('OK: enemy-data-server.mjs (' + emjs.length + ' bytes)');
