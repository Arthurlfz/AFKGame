/* ============================================================
 * vtest_sim_sync.js —— 前端/服务器两份战核副本同步守护（2026-09-09 立规）
 * 背景：挂机战核存在两份手工同步的副本（docs/js/core/battle-sim.mjs 前端参考版
 *       与 supabase/functions/_shared/battle-sim.mjs 服务器运行版）。
 *       2026-09-09 架构改版后**运行时只跑服务器版**（客户端纯回放），
 *       前端副本降级为参考/测试用 —— 但一旦漂移，diff 测试（vtest_server_sim /
 *       vtest_script_sim）就会失真。本测试逐函数比对源码，漂移即红。
 * ============================================================ */
const path = require('path');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

const FRONT = import('../js/core/battle-sim.mjs');
const SERVER = import('../../supabase/functions/_shared/battle-sim.mjs');

const NAMES = [
  'simulateSession', 'simulateSessionScript', 'simulateFight', 'petStats',
  'calcDamage', 'expFromBattle', 'mulberry32', 'pickWeighted',
  'skillOf', 'getEquipBonuses', 'getBloodline', 'rollBoss', 'bossRand',
  // ⚠️ 2026-09-11 审计补：这 4 个曾漏在名单外，而漂移**恰好就在它们身上**
  // （服务端给神级宠加了 statCoeff / speed / lineId 优先，前端源没同步），
  // 于是「守护测试」一直绿着。名单必须覆盖所有会被两边分别修改的函数。
  'resolveLineId', 'godDefOf', 'getBaseSpeed', 'getStatCoeff'
];

(async () => {
  const F = await FRONT, S = await SERVER;
  let drift = [];
  for (const name of NAMES) {
    const f = F[name], s = S[name];
    if (typeof f !== 'function' || typeof s !== 'function') { drift.push(name + ': 缺失'); continue; }
    if (f.toString() !== s.toString()) drift.push(name);
  }
  A(drift.length === 0,
    drift.length === 0
      ? 'A. 两份战核副本逐函数一致（' + NAMES.length + ' 个函数源码全等）'
      : '战核副本漂移 → ' + drift.join(', ') + '（改哪份都必须同步另一份）');

  // simulateSessionScript 只许存在于这两份副本里（单一模拟器原则，不许第三份）
  const fs = require('fs');
  const globDir = path.join(__dirname, '../js/core');
  const others = fs.readdirSync(globDir).filter(f => f.endsWith('.js') && f !== 'battle-sim.global.js')
    .map(f => fs.readFileSync(path.join(globDir, f), 'utf8'))
    .filter(src => src.indexOf('function simulateSessionScript') >= 0);
  A(others.length === 0, 'B. 运行时目录没有第三份剧本模拟器（battle-sim.global.js 生成品除外）');

  console.log('ALL SIM SYNC TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.message || e)); process.exit(1); });
