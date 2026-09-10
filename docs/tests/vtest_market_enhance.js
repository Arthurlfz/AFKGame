// vtest_market_enhance.js —— 交易行补强测试（2026-09-10）
// 覆盖：① 类型筛选支持材料/宠物蛋 ② 价格区间筛选 ③ 关键词可搜词缀/特质
//      ④ 参考价比价标签（低于市价 / 捡漏） ⑤ 分页「显示更多」
//      ⑥ 挂单额度 Config.trade.maxListings 真正生效（listQuota）
//      ⑦ 离线成交汇总通知（ui-market-notify）
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' } }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, els: els, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], matListTable: [], materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const reloadMarket = filters => { C(`localStorage.setItem("marketFilters",JSON.stringify(${JSON.stringify(filters)}))`); vm.runInContext(fs.readFileSync('../js/ui/ui-market.js', 'utf8'), ctx); };
const textOf = sel => C(`(()=>{let out="";function walk(n){if(!n)return;if(n.innerHTML)out+=n.innerHTML;(n.children||[]).forEach(walk)}walk(els[${JSON.stringify(sel)}]);return out})()`);
const resetEl = sel => C(`if(els[${JSON.stringify(sel)}])els[${JSON.stringify(sel)}].children=[]`);
const resetUI = () => { resetEl('cfSteps'); resetEl('cfPath'); resetEl('market-list'); };

