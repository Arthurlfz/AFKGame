/* ============================================================
 * vtest_dev_config_table.js —— 开发者面板「宠物总表」与数值发布链路
 *
 * 守什么（2026-09-16 立）：
 *   1. docs/宠物总表.md 与 config.js 同步
 *      —— 总表是给人（策划）读的视图，跟代码脱节就变成骗人的文档：照着它改数会改错地方。
 *   2. 宠物数据闭环
 *      —— 每条血统线的形态链 / 技能 / 血统被动 / 速度 / 神级形态都查得到，没有孤儿形态、
 *         没有挂在空形态上的技能。
 *   3. 发布链路安全（拆弹 + 防复发）
 *      —— 云端快照里不许有任何函数；深合并（读云端配置）不许抹掉 Config 里的函数。
 *         旧实现是「整份 JSON.stringify 上传 + Object.assign 整键覆盖」：
 *         一点「读取云端配置」就把 pet.evolution.skillOf / godPets.byName 换成 undefined，
 *         宠物技能与进化当场崩。
 *   4. 调参页字段不空绑
 *      —— 曾有一条 SCAHEMA 项绑在根本不存在的 nirvana.absorbRatio 上，滑杆拖了没反应。
 *
 * 运行：cd docs/tests && node vtest_dev_config_table.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const VTF = require('./vtest_files');

/* ---------- 最小 DOM 桩（ui-dev.js / ui-dev-pets.js 只用到这几个 API） ---------- */
function el() {
  return {
    textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], closest: () => el(),
    appendChild() {}, remove() {}, setAttribute() {}
  };
}
const els = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
ctx.window = ctx;
ctx.document = {
  getElementById: id => els[id] || (els[id] = el()),
  createElement: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [],
  addEventListener() {}
};
ctx.navigator = {};
// 云端表里住着服务端自己的键（bot），发布时必须原样带上 —— 桩里给一个有值的，好验证它没被丢
ctx.ServerConfig = { get: () => ({ bot: { enabled: true, dailyCap: 30 } }) };
ctx.UI = {
  getAuthUser: () => ({ email: '776492620@qq.com' }),
  renderAll() {}, showToast() {}
};
vm.createContext(ctx);

/* 只加载本测试需要的三个文件（不跑 VTF.FILES 全量：其余 UI 文件各有自己的依赖桩） */
['../js/core/config.js', '../js/ui/ui-dev.js', '../js/ui/ui-dev-pets.js'].forEach(f => VTF.load(ctx, f));

const Config = ctx.Config;
const DP = ctx.DevPanel;
const MD = fs.readFileSync(path.join(__dirname, '..', '宠物总表.md'), 'utf8');

let fails = 0;
function assert(cond, msg) {
  if (cond) { console.log('✅ ' + msg); return; }
  fails++;
  console.error('❌ FAIL: ' + msg);
}

const P = Config.pet || {};
const E = P.evolution || {};
const TREE = E.tree || {};
const STAGES = E.stages || [];
const SKILLS = E.activeSkills || {};
const PASSIVES = Config.bloodlinePassive || {};
const GODS = (P.godPets && P.godPets.list) || [];
const STARTERS = P.starters || [];
const SPEEDS = P.speeds || {};
const PROFILES = P.petProfiles || {};

/* 独立实现形态链遍历（故意不复用面板的代码 —— 交叉验证才能发现实现写歪）。
 * ⚠️ 形态树只在基宠层分叉（基宠 → 一阶A / 一阶B），再往上一层只有一条路 —— idx 只作用于第一跳。 */
function branch(base, idx) {
  const out = [];
  let cur = base, guard = 0, useIdx = idx;
  while (guard++ < 10) {
    const hop = (TREE[cur] || [])[useIdx];
    if (!hop) break;
    out.push({ from: cur, to: hop.to });
    cur = hop.to;
    useIdx = 0;
  }
  return out;
}

console.log('—— 一、宠物数据闭环 ——');

assert(STARTERS.length === 8, '基宠是 8 只（当前 ' + STARTERS.length + ' 只）');
assert(STAGES.length === 5, '进化阶段是 5 阶（当前 ' + STAGES.length + ' 阶）');

const startersMissingSpeed = STARTERS.filter(s => !(SPEEDS[s.name] > 0)).map(s => s.name);
assert(startersMissingSpeed.length === 0, '每只基宠都有速度值（缺：' + (startersMissingSpeed.join(',') || '无') + '）');

const startersMissingProfile = STARTERS.filter(s => !PROFILES[s.name]).map(s => s.name);
assert(startersMissingProfile.length === 0, '每只基宠都有定位档 petProfiles（缺：' + (startersMissingProfile.join(',') || '无') + '）');

const startersMissingPassive = STARTERS.filter(s => !PASSIVES[s.name]).map(s => s.name);
assert(startersMissingPassive.length === 0, '每只基宠都有血统被动（缺：' + (startersMissingPassive.join(',') || '无') + '）');

