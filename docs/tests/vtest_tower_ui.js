/* ============================================================
 * vtest_tower_ui.js —— 通天塔 UI 冒烟（结算面板 + 详情页渲染）
 * 覆盖（2026-09-10 结算页重构后）：
 *   ① 结算面板：大层数 / 装备单列（含"未鉴定"）/ 腐印 / 高级材料 / 保底碎屑分组 / 诊断 / 称号 / 按钮
 *   ② 白图与通关两种结果都能渲染，且不掉字
 *   ③ 详情页：塔名 / 层数 / 每层怪数 / 腐印网格 / 腐蚀度 / 进入按钮；无腐印时进入按钮可用（白图合法）
 *   ④ 生成器容错：result 缺字段（layerGear/items/title）不许抛异常
 * 说明：用最薄的 DOM 桩（getElementById + innerHTML）——本测试只验"渲染出什么"，
 *       验不了"浮层在不在可见的父节点里"（那个坑靠实测发现：见 memory 2026-09-10 浮层铁律）。
 * 跑法：cd docs/tests && node vtest_tower_ui.js
 * ============================================================ */
const fs = require('fs'), vm = require('vm');

let passCount = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } passCount++; console.log('PASS: ' + m); };

/* ---------- 最薄 DOM 桩：每个 id 一个元素，innerHTML 可读 ---------- */
function mkEl(id) {
  return {
    id, hidden: true, disabled: false, value: '', textContent: '', innerHTML: '',
    style: { setProperty() {}, display: '' }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null },
    appendChild() {}, append() {}, removeChild() {}, remove() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], children: [], onclick: null,
    scrollIntoView() {}, offsetHeight: 0, insertBefore() {}
  };
}
const els = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math,
  navigator: {}, location: { href: 'http://x', hash: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    getElementById: id => (els[id] || (els[id] = mkEl(id))),
    createElement: () => mkEl('new'),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}
  }
};
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/core/worldmap.js', '../js/core/battle-session.js',
                 '../js/trial/trial-access.js', '../js/tower/tower-config.js', '../js/tower/tower-affix.js',
                 '../js/tower/tower-access.js', '../js/tower/tower-rewards.js', '../js/tower/tower-preview.js',
                 '../js/tower/tower-engine.js', '../js/tower/ui-tower-entry.js', '../js/tower/ui-tower-settle.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
const C = code => vm.runInContext(code, ctx);
// 薄 UI 桩（详情页/结算面板会调 toast、页面切换等）
C('window.UI.showToast = function(){}; window.UI.escapeHtml = function(s){return String(s).replace(/[&<>"]/g, function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"})[c]})}; window.UI.switchPage = function(){}; ');
// 宠物桩：详情页要显示出战宠与面板
C(`window.Pet = { getPets: () => [{ id: 1, name: '幽火魔狐·异变', level: 60, growth: 17 }],
  getActivePet: () => ({ id: 1, name: '幽火魔狐·异变', level: 60, growth: 17 }),
  isGodPet: () => false, getStats: () => ({ hp: 4473 }), getCurHp: () => 4473, setCurHp: () => {} };
window.Materials = { getQuantity: n => (n === '腐印·暴怒' ? 2 : 0), gain() {}, spend: async () => ({ ok: true }) };`);
C('window.PetSprites = undefined; window.TowerPreview = undefined;');   // 无模拟器 → 预估走"不可用"分支，不许崩

/* ---------- 样例结算结果（覆盖各种分支） ---------- */
const fullResult = {
  floors: 30, mobsPerFloor: 5, maxFloor: 18, cleared: false, tierFloor: 15, corrosion: 0,
  affixIds: [], endHpPct: 0,
  items: [{ name: '神圣石', qty: 2 }, { name: '强化丹B', qty: 2 }],
  gear: [{ name: '屠戮之刃', slot: '武器', rarity: { label: '金', color: '#d0ad61' }, materialTier: 5 }],
  layerGear: [{ name: '腐纹护符', slot: '饰品', rarity: { label: '蓝', color: '#71999b' }, materialTier: 4 }],
  layerMats: [{ name: '鉴定石', qty: 26 }, { name: '腐印·蚀甲', qty: 2 }, { name: '越龙之石', qty: 1 }, { name: '重铸石', qty: 12 }],
  layerLoot: new Array(90).fill({ kind: 'material', name: '鉴定石', qty: 1 }),
  title: { id: 'tower-10', name: '登塔者' }
};

