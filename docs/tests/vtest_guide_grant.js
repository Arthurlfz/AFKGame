// 新手引导「发放层」重构回归（2026-09-08）——防"重登重复领取"
//  - 云端就绪门闩：任务进度没拉完，checkGuide 不做任何发放
//  - 补给箱一次性：花掉钥匙后重跑 checkGuide 不再补（靠账本，不是旧库存差量）
//  - 手动补发：只补当前关缺的钥匙，每关每种限 1 次（账本）
//  - 分档经验包：发放 → 背包使用 → 档位锁死不超；同档关卡不重发
//  - 账本严格写：云端写失败不发货；账本幂等查重
//  - resetGuideChain 管理员鉴权（控制台不再能随便调）
// 复用 vstub.js 的 VM 桩；云端进度存取用可控桩（能模拟写失败）
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() { }, remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/quest.js', '../js/core/tutorial_mode.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);
const Q = async code => await C(code);

// 可控云端进度桩：__qp 存整行 JSON；__qpFail 置位时写失败（模拟断网/超时）
C(`globalThis.__qp = null; globalThis.__qpFail = false;
Supabase.saveQuestProgress = async (data) => {
  if (globalThis.__qpFail) return { data: null, error: { message: '模拟云端写失败' } };
  globalThis.__qp = JSON.parse(JSON.stringify(data));
  return { data: null, error: null };
};
Supabase.fetchQuestProgress = async () => ({ data: globalThis.__qp ? JSON.parse(JSON.stringify(globalThis.__qp)) : null, error: null });
// UI 桩（tutorial_mode 只读 getAuthUser，不引 UI 模块）
window.UI = { getAuthUser: () => ({ email: 'player@test.com', id: 'u1' }), addLog: () => {}, showToast: () => {}, renderAll: () => {} };
globalThis.__matQty = name => Materials.getQuantity(name);
true`);

