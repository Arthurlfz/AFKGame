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
// 第 7 段要直接调 UI.showLoot 验「播报档位真的生效」，需要 UI / Pet 两个命名空间先存在
vm.runInContext(fs.readFileSync('../js/pet/pet.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-common.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-battle.js', 'utf8'), ctx);
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
  // 2026-09-10 用户拍板：涅磐兽（已退役，纯稀有收藏/交易物）挪到图 10 极低概率掉落；
  // 涅槃丹（唯一真消耗品）仍然不进地图，继续由资源试炼·涅槃承担。
  A(Object.keys(mw).every(t => !has(t, '涅槃丹')), '涅槃丹不进地图掉落表（归资源试炼·涅槃）');
  A(keys.filter(t => t !== 10).every(t => !has(t, '涅磐兽')), '涅磐兽只出现在图 10，不向低图泄露');
  A(has(10, '涅磐兽') && mw[10]['涅磐兽'] < 1,
    `图 10 极低概率掉落涅磐兽（权重 ${mw[10]['涅磐兽']}，小于表内任何材料的权重下限 1）`);
  A([1, 2, 3].every(t => !has(t, '合成之石') && !has(t, '神圣石')), '合成之石/神圣石 图1-3 不出现（成长期 图4 才解锁）');
  A([4, 5, 6, 7, 8, 9, 10].every(t => has(t, '合成之石')), '合成之石 图4-10 都出现（成长期 图4 解锁）');
  // 2026-09-09 产出削减：神圣石移出地图（归通天塔，淬炼试炼 Lv43+ 是唯一活来源）
  A(Object.keys(mw).every(t => !has(t, '神圣石')), '神圣石不进地图掉落表（归通天塔 + 淬炼试炼承担）');
  A(Object.keys(mw).every(t => !has(t, '越龙之石') && !has(t, '天仙玉露') && !has(t, '强化丹B')),
    '越龙之石/天仙玉露/强化丹B 不进地图掉落表（归通天塔）');
  const evoTiers = JSON.parse(C('JSON.stringify(Config.drop.areaEvolutionTiers)'));
  A(evoTiers['echo-cliffs'].includes('传说进化素材') && evoTiers['ember-hollow'].includes('传说进化素材'),
    '传说进化素材的稳定来源收束在图6-8');
  // 2026-09-10 用户报「传说卡手」：图 9~10 由「完全不掉」改成「只出传说 + 极低权重」。
  // 归属表禁止的是「图 9~10 **稳定刷取**」，不是「偶尔出一两个」—— 所以断言改守「只出最高档 + 权重远低于图 8」。
  A(evoTiers['soul-abyss'].join() === '传说进化素材' && evoTiers['blight-heart'].join() === '传说进化素材',
    '图 9~10 只产出传说档进化素材（不产普通/精粹）');
  A(has(9, '进化素材') && has(10, '进化素材'), '图 9~10 有进化素材占位键（否则那一档根本不参与抽取）');
  A(mw[9]['进化素材'] * 4 <= mw[8]['进化素材'] && mw[10]['进化素材'] * 4 <= mw[8]['进化素材'],
    `图 9~10 的进化素材权重远低于图 8（${mw[9]['进化素材']} / ${mw[10]['进化素材']} vs ${mw[8]['进化素材']}）→ 属「不稳定掉落」而非「稳定刷取」`);
  const loops = JSON.parse(C('JSON.stringify(Config.drop.quests || [])')).filter(q => q.type === 'collect_loop');
  A(loops.every(q => !q.reward || (!q.reward['涅槃丹'] && !q.reward['涅磐兽'] && !q.reward['百变魔石'])),
    '地图循环任务不发放涅槃材料或稀有合成道具');
  // 手册 2.4 三阶段打造石权重：图1-3 重铸主导（神圣石已移出地图，见 2026-09-09 产出削减）
  A(has(1, '重铸石') && mw[1]['重铸石'] > mw[1]['增缀石'], '图1 重铸石主导早期打造');
  // 早期打造石深处淡出：重铸石 图1 有、图10 权重最低
  A(has(1, '重铸石') && mw[10]['重铸石'] < mw[1]['重铸石'], '重铸石 早期多、深处淡出');
  // 静态防回归：drop.js 必须读 materialWeightsByTier，不能再读旧全局 materialWeights
  const src = fs.readFileSync('../js/core/drop.js', 'utf8');
  A(/materialWeightsByTier/.test(src) && !/D\.materialWeights\b/.test(src), 'drop.js 已改用 materialWeightsByTier（旧全局 materialWeights 已弃用）');
}

