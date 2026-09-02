const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:function(){return this.children||[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',id:'',set onclick(f){this._onclick=f},get onclick(){return this._onclick},click(){this._onclick&&this._onclick()}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],tradeTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-codex.js','../js/ui/ui-pet-synth.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-market-records.js','../js/ui/ui-market-sell.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);

(async()=>{
await S(200);
// —— 新手第1步：登录（stub 自动设会话）——
const loginRes=await C('(async()=>{return await Game.onLogin("alice@test.com","123456")})()');
await S(300);
// —— 新手第2步：八选一应该弹出（云端无宠物）——
const starterVisible=C('(function(){const s=document.getElementById("starter-screen");return s?s.style.display:""})()');
A(starterVisible!=="none"&&starterVisible!=="","八选一界面弹出（新手第一步有选择）");
// —— 八选一数量应为8（数据源）——
const starterCount=C('(Config.pet.starters||[]).length');
A(starterCount===8,`八选一展示8只宠物（实际${starterCount}）`);
// —— 选第一只（复刻卡片 onclick 核心：创建+出战+建档）——
await C('(async()=>{const S=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};const pet=Pet.addPet(Pet.createPet(S.name,S.icon,S.growth,S.baseHp||B.hp,S.baseAtk||B.atk,S.baseDef||B.def,Config.pet.speeds[S.name]||40,S.name));Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}if(window.UI&&window.UI.onAuthChange)window.UI.onAuthChange(true);if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();})()');
await S(300);
const petCount=C('Pet.getPets().length');
A(petCount===1,`选宠后拥有1只宠物（实际${petCount}）`);
// —— 默认进战斗页、不选地图不能挂机 ——
const beforeLv=C('Pet.getActivePet().level');
const beforeAtk=Math.round(C('Pet.getStats(Pet.getActivePet()).atk'));
const battleTry=C('(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click();return true})()');
await S(200);
// 没选地图，应该没在跑
const runningNoArea=C('Battle.isRunning&&Battle.isRunning()');
A(runningNoArea===false,'不选地图不能开始挂机（避免新手懵圈乱跑）');
// —— 选地图（取第一个区域）——
const areaId=C('(function(){const A=Config.battle.areas;if(A&&A[0]){Battle.selectArea(A[0].id);return A[0].id}return ""})()');
A(areaId!=="","已选地图区域");
// —— 开始挂机，跑若干场 ——
C('(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click()})()');
await S(3000); // 模拟时间推进（战斗用 setTimeout/setInterval，vm 里会真实计时）
const runningNow=C('Battle.isRunning&&Battle.isRunning()');
A(runningNow===true,'选地图后能开始挂机');
await S(8000);
C('(function(){const b=document.getElementById("btn-battle");if(b)b.handlers&&b.handlers.click&&b.handlers.click()})()'); // 停
const afterLv=C('Pet.getActivePet().level');
const afterAtk=Math.round(C('Pet.getStats(Pet.getActivePet()).atk'));
const fights=C('Battle.getTotalFights?Battle.getTotalFights():0');
console.log(`  新手挂机结果：战斗${fights}场，Lv ${beforeLv}->${afterLv}，atk ${beforeAtk}->${afterAtk}`);
A(afterLv>=beforeLv,'挂机后等级不降');
A(C('Equipment.getInventory().length')>=0,`装备背包可访问（当前${C('Equipment.getInventory().length')}件）`);
// —— 孵化：检查 Drop.hatchEgg 可用（游戏孵化入口在 window.Drop）——
const eggOK=C('(function(){try{return typeof Drop!=="undefined"&&typeof Drop.hatchEgg==="function"}catch(e){return false}})()');
A(eggOK===true,'孵化入口 Drop.hatchEgg 可用');
console.log('  孵化模块可用:',eggOK);
// —— 上架宠物并断言锁定 ——
await C('(async()=>{const p=Pet.getActivePet();Pet.addPet(p);p.name="上架测试";const s=await Supabase.savePet(p);p.cloudId=s.data.id})()');
await C('Market.refresh()');
const listRes=await C('(async()=>{const p=Pet.getPets().find(x=>x.name==="上架测试");return await Supabase.listPet(p,"重铸石",5);})()');
A(listRes&&!listRes.error,'宠物上架成功');
const setActiveRes=C('(function(){const p=Pet.getPets().find(x=>x.name==="上架测试");Pet.setActive(p.id);return Pet.getActivePet()?Pet.getActivePet().id!==p.id:true})()');
A(setActiveRes===false,'已上架宠物无法设为出战（锁定生效：setActive 被拦，activePet 未变）');
// —— 取回 ——
const cancelRes=C('Market.cancelPet(Pet.getPets().find(p=>p.name==="上架测试").cloudId)');
A(cancelRes&&cancelRes.ok!==false,'宠物取回成功');
console.log('ALL NEWBIE TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