(async () => {
  /* ---------- 登录（材料 spend / 装备 saveItem 都要登录态） ---------- */
  const li = await Q(`Supabase.signIn('player@test.com', 'x')`);
  A(li && !li.error, '测试账号已登录（材料扣减/装备存档需要登录态）');

  /* ---------- 准备：一只 Lv1 出战宠（新号选宠后状态） ---------- */
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,40,'腐噜兽');Pet.addPet(p);Pet.setActive(p.id);return true})()`);
  A(C(`Pet.getPets().length`) === 1, '账号下 1 只宠（Lv1 出战宠）');

  /* ---------- 门闩：云端进度没拉完 → 不发放 ---------- */
  await Q(`TutorialMode.checkGuide()`);
  A(C(`__matQty('重铸石')`) === 0, '云端未就绪：checkGuide 不发补给箱（门闩生效）');
  A(C(`!TutorialMode.ledgerOf().supplyBox`), '云端未就绪：账本无 supplyBox 记录');

  /* ---------- 首次 checkGuide：整箱 + 初阶经验包 一次性发放 ---------- */
  await Q(`Quest.loadCloudProgress()`);
  A(C(`Quest.isCloudLoaded()`) === true, '云端进度已拉取（isCloudLoaded 门闩放行）');
  await Q(`TutorialMode.checkGuide()`);
  A(C(`__matQty('重铸石')`) >= 1, '补给箱到账：重铸石 ×1（G4 钥匙）');
  A(C(`__matQty('传说进化素材')`) >= 5, '补给箱到账：传说进化素材 ×5（G9 钥匙）');
  A(C(`__matQty('腐噜兽蛋') || (Drop.getEggCountOf ? Drop.getEggCountOf('腐噜兽') : 0)`) >= 1, '补给箱到账：腐噜兽蛋 ×1（G6 钥匙）');
  A(C(`Pet.getPets().length`) >= 3, '补给箱到账：素材宠补到 3 只（G7 合成要吃 2 只）');
  A(C(`__matQty('初阶经验包')`) === 1, '初阶经验包到账 ×1（真实道具，不再是隐式顶等级）');
  A(C(`Pet.getActivePet().level`) === 1, '经验包发放 ≠ 自动升级：宠还是 Lv1，等玩家自己用');

  /* ---------- 核心回归：花掉钥匙后重跑 checkGuide → 不再补（旧版在这里无限刷） ---------- */
  await Q(`Materials.spend('重铸石', 1)`);
  A(C(`__matQty('重铸石')`) === 0, '玩家把重铸石花掉了（模拟 G4 打造消耗）');
  await Q(`TutorialMode.checkGuide()`);
  A(C(`__matQty('重铸石')`) === 0, '重跑 checkGuide 不再补发（账本 supplyBox 已记账，差量补齐已退役）');
  A(C(`__matQty('传说进化素材')`) === 5, '同样不重发：传说进化素材维持 5 个（旧版重登可无限刷）');

  /* ---------- 手动补发：只补当前关缺的钥匙，每关每种限 1 次 ---------- */
  // 当前引导关是 g1（等级任务）：先把宠顶到 Lv10 并交任务，推进到 g2（进化素材 · 缺）
  A(C(`(Quest.getGuideQuest() || {}).id`) === 'g1', '引导条当前指向 g1');
  const ur = await Q(`TutorialMode.useExpPack('初阶经验包')`);
  A(ur && ur.ok, '使用初阶经验包成功');
  A(C(`Pet.getPets().every(p => p.level >= 10)`), '全宠直升 Lv10（档位锁死：≤10 的顶到 10，不超）');
  A(C(`__matQty('初阶经验包')`) === 0, '经验包用掉即消耗（真实道具语义）');
  const r1 = await Q(`Quest.completeQuest('g1')`);
  A(r1 && r1.ok, '提交 g1 成功（等级达标）');
  A(C(`(Quest.getGuideQuest() || {}).id`) === 'g2', '引导条推进到 g2');
  // g2 需要 进化素材 ×1：箱子发 1 + g1 奖励送 1，全部花掉制造缺口
  await Q(`Materials.spend('进化素材', Materials.getQuantity('进化素材'))`);
  A(C(`TutorialMode.missingKeysFor('g2').length`) >= 1, 'missingKeysFor 只读检测：g2 缺 进化素材');
  const ri1 = await Q(`TutorialMode.reissueKeys('g2')`);
  A(ri1 && ri1.ok && ri1.granted && ri1.granted.length > 0, '手动补发成功：' + ((ri1.granted || []).join('、') || ''));
  A(C(`__matQty('进化素材')`) >= 1, '补发到账：进化素材 ×1');
  const ri2 = await Q(`TutorialMode.reissueKeys('g2')`);
  A(!(ri2 && ri2.ok && ri2.granted && ri2.granted.length), '同一把钥匙第二次补发被账本拦下（每关每种限 1 次）');
  A(C(`__matQty('进化素材')`) === 1, '补发被拦后材料不增加（不能靠补钥匙刷）');
  const ri3 = await Q(`TutorialMode.reissueKeys('g9')`);
  A(ri3 && ri3.error, '非当前引导关拒绝补发（g9 不是当前关）');

  /* ---------- 同档不重发：g1/g2 同为 Lv10，共用一份初阶包 ---------- */
  await Q(`TutorialMode.checkGuide()`);
  A(C(`__matQty('初阶经验包')`) === 0, '进 g2（同为 Lv10 档）不再重发初阶经验包（账本 expPack:10）');

  /* ---------- 分档配置与使用守卫 ---------- */
  A(C(`TutorialMode.expPackFor(10).name`) === '初阶经验包' && C(`TutorialMode.expPackFor(60).cap`) === 60, '档位映射正确：boostLevel 10/40/60 → 初/中/终阶');
  const again = await Q(`(async()=>{ await Materials.gain('初阶经验包',1); return TutorialMode.useExpPack('初阶经验包'); })()`);
  A(again && !again.ok && /≥ Lv10|别浪费/.test(again.error || ''), '档位锁死守卫：全宠已 ≥ Lv10 时使用被拒（' + ((again && again.error) || '') + '）');
  const nope = await Q(`TutorialMode.useExpPack('中阶经验包')`);
  A(nope && !nope.ok, '没有该档道具时使用被拒');

  /* ---------- 账本：幂等查重 + 严格写失败不发货 ---------- */
  C(`globalThis.__ran = 0`);
  const g1r = await Q(`TutorialMode.grantOnce('ledger-test', async () => { globalThis.__ran++; })`);
  A(g1r && g1r.ok && C(`globalThis.__ran`) === 1, 'grantOnce 首次发放成功');
  const g1r2 = await Q(`TutorialMode.grantOnce('ledger-test', async () => { globalThis.__ran++; })`);
  A(g1r2 && !g1r2.ok && C(`globalThis.__ran`) === 1, 'grantOnce 幂等：同 keyId 第二次被拒，发货函数未执行');
  C(`globalThis.__qpFail = true`);
  const g2r = await Q(`TutorialMode.grantOnce('ledger-fail', async () => { globalThis.__ran += 10; })`);
  A(g2r && !g2r.ok && C(`globalThis.__ran`) === 1, '云端写失败（strict）→ 不发货（宁可少拿，不可重发）');
  C(`globalThis.__qpFail = false`);
  // 失败未落云端 → 同会话内存仍挡（保守），重载后（以云端为准）可自愈再发
  const g2r2 = await Q(`TutorialMode.grantOnce('ledger-fail', async () => { globalThis.__ran += 10; })`);
  A(g2r2 && !g2r2.ok, '同会话仍拦截（内存记账保守挡重发）');
  await Q(`(async()=>{ Quest.reset(); globalThis.__qp = null; await Quest.loadCloudProgress(); })()`);
  const g3r = await Q(`TutorialMode.grantOnce('ledger-fail', async () => { globalThis.__ran += 10; })`);
  A(g3r && g3r.ok && C(`globalThis.__ran`) === 11, '重载后自愈：云端确实没有这条账 → 可再发');

  /* ---------- 根因回归：经验包顶等级必须 update，不得 INSERT 复制宠 ---------- */
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,40,'腐噜兽');Pet.addPet(p);globalThis.__fodder=p;return true})()`);
  await Q(`(async()=>{ const r = await Supabase.savePet(globalThis.__fodder); if (r.data && r.data.id) globalThis.__fodder.cloudId = r.data.id; })()`);
  const rowsAfterInsert = C(`petsTable.length`);
  const br2 = await Q(`TutorialMode.boostGuidePetToLevel(10)`);
  A(br2 && br2.ok, 'boostGuidePetToLevel 把 Lv1 素材宠顶到 Lv10');
  A(C(`petsTable.length`) === rowsAfterInsert, '顶等级后云端行数不变（update 而非 INSERT——2026-09-08 复制宠根因回归）');
  A(C(`petsTable.find(x => x.id === __fodder.cloudId).level`) === 10, '云端该宠等级已更新为 10（同一行）');

  /* ---------- resetGuideChain 管理员鉴权 ---------- */
  const deny = C(`Quest.resetGuideChain()`);
  A(deny && deny.error, '非管理员调用 resetGuideChain 被拒（' + ((deny && deny.error) || '') + '）');
  C(`UI.getAuthUser = () => ({ email: '776492620@qq.com', id: 'admin' })`);
  const allow = C(`Quest.resetGuideChain()`);
  A(allow === true, '管理员账号放行（与 grant_gems 同一套 adminEmails）');

  console.log('\nALL GUIDE GRANT TESTS PASSED');
})().catch(e => { console.error('FAIL: 测试异常', e); process.exit(1); });
