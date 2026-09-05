// vtest_cascade_market.js —— 市集「级联筛选 + 合并视图」集成测试
// 覆盖：① 级联筛选条三类型分支渲染 ② 特质/部位/稀有度过滤 ③ 我的上架并入市集（视图切换 + 三区渲染 + 类型联动）
// ④ #market-sell 路由兼容 ⑤ renderAll 全链路无参调用不抛异常
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' } }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, els: els, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const reloadMarket = filters => { C(`localStorage.setItem("marketFilters",JSON.stringify(${JSON.stringify(filters)}))`); vm.runInContext(fs.readFileSync('../js/ui/ui-market.js', 'utf8'), ctx); };
// 收集某 els 下所有嵌套 innerHTML（stub 的 appendChild 不会自动更新 innerHTML，需要遍历 children）
const textOf = sel => C(`(()=>{let out="";function walk(n){if(!n)return;if(n.innerHTML)out+=n.innerHTML;(n.children||[]).forEach(walk)}walk(els[${JSON.stringify(sel)}]);return out})()`);
const childCount = sel => C(`els[${JSON.stringify(sel)}].children.length`);
// 桩的 innerHTML='' 不清空 children，每次渲染前重置结果区/筛选条，避免跨次累积污染
const resetEl = sel => C(`if(els[${JSON.stringify(sel)}])els[${JSON.stringify(sel)}].children=[]`);
const resetUI = () => { resetEl('cfSteps'); resetEl('cfPath'); resetEl('market-list'); };

