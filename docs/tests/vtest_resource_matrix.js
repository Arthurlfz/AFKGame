// Resource ownership matrix contract (boundary baseline v1, section 3 + 5.3 + 7.4).
// Every assertion here maps to one row of that matrix. Its job is to stop a material
// from quietly gaining a second source — that is what made every system produce the
// same rewards and turned the normal map into the optimal answer for everything.
const fs = require('fs'), vm = require('vm');
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
// 2026-09-10 起资源副本数值迁至 trial/trial-config.js（一个文件一个职责）
vm.runInContext(fs.readFileSync('../js/trial/trial-config.js', 'utf8'), ctx);
const C = code => vm.runInContext(code, ctx);
let failed = 0;
const A = (v, m) => { if (!v) { console.error('FAIL: ' + m); failed++; } else console.log('PASS: ' + m); };

const EVOLUTION = ['进化素材', '精粹进化素材', '传说进化素材'];
const NIRVANA = ['涅槃丹'];
const quests = C('Config.drop.quests');
const rewards = q => Object.keys(q.reward || {});
const has = (q, names) => rewards(q).some(n => names.includes(n));

/* ---- 1. 循环任务禁止生产进化/涅槃材料（矩阵：明确禁止「循环任务」） ---- */
// Daily/loop quests repeat forever; giving them evolution material makes them the
// best source in the game and turns map drops into noise.
const loops = quests.filter(q => q.repeat || q.repeatable);
A(loops.length > 0, 'repeatable quests exist to guard');
A(!loops.some(q => has(q, EVOLUTION)), 'no repeatable quest grants evolution material');
A(!loops.some(q => has(q, NIRVANA)), 'no repeatable quest grants nirvana material');

/* ---- 2. 传说进化素材的产出阶段（矩阵：主来源 图6~8 + 试炼蜕变高阶） ---- */
// Map 6-8 is level 31-48. Anything below hands out two stages early, and map 9-10
// must not produce it steadily at all.
const tierOf = level => {
  const areas = C('Config.battle.areas');
  return areas.findIndex(a => level >= a.levelRange[0] && level <= a.levelRange[1]) + 1;
};
const legendQuests = quests.filter(q => has(q, ['传说进化素材']));
A(tierOf(31) === 6 && tierOf(48) === 8, 'maps six to eight cover level 31 to 48');
// 成就没有 unlockLevel（它们是长线目标，不挂在任何一张图上），只受数量上限约束。
A(legendQuests.filter(q => q.unlockLevel != null).every(q => {
  const t = tierOf(q.unlockLevel); return t >= 6 && t <= 8;
}), 'legend evolution material only appears in map 6-8 quests');
A(legendQuests.every(q => (q.reward['传说进化素材'] || 0) <= 2), 'a single quest grants at most two legend materials');
// 单只宠走到终阶总共只要 5 个传说；任务只是「补充」（地图 6~8 才是主来源），
// 但每条不超过 2 个就保证任务不会一次性把后续阶段的量提前发完。总量不再设硬上限——地图仍是大头。

/* ---- 3. 地图掉落：进化素材三档**全域**（梯度靠权重，不靠"有/无"） ---- */
/* 🔴 2026-09-17「全域与区域掉落重设计 v1」有意推翻旧口径，替换说明：
 *   旧口径（2026-09-10 立）：「图 9~10 只出传说档 + 权重 ≤ 图 8 的 1/4」——
 *     那是为治「传说卡手」打的补丁，同时把入门两阶（普通/精粹）在图 9~10 关掉了。
 *   用户 2026-09-17 原话：「**我发现有的时候被简单物资卡脚了，我很烦**」→
 *     毕业玩家（挂图 9~10）孵了新宠，**一阶/二阶素材一件都刷不到**，必须手动退回图 1~5。
 *   ⇒ 三档改成「全域 + 权重差」：每张图三档都能掉，但梯度必须还在。
 *   现在守三条：① 10 张图三档齐全 ② 图 9~10 仍是该图权重最高的档 ③ 深处远比浅处高。 */
