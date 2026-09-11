// vtest_shop.js —— 魔石充值（卡密）+ 商店消费 专项自测
// 覆盖：余额读取 / 卡密兑换（成功·重复·无效）/ 魔石购买并发材料 / 余额不足 / 充值档位不进商店 / 未开通提示
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:''}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],walletsTable:[],productsTable:[],ordersTable:[],redeemTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-shell.js','../js/ui/ui-login.js','../js/ui/ui-dialog.js','../js/ui/ui-popover.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-bag.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/ui/ui-shop.js','../js/main.js'])VTF.load(ctx,f);
let failures=0;const A=(ok,msg)=>{if(ok)console.log('PASS: '+msg);else{console.error('FAIL: '+msg);failures++}};const C=code=>vm.runInContext(code,ctx);const S=ms=>new Promise(r=>setTimeout(r,ms));

/* 商品按【真实服务端现状】摆放，不是按 migrate_shop.sql 的初始数据。
 * ⚠️ 2026-09-12 起商店只卖便利、不卖数值：涅磐兽 / 传说进化素材 / 凝魂晶石 / 宠物蛋 / 打造石礼包
 *    五个 materials 类商品已全部下架（见 migrate_shop_perks.sql），只留 perks 类。
 *    桩数据必须与真实 products 表同步，否则「测试全绿、线上对不上」——这次就是这么漂的。 */
C(`productsTable.push(
  {sku:'gems_60',title:'小袋魔石',kind:'recharge',price_cents:600,price_gems:null,gems:60,bonus_gems:6,payload:{},icon:'🪙',active:true,sort:1},
  {sku:'perk_listing_5',title:'市场挂单额度 +5',kind:'convenience',price_cents:null,price_gems:20,gems:0,bonus_gems:0,payload:{perks:{listing_slots:5}},icon:'🏷',active:true,sort:20,limit_per_user:2},
  {sku:'perk_pricey',title:'贵价便利品（测余额不足）',kind:'convenience',price_cents:null,price_gems:50,gems:0,bonus_gems:0,payload:{perks:{listing_slots:1}},icon:'🧪',active:true,sort:21}
)`);
C(`redeemTable.push({code:'SOUL-TEST-01',sku:'gems_60',max_uses:1,used_count:0,expires_at:null})`);
// 桩里没有 user_perks 表，给个本地兜底（真实环境由 get_my_perks RPC 提供）
C(`Supabase.getMyPerks=async()=>({listing_slots:0})`);

// Config.shop.enabled 已于 2026-09-12 打开（魔石=便利货币）。这里显式再写一次，
// 免得以后有人关掉开关时本测试静默失效。
C('Config.shop.enabled=true');

(async()=>{await S(300);await C('Game.onLogin("shop@test.com","123456")');await S(400);
// 建一只宠物，否则 onAuthenticated 提前返回，走不到商店数据加载
await C('(async()=>{const p=Pet.createPet("血狐","🦊",6,100,20,10,8);Pet.addPet(p);Pet.setActive(p.id);const s=await Supabase.savePet(p);p.cloudId=s.data.id})()');
await C('Game.onLogin("shop@test.com","123456")');await S(400);

A(C('UI.getGems()')===0,'初始余额 0 魔石');
A(C(`els['gem-balance'].innerHTML`).indexOf('0')>=0,'顶栏余额芯片已渲染：'+C(`els['gem-balance'].innerHTML`));
const root=C(`els['shop-root'].innerHTML`);
A(root.indexOf('市场挂单额度 +5')>=0,'商店页渲染出商品（服务端 products 表）');
A(root.indexOf('涅磐兽')<0&&root.indexOf('传说进化素材')<0&&root.indexOf('凝魂晶石')<0,
  '已下架的卖数值商品不再出现在商店（2026-09-12 定调：不卖数值）');
A(root.indexOf('小袋魔石')<0,'充值档位不出现在商店列表（自测阶段不发卡，不直接买）');
A(root.indexOf('自测阶段')>=0,'页头说明自测阶段不对外收费');
A(root.indexOf('收款码')<0&&root.indexOf('转账')<0&&root.indexOf('支付宝')<0,'界面不含任何收款码/转账引导（用户 2026-08-31 明令去掉）');
A(root.indexOf('魔石商店尚未开通')<0,'表存在时不显示「未开通」提示');

/* ---- 卡密兑换 ---- */
let r=await C(`Supabase.redeemCode('SOUL-TEST-01')`);
A(r.ok&&r.gained===66,'卡密兑换到账 60+6=66 魔石（实得 '+r.gained+'）');
await C('UI.refreshShop()');await S(120);
A(C('UI.getGems()')===66,'余额已刷新为 66');
r=await C(`Supabase.redeemCode('SOUL-TEST-01')`);
A(!r.ok&&r.code==='used','同一张卡密第二次兑换 → used（防重复到账）');
A(C('UI.getGems()')===66,'重复兑换不重复加币（仍 66）');
r=await C(`Supabase.redeemCode('NOT-EXIST')`);
A(!r.ok&&r.code==='notfound','无效卡密 → notfound');

/* ---- 魔石购买（perks 类：权益不进战斗数值） ---- */
r=await C(`Supabase.spendGems('perk_listing_5','ref-1')`);
A(r.ok,'魔石购买成功');
await C('UI.refreshShop()');await S(120);
A(C('UI.getGems()')===46,'购买后余额 66-20=46（实 '+C('UI.getGems()')+'）');
r=await C(`Supabase.spendGems('perk_listing_5','ref-1')`);
A(r.ok&&C('UI.getGems()')===46,'幂等键相同重复提交不再扣币（仍 46）');

/* ---- 限购必须「点之前就可见」 ----
 * 2026-09-12 事故：fetchProducts 的 select 漏了 limit_per_user，前端对限购一无所知，
 * 玩家只能点了才被服务端弹「已达购买上限」。这里守住「卡片上要显示还能买几次」。 */
let g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('限购 2 次')>=0,'卡片显示限购次数（限购 2 次）');
A(g.indexOf('已买 1')>=0,'卡片显示已买 1 次');
A(g.indexOf('已达上限')<0,'未买满时不显示「已达上限」，按钮可点');

r=await C(`Supabase.spendGems('perk_listing_5','ref-2')`);
A(r.ok,'限购品第二次购买成功（限购 2）');
await C('UI.refreshShop()');await S(120);
g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('已买 2')>=0,'买满后显示已买 2 次');
A(g.indexOf('已达上限')>=0,'买满后按钮显示「已达上限」并置灰');
r=await C(`Supabase.spendGems('perk_listing_5','ref-9')`);
A(!r.ok&&r.code==='limit','超出限购 → limit');

