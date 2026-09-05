/* ============================================================
 * vtest_exp_curve.js —— 经验曲线底线 + 经验单一事实源
 * 守住两条设计原则（改动 config.exp / Pet 经验函数时必须过）：
 *  1. 产出与需求同量纲：每升一级所需场数落在可玩区间，
 *     绝不允许回到"后期几十场才一级、进度条肉眼不动"。
 *  2. 预览与实发同源：怪物 tooltip 显示的区间 = 实发随机值的取值区间，
 *     不允许 UI 和结算各写一套公式。
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
for (const f of ['../js/core/config.js', '../js/equipment/equipment.js', '../js/pet/pet.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

// 每升一级需要多少场（用经验基准，不含 jitter；jitter 只影响单场手感，不影响期望）
const fightsAt = lv => C(`(function(){
  const need = Pet.expNeed(${lv});
  const per = Pet.expRange({level:${lv}}, null);
  return need / ((per.min + per.max) / 2);
})()`);

console.log('  等级 → 每级所需场数 / 单场进度占比');
let prev = 0, monotone = true;
for (const lv of [1, 3, 5, 10, 20, 30, 45, 60]) {
  const f = fightsAt(lv);
  const pct = 100 / f;
  console.log(`   Lv${String(lv).padStart(2)}  ${f.toFixed(1)} 场/级   单场 +${pct.toFixed(1)}%`);
  if (f < prev - 0.01) monotone = false;
  prev = f;
}
A(monotone, '每级所需场数随等级单调不减（不存在后期反而更快）');
A(fightsAt(1) <= 8, `Lv1 升级够快（${fightsAt(1).toFixed(1)} 场/级，前期要有连续升级的爽感）`);
A(fightsAt(30) <= 20, `Lv30 不磨（${fightsAt(30).toFixed(1)} 场/级）`);
A(fightsAt(60) <= 25, `Lv60 不磨（${fightsAt(60).toFixed(1)} 场/级）`);
// 进度条可见性：单场经验至少占本级需求的 3%（低于这个数，玩家看着条就是不动）
let minPct = 100;
for (let lv = 1; lv <= 60; lv++) minPct = Math.min(minPct, 100 / fightsAt(lv));
A(minPct >= 3, `全等级单场进度可见（最小 ${minPct.toFixed(1)}% ≥ 3%）`);

// 预览区间 = 实发区间（同源验证）：随机取样必须全部落在 expRange 里
const sample = C(`(function(){
  const e = {level: 25};
  const r = Pet.expRange(e, null);
  let out = 0, n = 0;
  for (let i = 0; i < 2000; i++) { const v = Pet.expFromBattle(e, null); if (v < r.min || v > r.max) out++; n += v; }
  return {min:r.min, max:r.max, out, avg: n/2000, need: Pet.expNeed(25)};
})()`);
A(sample.out === 0, `实发经验全部落在预览区间内（${sample.min}~${sample.max}，越界 ${sample.out} 次）`);
A(sample.min >= 1 && sample.max >= sample.min, '预览区间有效（保底 ≥1）');
// 区域难度参与：难度 2 的图经验应明显高于难度 1
const diffGain = C(`Pet.expRange({level:20},{difficulty:2}).min > Pet.expRange({level:20},{difficulty:1}).max`);
A(diffGain === true, '区域难度参与经验计算（高难图经验更高）');
console.log(`  Lv25 单场均经验 ${sample.avg.toFixed(1)}，本级需求 ${sample.need}`);
console.log('ALL EXP CURVE TESTS PASSED');
