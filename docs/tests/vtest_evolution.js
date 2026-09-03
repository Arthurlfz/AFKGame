// vtest_evolution.js —— 宠物进化系统回归测试
// 覆盖：进化路线配置、进化体速度继承、30 级门槛、进化成功（等级不变/成长提升/名字变化/素材扣除）、
//        素材不足/等级不足失败、进化素材接入战斗掉落
// 复用 vstub.js 的 VM 桩
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);failures++}else console.log('PASS: '+m)};
let failures=0;
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
async function mkPet(name, icon, growth, tag, level){
  level=level||40;
  await C('(async()=>{const p=Pet.createPet("'+name+'","'+icon+'",'+growth+',100,20,10,8);p.level='+level+';Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__'+tag+'=p.id})()');
  await S(60);
}
(async()=>{
await S(300);await C('Game.onLogin("evo@test.com","123456")');await S(300);

/* ============ 1. 进化树配置完整 ============ */
A(C('Config.pet.starters.length')===8,'开局基宠覆盖 8 只');
A(C('Object.keys(Config.pet.evolution.tree).length')===40,'进化树包含 8 条多段进化线');
A(C('Config.pet.evolution.maxEvolveTimes')===10,'进化次数上限 maxEvolveTimes = 10');
A(C('Config.pet.evolution.materialName')==='进化素材','通用进化素材名 = 进化素材');
A(C('(()=>{const t=Config.pet.evolution.tree,s=Config.pet.starters;return s.every(x=>t[x.name]&&t[x.name].length===2&&t[x.name].every(r=>r.minLevel===10))})()'),'8 只基宠均有 2 条 Lv.10 首段路线');
A(C('(()=>{const t=Config.pet.evolution.tree;return Object.values(t).flat().some(r=>r.minLevel===35)&&Object.values(t).flat().some(r=>r.minLevel===60)})()'),'进化树包含 Lv.35 / Lv.60 后续门槛');
A(C('Evolve.getEvolutionRoutes({name:"腐噜兽"})[0].to')==='腐沼兽'&&C('Evolve.getEvolutionRoutes({name:"腐沼兽"})[0].to')==='腐沼王'&&C('Evolve.getEvolutionRoutes({name:"腐沼王"})[0].to')==='腐烂之母','腐噜兽可沿链进化至第3阶终点');
A(C('(()=>{const t=Config.pet.evolution.tree;return Object.values(t).flat().every(r=>!t[r.to]||t[r.to].length===0||t[r.to].every(x=>[35,60].includes(x.minLevel)))})()'),'所有后续路线门槛为 Lv.35 或 Lv.60');

/* ============ 2. 进化体速度继承 ============ */
// 期望值不写死：从 Config.pet.speeds 的基宠取，速度带调整后不必改测试
A(C('Pet.getBaseSpeed({name:"腐沼兽"})')===C('Config.pet.speeds["腐噜兽"]'),
  '进化体 腐沼兽 速度沿用基宠（' + C('Config.pet.speeds["腐噜兽"]') + '）');
A(C('Pet.getBaseSpeed({name:"影刃兔"})')===C('Config.pet.speeds["幽影兔"]'),
  '进化体 影刃兔 速度沿用基宠（' + C('Config.pet.speeds["幽影兔"]') + '）');

/* ============ 3. 进化门槛：等级不足（每段 minLevel=10）不可进化 ============ */
await mkPet('腐噜兽','🐹',10,'low',5);
const lowId=C('globalThis.__low');
A(C('Evolve.canEvolve(Pet.getPets().find(p=>p.id==='+lowId+'))')===false,'Lv.5 基宠不可进化（未达该段 minLevel 10）');
C('Pet.getPets().find(p=>p.id==='+lowId+').level=10');
A(C('Evolve.canEvolve(Pet.getPets().find(p=>p.id==='+lowId+'))')===true,'Lv.10 基宠可进化（达到该段 minLevel）');

/* ============ 4. 进化成功：次数+1 / 成长提升 / 名字变化 / 素材扣除 ============ */
await mkPet('血狐','🦊',10,'ev',10);
const evId=C('globalThis.__ev');
await C('Materials.gain("进化素材",1)');await S(80);
A(C('Materials.getQuantity("进化素材")')>=1,'进化前持有 进化素材 ×1');
const r=await C('Evolve.evolve('+evId+',0)');
A(r.ok===true,'血狐 + 进化素材 进化成功');
A(r.result==='血牙狐','进化结果名字 = 血牙狐');
A(C('Pet.getPets().find(p=>p.id==='+evId+').name')==='血牙狐','主宠名字已变为 血牙狐');
A(C('Pet.getPets().find(p=>p.id==='+evId+').growth')>10,'进化后成长值提升（>10，原 10）');
A(C('Pet.getPets().find(p=>p.id==='+evId+').level')===10,'进化后等级不变（仍为 Lv.10）');
A(C('Pet.getPets().find(p=>p.id==='+evId+').evolveTimes')===1,'进化后次数 = 1');
A(C('Pet.getPets().find(p=>p.id==='+evId+').curHp')===C('Pet.getStats(Pet.getPets().find(p=>p.id==='+evId+')).hp'),'进化后血量回满新上限');
A(C('Materials.getQuantity("进化素材")')===0,'进化后 进化素材 正确扣除（余 0）');
const cloud=C('petsTable.find(p=>p.id==="'+C('Pet.getPets().find(p=>p.id==='+evId+').cloudId')+'")');
A(cloud.name==='血牙狐'&&cloud.growth>10,'云端同步：name=血牙狐 / growth 提升');

/* ============ 4b. 多段进化实际执行：Lv.10 → Lv.35 → Lv.60（2026-08-31 节点重排） ============ */
const chainId=evId;
C('Pet.getPets().find(p=>p.id==='+chainId+').level=35');
await C('Materials.gain("进化素材",1)');await S(80);
const chain2=await C('Evolve.evolve('+chainId+',0)');
A(chain2.ok===true&&chain2.result==='血灾领主','血狐第2阶 Lv.35 进化成功');
A(C('Pet.getPets().find(p=>p.id==='+chainId+').evolveTimes')===2,'多段进化后次数 = 2');
C('Pet.getPets().find(p=>p.id==='+chainId+').level=60');
await C('Materials.gain("进化素材",1)');await S(80);
const chain3=await C('Evolve.evolve('+chainId+',0)');
A(chain3.ok===true&&chain3.result==='血月魔狐','血狐第3阶 Lv.60 进化成功并到达终点');
const endRoutes=C('Evolve.getEvolutionRoutes(Pet.getPets().find(p=>p.id==='+chainId+'))');
A(endRoutes.length===1&&endRoutes[0].keepForm===true,'第3阶终点形态只剩「继续进化（成长+）」占位路线');
// 终点后仍可进化：形态/名字不变，只涨成长（次数 3→4，需精粹进化素材）
await C('Materials.gain("精粹进化素材",1)');await S(80);
const chain4=await C('Evolve.evolve('+chainId+',0)');
A(chain4.ok===true&&chain4.result==='血月魔狐'&&chain4.keepForm===true,'终点后强化进化：名字保持 血月魔狐（keepForm）');
A(C('Pet.getPets().find(p=>p.id==='+chainId+').evolveTimes')===4,'终点后强化进化次数 +1（3 → 4）');
A(C('Pet.getPets().find(p=>p.id==='+chainId+').growth')>chain3.newGrowth,'终点后强化进化成长继续提升');

/* ============ 4c. 融合=转生：重置次数；变异配置核对 ============ */
A(C('Config.synthesize.mutation.chance===0.5'),'合成变异概率为设计要求 50%（当前配置='+C('Config.synthesize.mutation.chance')+'）');
await mkPet('腐噜兽','🐹',10,'mergeMain',60);
await mkPet('血狐','🦊',10,'mergeSub',60);
const mainId=C('globalThis.__mergeMain'),subId=C('globalThis.__mergeSub');
C('Pet.getPets().find(p=>p.id==='+mainId+').evolveTimes=7');
await C('Materials.gain("涅磐兽",1)');await S(80);
C('const __oldRnd=Math.random; Math.random=()=>0.999');
const mr=await C('Merge.merge('+mainId+','+subId+')');
C('Math.random=__oldRnd');
A(mr.ok===true,'融合转生成功');
A(C('Pet.getPets().find(p=>p.id==='+mainId+').evolveTimes')===0,'融合后进化次数重置为 0');

/* ============ 5. 素材不足 / 等级不足 / 次数上限 → 进化失败 ============ */
await mkPet('骨狼','🐺',10,'ev2',10);
const ev2Id=C('globalThis.__ev2');
let r2=await C('Evolve.evolve('+ev2Id+',0)'); // 未给 进化素材
A(r2.ok!==true&&/进化素材/.test(r2.error),'素材不足：进化失败并提示缺少 进化素材');
await mkPet('尸犬','🐶',10,'ev3',5);
const ev3Id=C('globalThis.__ev3');
let r3=await C('Evolve.evolve('+ev3Id+',0)');
A(r3.ok!==true&&/10/.test(r3.error),'等级不足（Lv.5）：进化失败并提示门槛 10');
// 次数上限：把宠物次数设为上限 → 不能再进化
await mkPet('瘟熊','🐻',10,'ev4',10);
const ev4Id=C('globalThis.__ev4');
await C('Materials.gain("进化素材",1)');await S(80);
C('Pet.getPets().find(p=>p.id==='+ev4Id+').evolveTimes=10');
let r4=await C('Evolve.evolve('+ev4Id+',0)');
A(r4.ok!==true&&/上限/.test(r4.error),'次数已满(10)：进化失败并提示需融合转生重置');

/* ============ 6. 进化素材接入战斗掉落（改法一：单池·一场一抽） ============ */
C('Config.drop.pool = { none:0, material:1, equipment:0, egg:0 }');
C('Config.drop.materialWeightsByTier[1] = { "进化素材": 1 }'); // 图1档只留进化素材占位权重，配合 areaEvolutionTiers=['进化素材'] 解析为普通进化素材
const rr = await C('Drop.rollReward({ eggBaseName:"血狐" }, { id:"corrupted-forest" })');
A(rr && rr.type === 'material' && rr.material === '进化素材' && rr.qty === 1, 'rollReward 掉落通用进化素材 ×1');
A(C('Materials.getQuantity("进化素材")') >= 1, '进化素材已计入材料库存（掉落生效）');

console.log(failures?'EVOLUTION TESTS FAILED: '+failures:'ALL EVOLUTION TESTS PASSED');process.exit(failures?1:0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
