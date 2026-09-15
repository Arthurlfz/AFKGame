/* ============================================================
 * vtest_tier_rarity.js —— 词缀/底材 T 阶生成规则（2026-09-11 按 PoE 模式重写）
 * 规则（用户拍板「颜色由词缀数量决定；T 阶仅由装备等级解锁」+ PoE 式权重池）：
 *  1. 每个 tier 有 ilvl 门槛（T1=70/T2=60/T3=25/T4=1）+ 权重（5/15/30/25/25）；
 *     掉落时「门槛达标」的 tier 全部进池按权重抽 —— T1 可以出现但稀有。
 *  2. 词缀条数由 ilvl 决定（affixCountByIlvl），颜色 = 条数的结果（1白/2蓝/3+金）。
 *  3. 底材 T 阶同一套门槛 + 权重池。
 *  4. 重铸/增缀走同一个 rollAffixTier(ilvl) 入口，没有绕过等级的口子。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {},
    addEventListener() {}, querySelector: () => el(), querySelectorAll() { return this.children || [] }, children: [], removeChild() {}, remove() {}, scrollTop: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/equipment/equipment.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

/* ---------- 1. 门槛池：等级外的不可能，等级内的按权重出现 ---------- */
const sample = (lv, n) => C(`(function(){
  const out={};
  for(let i=0;i<${n};i++){const t=Equipment.rollAffixTier(${lv});out[t]=(out[t]||0)+1;}
  return out;
})()`);
const s80 = sample(80, 20000), s65 = sample(65, 8000), s40 = sample(40, 8000), s10 = sample(10, 4000);
console.log('  ilvl80', JSON.stringify(s80), '｜65', JSON.stringify(s65), '｜40', JSON.stringify(s40), '｜10', JSON.stringify(s10));
A(!s80[0] && !s10[1] && !s10[2] && !s10[3], '门槛外不可能：ilvl 80 之外不出 T1；ilvl 10 只有 T4/T5');
A(s80[1] > 0, 'ilvl 80 能出 T1（「可以出现」—— 顶级词缀不是锁死的）');
const t1pct = (s80[1] || 0) / 20000 * 100;
/* 2026-09-15：T1 概率按装备等级分段上调（T1 只在塔里刷得到）→
 * ilvl 80 命中 minIlvl 70 段（权重 15/19/66）≈15%，不再是全档 5%。 */
A(t1pct >= 12 && t1pct <= 18, `塔（ilvl 80）的 T1 概率 ≈ 15%（实际 ${t1pct.toFixed(2)}%，权重 15/100，分段表 70+）`);
A((s80[1] || 0) < (s80[3] || 0), 'T1 比 T3 稀有（权重递增，高档词缀求而不得）');
A(!!s40[3] && !s40[2] && !s40[1], 'ilvl 40：T3 进池、T1/T2 不进池（门槛 T1/T2 = 70）');
/* ⭐ 用户拍板（2026-09-15）：T1 与 T2 都是塔专属（门槛都 70）→ 图 10（ilvl 55~60）最高只出 T3 */
A(!s65[1] && !s65[2] && !!s65[3], 'ilvl 65（图 10 档）：只出 T3 及以下（T1/T2 要装备等级 70 = 塔专属）');

/* ---------- 2. 实际生成的装备守规矩（条数→颜色 / 每条独立 roll / 底材同池） ---------- */
const scan = lv => C(`(function(){
  const eq = Equipment.generateEquipment(null, 10, 0, ${lv});
  const aff = Equipment.flattenAffixes(eq.affixes).filter(a => !a.base);
  return { count: aff.length + 1, color: eq.rarity.id, matTier: eq.materialTier,
           minT: Math.min.apply(null, aff.map(a => a.tier)), maxT: Math.max.apply(null, aff.map(a => a.tier)) };
})()`);
const g80 = scan(80), g55 = scan(55), g10 = scan(10);
A(g80.matTier >= 1 && g80.matTier <= 5, `底材 T 来自同一权重池（ilvl 80 实际 T${g80.matTier}）`);
A(g80.color === 'gold' && g80.count >= 4 && g80.count <= 5, `ilvl 80：4~5 条 → 金色（实际 ${g80.count} 条 ${g80.color}）`);
/* ⚠️ 这里以前写的是 `g55.matTier === 3`（要求恰好 T3），被当成 flaky 放了好几轮。
 * 其实不是 flaky，是断言错了：PoE 规则下 ilvl 55 的池 = T3(门槛25)+T4(1)+T5(1)，
 * 权重 30:25:25 → 单次抽样出 T4/T5 完全正常，断言却在要求必然 T3，于是三天两头红。
 * 真要守的不变量是「T1/T2 进不来」（门槛 60/70 未达标），用分布验证才不会误判。 */
const dist55 = C(`(function(){const c={};for(let i=0;i<300;i++){const t=Equipment.generateEquipment(null,10,0,55).materialTier;c[t]=(c[t]||0)+1;}return c;})()`);
/* ⭐ 用户拍板（2026-09-15）：T1 门槛保持 70 —— 图 10（ilvl 55）**不出 T1**，
 * 顶级词缀是塔的专属产出；野图保留 T2/T3（其中机制类词缀仍是百分比点数，输出有价值）。 */
A(!dist55[1] && !dist55[2], `图 10（ilvl 55）不出 T1/T2（分布 ${JSON.stringify(dist55)}）—— T1 是塔专属产出`);
A((dist55[3] || 0) > 0, 'T3 能出现（门槛没被误伤）');
A(g10.count >= 1 && g10.count <= 2 && (g10.color === 'white' || g10.color === 'blue'),
  `ilvl 10：1~2 条 → 白/蓝（实际 ${g10.count} 条 ${g10.color}）`);

/* ---------- 3. 重铸/增缀走统一入口（静态检查，防回归） ---------- */
const craftSrc = fs.readFileSync('../js/equipment/equipment_craft.js', 'utf8');
A(craftSrc.indexOf('randInt(1, 5)') < 0, '重铸/增缀代码里没有写死的 randInt(1, 5)');
A((craftSrc.match(/rollAffixTier\(window\.Equipment\.ilvlOf\(eq\)\)/g) || []).length >= 3,
  '重铸（两处）与增缀都改成 rollAffixTier(ilvlOf(eq)) —— T 阶只看装备等级');
A(craftSrc.indexOf('rollAffixTier(eq.rarity.id') < 0, '旧签名（按稀有度抽 T 阶）已清干净');

/* ---------- 4. 配置表在位 ---------- */
/* 2026-09-15 用户拍板：T1 与 T2 都是塔专属（门槛都 70）→ 普通地图最高只出 T3 */
A(C(`Config.equipment.affixIlvlGates[1]`) === 70 && C(`Config.equipment.affixIlvlGates[2]`) === 70,
  'ilvl 门槛：T1=70 / T2=70（都是塔专属产出，2026-09-15 拍板值）');
A((C(`(Config.equipment.affixTierWeightsByIlvl||[]).length`) || 0) >= 3,
  'T1 概率分段表在位（按装备等级上调，后期死签防线）');
A(C(`(Config.equipment.affixCountByIlvl||[]).length`) === 4, 'affixCountByIlvl 四档区间表在位');

console.log('ALL TIER RARITY TESTS PASSED');
