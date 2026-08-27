/* ============================================================
 * vtest_marketbot.js —— 市场冷启动（流浪商人假卖家挂单）测试
 * 验收场景：
 *  1. MarketBot.start() 立即补货 → 在售假货 ≥ minActive(20)（市场打开不是空的）
 *  2. 假单结构：isBot / seller=流浪商人 / 装备字段合法 / 价格合法
 *  3. 低价漏：Math.random 归零时必出漏 → 价格 = 该档最低价 × leakDiscount
 *  4. 购买假单：扣材料（云端）+ 装备入包 + 写买家存档 + 假单移除
 *  5. 材料不足 / 未登录 → 拒绝且假单保留
 *  6. 补货逻辑：< minActive 补到 minActive；≥ minActive 每轮固定 +perTick
 *  7. 真实玩家挂单与假单共存（getItemListings 合并，互不影响）
 * 运行：node vtest_marketbot.js（须在 tests/ 目录）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return {
  getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) },
  removeItem: k => { delete m[k] }
}; })();
function el() { return {
  textContent: '', innerHTML: '', style: { setProperty() {} }, classList: { add() {}, remove() {} },
  appendChild(c) { this.children.push(c) }, append() {}, addEventListener() {}, querySelector: () => el(),
  querySelectorAll: () => [], children: [], removeChild() {}, remove() {},
  scrollTop: 0, scrollHeight: 0, disabled: false, value: '0'
}; }
const els = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch,
  URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData,
  Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto,
  WebSocket: globalThis.WebSocket, navigator: { lock: undefined },
  location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el() },
  session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [],
  materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: []
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
// 只加载到 market_bot（UI 不加载 → MarketBot.tick 内 UI.renderMarket 判空跳过）
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
  '../js/core/items.js', '../js/core/materials.js', '../js/core/market.js', '../js/core/market_bot.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };
const matQ = uid => name => {
  const row = ctx.materialsTable.find(x => x.user_id === uid && x.name === name);
  return row ? row.quantity : 0;
};

(async () => {
  await S(50);
  console.log('=== 市场冷启动（流浪商人）测试 ===\n');
  C('Supabase.init()');

  // --- 1. 登录 + 给足材料（vstub 的登录用户 id 固定为 user-a） ---
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'user-a', 'A(alice) 登录');
  await C('Materials.gain("强化石", 200)');
  await S(50);
  assert(matQ('user-a')('强化石') === 200, 'A 持有 200 强化石');

  // --- 2. start() 立即补货：在售假货 ≥ minActive(20)，市场打开不是空的 ---
  await C('MarketBot.start()');
  await S(30);
  const n = C('Market.getBotListings().length');
  assert(n >= 20, `MarketBot.start() 立即补货 → 在售假货 ${n} ≥ 20`);
  assert(C('Market.getItemListings().length') >= 20, 'getItemListings() 合并包含假单（市场不为空）');

  // --- 3. 假单结构合法 ---
  const l0 = C('Market.getBotListings()[0]');
  assert(l0.isBot === true, '假单 isBot=true');
  assert(l0.seller === '流浪商人', '假单卖家 = 流浪商人');
  assert(['white', 'blue', 'gold'].includes(l0.item_rarity), `假单稀有度合法（${l0.item_rarity}）`);
  assert(typeof l0.item_tier === 'number' && l0.item_tier >= 1 && l0.item_tier <= 5, `假单 T 阶合法（T${l0.item_tier}）`);
  assert(Array.isArray(l0.item_affixes) && l0.item_affixes.length >= 1, `假单有词缀（${l0.item_affixes.length} 条）`);
  assert(l0.material_type && l0.material_qty >= 1, `假单标价合法（${l0.material_qty} ${l0.material_type}）`);
  assert(l0.eq && l0.eq.base && l0.eq.affixes, '假单持有完整装备对象（购买入包用）');

  // --- 4. 低价漏：Math.random 归零 → 必出漏，价格 = 该档最低价 × leakDiscount ---
  C('var __origRandom = Math.random'); // 先存原始引用（vm 内变量，native 函数不能 toString 还原）
  C('Math.random = () => 0');          // randInt→最小值、pickWeighted→第一项(enhance)、random<leakChance 恒真
  C('MarketBot.tick()');               // 生成一批（全白装 + 强化石 + 漏）
  C('Math.random = __origRandom');     // 还原
  await S(30);
  const leak = C('Market.getBotListings().find(l => l.isLeak)');
  assert(!!leak, '随机归零时生成出低价漏（isLeak=true）');
  // enhance.white range=[2,6] → 漏价 = max(1, floor(2×0.5)) = 1
  assert(leak.item_rarity === 'white' && leak.material_type === '强化石' && leak.material_qty === 1,
    `漏价 = 该档最低价×折扣：白装强化石 1 个（实际 ${leak.material_qty} ${leak.material_type}）`);

  // --- 5. 购买假单：扣材料（云端）+ 装备入包 + 写买家存档 + 假单移除 ---
  const buyId = C('Market.getBotListings()[0].id');
  const beforeMat = matQ('user-a')('强化石');
  const r = await C(`Market.buyBotItem("${buyId}")`);
  assert(r.ok === true, '购买假单成功');
  assert(matQ('user-a')('强化石') === beforeMat - 1, `购买扣 1 强化石（云端：${beforeMat}→${matQ('user-a')('强化石')}）`);
  assert(C('Equipment.getInventory().length') === 1, '装备已入买家背包');
  assert(C('Equipment.getInventory()[0].cloudId') !== null, '购买装备已写买家存档（cloudId 回写）');
  assert(ctx.itemsTable.some(x => x.user_id === 'user-a' && x.id === C('Equipment.getInventory()[0].cloudId')),
    '云端 equip_items 有买家存档记录');
  assert(!C('Market.getBotListings().some(l => l.id === "' + buyId + '")'), '假单已从市场移除');

  // --- 6. 材料不足 → 拒绝且假单保留 ---
  // 先买掉大部分假单（每件 1 强化石），同时验证批量购买
  const cheap = C('Market.getBotListings().filter(l => l.material_qty === 1 && l.material_type === "强化石").length');
  for (let i = 0; i < Math.min(cheap, 15); i++) {
    const id = C('Market.getBotListings().find(l => l.material_qty === 1 && l.material_type === "强化石").id');
    await C(`Market.buyBotItem("${id}")`);
  }
  await S(30);
  const afterBuy = C('Market.getBotListings().length');
  assert(afterBuy >= 1, `批量购买后假单剩 ${afterBuy} 件`);
  // 材料清零后买任何在售假单都该拒绝
  await C('Materials.gain("强化石", 1000)'); // 先补足，避免干扰下一步补货断言
  await S(50);
  const spendId = C('Market.getBotListings()[0].id');
  // 直接清空云端材料
  const uid = 'user-a';
  const mrow = ctx.materialsTable.find(x => x.user_id === uid && x.name === '强化石');
  if (mrow) mrow.quantity = 0;
  await C('Materials.setCloudMaterials([])'); // 本地也清零
  const poor = await C(`Market.buyBotItem("${spendId}")`);
  assert(poor.error && (poor.error.includes('不足') || poor.error.includes('不足（云端）')),
    `材料不足拒绝购买（${poor.error}）`);
  assert(C('Market.getBotListings().some(l => l.id === "' + spendId + '")'), '材料不足时假单保留');

  // --- 7. 未登录 → 拒绝 ---
  await C('Supabase.signOut()');
  await S(30);
  const anon = await C(`Market.buyBotItem("${spendId}")`);
  assert(anon.error === '请先登录', `未登录拒绝购买（${anon.error}）`);

  // --- 8. 补货逻辑：< minActive 补到 minActive；≥ minActive 每轮固定 +perTick ---
  // 当前假单数（此前 buy 掉一部分 + 未登录买不了，数量应 < 20）
  const cur = C('Market.getBotListings().length');
  C('MarketBot.tick()'); // 补货
  await S(30);
  const after1 = C('Market.getBotListings().length');
  if (cur < 20) {
    assert(after1 === 20, `少于 20 补货到 20（${cur} → ${after1}）`);
  } else {
    assert(after1 === cur + 5, `≥ 20 每轮固定 +5（${cur} → ${after1}）`);
  }
  const after2 = C('Market.getBotListings().length');
  C('MarketBot.tick()'); // 再来一轮：≥20 时只 +5
  await S(30);
  assert(C('Market.getBotListings().length') === after2 + 5, `补货达标后每 30 秒固定上架 5 件（${after2} → ${C('Market.getBotListings().length')}）`);

  // --- 9. 真实玩家挂单与假单共存 ---
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  await C(`
    (async () => {
      const eq = Equipment.generateEquipment(Config.equipment.rarities.find(x => x.id === "gold"));
      Equipment.addToInventory(eq);
      eq.cloudId = (await Items.saveItem(eq)).data.id;
      await Market.listItem(eq, "强化石", 8);
    })()
  `);
  await S(50);
  await C('Market.refresh()');
  await S(50);
  const merged = C('Market.getItemListings()');
  const real = merged.filter(l => !l.isBot);
  assert(real.length === 1 && real[0].item_name, '真实玩家挂单仍正常展示（与假单共存）');
  assert(merged.some(l => l.isBot), '假单仍在市场里');

  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
