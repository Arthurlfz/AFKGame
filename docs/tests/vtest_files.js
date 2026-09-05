/* vtest_files.js —— 测试加载清单的唯一事实源 + ESM 兼容加载器
 *
 * 为什么存在：以前每个 vtest 都自己手抄一份「要加载哪些 js」的清单，42 份清单互相不一致，
 * 结果 25 个测试集体漏抄 ui-pet-evolve/merge/synth.js —— 测试跑的是 ui-pet.js 里的旧实现，
 * 而浏览器跑的是后加载的三个子文件。测试全绿，验的却是从不执行的代码。
 *
 * 做法：直接解析 游戏.html 的 <script src> 顺序，跟浏览器加载的东西严格一致。
 * 以后往 游戏.html 加新脚本，测试自动跟上，不会再漂移。
 *
 * ESM 兼容：宠物 4 个文件已改成 ES Module（import/export）。node 的 vm.runInContext 不支持
 * import 语法，所以 load() 里把 import/export 剥回 window.PetUI 引用（等价于改造前的 IIFE 写法）。
 * ESM 的真实 import/模块缓存行为由浏览器（preview_url）验证，测试只验证逻辑。
 *
 * 用法：const { FILES, load } = require('./vtest_files');
 *       for (const f of FILES) load(ctx, f);   // 替代 vm.runInContext(fs.readFileSync(f,'utf8'), ctx)
 *
 * 注意：路径相对 tests/ 目录；vstub.js / vendor/supabase.min.js 不在 FILES，各测试照旧单独加载。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_HTML = path.join(__dirname, '..', '游戏.html');

// 只取带 src 的外链脚本（含 type="module"）；内联脚本和 ?v= 版本号都跳过
function readGameScripts() {
  const html = fs.readFileSync(GAME_HTML, 'utf8');
  const re = /<script\b[^>]*\bsrc="([^"]+\.js)(?:\?[^"]*)?"[^>]*>\s*<\/script>/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (src.includes('vendor/')) continue; // supabase.min.js 由各测试单独决定是否加载
    files.push('../' + src);
  }
  return files;
}

// 把 ESM 的 import/export 剥回 window.PetUI 引用，让 vm.runInContext 能加载。
// 本项目 ESM 只出现在宠物 4 文件：ui-pet.js 的 export、三个子文件的 import { ... } from './ui-pet.js'。
// 关键：剥完必须重新包一层 IIFE——ESM 顶层 const 在浏览器里是模块作用域，但 vm.runInContext
// 把多个文件都塞进同一个 context 的全局作用域，顶层 const（如 iconHtml）会跨文件重复声明报错。
// 包回 IIFE 后等价于改造前的 IIFE 写法，各文件的 const 互不污染。
function stripESM(code) {
  // 非 ESM 文件原样返回，绝不包 IIFE（否则顶层 var/function 会被锁进局部作用域，污染全局桩）
  if (!/(^|\n)\s*(import|export)\s/.test(code)) return code;
  let c = code;
  c = c.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (m, names) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean);
    return 'const { ' + list.join(', ') + ' } = window.PetUI;';
  });
  c = c.replace(/export\s*\{[^}]*\};?/g, '');
  return '(function () {\n' + c + '\n})();';
}

// 加载单个文件到 ctx：ESM 剥离后 runInContext，普通文件直接 runInContext。
function load(ctx, file) {
  const abs = path.resolve(__dirname, file);
  const code = fs.readFileSync(abs, 'utf8');
  vm.runInContext(stripESM(code), ctx);
}

const FILES = readGameScripts();

module.exports = { FILES, readGameScripts, GAME_HTML, load, stripESM };
