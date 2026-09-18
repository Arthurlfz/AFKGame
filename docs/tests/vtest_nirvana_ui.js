// vtest_nirvana_ui.js —— 涅槃预览区【真的渲染一遍】（2026-09-17）
//
// 守的是什么：涅槃页一选中主宠，预览区必须能渲染出来、两个复选框都得绑上事件。
//
// 背景（用户 F12 实测报的）：
//   ui-pet-merge.js 的 renderMergePreview 里写着 `if (lockCheck) {...}`，
//   但 lockCheck 从来没有声明过（漏了 const lockCheck = document.getElementById('nir-lock-check')）
//   ⇒ 一选中主宠就 `Uncaught ReferenceError: lockCheck is not defined`，
//     整块预览 + 确认涅槃按钮都不出来（页面看着像"点不动"）。
//
// ⚠️ 为什么以前所有测试都没抓到：
//   renderAll() 每次都调 renderMergeTab()，但那时 mergeMainId 是 null，
//   renderMergeStage 在 `if (!main)` 就早退了 —— **预览那段代码从来没被执行过**。
//   node 测试测的是数据层，浏览器才跑得到 UI 绑定块。
//   ⇒ 这类"只在浏览器路径里才跑"的错误必须用【真的选一只主宠 + 真的渲染】来钉
//     （同「SQL 函数要真的调一次」那个教训：静态检查抓不到运行期才炸的东西）。
//
// 局限（知道就行）：本测试的 document.getElementById 桩会自动造元素，
//   所以它抓得到"变量没声明/调用了不存在的接口"，抓不到"id 名字打错"。
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
// 抓异常渲染：旧代码这里会 ReferenceError（正是用户报的那个）
function render(fn, label) {
  try { C(fn); return null; } catch (e) { return (label || fn) + ' 抛异常：' + (e && (e.message || e)); }
}
(async () => {
  await S(300); await C('Game.onLogin("nir@test.com","123456")'); await S(300);

  /* ---------- 0. 造一只神级主宠 + 一只合格副宠 ---------- */
  await C(`(function(){
    const main = Pet.createPet('血月神狐', null, 75, 120, 40, 12, 100, '血月神狐');
    main.level = 60; main.isGodPet = true; main.evolveStage = 5; main.cloudId = 'c-main';
    Pet.addPet(main);
    // 神级副宠：2026-09-17 用户拍板「之后肯定是神宠互相吃」→ 神级宠必须能当副宠，
    // 而且必须在界面上一眼看出是神级（下面有断言钉住这两条，别再"顺手"把它们过滤掉）
    const godSub = Pet.createPet('血月神狐', null, 88, 120, 40, 12, 100, '血月神狐');
    godSub.level = 60; godSub.isGodPet = true; godSub.evolveStage = 5; godSub.cloudId = 'c-godsub';
    godSub.traits = [{ id: Object.keys(Config.petTraits)[0], tier: 2 }];
    Pet.addPet(godSub);
    const sub = Pet.createPet('疫毛兽', null, 40, 100, 30, 10, 90, '疫毛兽');
    sub.level = 60; sub.cloudId = 'c-sub';
    Pet.addPet(sub);
    // 一只【等级不够】的宠：它绝不能出现在副宠候选里（涅槃门槛 60 级）
    const low = Pet.createPet('低等级陪练', null, 20, 80, 20, 8, 80, '骨狼');
    low.level = 40; low.cloudId = 'c-low';
    Pet.addPet(low);
    globalThis.__mainId = main.id; globalThis.__subId = sub.id;
  })()`);
  A(C('Merge.canNirvanaMain(Pet.getPets().find(p=>p.id===globalThis.__mainId))') === true,
    '造出来的神级宠是合格主宠（Lv60 + 已存档）');

  /* ---------- 1. 打开涅槃页：不选中主宠时必须正常（旧代码在这里不炸，炸在后面） ---------- */
  A(!render('UI.renderMergeTab()'),
    '① 打开涅槃页（未选主宠）不抛异常');
  const list = els['merge-pet-list'];
  A(!!list && list.children.length > 0, '主宠列表渲染出至少一张卡（神级宠能选 —— 上一个 bug 的守值）');

  /* ---------- 2. 选中主宠 → 预览区渲染（用户报的崩点） ---------- */
  const card = list.children[0];
  A(typeof card.onclick === 'function', '主宠卡绑定了点击事件');
  const clickErr = (() => { try { card.onclick(); return null; } catch (e) { return e && (e.message || e); } })();
  A(!clickErr, '② 选中主宠后整条渲染链不抛异常' + (clickErr ? '（' + clickErr + '）' : ''));
  A(els['merge-preview'].innerHTML.includes('吸收成长'), '预览区渲染出「吸收成长」（预览不是空的）');
  A(els['merge-confirm'].innerHTML.includes('确认涅槃'), '确认涅槃按钮渲染出来');

  /* ---------- 3. 两个复选框的事件都真的绑上了（lockCheck 那个没声明的变量就在这） ---------- */
  // 上面的渲染崩了的话这两个元素根本不会被创建 → 用 {} 兜底，让报告停在"没绑上"这条，而不是抛 TypeError
  const pillCheck = els['nir-pill-check'] || {}, lockCheck = els['nir-lock-check'] || {};
  A(typeof pillCheck.onchange === 'function', '涅槃丹复选框绑定了 onchange');
  A(typeof lockCheck.onchange === 'function', '锁魂玉复选框绑定了 onchange（漏写 lockCheck 声明 = 这里报错）');

  /* ---------- 4. 勾选后真的生效（不只是"没崩"） ---------- */
  C('Materials.gain(Config.itemOf("nir_pill").name, 3); Materials.gain(Config.itemOf("nir_lock").name, 3)');
  const fire = (box) => { try { box.checked = true; box.onchange(); return null; } catch (e) { return e && (e.message || e); } };
  const lockErr = fire(lockCheck);
  A(!lockErr, '点「锁魂玉」复选框不抛异常' + (lockErr ? '（' + lockErr + '）' : ''));
  A(els['merge-preview'].innerHTML.includes('nir-lock-trait'),
    '勾选锁魂玉后预览里出现「定向植入」特质下拉（useLock 真的生效，不只是没崩）');

  const pillErr = fire(pillCheck);
  A(!pillErr, '点「涅槃丹」复选框不抛异常' + (pillErr ? '（' + pillErr + '）' : ''));
  A(els['merge-preview'].innerHTML.includes('×1.2'),
    '勾选涅槃丹后预览显示吸收倍率 ×1.2（倍率真的进了预览）');

  /* ---------- 5. 副宠候选门槛：界面说"需要 60 级"，候选就必须真按 60 级筛 ---------- */
  const minLv = C('(Config.nirvana||{}).minLevel');
  A(!els['merge-sub-box'].innerHTML.includes('低等级陪练'),
    `副宠候选里没有 Lv.40 那只（涅槃门槛 Lv.${minLv}，界面提示与候选口径一致）`);
  A(els['merge-sub-box'].innerHTML.includes('疫毛兽'),
    '合格的 Lv.60 副宠出现在候选里');
  A(C('Merge.getMergeCandidates(globalThis.__mainId, Config.nirvana).length') === 2,
    '传入涅槃配置时候选只按 Lv.60 筛（默认 40 会让门槛形同虚设）');

  /* ---------- 6. 神级宠可以当副宠（2026-09-17 用户拍板：「之后肯定是神宠互相吃」） ---------- */
  A(C('Merge.getMergeCandidates(globalThis.__mainId, Config.nirvana).some(p=>p.isGodPet)'),
    '神级宠出现在副宠候选里（神宠互相吃是正经玩法，不许"顺手"过滤掉）');
  A(els['merge-sub-box'].innerHTML.includes('神级'),
    '副宠卡片标出「神级」（要喂掉的是一只神宠，必须一眼看得出）');
  A(els['merge-preview'].innerHTML.includes('★ 神级'),
    '底部确认条也标出「★ 神级」（确认前看得见自己喂掉的是什么）');

  console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
