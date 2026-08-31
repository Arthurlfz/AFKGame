/* ============================================================
 * vtest_tier_rarity.js —— T 阶稀缺性底线（2026-08-30 用户拍板「再砍到底」）
 * 守三条设计承诺，改 config.equipment.affixTierWeights / equipment_craft.js 时必须过：
 *  1. T1 只能从金装来：白/蓝装（掉落或重铸）永远抽不到 T1、T2
 *  2. 金装 T1 概率 ≈ 2%（8% 玩家实测仍觉得"太容易出"→ 降到 2%，顶级词缀求而不得）
 *  3. 重铸不许再写死 randInt(1,5)——那个写法不看成色，白装能洗出全 T1
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {},
    addEventListener() {}, querySelector: () => el(), querySelectorAll() { return this.children || [] }, children: [], removeChild() {}, remove() {}, scrollTop: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/equipment/equipment.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

/* ---------- 1. T 阶抽取按稀有度分层 ---------- */
const sample = (rarity, n) => C(`(function(){
  const out={};
  for(let i=0;i<${n};i++){const t=Equipment.rollAffixTier('${rarity}');out[t]=(out[t]||0)+1;}
  return out;
})()`);
const pctOf = (m, t, n) => ((m[t] || 0) / n * 100);

const w = sample('white', 4000), b = sample('blue', 4000), g = sample('gold', 40000);
console.log('  白装 T 分布', JSON.stringify(w), '｜蓝装', JSON.stringify(b), '｜金装', JSON.stringify(g));
A(!w[1] && !w[2] && !w[3], '白装抽不到 T1/T2/T3（T 阶被稀有度锁死）');
A(!b[1] && !b[2], '蓝装抽不到 T1/T2');
A(!!g[1], '金装能抽到 T1（顶级词缀的唯一来源）');

const t1 = pctOf(g, 1, 40000);
console.log(`  金装 T1 实际概率 ${t1.toFixed(1)}%（设计值 2%）`);
A(t1 >= 1 && t1 <= 3, `金装 T1 概率在设计值附近（${t1.toFixed(1)}% ∈ [1,3]）`);

/* ---------- 2. 实际生成的装备也守规矩 ---------- */
// 基础词缀（base:true，固定 T5）不参与统计
const scan = (rarityId, count) => C(`(function(){
  const R=Config.equipment.rarities.find(r=>r.id==='${rarityId}');
  let t1=0,t2=0,total=0;
  for(let i=0;i<${count};i++){
    const eq=Equipment.generateEquipment(R, 6, 1);
    for(const a of Equipment.flattenAffixes(eq.affixes)){
      if(a.base)continue; total++;
      if(a.tier===1)t1++; if(a.tier===2)t2++;
    }
  }
  return {t1,t2,total};
})()`);
const sw = scan('white', 400), sb = scan('blue', 400), sg = scan('gold', 400);
console.log(`  实装统计：白 ${sw.total} 条词缀 / 蓝 ${sb.total} 条 / 金 ${sg.total} 条（金中 T1 ${sg.t1} 条）`);
A(sw.t1 === 0 && sw.t2 === 0, '生成的白装没有 T1/T2 词缀');
A(sb.t1 === 0 && sb.t2 === 0, '生成的蓝装没有 T1/T2 词缀');
A(sg.t1 > 0, '生成的金装能出 T1 词缀');

/* ---------- 3. 重铸不许绕过稀有度（静态检查，防回归） ---------- */
const craftSrc = fs.readFileSync('../js/equipment/equipment_craft.js', 'utf8');
A(craftSrc.indexOf('randInt(1, 5)') < 0, '重铸/增缀代码里没有写死的 randInt(1, 5)（不看成色的老写法）');
A((craftSrc.match(/rollAffixTier\(eq\.rarity\.id\)/g) || []).length >= 3,
  '重铸（两处）与增缀都改成按稀有度抽 T 阶');

/* ---------- 4. 底材 T 阶：T1 在图6 也才 20% ---------- */
const mt = C(`JSON.stringify(Config.equipment.materialTierWeights||{})`);
const t = JSON.parse(mt);
const p = (tier, T) => {
  const row = t[tier] || {};
  const sum = Object.values(row).reduce((a, b) => a + b, 0);
  return (row[T] || 0) / sum * 100;
};
console.log(`  底材 T1 概率：图1 ${p(1, 1).toFixed(1)}% → 图6 ${p(6, 1).toFixed(1)}%`);
A(p(1, 1) <= 3, `图1 的 T1 底材极稀有（${p(1, 1).toFixed(1)}%）`);
A(p(6, 1) >= 15 && p(6, 1) <= 22, `图6 的 T1 底材约 20%（${p(6, 1).toFixed(1)}%）`);

console.log('ALL TIER RARITY TESTS PASSED');