// 终形态必须配主动技能；形态树里的每个名字都必须能从某只基宠走到（没有孤儿形态）
const noSkill = [], allForms = new Set();
STARTERS.forEach(s => {
  [0, 1].forEach(i => {
    const p = branch(s.name, i);
    if (!p.length) return;
    p.forEach(h => allForms.add(h.to));
    const top = p[p.length - 1].to;
    if (!SKILLS[top]) noSkill.push(top);
  });
});
assert(noSkill.length === 0, '每个终形态都有主动技能（缺：' + (noSkill.join(',') || '无') + '）');

const orphanSkills = Object.keys(SKILLS).filter(n => !allForms.has(n) && !GODS.some(g => g.sprite === n));
assert(orphanSkills.length === 0, '主动技能表里没有挂在空形态上的技能（孤儿：' + (orphanSkills.join(',') || '无') + '）');

/* 遍历起点 = 8 只基宠 + 蛋池里的额外品种。
 * 「墨灵」是孵化测试线：pet.js 的 PET_POOL 里有它、starters 里没有 ——
 * 所以从 starters 出发走不到它，这不是孤儿，是刻意的（它没有技能/被动/神级形态）。 */
const EXTRA_ROOTS = ['墨灵'];
const roots = STARTERS.map(s => s.name).concat(EXTRA_ROOTS);
assert(EXTRA_ROOTS.every(n => TREE[n]), '额外根都在形态树里（' + EXTRA_ROOTS.join(',') + '）');

const reachable = new Set();
roots.forEach(r => { [0, 1].forEach(i => branch(r, i).forEach(h => reachable.add(h.to))); });
const orphans = Object.keys(TREE).filter(n => roots.indexOf(n) < 0 && !reachable.has(n));
assert(orphans.length === 0, '形态树里没有走不到的形态（孤儿：' + (orphans.join(',') || '无') + '）');

const godLines = GODS.map(g => g.line);
const lineNoGod = STARTERS.filter(s => godLines.indexOf(s.name) < 0).map(s => s.name);
assert(lineNoGod.length === 0, '每条血统线都有神级形态（缺：' + (lineNoGod.join(',') || '无') + '）');

const godBadSprite = GODS.filter(g => !allForms.has(g.sprite)).map(g => g.name);
assert(godBadSprite.length === 0, '神级形态复用的立绘名都真实存在（异常：' + (godBadSprite.join(',') || '无') + '）');

const skillsOutOfRange = Object.keys(SKILLS).filter(n => {
  const s = SKILLS[n];
  return !(s.triggerChance > 0 && s.triggerChance <= 1) || !(s.damageMultiplier >= 1) || !(s.cooldownTurns >= 0);
});
assert(skillsOutOfRange.length === 0, '技能的概率/倍率/冷却都在合法区间（异常：' + (skillsOutOfRange.join(',') || '无') + '）');

console.log('—— 二、宠物总表.md 与 config.js 同步 ——');

STARTERS.forEach(s => {
  const names = [s.name];
  [0, 1].forEach(i => branch(s.name, i).forEach(h => names.push(h.to)));
  const missing = names.filter(n => MD.indexOf(n) < 0);
  const speedOk = MD.indexOf('**' + SPEEDS[s.name] + '**') >= 0;
  const sk = [0, 1].map(i => {
    const p = branch(s.name, i);
    return p.length ? SKILLS[p[p.length - 1].to] : null;
  }).filter(Boolean);
  const skMissing = sk.filter(x => MD.indexOf(x.name) < 0).map(x => x.name);
  const pas = PASSIVES[s.name];
  const god = GODS.filter(g => g.line === s.name)[0];
  const bad = [];
  if (missing.length) bad.push('形态缺：' + missing.join('/'));
  if (!speedOk) bad.push('速度 ' + SPEEDS[s.name] + ' 未出现');
  if (skMissing.length) bad.push('技能缺：' + skMissing.join('/'));
  if (pas && MD.indexOf(pas.name) < 0) bad.push('被动缺：' + pas.name);
  if (god && MD.indexOf(god.name) < 0) bad.push('神宠缺：' + god.name);
  assert(bad.length === 0, s.name + ' 线在总表里完整（' + (bad.join('；') || '形态/技能/被动/速度/神宠都在') + '）');
});

const badStages = STAGES.filter((st, i) => i > 0 && MD.indexOf('Lv' + st.minLevel) < 0).map(st => st.label);
assert(badStages.length === 0, '总表里的等级门槛与 stages 一致（对不上：' + (badStages.join(',') || '无') + '）');

console.log('—— 三、发布链路：快照与深合并 ——');

const snap = DP.buildSnapshot();
const fnPaths = [];
(function walk(o, p) {
  if (o === null || typeof o !== 'object') return;
  Object.keys(o).forEach(k => {
    if (typeof o[k] === 'function') fnPaths.push(p + '.' + k);
    else walk(o[k], p + '.' + k);
  });
})(snap, '');
assert(fnPaths.length === 0, '发布快照里没有任何函数（函数会被 JSON 静默丢掉；泄漏：' + (fnPaths.slice(0, 3).join(',') || '无') + '）');
assert(snap.pet && snap.pet.starters && snap.exp && snap.drop, '发布快照含关键数值段（pet / exp / drop）');
assert(!!(snap.bot && snap.bot.enabled), '发布快照保留了服务端自己的 bot 键（丢了会把市场机器人开关冲掉）');

