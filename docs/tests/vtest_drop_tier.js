/* ============================================================
 * vtest_drop_tier.js —— 装备掉落图档与 10 张地图对齐
 * 背景：地图从 6 扩到 10 后，装备图档也要跟着扩。曾漏改两处写死「上限 6」：
 *   · drop.js 里 areaTier = clamp(图序号+1, 1, 6)      → 图7~10 掉落和图6 一样强
 *   · equipment.js generateEquipment 里 clamp(areaTier,1,6) → 同上（两处都钳）
 * 守的承诺：
 *  1. 图 N → 掉落的装备 areaTier = N（图10 就是 10 档，不是被钳回 6）
 *  2. 高图装备基底必须更强：baseTierMultipliers[9] > baseTierMultipliers[5]
 *  3. 10 张图逐张生成装备都不越界、不产生 NaN
 *  4. 静态防回归：两文件不许再出现「写死 6 的图档钳制」
 *  5. materialTierWeights 键 1~10 与地图数一致（rollMaterialTier 取不到就回退，会失去梯度）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {} }; }
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/equipment/equipment.js', 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

const areas = JSON.parse(C('JSON.stringify(Config.battle.areas)'));
const tiers = JSON.parse(C('JSON.stringify(Config.equipment.baseTierMultipliers)'));
const matWeights = JSON.parse(C('JSON.stringify(Config.equipment.materialTierWeights)'));
const white = JSON.parse(C('JSON.stringify(Config.equipment.rarities[0])'));

// 1. 图 N → areaTier = N（不被钳回 6）
{
  const bad = [];
  for (let i = 0; i < areas.length; i++) {
    const areaTier = i + 1;
    const eq = JSON.parse(C(`JSON.stringify(Equipment.generateEquipment(${JSON.stringify(white)}, ${areaTier}, 3))`));
    if (eq.areaTier !== areaTier) bad.push(`图${i + 1} 掉 eq.areaTier=${eq.areaTier}（期望 ${areaTier}）`);
    // 部位是随机的，不一定是武器 → 检查「任一基底值」都是合法正数即可（不能是 undefined/NaN/0）
    const stats = Object.values(eq.baseStats || {});
    if (!stats.length || !stats.every(v => typeof v === 'number' && !isNaN(v) && v > 0))
      bad.push(`图${i + 1} 装备基底非法：${JSON.stringify(eq.baseStats)}`);
  }
  A(!bad.length, `图档不越界：10 张图逐张生成装备，areaTier 都正确且无 NaN${bad.length ? '，' + bad.join('；') : ''}`);
}

// 2. 高图装备基底更强
{
  const atkAt = t => {
    const mult = tiers[t - 1];
    // 武器基底 atk=30（baseValues.武器），装备生成随机部位，直接算「任何部位都乘以同样的 multiplier」的强度比即可
    return mult;
  };
  A(tiers.length === areas.length, `baseTierMultipliers 档数（${tiers.length}）与地图数（${areas.length}）一致`);
  A(atkAt(areas.length) > atkAt(6),
    `高图基底更强：图10 倍率 ${atkAt(10)} > 图6 倍率 ${atkAt(6)}（新图有"装备更好"的回报）`);
  const last = JSON.parse(C(`JSON.stringify(Equipment.generateEquipment(${JSON.stringify(white)}, ${areas.length}, 3))`));
  A(last.areaTier === areas.length, `图${areas.length} 掉落 eq.areaTier = ${last.areaTier}（不再被钳回 6）`);
}

// 3. materialTierWeights 覆盖 1~10
{
  const keys = Object.keys(matWeights).map(Number).sort((a, b) => a - b);
  A(keys.length === areas.length, `materialTierWeights 覆盖 ${keys[0]}~${keys[keys.length - 1]}（${keys.length} 档，与地图一致）`);
}

// 4. 静态防回归：两文件不许再写死「图档上限 6」
{
  const src1 = fs.readFileSync('../js/core/drop.js', 'utf8');
  const src2 = fs.readFileSync('../js/equipment/equipment.js', 'utf8');
  const bad = [];
  if (/Math\.min\(\s*6\s*,\s*areaTier/.test(src1)) bad.push('drop.js 钳 areaTier 到 6');
  if (/Math\.min\(\s*6\s*,\s*areaTier/.test(src2)) bad.push('equipment.js 钳 areaTier 到 6');
  A(!bad.length, `静态防回归：掉图档不再写死 6${bad.length ? '，仍存在：' + bad.join('；') : ''}`);
}

// 5. 材料子权重·按图档（low→high + 出现时机）
{
  const mw = JSON.parse(C('JSON.stringify(Config.drop.materialWeightsByTier)'));
  const keys = Object.keys(mw).map(Number).sort((a, b) => a - b);
  A(keys.length === areas.length, `materialWeightsByTier 覆盖 ${keys[0]}~${keys[keys.length - 1]}（${keys.length} 档，与地图一致）`);
  const has = (t, k) => !!(mw[t] && mw[t][k] > 0);
  // 最新资源边界：涅槃材料由资源试炼·涅槃承担，普通地图不稳定生产。
  A(Object.keys(mw).every(t => !has(t, '涅磐兽') && !has(t, '涅槃丹')), '普通地图不稳定产出涅槃材料');
  A([1, 2, 3].every(t => !has(t, '合成之石') && !has(t, '神圣石')), '合成之石/神圣石 图1-3 不出现（成长期 图4 才解锁）');
  A([4, 5, 6, 7, 8, 9, 10].every(t => has(t, '合成之石') && has(t, '神圣石')), '合成之石/神圣石 图4-10 都出现');
  const evoTiers = JSON.parse(C('JSON.stringify(Config.drop.areaEvolutionTiers)'));
  A(evoTiers['echo-cliffs'].includes('传说进化素材') && evoTiers['ember-hollow'].includes('传说进化素材')
    && !evoTiers['soul-abyss'].length && !evoTiers['blight-heart'].length,
    '传说进化素材稳定来源收束到图6-8，图9-10不再稳定掉落');
  const loops = JSON.parse(C('JSON.stringify(Config.drop.quests || [])')).filter(q => q.type === 'collect_loop');
  A(loops.every(q => !q.reward || (!q.reward['涅槃丹'] && !q.reward['涅磐兽'] && !q.reward['百变魔石'])),
    '地图循环任务不发放涅槃材料或稀有合成道具');
  // 手册 2.4 三阶段打造石权重：图1-3 重铸主导、图8-10 神圣/合成主导
  A(mw[1]['重铸石'] > (mw[1]['神圣石'] || 0) && mw[10]['神圣石'] > mw[10]['重铸石'], '重铸石前期主导 / 神圣石后期主导');
  // 早期打造石深处淡出：重铸石 图1 有、图10 权重最低
  A(has(1, '重铸石') && mw[10]['重铸石'] < mw[1]['重铸石'], '重铸石 早期多、深处淡出');
  // 静态防回归：drop.js 必须读 materialWeightsByTier，不能再读旧全局 materialWeights
  const src = fs.readFileSync('../js/core/drop.js', 'utf8');
  A(/materialWeightsByTier/.test(src) && !/D\.materialWeights\b/.test(src), 'drop.js 已改用 materialWeightsByTier（旧全局 materialWeights 已弃用）');
}

console.log('ALL DROP TIER TESTS PASSED');
