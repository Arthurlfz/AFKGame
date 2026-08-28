/* ============================================================
 * vtest_botbuy.js —— 市场冷启动第二步：假买家（流浪商人）购买玩家挂单
 * 验收场景：
 *  1. pickBuyTarget：优先买「低于市场参考价」的挂单；无低价则买最便宜的
 *  2. tryBuyOnce：有玩家挂单 → 买走 1 件 → 卖家材料到账（标价-税）→ 挂单消失 → 交易记录双写（买家=流浪商人）→ 装备行删除
 *  3. 无玩家挂单 → 不购买（不发 RPC）
 *  4. 挂单已被真人买走（RPC 返回 notfound）→ 本轮跳过
 * 运行：node vtest_botbuy.js（须在 tests/ 目录）
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
  materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: []
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
  '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/core/market_bot.js']) {
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
  console.log('=== 市场冷启动第二步：假买家购买玩家挂单 ===\n');
  C('Supabase.init()');
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'user-a', 'A(alice) 登录（vstub 用户 id=user-a）');

  // 上架辅助：造一件云端装备并挂单
  const mk = async (name, rarityId, matType, qty) => {
    await C(`
      (async () => {
        var eq = { cloudId: null, name: '${name}', slot: '武器', tier: 2,
          rarity: { id: '${rarityId}', label: 'x', color: '#ccc' },
          affixes: [{ type: 'atk', label: '攻击', tier: 3, value: 15 }],
          base: { type: 'atk', label: '攻击', value: 5 } };
        eq.cloudId = (await Items.saveItem(eq)).data.id;
        await Market.listItem(eq, '${matType}', ${qty});
      })()
    `);
    await S(50);
  };

  // --- 1. pickBuyTarget：优先「低于市场参考价」的挂单 ---
  // 白装重铸石参考价 enhance.white range=[2,6]；5 便宜、8 不便宜
  await mk('低价的剑', 'white', '重铸石', 5);
  await mk('贵价的盾', 'white', '重铸石', 8);
  await C('Market.refresh()');
  await S(50);
  const picked = C('MarketBot.pickBuyCandidate(Market.getRealItemListings(), [])');
  assert(picked && picked.item_name === '低价的剑', `优先买低于市场参考价的挂单（选中：${picked && picked.item_name}，qty=${picked && picked.material_qty}）`);
  // 全都不便宜 → 选最便宜的
  const cheapest = C('MarketBot.pickBuyCandidate(Market.getRealItemListings().filter(l => l.item_name !== "低价的剑"), [])');
  assert(cheapest.item_name === '贵价的盾', '无低价时买最便宜的（选中贵价的盾）');

  // --- 2. tryBuyOnce 集成：买走 1 件 → 卖家收材料 → 挂单移除 → 双写记录 → 装备行删除 ---
  const before = matQ('user-a')('重铸石');
  const r = await C('MarketBot.tryBuyOnce()');
  assert(r.bought === true && r.itemName === '低价的剑', `假买家买走 1 件（${r.itemName}）`);
  assert(matQ('user-a')('重铸石') === before + 5, `卖家收到 5 重铸石（${before} → ${matQ('user-a')('重铸石')}）`);
  assert(!C('Market.getRealItemListings().some(l => l.item_name === "低价的剑")'), '被买走的挂单已从市场消失');
  assert(!ctx.itemsTable.some(x => x.name === '低价的剑'), '装备行已删除（NPC 买走不占玩家账号）');
  const botRecs = ctx.tradeTable.filter(x => x.item_name === '低价的剑');
  assert(botRecs.some(x => x.player_id === '流浪商人' && x.role === 'buy' && x.price_qty === 5 && x.tax_qty === 0),
    '交易记录：买家=流浪商人 buy 5（税0）');
  assert(botRecs.some(x => x.player_id === 'user-a' && x.role === 'sell' && x.price_qty === 5 && x.tax_qty === 0 && x.net_qty === 5),
    '交易记录：卖家 sell 5（5<8 不满税）');

  // --- 3. 带税的购买（每满8收1）：上架 10 重铸石 → 卖家实收 9 ---
  await mk('玄铁剑', 'blue', '重铸石', 10);
  await C('Market.refresh()');
  await S(50);
  const before2 = matQ('user-a')('重铸石');
  const r2 = await C('MarketBot.tryBuyOnce()');
  assert(r2.bought === true && r2.itemName === '玄铁剑', `假买家再买 1 件（${r2.itemName}）`);
  assert(matQ('user-a')('重铸石') === before2 + 9, `卖家实收 9 重铸石（标价10-税1，${before2} → ${matQ('user-a')('重铸石')}）`);
  const sellRec = ctx.tradeTable.find(x => x.item_name === '玄铁剑' && x.role === 'sell');
  assert(sellRec && sellRec.tax_qty === 1 && sellRec.net_qty === 9, '交易记录：玄铁剑 sell 税1 实收9');

  // --- 4. 无玩家挂单 → 不购买（不发 RPC） ---
  await C('itemListTable.length = 0');
  await C('Market.refresh()');
  await S(50);
  const rpcBefore = C('rpcCalls.filter(n => n === "bot_buy_equip").length');
  const r3 = await C('MarketBot.tryBuyOnce()');
  assert(r3.bought === false, '无玩家挂单 → 不购买');
  assert(C('rpcCalls.filter(n => n === "bot_buy_equip").length') === rpcBefore, '未调用 bot_buy_equip RPC');

  // --- 5. 挂单已被真人买走（RPC notfound）→ 本轮跳过 ---
  await mk('已售盾', 'white', '重铸石', 3);
  await C('Market.refresh()');
  await S(50);
  const lid = C('Market.getRealItemListings()[0].id');
  await C('Market.buyItem("' + lid + '")'); // 真人买走
  await S(50);
  const r4 = await C('MarketBot.tryBuyOnce()');
  assert(r4.bought === false, '挂单已被真人买走 → 本轮不买');

  console.log('\nALL BOTBUY TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
