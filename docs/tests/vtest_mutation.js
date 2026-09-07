// vtest_mutation.js —— 合成/涅槃机制回归测试（现行语义版）
// 现行规则（config.synthesize / config.nirvana + pet_merge.js）：
//   合成 synthesize：两只 40 级宠 → 概率(mutation.chance=0.5)出一只全新「·异变」宠
//     成长 = 主×0.6 + 副×0.4（+ 变异加成 randInt(1,3)）；两只素材宠消失；消耗合成之石
//   涅槃 nirvana（= Merge.merge 别名）：主宠保留吸副宠成长，不变异、不改名
//     吸收 = 副成长×0.5×(1+(副等级-40)×0.01)；副成长<主×0.5 打 0.2 折；
//     主成长≥60 吸收减半；≥100 不再涨；等级重置 1、进化次数清零、转生+1；消耗涅磐兽
// 复用 vstub.js 的 VM 桩（vstub.js）
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
// 建一只 40 级宠物（建档 + 云端）
async function mkPet(name, icon, growth, tag){
  await C('(async()=>{const p=Pet.createPet("'+name+'","'+icon+'",'+growth+',100,20,10,8);p.level=60;Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__'+tag+'=p.id})()');
  await S(60);
}
(async()=>{
await S(300);await C('Game.onLogin("mut@test.com","123456")');await S(300);

/* ============ 1. 合成：概率命中（0.01 < 0.5）→ 出全新「·异变」宠 ============ */
await mkPet('血狐','🦊',6,'sf');   // 主宠 血狐 成长6
await mkPet('骨狼','🐺',8,'ssub'); // 副宠 骨狼 成长8
await C('Materials.gain("合成之石",5)');await S(80);
const sfId=C('globalThis.__sf'), ssubId=C('globalThis.__ssub');
// 钉随机：0.01 命中变异；randInt(1,3)=1+floor(0.01*3)=1
C('globalThis.__rand=Math.random; Math.random=()=>0.01');
let r=await C('Merge.synthesize('+sfId+','+ssubId+')');
C('Math.random=globalThis.__rand');
A(r&&r.ok===true&&r.mutated===true,'合成：概率命中 → mutated=true');
A(r&&r.baby&&r.baby.name==='血狐·异变','合成变异：新宠名 = 血狐·异变');
// 加法公式（2026-09-06 手册 2.1）：主6 + [副8×0.25×(1+等级加成0.5) + 随机1 = 4] + 变异加成1 = 11
A(r&&r.baby&&r.baby.growth===11,'合成变异成长 = 主6 + 提升4 + 变异1 = 11（加法公式）');
A(r&&r.baby&&r.baby.level===1&&r.baby.exp===0,'合成新宠等级回 1、经验清零');
A(!C('Pet.getPets().some(p=>p.id==='+sfId+')')&&!C('Pet.getPets().some(p=>p.id==='+ssubId+')'),'合成后两只素材宠都消失');
A(C('petsTable.some(p=>p.name==="血狐·异变"&&p.level===1)'),'合成新宠已云端建档');

/* ============ 2. 合成：概率未中（边界 0.5 不小于 0.5）→ 普通新宠 ============ */
await mkPet('幽影兔','🐰',5,'uf');
await mkPet('瘟熊','🐻',5,'usub');
const ufId=C('globalThis.__uf'), usubId=C('globalThis.__usub');
C('globalThis.__rand=Math.random; Math.random=()=>0.5');
r=await C('Merge.synthesize('+ufId+','+usubId+')');
C('Math.random=globalThis.__rand');
A(r&&r.ok===true&&r.mutated===false,'合成：概率未中（0.5）→ mutated=false');
A(r&&r.baby&&r.baby.name==='幽影兔','未变异：新宠继承主宠名（无·异变后缀）');
// 5 + [5×0.25×1.5 + 随机2 = 1.875+2 → 4] = 9
A(r&&r.baby&&r.baby.growth===9,'合成未变异成长 = 主5 + 提升4 = 9（只涨不跌）');

/* ============ 3. 合成：已带「·异变」的主宠不再叠加后缀 ============ */
await mkPet('幽影兔·异变','🐰',20,'vf');
await mkPet('毒沼蛙','🐸',10,'vsub');
const vfId=C('globalThis.__vf'), vsubId=C('globalThis.__vsub');
C('globalThis.__rand=Math.random; Math.random=()=>0.01');
r=await C('Merge.synthesize('+vfId+','+vsubId+')');
C('Math.random=globalThis.__rand');
A(r&&r.ok===true&&r.mutated===true&&r.baby.name==='幽影兔·异变','已带「·异变」后缀不叠加（仍为 幽影兔·异变）');
// 20 + [10×0.25×1.5 + 随机1 = 3.75+1 → 5] + 变异1 = 26
A(r&&r.baby&&r.baby.growth===26,'已异变合成成长 = 20 + 提升5 + 变异1 = 26');

/* ============ 4. 涅槃：主宠吸副宠成长，不变异不改名，突破重置 ============ */
/* 涅槃消耗已道具化（手册 2.4）：不再消耗涅磐兽，只有可选的涅槃丹 */
await C('Materials.gain("涅槃丹",3)');await S(80);
await mkPet('血狐','🦊',6,'nf');
await mkPet('骨狼','🐺',8,'nsub');
await C('(function(){const p=Pet.getPets().find(p=>p.id===globalThis.__nf);p.evolveTimes=5;p.rebornCount=2;p.isGodPet=true;Pet.addPet(p)})()');
const nfId=C('globalThis.__nf'), nsubId=C('globalThis.__nsub');
r=await C('Merge.nirvana('+nfId+','+nsubId+')');
A(r&&r.ok===true,'涅槃：成功');
// 吸收 = 8×0.5×(1+(60-60)×0.01) = 4 → 6+4 = 10（门槛 60 后基准副宠 60 级，无加成）
A(r&&r.newGrowth===10&&C('Pet.getPets().find(p=>p.id==='+nfId+').growth')===10,'涅槃成长 = 6 + 8×0.5 = 10');
A(C('Pet.getPets().find(p=>p.id==='+nfId+').name')==='血狐','涅槃不变异：名字保持「血狐」（无·异变后缀）');
A(r&&r.mutated===undefined,'涅槃结果不再有 mutated 概念（undefined）');
const nmain=C('Pet.getPets().find(p=>p.id==='+nfId+')');
A(nmain.evolveTimes===0,'涅槃后进化次数清零（5 → 0）');
A(nmain.rebornCount===3,'涅槃后转生次数 +1（2 → 3）');
A(nmain.level===1&&nmain.exp===0,'涅槃后等级重置 1、经验清零');
A(!C('Pet.getPets().some(p=>p.id==='+nsubId+')'),'涅槃后副宠消失');

/* ============ 4b. 涅槃道具：消耗涅槃丹 → 吸收 ×1.2 ============ */
await mkPet('血狐','🦊',6,'pf');
await mkPet('骨狼','🐺',8,'psub');
await C('(function(){const p=Pet.getPets().find(p=>p.id===globalThis.__pf);p.isGodPet=true;Pet.addPet(p)})()');
const pillBefore=C('Materials.getQuantity("涅槃丹")');
const pr=await C('Merge.nirvana('+C('globalThis.__pf')+','+C('globalThis.__psub')+',false,true)');
A(pr&&pr.ok===true&&pr.newGrowth===10.8,`涅槃用涅槃丹：吸收 ×1.2（6 + 8×0.5×1.2 = ${pr&&pr.newGrowth}）`);
A(pillBefore-C('Materials.getQuantity("涅槃丹")')===1,'涅槃消耗涅槃丹 ×1');

/* ============ 5. 涅槃：副宠等级加成（练得越高肥料越值钱） ============ */
await mkPet('血狐','🦊',6,'lf');
await mkPet('骨狼','🐺',8,'lsub');
await C('(function(){const q=Pet.getPets().find(p=>p.id===globalThis.__lf);q.isGodPet=true;Pet.addPet(q);const s=Pet.getPets().find(p=>p.id===globalThis.__lsub);s.level=70;Pet.addPet(s)})()');
r=await C('Merge.nirvana('+C('globalThis.__lf')+','+C('globalThis.__lsub')+')');
// 吸收 = 8×0.5×(1+(70-60)×0.01) = 8×0.5×1.1 = 4.4 → 10.4（2026-08-31 门槛 40→60，等级加成从门槛起算）
A(r&&r.ok===true&&r.newGrowth===10.4,'涅槃副宠 Lv70 等级加成：6 + 8×0.5×1.1 = 10.4');

/* ============ 6. 涅槃：副宠成长低 → 不再打折（衰减机制已删，2026-09-06 手册 2.7） ============ */
await mkPet('血狐','🦊',20,'pf');
await mkPet('骨狼','🐺',5,'psub');
await C('(function(){const q=Pet.getPets().find(p=>p.id===globalThis.__pf);q.isGodPet=true;Pet.addPet(q)})()');
r=await C('Merge.nirvana('+C('globalThis.__pf')+','+C('globalThis.__psub')+')');
// 旧规则：副成长 < 主×0.5 打 0.2 折（20.5）；新规则不衰减 → 吸收 = 5×0.5 = 2.5 → 22.5
A(r&&r.ok===true&&r.newGrowth===22.5,'涅槃副宠成长低也不打折（无衰减）：20 + 5×0.5 = 22.5');

/* ============ 7. 涅槃：高成长主宠 → 不再减半（growthCap 已删，2026-09-06） ============ */
await mkPet('血狐','🦊',60,'cf');
await mkPet('骨狼','🐺',40,'csub');
await C('(function(){const q=Pet.getPets().find(p=>p.id===globalThis.__cf);q.isGodPet=true;Pet.addPet(q)})()');
r=await C('Merge.nirvana('+C('globalThis.__cf')+','+C('globalThis.__csub')+')');
// 旧规则：60 分水岭吸收减半（70）；新规则不衰减 → 吸收 = 40×0.5 = 20 → 80
A(r&&r.ok===true&&r.newGrowth===80,'涅槃 60 分水岭不再减半（无衰减）：60 + 40×0.5 = 80');

/* ============ 8. 涅槃：成长软上限 100 → 不再涨，仅重置等级 ============ */
await mkPet('血狐','🦊',100,'xf');
await mkPet('骨狼','🐺',8,'xsub');
await C('(function(){const q=Pet.getPets().find(p=>p.id===globalThis.__xf);q.isGodPet=true;Pet.addPet(q)})()');
r=await C('Merge.nirvana('+C('globalThis.__xf')+','+C('globalThis.__xsub')+')');
const xmain=C('Pet.getPets().find(p=>p.id==='+C('globalThis.__xf')+')');
A(r&&r.ok===true&&xmain.growth===100,'涅槃达软上限 100：成长不再涨');
A(xmain.level===1,'软上限涅槃仍重置等级为 1');

/* ============ 9. 普通宠（非神级宠）涅槃被拒（2026-09-06 手册 2.7） ============ */
await mkPet('毒沼蛙','🐸',10,'mf2');
await mkPet('瘟熊','🐻',10,'msub2');
r=await C('Merge.merge('+C('globalThis.__mf2')+','+C('globalThis.__msub2')+')');
A(r&&r.ok!==true&&/神级宠/.test(r.error||''),'Merge.merge 别名走涅槃语义：普通宠被拒并提示需神级宠');

console.log('ALL MUTATION TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
