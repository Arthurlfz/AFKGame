/* ============================================================
 * vtest_security_guard.js —— 云端安全加固的前端收口（2026-09-03）
 * 覆盖（对应 supabase/migrate_security_hardening.sql + Config.security）：
 *  1. market_bot 守卫错误码识别：ERR_BOT_BUY_ANON / _BANNED / _TOO_NEW / _DAILY_CAP，
 *     收到后暂停自动收购（不反复撞云守卫）；非守卫错误不暂停
 *  2. materials：云端 add_material 限流（ERR_RATE_LIMIT）→ 本地不丢、退避重试、
 *     clearAll 时能正常补报
 *  3. 机器人只买别人的挂单；即使绕过前端过滤直接调 RPC，云端也回 'self' 拒收（零刷材料）
 *  4. supabase.loadMyProfile 读取 banned/ban_reason（main.js 登录拦截的数据基础）
 * 运行：node vtest_security_guard.js（须在 tests/ 目录）
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
  materialsTable: [], petEggTable: [], tradeTable: [], profilesTable: [], uidSeq: 0, rpcCalls: [], delCalls: []
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

// 造 user-b 的挂单（AI 可买的目标）
const mkB = async (name, matType, qty) => {
  await C(`
    (async () => {
      var itId = 'it-' + (++uidSeq);
      itemsTable.push({ id: itId, user_id: 'user-b', name: '${name}', slot: '武器' });
      itemListTable.push({
        id: 'el-' + (++uidSeq), item_id: itId, seller_id: 'user-b', status: 'active',
        item_name: '${name}', item_slot: '武器', item_rarity: 'white', item_tier: 2,
        item_affixes: [{ type: 'atk', tier: 3, value: 15 }], item_soul: null,
        material_type: '${matType}', material_qty: ${qty},
        created_at: new Date().toISOString()
      });
    })()
  `);
  await S(30);
};
// 造 alice 自己（user-a）的挂单
const mkOwn = async (name, matType, qty) => {
  await C(`
    (async () => {
      var itId = 'it-' + (++uidSeq);
      itemsTable.push({ id: itId, user_id: 'user-a', name: '${name}', slot: '武器' });
      itemListTable.push({
        id: 'el-' + (++uidSeq), item_id: itId, seller_id: 'user-a', status: 'active',
        item_name: '${name}', item_slot: '武器', item_rarity: 'white', item_tier: 2,
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
  console.log('=== 云端安全加固：前端守卫收口 ===\n');
  C('Supabase.init()');
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'user-a', 'A(alice) 登录（vstub 用户 id=user-a）');

  // ---------- 1. market_bot 守卫错误码 ----------
  assert(C('MarketBot.guardKeyOf("ERR_BOT_BUY_ANON 请先登录")') === 'ERR_BOT_BUY_ANON', '识别 ERR_BOT_BUY_ANON');
  assert(C('MarketBot.guardKeyOf("ERR_BOT_BUY_BANNED 账号已被封禁")') === 'ERR_BOT_BUY_BANNED', '识别 ERR_BOT_BUY_BANNED');
  assert(C('MarketBot.guardKeyOf("ERR_BOT_BUY_TOO_NEW 账号创建未满10分钟")') === 'ERR_BOT_BUY_TOO_NEW', '识别 ERR_BOT_BUY_TOO_NEW');
  assert(C('MarketBot.guardKeyOf("ERR_BOT_BUY_DAILY_CAP 今日已达上限")') === 'ERR_BOT_BUY_DAILY_CAP', '识别 ERR_BOT_BUY_DAILY_CAP');
  assert(C('MarketBot.guardKeyOf("流浪商人未购买成功（self）")') === null, '非守卫错误（self）不触发暂停');
  assert(C('MarketBot.isBuyPaused()') === false, '初始未暂停');

  // 收到 TOO_NEW → 自动暂停收购；恢复后可再次出手
  await mkB('守卫目标剑', '重铸石', 5);
  await C('Market.refresh()');
  await S(50);
  const r1 = await C('MarketBot.tryBuyOnce()');
  assert(r1.bought === true && r1.itemName === '守卫目标剑', '未触守卫前正常购买');
  await C('MarketBot.__test.resetBuyPause()');

  await mkB('守卫目标盾', '重铸石', 5);
  await C('Market.refresh()');
  await S(50);
  await C(`
    (async () => {
      var _realBBE = Supabase.botBuyEquip;
      Supabase.botBuyEquip = async () => ({ data: null, error: { message: 'ERR_BOT_BUY_TOO_NEW 账号创建未满10分钟，暂时无法召唤流浪商人' } });
      globalThis._realBBE = _realBBE;
    })()
  `);
  const r2 = await C('MarketBot.tryBuyOnce()');
  assert(r2.bought === false && String(r2.error || '').indexOf('ERR_BOT_BUY_TOO_NEW') >= 0, '守卫拦截：TOO_NEW 报错透出');
  assert(C('MarketBot.isBuyPaused()') === true, '收到守卫错误后自动暂停自动收购（冷却中不再撞守卫）');
  await C('MarketBot.__test.resetBuyPause()');
  await C('Supabase.botBuyEquip = globalThis._realBBE');
  const r3 = await C('MarketBot.tryBuyOnce()');
  assert(r3.bought === true && r3.itemName === '守卫目标盾', '暂停结束后恢复购买（云端守卫错误被正常消化）');

  // ---------- 2. 绕过前端过滤直接调 RPC 买自己的单 → 云端 'self' 拒收（零刷材料） ----------
  await C('itemListTable.length = 0');
  await C('itemsTable.length = 0');
  await C('Market.refresh()');
  await S(30);
  await mkOwn('我的自购剑', '重铸石', 1); // qty=1 最便宜——若 RPC 不收口就白拿材料
  await C('Market.refresh()');
  await S(50);
  const ownLid = C('Market.getRealItemListings()[0].id');
  const resSelf = await C('Market.buyAsBot("' + ownLid + '")');
  assert(String(resSelf.error || '').indexOf('self') >= 0, `云端对自挂单返回 self（实际：${resSelf.error}）`);
  assert(matQ('user-a')('重铸石') === 0, '自买被拒：alice 没收到材料');
  assert(C('Market.getRealItemListings().some(l => l.id === "' + ownLid + '")'), '自己的挂单仍在市场（没被吞）');

  // 前端过滤才是第一道闸：机器人选目标时根本轮不到自己的单（qty1 最便宜也不买）
  await mkB('别人的普通货', '重铸石', 5);
  await C('Market.refresh()');
  await S(50);
  const r4 = await C('MarketBot.tryBuyOnce()');
  assert(r4.bought === true && r4.itemName === '别人的普通货', '机器人只买别人的单（买了：' + r4.itemName + '）');
  assert(matQ('user-a')('重铸石') === 0, '自己 qty1 的单仍在，alice 材料仍为 0');

  // ---------- 3. materials：云端限流（ERR_RATE_LIMIT）不丢本地，退避重试可补报 ----------
  await C('var _realGc = Supabase.getClient');
  await C(`
    (async () => {
      Supabase.getClient = () => ({ rpc: async () => ({ error: { message: 'ERR_RATE_LIMIT 材料上报过于频繁，请稍后再试' } }) });
    })()
  `);
  const rateCheck = await C('Materials.cloudGain("剥离石", 5)');
  assert(rateCheck.rateLimited === true && !!(rateCheck.error), 'cloudGain 识别 ERR_RATE_LIMIT → rateLimited 标记');
  C('Materials.gain("剥离石", 5)');
  await C('Materials.flushMaterials()'); // 模拟限流期上报
  await S(30);
  assert(C('Materials.getQuantity("剥离石")') === 5, '限流期 flush 失败：本地 5 个没丢（等待退避补传）');
  assert(matQ('user-a')('剥离石') === 0, '限流期云端未记账（0）——没有静默吞掉，也没乱写');
  // 恢复云端后 clearAll 补报成功
  await C('Supabase.getClient = _realGc');
  await C('Materials.clearAll()');
  await S(30);
  assert(matQ('user-a')('剥离石') === 5, '限流解除后补报成功（云端 +5）');
  assert(C('Materials.getQuantity("剥离石")') === 0, '补报完成本地清账');

  // ---------- 4. loadMyProfile 读 banned/ban_reason（main.js 登录拦截的数据基础） ----------
  await C(`
    (async () => {
      profilesTable.length = 0;
      profilesTable.push({ id: 'user-a', nickname: '爱丽丝', banned: true, ban_reason: '测试封禁', created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    })()
  `);
  await C('Supabase.loadMyProfile()');
  assert(C('Supabase.getMyProfile().banned') === true, 'loadMyProfile 读到 banned=true');
  assert(C('Supabase.getMyProfile().ban_reason') === '测试封禁', 'loadMyProfile 读到 ban_reason');

  console.log('\nALL SECURITY GUARD TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
