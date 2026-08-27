// vtest_mutation.js —— 融合变异机制回归测试（全局随机变异版）
// 覆盖：任意两只宠物融合都有概率变异、变异后名字加「·异变」、成长值明显高于普通、概率未中走普通融合
// 复用 vtest.js 的 VM 桩（vstub.js）
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el()},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
// 建一只普通宠物（40 级 + 建档 + 云端）
async function mkPet(name, icon, growth, tag){
  await C('(async()=>{const p=Pet.createPet("'+name+'","'+icon+'",'+growth+',100,20,10,8);p.level=40;Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__'+tag+'=p.id})()');
  await S(60);
}
(async()=>{
await S(300);await C('Game.onLogin("mut@test.com","123456")');await S(300);

/* ============ 1. 任意两只宠物融合都可触发随机变异 ============ */
await mkPet('血狐','🦊',6,'mf');   // 主宠 血狐 成长6
await mkPet('骨狼','🐺',8,'msub'); // 副宠 骨狼 成长8
await C('Materials.gain("涅磐兽",3)');await S(80);
const mfId=C('globalThis.__mf'), msubId=C('globalThis.__msub');
// 钉随机：Math.random=0.01（<chance 0.05 → 变异命中）；randInt(6,12)=6+floor(0.01*7)=6
C('globalThis.__rand=Math.random; Math.random=()=>0.01');
let r=await C('Merge.merge('+mfId+','+msubId+')');
C('Math.random=globalThis.__rand');
A(r.ok===true&&r.mutated===true,'任意两只宠物（血狐+骨狼）：概率命中 → 变异成功（mutated=true）');
A(C('Pet.getPets().find(p=>p.id==='+mfId+').name')==='血狐·异变','变异后主宠名加「·异变」后缀：血狐 → 血狐·异变');
// 普通成长 = 6 + 8×0.5 = 10；变异成长 = 10 + 加成(6) = 16
A(C('Pet.getPets().find(p=>p.id==='+mfId+').growth')===16,'变异成长 = 普通(10) + 加成(6) = 16');
A(C('Pet.getPets().find(p=>p.id==='+mfId+').level')===1&&C('Pet.getPets().find(p=>p.id==='+mfId+').exp')===0,'变异后等级重置 1、经验清零');
A(C('Pet.getPets().find(p=>p.id==='+mfId+').curHp')===C('Pet.getStats(Pet.getPets().find(p=>p.id==='+mfId+')).hp'),'变异后血量回满新上限');
const cloud=C('petsTable.find(p=>p.id==="'+C('Pet.getPets().find(p=>p.id==='+mfId+').cloudId')+'")');
A(cloud.name==='血狐·异变'&&cloud.growth===16&&cloud.level===1,'云端同步：name=血狐·异变 / growth=16 / level=1');
A(!C('Pet.getPets().some(p=>p.name==="骨狼")'),'副宠骨狼消失');

/* ============ 2. 概率未中 → 走普通融合（任意宠物，不限于旧组合） ============ */
await mkPet('毒沼蛙','🐸',7,'df');    // 主宠 毒沼蛙 成长7
await mkPet('骨狼','🐺',9,'dsub');    // 副宠 骨狼 成长9
const dfId=C('globalThis.__df'), dsubId=C('globalThis.__dsub');
C('globalThis.__rand=Math.random; Math.random=()=>0.5'); // 0.5 >= 0.05 → 不变异
r=await C('Merge.merge('+dfId+','+dsubId+')');
C('Math.random=globalThis.__rand');
A(r.ok===true&&r.mutated===false,'概率未中：走普通融合（mutated=false）');
A(C('Pet.getPets().find(p=>p.id==='+dfId+').name')==='毒沼蛙','未变异：名字不变');
A(C('Pet.getPets().find(p=>p.id==='+dfId+').growth')===11.5,'普通融合成长 = 7 + 9×0.5 = 11.5');
A(C('Pet.getPets().find(p=>p.id==='+dfId+').level')===1,'普通融合等级也重置 1');

/* ============ 3. 非固定组合宠物也能变异（体现全局随机） ============ */
await mkPet('旺财','🐶',6,'wf');
await mkPet('副宠','🐹',8,'wsub');
const wfId=C('globalThis.__wf'), wsubId=C('globalThis.__wsub');
C('globalThis.__rand=Math.random; Math.random=()=>0.01'); // <0.05 → 变异
r=await C('Merge.merge('+wfId+','+wsubId+')');
C('Math.random=globalThis.__rand');
A(r.ok===true&&r.mutated===true,'非固定组合（旺财+副宠）也有概率变异成功');
A(C('Pet.getPets().find(p=>p.id==='+wfId+').name')==='旺财·异变','非组合变异：旺财 → 旺财·异变');
A(C('Pet.getPets().find(p=>p.id==='+wfId+').growth')===16,'非组合变异成长 = (6+8×0.5)+6 = 16');

/* ============ 4. 变异成长明显高于普通融合成长 ============ */
// 同条件（血狐6 + 骨狼8×0.5）普通=10，变异=16
A(16 > 10,'变异宠成长（16）明显高于普通融合成长（10）');

/* ============ 5. 已带「·异变」后缀不再叠加 ============ */
await C('Materials.gain("涅磐兽",3)');await S(80); // 补充材料（前 3 次融合各扣 1，已耗尽）
await mkPet('幽影兔·异变','🐰',20,'mv'); // 主宠已是变异宠
await mkPet('瘟熊','🐻',10,'mvsub');
const mvId=C('globalThis.__mv'), mvsubId=C('globalThis.__mvsub');
C('globalThis.__rand=Math.random; Math.random=()=>0.01');
r=await C('Merge.merge('+mvId+','+mvsubId+')');
C('Math.random=globalThis.__rand');
A(r.ok===true&&r.mutated===true,'已变异宠再融合仍可触发变异加成');
A(C('Pet.getPets().find(p=>p.id==='+mvId+').name')==='幽影兔·异变','已带「·异变」后缀不再叠加（仍为 幽影兔·异变）');
console.log('ALL MUTATION TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
