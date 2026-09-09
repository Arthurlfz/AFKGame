/* ============================================================
 * vtest_sprites_coverage.js —— 宠物/怪物头像资源覆盖率守卫（2026-09-10）
 * 背景：2026-09-10 移除全部 emoji 占位头像（starters / 进化树路线 / 野怪池 / 蛋池），
 *       头像与立绘一律由 PetSprites 按名字解析真实素材，无素材留空。
 * 本测试守住四条线（改 config / enemy-data / pet-sprites / 游戏.html 时必须过）：
 *  1. 配置层不再携带 emoji icon 字段（starters / legacyBase / 进化树 / 野怪池 / 蛋池）
 *  2. 所有会以"宠物/怪物"身份出现的名字，头像+立绘都有真实素材
 *  3. 每个映射指向的图片文件在磁盘上真实存在（防路径拼错静默 404 → 空白头像）
 *  4. 游戏.html 内联 PetSprites 副本与 pet-sprites.js 同步（版本号 + 变异素材）
 * 跑法：cd docs/tests && node vtest_sprites_coverage.js
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const ctx = { console, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
load('js/core/config.js');
load('js/pet/enemy-data.js');
load('js/core/pet-sprites.js');

const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const Config = ctx.Config;
const EnemyData = ctx.EnemyData;
const PS = ctx.PetSprites;

/* ---------- 1. 配置层不携带 emoji icon ---------- */
const starters = Config.pet.starters || [];
A(starters.length === 8 && starters.every(s => !('icon' in s)), 'starters 8 只基宠都不再带 icon 字段');
A(!('icon' in (Config.pet.legacyBase || {})), 'legacyBase 不再带 icon 字段');
const tree = (Config.pet.evolution && Config.pet.evolution.tree) || {};
const treeRoutes = Object.keys(tree).flatMap(k => tree[k]);
A(treeRoutes.length > 0 && treeRoutes.every(r => !('icon' in r)), `进化树 ${treeRoutes.length} 条路线都不再带 icon 字段`);
const enemies = (EnemyData && EnemyData.list) || [];
A(enemies.length > 0 && enemies.every(e => !('icon' in e)), `野怪池 ${enemies.length} 条都不再带 icon 字段`);
const blKeys = Object.keys(Config.bloodlinePassive || {});
A(blKeys.length === 8 && blKeys.every(k => !('icon' in Config.bloodlinePassive[k])), '血统被动 8 条都不再带 icon 字段');

/* ---------- 2. 全部形态有真实素材（头像 + 立绘） ---------- */
const names = new Set();
starters.forEach(s => names.add(s.name));
treeRoutes.forEach(r => names.add(r.to));
enemies.forEach(e => names.add(e.name));
starters.forEach(s => { const m = tree[s.name]; if (m) m.forEach(r => names.add(r.to)); });
(Config.pet.godPets && Config.pet.godPets.list || []).forEach(g => { names.add(g.name); names.add(g.sprite); });
// 变异形态（合成 ·异变 / 野怪 ·异变）：有专属素材，或剥后缀回退本体，二者必须有其一
['血狐·异变', '骨狼·异变', '幽影兔·异变', '瘟熊·异变', '腐噜兽·异变'].forEach(n => names.add(n));

const miss = [];
for (const n of names) {
  if (!PS.avatarOf(n)) miss.push('avatar:' + n);
  if (!PS.pathOf(n)) miss.push('sprite:' + n);
}
A(miss.length === 0, `${names.size} 个形态名全部有真实头像+立绘（缺失：${miss.join('、') || '无'}）`);

/* 变异宠有专属素材（不再靠剥后缀蹭本体）：mut1-rotten 已接线 */
A(String(PS.pathOf('腐噜兽·异变')).indexOf('mut1-rotten') > 0, '腐噜兽·异变 有专属变异立绘（mut1-rotten）');
A(String(PS.avatarOf('腐噜兽·异变')).indexOf('mut1-rotten') > 0, '腐噜兽·异变 有专属变异头像（mut1-rotten）');
A(PS.avatarOf('血狐·异变') !== PS.avatarOf('血狐'), '其他家族 ·异变 暂无专属素材时按设计回退本体（等素材后接线）');

/* 血统被动 key = 基宠名 → 每条被动的展示头像都有真实素材 */
const blMiss = blKeys.filter(k => !PS.avatarOf(k));
A(blMiss.length === 0, `血统被动 ${blKeys.length} 条的基宠头像全部有真实素材（缺失：${blMiss.join('、') || '无'}）`);

/* ---------- 3. 映射指向的图片文件真实存在 ---------- */
const badFiles = [];
const checkMap = (m, label) => {
  for (const k of Object.keys(m)) {
    const p = path.join(ROOT, m[k].split('?v=')[0]);
    if (!fs.existsSync(p)) badFiles.push(`${label}[${k}] → ${m[k]}`);
  }
};
checkMap(PS.map, '立绘');
checkMap(PS.avatarMap, '头像');
A(badFiles.length === 0, `全部 ${Object.keys(PS.map).length + Object.keys(PS.avatarMap).length} 条映射指向的图片文件存在（404：${badFiles.join('、') || '无'}）`);

/* ---------- 4. 游戏.html 内联副本与 pet-sprites.js 同步 ---------- */
const srcJs = fs.readFileSync(path.join(ROOT, 'js/core/pet-sprites.js'), 'utf8');
const srcHtml = fs.readFileSync(path.join(ROOT, '游戏.html'), 'utf8');
const vJs = (srcJs.match(/V:\s*'([^']+)'/) || [])[1];
A(!!vJs && srcHtml.indexOf('V: "' + vJs + '"') >= 0, `内联副本素材版本号与 pet-sprites.js 一致（${vJs}）`);
A(['mut-00.png', 'mut-03.png', 'mut-06.png'].every(f => srcHtml.indexOf('mut1-rotten/' + f) >= 0), '内联副本已接线 mut1-rotten 变异立绘');
A(['腐噜兽·异变', '腐烂之母·异变', '剧毒魔君·异变'].every(n => srcHtml.indexOf('avatars/mut1-rotten/' + n + '.png') >= 0), '内联副本已接线 mut1-rotten 变异头像');

console.log('\n全部通过 ✓');
