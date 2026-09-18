// vtest_config_refs.js —— 配置引用体检（2026-09-17 立）
// 守的是什么：**生产代码不许引用「不存在」或「已作废」的配置项**。
//
// 为什么要这条（两次真实的静默错误，都是先上线、后偶然才发现）：
//   ① ui-codex.js 读 `Config.areaLevels` —— Config 顶层从来没有这个键
//      （真表在 `Config.equipment.areaLevels`）→ **不报错**，静默走兜底值，
//      百科把「图 10 的装备等级」显示成 1，挂了两周没人发现。
//   ② ui-codex.js 读 `equipment.materialTierWeights` —— 那张表 2026-09-11 就作废了
//      （底材/词缀 T 阶改由 ilvl 决定），但表还留在 config 里、看着完全像能用 →
//      算出「图 10 掉 T1 底材 42%」，而真实是 0%（图 10 装备等级 55 < T1 门槛 70），
//      同一页下面还写着「图 10 底材最高 T3」——自相矛盾挂了两周。
//
// ⭐ 判据：**「读错源」不会崩，只会产出一个看着很正常的错数字**，所以只能靠静态体检拦。
//   运行期测试抓不到它（数字算得出来、类型也对），`vtest_codex` 也抓不到（它只断言"名字出现过"）。
//
// 维护：config 里新增「作废但没删」的表 → 加进下面的 DEPRECATED 清单。
//       物理删表时把这条一起删（本测试会提示清单里有已经不存在的项）。
const fs = require('fs'), path = require('path'), vm = require('vm');
const VTF = require('./vtest_files');

/* ---------- 加载全部配置源，拿到 Config 的顶层键全集 ----------
 * 目前 Config 只有三个来源（新增"挂配置"的文件时，这里要跟着加，否则会误报）。 */
const mem = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: (k) => { delete m[k] } }; })();
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Object, Array, String, Number, Math, Date, Boolean,
  navigator: {}, localStorage: mem, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/tower/tower-config.js', '../js/trial/trial-config.js']) VTF.load(ctx, f);
const Config = ctx.Config;
const TOP_KEYS = new Set(Object.keys(Config));

/* ---------- 已作废（但仍在 config 里存档）的表 ---------- */
const DEPRECATED = [
  { name: 'materialTierWeights', why: '2026-09-11：底材/词缀 T 阶改由装备等级(ilvl)决定，按图档 roll 的权重表作废' },
  { name: 'rarityWeightsByTier', why: '2026-09-11：颜色改由词缀条数唯一决定，按图档 roll 颜色的表作废' }
];

/* ---------- 扫描范围：生产代码（docs/js），不含 vendor / tests ---------- */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const JS_ROOT = path.join(__dirname, '..', 'js');
const files = walk(JS_ROOT, []);
// 定义处豁免：config 系列自己就是在写这些键（`window.Config.xxx = {...}` / `xxx: {...}`）
const DEF_FILES = ['config.js', 'tower-config.js', 'trial-config.js'];

let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

/* 逐行扫描：块注释先替换成等量空白（保留行号），再把行注释整段切掉。
 * ⚠️ 这里必须剥干净注释：本项目注释里大量出现「读 Config.xxx」「见 Config.yyy」这类说明文字，
 *   不剥就会误报（第一版用字符类正则剥，Windows 换行下漏了几行，咬了自己一口）。 */
function scanLines(p, fn) {
  const raw = fs.readFileSync(p, 'utf8');
  const masked = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  masked.split('\n').forEach((line, i) => {
    let s = line;
    const cut = s.indexOf('//');
    if (cut >= 0) s = s.slice(0, cut);   // 整段行注释切掉（代码里没有裸 http:// 之外的合法 //）
    if (s.trim()) fn(s, i + 1);
  });
}

/* ---- ① 引用的 Config 顶层键必须存在 ----
 * 允许清单：**有意的历史兼容回退**（`Config.nirvana || Config.merge || {}`，见 pet_merge.js 的注释）。
 * merge 是旧配置名、早已不存在 —— 回退永远取不到，但那是明知故犯的兼容写法，不是读错源。
 * （要清理它属于另一件事，会碰正在被别的会话改的 ui-pet-merge.js，不在本测试范围。） */
const KNOWN_ABSENT = new Set(['merge']);

const unknown = [];
const skipFiles = new Set(DEF_FILES.map(f => path.join(JS_ROOT, f).toLowerCase()));
for (const p of files) {
  if (skipFiles.has(p.toLowerCase())) continue;
  scanLines(p, (line, no) => {
    const re = /\bConfig\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(line))) {
      if (TOP_KEYS.has(m[1]) || KNOWN_ABSENT.has(m[1])) continue;
      unknown.push(path.relative(JS_ROOT, p) + ':' + no + ' → Config.' + m[1]);
    }
  });
}
A(unknown.length === 0, '生产代码引用的 Config 顶层键全部存在（' + TOP_KEYS.size + ' 个顶层键）'
  + (unknown.length ? '\n      ❌ 引用了不存在的键（会静默走兜底值，不会报错）：\n      ' + unknown.join('\n      ') : ''));

/* ---- ② 已作废的表不得被生产代码引用 ---- */
const stale = [];
for (const p of files) {
  const base = path.basename(p).toLowerCase();
  if (base === 'config.js') continue;   // 定义/存档处（键名是 `xxx:` 冒号形式，不是 `.xxx`，这里只多一层保险）
  scanLines(p, (line, no) => {
    DEPRECATED.forEach(d => {
      if (new RegExp('\\.\\s*' + d.name + '\\b').test(line)) {
        stale.push(path.relative(JS_ROOT, p) + ':' + no + ' → .' + d.name + '（' + d.why + '）');
      }
    });
  });
}
A(stale.length === 0, '生产代码不引用已作废的配置表（清单 ' + DEPRECATED.length + ' 项）'
  + (stale.length ? '\n      ❌ 引用了已作废的表（会算出看着正常的错数字）：\n      ' + stale.join('\n      ') : ''));

/* ---- ③ 作废清单本身要维护：表已物理删除时要回来更新清单 ---- */
const ghost = DEPRECATED.filter(d => (Config.equipment || {})[d.name] === undefined && Config[d.name] === undefined);
A(ghost.length === 0, '作废清单里的表在 config 里仍有存档（如已物理删除，请从本测试的 DEPRECATED 里移除）'
  + (ghost.length ? '｜已不存在：' + ghost.map(g => g.name).join('、') : ''));

/* ---- ④ 顺带守一条这次的同类：展示层「算概率」必须走 Equipment，不许自己复刻 ----
 * 判据：ui-codex.js 里不许再出现自己读权重表算比例的痕迹。 */
const codexSrc = fs.readFileSync(path.join(JS_ROOT, 'ui', 'ui-codex.js'), 'utf8');
A(codexSrc.indexOf('Equipment.tierOdds') >= 0 && codexSrc.indexOf('Equipment.bestTierAt') >= 0,
  '百科页的 T 阶概率/最好档走 Equipment.tierOdds / bestTierAt（与掉落的 rollAffixTier 共用一份池子逻辑）');
A(!/affixTierWeightsByIlvl\s*\|\|\s*\[\]/.test(codexSrc),
  '百科页不再自己读 affixTierWeightsByIlvl 复刻一份概率算法（复刻必漂移）');

console.log(failures ? 'CONFIG REFS TESTS FAILED: ' + failures : 'ALL CONFIG REFS TESTS PASSED');
process.exit(failures ? 1 : 0);
