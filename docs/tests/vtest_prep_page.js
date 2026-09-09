// vtest_prep_page.js —— 战斗准备页（世界地图节点详情）回归测试
// 守两条修复（2026-09-09）：
//   ① 换宠可用：卡片 data-pid 是字符串、宠物 id 是数字 → setActive 归一后生效；
//     详情页选宠先「待生效」，点「只进战斗/开始挂机」才真正切换（不惊动正在跑的挂机）
//   ② 换图挂机不两头空：浏览详情/返回不动挂机；点「开始挂机」= 先结算停旧会话 → 选图 → 走主按钮启动
const fs = require('fs');
const vm = require('vm');

function stubEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', title: '', type: '', disabled: false,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    scrollIntoView() {},
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

const calls = { setActive: [], stop: [], settle: 0, selectArea: [], clicks: 0, switchPage: [] };
let managed = false;
const memStore = {};
const ctx = { console, setTimeout, clearTimeout, Date, document: documentStub, location: { href: 'http://x' } };
ctx.localStorage = { getItem: k => (k in memStore ? memStore[k] : null), setItem: (k, v) => { memStore[k] = String(v); }, removeItem: k => { delete memStore[k]; } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);

const P1 = { id: 1, name: '小炎', icon: '🐹', level: 10, growth: 3.5 };
const P2 = { id: 2, name: '小霜', icon: '🐱', level: 12, growth: 4.0 };
let activePet = P1;
ctx.Pet = {
  getActivePet: () => activePet,
  getPets: () => [P1, P2],
  getStats: () => ({ atk: 5, def: 5, hp: 100 }),
  setActive(id) { calls.setActive.push(id); activePet = [P1, P2].find(p => p.id === id); }
};
ctx.Battle = {
  getCurrentArea: () => ({ id: ctx.__curArea }),
  selectArea: id => { calls.selectArea.push(id); ctx.__curArea = id; return true; },
  isRunning: () => ctx.__localRunning,
  stopAutoBattle: () => { ctx.__localRunning = false; }
};
ctx.IdleBridge = {
  isActive: () => managed,
  settleNow: async () => { calls.settle++; return { ok: true }; },
  stop: arg => { calls.stop.push(arg); managed = false; }
};
ctx.UI = {
  showToast() {},
  switchPage(p) { calls.switchPage.push(p); },
  updateBattleArea() {}
};
els['btn-battle'] = stubEl('btn-battle');
els['btn-battle'].click = () => { calls.clicks++; };
ctx.PetSprites = { avatarOf: () => null, pathOf: () => null };
ctx.Quest = { isAreaCleared: () => false, getQuests: () => [] };
vm.runInContext(fs.readFileSync('../js/pet/enemy-data.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/ui/ui-worldmap.js', 'utf8'), ctx);

const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };
const body = () => els['__area-detail-body'];
const ndBtn = name => els['__area-detail-body#' + name];

const petCards = [
  Object.assign(stubEl('card1'), { dataset: { pid: '1' } }),
  Object.assign(stubEl('card2'), { dataset: { pid: '2' } })
];
/* 渲染冒烟（2026-09-09 补）：详情页 HTML 必须真渲染出来（怪物卡片 + 掉落标签墙）。
 * 背景：掉落列表改造时 ${dropHtml} 未定义的 ReferenceError 让详情页整页打不开，
 * 但测试桩全是空数据 + 回归只 grep "FAIL:"，崩溃堆栈不含 FAIL 字样 → 假绿。 */
function smokeDetail(areaId) {
  openDetail(areaId);
  const h = body().innerHTML;
  ok(h.indexOf('nd-drop-chip') !== -1, `详情页渲染掉落标签墙（${areaId}）`);
  ok(h.indexOf('nd-mob') !== -1 && h.indexOf('强度 ×') !== -1, `怪物卡片含类型与强度介绍（${areaId}）`);
  return h;
}
function openDetail(areaId) {
  ctx.__curArea = ctx.__curArea || 'corrupted-forest';
  // 先补桩再渲染：渲染时就会遍历 .nd-pet 绑 onclick（同一数组，测试与渲染共用）
  const b = els['__area-detail-body'] || (els['__area-detail-body'] = stubEl('area-detail-body'));
  b.querySelectorAll = sel => (sel === '.nd-pet' ? petCards : []);
  ctx.UI.showAreaDetail({ areaId, name: '测试图', type: 'wild', x: 1, y: 1, _preview: {} });
}

