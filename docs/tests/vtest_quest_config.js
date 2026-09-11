/* ============================================================
 * vtest_quest_config.js —— 任务表结构规范化层的守值测试
 *
 * 为什么需要（2026-09-11 第 9 批）：
 *   quest-config.js 自己有一套 validate()，但【只 console.warn，不抛】——
 *   控制台里的警告没人看，配置违规就一直躺着。本测试把警告抓出来变成红灯，
 *   并额外直接断言几条来自记忆/宪法的不变量（不依赖 validate 是否覆盖）。
 *
 * 覆盖的不变量：
 *   ① kindOf 派生的 kind 必须都在 KIND_META 里（KIND_META 是一级分类唯一权威）
 *   ② 可重复条目（repeatable）必须归 loop；每日（repeat）必须归 daily/weekly
 *   ③ 兑换（exchange）必须带 reset 且不得 repeatable —— 否则变无限刷
 *   ④ 系列（series）的章节编号与解锁等级要和地图对得上
 *   ⑤ 任务 id 唯一
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const warns = [];
const ctx = {
  console: Object.assign({}, console, { warn: (...a) => { warns.push(a.join(' ')); }, log() {}, error() {} }),
  setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }
};
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/core/config.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/core/quest-config.js'), 'utf8'), ctx);

const QC = ctx.QuestConfig;
const A = (ok, m) => { if (!ok) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

const list = QC.list();
const ids = QC.KIND_META.map(k => k.id);

A(!!(QC && QC.KIND_META && QC.KIND_META.length), 'QuestConfig 已加载，KIND_META 共 ' + (QC.KIND_META ? QC.KIND_META.length : 0) + ' 个一级分类');
A(list.length > 0, '任务表非空（' + list.length + ' 条）');

/* ① kind 合法性 + KIND_META 唯一权威 */
const badKind = list.filter(q => ids.indexOf(q.kind) < 0);
A(badKind.length === 0, '① 所有任务的 kind 都在 KIND_META 内' + (badKind.length ? ' 越界：' + badKind.slice(0, 5).map(q => q.id + '=' + q.kind).join(', ') : ''));

/* ② 可重复条目的归属：repeatable → loop；repeat → daily/weekly */
const badRep = list.filter(q => q.repeatable && q.kind !== 'loop');
A(badRep.length === 0, '② repeatable 的任务必须归 loop' + (badRep.length ? ' 例外：' + badRep.slice(0, 5).map(q => q.id + '→' + q.kind).join(', ') : ''));
const badDaily = list.filter(q => q.repeat && q.kind !== 'daily' && q.kind !== 'weekly');
A(badDaily.length === 0, '② repeat 的任务必须归 daily/weekly' + (badDaily.length ? ' 例外：' + badDaily.slice(0, 5).map(q => q.id + '→' + q.kind).join(', ') : ''));

/* ③ 兑换三铁律：必须带 reset、不得 repeatable */
const ex = list.filter(q => q.kind === 'exchange');
const exNoReset = ex.filter(q => !q.reset || q.reset === 'none');
A(exNoReset.length === 0, `③ 兑换任务全部带重置周期（共 ${ex.length} 条）` + (exNoReset.length ? ' 无限刷风险：' + exNoReset.map(q => q.id).join(', ') : ''));
const exRep = ex.filter(q => q.repeatable);
A(exRep.length === 0, '③ 兑换任务不得标 repeatable' + (exRep.length ? ' 会绕过上限：' + exRep.map(q => q.id).join(', ') : ''));

/* ④ 系列：章节编号能落到地图，且解锁等级对得上 */
const areas = (ctx.Config.battle && ctx.Config.battle.areas) || [];
const badCh = [];
for (const q of list) {
  if (q.kind !== 'series') continue;
  const idx = QC.chapterIndexOf(q);
  const a = areas[idx - 1];
  if (!a) { badCh.push(q.id + ' 找不到第 ' + idx + ' 章');
    continue; }
  const lv = Number(q.unlockLevel) || 1;
  const lo = a.levelRange ? a.levelRange[0] : 0;
  if (lv < lo || lv > lo + 2) badCh.push(`${q.id} 解锁 Lv${lv} 与第 ${idx} 章「${a.name}」(Lv${lo}) 不匹配`);
}
A(badCh.length === 0, '④ 系列任务的章节与解锁等级全部匹配' + (badCh.length ? '：\n      ' + badCh.slice(0, 8).join('\n      ') : ''));

/* ⑤ id 唯一 */
const seen = {}, dup = [];
for (const q of list) { if (seen[q.id]) dup.push(q.id); seen[q.id] = true; }
A(dup.length === 0, '⑤ 任务 id 唯一' + (dup.length ? ' 重复：' + [...new Set(dup)].join(', ') : ''));

/* ⑥ quest-config.js 自己的 validate() 不该有任何警告 */
const mine = warns.filter(w => String(w).indexOf('[quest-config]') >= 0);
A(mine.length === 0, `⑥ validate() 零警告（实测 ${mine.length} 条）`
  + (mine.length ? '：\n      ' + mine.slice(0, 10).join('\n      ') : ''));

console.log('ALL QUEST CONFIG TESTS PASSED');
