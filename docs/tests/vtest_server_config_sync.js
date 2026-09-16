/* ============================================================
 * vtest_server_config_sync.js —— 服务端配置快照与前端 config.js 同源
 *
 * 守什么（2026-09-16 立）：
 *   服务端结算（battle-settle / resource-trial）读的是 supabase/functions/_shared/config-server.mjs，
 *   而它是 supabase/gen_server_config.js **手动重跑**生成的。改了 config.js 的战斗数值却忘了重跑，
 *   就会出现「界面按新数值、结算按旧数值」—— 经验条与掉落对不上，且全程没有任何报错。
 *   本测试把"现算结果"与"已生成文件"逐字段比对，忘了重跑直接报红。
 *
 * 覆盖：config-server.mjs（战斗/掉落/装备/宠物数值）+ enemy-data-server.mjs（怪物池）
 * 运行：cd docs/tests && node vtest_server_config_sync.js
 * 修法：cd supabase && node gen_server_config.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const GEN = require('../../supabase/gen_server_config.js');

let fails = 0;
function assert(cond, msg) {
  if (cond) { console.log('✅ ' + msg); return; }
  fails++;
  console.error('❌ FAIL: ' + msg);
}

/* 从生成的 mjs 里取出内嵌的 JSON（只看数据，不看"生成时间"那行注释） */
function readEmbedded(file, name) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return undefined; }
  const re = new RegExp('const ' + name + ' = ([\\s\\S]*?);\\s*export default ' + name + ';');
  const m = src.match(re);
  if (!m) return undefined;
  try { return JSON.parse(m[1]); } catch (e) { return undefined; }
}

/* 逐字段差异（最多列 8 条，够定位就行）。a = 文件里的（旧），b = 现算的（新） */
function diffPaths(a, b) {
  const out = [];
  (function walk(x, y, p) {
    if (out.length >= 8) return;
    if (x === y) return;
    const tx = x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
    const ty = y === null ? 'null' : Array.isArray(y) ? 'array' : typeof y;
    if (tx !== ty) { out.push(p + ' 类型不同（文件 ' + tx + ' / 现算 ' + ty + '）'); return; }
    if (tx === 'array') {
      if (x.length !== y.length) { out.push(p + ' 长度不同（文件 ' + x.length + ' / 现算 ' + y.length + '）'); return; }
      for (let i = 0; i < x.length && out.length < 8; i++) walk(x[i], y[i], p + '[' + i + ']');
      return;
    }
    if (tx === 'object') {
      const keys = Array.from(new Set(Object.keys(x).concat(Object.keys(y))));
      keys.forEach(k => {
        if (out.length >= 8) return;
        if (!(k in x)) { out.push(p + '.' + k + ' 只在现算里存在'); return; }
        if (!(k in y)) { out.push(p + '.' + k + ' 只在文件里存在'); return; }
        walk(x[k], y[k], p + '.' + k);
      });
      return;
    }
    out.push(p + '：' + JSON.stringify(x) + ' → ' + JSON.stringify(y));
  })(a, b, '');
  return out;
}

/* 递归找函数：serverConfig 是要被 JSON.stringify 的，夹带函数就会被静默丢掉 */
function findFunctions(o, p, out) {
  if (o === null || typeof o !== 'object') return;
  Object.keys(o).forEach(k => {
    if (typeof o[k] === 'function') out.push(p + '.' + k);
    else findFunctions(o[k], p + '.' + k, out);
  });
}

console.log('—— config-server.mjs（战斗 / 掉落 / 装备 / 宠物数值） ——');

const ctx = GEN.loadCtx();
const C = ctx.Config;
const nowCfg = GEN.buildServerConfig(C);

const fnLeak = [];
findFunctions(nowCfg, '', fnLeak);
assert(fnLeak.length === 0, '提取出的服务端配置不含函数（夹带会被 JSON 丢掉；泄漏：' + (fnLeak.slice(0, 3).join(',') || '无') + '）');

const fileCfg = readEmbedded(GEN.CONFIG_MJS, 'serverConfig');
assert(fileCfg !== undefined, 'config-server.mjs 能解析出配置对象');

if (fileCfg !== undefined) {
  const d = diffPaths(fileCfg, nowCfg);
  assert(d.length === 0, 'config-server.mjs 与 config.js 同源（' + (d.length ? '差异：' + d.join('；') + ' → 跑 cd supabase && node gen_server_config.js' : '逐字段一致') + '）');
}

// 关键段齐不齐：白名单漏一段，服务端就会拿 undefined 算（不报错，算错数）
const mustHave = [
  ['pet.starters', nowCfg.pet && nowCfg.pet.starters],
  ['pet.speeds', nowCfg.pet && nowCfg.pet.speeds],
  ['pet.evolution.stages', nowCfg.pet && nowCfg.pet.evolution && nowCfg.pet.evolution.stages],
  ['pet.evolution.tree', nowCfg.pet && nowCfg.pet.evolution && nowCfg.pet.evolution.tree],
  ['pet.evolution.activeSkills', nowCfg.pet && nowCfg.pet.evolution && nowCfg.pet.evolution.activeSkills],
  ['pet.evolution.skillTierScale', nowCfg.pet && nowCfg.pet.evolution && nowCfg.pet.evolution.skillTierScale],
  ['pet.godPets.list', nowCfg.pet && nowCfg.pet.godPets && nowCfg.pet.godPets.list],
  ['exp', nowCfg.exp],
  ['battle.areaEnemyStats', nowCfg.battle && nowCfg.battle.areaEnemyStats],
  ['battle.speedScale', nowCfg.battle && nowCfg.battle.speedScale],
  ['drop.pool', nowCfg.drop && nowCfg.drop.pool],
  ['drop.poolByStage', nowCfg.drop && nowCfg.drop.poolByStage],
  ['drop.areaMaterials', nowCfg.drop && nowCfg.drop.areaMaterials],
  ['equipment', nowCfg.equipment],
  ['bloodlinePassive', nowCfg.bloodlinePassive],
  ['petTraits', nowCfg.petTraits],
  ['resourceTrials', nowCfg.resourceTrials]
];
const missing = mustHave.filter(x => x[1] === undefined || x[1] === null).map(x => x[0]);
assert(missing.length === 0, '服务端配置白名单的关键段都在（缺：' + (missing.join(',') || '无') + '）');

assert(nowCfg.pet.starters.length === 8, '服务端拿到 8 只基宠（当前 ' + nowCfg.pet.starters.length + ' 只）');
assert(nowCfg.pet.evolution.stages.length === 5, '服务端拿到 5 阶进化（当前 ' + nowCfg.pet.evolution.stages.length + ' 阶）');

console.log('—— enemy-data-server.mjs（怪物池） ——');

const fileEnemy = readEmbedded(GEN.ENEMY_MJS, 'enemyList');
assert(fileEnemy !== undefined, 'enemy-data-server.mjs 能解析出怪物池');
if (fileEnemy !== undefined) {
  const nowEnemy = GEN.buildEnemyList(ctx);
  const d2 = diffPaths(fileEnemy, nowEnemy);
  assert(d2.length === 0, 'enemy-data-server.mjs 与 enemy-data.js 同源（' + (d2.length ? '差异：' + d2.join('；') + ' → 跑 cd supabase && node gen_server_config.js' : '逐条一致') + '）');
  assert(nowEnemy.length > 0, '怪物池非空（当前 ' + (nowEnemy ? nowEnemy.length : 0) + ' 条）');
}

console.log('');
if (fails) { console.error('共 ' + fails + ' 项断言失败'); process.exit(1); }
console.log('全部通过');
