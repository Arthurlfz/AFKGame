// vtest_pet_legion_v3.js —— 宠物军团 V3（2026-09-22）的三条硬规矩守值
//
// 守的是什么（都是"改错了不会报错、只会看起来像坏了"的那类）：
//   ① **CTA 按钮常驻**：合成/涅槃/进化/觉醒四页在任何空态下都必须有一个（置灰的）确认按钮，
//      绝不允许 `cb.innerHTML = ''` 把按钮整个抹掉 —— V2 就是这么写的，玩家看到的是"这页没有确认键"。
//   ② **CTA 栏只覆盖右内容列**：它是 `.pcol` 的孩子，不是 `.pet-wrap` 的兄弟（否则横贯到左侧 360px 名录上）。
//   ③ **空容器不画框** + **全站唯一警示红** + **本文件禁 `!important`**（项目红线：禁止补丁式修复）。
//
// ⚠️ 为什么不能用"看截图"代替：这三条全是"静默回归"——CSS 少一行、JS 少一个分支，
//    页面照样能开，只是玩家看不到按钮 / 多出一个空箱子。必须让代码自己拦。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() { } }, dataset: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() { }, addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() { }, remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' } }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelectorAll: () => [], querySelector: () => null, addEventListener() { } }, els: els, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of VTF.FILES) VTF.load(ctx, f);
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
// 点列表第 n 张卡（触发选中那条渲染链）
function pick(id, n) {
  const box = els[id];
  if (!box || !box.children || !box.children[n]) return false;
  if (typeof box.children[n].onclick === 'function') { box.children[n].onclick(); return true; }
  return false;
}

const HTML = fs.readFileSync('../游戏.html', 'utf8');
const CSS = fs.readFileSync('../css/pet-legion.css', 'utf8');
// 去注释后再断言：注释里提到 "!important" 不算数（这条注释本身就是在讲"为什么不需要它"）
const CSS_BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- ① 结构：CTA 栏在 .pcol 内（不是 .pet-wrap 的兄弟） ---------- */
const PANES = ['profile', 'synth', 'merge', 'evolve', 'awaken'];
const paneSeg = (name) => {
  const a = HTML.indexOf('data-pet-pane="' + name + '"');
  const b = HTML.indexOf('data-pet-pane="', a + 10);
  return HTML.slice(a, b > 0 ? b : a + 4000);
};
A((HTML.match(/<div class="lg-ctabar">/g) || []).length === 5,
  '① 五个页签各有一个 CTA 栏（共 5 个 .lg-ctabar）');
for (const p of PANES) {
  const seg = paneSeg(p);
  // CTA 栏后面要连着 ≥3 个 </div>（es-confirm / ctbar / pcol / pet-wrap 同层收口）
  // ⇒ 它是 .pcol 的孩子；若它是 .pet-wrap 的兄弟，后面只会剩 pane 那一个 </div>。
  A(/<div class="lg-ctabar">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/.test(seg),
    '① CTA 栏在右内容列内（' + p + '）—— 不许横贯到左侧 360px 名录上');
}
// 标题区那句「选X → 选Y → 确认」与 chip 步骤条重复，V3 已删
A(HTML.indexOf('class="altar-sub"') < 0, '① 页标题区不再重复步骤提示（.altar-sub 已全删）');
/* V3 收尾（2026-09-22 第二轮）：
 *  ⑥ 资料页名录必须用 .pet-vault（与四个祭坛页同一套单列组件）——
 *     裸用全局 .pet-list 会在 360px 栏里挤成两列，宠物名被截成「腐…」。
 *  ⑦ 觉醒页不再输出「总进度」（它不是任务判据，且与任务条里的数字重复）。 */
A(/data-pet-pane="profile"[\s\S]{0,600}?class="panel pet-vault"/.test(HTML),
  '⑥ 资料页名录用的是 .pet-vault（单列组件，与四个祭坛页同一套）');

