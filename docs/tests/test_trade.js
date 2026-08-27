/* ============================================================
 * test_trade.js —— 交易系统冒烟测试（headless，不依赖浏览器/真实后端）
 * 用 VM 桩模拟 Supabase（含 buy_pet/buy_equip 的材料支付 + 税 + 记录逻辑，
 * 与 supabase/migrate_material_trade.sql 的 RPC 实现一一对应）
 * 验收场景：
 *  A 挂装备标价 10 强化石 → B 有 10 → 购买 → B 扣 10、A 实收 9（税 1）→ 双方记录正确
 * 运行：node test_trade.js
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return {
  getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) },
  removeItem: k => { delete m[k] }
}; })();
function el() { return {
  textContent: '', innerHTML: '', style: { setProperty() {} }, classList: { add() {}, remove() {} },
  appendChild() {}, append() {}, addEventListener() {}, querySelector: () => el(), remove() {},
  scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', type: 'number'
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
  materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: []
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
const STUB = `function tq(src, pre){const q={filters:Object.assign({},pre||{}),eq(k,v){this.filters[k]=v;return this},order(o){this.orderBy=o;return this},then(r){let out=src.slice().filter(x=>Object.keys(this.filters).every(k=>x[k]===this.filters[k]));r({data:out,error:null})}};return q}
function ins(t,row,src){uidSeq++;const rec=Object.assign({id:t+'-uuid-'+uidSeq},row);src.push(rec);return{data:rec,error:null}}
supabase.createClient=function(){return{
  auth:{getSession:async()=>({data:{session:session}}),getUser:async()=>(session?{data:{user:session.user},error:null}:{data:{user:null},error:null}),signInWithPassword:async({email})=>{session={user:{id:email.split('@')[0],email}};return{data:{session},error:null}},signUp:async()=>({data:{session:null,user:null},error:null}),signOut:async()=>{session=null;return{error:null}}},
  from(t){
    if(t==='materials')return{select:()=>tq(materialsTable,session?{user_id:session.user.id}:{})};
    if(t==='trade_records')return{select:()=>tq(tradeTable,session?{player_id:session.user.id}:{})};
    if(t==='pets'||t==='equip_items'){
      const src=t==='pets'?petsTable:itemsTable;
      return{select:()=>tq(src,session?{user_id:session.user.id}:{}),insert:row=>({select:()=>({single:async()=>ins(t,row,src)})}),
        update:(patch)=>({eq:(col,val)=>({then:async()=>{const row=src.find(x=>x[col]===val);if(row)Object.assign(row,patch);return{data:null,error:null}}})}),
        delete:()=>({eq:(col,val)=>({then:async()=>{const i=src.findIndex(x=>x[col]===val);if(i>=0)src.splice(i,1);return{data:null,error:null}}})})};
    }
    if(t==='pet_listings'||t==='equip_listings'){const src=t==='pet_listings'?listingsTable:itemListTable;return{select:()=>tq(src,{}),insert:row=>({select:()=>({single:async()=>{const r=ins(t,row,src);r.data.status='active';return r}})})}}
    if(t==='pet_egg')return{select:()=>tq(petEggTable,{}),insert:row=>({select:()=>({single:async()=>ins(t,row,petEggTable)})}),update:(patch)=>({eq:(col,val)=>({then:async()=>{const row=petEggTable.find(x=>x[col]===val);if(row)Object.assign(row,patch);return{data:null,error:null}}})})};
    return{select:()=>tq([],{})};
  },
  rpc:async(fn,args)=>{
    rpcCalls.push(fn);
    if(fn==='add_material'){const uid=session?session.user.id:'anon';const row=materialsTable.find(x=>x.user_id===uid&&x.name===args.p_name);if(row)row.quantity+=args.p_amount;else materialsTable.push({id:'mat-'+(++uidSeq),user_id:uid,name:args.p_name,quantity:args.p_amount});return{data:null,error:null}}
    if(fn==='spend_material'){const uid=session?session.user.id:'anon';const row=materialsTable.find(x=>x.user_id===uid&&x.name===args.p_name&&x.quantity>=args.p_amount);if(!row)return{data:false,error:null};row.quantity-=args.p_amount;return{data:true,error:null}}
    // === 模拟 buy_pet / buy_equip（与迁移 SQL 逻辑一致：材料支付 + 每满8收1税 + 双写记录）===
    if(fn==='buy_equip'||fn==='buy_pet'){
      const isPet=fn==='buy_pet';
      const src=isPet?listingsTable:itemListTable;
      const l=src.find(x=>x.id===args.p_listing_id&&x.status==='active');
      if(!l)return{data:'notfound',error:null};
      if(l.seller_id===session.user.id)return{data:'self',error:null};
      const uid=session.user.id;
      const mrow=materialsTable.find(x=>x.user_id===uid&&x.name===l.material_type);
      if(!mrow||mrow.quantity<l.material_qty)return{data:'insufficient',error:null};
      mrow.quantity-=l.material_qty;                                   // 扣买家
      const tax=Math.floor(l.material_qty/8)*1;                        // 每满8收1
      const net=l.material_qty-tax;                                    // 卖家实收
      const srow=materialsTable.find(x=>x.user_id===l.seller_id&&x.name===l.material_type);
      if(srow)srow.quantity+=net;else materialsTable.push({id:'mat-'+(++uidSeq),user_id:l.seller_id,name:l.material_type,quantity:net}); // 加卖家
      l.status='sold';
      const iname=l.item_name||l.pet_name||'?';
      tradeTable.push({id:'tr-'+(++uidSeq),player_id:uid,role:'buy',item_name:iname,material_type:l.material_type,price_qty:l.material_qty,tax_qty:0,net_qty:l.material_qty,created_at:new Date().toISOString()});
      tradeTable.push({id:'tr-'+(++uidSeq),player_id:l.seller_id,role:'sell',item_name:iname,material_type:l.material_type,price_qty:l.material_qty,tax_qty:tax,net_qty:net,created_at:new Date().toISOString()});
      return{data:'ok',error:null};
    }
    if(fn==='cancel_pet_listing'||fn==='cancel_equip_listing'){const src=fn==='cancel_pet_listing'?listingsTable:itemListTable;const l=src.find(x=>x.id===args.p_listing_id&&x.status==='active');if(!l)return{data:false,error:null};l.status='sold';return{data:true,error:null}}
    return{data:null,error:{message:'unknown rpc: '+fn}}
  }
}}`;
vm.runInContext(STUB, ctx);
// 加载模块（与游戏.html 顺序一致，只到 market 为止）
for (const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/market.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };
const matQ = uid => name => {
  const row = ctx.materialsTable.find(x => x.user_id === uid && x.name === name);
  return row ? row.quantity : 0;
};

(async () => {
  await S(50);
  console.log('=== 交易系统冒烟测试 ===\n');
  C('Supabase.init()');

  // --- 1. 卖家 A 登录，上架装备：10 强化石 ---
  await C('Game = { onLogin: async (e,p) => { const r = await Supabase.signIn(e,p); session = r.data.session; } }');
  // 上面那行 Game 只是占位，直接操作：登录 A
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'alice', 'A(alice) 登录');

  await C(`
    (async () => {
      const eq = { cloudId:'eq-1', name:'玄铁剑', slot:'武器', rarity:{id:'blue',label:'蓝装',color:'#6f93b8'}, tier:2, affixes:[{type:'atk',label:'攻击',tier:3,value:15}] };
      const res = await Market.listItem(eq, '强化石', 10);
      if (res.error) throw new Error(res.error);
    })()
  `);
  await S(50);
  assert(ctx.itemListTable.some(l => l.item_name === '玄铁剑' && l.material_type === '强化石' && l.material_qty === 10 && l.status === 'active'),
    'A 上架装备「玄铁剑」，标价 10 强化石');

  // --- 2. 买家 B 登录，刷市场 ---
  await C('Supabase.signIn("bob@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'bob', 'B(bob) 登录');
  await C('Materials.gain("强化石", 10)');
  await S(50);
  assert(matQ('bob')('强化石') === 10, 'B 持有 10 强化石');
  await C('Market.refresh()');
  await S(50);
  assert(C('Market.getItemListings().length') === 1, 'B 看到 1 条装备挂单');

  // --- 3. B 购买（含税校验） ---
  assert(C('Market.calcTax(10)') === 1 && C('Market.calcNet(10)') === 9, 'calcTax: 10 → 税1、实收9');
  assert(C('Market.calcTax(7)') === 0 && C('Market.calcTax(8)') === 1 && C('Market.calcTax(16)') === 2 && C('Market.calcTax(9)') === 1,
    '税边界：7→0、8→1、16→2、9→1（不满8不收）');

  const listingId = C('Market.getItemListings()[0].id');
  await C(`Market.buyItem("${listingId}")`);
  await S(50);
  assert(matQ('bob')('强化石') === 0, 'B 扣 10 强化石（10-10=0）');
  assert(matQ('alice')('强化石') === 9, 'A 实收 9 强化石（10-税1）');
  assert(ctx.itemListTable.find(l => l.id === listingId).status === 'sold', '挂单标记 sold');

  // --- 4. 双方交易记录 ---
  const bobRecs = ctx.tradeTable.filter(r => r.player_id === 'bob');
  const aliceRecs = ctx.tradeTable.filter(r => r.player_id === 'alice');
  assert(bobRecs.length === 1 && bobRecs[0].role === 'buy' && bobRecs[0].item_name === '玄铁剑'
    && bobRecs[0].material_type === '强化石' && bobRecs[0].price_qty === 10 && bobRecs[0].tax_qty === 0 && bobRecs[0].net_qty === 10,
    'B 买入记录：玄铁剑 / 10 强化石 / 税0 / 实付10');
  assert(aliceRecs.length === 1 && aliceRecs[0].role === 'sell' && aliceRecs[0].item_name === '玄铁剑'
    && aliceRecs[0].price_qty === 10 && aliceRecs[0].tax_qty === 1 && aliceRecs[0].net_qty === 9,
    'A 卖出记录：玄铁剑 / 标价10 / 税扣1 / 实收9');

  // --- 5. 材料不足不可购买 ---
  // A 再挂一件 8 强化石的装备
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  await C(`
    (async () => {
      const eq2 = { cloudId:'eq-2', name:'铁盾', slot:'防具', rarity:{id:'white',label:'白装',color:'#c8ccd2'}, tier:4, affixes:[] };
      await Market.listItem(eq2, '强化石', 8);
    })()
  `);
  await S(50);
  await C('Supabase.signIn("bob@test.com","123456")');
  await S(30);
  await C('Materials.gain("强化石", 1)'); // B 只剩 1 个，远不够 8
  await S(30);
  await C('Market.refresh()');
  await S(50);
  const lid2 = C('Market.getItemListings().find(l => l.item_name === "铁盾").id');
  const res = await C(`Market.buyItem("${lid2}")`);
  assert(res && res.error && res.error.includes('材料不足'), `B 只有 1 强化石买 8 强化石的装备 → 拒绝（${res.error}）`);
  assert(matQ('bob')('强化石') === 1, '拒绝后 B 材料不变（仍 1）');
  assert(ctx.itemListTable.find(l => l.id === lid2).status === 'active', '拒绝后挂单仍是 active');

  // --- 6. 不能买自己的单 ---
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  await C('Market.refresh()');
  await S(50);
  const ownRes = await C(`Market.buyItem("${lid2}")`);
  assert(ownRes && ownRes.error && ownRes.error.includes('不能买自己'), `A 不能买自己的单（${ownRes.error}）`);

  // --- 7. 汇总（按 Market.getTradeRecords 计算） ---
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  await C('Market.refresh()');
  await S(50);
  const aliceSells = C('Market.getTradeRecords().filter(r => r.role === "sell").length');
  const aliceBuys = C('Market.getTradeRecords().filter(r => r.role === "buy").length');
  assert(aliceSells === 1 && aliceBuys === 0, 'A 汇总：累计卖出 1 笔、买入 0 笔');
  const netCalc = C(`
    (() => {
      let net = 0;
      Market.getTradeRecords().forEach(r => { net += r.role === 'sell' ? r.net_qty : -r.price_qty; });
      return net;
    })()
  `);
  assert(netCalc === 9, `A 强化石净赚 +9（卖出 9 - 买入 0）`);

  console.log('\n=== 测试结束 ===');
  console.log('A 材料：', JSON.stringify(ctx.materialsTable.filter(x => x.user_id === 'alice')));
  console.log('B 材料：', JSON.stringify(ctx.materialsTable.filter(x => x.user_id === 'bob')));
  console.log('交易记录：', JSON.stringify(ctx.tradeTable, null, 1));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('OUTER', e); process.exit(1); });
