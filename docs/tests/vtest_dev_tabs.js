// vtest_dev_tabs.js —— 开发者面板「页签注册契约」守值（2026-09-17）
//
// 守的是什么：**给开发者面板加一个页签时，不会再因为不懂契约而白屏。**
//
// 背景（当天真踩的坑）：ui-dev.js 的 runtime 契约是
//   html += panels[activeTab]()      ← 同步拼串，所以 render() 必须【无参、同步返回 HTML 字符串】
//   binders[activeTab]()             ← 无条件调用，所以 bind() 【必须提供】
// 我第一版写成 `render(host)` 里直接改 DOM、且没写 bind，结果是：
//   · binders[activeTab] is not a function
//   · Cannot set properties of undefined (setting 'innerHTML')
//   · async render 更糟：会被拼成 "[object Promise]"
// 单元测试当时没抓到（桩里 getElementById 返回假元素、也没人点这一页），
// 所以改成**源码级契约检查**：这条规则是静态可判的。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI_DIR = path.join(ROOT, 'js', 'ui');
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

const devSrc = fs.readFileSync(path.join(UI_DIR, 'ui-dev.js'), 'utf8');

/* ---------- ① runtime 契约本身没被改掉 ---------- */
A(/panels\[activeTab\]\s*\(\)/.test(devSrc),
  'ui-dev.js 仍然用 `panels[activeTab]()` 同步取 HTML（render 必须同步返回字符串）');
A(/binders\[activeTab\]\s*\(\)/.test(devSrc),
  'ui-dev.js 仍然无条件调 `binders[activeTab]()`（bind 必须存在）');

/* ---------- ② 每个 ext 页签都有对应文件，且 render/bind 齐全 ---------- */
// TABS 里 ext:true 的条目 = 由外部文件注册
// ⚠️ 必须用 [^}] 而不是 [\s\S]，否则会跨过 `}` 把后面那条的 ext:true 算到前一条头上
const extIds = [...devSrc.matchAll(/\{\s*id:\s*'([\w-]+)'[^}]{0,240}?ext:\s*true\s*\}/g)].map(m => m[1]);
A(extIds.length > 0, 'TABS 里存在 ext 外部页签（共 ' + extIds.length + ' 个：' + extIds.join('、') + '）');

const extFiles = fs.readdirSync(UI_DIR).filter(f => /^ui-dev-.*\.js$/.test(f));
const sources = extFiles.map(f => ({ f, src: fs.readFileSync(path.join(UI_DIR, f), 'utf8') }));

extIds.forEach(id => {
  const hit = sources.filter(s => new RegExp("registerTab\\(\\s*'" + id + "'").test(s.src));
  A(hit.length > 0, `页签「${id}」有文件注册它` + (hit.length ? '（' + hit[0].f + '）' : ' —— 找不到 registerTab'));

  hit.forEach(s => {
    // 注册对象里必须同时有 render 与 bind
    const m = s.src.match(new RegExp("registerTab\\(\\s*'" + id + "'\\s*,\\s*\\{([\\s\\S]{0,400}?)\\}\\s*\\)"));
    const obj = m ? m[1] : '';
    A(/\brender\s*:/.test(obj), `「${id}」注册了 render（${s.f}）`);
    A(/\bbind\s*:/.test(obj), `「${id}」注册了 bind —— 漏了就是 "binders[activeTab] is not a function"（${s.f}）`);
  });
});

/* ---------- ③ render 不许是 async / Promise（会被拼成 "[object Promise]"）---------- */
sources.forEach(s => {
  const bad = /async\s+function\s+render\w*\s*\(/.test(s.src)
    || /render\s*:\s*async\b/.test(s.src)
    || /return\s+window\.\w+\.\w+\([^)]*\)\s*;\s*\}?/.test(s.src) && false; // 占位，不做模糊判断
  A(!bad, `${s.f} 的 render 不是 async（异步数据必须在 bind 里填）`);
});

console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