/* ---- 余额不足 ---- */
A(C('UI.getGems()')===26,'买两次后余额 66-40=26（实 '+C('UI.getGems()')+'）');
r=await C(`Supabase.spendGems('perk_pricey','ref-5')`);
A(!r.ok&&r.code==='insufficient','余额不足 → insufficient（26 < 50）');
A(C('UI.getGems()')===26,'扣款失败的订单不扣币（仍 26）');

/* ---- 表/函数缺失时不崩，给「未开通」提示 ---- */
C('Supabase.getMyWallet=async()=>({gems:0,totalRecharged:0,missing:true})');
await C('UI.refreshShop()');await S(120);
A(C(`els['shop-root'].innerHTML`).indexOf('魔石商店尚未开通')>=0,'表缺失时显示「未开通」提示而不是白屏/报错');
A(C(`els['gem-balance'].style.display`)==='none','未开通时顶栏余额芯片隐藏');
/* ============================================================
 * 静态守值：防止「前端显示」与「后端下发」再次脱节
 * ============================================================ */

/* 1. products 的 select 不得漏列 —— 漏列不报错，读回来是 undefined，静默失效 */
const supaSrc=fs.readFileSync('../js/core/supabase.js','utf8');
const selM=supaSrc.match(/from\('products'\)\s*\.\s*select\('([^']+)'\)/);
A(!!selM,'能在 supabase.js 定位 products 的 select（改了写法请同步本断言）');
if(selM){
  const cols=selM[1].split(',').map(s=>s.trim());
  // 前端渲染 / 限购判断要用的列，缺一个就是显示缺失
  for(const need of ['sku','title','kind','price_gems','payload','icon','limit_per_user'])
    A(cols.indexOf(need)>=0,'products select 含 '+need+'（缺了前端读不到，且不会报错）');
}

/* 2. 不许再新增「卖数值」的商品：convenience + payload.materials */
const supaDir='../../supabase'; // 迁移脚本在仓库根，不在 docs 下
const shopSqls=fs.readdirSync(supaDir).filter(f=>/^migrate_shop.*\.sql$/i.test(f));
A(shopSqls.length>0,'找得到商店迁移脚本：'+shopSqls.join(','));
const bad=[];
for(const f of shopSqls){
  fs.readFileSync(supaDir+'/'+f,'utf8').split(/\r?\n/).forEach(line=>{
    if(/'convenience'/.test(line)&&/"materials"\s*:/.test(line)) bad.push(f+' → '+line.trim().slice(0,70));
  });
}
A(bad.length===0,'SQL 中没有新增卖数值商品（convenience+materials）。有则说明违反「不卖数值」定调：'+(bad.join(' | ')||'无'));

console.log(failures?'SHOP TESTS FAILED: '+failures:'ALL SHOP TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