(async () => {
  // core 层（不含 UI）
  for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/core/pet-sprites.js']) VTF.load(ctx, f);
  // 预置默认筛选（在 ui-market.js 加载前写入 localStorage）
  C(`localStorage.setItem("marketFilters",JSON.stringify({kind:"all",slot:"all",rarity:"all",tier:"all",baseTier:"all",growth:"desc",sort:"latest",affixFilters:[],trait:"all"}))`);
  // UI 层
  for (const f of ['../js/ui/ui-common.js', '../js/ui/ui-shell.js', '../js/ui/ui-login.js', '../js/ui/ui-dialog.js', '../js/ui/ui-popover.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-market-records.js', '../js/ui/ui-market-sell.js', '../js/main.js']) VTF.load(ctx, f);

  await S(300); await C('Game.onLogin("ui@test.com","123456")'); await S(300);

  const traitId = C('Object.keys(Config.petTraits)[0]'); // 如「嗜血」
  const now = new Date().toISOString();

  // 准备玩家资产（云端建档）
  await C(`(async()=>{const p=Pet.createPet("血狐","🦊",5,85,30,8,110);Pet.addPet(p);Pet.setActive(p.id);p.cloudId=(await Supabase.savePet(p)).data.id;globalThis.__cloudPet=p.cloudId})()`);
  await S(100);
  await C(`(async()=>{const eq={name:"铁剑",slot:"武器",base:{type:"atk",label:"攻击",value:10},affixes:{prefix:[],suffix:[{type:"atk",label:"攻击",value:15,tier:2}]},tier:2,rarity:{id:"blue",label:"蓝装",color:"#4a7fc1"},locked:false};await Items.saveItem(eq);Equipment.replaceInventory([eq]);})()`);
  await S(100);
  await C('Drop.grantEgg("血狐",1)'); await S(50);

  // 假卖家挂单（宠物无特质 + 装备白装头盔）
  C(`(()=>{
    Market.addBotPetListing({id:"botp",pet_id:"bp1",pet_name:"骨狼",pet_growth:9,pet_level:3,pet_traits:[],material_type:"重铸石",material_qty:25,created_at:"${now}"});
    Market.addBotListing({id:"boti",item_id:"bi1",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[{type:"hp",label:"生命",value:8,tier:1}],material_type:"剥离石",material_qty:12,created_at:"${now}"});
  })()`);
  // 我的真实挂单：宠物（带特质）+ 装备（白装头盔）→ 全部在售里应带「我的」标记
  C(`(()=>{
    listingsTable.push({id:"L1",pet_id:globalThis.__cloudPet,seller_id:"user-a",price:null,material_type:"重铸石",material_qty:50,pet_name:"血狐",pet_growth:12,pet_level:5,pet_traits:[{id:"${traitId}",label:"x"}],created_at:"${now}",status:"active"});
    itemListTable.push({id:"L2",item_id:"bi1",seller_id:"user-a",price:null,material_type:"重铸石",material_qty:60,item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],created_at:"${now}",status:"active"});
  })()`);
  await C('Market.refresh()'); await S(100);

  /* ============ 1. 级联筛选条：全部类型 ============ */
  reloadMarket({ kind: 'all', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  let steps = textOf('cfSteps');
  A(steps.includes('类型') && steps.includes('排序'), '全部类型：筛选条含「类型+排序」两级');
  A(steps.includes('cf-branch-hint'), '全部类型：展示逐级展开提示');
  let sec = textOf('market-list');
  A(sec.includes('宠物') && sec.includes('装备'), '全部在售：宠物/装备分区均已渲染');
  A(sec.includes('mk-tag-mine'), '全部在售：我的真实挂单带「我的」标记（合并混排）');

  /* ============ 2. 宠物分支：特质 + 成长排序 ============ */
  reloadMarket({ kind: 'pet', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  let psteps = textOf('cfSteps');
  A(psteps.includes('特质') && psteps.includes('成长排序'), '宠物分支：展开「特质+成长排序」');
  A(!psteps.includes('部位'), '宠物分支：不出现装备部位筛选');
  let psec = textOf('market-list');
  A(psec.includes('宠物') && !psec.includes('装备'), '宠物分支：只渲染宠物分区');

  // 特质过滤：选真实特质 id → 带该特质的血狐保留（骨狼无特质被滤掉）
  reloadMarket({ kind: 'pet', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: traitId });
  resetUI(); C('UI.renderMarket()');
  let t1 = textOf('market-list');
  A(t1.includes('血狐') && !t1.includes('骨狼'), '特质=' + traitId + '：血狐保留、无特质骨狼被过滤');
  // 特质=none → 无特质的骨狼保留、血狐被过滤
  reloadMarket({ kind: 'pet', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'none' });
  resetUI(); C('UI.renderMarket()');
  let t2 = textOf('market-list');
  A(t2.includes('骨狼') && !t2.includes('血狐'), '特质=none：无特质骨狼保留、血狐被过滤');

  /* ============ 3. 装备分支：部位/稀有度/T阶/词缀T阶/词缀条件/排序 ============ */
  reloadMarket({ kind: 'item', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  let isteps = textOf('cfSteps');
  A(isteps.includes('部位') && isteps.includes('稀有度') && isteps.includes('底材T阶') && isteps.includes('词缀T阶') && isteps.includes('词缀条件') && isteps.includes('排序'), '装备分支：完整展开 部位→稀有度→T阶→词缀→排序');
  let isec = textOf('market-list');
  A(isec.includes('装备') && !isec.includes('宠物'), '装备分支：只渲染装备分区');

  reloadMarket({ kind: 'item', slot: '头盔', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  A(childCount('market-list') >= 1, '部位=头盔：兽皮帽保留');
  reloadMarket({ kind: 'item', slot: '武器', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  A(childCount('market-list') === 0 && textOf('market-list').includes('没有符合条件的商品'), '部位=武器：无匹配 → 空态');
  reloadMarket({ kind: 'item', slot: 'all', rarity: 'blue', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.renderMarket()');
  A(childCount('market-list') === 0, '稀有度=蓝装：白装被过滤 → 空态');

  /* ============ 4. 我的上架视图（并入市集） ============ */
  reloadMarket({ kind: 'all', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.setMarketView("mine")');
  A(C('UI.getMarketView()') === 'mine', 'setMarketView(mine) 视图状态正确');
  let msec = textOf('market-list');
  A(msec.includes('宠物上架') && msec.includes('装备上架') && msec.includes('宠物蛋上架'), '我的上架：宠物/装备/蛋三区均渲染（renderSellArea 注入结果区）');
  // 我的上架 + 类型=装备 → 只显示装备区（类型联动）
  reloadMarket({ kind: 'item', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all' });
  resetUI(); C('UI.setMarketView("mine")');
  let msec2 = textOf('market-list');
  A(msec2.includes('装备上架') && !msec2.includes('宠物上架') && !msec2.includes('宠物蛋上架'), '我的上架+类型=装备：仅装备分区');
  C('UI.setMarketView("all")');
  A(C('UI.getMarketView()') === 'all', '切回全部在售视图');

  /* ============ 5. 路由兼容：switchPage("market-sell") → 市集页 + 我的上架视图 ============ */
  C('location.hash="#market-sell"');
  C('UI.switchPage("market-sell")');
  A(C('UI.getMarketView()') === 'mine', '#market-sell 深链 → 市集页 + 我的上架视图');

  /* ============ 6. renderAll 全链路不抛异常 ============ */
  C('UI.renderAll()');
  A(typeof C('els["market-list"]') !== 'undefined', 'renderAll 全链路正常（renderSellArea/renderTradeRecords 无参调用安全短路）');

  console.log('ALL CASCADE MARKET TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