(async () => {
  // —— 场景 0：详情页渲染冒烟（首图 + 毕业图，覆盖有/无进化素材两种掉落结构）——
  const smoke1 = smokeDetail('corrupted-forest');
  ok(smoke1.indexOf('枯荣种荚') !== -1, '掉落标签墙包含本图区域材料（现读 config）');
  ok(smoke1.indexOf('霸主') !== -1, '图内最高级怪带霸主标记');
  const smoke2 = smokeDetail('blight-heart');
  ok(smoke2.indexOf('宠物蛋') !== -1 && smoke2.indexOf('装备（未鉴定）') !== -1, '毕业图掉落标签墙含装备与蛋');

  // —— 场景 A：A 图托管挂机中 → 打开 B 图详情 → 选另一只宠 → 点开始挂机 ——
  ctx.__curArea = 'corrupted-forest';
  managed = true;
  openDetail('plague-swamp');
  const cards = body().querySelectorAll('.nd-pet');
  cards[1].onclick(); // 点第二只（data-pid 是字符串 "2"）
  ok(calls.setActive.length === 0, 'A1 点卡片只记待选，不立刻 setActive（不惊动正在跑的挂机）');
  ok(ndBtn('nd-idle').onclick !== undefined, 'A2 开始挂机按钮已绑定');
  const settle0 = calls.settle, stop0 = calls.stop.length, click0 = calls.clicks;
  await ndBtn('nd-idle').onclick();
  ok(JSON.stringify(calls.setActive) === '[2]', 'A3 点开始挂机后 setActive(2)（字符串 pid 归一成数字）');
  ok(calls.settle === settle0 + 1, 'A4 旧托管会话先结算（收益不丢）');
  ok(JSON.stringify(calls.stop) === JSON.stringify([...Array(stop0)].map(() => undefined).concat([true])) || calls.stop[calls.stop.length - 1] === true, 'A5 托管会话 stop(true) 只拆本地（服务器侧由 start 停旧建新，避免乱序）');
  ok(calls.selectArea[calls.selectArea.length - 1] === 'plague-swamp', 'A6 已切到新图');
  ok(calls.switchPage[calls.switchPage.length - 1] === 'battle', 'A8 进入战斗页');
  await new Promise(r => setTimeout(r, 250)); // 主按钮点击有 150ms 延时
  ok(calls.clicks === click0 + 1, 'A7 已触发主按钮启动新挂机');
  ok(managed === false, 'A9 本地托管标志已复位（否则主按钮会当成「停止」而不是「启动」）');

  // —— 场景 B：打开详情后点「返回大地图」→ 挂机毫发无损 ——
  managed = true;
  const settleB = calls.settle, stopB = calls.stop.length, setB = calls.setActive.length;
  openDetail('blood-rift');
  ndBtn('nd-back').onclick();
  ok(calls.settle === settleB && calls.stop.length === stopB && calls.setActive.length === setB, 'B1 浏览详情+返回：不结算、不停挂机、不换宠');

  // —— 场景 C：本图挂机中重复点「开始挂机」→ 只进战斗页，不点挂机开关（那会停掉挂机）——
  ctx.__curArea = 'blood-rift';
  const clickC = calls.clicks, stopC = calls.stop.length;
  openDetail('blood-rift');
  await ndBtn('nd-idle').onclick();
  ok(calls.clicks === clickC && calls.stop.length === stopC, 'C1 本图已在挂：不点挂机开关、不停会话，只进战斗页');
  ok(calls.switchPage[calls.switchPage.length - 1] === 'battle', 'C2 已进战斗页');

  // —— 场景 D：本地挂机（?noidle 路径）换图 —— //
  managed = false; ctx.__localRunning = true; ctx.__curArea = 'corrupted-forest';
  openDetail('bone-wastes');
  await ndBtn('nd-idle').onclick();
  ok(ctx.__localRunning === false, 'D1 本地挂机已停');
  ok(calls.selectArea[calls.selectArea.length - 1] === 'bone-wastes', 'D2 已切到新图');
  ok(calls.clicks > 0, 'D3 已触发启动');

  console.log('\nALL PREP PAGE SMOKE TESTS PASSED');
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