/* ============ ① 结算面板：分组与关键信息 ============ */
C('UI.showTowerSettle(' + JSON.stringify(fullResult) + ')');
const card = els['tower-settle-card'].innerHTML;
ok(els['tower-settle'].hidden === false, '结算面板被打开（hidden=false）');
ok(/tw-s-floor/.test(card) && /第 <b>18<\/b> \/ 30 层/.test(card), '主视觉显示到达层数（第 18 / 30 层）');
ok(card.indexOf('每层 5 只') >= 0 && card.indexOf('腐蚀度') >= 0, '副行显示每层怪数与腐蚀度');
ok(/tw-s-gear/.test(card) && card.indexOf('屠戮之刃') >= 0 && card.indexOf('腐纹护符') >= 0,
  '装备单列：档位装备 + 逐层掉落装备都列出来（共 2 件）');
ok(card.indexOf('未鉴定') >= 0 && card.indexOf('金装') >= 0 && card.indexOf('蓝装') >= 0,
  '装备行带品质文字与未鉴定标记（不只靠颜色）');
ok(card.indexOf('腐印（1 种）') >= 0 && card.indexOf('tw-item-affix') >= 0, '腐印单独分组且不与材料混在一起');
ok(card.indexOf('高级材料') >= 0 && card.indexOf('tw-item-gold') >= 0, '高级材料单独分组（金色 chip）');
ok(card.indexOf('保底碎屑') >= 0 && /tw-s-junk/.test(card), '保底碎屑压到最底部淡色一行');
ok(card.indexOf('倒在第 <b>19</b> 层') >= 0 && card.indexOf('清掉 <b>90</b> 只怪') >= 0, '诊断给出「死在第几层 + 打了多少只」');
ok(card.indexOf('获得称号：<b>登塔者</b>') >= 0, '显示获得的称号');
ok(card.indexOf('tws-again') >= 0 && card.indexOf('tws-back') >= 0 && card.indexOf('tws-close') >= 0, '三个按钮都在');

/* ============ ② 通关 + 缺字段：不许抛异常、不许掉关键词 ============ */
C(`UI.showTowerSettle(${JSON.stringify({ floors: 30, mobsPerFloor: 5, maxFloor: 30, cleared: true, tierFloor: 30, corrosion: 120, endHpPct: 24 })})`);
const card2 = els['tower-settle-card'].innerHTML;
ok(/第 <b>30<\/b> \/ 30 层/.test(card2) && card2.indexOf('全程通关') >= 0, '通关结果照常渲染（第 30 / 30 层）');
ok(card2.indexOf('极限通关') < 0, '剩血 24%（不紧张）时不提示「极限通关」');
ok(card2.indexOf('这一局什么都没拿到') >= 0, '无任何产出时给出兜底文案（不出现空区块）');
ok(card2.indexOf('tw-item-affix') < 0, '没掉腐印时不渲染腐印分组');

/* ============ ③ 详情页渲染（worldmap 节点点击的落点） ============ */
C('UI.showTowerDetail()');
const det = els['tower-detail-body'].innerHTML;
ok(els['tower-detail'].hidden === false, '详情页被打开');
ok(det.indexOf('通天塔') >= 0 && det.indexOf('共 <b>30</b> 层') >= 0, '详情页显示塔名与 30 层');
ok(det.indexOf('每层') >= 0 && det.indexOf('5 只怪') >= 0, '详情页说明每层 5 只怪');
ok(det.indexOf('长线目标') >= 0, '详情页说明 30 层是长线目标（不再写「白图能打满」）');
ok(det.indexOf('腐印（腐蚀度）') >= 0 && /tw-affix/.test(det), '详情页渲染腐印网格与腐蚀度区');
ok(det.indexOf('腐蚀度 <b>0</b>') >= 0, '白图时腐蚀度为 0（空选择合法）');
ok(det.indexOf('tw-go') >= 0, '详情页有「进入」按钮');

/* ============ ④ 说明书文案一致性（防「对玩家说假话」复发） ============ */
const t = C('JSON.stringify(Config.tower)');
ok(t.indexOf('levelStart') >= 0 && C('Config.tower.curve.levelStart') === 60 && C('Config.tower.curve.levelEnd') === 120,
  '详情页/配置口径：怪 Lv60 起步、第 30 层 Lv120');
ok(C('(Config.tower.guardianSkills||[]).length') >= 6 && C('(Config.tower.mobSkills||[]).length') >= 4,
  '配置里有守卫/杂兵技能池（详情页与百科都据此展示）');

console.log('\nALL TOWER UI TESTS PASSED (' + passCount + ' asserts)');
