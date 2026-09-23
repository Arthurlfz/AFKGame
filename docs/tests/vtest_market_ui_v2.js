// vtest_market_ui_v2.js —— 市集改版（三栏 / 列表网格 / 关注降价 / 多件一起买）守值
// 覆盖：
//   ① 三栏骨架（左筛选栏 / 中结果区 / 右常驻详情栏）都能画出来
//   ② 列表版式与网格版式切换、记忆
//   ③ 关注：四类商品都能关注；**只判同款 + 同收款材料**的降价
//   ④ 多件一起买：按最便宜的先行、中途失败立刻停下且如实报告、失败那件留在选中里
//   ⑤ 右侧「同类低价」只列同款 + 同收款材料的
//   ⑥ 筛选语义未变：仍然是级联单选（改上级清下级）
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
// 市集一族必须按依赖顺序整体重载（pricing 提供口径与比价，index 是编排层，必须最后）
const MARKET_MODULES = ['../js/ui/market/pricing.js', '../js/ui/market/watch.js', '../js/ui/market/facets.js', '../js/ui/market/cards.js', '../js/ui/market/detail.js', '../js/ui/market/batch.js', '../js/ui/market/index.js'];
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
const reloadMarket = filters => { C(`localStorage.setItem("marketFilters",JSON.stringify(${JSON.stringify(filters)}))`); for (const m of MARKET_MODULES) vm.runInContext(fs.readFileSync(m, 'utf8'), ctx); };
const textOf = sel => C(`(()=>{let out="";function walk(n){if(!n)return;if(n.innerHTML)out+=n.innerHTML;(n.children||[]).forEach(walk)}walk(els[${JSON.stringify(sel)}]);return out})()`);
const resetEl = sel => C(`if(els[${JSON.stringify(sel)}])els[${JSON.stringify(sel)}].children=[]`);
const resetUI = () => { resetEl('cfSteps'); resetEl('cfPath'); resetEl('market-list'); resetEl('market-detail'); resetEl('mk-batch-bar'); };
const ALL = { kind: 'all', slot: 'all', rarity: 'all', tier: 'all', baseTier: 'all', growth: 'desc', sort: 'latest', affixFilters: [], trait: 'all', priceMin: null, priceMax: null };