// 6. 掉落播报档位表（2026-09-13 新增）
//    守的是「档位表里的名字必须真的会掉落」—— 否则有人改了材料名却忘了改档位表，
//    表就变成一堆对不上的死名字（本项目高发病：同一逻辑两份、只有一份对），
//    而症状是"某件稀有的东西掉下来没人注意到"，非常难被发现。
{
  const mw2 = JSON.parse(C('JSON.stringify(Config.drop.materialWeightsByTier)'));
  const tiers = JSON.parse(C('JSON.stringify(Config.drop.lootTiers || {})'));
  const names = new Set();
  for (const t of Object.keys(mw2)) for (const k of Object.keys(mw2[t])) names.add(k);
  // 进化素材在 materialWeightsByTier 里是占位键，实际名字在 evoMaterialWeights
  const evo = JSON.parse(C('JSON.stringify(Config.drop.evoMaterialWeights || {})'));
  for (const k of Object.keys(evo)) names.add(k);

  const keys = Object.keys(tiers);
  A(keys.length > 0, `掉落播报档位表非空（${keys.length} 条）`);
  const badV = Object.entries(tiers).filter(([, v]) => ![1, 2, 3].includes(Number(v)));
  A(!badV.length, `播报档位只许取 1/2/3${badV.length ? '，越界：' + JSON.stringify(badV) : ''}`);
  const stale = keys.filter(n => !names.has(n));
  A(!stale.length, `档位表里的名字都真的会掉落（改材料名忘了改这张表 = 档位静默失效）${stale.length ? '，对不上的：' + stale.join('、') : ''}`);
  A(Number(tiers['涅磐兽']) === 3 && Number(tiers['腐印·天罚']) === 3,
    '表内最稀的两件（涅磐兽 / 腐印·天罚）必须挂着最亮档 3');
  // 刻意守反例：日常材料不许挂高亮档，否则"提亮一切 = 没提亮"
  A(!tiers['重铸石'] && !tiers['鉴定石'] && !tiers['区域材料'],
    '日常材料（重铸石/鉴定石/区域材料）不进档位表（不抢注意力）');
}

// 7. 播报档位真的打到消息上（不只要表好看，要 UI 真用上它）
//    断法：接管 UI.consoleLog 把产物收下来，逐条看有没有挂上 .hi2 / .hi3。
{
  C('globalThis.__cap = []; window.UI.consoleLog = (cat, html) => { globalThis.__cap.push([String(cat), String(html)]); };');
  C('UI.showLoot({ type:"material", material:"涅磐兽", qty:1 })');   // 档 3
  C('UI.showLoot({ type:"material", material:"腐印·暴怒", qty:1 })'); // 档 2
  C('UI.showLoot({ type:"material", material:"重铸石", qty:1 })');     // 档 1（不提亮）
  C('UI.showLoot({ type:"egg" })');                                    // 档 3
  C('UI.showLoot({ type:"equipment", eq:{ name:"测试剑", rarity:{ id:"gold", label:"金色" } } })'); // 档 3
  C('UI.showLoot({ type:"equipment", eq:{ name:"测试甲", rarity:{ id:"white", label:"白色" } } })');// 档 1
  const rows = JSON.parse(C('JSON.stringify(globalThis.__cap)'));
  A(rows.length === 6, `6 条掉落都进了消息控制台（实际 ${rows.length} 条）`);
  A(rows.every(r => r[0] === 'loot'), '掉落播报全部进 loot 频道（没漏回 system）');
  const htmlOf = i => rows[i][1];
  A(/hi3/.test(htmlOf(0)), '涅磐兽挂着最亮档 hi3');
  A(/hi2/.test(htmlOf(1)), '腐印·暴怒挂 hi2');
  A(!/hi[23]/.test(htmlOf(2)), '重铸石不挂档位（日常材料不提亮，提亮一切=没提亮）');
  A(/hi3/.test(htmlOf(3)) && /loot-egg/.test(htmlOf(3)), '宠物蛋挂 hi3 且带幽蓝 .loot-egg');
  A(/hi3/.test(htmlOf(4)), '金装挂 hi3');
  A(!/hi[23]/.test(htmlOf(5)), '白装不挂档位');
  // 🔴 顶档流光靠 currentColor 取色 → 档位 class 与颜色 class **必须在同一个 span**。
  //    拆成两层（外层档位、内层颜色）的话外层取到的是继承色，金装会变成默认字色，看不出来。
  A((htmlOf(4).match(/<span/g) || []).length === 1 && /hi3/.test(htmlOf(4)) && /fs-q--gold/.test(htmlOf(4)),
    '金装：档位与颜色 class 在【同一个 span】上（流光取色靠它，拆两层会取错）');
}

