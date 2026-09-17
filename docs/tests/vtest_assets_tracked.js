// vtest_assets_tracked.js —— 页面引用的资源必须【真的在仓库里】（2026-09-17 建，同日扩到 CSS）
//
// 守的是什么：**线上不会因为"文件根本没入库"而 404。**
//
// 背景（用户实机报的 bug）：控制台一直有一条 `ui-onboarding.css 404`。
//   查下来是 `.gitignore` 里一行 `docs/css/ui-onboarding.css` —— 它被误归进
//   "demo 临时文件"那组忽略掉了，而它其实是【正式引导引擎的样式表】（游戏.html 引用它）。
//   ⇒ 这个文件从来没进过仓库 ⇒ **GitHub Pages 上一直 404，引导聚光灯样式全丢**。
//   本地一直好好的（文件在磁盘上），所以谁都没发现 —— 这就是"本地能跑、线上缺文件"的经典剧本。
//
// 2026-09-17 修同一个病根的第二处：整理文件时发现 `app.css` 登录页背景
//   `url("../assets/login-bg-city-clean.jpg")` 也**没入库**（磁盘上有，git 里没有）。
//   ⇒ 同一类事故只查 HTML 是查不全的，CSS 的 url() 也是"页面引用的资源"，一并纳入。
//
// 这条规则是静态可判的：把引用的每个本地资源，拿去 git 的跟踪列表里对一遍。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOCS = path.join(__dirname, '..');
const REPO = path.join(DOCS, '..');

let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

// git 跟踪的全部文件（相对仓库根，正斜杠）
// ⚠️ 必须带 -c core.quotepath=false：git 默认把非 ASCII 路径转义成八进制
//    （`幽火狐.png` → `\345\271\275\347\201\253\347\213\220.png`），
//    不关掉的话所有中文名的立绘都会被误判成"没入库"——本测试第一版就栽在这。
let tracked;
try {
  tracked = new Set(execSync('git -c core.quotepath=false ls-files', { cwd: REPO, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean));
} catch (e) {
  console.error('FAIL: 跑不了 git ls-files —— ' + (e && e.message));
  console.error('（这个测试必须在 git 工作区里跑；如果 CI 环境没有 git，跳过它是合理的）');
  process.exit(1);
}

// refs: repo 相对路径（正斜杠） -> 引用来源（报错时指出是谁引的）
const refs = new Map();
const addRef = (repoRel, from) => { if (!refs.has(repoRel)) refs.set(repoRel, from); };

// 片段引用不算文件：`url(#id)` 是 SVG filter / mask 指向本文档内的元素。
// ⚠️ 它还可能以 `%23` 形式出现在 data URI 内部（design-tokens.css 的水墨纹理就是），
//    那种 `url(%23n)` 并不是外部资源 —— 不排掉会误报"找不到文件"。
const isExternal = (raw) => /^(https?:)?\/\//i.test(raw) || /^(data|mailto|javascript|blob):/i.test(raw)
  || raw.startsWith('#') || raw.includes('#') || raw.includes('%23');
const clean = (raw) => raw.trim().split('?')[0].split('#')[0];

// ---------- 1) HTML：href / src，相对 docs/ ----------
const html = fs.readFileSync(path.join(DOCS, '游戏.html'), 'utf8');
const htmlRe = /(?:href|src)\s*=\s*"([^"]+)"/g;
let m;
while ((m = htmlRe.exec(html))) {
  const raw = m[1].trim();
  if (!raw || isExternal(raw)) continue;
  const c = clean(raw);
  if (!c) continue;
  addRef('docs/' + c.replace(/\\/g, '/'), '游戏.html');
}

// ---------- 2) CSS：url(...)，相对【该 CSS 文件所在目录】 ----------
// ⚠️ 相对路径的基准不一样：CSS 里的 url("../assets/x.jpg") 是相对 docs/css/，
//    不是相对 docs/。所以必须按每个 CSS 自己的目录解析。
const cssDir = path.join(DOCS, 'css');
const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
let cssRefCount = 0;
for (const f of cssFiles) {
  const css = fs.readFileSync(path.join(cssDir, f), 'utf8');
  let mm;
  while ((mm = urlRe.exec(css))) {
    const raw = mm[2].trim();
    if (!raw || isExternal(raw)) continue;
    const c = clean(raw);
    if (!c) continue;
    // docs/css/<f> 为基准解析出 repo 相对路径
    const repoRel = path.posix.normalize('docs/css/' + c.replace(/\\/g, '/'));
    addRef(repoRel, 'css/' + f);
    cssRefCount++;
  }
}

A(refs.size > 0, '抓到 ' + refs.size + ' 个本地资源引用（游戏.html + ' + cssFiles.length + ' 个 css，其中 css 内 ' + cssRefCount + ' 处）');
A(cssRefCount > 0, 'CSS 里的 url() 已被纳入检查（防的正是 login-bg 那类「图在磁盘上、没进仓库」）');

const missingOnDisk = [];
const notTracked = [];
const ignoredToo = [];
for (const [repoRel, from] of refs) {
  const abs = path.join(REPO, repoRel);
  if (!fs.existsSync(abs)) { missingOnDisk.push(repoRel + '（' + from + '）'); continue; }
  if (!tracked.has(repoRel)) {
    notTracked.push(repoRel + '（' + from + '）');
    // 区分病因：是被 gitignore 挡了，还是单纯忘了 add
    try {
      execSync('git check-ignore -q "' + repoRel + '"', { cwd: REPO });
      ignoredToo.push(repoRel);
    } catch (_) { /* 没被 ignore，就是没 add */ }
  }
}

A(missingOnDisk.length === 0,
  '引用的资源在磁盘上都存在' + (missingOnDisk.length ? '｜找不到：' + missingOnDisk.join('、') : ''));

A(notTracked.length === 0,
  '引用的资源都已入库（线上才拿得到）'
  + (notTracked.length ? '｜没入库：' + notTracked.join('、')
     + (ignoredToo.length ? '（其中被 .gitignore 挡住：' + ignoredToo.join('、') + '）' : '') : ''));

console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
