// vtest_trial_node_ui.js —— 资源副本节点 UI 冒烟测试
// 用 DOM 桩加载 ui-worldmap.js + ui-resource-trial.js：
//   ① 地图副本节点徽标刷新（refreshTrialMarkers）不抛错且写入正确文案
//   ② 点击副本节点 → showTrialDetail 渲染详情页（副本名/免费次数/门票/开始按钮）
//   ③ 详情页「开始试炼」按钮触发 ResourceTrial.start
const fs = require('fs');
const vm = require('vm');

// ---- DOM 桩 ----
function stubEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', title: '', type: '', disabled: false,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    scrollIntoView() {},
    // 子选择器按 (元素id + 选择器) 缓存，保证同一查询拿到同一桩（onclick 绑定可被测试复取）
    querySelector(sel) { return els['__' + id + sel] || (els['__' + id + sel] = stubEl(id + sel)); },
    querySelectorAll() { return []; }
  };
  return el;
}
const els = {};
const documentStub = {
  getElementById: id => els[id] || (els[id] = stubEl(id)),
  createElement: () => stubEl('created'),
  // ui-worldmap.js 用 document.querySelector（UI.$ 未设置时）；同一选择器返回同一缓存桩
  querySelector: sel => els['__' + sel] || (els['__' + sel] = stubEl(sel)),
  querySelectorAll: () => [],
  addEventListener() {}
};

const gained = [];
let ticket = 0;
let started = 0;
const memStore = {};
const ctx = { console, setTimeout, clearTimeout, Date, document: documentStub, location: { href: 'http://x' } };
ctx.localStorage = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/worldmap.js', 'utf8'), ctx);
ctx.Pet = {
  getActivePet: () => ({ id: 'p1', name: '小炎', level: 10, growth: 3.5 }),
  getPets: () => [{ id: 'p1', name: '小炎', level: 10, growth: 3.5 }],
  getStats: p => ({ atk: 500, def: 500, hp: 5000 }),
  setActive() {}
};
ctx.Materials = {
  getQuantity: name => (name === '资源试炼门票' ? ticket : 0),
  spend: async (name, amount) => {
    if (name !== '资源试炼门票' || ticket < amount) return { ok: false, error: '门票不足' };
    ticket -= amount;
    return { ok: true };
  },
  gain: (name, qty) => gained.push([name, qty])
};
ctx.UI = { renderResourceTrial() {}, showToast() {} };
vm.runInContext(fs.readFileSync('../js/core/resource-trial.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-worldmap.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-resource-trial.js', 'utf8'), ctx);

const ok = (c, m) => {
  if (!c) { console.error('FAIL: ' + m); process.exit(1); }
  console.log('PASS: ' + m);
};

(async () => {
  const UI = ctx.UI;
  ok(typeof UI.refreshTrialMarkers === 'function', 'UI.refreshTrialMarkers 已挂载（地图副本节点徽标刷新）');
  ok(typeof UI.showTrialDetail === 'function', 'UI.showTrialDetail 已挂载（副本节点详情页）');

  // ① 徽标刷新：三个副本节点 + 免费次数徽标
  const canvas = documentStub.querySelector('worldmap-canvas');
  const markers = ['metamorph', 'nirvana', 'temper'].map(rid => {
    const m = stubEl('m-' + rid);
    m.dataset.routeId = rid;
    const badge = stubEl('badge-' + rid);
    badge.textContent = '';
    badge.classList.toggle = () => {};
    m.querySelector = sel => (sel === '.wm-marker-remain' ? badge : stubEl('q-' + rid));
    return m;
  });
  canvas.querySelectorAll = sel => (sel === '.wm-marker--trial' ? markers : []);
  UI.refreshTrialMarkers();
  ok(markers.every(m => m.querySelector('.wm-marker-remain').textContent === '免费3'),
    '徽标显示今日免费剩余 3 次（免费3 / 免费3 / 免费3）');

  // ② 点击副本节点 → 详情页渲染（ui-resource-trial 内部用 document.getElementById）
  UI.showTrialDetail({ routeId: 'metamorph', name: '副本·蜕变试炼', type: 'trial', x: 8, y: 10 });
  const detail = els['area-detail'];
  ok(detail.hidden === false, '副本节点点击后详情页容器显示');
  const html = els['area-detail-body'].innerHTML;
  ok(html.indexOf('副本·蜕变试炼') >= 0, '详情页标题为「副本·蜕变试炼」');
  ok(html.indexOf('免费') >= 0 && html.indexOf('/3') >= 0, '详情页展示每日免费次数（免费 3/3）');
  ok(html.indexOf('资源试炼门票') >= 0, '详情页展示门票信息');
  ok(html.indexOf('nd-trial-go') >= 0, '详情页有「开始试炼」按钮');

  // ③ 点击开始 → 先渲染战斗画面（不 await，同步段已完成），打完弹结算面板
  const go = els['area-detail-body'].querySelector('#nd-trial-go');
  const runPromise = go.onclick();
  const battleHtml = els['area-detail-body'].innerHTML;
  ok(battleHtml.indexOf('trial-battle') >= 0, '进入副本后显示战斗画面（试炼战斗舞台）');
  ok(battleHtml.indexOf('tb-stage') >= 0, '战斗画面包含敌我双方舞台');
  ok(battleHtml.indexOf('tb-log') >= 0, '战斗画面包含战斗日志区');
  ok(battleHtml.indexOf('守护者') >= 0, '战斗画面显示守关者（守护者）');
  await runPromise;
  ok(ticket === 0, '免费进入不消耗门票');
  ok(els['tb-round'].textContent === '5', '战斗画面播满 5 场（场次计数=5）');
  ok((els['tb-log'].children || []).length >= 5, '战斗日志累积每场一条');
  ok(els['trial-settle'].hidden === false, '战斗结束后弹出结算面板');
  const settleHtml = els['trial-settle-card'].innerHTML;
  ok(settleHtml.indexOf('通关') >= 0, '结算面板显示通关结果');
  ok(settleHtml.indexOf('进化素材') >= 0 || settleHtml.indexOf('奖励') >= 0, '结算面板展示奖励');
  ok(settleHtml.indexOf('今日免费剩余 2') >= 0, '结算面板显示消耗后今日免费剩余（3→2）');
  ok(settleHtml.indexOf('ts-again') >= 0, '结算面板有「再打一次」按钮');

  console.log('ALL TRIAL NODE UI SMOKE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