// 8. 材料用途配色（2026-09-13 用户拍板：区域材料无所谓，**打造 / 进化必须有区别**）
//    分工：**字号 = 稀有度，颜色 = 用途** —— 两条线不能互相抢。
{
  C('globalThis.__cap = [];');
  C('UI.showLoot({ type:"material", material:"进化素材", qty:1 })');
  C('UI.showLoot({ type:"material", material:"传说进化素材", qty:1 })');
  C('UI.showLoot({ type:"material", material:"重铸石", qty:1 })');
  C('UI.showLoot({ type:"material", material:"枯荣种荚", qty:1 })'); // 区域材料
  const rows8 = JSON.parse(C('JSON.stringify(globalThis.__cap)'));
  const h = i => rows8[i][1];
  const clsOf = s => (s.match(/loot-c-(evo|stone|affix)/) || [''])[0];
  A(clsOf(h(0)) === 'loot-c-evo', '进化素材上「进化系」色');
  A(clsOf(h(1)) === 'loot-c-evo' && /hi2/.test(h(1)),
    '传说进化素材 = 进化系色 + 档 2（颜色标用途、字号标稀有度，两条线不互相抢）');
  A(clsOf(h(2)) === 'loot-c-stone', '重铸石上「打造石」色');
  A(clsOf(h(0)) !== clsOf(h(2)), '进化与打造两种用途颜色不同（玩家一眼能分开）');
  A(clsOf(h(3)) === '', '区域材料不上色（用户明确说无所谓；且每图不同、没有跨图可比性）');
}

// 9. 静态防回归：别处（地图掉落预览 / 鉴定 / 打造）必须**复用**同一套档位，不许各抄一份
//    —— 抄了就是第二份事实源，改档位表时必然漏，症状是"这处还亮着那处不亮"。
{
  const wm = fs.readFileSync('../js/ui/ui-worldmap.js', 'utf8');
  A(/UI\.lootTierOf/.test(wm), '地图节点掉落预览复用 UI.lootTierOf（不另抄档位名单 → 不出现第二份事实源）');
  const bag = fs.readFileSync('../js/ui/ui-bag.js', 'utf8');
  A(/hi3/.test(bag), '鉴定揭晓用顶档 hi3（金装才有完整演出）');
  const craft = fs.readFileSync('../js/ui/ui-craft.js', 'utf8');
  A(/hi3/.test(craft), '打造出 T1 顶级词缀用顶档 hi3');
  const synth = fs.readFileSync('../js/ui/ui-pet-synth.js', 'utf8');
  A(/broadcastAnnounce/.test(synth), '神级宠 / 变异宠合成成功会发全服通告');
}

console.log('ALL DROP TIER TESTS PASSED');
