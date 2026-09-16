/* ============================================================
 * gen_server_config.js —— 从前端 config.js + enemy-data.js 提取服务器快照
 * 输出：
 *   supabase/functions/_shared/config-server.mjs    —— 战斗数值（纯数据，函数已剔除）
 *   supabase/functions/_shared/enemy-data-server.mjs —— 怪物池
 * 用途：Edge Function 结算时使用与前端完全一致的数值来源。
 * 运行：node gen_server_config.js（会写上面两个文件）
 * 注意：config.js 里的函数（skillOf/formInfoOf 等）会被 JSON 化剔除，
 *       battle-sim.mjs 已自行实现这些函数逻辑，不需要函数本身。
 *
 * ⚠️ 这是个"手动重跑"的链路：改了 config.js 的战斗数值却忘了跑本脚本，
 *    普通玩家的服务端结算就会继续用旧数值（界面按新数值、结算按旧数值）。
 *    2026-09-16 起由 docs/tests/vtest_server_config_sync.js 守：现算结果与已生成文件
 *    逐字段对比，不一致直接报红。所以本文件把"提取逻辑"抽成函数并导出 —— 测试复用同一份，
 *    不再各写一套白名单（两份必然漂移）。
 * ============================================================ */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_MJS = path.join(__dirname, 'functions/_shared/config-server.mjs');
const ENEMY_MJS = path.join(__dirname, 'functions/_shared/enemy-data-server.mjs');

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}

/* 建一个能跑 config.js / trial-config.js / enemy-data.js 的 vm 上下文
 * （测试与生成共用同一份，避免加载方式漂移）。
 * ⚠️ trial-config.js 必须加载：Config.resourceTrials 不在 config.js 里，而是系统专属配置
 *   放在 docs/js/trial/trial-config.js（fos-balance 的「数值按系统拆文件」约定）。
 *   早前只加载 config.js → 提取出的 serverConfig 根本没有 resourceTrials →
 *   resource-trial Edge Function 拿到 `{}`，试炼的路线与奖励判定全部落空（2026-09-16 发现）。 */
function loadCtx() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
  vm.createContext(ctx);
  ['docs/js/core/config.js', 'docs/js/trial/trial-config.js', 'docs/js/pet/enemy-data.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  });
  return ctx;
}

// 只提取战斗结算需要的段（白名单，防把无关 UI 配置带进服务器）
function buildServerConfig(C) {
  return {
    pet: {
      starters: C.pet.starters,
      statCoeff: C.pet.statCoeff,
      petProfiles: C.pet.petProfiles,
      defaultPetProfile: C.pet.defaultPetProfile,
      speeds: C.pet.speeds,
      legacyBase: C.pet.legacyBase,
      maxLevel: C.pet.maxLevel,
      /* ⚠️ 2026-09-16：`expPool`（满级经验池 / 凝魂晶石）已从 config 删除 —— 白名单里也要同步删掉。
       * 白名单是**按字段名逐条挑**的：配置删了、这里没删 ⇒ 现算会产出 `expPool: undefined`（键在、值没），
       * 而 JSON 序列化会把 undefined 键丢掉 → `vtest_server_config_sync` 报「只在现算里存在」。
       * 以后从 config 删任何字段，记得来这里同步删一行。 */
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
}

function buildEnemyList(ctx) {
  return JSON.parse(vm.runInContext('JSON.stringify(window.EnemyData.list)', ctx));
}

function buildConfigMjs(C) {
  const json = JSON.stringify(buildServerConfig(C), null, 2);
  return '// 由 gen_server_config.js 自动生成（勿手改）—— 与 docs/js/core/config.js 战斗数值同源\n' +
    '// 生成时间：' + new Date().toISOString() + '\n' +
    'const serverConfig = ' + json + ';\n' +
    'export default serverConfig;\n';
}

function buildEnemyMjs(ctx) {
  const json = vm.runInContext('JSON.stringify(window.EnemyData.list)', ctx);
  return '// 由 gen_server_config.js 自动生成（勿手改）—— 与 docs/js/pet/enemy-data.js 同源\n' +
    '// 生成时间：' + new Date().toISOString() + '\n' +
    'const enemyList = ' + json + ';\n' +
    'export default enemyList;\n';
}

function writeFiles() {
  const ctx = loadCtx();
  const C = vm.runInContext('Config', ctx);
  const mjs = buildConfigMjs(C);
  fs.writeFileSync(CONFIG_MJS, mjs, 'utf8');
  console.log('OK: config-server.mjs (' + mjs.length + ' bytes)');
  const emjs = buildEnemyMjs(ctx);
  fs.writeFileSync(ENEMY_MJS, emjs, 'utf8');
  console.log('OK: enemy-data-server.mjs (' + emjs.length + ' bytes)');
}

if (require.main === module) writeFiles();

module.exports = {
  ROOT, CONFIG_MJS, ENEMY_MJS,
  loadCtx, buildServerConfig, buildEnemyList, buildConfigMjs, buildEnemyMjs, writeFiles
};