(async () => {
  for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/core/pet-sprites.js']) VTF.load(ctx, f);
  C(`localStorage.setItem("marketFilters",JSON.stringify({kind:"all",slot:"all",rarity:"all",tier:"all",baseTier:"all",growth:"desc",sort:"latest",affixFilters:[],trait:"all",priceMin:null,priceMax:null}))`);
  for (const f of ['../js/ui/ui-common.js', '../js/ui/ui-shell.js', '../js/ui/ui-login.js', '../js/ui/ui-dialog.js', '../js/ui/ui-popover.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js', '../js/ui/ui-pet-evolve.js', '../js/ui/ui-pet-merge.js', '../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-market-records.js', '../js/ui/ui-market-sell.js', '../js/ui/ui-market-notify.js', '../js/main.js']) VTF.load(ctx, f);

  await S(300); await C('Game.onLogin("ui@test.com","123456")'); await S(300);
  const now = new Date().toISOString();
  const uid = C('UI.getAuthUser().id');

  // 玩家自己的资产（「我的上架」区要有东西可挂，否则空态与被过滤无法区分）
  await C('(async()=>{const p=Pet.createPet("血狐","🦊",5,85,30,8,110);Pet.addPet(p);Pet.setActive(p.id);p.cloudId=(await Supabase.savePet(p)).data.id})()');
  await S(100);
  await C('(async()=>{const eq={name:"铁剑",slot:"武器",base:{type:"atk",label:"攻击",value:10},affixes:{prefix:[],suffix:[]},tier:2,rarity:{id:"white",label:"白装",color:"#d8d8d8"},locked:false};await Items.saveItem(eq);Equipment.replaceInventory([eq]);})()');
  await S(100);

  /* ---------- 假卖家挂单：材料 / 蛋 / 装备（同部位同稀有度同收款物，才能算参考价） ---------- */
  C(`(()=>{
    // 同组装备 4 件（头盔·白装·重铸石）：标价 10 / 20 / 30 / 8 → 中位 20，最低那件应标「低于市价」
    Market.addBotListing({id:"e1",item_id:"x1",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[{type:"atk",label:"攻击",value:5,tier:1}],material_type:"重铸石",material_qty:10,created_at:"${now}"});
    Market.addBotListing({id:"e2",item_id:"x2",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],material_type:"重铸石",material_qty:20,created_at:"${now}"});
    Market.addBotListing({id:"e3",item_id:"x3",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],material_type:"重铸石",material_qty:30,created_at:"${now}"});
    Market.addBotListing({id:"e4",item_id:"x4",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],material_type:"重铸石",material_qty:8,created_at:"${now}"});
    // AI 挂漏标记（isLeak）：UI 必须渲染成「💎 捡漏」
    Market.addBotListing({id:"e5",item_id:"x5",item_name:"漏价剑",item_slot:"武器",item_tier:2,item_rarity:"blue",item_affixes:[],material_type:"重铸石",material_qty:4,created_at:"${now}",isLeak:true});
    // 材料挂单 15 件（超 pageSize=12 → 必出「显示更多」）
    for(let i=1;i<=15;i++) Market.addBotMaterialListing({id:"m"+i,isBot:true,seller:"甲",kind:"material",good_id:"evolution",good_name:"进化素材",good_qty:1,good_icon:"🧬",material_type:"重铸石",material_qty:i});
    // 蛋挂单
    Market.addBotEggListing({id:"g1",isBot:true,seller:"乙",kind:"egg",egg_type:"血狐",egg_icon:"🥚",material_type:"重铸石",material_qty:3});
  })()`);

  /* ============ 1. 类型筛选：材料 / 宠物蛋可单独筛 ============ */
  reloadMarket({ kind: 'material', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  let sec = textOf('market-list');
  A(sec.includes('进化素材'), '类型=材料：材料分区渲染');
  A(!sec.includes('兽皮帽'), '类型=材料：装备被筛掉');
  A(!sec.includes('pet_id') && !sec.includes('血狐'), '类型=材料：蛋被筛掉');

  reloadMarket({ kind: 'egg', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  sec = textOf('market-list');
  A(sec.includes('🥚 宠物蛋'), '类型=宠物蛋：蛋分区渲染');
  A(!sec.includes('进化素材'), '类型=宠物蛋：材料被筛掉');
  let kinds = textOf('cfSteps');
  A(kinds.includes('材料') && kinds.includes('宠物蛋'), '筛选条类型选项已含「材料」「宠物蛋」');

  /* ============ 2. 价格区间 ============ */
  reloadMarket({ kind: 'all', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: 9, priceMax: 25 });
  resetUI(); C('UI.renderMarket()');
  sec = textOf('market-list');
  A(sec.includes('兽皮帽'), '价格区间 9~25：区间内挂单保留');
  A(!sec.includes('漏价剑'), '价格区间 9~25：低于下限的挂单被筛掉');
  A(textOf('cfPath').includes('价格'), '筛选路径显示价格 chip');

  /* ============ 3. 关键词可搜词缀 ============ */
  reloadMarket({ kind: 'all', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', keyword: '攻击', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  sec = textOf('market-list');
  A(sec.includes('兽皮帽'), '关键词=攻击：命中带「攻击」词缀的装备（老逻辑只搜名字会全空）');

  /* ============ 4. 比价 / 捡漏标签 ============ */
  reloadMarket({ kind: 'item', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  sec = textOf('market-list');
  A(sec.includes('mk-deal--leak') && sec.includes('捡漏'), 'AI 漏价标记渲染成「💎 捡漏」（以前只有字段没有 UI）');
  A(sec.includes('低于市价'), '低于同组中位价的挂单打「低于市价 X%」标签');
  // 同组 4 件 [8,10,20,30] → 中位 = (10+20)/2 = 15（偶数个取中间两值平均）
  const ref = C('JSON.stringify(UI.marketRefPrice("item",{slot:"头盔",rarity:"white"},"重铸石"))');
  A(ref.includes('"median":15') || ref.includes('"median": 15'), '查价接口返回同组中位价（[8,10,20,30] → 15）');
  A(C('UI.marketRefPrice("item",{slot:"武器",rarity:"gold"},"重铸石").median') === null, '样本不足时不给参考价（防单件误导）');

  /* ============ 5. 分页：显示更多 ============ */
  reloadMarket({ kind: 'material', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  sec = textOf('market-list');
  A(sec.includes('显示更多'), '挂单数超过 pageSize 时出现「显示更多」分页按钮');
  A(sec.includes('已显示 12'), '首屏只渲染 pageSize 条（12）');

  /* ============ 6. 上架弹窗：收款物分组覆盖整张白名单 ============ */
  C('UI.openSellForItem({cloudId:"zz0",name:"测试剑",slot:"武器",tier:2,rarity:{id:"white"}})');
  const sellBody = textOf('mk-sell-body');
  A(sellBody.includes('腐印·暴怒') && sellBody.includes('腐印·天罚'), '收款物含 12 个腐印（塔新增，老分组任何一组都不含 → 永远选不到）');
  A(sellBody.includes('精粹进化素材') && sellBody.includes('传说进化素材'), '收款物含精粹 / 传说进化素材（老逻辑硬编码 name，只给「进化素材」1 个）');
  A(sellBody.includes('涅槃丹') && sellBody.includes('鉴定石'), '收款物含涅槃丹 / 鉴定石');
  const payBtns = (sellBody.match(/pay-item/g) || []).length;
  const payExpected = C('(Config.trade.materials||[]).filter(m=>Market.isPaymentMaterial(m.name)).length');
  A(payBtns === payExpected, `收款物按钮数 = 白名单材料数（不重不漏：${payBtns}/${payExpected}）`);
  A(sellBody.includes('要收多少份'), '收款数量文案改为「要收多少份」（旧文案写「上架数量」，语义误导）');

  // kind=material 是「收款物」品类，不是可上架品类 → 我的上架不该被筛成空白
  reloadMarket({ kind: 'material', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  C('UI.setMarketView("mine")');
  resetEl('market-list'); C('UI.renderMarket()');
  const mineTxt = textOf('market-list');
  A(mineTxt.includes('挂单额度'), '「我的上架」在材料筛选下仍渲染额度条');
  A(mineTxt.includes('宠物上架') || mineTxt.includes('装备上架'), '「我的上架」在材料筛选下不空白（材料不是可上架品类，不做过滤）');
  C('UI.setMarketView("all")');

  /* ============ 7. 挂单额度（maxListings 落地） ============ */
  let quota = C('JSON.stringify(Market.listQuota())');
  A(C('Market.listQuota().max') === C('Config.trade.maxListings'), '挂单额度上限读 Config.trade.maxListings');
  for (let i = 1; i <= 5; i++) C(`listingsTable.push({id:"mine${i}",pet_id:"p${i}",seller_id:"${uid}",material_type:"重铸石",material_qty:5,pet_name:"血狐",pet_growth:5,pet_level:9,pet_traits:[],created_at:"${now}",status:"active"})`);
  await C('Market.refresh()'); await S(100);
  A(C('Market.listQuota().used') === 5, '我的挂单数被正确统计（5）');
  A(C('Market.listQuota().ok') === false, '挂满 5 单后 listQuota.ok = false（上架会被拦）');
  // 上架入口拦截：openSellModal 在满额时直接 toast 返回，不建弹窗
  C('UI.openSellForItem({cloudId:"zz1",name:"测试剑",slot:"武器",tier:2,rarity:{id:"white"}})');
  A(!textOf('mk-sell-body').includes('上架定价'), '满额时上架弹窗不会被打开');

  /* ============ 8. 离线成交汇总 ============ */
  ctx.tradeTable.push({ id: 't1', player_id: uid, role: 'sell', item_name: '兽皮帽', material_type: '重铸石', price_qty: 20, tax_qty: 2, net_qty: 18, counterparty: '流浪商人', created_at: now });
  await C('Market.refresh()'); await S(100);
  C(`localStorage.setItem("fos_market_seen_sale_${uid}","2000-01-01T00:00:00.000Z")`);
  C('UI.checkMarketOfflineSales()');
  const dlg = textOf('dialog-text');
  A(dlg.includes('成交了') && dlg.includes('兽皮帽'), '离线成交汇总弹窗列出被买走的挂单');
  A(dlg.includes('净入账'), '离线成交汇总给出净入账（已扣税）');
  C('UI.checkMarketOfflineSales()'); // 第二次：水位已更新，不该重复弹
  const seen = C(`localStorage.getItem("fos_market_seen_sale_${uid}")`);
  A(!!seen && seen.indexOf('2000-01-01') < 0, '读取水位已推进（不会每次上线重复播报同一条成交）');

  /* ============ 9. 万物皆可交易：材料上架 / 购买 / 取回 / AI 收购 ============ */
  await C('Materials.gain("至尊神石",5)'); await S(60);
  await C('Materials.gain("重铸石",50)'); await S(60);
  await C('Materials.flushMaterials()'); await S(150);
  const cloudQ = n => C(`((materialsTable.find(x=>x.user_id==="user-a"&&x.name==="${n}")||{}).quantity)`);
  A(await cloudQ('至尊神石') === 5, '准备：云端持有至尊神石 5 颗（塔产出的高价值道具）');

  // 上架 3 颗至尊神石，标价 20 重铸石
  const lr = await C('Market.listMaterial("至尊神石",3,"重铸石",20)');
  A(!!lr && lr.ok === true, '材料上架成功（list_material RPC）');
  A(await cloudQ('至尊神石') === 2, '上架即原子扣库存（5 → 2）');
  A(C('Market.getMyListedMaterials().length') >= 1, '我的材料挂单已登记');

  await C('Market.refresh()'); await S(120);
  A(C('Market.getRealMaterialListings().length') >= 1, '真实玩家材料挂单进入市场池');
  A(C('Market.getMaterialListings().length') > C('Market.getBotMaterialListings().length'), '市场材料 = AI 假单 + 真实玩家单（以前只有 AI 那一半）');

  reloadMarket({ kind: 'material', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null });
  resetUI(); C('UI.renderMarket()');
  const matSec = textOf('market-list');
  A(matSec.includes('至尊神石'), '市集材料区出现玩家挂的至尊神石');
  A(matSec.includes('mk-tag-mine'), '自己的材料挂单带「我的」标记');
  A(matSec.includes('取回'), '材料卡提供「取回」操作');

  // 模拟他人挂单 → 购买结算（买家扣收款材料 / 卖家收 net / 买家拿货）
  C(`matListTable.push({id:"mkt-buy",seller_id:"user-b",good_name:"天仙玉露",good_qty:2,material_type:"重铸石",material_qty:10,status:"active",created_at:"${now}"})`);
  await C('Market.refresh()'); await S(120);
  const payBefore = await cloudQ('重铸石');
  const bres = await C('Market.buyMaterial("mkt-buy")');
  A(!!bres && bres.ok === true, '购买他人材料挂单成功');
  A(await cloudQ('天仙玉露') === 2, '买家拿到 2 份天仙玉露');
  A(await cloudQ('重铸石') === payBefore - 10, '买家扣 10 重铸石（按标价支付）');
  A(await C('((materialsTable.find(x=>x.user_id==="user-b"&&x.name==="重铸石")||{}).quantity)') === 9, '卖家收到 9 重铸石（标价 10 − 税 1）');
  A(C('Market.getRealMaterialListings().some(l=>l.id==="mkt-buy")') === false, '成交后挂单从市场移除');

  // 取回：材料退回
  const myListId = C('Market.getMyListedMaterials()[0].listingId');
  await C(`Market.cancelMaterial("${myListId}")`); await S(150);
  A(await cloudQ('至尊神石') === 5, '取回后 3 颗至尊神石退回（2 → 5）');

  // AI 收购玩家材料挂单（否则「能卖」只是摆设）
  C(`matListTable.push({id:"mkt-bot",seller_id:"user-c",good_name:"腐印·暴怒",good_qty:1,material_type:"重铸石",material_qty:8,status:"active",created_at:"${now}"})`);
  await C('Market.refresh()'); await S(120);
  const botRes = await C('Market.buyAsBotMaterial("mkt-bot")');
  A(!!botRes && botRes.ok === true, '流浪商人收购玩家材料挂单（bot_buy_material）');
  A(await C('((materialsTable.find(x=>x.user_id==="user-c"&&x.name==="重铸石")||{}).quantity)') === 7, '卖家收到 7 重铸石（标价 8 − 税 1）');

  console.log('\nALL MARKET ENHANCE TESTS PASSED');
})().catch(e => { console.error('EXC', e); process.exit(1); });
