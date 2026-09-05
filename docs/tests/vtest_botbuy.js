/* ============================================================
 * vtest_botbuy.js —— 市场冷启动第二步：假买家（流浪商人）购买玩家挂单
 * 安全基线（2026-09-03 起，见 migrate_security_hardening.sql）：
 *   机器人（用当前登录账号召唤）只买「别人」的挂单；自己的挂单云 RPC 也返回 'self'。
 * 验收场景：
 *  1. pickBuyTarget：优先买「低于市场参考价」的挂单；无低价则买最便宜的
 *  2. tryBuyOnce：有「其他玩家」挂单 → 买走 1 件 → 卖家材料到账（标价-税）→ 挂单消失
 *     → 交易记录双写（买家=流浪商人）→ 装备行删除；买家（本账号）材料不变
 *  2b. 自己的低价挂单不被 AI 买走（防自挂自买刷材料）——即使它比别人的更便宜
 *  3. 无玩家挂单 → 不购买（不发 RPC）
 *  4. 高于参考价的挂单不被兜底收购
 *  5. 挂单已被真人买走（RPC 返回 notfound）→ 本轮跳过
 * 运行：node vtest_botbuy.js（须在 tests/ 目录）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
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
  VTF.load(ctx, f);
}
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };
const matQ = uid => name => {
  const row = ctx.materialsTable.find(x => x.user_id === uid && x.name === name);
  return row ? row.quantity : 0;
};

// 直接造一个「别的玩家」user-b 的云端挂单（含装备本体行，云 RPC 会删装备行）
const mkB = async (name, rarityId, matType, qty) => {
  await C(`
    (async () => {
      var itId = 'it-' + (++uidSeq);
      itemsTable.push({ id: itId, user_id: 'user-b', name: '${name}', slot: '武器' });
      itemListTable.push({
        id: 'el-' + (++uidSeq), item_id: itId, seller_id: 'user-b', status: 'active',
        item_name: '${name}', item_slot: '武器', item_rarity: '${rarityId}', item_tier: 2,
        item_affixes: [{ type: 'atk', tier: 3, value: 15 }], item_soul: null,
        material_type: '${matType}', material_qty: ${qty},
        created_at: new Date().toISOString()
      });
    })()
  `);
  await S(30);
};

(async () => {
  await S(50);
  console.log('=== 市场冷启动第二步：假买家购买玩家挂单（安全基线：只买别人的单） ===\n');
  C('Supabase.init()');
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'user-a', 'A(alice) 登录（vstub 用户 id=user-a）');

  // --- 1. pickBuyTarget：优先「低于市场参考价」的挂单 ---
  // 白装重铸石参考价 enhance.white range=[2,6]；5 便宜、8 不便宜
  await mkB('低价的剑', 'white', '重铸石', 5);
  await mkB('贵价的盾', 'white', '重铸石', 8);
  await C('Market.refresh()');
  await S(50);
  const picked = C('MarketBot.pickBuyCandidate(Market.getRealItemListings(), [])');
  assert(picked && picked.item_name === '低价的剑', `优先买低于市场参考价的挂单（选中：${picked && picked.item_name}，qty=${picked && picked.material_qty}）`);
  // 全都不便宜 → 不购买
  const cheapest = C('MarketBot.pickBuyCandidate(Market.getRealItemListings().filter(l => l.item_name !== "低价的剑"), [])');
  assert(cheapest === null, '无低价挂单时不购买（返回 null）');

  // --- 2. tryBuyOnce 集成：买走别人 1 件 → 卖家(user-b)收材料 → 挂单移除 → 双写记录 → 装备行删除 ---
  const r = await C('MarketBot.tryBuyOnce()');
  assert(r.bought === true && r.itemName === '低价的剑', `假买家买走 1 件（${r.itemName}）`);
  assert(matQ('user-b')('重铸石') === 5, `卖家 user-b 收到 5 重铸石（当前 ${matQ('user-b')('重铸石')}）`);
  assert(matQ('user-a')('重铸石') === 0, `买家 alice 不自刷材料（仍为 0）`);
  assert(!C('Market.getRealItemListings().some(l => l.item_name === "低价的剑")'), '被买走的挂单已从市场消失');
  assert(!ctx.itemsTable.some(x => x.name === '低价的剑'), '装备行已删除（NPC 买走不占玩家账号）');
  const botRecs = ctx.tradeTable.filter(x => x.item_name === '低价的剑');
  assert(botRecs.some(x => x.player_id === '流浪商人' && x.role === 'buy' && x.price_qty === 5 && x.tax_qty === 0),
    '交易记录：买家=流浪商人 buy 5（税0）');
  assert(botRecs.some(x => x.player_id === 'user-b' && x.role === 'sell' && x.price_qty === 5 && x.tax_qty === 0 && x.net_qty === 5),
    '交易记录：卖家 sell 5（5<8 不满税）');

  // --- 2b. 自己的低价挂单不被 AI 买走（防自挂自买刷材料） ---
  await C('itemListTable.length = 0');
  await C('itemsTable.length = 0');
  // alice 自己挂一件 qty=1 的超便宜货；user-b 挂 qty=5 的（若不过滤，qty1 一定被优先买走）
  await mkB('别人卖的货', 'white', '重铸石', 5);
  await C(`
    (async () => {
      var itId = 'it-' + (++uidSeq);
      itemsTable.push({ id: itId, user_id: 'user-a', name: '自己的货', slot: '武器' });
      itemListTable.push({
        id: 'el-' + (++uidSeq), item_id: itId, seller_id: 'user-a', status: 'active',
        item_name: '自己的货', item_slot: '武器', item_rarity: 'white', item_tier: 2,
        item_affixes: [{ type: 'atk', tier: 3, value: 15 }], item_soul: null,
        material_type: '重铸石', material_qty: 1,
        created_at: new Date().toISOString()
      });
    })()
  `);
  await S(30);
  await C('Market.refresh()');
  await S(50);
  const r2 = await C('MarketBot.tryBuyOnce()');
  assert(r2.bought === true && r2.itemName === '别人卖的货', `AI 只买别人的货（买了：${r2.itemName}）`);
  assert(C('Market.getRealItemListings().some(l => l.item_name === "自己的货")'), '自己的超低价挂单仍在市场（没被 AI 自买）');
  assert(matQ('user-a')('重铸石') === 0, `alice 没收到自己单的材料（0）`);
  assert(matQ('user-b')('重铸石') === 10, `user-b 又收到 5 重铸石（累计 10）`);

  // --- 3. 高于参考价的挂单不能被流浪商人兜底收购 ---
  await C('itemListTable.length = 0');
  await C('itemsTable.length = 0');
  await mkB('高价的甲', 'white', '重铸石', 999);
  await C('Market.refresh()');
  await S(50);
  const highBefore = C('Market.getRealItemListings().length');
  const highResult = await C('MarketBot.tryBuyOnce()');
  assert(highResult.bought === false, '高于参考价的挂单 → 流浪商人不购买');
  assert(C('Market.getRealItemListings().length') === highBefore, '高价挂单仍保留');

  // --- 4. 带税的购买（每满8收1）：上架 10 重铸石 → 卖家实收 9 ---
  await C('itemListTable.length = 0');
  await C('itemsTable.length = 0');
  await mkB('玄铁剑', 'blue', '重铸石', 10);
  await C('Market.refresh()');
  await S(50);
  const b4 = matQ('user-b')('重铸石');
  const r4 = await C('MarketBot.tryBuyOnce()');
  assert(r4.bought === true && r4.itemName === '玄铁剑', `假买家再买 1 件（${r4.itemName}）`);
  assert(matQ('user-b')('重铸石') === b4 + 9, `卖家实收 9 重铸石（标价10-税1，${b4} → ${matQ('user-b')('重铸石')}）`);
  const sellRec = ctx.tradeTable.find(x => x.item_name === '玄铁剑' && x.role === 'sell');
  assert(sellRec && sellRec.tax_qty === 1 && sellRec.net_qty === 9, '交易记录：玄铁剑 sell 税1 实收9');

  // --- 5. 无玩家挂单 → 不购买（不发 RPC） ---
  await C('itemListTable.length = 0');
  await C('itemsTable.length = 0');
  await C('Market.refresh()');
  await S(50);
  const rpcBefore = C('rpcCalls.filter(n => n === "bot_buy_equip").length');
  const r5 = await C('MarketBot.tryBuyOnce()');
  assert(r5.bought === false, '无玩家挂单 → 不购买');
  assert(C('rpcCalls.filter(n => n === "bot_buy_equip").length') === rpcBefore, '未调用 bot_buy_equip RPC');

  // --- 6. 挂单已被真人买走（RPC notfound）→ 本轮跳过 ---
  await mkB('已售盾', 'white', '重铸石', 3);
  await C('Market.refresh()');
  await S(50);
  await C(`
    (async () => {
      // 模拟别人抢先买走：云端挂单行已非 active，但本地缓存还没刷新
      var lid = Market.getRealItemListings()[0].id;
      var row = itemListTable.find(x => x.id === lid);
      if (row) row.status = 'sold';
    })()
  `);
  await S(30);
  const rpcBefore6 = C('rpcCalls.filter(n => n === "bot_buy_equip").length');
  const r6 = await C('MarketBot.tryBuyOnce()');
  assert(r6.bought === false, '挂单已被真人买走 → 本轮不买');
  assert(C('rpcCalls.filter(n => n === "bot_buy_equip").length') === rpcBefore6 + 1, '确实发起了购买 RPC（被 notfound 拦下）');

  console.log('\nALL BOTBUY TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
