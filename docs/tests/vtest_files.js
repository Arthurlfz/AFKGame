/* vtest_files.js —— 测试加载清单的唯一事实源
 *
 * 为什么存在：以前每个 vtest 都自己手抄一份「要加载哪些 js」的清单，42 份清单互相不一致，
 * 结果 25 个测试集体漏抄 ui-pet-evolve/merge/synth.js —— 测试跑的是 ui-pet.js 里的旧实现，
 * 而浏览器跑的是后加载的三个子文件。测试全绿，验的却是从不执行的代码。
 *
 * 做法：直接解析 游戏.html 的 <script src> 顺序，跟浏览器加载的东西严格一致。
 * 以后往 游戏.html 加新脚本，测试自动跟上，不会再漂移。
 *
 * 用法：const { FILES } = require('./vtest_files');
 *       for (const f of FILES) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
 *
 * 注意：路径相对 tests/ 目录（游戏.html 里的 src 是相对 docs/ 的，这里统一加 ../ 前缀）。
 *       vstub.js 是测试桩、不在 游戏.html 里，各测试照旧单独 runInContext 加载。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GAME_HTML = path.join(__dirname, '..', '游戏.html');

// 只取带 src 的外链脚本；内联脚本和 ?v= 版本号都跳过（版本号是防浏览器缓存的，测试不需要）
function readGameScripts() {
  const html = fs.readFileSync(GAME_HTML, 'utf8');
  const re = /<script\s+src="([^"]+\.js)(?:\?[^"]*)?"\s*>\s*<\/script>/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (src.includes('vendor/')) continue; // supabase.min.js 由各测试单独决定是否加载
    files.push('../' + src);
  }
  return files;
}

const FILES = readGameScripts();

module.exports = { FILES, readGameScripts, GAME_HTML };
