/* ============================================================
 * vtest_god_pet.js —— 神级宠系统 + 涅槃重做回归测试（2026-09-06）
 * 依据：《系统重设计·落地执行手册_v1》2.6（神级宠）/ 2.7（涅槃）
 * 覆盖：
 *   1. 神级宠配置：8 只、statCoeff = 普通宠 ×1.5、有 sprite（不回退 emoji）
 *   2. 合成门槛：主副宠都【终阶】+【成长 ≥ minGrowth】
 *   3. 概率：30% 出神级宠；持涅槃丹 100% 且消耗 1 颗
 *   4. 神级宠出生：独立名字/基础值/成长系数、生而为终阶
 *   5. 涅槃：普通宠被拒；神级宠吸收 50%【不衰减】、消耗涅磐兽 5 只、等级重置回 1
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
// 造一只云端在档的宠物：stage=终阶(5)、level=60、growth 可指定
async function mkPet(name, growth, tag, stage, level) {
  stage = stage || 5; level = level || 60;
  await C(`(async()=>{const p=Pet.createPet("${name}","",${growth},100,20,10,8);p.level=${level};p.evolveStage=${stage};p.evolveTimes=${stage - 1};Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__${tag}=p.id})()`);
  await S(60);
}
(async () => {
  // 直接注入会话（vstub 的 client.auth.getUser 读全局 session），不必加载 main.js / UI
  C('session={user:{id:"user-god",email:"god@test.com"}}');
  await S(120);

  /* ============ 1. 神级宠配置 ============ */
  A(C('(Config.pet.godPets.list||[]).length') === 8, '神级宠配置 8 只（每只基宠线 1 只）');
  A(C('(()=>{const G=Config.pet.godPets.list,S=Config.pet.starters;return G.every(g=>{const s=S.find(x=>x.name===g.line);return s&&Math.abs(g.statCoeff.atk-s.statCoeff.atk*1.5)<0.02})})()'),
    '神级宠 statCoeff = 对应普通宠 ×1.5（手册 2.6）');
  A(C('(Config.pet.godPets.list||[]).every(g=>!!g.sprite)'), '每只神级宠都有 sprite（复用终形态立绘，不回退 emoji）');
  A(C('Config.pet.godPets.minGrowth') === 60, '神级宠成长门槛 = 60（手册原值，落地方案 R1）');
  A(C(`(()=>{const s=Config.itemsOf('synth');const g=id=>{const i=s.find(x=>x.id===id);return i?i.godChance:null};return g('synth_stone')===0.3&&g('synth_shift')===0.6&&g('synth_supreme')===1})()`),
    '神级宠概率由合成道具决定：合成之石 30% / 百变魔石 60% / 至尊神石 100%');
  A(C('Config.nirvana.requireGodPet') === true, '涅槃要求神级宠（requireGodPet = true）');
  A(C('Config.nirvana.defaultItem') === 'nir_pill' && C("Config.itemOf('nir_pill').category") === 'nirvana',
    '涅槃消耗已道具化（默认道具 = 涅槃丹，不再消耗涅磐兽）');
  A(C("Config.itemOf('nir_pill').boostMult") === 1.2, '涅槃丹加乘 = 吸收 ×1.2');
  A(C('Config.nirvana.growthCap===undefined && Config.nirvana.capRatio===undefined && Config.nirvana.subGrowthRatio===undefined'),
    '涅槃衰减机制已移除（无 growthCap / capRatio / subGrowthRatio）');

  /* ============ 2. 合成门槛判定 ============ */
  await mkPet('血狐', 60, 'g1', 5, 60);
  await mkPet('腐噜兽', 60, 'g2', 5, 60);
  const a = C('globalThis.__g1'), b = C('globalThis.__g2');
  const info1 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}))`);
  A(info1.ready === true, '终阶 + 成长60：神级宠合成条件满足');
  A(Math.abs(info1.chance - 0.3) < 1e-9, '无涅槃丹时概率 = 30%');
  A(info1.god && info1.god.name === '血月神狐', '血狐线对应的神级宠 = 血月神狐');

  // 副宠成长不足 → 不达标
  C(`Pet.getPets().find(p=>p.id===${b}).growth=59.9`);
  const info2 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}))`);
  A(info2.ready === false && info2.chance === 0, '副宠成长 < 60：不满足神级宠条件');
  C(`Pet.getPets().find(p=>p.id===${b}).growth=60`);
  // 副宠不是终阶 → 不达标
  C(`Pet.getPets().find(p=>p.id===${b}).evolveStage=4`);
  const info3 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}))`);
  A(info3.ready === false && info3.chance === 0, '副宠非终阶（4 阶）：不满足神级宠条件');
  C(`Pet.getPets().find(p=>p.id===${b}).evolveStage=5`);

  /* 100% 出神：第二版手册 2.2 起由【至尊神石】承担（涅槃丹已改为涅槃消耗品） */
  const info4 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}),'synth_supreme')`);
  A(info4.chance === 1, '至尊神石 → 100% 出神级宠');
  const info5 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}),'synth_stone')`);
  A(info5.chance === 0.3, '合成之石 → 30% 出神级宠');
  const info6 = C(`Merge.godSynthInfo(Pet.getPets().find(p=>p.id===${a}),Pet.getPets().find(p=>p.id===${b}))`);
  A(info6.chance === 0.3, '未选合成道具时按默认 30%（兜底）');

  /* ============ 3. 合成出神级宠（概率命中） ============ */
  await C('Materials.gain("合成之石",5)'); await S(80);
  C('const __rnd=Math.random; Math.random=()=>0.1');   // 0.1 < 0.3 → 出神级宠
  const syn = await C(`Merge.synthesize(${a},${b})`);
  C('Math.random=__rnd');
  A(syn.ok === true, '合成执行成功');
  A(syn.isGod === true, '概率命中 → 出神级宠');
  const godId = syn.baby ? syn.baby.id : null;
  A(syn.baby && syn.baby.name === '血月神狐', '神级宠名字 = 血月神狐（独立宠物，不是普通宠进阶）');
  A(syn.baby && syn.baby.isGodPet === true, '神级宠标记 isGodPet = true');
  A(syn.baby && syn.baby.evolveStage === 5, '神级宠生而为终阶（evolveStage = 5）');
  A(syn.baby && syn.baby.lineId === '血月神狐', '神级宠 lineId 指向自己（成长系数走 godPets 表）');
  A(C('Pet.isGodPet(Pet.getPets().find(p=>p.id===' + godId + '))') === true, 'Pet.isGodPet 识别神级宠');
  /* 成长系数：神级宠 = 普通宠 ×1.5，出生成长超过 birthGrowthCap 的部分再按
   * excessStatCoeffRatio 折算成系数加成（封顶 excessStatCoeffMax）。 */
  const gc = C(`Pet.getStatCoeff(Pet.getPets().find(p=>p.id===${godId}))`);
  const sc = C('Config.pet.starters.find(s=>s.name==="血狐").statCoeff');
  const godDef = C('Config.pet.godPets.byName("血月神狐")');
  const G = C('Config.pet.godPets');
  A(Math.abs(godDef.statCoeff.atk - sc.atk * 1.5) < 0.02, `神级宠定义系数 = 普通宠 ×1.5（${godDef.statCoeff.atk} = ${sc.atk}×1.5）`);
  A(syn.baby.growth === G.birthGrowthCap, `神级宠出生成长压到上限 ${G.birthGrowthCap}（超出部分折算成系数）`);
  A(gc.atk >= godDef.statCoeff.atk && gc.atk <= godDef.statCoeff.atk * (1 + G.excessStatCoeffMax) + 0.02,
    `神级宠成长系数含超额折算（atk ${gc.atk}，在 ${godDef.statCoeff.atk} ~ ${(godDef.statCoeff.atk * (1 + G.excessStatCoeffMax)).toFixed(2)} 之间）`);
  A(C('Pet.getBaseSpeed(Pet.getPets().find(p=>p.id===' + godId + '))') === C('Config.pet.speeds["血狐"]'),
    '神级宠速度沿用该线基宠速度');
  A(C('Pet.resolveLineId?1:1') && C('Pet.getBloodline(Pet.getPets().find(p=>p.id===' + godId + '))') !== null,
    '神级宠保留血统被动（resolveLineId 反查基宠线）');

  /* ============ 4. 非命中 → 普通合成（不出神级宠） ============ */
  await mkPet('骨狼', 60, 'n1', 5, 60);
  await mkPet('尸犬', 60, 'n2', 5, 60);
  const n1 = C('globalThis.__n1'), n2 = C('globalThis.__n2');
  C('const __rnd2=Math.random; Math.random=()=>0.9');   // 0.9 > 0.3 → 不中
  const syn2 = await C(`Merge.synthesize(${n1},${n2})`);
  C('Math.random=__rnd2');
  A(syn2.ok === true && syn2.isGod !== true, '概率未命中 → 普通合成（不是神级宠）');
  A(syn2.baby && syn2.baby.isGodPet !== true, '普通合成产物 isGodPet = false');

  /* ============ 5. 神级宠涅槃：吸收 50% 不衰减 ============ */
  await mkPet('毒沼蛙', 70, 'nv1', 5, 60);   // 主宠成长 70（超过旧的 60 分水岭）
  await mkPet('幽影兔', 20, 'nv2', 5, 60);   // 副宠成长 20
  const nv1 = C('globalThis.__nv1'), nv2 = C('globalThis.__nv2');
  // 神级宠标记（mkPet 建的是普通宠，这里手动置为神级宠）
  C(`(()=>{const p=Pet.getPets().find(p=>p.id===${nv1});p.name="毒渊神蟾";p.lineId="毒渊神蟾";p.isGodPet=true})()`);
  A(C('Pet.isGodPet(Pet.getPets().find(p=>p.id===' + nv1 + '))') === true, '主宠已置为神级宠');
  await C('Materials.gain("涅槃丹",3)'); await S(80);
  const before = C('Materials.getQuantity("涅槃丹")');
  const nv = await C(`Merge.nirvana(${nv1},${nv2},false,true)`);   // 用涅槃丹
  A(nv.ok === true, '神级宠涅槃成功');
  A(nv.newGrowth === 82, `吸收 50% 且不衰减、用丹再 ×1.2（70 + 20×0.5×1.2 = ${nv.newGrowth}，旧逻辑会因 70>60 减半）`);
  A(C('Pet.getPets().find(p=>p.id===' + nv1 + ').level') === 1, '涅槃后等级重置回 Lv.1');
  A(C('Pet.getPets().find(p=>p.id===' + nv1 + ').evolveStage') === 5, '神级宠涅槃后仍保持终阶（不会变成无法进化的死宠）');
  A(before - C('Materials.getQuantity("涅槃丹")') === 1, '涅槃消耗涅槃丹 ×1');
  A(C('Pet.getPets().find(p=>p.id===' + nv1 + ').rebornCount') === 1, '转生次数 +1');

  /* ============ 6. 普通宠涅槃被拒 ============ */
  await mkPet('瘟熊', 60, 'nv3', 5, 60);
  await mkPet('疫毛兽', 60, 'nv4', 5, 60);
  const nv3 = C('globalThis.__nv3'), nv4 = C('globalThis.__nv4');
  const before2 = C('Materials.getQuantity("涅槃丹")');
  const nvRej = await C(`Merge.nirvana(${nv3},${nv4},false,true)`);
  A(nvRej.ok !== true && /神级宠/.test(nvRej.error), '普通宠（终阶也不行）涅槃被拒并给出提示');
  A(C('Materials.getQuantity("涅槃丹")') === before2, '被拒时不扣涅槃丹');

  /* ============ 7. 涅槃失败路径：整单回滚（2026-09-11 审计第 2 批）============
   * 旧顺序是「先删副宠（不可逆）→ 再更新主宠」，两种失败都会出事：
   *   · 更新主宠失败 → 副宠已永久删除、成长没涨，函数却仍返回 {ok:true}（玩家白亏一只副宠）
   *   · 删副宠失败   → 主宠照样涨，同一只副宠能被再吃一次（白刷成长）
   * 现在要求：更新失败 = 副宠还在 + 道具退回；删副宠失败 = 主宠写回旧值 + 道具退回。 */
  const mkGod = async (name, growth, tag) => {
    await mkPet(name, growth, tag, 5, 60);
    C(`(()=>{const p=Pet.getPets().find(p=>p.id===globalThis.__${tag});p.name="毒渊神蟾";p.lineId="毒渊神蟾";p.isGodPet=true})()`);
    return C(`globalThis.__${tag}`);
  };
  const gainAndFlush = async (name, n) => { await C(`Materials.gain("${name}",${n})`); await S(80); };

  // 7a. 更新主宠失败 → 副宠没动，零损失
  const f1m = await mkGod('毒沼蛙', 70, 'f1a');
  await mkPet('幽影兔', 20, 'f1b', 5, 60);
  const f1s = C('globalThis.__f1b');
  await gainAndFlush('涅槃丹', 3);
  const pillB1 = C('Materials.getQuantity("涅槃丹")');
  const growB1 = C(`Pet.getPets().find(p=>p.id===${f1m}).growth`);
  C('globalThis.__upBak = Supabase.updatePet; Supabase.updatePet = async () => ({ error: new Error("模拟云端更新失败") })');
  const f1 = await C(`Merge.nirvana(${f1m},${f1s},false,true)`);
  C('Supabase.updatePet = globalThis.__upBak');
  A(f1.ok !== true && /未生效/.test(String(f1.error)), '更新主宠失败 → 如实报错（不再谎报 ok）');
  A(C('Materials.getQuantity("涅槃丹")') === pillB1, '更新主宠失败 → 涅槃丹已退回');
  A(C(`Pet.getPets().find(p=>p.id===${f1m}).growth`) === growB1, '更新主宠失败 → 主宠成长未改动');
  A(C(`Pet.getPets().some(p=>p.id===${f1s})`) === true, '更新主宠失败 → 副宠仍在（零损失）');

  // 7b. 删副宠失败 → 主宠写回旧值，防止同一只副宠被再吃一次
  const f2m = await mkGod('毒沼蛙', 70, 'f2a');
  await mkPet('幽影兔', 20, 'f2b', 5, 60);
  const f2s = C('globalThis.__f2b');
  await gainAndFlush('涅槃丹', 3);
  const pillB2 = C('Materials.getQuantity("涅槃丹")');
  const growB2 = C(`Pet.getPets().find(p=>p.id===${f2m}).growth`);
  C('globalThis.__delBak = Supabase.deletePet; Supabase.deletePet = async () => ({ data: null, error: new Error("模拟删除失败") })');
  const f2 = await C(`Merge.nirvana(${f2m},${f2s},false,true)`);
  C('Supabase.deletePet = globalThis.__delBak');
  A(f2.ok !== true && /回滚/.test(String(f2.error)), '删副宠失败 → 报错并说明已回滚');
  A(C('Materials.getQuantity("涅槃丹")') === pillB2, '删副宠失败 → 涅槃丹已退回');
  A(C(`Pet.getPets().find(p=>p.id===${f2m}).growth`) === growB2, '删副宠失败 → 主宠成长已回滚（防白刷）');
  A(C(`Pet.getPets().some(p=>p.id===${f2s})`) === true, '删副宠失败 → 副宠仍在');

  /* ============ 8. 进化并发闸门（2026-09-11 审计第 2 批）============
   * evolve 原本没有模块级 inFlight（nirvana/synthesize/cultivate 都有），
   * UI 的 disabled 只按「能不能进化」置灰、点击后不禁用 → 连点并发
   * → 素材扣两份、成长只涨一次（白亏一份素材）。 */
  await mkPet('血狐', 10, 'evo1', 1, 10);
  const evoId = C('globalThis.__evo1');
  await gainAndFlush(C(`Evolve.getEvoTier(Pet.getPets().find(p=>p.id===${evoId}))`), 6);
  C('globalThis.__upBak2 = Supabase.updatePet; Supabase.updatePet = () => new Promise(r => setTimeout(() => r({ data: null, error: null }), 150))');
  const e1 = C(`Evolve.evolve(${evoId},0)`);
  const e2 = C(`Evolve.evolve(${evoId},0)`);
  const [er1, er2] = await Promise.all([e1, e2]);
  C('Supabase.updatePet = globalThis.__upBak2');
  A(!!(er2 && /进行中/.test(String(er2.error))), '进化并发第二次被闸门挡住（不再重复扣素材）');
  A(!!(er1 && er1.ok === true), '第一次进化正常完成');

  /* ============ 9. updatePet 的 verify 选项（2026-09-11 审计第 3 批）============
   * 不带 .select() 时，「行不存在」和「更新成功」都表现为 {data:null,error:null}。
   * verify:true 才加 .select('id') 并把 0 行转成明确错误 —— 只给「先扣东西、后写云端」
   * 的不可逆链条用（涅槃/进化/培育/打造/魂铸），其余调用点行为不变。 */
  const gone = '00000000-0000-0000-0000-000000000000';
  const noRow = await C(`Supabase.updatePet("${gone}", { growth: 1 }, { verify: true })`);
  A(!!(noRow && noRow.error && /不在你的存档/.test(String(noRow.error.message))),
    'verify:true 更新不存在的行 → 明确报错（不再静默成功）');
  const noVerify = await C(`Supabase.updatePet("${gone}", { growth: 1 })`);
  A(!!(noVerify && !noVerify.error), '不开 verify 时保持原行为（不打扰其余 11 个调用点）');
  const evoCloud = C(`Pet.getPets().find(p=>p.id===${evoId}).cloudId`);
  const okRow = await C(`Supabase.updatePet("${evoCloud}", { growth: 5 }, { verify: true })`);
  A(!!(okRow && !okRow.error), 'verify:true 更新存在的行 → 正常成功（不误报）');

  console.log(failures ? 'GOD PET TESTS FAILED: ' + failures : 'ALL GOD PET TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
