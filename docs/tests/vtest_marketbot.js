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
  '../js/core/items.js', '../js/core/materials.js', '../js/pet/enemy-data.js', '../js/core/drop.js',
  '../js/core/market.js', '../js/core/market_bot.js']) {
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
  // gain 现在只改本地并入队（不立即上传），测试要查云端表就得先 flush
  await C('(async()=>{Materials.gain("重铸石", 200);await Materials.flushMaterials()})()');
  await S(50);
  assert(matQ('user-a')('重铸石') === 200, 'A 持有 200 重铸石');

  // --- 2. start() 立即补货：在售假货 ≥ minActive(20)，市场打开不是空的 ---
  await C('MarketBot.start()');
  await S(30);
  const n = C('Market.getBotListings().length');
  assert(n >= 20, `MarketBot.start() 立即补货 → 在售假货 ${n} ≥ 20`);
  assert(C('Market.getItemListings().length') >= 20, 'getItemListings() 合并包含假单（市场不为空）');

  // --- 3. 假单结构合法 ---
  const l0 = C('Market.getBotListings()[0]');
  assert(l0.isBot === true, '假单 isBot=true');
  assert(l0.seller && l0.seller !== '流浪商人', `假单卖家 = persona 昵称（${l0.seller}）`);
  assert(C('MarketBot.getPersonas().some(p => p.nickname === ' + JSON.stringify(l0.seller) + ')'), '卖家昵称来自生成的 persona 列表');
  assert(l0.personaId, '假单带 personaId');
  assert(['white', 'blue', 'gold'].includes(l0.item_rarity), `假单稀有度合法（${l0.item_rarity}）`);
  assert(typeof l0.item_tier === 'number' && l0.item_tier >= 1 && l0.item_tier <= 5, `假单 T 阶合法（T${l0.item_tier}）`);
  assert(Array.isArray(l0.item_affixes) && l0.item_affixes.length >= 1, `假单有词缀（${l0.item_affixes.length} 条）`);
  assert(l0.material_type && l0.material_qty >= 1, `假单标价合法（${l0.material_qty} ${l0.material_type}）`);
  assert(l0.eq && l0.eq.base && l0.eq.affixes, '假单持有完整装备对象（购买入包用）');

  // --- 3b. 20 个 AI persona（2026-09-03 三阶段：替代单一"流浪商人"） ---
  const psCount = C('MarketBot.getPersonas().length');
  assert(psCount === C('Config.marketBot.personas.count'), `AI persona 数量 = 配置（${psCount}）`);
  const nickSet = C('new Set(MarketBot.getPersonas().map(p => p.nickname)).size');
  assert(nickSet === psCount, `昵称不重名（${nickSet}/${psCount}）`);
  const tierDist = C('MarketBot.getPersonas().reduce((a,p)=>(a[p.tier]=(a[p.tier]||0)+1,a),{})');
  assert((tierDist['新手'] || 0) >= 4 && (tierDist['中坚'] || 0) >= 4,
    `等级档分布合理（新手 ${tierDist['新手']||0} / 中坚 ${tierDist['中坚']||0} / 毕业 ${tierDist['毕业']||0}）`);
  const styleDist = C('MarketBot.getPersonas().reduce((a,p)=>(a[p.playstyle.id]=(a[p.playstyle.id]||0)+1,a),{})');
  assert((styleDist['dps'] || 0) >= 6 && (styleDist['tank'] || 0) >= 2 && (styleDist['speed'] || 0) >= 1,
    `流派分布合理（dps ${styleDist['dps']||0} / tank ${styleDist['tank']||0} / speed ${styleDist['speed']||0}）`);
  // 流派口味：dps persona 对 atk 词缀装备的溢价 > 对 hp 词缀装备（需求结构的基础）
  const dpsAff = C('MarketBot.__test.gearAffinity([{type:"atk",tier:1},{type:"crit",tier:1}], MarketBot.getPersonas().find(p=>p.playstyle.id==="dps"))');
  const dpsAffHp = C('MarketBot.__test.gearAffinity([{type:"hp",tier:1}], MarketBot.getPersonas().find(p=>p.playstyle.id==="dps"))');
  assert(dpsAff > dpsAffHp, `流派口味：dps 更想要 atk 词缀（atk ${dpsAff.toFixed(2)} > hp ${dpsAffHp.toFixed(2)}）`);

  // --- 4. 定价梯度 + 低价漏（2026-09-03：AI 走真实掉落/图档梯度） ---
  // 4a. 定价梯度：图17 金装 > 图1 金装 > 图1 白装。
  //   Math.random=0.2 → 非漏 + 材料恒首项(重铸石×1) + randInt 偏下限 → 结果确定可断言
  C('var __origRandom = Math.random'); // 先存原始引用（vm 内变量，native 函数不能 toString 还原）
  C('Math.random = () => 0.2');
  const pWhite1 = C('MarketBot.__test.rollPrice("white", 1)');
  const pGold1 = C('MarketBot.__test.rollPrice("gold", 1)');
  const pGold17 = C('MarketBot.__test.rollPrice("gold", 17)');
  C('Math.random = () => 0');          // 4b. 低价漏：leakChance 恒真 + 材料首项(重铸石) → 漏价 = floor(档下限×0.5)
  const leakProbe = C('MarketBot.__test.rollPrice("white", 1)');
  C('Math.random = __origRandom');     // 还原
  // 图1白 base=1→1 个；图1金 base=4→约3 个；图17金 base=1.5^16×4≈3941→约3153+ 个
  assert(pWhite1.material_qty < pGold1.material_qty, `图1金装贵于图1白装（白 ${pWhite1.material_qty} < 金 ${pGold1.material_qty}）`);
  assert(pGold1.material_qty < pGold17.material_qty, `图17金装远贵于图1金装（T1 ${pGold1.material_qty} < T17 ${pGold17.material_qty}）`);
  // white 图1：base=1 → lo=hi=1 → 漏价=floor(1×0.5)=1
  assert(leakProbe.isLeak === true && leakProbe.material_type === '重铸石' && leakProbe.material_qty === 1,
    `漏价=档下限×折扣：白装图1 重铸石 1 个（实际 ${leakProbe.material_qty} ${leakProbe.material_type}）`);

  // --- 5. 购买假单：扣材料（云端）+ 装备入包 + 写买家存档 + 假单移除 ---
  // 任取一件在售假单，先给足它标价的材料（新版定价按图档/稀有度，材料种类与数量不定），余额断言才可靠
  const buyT = C('Market.getBotListings()[0]');
  const buyId = buyT.id;
  const needMat = buyT.material_type;
  const needQty = buyT.material_qty;
  await C(`(async()=>{Materials.gain(${JSON.stringify(needMat)}, ${needQty + 500}); await Materials.flushMaterials()})()`);
  await S(50);
  const beforeMat = matQ('user-a')(needMat);
  const r = await C(`Market.buyBotItem("${buyId}")`);
  assert(r.ok === true, '购买假单成功');
  assert(matQ('user-a')(needMat) === beforeMat - needQty, `购买扣 ${needQty} ${needMat}（云端：${beforeMat}→${matQ('user-a')(needMat)}）`);
  assert(C('Equipment.getInventory().length') === 1, '装备已入买家背包');
  assert(C('Equipment.getInventory()[0].cloudId') !== null, '购买装备已写买家存档（cloudId 回写）');
  assert(ctx.itemsTable.some(x => x.user_id === 'user-a' && x.id === C('Equipment.getInventory()[0].cloudId')),
    '云端 equip_items 有买家存档记录');
  assert(!C('Market.getBotListings().some(l => l.id === "' + buyId + '")'), '假单已从市场移除');

  // --- 6. 材料不足 → 拒绝且假单保留 ---
  // 先买掉一部分在售假单，同时验证批量购买（挑重铸石标价 ≤20 的便宜单）
  const cheap = C('Market.getBotListings().filter(l => l.material_type === "重铸石" && l.material_qty <= 20).length');
  for (let i = 0; i < Math.min(cheap, 15); i++) {
    const id = C('Market.getBotListings().find(l => l.material_type === "重铸石" && l.material_qty <= 20).id');
    await C(`Market.buyBotItem("${id}")`);
  }
  await S(30);
  const afterBuy = C('Market.getBotListings().length');
  assert(afterBuy >= 1, `批量购买后假单剩 ${afterBuy} 件`);
  // 材料清零后买任何在售假单都该拒绝：清空该单所需材料（新版标价材料种类不定）
  await C('(async()=>{Materials.gain("重铸石", 1000);await Materials.flushMaterials()})()'); // 先补足，避免干扰下一步补货断言
  await S(50);
  const spendId = C('Market.getBotListings()[0].id');
  const spendMat = C('Market.getBotListings()[0].material_type');
  // 直接清空云端该材料
  const uid = 'user-a';
  const mrow = ctx.materialsTable.find(x => x.user_id === uid && x.name === spendMat);
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

  // --- 8. 补货逻辑：每轮都会补货、不越界（真实掉落有随机波动，验证增量合理而非精确值） ---
  const cur = C('Market.getBotListings().length');
  const exp = Math.max(5, 20 - cur); // 目标增量 = 至少 perTick、缺口大时补足 minActive
  C('MarketBot.tick()'); // 补货
  await S(30);
  const after1 = C('Market.getBotListings().length');
  const added = after1 - cur;
  assert(added >= 1 && added <= exp, `补货：本轮 +${added}（${cur} → ${after1}，目标 +${exp}）`);
  const after2 = C('Market.getBotListings().length');
  const exp2 = Math.max(5, 20 - after2);
  C('MarketBot.tick()'); // 再来一轮
  await S(30);
  const added2 = C('Market.getBotListings().length') - after2;
  assert(added2 >= 1 && added2 <= exp2, `再补一轮：+${added2}（${after2} → ${C('Market.getBotListings().length')}，目标 +${exp2}）`);

  // --- 9. 真实玩家挂单与假单共存 ---
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  await C(`
    (async () => {
      const eq = Equipment.generateEquipment(Config.equipment.rarities.find(x => x.id === "gold"));
      Equipment.addToInventory(eq);
      eq.cloudId = (await Items.saveItem(eq)).data.id;
      await Market.listItem(eq, "重铸石", 8);
    })()
  `);
  await S(50);
  await C('Market.refresh()');
  await S(50);
  const merged = C('Market.getItemListings()');
  const real = merged.filter(l => !l.isBot);
  assert(real.length === 1 && real[0].item_name, '真实玩家挂单仍正常展示（与假单共存）');
  assert(merged.some(l => l.isBot), '假单仍在市场里');

  // --- 10. AI 上架材料 + 宠物蛋（2026-09-03 二阶段） ---
  // 10a. 结构：材料/蛋假单存在且字段合法
  const botMats = C('Market.getBotMaterialListings().length');
  const botEggs = C('Market.getBotEggListings().length');
  assert(botMats >= 1, `AI 有材料挂单（${botMats} 件）`);
  assert(botEggs >= 1, `AI 有宠物蛋挂单（${botEggs} 件）`);
  const m0 = C('Market.getBotMaterialListings()[0]');
  assert(m0.isBot === true && m0.kind === 'material' && m0.good_name && m0.material_type && m0.material_qty >= 1,
    `材料单结构合法（${m0.good_name} ×${m0.good_qty} 换 ${m0.material_qty} ${m0.material_type}）`);
  const e0 = C('Market.getBotEggListings()[0]');
  assert(e0.isBot === true && e0.kind === 'egg' && e0.egg_type && e0.material_qty >= 1, `蛋单结构合法（${e0.egg_type} 蛋）`);
  // 10b. 蛋区合并：getEggListings 包含 AI 假蛋单
  assert(C('Market.getEggListings().some(l => l.isBot)'), '蛋区合并了 AI 假蛋单');
  // 10c. 买材料：先给足收款材料 → 扣款 → 买到材料入包 → 假单移除
  const buyM = C('Market.getBotMaterialListings()[0]');
  await C(`(async()=>{Materials.gain(${JSON.stringify(buyM.material_type)}, ${buyM.material_qty + 100}); await Materials.flushMaterials()})()`);
  await S(50);
  const mBefore = C(`Materials.getQuantity("${buyM.good_name}")`);
  const mSpendBefore = C(`Materials.getQuantity("${buyM.material_type}")`);
  const rm = await C(`Market.buyBotMaterial("${buyM.id}")`);
  assert(rm.ok === true, '购买 AI 材料成功');
  assert(C(`Materials.getQuantity("${buyM.good_name}")`) === mBefore + 1,
    `材料入包 +1（${mBefore} → ${C(`Materials.getQuantity("${buyM.good_name}")`)}）`);
  assert(C(`Materials.getQuantity("${buyM.material_type}")`) === mSpendBefore - buyM.material_qty,
    `扣收款材料 ${buyM.material_qty}`);
  assert(!C(`Market.getBotMaterialListings().some(l => l.id === "${buyM.id}")`), '材料假单已移除');
  // 10d. 买蛋：扣款 → 蛋入包 → 假单移除
  const buyE = C('Market.getBotEggListings()[0]');
  await C(`(async()=>{Materials.gain(${JSON.stringify(buyE.material_type)}, ${buyE.material_qty + 100}); await Materials.flushMaterials()})()`);
  await S(50);
  const eggBefore = C(`Drop.getEggCountOf("${buyE.egg_type}")`);
  const re = await C(`Market.buyBotEgg("${buyE.id}")`);
  assert(re.ok === true, '购买 AI 宠物蛋成功');
  assert(C(`Drop.getEggCountOf("${buyE.egg_type}")`) === eggBefore + 1,
    `蛋入包 +1（${eggBefore} → ${C(`Drop.getEggCountOf("${buyE.egg_type}")`)}）`);
  assert(!C(`Market.getBotEggListings().some(l => l.id === "${buyE.id}")`), '蛋假单已移除');

  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
