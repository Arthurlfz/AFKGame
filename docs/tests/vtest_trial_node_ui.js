// vtest_trial_node_ui.js —— 资源副本节点 UI 冒烟测试（2026-09-10 整页战斗版）
// 用 DOM 桩加载 ui-worldmap.js + trial/ui-trial-entry/battle/settle：
//   ① 地图副本节点徽标刷新（refreshTrialMarkers）不抛错且写入正确文案
//   ② 点击副本节点 → showTrialDetail 渲染详情页（副本名/免费次数/门票/层数档位/进入按钮）
//   ③ 详情页「进入」按钮 → 切整页战斗页（switchPage('battle')）→ TrialEngine 逐层推进 → 结算面板
const fs = require('fs');
const vm = require('vm');

// ---- DOM 桩 ----
function stubEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', title: '', type: '', disabled: false,
    dataset: {}, style: { setProperty() {} }, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
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
  querySelector: sel => els['__' + sel] || (els['__' + sel] = stubEl(sel)),
  querySelectorAll: () => [],
  addEventListener() {}
};

const gained = [];
let ticket = 0;
const memStore = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, document: documentStub, location: { href: 'http://x' } };
ctx.localStorage = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-config.js', 'utf8'), ctx);
vm.runInContext('Config.resourceTrials.floorDelayMs = 1;', ctx); // 测试加速
vm.runInContext(fs.readFileSync('../js/core/worldmap.js', 'utf8'), ctx);
const TEST_PET = { id: 'p1', name: '小炎', level: 30, growth: 8, stats: { atk: 900, def: 300, hp: 9000 }, curHp: 9000 };
ctx.Pet = {
  getActivePet: () => TEST_PET,
  getPets: () => [TEST_PET],
  getStats: p => p.stats,
  getCurHp: p => (p.curHp != null ? p.curHp : p.stats.hp),
  setCurHp(p, hp) { p.curHp = hp; },
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
// Battle 桩：一路全赢（UI 冒烟不测强度，强度在 vtest_resource_trial）
let floorCtx = null;
ctx.Battle = {
  beginTrialFloor(c) { floorCtx = c; return true; },
  isRunning: () => false,
  isTrialMode: () => false,
  state: { mode: 'wild', enemy: null, pet: null },
  getCurrentArea: () => null
};
ctx.UI = { showToast() {}, addLog() {}, escapeHtml: null, renderAll() {} };
vm.runInContext(fs.readFileSync('../js/trial/trial-access.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-rewards.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-engine.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-worldmap.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/ui-trial-entry.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/ui-trial-settle.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/ui-trial-battle.js', 'utf8'), ctx);

const ok = (c, m) => {
  if (!c) { console.error('FAIL: ' + m); process.exit(1); }
  console.log('PASS: ' + m);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const UI = ctx.UI;
  ok(typeof UI.refreshTrialMarkers === 'function', 'UI.refreshTrialMarkers 已挂载（地图副本节点徽标刷新）');
  ok(typeof UI.showTrialDetail === 'function', 'UI.showTrialDetail 已挂载（副本节点详情页）');
  ok(typeof UI.startTrialBattle === 'function' && typeof UI.showTrialSettle === 'function',
    'ui-trial-battle / ui-trial-settle 已挂载（整页战斗驱动 + 结算面板）');

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

  // ② 点击副本节点 → 详情页渲染（层数档位预览 + 进入按钮）
  UI.showTrialDetail({ routeId: 'metamorph', name: '副本·蜕变试炼', type: 'trial', x: 8, y: 10 });
  const detail = els['area-detail'];
  ok(detail.hidden === false, '副本节点点击后详情页容器显示');
  const html = els['area-detail-body'].innerHTML;
  ok(html.indexOf('副本·蜕变试炼') >= 0, '详情页标题为「副本·蜕变试炼」');
  ok(html.indexOf('连续 <b>20</b> 层') >= 0, '详情页标明连续 20 层');
  ok(html.indexOf('第 5 层') >= 0 && html.indexOf('第 10 层') >= 0 && html.indexOf('第 15 层') >= 0 && html.indexOf('第 20 层') >= 0,
    '详情页按层数档位展示奖励预览（5/10/15/20 层）');
  ok(html.indexOf('血量跨层累计') >= 0, '详情页标明血量跨层累计规则');
  ok(html.indexOf('免费') >= 0 && html.indexOf('/3') >= 0, '详情页展示每日免费次数（免费 3/3）');
  ok(html.indexOf('资源试炼门票') >= 0, '详情页展示门票信息');
  ok(html.indexOf('nd-trial-go') >= 0, '详情页有「进入」按钮');

  // ③ 点击进入 → 切整页战斗页 → 逐层推进（测试驱动一路全赢）→ 结算面板
  const pages = [];
  UI.switchPage = page => pages.push(page); // 拦截页面切换
  const go = els['area-detail-body'].querySelector('#nd-trial-go');
  const runPromise = go.onclick();
  ok(ticket === 0, '免费进入不消耗门票');
  // 逐层驱动：等引擎开层 → 全赢回层
  let guard = 0;
  while (guard++ < 500) {
    await sleep(1);
    if (floorCtx) {
      const fc = floorCtx; floorCtx = null;
      fc.onEnd({ win: true, petHp: 8000, petMaxHp: 9000 });
    } else if (!ctx.TrialEngine.getState().running) {
      break;
    }
  }
  await runPromise;
  ok(pages.indexOf('battle') >= 0, '进入副本后切到整页战斗页（switchPage("battle")）');
  ok(els['trial-settle'].hidden === false, '战斗结束后弹出结算面板');
  const settleHtml = els['trial-settle-card'].innerHTML;
  ok(settleHtml.indexOf('通关') >= 0, '结算面板显示通关结果');
  ok(settleHtml.indexOf('20</b>/20') >= 0 || settleHtml.indexOf('到达 <b>20</b>') >= 0, '结算面板显示到达 20/20 层');
  ok(settleHtml.indexOf('传说进化素材') >= 0, '结算面板展示第 20 层档位奖励（传说进化素材）');
  ok(settleHtml.indexOf('今日免费剩余 2') >= 0, '结算面板显示消耗后今日免费剩余（3→2）');
  ok(settleHtml.indexOf('ts-again') >= 0, '结算面板有「再打一次」按钮');

  console.log('ALL TRIAL NODE UI SMOKE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
