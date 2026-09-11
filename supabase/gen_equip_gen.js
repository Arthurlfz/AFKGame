/* ============================================================
 * gen_equip_gen.js —— 从 docs/js/equipment/equipment.js 抽取装备生成逻辑，生成服务端副本
 * 输出：supabase/functions/_shared/equip-gen-server.mjs
 * 运行：node supabase/gen_equip_gen.js
 *
 * 为什么这么做（2026-09-11 审计第 4 批教训）：
 *   挂机结算在服务端，但掉落装备的生成逻辑在前端。直接「手抄一份」＝必然漂移
 *   （战核就是这么漂的），所以这里用**构建期抽取**：把前端那几个纯函数连同常量
 *   原样搬出来、包一层 `makeEquipGen(cfg, util)`，提供它闭包需要的 Config / Util。
 *   → 单一事实源仍是 equipment.js；改前端后重跑本脚本即可同步。
 *
 * ⚠️ 抽取依赖 window.Equipment 导出 SLOT_INFO / LABELS（2026-09-11 加）。
 * ⚠️ 改 equipment.js 里这几个函数的**函数名**要同步改下面的 FUNCS 清单。
 * 护栏：docs/tests/vtest_equip_gen.js 会比对两边行为一致。
 * ============================================================ */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/core/config.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/equipment/equipment.js'), 'utf8'), ctx);

const Eq = vm.runInContext('window.Equipment', ctx);

// 生成装备所需的函数全集（按依赖顺序：被调用的在前定义无所谓，函数声明会提升）
const FUNCS = [
  'affixCategory', 'affixCount', 'pickRarity',
  'rollAffixTier', 'rollAffixCount', 'affixTiersFor', 'rollBaseHit', 'levelOfAreaTier',
  'rarityIdFromCount', 'syncRarity', 'generateEquipment'
];

const missing = FUNCS.filter(f => typeof Eq[f] !== 'function');
if (missing.length) {
  console.error('❌ 抽取失败：equipment.js 里找不到这些函数（是不是改名了？）：' + missing.join(', '));
  process.exit(1);
}
const consts = ['SLOTS', 'SLOT_INFO', 'LABELS', 'AFFIX_POOL'];
const missed = consts.filter(c => Eq[c] === undefined);
if (missed.length) {
  console.error('❌ 抽取失败：window.Equipment 没导出这些常量：' + missed.join(', ') + '（见 equipment.js 的对外 API 段）');
  process.exit(1);
}

// 常量直接取「求值后的值」——比抄源码稳（SLOT_INFO 是 Object.fromEntries 多行表达式）
const constSrc = consts.map(c => `const ${c} = ${JSON.stringify(Eq[c])};`).join('\n');
// 函数取源码原文 —— 它们只引用 Config / Util / 上面四个常量 / uid，包装器里全部备齐
const funcSrc = FUNCS.map(f => Eq[f].toString()).join('\n\n');

// Util 也住在 equipment.js 里（"本文件最先加载，故通用工具函数也定义在此"），同为对象方法简写，
// 原样抽取即可。它们内部写的是 Math.random()，靠包装器里遮蔽 Math 来换成注入的 rnd —— 零文本替换。
const U = vm.runInContext('window.Util', ctx);
const UTIL_FUNCS = ['randInt', 'randFloat', 'pick', 'pickWeighted'];
const utilMissing = UTIL_FUNCS.filter(f => typeof U[f] !== 'function');
if (utilMissing.length) {
  console.error('❌ 抽取失败：window.Util 缺这些函数：' + utilMissing.join(', '));
  process.exit(1);
}
const utilSrc = UTIL_FUNCS.map(f => '    ' + U[f].toString().replace(/\n/g, '\n    ')).join(',\n');

const AFFIX_TABLE_SRC = (() => {
  // 原样抽取，不手抄 —— 手抄一份映射表就是下一场漂移（`affixTiersFor` 会读到不同的表）。
  // 它内部写的是 Config.equipment.xxx，而包装器里的 Config 就是 { equipment: cfg }，所以可原样用。
  const src = fs.readFileSync(path.join(ROOT, 'docs/js/equipment/equipment.js'), 'utf8');
  const m = src.match(/const AFFIX_TIER_TABLES = \{[\s\S]*?\n  \};/);
  if (!m) {
    console.error('❌ 抽取失败：equipment.js 里找不到 const AFFIX_TIER_TABLES = {...}; 这段定义（改名了？）');
    process.exit(1);
  }
  return m[0];
})();

const out = `// 由 supabase/gen_equip_gen.js 自动生成（勿手改）—— 与 docs/js/equipment/equipment.js 同源
// 生成时间：${new Date().toISOString()}
/* 服务端装备生成：与前端同一份逻辑，靠构建期抽取而非手抄。
 * 用法：const gen = makeEquipGen(config.equipment, rnd);   // rnd: () => [0,1)
 *       const eq = gen.generateEquipment(null, areaTier, 0, ilvl, countBonus);
 *       // 参数与前端 generateEquipment(rarity, areaTier, materialTier, ilvl, countBonus) 完全一致
 *       // （rarity / materialTier 已被内部忽略，仅为兼容旧调用签名） */
${constSrc}

export function makeEquipGen(cfg, rnd) {
  // 遮蔽 Math：抽取来的源码写的是 Math.random()，原型链挂真 Math 保证 round/floor 等照常可用，
  // 只把 random 换成注入的 rnd → 随机源可注入、源码零改写。（Math 的方法不可枚举，
  // 所以不能用 Object.assign({}, Math)，必须走原型链。）
  const Math = Object.create(globalThis.Math);
  Math.random = rnd;
  const Config = { equipment: cfg };
  const Util = {
${utilSrc}
  };
  let uid = 1;
  ${AFFIX_TABLE_SRC}

${funcSrc.split('\n').map(l => '  ' + l).join('\n')}

  return { generateEquipment, rollAffixTier, rollAffixCount, syncRarity, affixCount };
}
`;

fs.writeFileSync(path.join(ROOT, 'supabase/functions/_shared/equip-gen-server.mjs'), out, 'utf8');
console.log('OK: equip-gen-server.mjs (' + out.length + ' bytes, ' + FUNCS.length + ' 个函数, ' + consts.length + ' 个常量)');