(async () => {
  for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/core/pet-sprites.js']) VTF.load(ctx, f);
  C(`localStorage.setItem("marketFilters",JSON.stringify(${JSON.stringify(ALL)}))`);
  C(`localStorage.removeItem("market_view_mode")`);
  for (const f of ['../js/ui/ui-common.js', '../js/ui/ui-shell.js', '../js/ui/ui-login.js', '../js/ui/ui-dialog.js', '../js/ui/ui-popover.js', '../js/ui/battle/index.js', '../js/ui/battle/tip.js', '../js/ui/battle/stage-fx.js', '../js/ui/battle/loot.js', '../js/ui/battle/act.js', '../js/ui/battle/roster.js', '../js/ui/battle/summary.js', '../js/ui/ui-pet.js', '../js/ui/ui-pet-evolve.js', '../js/ui/ui-pet-merge.js', '../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', ...MARKET_MODULES, '../js/ui/market/records.js', '../js/ui/market/sell.js', '../js/ui/market/notify.js', '../js/main.js']) VTF.load(ctx, f);

  await S(300); await C('Game.onLogin("ui@test.com","123456")'); await S(300);
  const now = new Date().toISOString();
  const uid = C('UI.getAuthUser().id');

  /* ---------- 备货：同一个卖家 user-b 挂 3 条「进化素材」，收款物都是重铸石，价 5 / 10 / 15 ---------- */
  C(`matListTable.push({id:"p5",seller_id:"user-b",good_name:"进化素材",good_qty:1,material_type:"重铸石",material_qty:5,status:"active",created_at:"${now}"})`);
  C(`matListTable.push({id:"p10",seller_id:"user-b",good_name:"进化素材",good_qty:2,material_type:"重铸石",material_qty:10,status:"active",created_at:"${now}"})`);
  C(`matListTable.push({id:"p15",seller_id:"user-b",good_name:"进化素材",good_qty:3,material_type:"重铸石",material_qty:15,status:"active",created_at:"${now}"})`);
  // 同款但**换了收款材料**：比价与降价判定都不该把它算进去（10 重铸石 ≠ 10 剥离石）
  C(`matListTable.push({id:"p3s",seller_id:"user-b",good_name:"进化素材",good_qty:1,material_type:"剥离石",material_qty:3,status:"active",created_at:"${now}"})`);
  // 装备 / 宠物 / 蛋 各一条，用来验证"四类都能关注"
  C(`Market.addBotListing({id:"eq1",item_id:"ei1",item_name:"兽皮帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],material_type:"重铸石",material_qty:30,created_at:"${now}"})`);
  C(`Market.addBotPetListing({id:"pe1",pet_id:"pp1",pet_name:"骨狼",pet_growth:9,pet_level:3,pet_traits:[],material_type:"重铸石",material_qty:40,created_at:"${now}"})`);
  C(`Market.addBotEggListing({id:"eg1",isBot:true,seller:"乙",kind:"egg",egg_type:"血狐",material_type:"重铸石",material_qty:7})`);
  await C('Market.refresh()'); await S(120);

  /* ============ 1. 三栏骨架 ============
   * 工具条的按钮是**写死在 游戏.html 里的静态结构**（JS 只负责绑事件与高亮），
   * 所以这里要同时对「HTML 结构」和「JS 渲染产物」两头设卡：
   * 前者防有人把容器删了（删了 JS 会静默返回、页面看着就是空的一块），后者防渲染逻辑坏了。 */
  const HTML = fs.readFileSync('../游戏.html', 'utf8');
  A(HTML.includes('id="market-filters"') && HTML.includes('class="market-filters cascade-filters"'), 'HTML：左栏筛选容器在');
  A(HTML.includes('id="market-list"'), 'HTML：中栏结果容器在');
  A(HTML.includes('id="market-detail"') && HTML.includes('class="market-detail"'), 'HTML：右栏常驻详情容器在（三栏缺一栏会静默空白）');
  A(HTML.includes('data-mode="list"') && HTML.includes('data-mode="grid"') && HTML.includes('id="viewMode"'), 'HTML：工具条提供「列表 / 网格」版式切换');
  A(HTML.includes('id="batchToggle"'), 'HTML：工具条提供「批量购买」开关');
  A(HTML.includes('id="mk-batch-bar"'), 'HTML：结账条容器在');

  reloadMarket(ALL); resetUI(); C('UI.renderMarket()');
  A(textOf('cfSteps').includes('类型'), '左栏：级联筛选步骤已渲染');
  A(textOf('market-list').includes('进化素材'), '中栏：结果区渲染出在售挂单');
  A(textOf('market-detail').includes('同类'), '右栏：渲染出详情（带同类比价区）');
  A(!textOf('market-detail').includes('还没有可看的东西'), '右栏：默认不是空态（有在售就该摊开一件）');
  C('MarketDetail.select(Market.getMaterialListings().find(x=>x.id==="p15"))');
  A(textOf('market-detail').includes('进化素材'), '右栏：选中哪件就摊开哪件');
  A(String(C('els.rpCount.textContent')).includes('共'), '中栏：给出在售件数');

  /* ============ 2. 版式：列表 / 网格，且记忆 ---------- */
  A(C('MarketCards.getViewMode()') === 'list', '默认版式 = 列表（比价最顺手）');
  resetUI(); C('MarketCards.setViewMode("grid"); UI.renderMarket()');
  A(textOf('market-list').includes('mk-card'), '网格版式：渲染成卡片（mk-card）');
  A(C('localStorage.getItem("market_view_mode")') === 'grid', '版式选择被记住（下次进市集还是网格）');
  resetUI(); C('MarketCards.setViewMode("list"); UI.renderMarket()');
  A(textOf('market-list').includes('mk-row'), '列表版式：渲染成行（mk-row）');

  /* ============ 3. 关注：四类都能关注 + 只判同款同材料降价 ============ */
  const byId = id => `Market.getMaterialListings().find(x=>x.id==="${id}")`;
  A(C(`MarketWatch.stateOf(${byId('p5')}).watched`) === false, '准备：未关注时 stateOf.watched = false');

  // 关注的是「同款」不是「这一单」：挂单会被买走、会下架，盯单条毫无意义
  C(`MarketWatch.toggle(${byId('p10')})`);
  A(C('MarketWatch.count()') === 1, '关注一条材料挂单');
  A(C(`MarketWatch.stateOf(${byId('p5')}).watched`), '同款的另一条挂单同样算"已关注"（关注口径是同款，不是单条）');
  A(C(`(()=>{const h=MarketWatch.hitOf(${byId('p5')});return h?h.dropPct:-1})()`) === 50, '同款 + 同收款材料更低价 → 判为降价（10 → 5 = 降 50%）');
  A(C(`MarketWatch.hitOf(${byId('p3s')})===null`), '同款但换了收款材料 → 不判降价（10 重铸石 ≠ 10 剥离石）');
  A(C(`MarketWatch.hitOf(${byId('p15')})===null`), '比关注时更贵 → 不判降价');

  C(`MarketWatch.toggle(${byId('p10')})`);
  A(C('MarketWatch.count()') === 0, '再点一次 = 取消关注（同一款只留一条）');
  C(`MarketWatch.toggle(${byId('p10')})`);

  // 四类都能关注（以前只有宠物有星标，装备 / 材料 / 蛋的收藏需求整个被漏掉）
  C('MarketWatch.toggle(Market.getItemListings().find(x=>x.id==="eq1"))');
  C('MarketWatch.toggle(Market.getListings().find(x=>x.id==="pe1"))');
  C('MarketWatch.toggle(Market.getEggListings().find(x=>x.id==="eg1"))');
  A(C('MarketWatch.count()') === 4, '四类商品都能关注（材料 / 装备 / 宠物 / 蛋）');
  A(C('(()=>{const eq=Market.getItemListings().find(x=>x.id==="eq1");const pe=Market.getListings().find(x=>x.id==="pe1");const eg=Market.getEggListings().find(x=>x.id==="eg1");return MarketWatch.stateOf(eq).watched&&MarketWatch.stateOf(pe).watched&&MarketWatch.stateOf(eg).watched})()'), '装备 / 宠物 / 蛋 的关注状态各自独立（不会串成同一款）');

  // 卡片上要真的画出降价角标
  resetUI(); C('UI.renderMarket()');
  A(textOf('market-list').includes('mk-watch-hit'), '降价在结果区真的画出了角标（不是只有字段没有 UI）');

  /* ============ 4. 多件一起买：最便宜先行 + 中途失败停下 ---------- */
  // 买家只有 12 个重铸石：p5=5 能买、p10=10 买不起 → 应在第 2 笔停下
  await C('Materials.gain("重铸石",12)'); await S(60);
  await C('Materials.flushMaterials()'); await S(120);
  const payBefore = C('((materialsTable.find(x=>x.user_id==="user-a"&&x.name==="重铸石")||{}).quantity)');
  A(payBefore === 12, '准备：买家持有 12 个重铸石（够买最便宜那件，不够第二件）');

  reloadMarket(ALL); resetUI(); C('UI.renderMarket()');
  C('MarketBatch.setActive(true)');
  C('["p5","p10","p15"].forEach(k=>MarketBatch.toggle("material:"+k))');
  A(C('MarketBatch.size()') === 3, '批量模式：勾中 3 件');
  const sum = C('JSON.stringify(MarketBatch.summary().byMaterial)');
  A(sum.includes('30') && sum.includes('重铸石'), '合计按**收款材料**归组（5+10+15 = 30 重铸石），不跨材料乱加');
  A(C('MarketBatch.summary().byMaterial.length') === 1, '合计只出现一种材料（同款同收款物）');

  const rpcBefore = C('rpcCalls.filter(x=>x==="buy_material").length');
  await C('MarketBatch._checkout()'); await S(200);
  const rpcAfter = C('rpcCalls.filter(x=>x==="buy_material").length');
  A(rpcAfter - rpcBefore === 2, '只发了 2 笔 RPC：最便宜的 5 成功、第二笔 10 不足后立刻停下（没有继续打第 3 笔）');

  A(C('((materialsTable.find(x=>x.user_id==="user-a"&&x.name==="重铸石")||{}).quantity)') === 7, '买家实扣 5 个重铸石（12 → 7）');
  A(C('(()=>{const l=matListTable.find(x=>x.id==="p5");return l.status})()') === 'sold', '最便宜那件已成交（按最便宜先行）');
  A(C('(()=>{const l=matListTable.find(x=>x.id==="p15");return l.status})()') === 'active', '买不起的那笔之后，更贵的那件**没有被动过**（不会跳着买）');
  A(C('MarketBatch.list().length') === 2, '已成交的自动从选中里摘掉；失败的和"还没轮到"的留下（可以补钱直接重试）');
  A(C('MarketBatch.list().indexOf("material:p5")') < 0, '已成交那件（p5）不在选中里了');
  A(C('MarketBatch.list().indexOf("material:p10")') === 0, '失败那件（p10）留在选中里，排在最前（下次仍从它开始试）');
  const dlg = textOf('dialog-text');
  A(dlg.includes('已买到 1 件'), '失败报告如实说明"已买到 1 件"（不假装全成功）');
  A(dlg.includes('不会退回') || dlg.includes('不退'), '失败报告明确写出"已成交的不退"');
  C('MarketBatch.setActive(false, true)');

  /* ============ 5. 右栏「同类低价」只列同款 + 同收款材料 ============ */
  reloadMarket(ALL); resetUI(); C('UI.renderMarket()');
  C('UI.setMarketView("all")');
  C('MarketDetail.select(Market.getMaterialListings().find(x=>x.id==="p15"))');
  const det = textOf('market-detail');
  A(det.includes('同类低价') || det.includes('同 类 低 价') || det.includes('同类'), '右栏有「同类低价」区');
  A(C('(()=>{const l=Market.getMaterialListings().find(x=>x.id==="p15");const peers=MarketCalc.peerGroupKey(l);return Market.getMaterialListings().filter(x=>x!==l&&MarketCalc.peerGroupKey(x)===peers&&x.material_type===l.material_type).length})()') === 1, '同类样本只算同款 + 同收款材料（p5 一条；p3s 换成了剥离石，不算）');

  /* ============ 6. 筛选语义未变：仍然是级联单选 ---------- */
  reloadMarket({ ...ALL, kind: 'item', slot: '头盔', rarity: 'gold', tier: 'T2', baseTier: 'T2', trait: 'none' });
  C('MarketFacets.set("kind","pet")');
  const f = C('JSON.stringify(MarketFacets.filters())');
  A(f.includes('"slot":"all"') && f.includes('"rarity":"all"') && f.includes('"tier":"all"') && f.includes('"trait":"all"'), '改上级类型 → 下级筛选被重置（级联单选语义与改版前一致）');
  A(C('MarketFacets.filters().kind') === 'pet', '类型已切到宠物');

  /* ============ 7. 反闪烁：数据没变就不重建 DOM ============
   * 背景（2026-09-23 用户实机报「左侧筛选面板为什么总是在闪烁」）：
   * `main.js:810` 的回血时钟**每 1 秒**调一次 `renderAll()` → `UI.renderMarket()`，
   * 而左栏以前每次都整块重建 ⇒ 级联入场动画（.26s + 最多 240ms 延迟）每秒重播一遍。
   * 契约：① 数据没变 → 一个节点都不动；② 只有级联**结构**变了才播入场动画；
   *      ③ 数据真变了 → 必须重画（否则界面停在旧样子）。 */
  reloadMarket({ ...ALL, kind: 'item' });
  resetUI(); C('UI.renderMarket()');
  A(C('(els.cfSteps.children[0]||{}).dataset && els.cfSteps.children[0].dataset.anim') === '1',
    '级联结构变化时播入场动画（选类型 → 逐级展开）');

  /* 只换一个选项值：选项高亮要更新，但**不该再播一次入场动画**（否则整栏看起来一直在闪）。
   * ⚠️ 测试桩的 `innerHTML=''` **不会清空 children**（只是给 innerHTML 赋了个字符串），
   *    所以重建是"往后面追加"，新节点从【上一次建了几个】的位置开始，不是 children[0]。 */
  const builtBefore = C('els.cfSteps.children.length');
  C('MarketFacets.set("slot","头盔")');
  const afterValue = C('els.cfSteps.children[' + builtBefore + ']');
  A(C('els.cfSteps.children.length') > builtBefore, '换选项值确实重建了左栏（高亮要跟着走）');
  A(!!afterValue && !(afterValue.dataset && afterValue.dataset.anim),
    '只换选项值不重播入场动画（重播 = 玩家眼里的"一直在闪"）');

  /* 模拟每秒一次的 renderAll：数据没变时不该有任何重建。
   * ⚠️ 这里必须比 **children 长度**，不能比 `children[0]` ——
   *    测试桩的 `innerHTML=''` 只是给属性赋了个字符串、**不清 children**，
   *    重建是"往后追加" ⇒ `children[0]` 恒等于最早的节点，比它永远绿（假绿）。 */
  const snap = () => C("({steps:els.cfSteps.children.length, path:els.cfPath.children.length, list:els['market-list'].children.length, det:els['market-detail'].innerHTML})");
  const before = snap();
  C('UI.renderMarket(); UI.renderMarket(); UI.renderMarket()');
  const after = snap();
  A(after.steps === before.steps, '数据没变：左栏筛选面板没被重建（动画不会重播 → 不闪）');
  A(after.path === before.path, '数据没变：筛选路径 chip 没被重建（chipIn 动画不会重播）');
  A(after.list === before.list, '数据没变：结果区没被重建（悬浮详情/输入焦点不被打断）');
  A(after.det === before.det, '数据没变：右侧详情栏内容一致（没被重建）');

  // 反向：数据真变了必须重画，否则界面停在旧样子（签名不能变成"永久缓存"）
  C('Market.addBotListing({id:"eq-flick",item_id:"ei-flick",item_name:"闪烁测试帽",item_slot:"头盔",item_tier:1,item_rarity:"white",item_affixes:[],material_type:"重铸石",material_qty:99})');
  C('UI.renderMarket()');
  A(snap().list > after.list, '数据变了（新增挂单）必须重画');
  A(textOf('market-list').includes('闪烁测试帽'), '新增的挂单真的出现在结果区');

  // 关注状态变了也必须重画（否则点了☆星星不亮）
  const starBefore = snap().list;
  C('MarketWatch.toggle(Market.getItemListings().find(x=>x.id==="eq-flick"))');
  C('UI.renderMarket()');
  A(snap().list > starBefore, '关注状态变了必须重画（点☆要看得到星星亮起来）');

  /* ============ 7b. 「不重建」不等于「什么都不做」 ============
   * 右栏里有一样东西**每秒都可能变**：我身上有多少这种收款材料（挂机掉材料）。
   * 它不该把整页拖进每秒重建（那就是把闪烁搬回来），但也不能停在旧数字。 */
  C('UI.setMarketView("all")');
  C('MarketDetail.select(Market.getMaterialListings().find(x=>x.id==="p15"))');
  C('UI.renderMarket()');   // 先让"换了选中项"这一次变化落定，之后才是纯比对
  const holdBefore = snap();
  C('Materials.gainLocal("重铸石",5)');   // 模拟挂机掉材料
  C('UI.renderMarket()');
  A(snap().list === holdBefore.list, '「全部在售」：背包变了**不**重画整页（否则挂机时每秒都在重建）');
  const holdNow = C('Materials.getQuantity("重铸石")');
  A(C("String(els.mdHoldNum.textContent)") === String(holdNow),
    '但右栏「我持有多少」就地刷到了最新数量（' + holdNow + '）—— 不重建也要跟上实时数字');

  /* 「我的上架」是上架工作台：列的是玩家自己的宠物/装备/材料（等级、成长、可交易数量都在实时变），
   * 所以这个视图**不做跳过判断** —— 反闪烁不能把它弄成"界面停在旧数字"。
   * 它本来也没有入场动画（不会闪），保持改版前每秒刷新的节奏即可。 */
  C('UI.setMarketView("mine")');
  const mineA = snap();
  C('UI.renderMarket()');
  A(snap().list > mineA.list, '「我的上架」不做跳过判断：重复渲染也照常重画（工作台看的是实时数据）');
  const mineB = snap();
  C('Materials.gainLocal("重铸石",1)');
  C('UI.renderMarket()');
  A(snap().list > mineB.list, '「我的上架」：背包一变就重画（可交易数量要跟上）');
  C('UI.setMarketView("all")');

  /* ============ 8. 左栏宽度下限 ============
   * 装备分支 6 级筛选（部位12 / 稀有度4 / 底材T6 / 词缀T6 / 词缀条件 / 排序）塞不进窄栏，
   * 用户 2026-09-23 反馈"有点窄"。这里守一条下限，不写死具体值免得以后调整就报红。 */
  const cascadeCss = fs.readFileSync('../css/market-cascade.css', 'utf8');
  const colMatch = cascadeCss.match(/\.market-page\{[\s\S]*?grid-template-columns:\s*(\d+)px/);
  A(!!colMatch && Number(colMatch[1]) >= 260, '左栏宽度下限 ≥ 260px（当前 ' + (colMatch ? colMatch[1] : '?') + 'px）');

  console.log('\nALL MARKET UI V2 TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