const areaNames = C('Config.battle.areas.map(a => a.id)');
A(areaNames.length === 10, 'ten maps are published');
const mw10 = C('Config.drop.materialWeightsByTier');
const EVO3 = ['进化素材', '精粹进化素材', '传说进化素材'];
A([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(t => EVO3.every(n => (mw10[t][n] || 0) > 0)),
  'evolution material of all three tiers drops on every one of the ten maps (full-map, 2026-09-17)');
A(mw10[9]['传说进化素材'] > mw10[9]['进化素材'] && mw10[10]['传说进化素材'] > mw10[10]['进化素材'],
  'maps nine and ten still favour the top tier most (the gradient survived the full-map change)');
A(mw10[8]['传说进化素材'] > mw10[1]['传说进化素材'] * 100 && mw10[1]['传说进化素材'] < 1,
  'the top tier is far rarer in shallow maps (map eight vs map one)');
A(!C(`Object.values(Config.drop.materialWeightsByTier).some(w => (w['锁定石'] || 0) > 0)`),
  'lock stones never drop from maps');
A(!C(`Object.values(Config.drop.materialWeightsByTier).some(w => (w['涅槃丹'] || 0) > 0)`),
  'nirvana pills never drop from maps');

/* ---- 3b. 高级物品不进地图掉落表（2026-09-09 产出削减，归属见 Config.towerDrops） ---- */
// 地图只出「燃料」；高级物品归通天塔（塔未开发，见 towerDrops 占位登记）。
const TOWER_ITEMS = ['神圣石', '越龙之石', '天仙玉露', '强化丹B', '锁魂玉', '琼浆玉露'];
A(!C(`Object.values(Config.drop.materialWeightsByTier).some(w => ${JSON.stringify(TOWER_ITEMS)}.some(n => (w[n] || 0) > 0))`),
  'tower-owned items never drop from maps');
A(C(`(Config.towerDrops && Config.towerDrops.items.map(i => i.name).join(','))`) === TOWER_ITEMS.join(','),
  'towerDrops registers every map-removed high tier item');

/* ---- 4. 资源试炼：每种通货唯一主来源，失败补偿不含区域材料 ---- */
const routes = C('Config.resourceTrials.routes');
const route = id => routes.find(r => r.id === id) || {};
A(routes.length === 3, 'the trial offers exactly three directions');
for (const r of routes) A((r.floorTiers || []).length > 0, `${r.id} declares its reward tiers in config`);
A(!C(`JSON.stringify(Config.resourceTrials).includes('区域材料')`),
  'the trial never grants area materials (that is the map\'s job)');
const consolations = routes.flatMap(r => (r.consolation || []).map(i => i.name));
A(consolations.length === 3 && !consolations.includes('区域材料'),
  'failure still pays direction progress, not area materials');
// Lock stones exist but have no other source until the tower ships, so the trial must own them.
const craftItems = (route('temper').floorTiers || []).flatMap(t => t.items.map(i => i.name));
A(craftItems.includes('锁定石'), 'the craft trial is the only source of lock stones');
A(!C(`Object.values(Config.drop.materialWeightsByTier).some(w => (w['锁定石'] || 0) > 0)`),
  'lock stones have exactly one source');
// 涅槃路线必须发道具化的涅槃丹 —— 涅磐兽早已不是涅槃消耗品（pet_merge.js 改走道具）
A((route('nirvana').floorTiers || []).flatMap(t => t.items.map(i => i.name)).includes('涅槃丹'),
  'the nirvana trial grants the actual nirvana item, not the retired phoenix beast');
// 神圣石从地图移除后，淬炼试炼是它唯一还在运转的来源（塔落地前）
A(craftItems.includes('神圣石'), 'the craft trial still backs holy stones after map removal');

/* ---- 5. 新手引导禁止发放终阶资源（矩阵 7.4） ---- */
const box = C('Config.tutorialMode.supplyBox.items');
const boxNames = box.map(i => i.name || '');
A(boxNames.every(n => !/传说|精粹|凝魂|锁定|涅槃/.test(n)), 'the guide hands out no advanced resource');
A(!C('Config.tutorialMode.expPacks.length'), 'the guide ships no hidden high-tier exp packs');

/* ---- 6. 不可交易清单（矩阵 5.3） ---- */
const tradeNames = C('Config.trade.materials.map(m => m.name)');
A(!tradeNames.includes('凝魂晶石'), 'soul crystals are account bound, not tradable');
A(!tradeNames.includes('资源试炼门票'), 'trial tickets are not tradable');
A(tradeNames.includes('进化素材'), 'evolution material stays tradable');
A(!C(`Object.values((Config.marketBot.botGoods || {}).materials || {}).some(g => g.pay === 'soulcrystal')`),
  'no bot listing pays with soul crystals');
A(!C(`'soulcrystal' in ((Config.marketBot.botGoods || {}).materialSellWeights || {})`),
  'bots do not resell soul crystals');
/* ---- 6b. 交易白名单不许重复登记（2026-09-17 补） ----
 * 起因：`锁魂玉` / `琼浆玉露` 各自被登记了两次（同 id 同 name 连着两行）——
 *   玩家可见的后果：市集上架/收款的下拉里出现重复选项、交易记录页的净额 chips 重复渲染。
 * 为什么必须用测试守：按 id 去重的消费方（market_bot 的 find(m=>m.id===...)）只取第一条，
 *   所以**不报错、不崩**，只是"多一个选项"——靠肉眼永远发现不了，只能静态查重。 */
const tradeIds = C('Config.trade.materials.map(m => m.id)');
const dupIds = tradeIds.filter((v, i) => tradeIds.indexOf(v) !== i);
A(dupIds.length === 0, `trade.materials 里没有重复登记（重复的：${dupIds.join('、') || '无'}）`);
A(new Set(tradeNames).size === tradeNames.length,
  `trade.materials 里没有重复的材料名（重复的：${tradeNames.filter((v, i) => tradeNames.indexOf(v) !== i).join('、') || '无'}）`);

/* ---- 7. 分解不得把白装变成高级通货（矩阵 5.3 / 10.2） ---- */
const salvage = C('Config.salvage');
A(Object.keys(salvage.white || {}).length === 0, 'white gear salvages into nothing');
const salvagePayout = Object.values(salvage).flatMap(o => Object.keys(o || {}));
A(!salvagePayout.some(n => ['神圣石', '合成之石', '锁定石'].includes(n)),
  'salvage never yields high tier currency (no infinite white-to-holy loop)');

if (failed) { console.error(`\n${failed} RESOURCE MATRIX ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL RESOURCE MATRIX TESTS PASSED');