const errs = DP.validateSnapshot(snap);
assert(errs.length === 0, '当前数值能通过发布校验（' + (errs.join('；') || '无错误') + '）');

// 故意改坏再校验：校验必须拦得住（否则等于没有）
const bad1 = JSON.parse(JSON.stringify(snap));
bad1.pet.evolution.stages[2].minLevel = 5;      // 门槛不再递增
assert(DP.validateSnapshot(bad1).length > 0, '门槛不递增时校验会拦住');
const bad2 = JSON.parse(JSON.stringify(snap));
bad2.exp.perWinCoef = 0;
assert(DP.validateSnapshot(bad2).length > 0, '经验系数为 0 时校验会拦住');
const bad3 = JSON.parse(JSON.stringify(snap));
bad3.pet.starters = bad3.pet.starters.slice(0, 3);
assert(DP.validateSnapshot(bad3).length > 0, '基宠数量不对时校验会拦住');
const bad4 = JSON.parse(JSON.stringify(snap));
bad4.trade.taxPer = 0;
assert(DP.validateSnapshot(bad4).length > 0, '税率分母为 0 时校验会拦住');

// 深合并：模拟「读取云端配置」，函数必须完好，数值必须被覆盖
const before = {
  skillOf: typeof Config.pet.evolution.skillOf,
  stageOf: typeof Config.pet.evolution.stageOf,
  byName: typeof Config.pet.godPets.byName,
  ofLine: typeof Config.pet.godPets.ofLine,
  expPackOf: typeof Config.expPackOf
};
const probe = JSON.parse(JSON.stringify(snap));
probe.exp.perWinCoef = 9.9;
probe.pet.speeds[STARTERS[0].name] = 123;
DP.mergeInto(Config, probe);
assert(Config.exp.perWinCoef === 9.9, '读云端配置：数值段真的被覆盖（经验系数 → 9.9）');
assert(Config.pet.speeds[STARTERS[0].name] === 123, '读云端配置：嵌套表也被覆盖（速度 → 123）');
const after = {
  skillOf: typeof Config.pet.evolution.skillOf,
  stageOf: typeof Config.pet.evolution.stageOf,
  byName: typeof Config.pet.godPets.byName,
  ofLine: typeof Config.pet.godPets.ofLine,
  expPackOf: typeof Config.expPackOf
};
const broken = Object.keys(before).filter(k => before[k] === 'function' && after[k] !== 'function');
assert(broken.length === 0, '读云端配置不会抹掉 Config 里的函数（被抹：' + (broken.join(',') || '无') + '）');

console.log('—— 四、调参页字段与面板注册 ——');

/* 直接读源码里的 path 声明：测的是「声明的每个字段都真能取到值」，
 * 曾有一条绑在 nirvana.absorbRatio（不存在，吸收比例其实在 Config.items 的道具上）→ 滑杆拖了没反应。 */
const devSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ui-dev.js'), 'utf8');
const paths = Array.from(new Set((devSrc.match(/path: '([^']+)'/g) || []).map(s => s.slice(7, -1))));
const deadBind = paths.filter(p => {
  const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), Config);
  return v === undefined || v === null;
});
assert(paths.length > 40, '调参页声明了足够多的可调字段（当前 ' + paths.length + ' 个）');
assert(deadBind.length === 0, '调参页没有空绑字段（空绑：' + (deadBind.join(',') || '无') + '）');

DP.openTab('pets');
const html = els['dev-body'] ? els['dev-body'].innerHTML : '';
const lineCount = (html.match(/data-line="/g) || []).length;
assert(lineCount === STARTERS.length, '宠物页渲染出 ' + STARTERS.length + ' 条血统线（实际 ' + lineCount + ' 条）');
assert(html.indexOf('value="NaN"') < 0 && html.indexOf('value="undefined"') < 0, '宠物页没有 NaN/undefined 数值框');
assert((html.match(/data-fid="/g) || []).length > 150, '宠物页给出足量可调项（' + (html.match(/data-fid="/g) || []).length + ' 个）');

// 加载顺序：宠物页依赖 window.DevPanel 注册点，必须排在 ui-dev.js 之后
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', '游戏.html'), 'utf8');
const iDev = htmlSrc.indexOf('js/ui/ui-dev.js');
const iPets = htmlSrc.indexOf('js/ui/ui-dev-pets.js');
assert(iPets >= 0, '游戏.html 引用了 ui-dev-pets.js');
assert(iDev >= 0 && iPets > iDev, 'ui-dev-pets.js 排在 ui-dev.js 之后（否则注册点还没建好）');
assert(/\?v=/.test(htmlSrc.slice(iPets, iPets + 80)), 'ui-dev-pets.js 的引用带 ?v=（不带会被浏览器缓存住）');

console.log('');
if (fails) { console.error('共 ' + fails + ' 项断言失败'); process.exit(1); }
console.log('全部通过');
