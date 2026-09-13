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

const calls = { setActive: [], stop: [], settle: 0, selectArea: [], clicks: 0, switchPage: [], starts: [] };
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
  // 换图走 handoff：结算最后一段 + 只拆本地（不发 stop，服务器侧由下一次 start 停旧建新）
  handoff: async () => { calls.settle++; managed = false; },
  shutdown: async () => { calls.settle++; calls.stop.push(true); managed = false; }
};
ctx.UI = {
  showToast() {},
  switchPage(p) { calls.switchPage.push(p); },
  updateBattleArea() {}
};
/* 统一启动入口（2026-09-13）：世界地图不再"延时点主按钮"，而是直接调 Game.startIdleAt。
 * 主按钮那个桩仍然保留，用来断言**详情页没有再走按钮那条路**（clicks 不再增长）。 */
ctx.Game = {
  startIdleAt: async areaId => { calls.starts.push(areaId); return { ok: true }; },
  startIdleErrorText: () => '启动失败'
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
  const settle0 = calls.settle, stop0 = calls.stop.length, click0 = calls.clicks, start0 = calls.starts.length;
  await ndBtn('nd-idle').onclick();
  ok(JSON.stringify(calls.setActive) === '[2]', 'A3 点开始挂机后 setActive(2)（字符串 pid 归一成数字）');
  ok(calls.settle === settle0 + 1, 'A4 旧托管会话先结算（收益不丢）');
  ok(calls.stop.length === stop0, 'A5 交棒不发 stop（服务器侧由下一次 start「停旧建新」，避免乱序停掉新会话）');
  ok(calls.selectArea[calls.selectArea.length - 1] === 'plague-swamp', 'A6 已切到新图');
  ok(calls.switchPage[calls.switchPage.length - 1] === 'battle', 'A8 进入战斗页');
  ok(calls.starts.length === start0 + 1 && calls.starts[calls.starts.length - 1] === 'plague-swamp',
    'A7 直接走统一启动入口启动新挂机（2026-09-13：不再 setTimeout 点主按钮）');
  ok(calls.clicks === click0, 'A10 详情页不再"延时点主按钮"（那会依赖按钮那一刻的状态机，任一条不满足就静默失败）');
  ok(managed === false, 'A9 本地托管标志已复位（否则会被当成「停止」而不是「启动」）');

  /* —— 场景 A2：连点「开始挂机」只启动一次（切换期间按钮禁用）—— */
  ctx.__curArea = 'corrupted-forest';
  managed = true;
  openDetail('bone-wastes');
  const startA2 = calls.starts.length;
  const p1 = ndBtn('nd-idle').onclick();
  const p2 = ndBtn('nd-idle').onclick();   // 立刻再点：必须被防连点挡住
  await p1; await p2;
  ok(calls.starts.length === startA2 + 1, `A2-1 连点两次只启动一次（实际 ${calls.starts.length - startA2} 次）`);
  ok(ndBtn('nd-idle').dataset.busy === '0', 'A2-2 切换结束后按钮解锁（下次还能点）');

  // —— 场景 B：打开详情后点「返回大地图」→ 挂机毫发无损 ——
  managed = true;
  const settleB = calls.settle, stopB = calls.stop.length, setB = calls.setActive.length;
  openDetail('blood-rift');
  ndBtn('nd-back').onclick();
  ok(calls.settle === settleB && calls.stop.length === stopB && calls.setActive.length === setB, 'B1 浏览详情+返回：不结算、不停挂机、不换宠');

  // —— 场景 C：本图挂机中重复点「开始挂机」→ 只进战斗页，不再启动（那会停掉挂机）——
  ctx.__curArea = 'blood-rift';
  const clickC = calls.clicks, stopC = calls.stop.length, startC = calls.starts.length;
  managed = true;
  openDetail('blood-rift');
  await ndBtn('nd-idle').onclick();
  ok(calls.clicks === clickC && calls.stop.length === stopC && calls.starts.length === startC,
    'C1 本图已在挂：不重复启动、不停会话，只进战斗页');
  ok(calls.switchPage[calls.switchPage.length - 1] === 'battle', 'C2 已进战斗页');

  // —— 场景 D：本地挂机（?noidle 路径）换图 —— //
  managed = false; ctx.__localRunning = true; ctx.__curArea = 'corrupted-forest';
  openDetail('bone-wastes');
  const startD = calls.starts.length;
  await ndBtn('nd-idle').onclick();
  ok(ctx.__localRunning === false, 'D1 本地挂机已停');
  ok(calls.selectArea[calls.selectArea.length - 1] === 'bone-wastes', 'D2 已切到新图');
  ok(calls.starts.length === startD + 1, 'D3 走统一启动入口启动（本地/托管同一条路）');

  console.log('\nALL PREP PAGE SMOKE TESTS PASSED');
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
