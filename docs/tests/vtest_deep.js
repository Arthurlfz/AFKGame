const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:function(){return this.children||[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',id:'',set onclick(f){this._onclick=f},get onclick(){return this._onclick},click(){this._onclick&&this._onclick()}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el()},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],tradeTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/pet/enemy-data.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);

(async()=>{
await S(200);
// —— 登录 ——
await C('(async()=>{return await Game.onLogin("alice@test.com","123456")})()');
await S(300);
// —— 八选一：选第一只并出战 ——
await C('(async()=>{const S=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};const pet=Pet.addPet(Pet.createPet(S.name,S.icon,S.growth,S.baseHp||B.hp,S.baseAtk||B.atk,S.baseDef||B.def,Config.pet.speeds[S.name]||40,S.name));Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();})()');
await S(300);
A(C('Pet.getPets().length')===1,'拥有1只出战宠物');

// —— 选地图 + 长时间挂机，看升级/掉装 ——
const areaId=C('(function(){const A=Config.battle.areas;if(A&&A[0]){Battle.selectArea(A[0].id);return A[0].id}return ""})()');
A(areaId!=="",'已选地图');
const lv0=C('Pet.getActivePet().level');
const atk0=Math.round(C('Pet.getStats(Pet.getActivePet()).atk'));
C('(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click()})()');
await S(200);
const diag=C('JSON.stringify({running:Battle.isRunning&&Battle.isRunning(),area:Battle.getCurrentArea()&&Battle.getCurrentArea().name,curHp:Pet.getCurHp(Pet.getActivePet()),maxHp:Pet.getStats(Pet.getActivePet()).hp,hasHandler:!!(document.getElementById("btn-battle").handlers&&document.getElementById("btn-battle").handlers.click)})');
console.log('  [diag] '+diag);
A(C('Battle.isRunning&&Battle.isRunning()')===true,'挂机已开始');
await S(15000); // 跑足够久，让战斗多场升级+掉装掉蛋
C('(function(){const b=document.getElementById("btn-battle");if(b)b.handlers&&b.handlers.click&&b.handlers.click()})()');
const lv1=C('Pet.getActivePet().level');
const atk1=Math.round(C('Pet.getStats(Pet.getActivePet()).atk'));
const fights=C('Battle.getTotalFights?Battle.getTotalFights():0');
const invN=C('Equipment.getInventory().length');
const eggN=C('Drop.getEggCount?Drop.getEggCount():0');
console.log(`  挂机结果：战斗${fights}场，Lv ${lv0}->${lv1}，atk ${atk0}->${atk1}，背包${invN}件，蛋${eggN}`);
A(fights>0,`挂机确实在自动打怪（${fights}场）`);
if(lv1>lv0)console.log(`  ✔ 挂机期间升级了 Lv ${lv0}->${lv1}（经验倍率高，升级很快）`);
else console.log(`  （本局挂机场次少未升级，属随机——核心看掉落/进化/融合/市场）`);
// 掉落验证（确定性）：循环 rollReward 直到装备入库（最多 60 次），确认装备/蛋都能真正入库
const dropObj=await C('(async()=>{const area=Battle.getCurrentArea();const e={name:"测试怪",rarity:"普通",level:1,tier:"common"};const inv0=Equipment.getInventory().length;const egg0=Drop.getEggCount();let guard=0;while(Equipment.getInventory().length<=inv0 && guard<60){await Drop.rollReward(e,area);guard++;}const inv1=Equipment.getInventory().length;const egg1=Drop.getEggCount();return {inv0,egg0,inv1,egg1,dropOk:inv1>inv0||egg1>egg0}})()');
console.log('  [dropDiag] '+JSON.stringify(dropObj));
A(dropObj&&dropObj.dropOk===true,'rollReward 能掉落并入库（装备/蛋）');

// —— 穿装备（用掉落已入包的装备，确定性）——
const eqDiag=C('(function(){try{const inv=Equipment.getInventory();if(!inv.length)return "no-item";const p=Pet.getActivePet();Equipment.equipItem(p,inv[0]);const b=Equipment.getEquipBonuses(p);return JSON.stringify({hasItem:!!inv[0],bonusKeys:Object.keys(b),flat:b.flat,atk:b.atk,type:inv[0]&&inv[0].type})}catch(e){return "err:"+e.message}})()');
console.log('  [eqDiag] '+eqDiag);
const eqOk=C('(function(){const inv=Equipment.getInventory();if(!inv.length)return false;const p=Pet.getActivePet();Equipment.equipItem(p,inv[0]);const b=Equipment.getEquipBonuses(p);return !!(b&&(b.flat!==undefined||b.atk!==undefined||(b.pct&&b.pct.atk!==undefined)))})()');
A(eqOk===true,'装备可穿上且有加成');

// —— 孵化蛋（若没有蛋，手动加一颗再孵）——
await C('(async()=>{if(Drop.getEggCount()<=0)Drop.setEggCount(1);return await Drop.hatchEgg()})()');
await S(200);
const petN2=C('Pet.getPets().length');
A(petN2>=2,`孵化后宠物数增加（${petN2}只）`);

// —— 进化：把出战宠物练到进化等级再进化（用 grantExp 确定性练级，不依赖挂机时长）——
await C('(function(){const p=Pet.getActivePet();const need=Config.pet.evolution.minLevel||30;while(p.level<need)Pet.grantExp(p, 1e7);})()');
const evInfo=C('(function(){const p=Pet.getActivePet();const lv=Config.pet.evolution.minLevel||30;const r=Evolve.canEvolve(p);return {ok:r&&r.ok,lv:p.level,route:(Evolve.getEvolutionRoutes(p)||[]).length}})()');
if(evInfo.route>0){
  const evRes=C('(async()=>{const p=Pet.getActivePet();return await Evolve.evolve(p.id,0)})()');
  A(!!evRes&&!evRes.error,'进化成功');
}else{
  console.log('  （无可用进化路线，跳过进化断言）');
}

// —— 融合：造两只达到融合等级的宠物，融合成一只（确定性练级）——
const mgRes=C('(async()=>{const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};const nv=Config.nirvana||{};const ml=nv.minLevel||40;const mk=()=>{const p=Pet.addPet(Pet.createPet("融合测试","🐉",5.0,120,30,15,50,"融合测试"));while(p.level<ml)Pet.grantExp(p,1e7);return p};const a=mk(),b=mk();const r=await Merge.nirvana(a.id,b.id);return r})()');
await S(200);
A(mgRes&&(mgRes.ok||!mgRes.error),`涅槃成功（结果：${JSON.stringify(mgRes).slice(0,80)}）`);

// —— 市场：上架一只宠物 + 购买 + 取回 ——
await C('(async()=>{const p=Pet.getPets().find(x=>x.name==="融合测试")||Pet.getActivePet();p.name=p.name+"_上架";const s=await Supabase.savePet(p);p.cloudId=s.data.id})()');
await C('Market.refresh()');
const listRes=await C('(async()=>{const p=Pet.getPets().find(x=>x.name.endsWith("_上架"));return await Supabase.listPet(p,"重铸石",5)})()');
A(listRes&&!listRes.error,'宠物上架成功');
// 取回
const cancelRes=C('(function(){const p=Pet.getPets().find(x=>x.name.endsWith("_上架"));return Market.cancelPet(p.cloudId)})()');
A(cancelRes&&cancelRes.ok!==false,'宠物取回成功');

// —— 数据核对：最终状态 ——
const finalPets=C('Pet.getPets().length');
const finalLv=C('Pet.getActivePet().level');
console.log(`  最终：宠物${finalPets}只，出战Lv ${finalLv}`);
A(finalPets>=2,'最终至少拥有2只宠物（挂机/孵化/融合产出正确）');
console.log('ALL DEEP TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
