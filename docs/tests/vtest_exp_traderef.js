/* ============================================================
 * vtest_exp_traderef.js —— 宠物经验持久化 + 交易记录补交易对手
 * 覆盖本次两处改动：
 *   1. pets.exp 落云：挂机 → 等级/经验写库 → 刷新后从云端恢复经验条
 *   2. 旧库缺 exp 列时的自动降级（查询/新增/更新都不崩，去掉 exp 重试）
 *   3. trade_records 的 listing_id / counterparty 查询与面板展示
 * 运行：cd docs/tests && node vtest_exp_traderef.js
 * ============================================================ */
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:function(){return this.children||[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',id:'',set onclick(f){this._onclick=f},get onclick(){return this._onclick},click(){this._onclick&&this._onclick()}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],tradeTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);

// —— 注入「旧库没有 exp 列」的模拟器（必须在 supabase.js 加载前包住 createClient）——
vm.runInContext(`
(function(){
  var orig = supabase.createClient;
  supabase.createClient = function(){
    var c = orig();
    var of = c.from;
    c.from = function(t){
      var b = of.call(c, t);
      if (t === 'pets') {
        var oSel = b.select, oIns = b.insert, oUpd = b.update;
        var errRes = { data:null, error:{ code:'42703', message:'column pets.exp does not exist' } };
        b.select = function(cols){
          if (window.simMissingExp && String(cols).split(',').indexOf('exp') >= 0) {
            return { order:function(){ return Promise.resolve(errRes); },
                     eq:function(){ return { maybeSingle:function(){ return Promise.resolve(errRes); } }; },
                     then:function(r){ r(errRes); return Promise.resolve(errRes); } };
          }
          return oSel.call(b, cols);
        };
        b.insert = function(row){
          if (window.simMissingExp && row && ('exp' in row)) {
            return { select:function(){ return { single:async function(){ return errRes; } }; } };
          }
          return oIns.call(b, row);
        };
        b.update = function(patch){
          if (window.simMissingExp && patch && ('exp' in patch)) {
            return { eq:function(){ return { then:function(r){ r(errRes); } }; } };
          }
          return oUpd.call(b, patch);
        };
      }
      return b;
    };
    return c;
  };
})();
`, ctx);

for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/pet/enemy-data.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);

(async()=>{
await S(200);
// —— 登录 + 建档 ——
await C('(async()=>{return await Game.onLogin("exp@test.com","123456")})()');
await S(300);
await C(`(async()=>{
  const S=Config.pet.starters[0];
  const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};
  const pet=Pet.addPet(Pet.createPet(S.name,S.icon,S.growth,S.baseHp||B.hp,S.baseAtk||B.atk,S.baseDef||B.def,Config.pet.speeds[S.name]||40,S.name));
  Pet.setActive(pet.id);
  const u=await Supabase.getCurrentUser();
  if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}
  if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();
})()`);
await S(300);

// —— 经验落云：攒经验 → 同步 → 检查云端行（同步动作与 main.js 升级时的一致）——
const row=C('(function(){const p=Pet.getActivePet();return petsTable.find(r=>r.id===p.cloudId)||null})()');
A(!!row,'宠物已云端建档');
await C('(async()=>{const p=Pet.getActivePet();Pet.grantExp(p,500);await Supabase.updatePet(p.cloudId,{level:p.level,exp:Math.round(p.exp)})})()');
const lv=C('Pet.getActivePet().level');
const row2=C('(function(){const p=Pet.getActivePet();return petsTable.find(r=>r.id===p.cloudId)||null})()');
A(lv>1,`给经验后确实升级了（Lv${lv}）`);
A(row2.level===lv,'升级后等级已写入云端（level 同步）');
A(row2.exp>0,`经验条已写入云端（exp=${row2.exp}，刷新不再清零）`);
A(row2.exp===C('Pet.getActivePet().exp'),'云端 exp 与本地一致（没有多扣/少存）');

// 新建宠物建档时，经验一起写进去
const sp2=await C(`(async()=>{const pet=Pet.createPet('幽影兔','🐰',5,70,24,7,110,'幽影兔');pet.level=2;pet.exp=33;const r=await Supabase.savePet(pet);return {err:r&&r.error?1:0,exp:(petsTable[petsTable.length-1]||{}).exp}})()`);
A(sp2.err===0&&sp2.exp===33,'新宠物建档时经验一起写入云端（exp=33）');

// —— 模拟刷新：改云端行的 level/exp，再从云端恢复 ——
C('(function(){const p=Pet.getActivePet();const r=petsTable.find(x=>x.id===p.cloudId);r.level=7;r.exp=77;Pet.setCloudPets(petsTable);})()');
await S(150);
const p2=C('(function(){const p=Pet.getActivePet();return {level:p.level,exp:p.exp}})()');
A(p2.level===7&&p2.exp===77,'刷新后从云端恢复等级和经验条（Lv7 / exp 77）');

// —— 旧库缺 exp 列：updatePet / loadPets / savePet 都要自动降级 ——
C('window.simMissingExp = true');
const up=await C('(async()=>{const p=Pet.getActivePet();const r=await Supabase.updatePet(p.cloudId,{level:9,exp:999});const row=petsTable.find(x=>x.id===p.cloudId);return {err:r&&r.error?1:0,level:row.level,exp:row.exp}})()');
A(up.err===0,'旧库缺 exp 列：updatePet 自动降级重试，不报错');
A(up.level===9,'旧库缺 exp 列：等级照样写进去（level=9）');
A(up.exp===77,'旧库缺 exp 列：exp 不再硬写（保持原值 77）');

const lp=await C('(async()=>{const r=await Supabase.loadPets();return {err:r&&r.error?1:0,n:(r&&r.data||[]).length}})()');
A(lp.err===0&&lp.n>0,`旧库缺 exp 列：loadPets 自动降级重试，宠物照样读得到（${lp.n} 只）`);

const sp=await C(`(async()=>{const pet=Pet.createPet('血狐','🦊',5,85,30,8,95,'血狐');pet.level=3;pet.exp=42;const r=await Supabase.savePet(pet);return {err:r&&r.error?1:0,id:r&&r.data&&r.data.id,exp:(petsTable[petsTable.length-1]||{}).exp}})()`);
A(sp.err===0&&!!sp.id,'旧库缺 exp 列：savePet 自动降级重试，宠物本体存成功');
A(sp.exp===undefined,'旧库缺 exp 列：新宠物行不含 exp 字段（不硬写）');
C('window.simMissingExp = false');

// —— 交易记录：面板要显示「卖给 / 买自」——
C(`tradeTable.push({id:'tr-1',player_id:'user-a',role:'sell',item_name:'玄铁剑',material_type:'重铸石',price_qty:10,tax_qty:1,net_qty:9,listing_id:'L-1',counterparty:'流浪商人',created_at:new Date().toISOString()})`);
C(`tradeTable.push({id:'tr-2',player_id:'user-a',role:'buy',item_name:'骨刃',material_type:'重铸石',price_qty:4,tax_qty:0,net_qty:4,listing_id:'L-2',counterparty:'b7c1d2e3-1111-2222-3333-444455556666',created_at:new Date().toISOString()})`);
await C('(async()=>{await Market.refresh()})()');
C('UI.renderTradeRecords()');
const sellHtml=C('(function(){const b=document.getElementById("tr-sell-list");return (b.children||[]).map(r=>r.innerHTML).join("|")})()');
const buyHtml=C('(function(){const b=document.getElementById("tr-buy-list");return (b.children||[]).map(r=>r.innerHTML).join("|")})()');
A(sellHtml.indexOf('卖给')>=0&&sellHtml.indexOf('流浪商人')>=0,'卖出记录显示交易对手（卖给 流浪商人）');
A(buyHtml.indexOf('买自')>=0&&buyHtml.indexOf('玩家')>=0,'买入记录显示交易对手（买自 玩家，不暴露 uuid）');
A(buyHtml.indexOf('b7c1')<0,'买入记录不泄漏对方 uuid');

// —— 源码静态项：查询列带新字段 + 主流程确实会同步经验 ——
const src=fs.readFileSync('../js/core/supabase.js','utf8');
A(src.indexOf('listing_id,counterparty')>=0,'交易记录查询已带 listing_id / counterparty');
A(src.indexOf('PET_COLUMNS_LEGACY')>=0,'pets 查询保留缺列降级（PET_COLUMNS_LEGACY）');
const mainSrc=fs.readFileSync('../js/main.js','utf8');
A(mainSrc.indexOf('syncPetProgress(pet, true)')>=0,'升级时立即同步经验（main.js 升级分支）');
A(mainSrc.indexOf('syncPetProgress(pet)')>=0,'未升级走节流同步（main.js 每场结算）');
A((mainSrc.split('flushPetProgress()').length-1)>=3,'停止挂机 / 登出 / 切后台都会补写经验');
const mergeSrc=fs.readFileSync('../js/pet/pet_merge.js','utf8');
A(mergeSrc.indexOf('patch.exp = 0')>=0,'涅槃重置等级时连经验一起清零同步（否则刷新后 Lv1 配旧经验会连升几十级）');

console.log('\nALL EXP + TRADE-REF TESTS PASSED');
})();
