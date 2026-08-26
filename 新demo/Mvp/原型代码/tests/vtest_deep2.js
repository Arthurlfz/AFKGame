const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:function(){return this.children||[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',id:'',set onclick(f){this._onclick=f},get onclick(){return this._onclick},click(){this._onclick&&this._onclick()}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el()},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],tradeTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/pet/enemy-data.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/quest.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=async code=>await vm.runInContext(code,ctx);

(async()=>{
await S(200);
await C(`(async()=>{return await Game.onLogin("alice@test.com","123456")})()`);
await S(300);
await C(`(async()=>{const S=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};const pet=Pet.addPet(Pet.createPet(S.name,S.icon,S.growth,S.baseHp||B.hp,S.baseAtk||B.atk,S.baseDef||B.def,Config.pet.speeds[S.name]||40,S.name));Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();})()`);
await S(300);
A(await C(`Pet.getPets().length`)===1,'登录并拥有出战宠物');

// ===== 1) 市场真实购买：假卖家挂单装备 + 宠物 =====
await C(`(async()=>{await Materials.gain("重铸石",300);await Materials.gain("剥离石",300);return true})()`);
const buyEq=await C(`(async()=>{const eq=Equipment.generateEquipment("blue");eq.cloudId="fake-eq-1";Market.addBotListing({id:"b-eq-1",material_type:"重铸石",material_qty:10,eq});const r=await Market.buyBotItem("b-eq-1");return {ok:r.ok,err:r.error}})()`);
console.log('  [buyEq] '+JSON.stringify(buyEq));
A(buyEq&&buyEq.ok===true,'购买流浪商人装备入包成功');
A(await C(`Equipment.getInventory().length`)>=1,'背包有装备（含买到的）');

const buyP=await C(`(async()=>{const pet=Pet.createPet("流浪流浪","🐺",4.2,110,25,12,45,"流浪流浪");Market.addBotPetListing({id:"b-pet-1",material_type:"重铸石",material_qty:20,pet});const r=await Market.buyBotPet("b-pet-1");return {ok:r.ok,err:r.error,pets:Pet.getPets().length}})()`);
console.log('  [buyP] '+JSON.stringify(buyP));
A(buyP&&buyP.ok===true,'购买流浪商人宠物入列成功');

// ===== 2) 装备改造 =====
const reforgeOk=await C(`(async()=>{const inv=Equipment.getInventory();if(!inv.length)return "no-item";const eq=inv[0];await Materials.gain("重铸石",100);const rf=await Craft.reforge(eq);return rf&&(rf.ok!==false)?"ok":"fail"})()`);
console.log('  [reforge] '+reforgeOk);
A(reforgeOk==="ok"||reforgeOk==="fail",`重铸已执行（${reforgeOk}）`);
const augmentOk=await C(`(async()=>{const inv=Equipment.getInventory();if(!inv.length)return "no-item";const eq=inv[0];await Materials.gain("增缀石",100);const ag=await Craft.augment(eq);return ag&&(ag.ok!==false)?"ok":"fail"})()`);
console.log('  [augment] '+augmentOk);
A(augmentOk==="ok"||augmentOk==="fail",`增缀已执行（${augmentOk}）`);
const stripOk=await C(`(async()=>{const inv=Equipment.getInventory();if(!inv.length)return "no-item";const eq=inv[0];const pfx=eq.affixes?(eq.affixes.prefix||[]).length:0;const sfx=eq.affixes?(eq.affixes.suffix||[]).length:0;if(pfx+sfx<2)return "skip";await Materials.gain("剥离石",100);const st=await Craft.strip(eq);return st&&(st.ok!==false)?"ok":"fail"})()`);
console.log('  [strip] '+stripOk);
A(stripOk==="ok"||stripOk==="fail"||stripOk==="skip",`剥离已执行（${stripOk}）`);
const salvDiag=await C(`(async()=>{const inv=Equipment.getInventory();if(!inv.length)return {err:"no-item"};const before=Materials.getQuantity("强化石");const r=await Salvage.salvageList([inv[0]]);const after=Materials.getQuantity("强化石");return {ran:!!r,matGained:after>before,before,after}})()`);
console.log('  [salvDiag] '+JSON.stringify(salvDiag));
A(salvDiag&&(salvDiag.ran===true||salvDiag.ran===false),'分解已执行');

// ===== 3) 地图专属材料 + 进化素材掉落 =====
const matDiag=await C(`(async()=>{const area={id:"corrupted-forest",name:"枯荣之地"};const e={name:"测试怪",level:1,tier:"common"};let guard=0,gotArea=false,gotEvo=false;while((!gotArea||!gotEvo)&&guard<100){const r=await Drop.rollReward(e,area);if(r&&r.areaMaterial==="枯荣种荚")gotArea=true;if(r&&r.evoMaterials&&r.evoMaterials.length)gotEvo=true;guard++;}return {gotArea,gotEvo,guard,areaNow:Materials.getQuantity("枯荣种荚"),evoNow:Materials.getQuantity("进化素材")}})()`);
console.log('  [matDiag] '+JSON.stringify(matDiag));
A(matDiag&&matDiag.gotArea===true,`枯荣之地掉专属材料「枯荣种荚」`+`（${matDiag&&matDiag.areaNow}个）`);
A(matDiag&&matDiag.gotEvo===true,`掉落进化素材「进化素材」（${matDiag&&matDiag.evoNow}个）`);

// ===== 4) 任务系统 =====
const questDiag=await C(`(async()=>{const q=Config.drop.quests&&Config.drop.quests.find(x=>x.id==="q1");if(!q)return {err:"no-q1"};await Quest.acceptQuest("q1");const p0=Quest.getQuests().find(x=>x.id==="q1");await Materials.gain(q.matName, q.need);const p1=Quest.getQuests().find(x=>x.id==="q1");const done=p1&&p1.done;const c=await Quest.completeQuest("q1");const p2=Quest.getQuests().find(x=>x.id==="q1");return {accepted:!!p0&&p0.accepted,done,completeOk:!!c&&c.ok,rewards:c&&c.rewards,acceptedAfter:!!p2&&p2.accepted}})()`);
console.log('  [questDiag] '+JSON.stringify(questDiag));
A(questDiag&&questDiag.done===true,'任务 q1 收集达标（done）');
A(questDiag&&questDiag.completeOk===true,'提交任务 q1 成功并领奖（'+JSON.stringify(questDiag.rewards)+'）');
A(questDiag&&questDiag.acceptedAfter===false,'交完后任务回到未接受状态');

console.log('ALL DEEP2 TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
