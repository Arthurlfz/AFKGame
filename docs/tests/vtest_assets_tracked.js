// vtest_assets_tracked.js —— 游戏.html 引用的资源必须【真的在仓库里】（2026-09-17）
//
// 守的是什么：**线上不会因为"文件根本没入库"而 404。**
//
// 背景（用户实机报的 bug）：控制台一直有一条 `ui-onboarding.css 404`。
//   查下来是 `.gitignore` 里一行 `docs/css/ui-onboarding.css` —— 它被误归进
//   "demo 临时文件"那组忽略掉了，而它其实是【正式引导引擎的样式表】（游戏.html 引用它）。
//   ⇒ 这个文件从来没进过仓库 ⇒ **GitHub Pages 上一直 404，引导聚光灯样式全丢**。
//   本地一直好好的（文件在磁盘上），所以谁都没发现 —— 这就是"本地能跑、线上缺文件"的经典剧本。
//
// 这条规则是静态可判的：把 游戏.html 引用的每个本地资源，拿去 git 的跟踪列表里对一遍。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOCS = path.join(__dirname, '..');
const REPO = path.join(DOCS, '..');

let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

const html = fs.readFileSync(path.join(DOCS, '游戏.html'), 'utf8');

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

// 抓 href="..." / src="..." 里的本地资源
const refs = new Set();
const re = /(?:href|src)\s*=\s*"([^"]+)"/g;
let m;
while ((m = re.exec(html))) {
  const raw = m[1].trim();
  if (!raw) continue;
  if (/^(https?:)?\/\//i.test(raw) || /^(data|mailto|javascript):/i.test(raw) || raw.startsWith('#')) continue;
  const clean = raw.split('?')[0].split('#')[0];
  if (!clean) continue;
  refs.add(clean);
}

A(refs.size > 0, '从 游戏.html 里抓到 ' + refs.size + ' 个本地资源引用');

const missingOnDisk = [];
const notTracked = [];
const ignoredToo = [];
for (const rel of refs) {
  const abs = path.join(DOCS, rel);
  if (!fs.existsSync(abs)) { missingOnDisk.push(rel); continue; }
  const repoRel = 'docs/' + rel.replace(/\\/g, '/');
  if (!tracked.has(repoRel)) {
    notTracked.push(rel);
    // 区分病因：是被 gitignore 挡了，还是单纯忘了 add
    try {
      execSync('git check-ignore -q "' + repoRel + '"', { cwd: REPO });
      ignoredToo.push(rel);
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
