/* ============================================================
 * vtest_synth_growth.js —— 合成成长加法公式 + 道具化回归测试（2026-09-07）
 * 依据：合成系统重设计（第二版手册）2.1 加法公式 / 2.2 道具化
 * 覆盖：
 *   1. 加法公式：新宠成长 = 主宠成长 + 总提升，永远不掉（保底 +1）
 *   2. 道具加成：越龙之石 +10% / 百变魔石 +20% / 至尊神石 +30%
 *   3. 不选道具也能合成（只消耗基础合成之石）
 *   4. 选道具额外消耗 1 颗，不够则拒绝且不扣材料
 *   5. 普通宠成长软上限 100：超过部分减半
 *   6. 神级宠出生上限 60：超过部分折算 statCoeff 加成
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, dataset: {},
    appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f },
    querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' };
}
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams,
  TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream,
  crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] },
  session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
  '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js',
  '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js']) VTF.load(ctx, f);

const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); failures++ } else console.log('PASS: ' + m) };
let failures = 0;
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
async function mkPet(name, growth, tag, stage, level) {
  stage = stage || 1; level = level || 40;
  await C(`(async()=>{const p=Pet.createPet("${name}","",${growth},100,20,10,8);p.level=${level};p.evolveStage=${stage};p.evolveTimes=${stage - 1};Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__${tag}=p.id})()`);
  await S(60);
}
(async () => {
  C('session={user:{id:"user-synth",email:"synth@test.com"}}');
  await S(120);

  /* ============ 1. 加法公式纯函数 ============ */
  // 主宠成长 10，副宠成长 10 → 基础提升 = 10×0.25 = 2.5；等级 40+40=80/200=0.4 等级加成
  // 无道具：2.5×(1+0.4) + 随机(1~3) = 3.5 + 1~3 → 4.5 ~ 6.5，四舍五入 → 5~7
  C('const __r=Math.random; Math.random=()=>0.999');  // 随机加成取大值
  let g1 = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:10,level:40},{name:"骨狼",growth:10,level:40},false,null)`);
  C('Math.random=__r');
  // 2.5×1.4=3.5 + 随机3 = 6.5 → round 7？ 看实现：totalBoost = Math.round(6.5)=7？不对，是 round 后 max(1)
  A(g1 >= 10, `加法公式：新宠成长 ≥ 主宠成长（10 → ${g1}，永远不掉）`);

  // 副宠成长极低：主宠 10，副宠 1 → 基础提升 0.25×1.4=0.35 + 随机1 = 1.35 → round 1 → 保底 +1
  C('const __r2=Math.random; Math.random=()=>0.999');
  let g2 = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:10,level:40},{name:"骨狼",growth:1,level:40},false,null)`);
  C('Math.random=__r2');
  A(g2 >= 11, `保底 +1：主宠 10 + 副宠成长1 也有 ${g2}（不低于 11）`);

  // 道具加成：越龙之石 boost 0.1（副宠成长放大到 50 拉开差距，避免 round 抹平）
  // 无道具：50×0.25=12.5 ×(1+0.5)=18.75 +3 = 21.75 → 22
  // 越龙：12.5 ×(1+0.5+0.1)=20 +3 = 23
  C('const __r3=Math.random; Math.random=()=>0.999');
  let g1big = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:10,level:60},{name:"骨狼",growth:50,level:60},false,null)`);
  let g3 = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:10,level:60},{name:"骨狼",growth:50,level:60},false,'synth_stone')`);
  C('Math.random=__r3');
  A(g3 > g1big, `越龙之石加成生效（无道具 ${g1big} → 越龙之石 ${g3}）`);

  // 至尊神石 boost 0.3 → 12.5 ×(1+0.5+0.3)=22.5 +3 = 25.5 → 26
  C('const __r4=Math.random; Math.random=()=>0.999');
  let g4 = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:10,level:60},{name:"骨狼",growth:50,level:60},false,'synth_supreme')`);
  C('Math.random=__r4');
  A(g4 >= g3, `至尊神石加成 ≥ 越龙之石（${g3} → ${g4}）`);

  // 普通宠软上限 100：主宠 95 + 总提升 14 = 109 → 100 + 9/2 = 104.5
  C('const __r5=Math.random; Math.random=()=>0.999');
  let g5 = C(`Merge.calcSynthesizeGrowth({name:"血狐",growth:95,level:40},{name:"骨狼",growth:30,level:40},false,null)`);
  C('Math.random=__r5');
  A(g5 > 100 && g5 <= 104.6, `普通宠软上限 100 减半生效（95+大提升 → ${g5}，超 100 部分减半）`);

  /* ============ 2. 合成执行：不选道具也能合成 ============ */
  await mkPet('血狐', 10, 'p1', 5, 60);
  await mkPet('骨狼', 10, 'p2', 5, 60);
  const p1 = C('globalThis.__p1'), p2 = C('globalThis.__p2');
  await C('Materials.gain("合成之石",5)'); await S(80);
  const beforeMat = C('Materials.getQuantity("合成之石")');
  const syn0 = await C(`Merge.synthesize(${p1},${p2},null)`);   // 不选道具
  A(syn0.ok === true, '不选道具也能合成（null itemId）');
  A(beforeMat - C('Materials.getQuantity("合成之石")') === 1, '不选道具只消耗 1 颗合成之石');
  A(syn0.synthItem == null, '返回值 synthItem = null（未用道具）');

  /* ============ 3. 选道具：额外消耗 1 颗 ============ */
  await mkPet('瘟熊', 20, 'p3', 5, 60);
  await mkPet('疫毛兽', 20, 'p4', 5, 60);
  const p3 = C('globalThis.__p3'), p4 = C('globalThis.__p4');
  await C('Materials.gain("合成之石",5);Materials.gain("越龙之石",2)'); await S(80);
  const beforeStone = C('Materials.getQuantity("越龙之石")');
  const syn1 = await C(`Merge.synthesize(${p3},${p4},'synth_stone')`);
  A(syn1.ok === true, '选越龙之石合成成功');
  A(beforeStone - C('Materials.getQuantity("越龙之石")') === 1, '选道具额外消耗 1 颗越龙之石');
  A(syn1.synthItem && syn1.synthItem.id === 'synth_stone', '返回值 synthItem = 越龙之石');

  /* ============ 4. 道具不足：拒绝且不扣基础材料 ============ */
  await mkPet('毒沼蛙', 30, 'p5', 5, 60);
  await mkPet('幽影兔', 30, 'p6', 5, 60);
  const p5 = C('globalThis.__p5'), p6 = C('globalThis.__p6');
  await C('Materials.gain("合成之石",5)'); await S(80);   // 只给合成之石，不给百变魔石
  const beforeMat2 = C('Materials.getQuantity("合成之石")');
  const syn2 = await C(`Merge.synthesize(${p5},${p6},'synth_shift')`);   // 百变魔石（无货）
  A(syn2.ok !== true && /百变魔石/.test(syn2.error || ''), '百变魔石不足 → 拒绝并提示');
  A(C('Materials.getQuantity("合成之石")') === beforeMat2, '道具不足时不扣基础合成之石');

  /* ============ 5. 神级宠出生上限 60 + 折算 ============ */
  // 终阶成长 60+ 双宠 + 至尊神石 → 必定出神级宠；成长超过 60 部分折算
  await mkPet('血狐', 60, 'g1', 5, 60);
  await mkPet('骨狼', 60, 'g2', 5, 60);
  const ga = C('globalThis.__g1'), gb = C('globalThis.__g2');
  await C('Materials.gain("合成之石",5);Materials.gain("至尊神石",1)'); await S(80);
  const gsyn = await C(`Merge.synthesize(${ga},${gb},'synth_supreme')`);
  A(gsyn.ok === true && gsyn.isGod === true, '至尊神石 → 必出神级宠');
  const G = C('Config.pet.godPets');
  A(gsyn.baby.growth === G.birthGrowthCap, `神级宠出生成长 = ${G.birthGrowthCap}（超出的折算成系数）`);
  A(gsyn.godStatCoeffBonus >= 0 && gsyn.godStatCoeffBonus <= G.excessStatCoeffMax, `godStatCoeffBonus 在 [0, ${G.excessStatCoeffMax}] 内（实际 ${gsyn.godStatCoeffBonus}）`);
  A(C(`Pet.getStatCoeff(Pet.getPets().find(p=>p.id===${gsyn.baby.id})).atk`) > C('Config.pet.godPets.byName("血月神狐").statCoeff.atk') || gsyn.godStatCoeffBonus === 0,
    'statCoeff 含折算加成（或成长未超上限）');

  console.log(failures ? 'SYNTH GROWTH TESTS FAILED: ' + failures : 'ALL SYNTH GROWTH TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
