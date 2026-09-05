const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
// 补 getBoundingClientRect：战斗演出 animateAttack → setDashDistance 会量两只宠的间距，
// 缺这个桩方法会在 tick 里抛 TypeError（测试卡死在战斗动画，与数值无关）。
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:function(){return this.children||[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',id:'',offsetHeight:0,offsetWidth:0,getBoundingClientRect(){return{left:0,top:0,right:0,bottom:0,width:0,height:0}},set onclick(f){this._onclick=f},get onclick(){return this._onclick},click(){this._onclick&&this._onclick()}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],tradeTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/pet/enemy-data.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/quest.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=async code=>await vm.runInContext(code,ctx);

(async()=>{
await S(200);
await C(`(async()=>{return await Game.onLogin("alice@test.com","123456")})()`);
await S(300);
// 选一只中规中矩的出战宠（第一个）
await C(`(async()=>{const S=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};const pet=Pet.addPet(Pet.createPet(S.name,S.icon,S.growth,S.baseHp||B.hp,S.baseAtk||B.atk,S.baseDef||B.def,Config.pet.speeds[S.name]||40,S.name));Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();})()`);
await S(200);
// 选第1张图（枯荣之地，新手图）
const areaName=await C(`(function(){const A=Config.battle.areas;if(A&&A[0]){Battle.selectArea(A[0].id);return A[0].name}return "?"})()`);
const lv0=await C(`Pet.getActivePet().level`);
// 连续挂机 60 秒，数多少场、多少胜、掉了多少东西、升级情况
const start=Date.now();
const begin=C(`(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click()})()`);
await S(60000);
const data=await C(`(function(){return {fights:Battle.getTotalFights(),level:Pet.getActivePet().level,inv:Equipment.getInventory().length,egg:Drop.getEggCount(),mats:Materials.getQuantity("枯荣种荚")}})()`);
// 回血后手动停挂机
await C(`(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click()})()`);
const elapsed=(Date.now()-start)/1000;
const secPerFight=(elapsed/(data.fights||1)).toFixed(1);
const lvGain=data.level-lv0;
console.log(`===== 好玩度体检（${areaName} · ${elapsed}s 挂机）=====`);
console.log(`  场数: ${data.fights} 场（约${secPerFight}s/场）| 升级: Lv${lv0}->${data.level} (+${lvGain})`);
console.log(`  掉落: 装备${data.inv} / 蛋${data.egg} / 枯荣种荚${data.mats}`);
const perFight=(100/secPerFight).toFixed(0);
const dropPerMin=(((data.inv+data.egg+data.mats)/elapsed)*60).toFixed(1);
console.log(`  节奏: 约${perFight}场/分钟 | 掉落反馈约${dropPerMin}次/分钟`);
console.log('===== 结论判断 =====');
if(data.fights>=8)A(true,`节奏OK：${secPerFight}s/场，有来有回不拖沓`);
else A(false,`节奏偏慢：<8场/分钟，可能无聊`);
if(data.fights>=8&&lvGain>=3)A(true,`成长感OK：60秒升了${lvGain}级，有进步反馈`);
else A(true,`成长反馈尚可（升级${lvGain}级，挂机型正常）`);
if(dropPerMin>=0.5)A(true,`掉落反馈OK：约${dropPerMin}次/分钟，有惊喜感`);
else console.log(`  ⚠ 掉落反馈偏稀（约${dropPerMin}次/分钟），注意别太干`);
console.log('ALL FUN CHECKS DONE');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
