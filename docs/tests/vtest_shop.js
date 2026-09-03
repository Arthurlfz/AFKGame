// vtest_shop.js —— 魔石充值（卡密）+ 商店消费 专项自测
// 覆盖：余额读取 / 卡密兑换（成功·重复·无效）/ 魔石购买并发材料 / 余额不足 / 充值档位不进商店 / 未开通提示
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:''}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],walletsTable:[],productsTable:[],ordersTable:[],redeemTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-shell.js','../js/ui/ui-login.js','../js/ui/ui-dialog.js','../js/ui/ui-popover.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-bag.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/ui/ui-shop.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
let failures=0;const A=(ok,msg)=>{if(ok)console.log('PASS: '+msg);else{console.error('FAIL: '+msg);failures++}};const C=code=>vm.runInContext(code,ctx);const S=ms=>new Promise(r=>setTimeout(r,ms));

// 商品与卡密按 migrate_shop.sql 的初始数据摆一份
C(`productsTable.push(
  {sku:'gems_60',title:'小袋魔石',kind:'recharge',price_cents:600,price_gems:null,gems:60,bonus_gems:6,payload:{},icon:'🪙',active:true,sort:1},
  {sku:'mat_phoenix_1',title:'涅磐兽 ×1',kind:'convenience',price_cents:null,price_gems:30,gems:0,bonus_gems:0,payload:{materials:{'涅磐兽':1}},icon:'🐉',active:true,sort:10},
  {sku:'mat_legend_5',title:'传说进化素材 ×5',kind:'convenience',price_cents:null,price_gems:20,gems:0,bonus_gems:0,payload:{materials:{'传说进化素材':5}},icon:'✨',active:true,sort:11},
  {sku:'mat_limit',title:'限购测试品',kind:'convenience',price_cents:null,price_gems:5,gems:0,bonus_gems:0,payload:{materials:{'重铸石':1}},icon:'🎲',active:true,sort:12,limit_per_user:1}
)`);
C(`redeemTable.push({code:'SOUL-TEST-01',sku:'gems_60',max_uses:1,used_count:0,expires_at:null})`);

// 魔石商店当前在 config 里 enabled=false（2026-08-31 用户拍板：正式收款前整条魔石线下线）。
// 本测试验证的是「商店系统开启时」的充值/卡密/购买行为，故显式开启后断言。
C('Config.shop.enabled=true');

(async()=>{await S(300);await C('Game.onLogin("shop@test.com","123456")');await S(400);
// 建一只宠物，否则 onAuthenticated 提前返回，走不到商店数据加载
await C('(async()=>{const p=Pet.createPet("血狐","🦊",6,100,20,10,8);Pet.addPet(p);Pet.setActive(p.id);const s=await Supabase.savePet(p);p.cloudId=s.data.id})()');
await C('Game.onLogin("shop@test.com","123456")');await S(400);

A(C('UI.getGems()')===0,'初始余额 0 魔石');
A(C(`els['gem-balance'].textContent`).indexOf('0')>=0,'顶栏余额芯片已渲染：'+C(`els['gem-balance'].textContent`));
const root=C(`els['shop-root'].innerHTML`);
A(root.indexOf('涅磐兽 ×1')>=0,'商店页渲染出商品（服务端 products 表）');
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

/* ---- 魔石购买 ---- */
const before=C('Materials.getQuantity("传说进化素材")');
r=await C(`Supabase.spendGems('mat_legend_5','ref-1')`);
A(r.ok,'魔石购买成功');
await C('UI.refreshShop()');await S(120);
A(C('UI.getGems()')===46,'购买后余额 66-20=46（实 '+C('UI.getGems()')+'）');
// 材料由服务端直接发到云端，客户端要拉一次才看得到（doBuy 里就是这么做的）
await C(`(async()=>{const {data}=await Supabase.getClient().from('materials').select('name,quantity');Materials.setCloudMaterials(data||[])})()`);
A(C('Materials.getQuantity("传说进化素材")')===before+5,'材料直发背包：传说进化素材 +5（实 '+C('Materials.getQuantity("传说进化素材")')+'）');
r=await C(`Supabase.spendGems('mat_legend_5','ref-1')`);
A(r.ok&&C('UI.getGems()')===46,'幂等键相同重复提交不再扣币（仍 46）');

/* ---- 余额不足 / 限购 ---- */
r=await C(`Supabase.spendGems('mat_phoenix_1','ref-2')`);
await C('UI.refreshShop()');await S(80); // 余额缓存要拉一次才更新（点购买后 UI 里也是这么做的）
A(r.ok&&C('UI.getGems()')===16,'再买涅磐兽：46-30=16（实 '+C('UI.getGems()')+'）');
r=await C(`Supabase.spendGems('mat_legend_5','ref-5')`);
A(!r.ok&&r.code==='insufficient','余额不足 → insufficient（16 < 20）');
A(C('UI.getGems()')===16,'扣款失败的订单不扣币（仍 16）');
r=await C(`Supabase.spendGems('mat_limit','ref-3')`);
A(r.ok,'限购品第一次购买成功');
r=await C(`Supabase.spendGems('mat_limit','ref-4')`);
A(!r.ok&&r.code==='limit','限购品第二次 → limit');

/* ---- 表/函数缺失时不崩，给「未开通」提示 ---- */
C('Supabase.getMyWallet=async()=>({gems:0,totalRecharged:0,missing:true})');
await C('UI.refreshShop()');await S(120);
A(C(`els['shop-root'].innerHTML`).indexOf('魔石商店尚未开通')>=0,'表缺失时显示「未开通」提示而不是白屏/报错');
A(C(`els['gem-balance'].style.display`)==='none','未开通时顶栏余额芯片隐藏');
console.log(failures?'SHOP TESTS FAILED: '+failures:'ALL SHOP TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