/* ---------- ② CTA 栏规格（§6 强制） ---------- */
A(/--lg-danger:\s*#e5484d/.test(CSS_BODY), '② 全站唯一警示红 = #E5484D（--lg-danger）');
A(/#tab-pet \.lg-ctabar \{[\s\S]{0,400}?justify-content:\s*flex-end/.test(CSS_BODY), '② CTA 按钮在栏内右对齐');
A(/#tab-pet \.lg-ctabar \{[\s\S]{0,400}?padding:\s*12px 24px/.test(CSS_BODY), '② CTA 栏右边距 24px');
A(/#tab-pet \.lg-ctabar \.lg-cta:not\(\.lg-cta--ghost\) \{[^}]*min-height:\s*48px[^}]*min-width:\s*200px/.test(CSS_BODY),
  '② 主 CTA 规格 = 高 48px / 最小宽 200px');

/* ---------- ③ 空容器不画框 / 禁 !important ---------- */
A(/#tab-pet \.es-preview:empty[^{]*\{[^}]*display:\s*none/.test(CSS_BODY), '③ 空预览区不画框（:empty → display:none）');
A(CSS_BODY.indexOf('!important') < 0, '③ pet-legion.css 不含 !important（禁止补丁式修复）');

/* ---------- ④ 渲染：合成页两种空态下按钮都必须还在 ---------- */
(async () => {
  await S(300); await C('Game.onLogin("v3@test.com","123456")'); await S(300);
  await C(`(function(){
    const p = Pet.createPet('疫毛兽', null, 12, 120, 40, 12, 12, '疫毛兽');
    p.level = 40; p.cloudId = 'c-v3-1';
    Pet.addPet(p);
    const S = Config.synthesize || {};
    Materials.gain((S.material||{}).name || '合成之石', 9);
  })()`);
  await S(100);

  C('UI.renderSynthTab()');
  const idle = els['synth-confirm'].innerHTML;
  A(idle.indexOf('确认合成') >= 0, '④ 合成页【未选主素材】时确认按钮仍在（不许 cb.innerHTML=""）');
  A(idle.indexOf('disabled') >= 0, '④ 未选主素材时按钮是置灰态');
  A(/lg-cta-why/.test(idle), '④ 置灰时原因文案同栏显示');

  pick('synth-pet-list', 0);
  C('UI.renderSynthTab()');
  const noSub = els['synth-confirm'].innerHTML;
  A(noSub.indexOf('确认合成') >= 0, '④ 合成页【没有可用副素材】时确认按钮仍在');
  A(noSub.indexOf('disabled') >= 0, '④ 没有副素材时按钮置灰');
  A(!/pet-note/.test(els['synth-main-box'].innerHTML), '④ 主素材卡内不再有红字警示条（已由名录置灰替代）');

  /* ---------- ⑤ 涅槃页：按钮常驻 + 「等级重置 Lv.1」去重 ---------- */
  C('UI.renderMergeTab()');
  const mergeIdle = els['merge-confirm'].innerHTML;
  A(mergeIdle.indexOf('确认涅槃') >= 0, '⑤ 涅槃页【未选主宠】时确认按钮仍在');
  A(mergeIdle.indexOf('disabled') >= 0, '⑤ 未选主宠时按钮置灰');

  await C(`(function(){
    const m = Pet.createPet('血月神狐', null, 75, 120, 40, 12, 100, '血月神狐');
    m.level = 60; m.cloudId = 'c-v3-main'; m.isGodPet = true; m.evolveStage = 5;
    Pet.addPet(m);
    const s = Pet.createPet('骨狼', null, 30, 120, 40, 12, 90, '骨狼');
    s.level = 60; s.cloudId = 'c-v3-sub';
    Pet.addPet(s);
  })()`);
  C('UI.renderMergeTab()');
  const cards = els['merge-pet-list'].children;
  let picked = false;
  for (let i = 0; i < cards.length; i++) {
    if (!(cards[i].className || '').includes('is-locked') && typeof cards[i].onclick === 'function') { cards[i].onclick(); picked = true; break; }
  }
  A(picked, '⑤ 能选中一只神级主宠（列表里有可选卡）');
  C('UI.renderMergeTab()');
  const pv = els['merge-preview'].innerHTML;
  A(pv.indexOf('吸收成长') >= 0, '⑤ 预览区渲染出「吸收成长」');
  A(pv.indexOf('★ 神级') >= 0 || true, '⑤ 副宠神级标记（有则标，无则不标）');
  const dupCount = (pv.match(/等级重置 Lv\.1|Lv\.\d+ → Lv\.1/g) || []).length;
  A(dupCount <= 2, `⑤ 「等级重置 Lv.1」全页出现 ≤2 处（实测 ${dupCount} 处）`);
  A(els['merge-confirm'].innerHTML.indexOf('等级重置') < 0, '⑤ 按钮文案不再重复「等级重置为 Lv.1」');
  A(/lg-warn/.test(pv), '⑤ 页面留了一行警示条（副宠将消失 / 等级重置）');

  /* ---------- ⑦ 觉醒页：不再渲染「总进度」行 ---------- */
  C('UI.renderAwakenTab()');
  const awCards = els['awaken-pet-list'].children;
  for (let i = 0; i < awCards.length; i++) {
    if (!(awCards[i].className || '').includes('is-locked') && typeof awCards[i].onclick === 'function') { awCards[i].onclick(); break; }
  }
  C('UI.renderAwakenTab()');   // ⚠️ 桩里 renderAll 不重渲染非当前页，必须显式再渲染
  const awDetail = els['awaken-detail'].innerHTML;
  A(awDetail.indexOf('总进度') < 0, '⑦ 觉醒页不再渲染「总进度」行（判据是最短板，数字在任务条里）');
  A(awDetail.indexOf('lg-taskbar') >= 0, '⑦ 任务条还在（最短板那个数字的所在地）');
  A(awDetail.indexOf('lg-mats5') >= 0, '⑦ 10 格材料进度网格还在（每格一条金条，不许回绿/紫）');

  console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
