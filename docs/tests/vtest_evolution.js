// vtest_evolution.js —— 宠物进化系统回归测试
// 覆盖：进化路线配置、进化体速度继承、30 级门槛、进化成功（等级不变/成长提升/名字变化/素材扣除）、
//        素材不足/等级不足失败、进化素材接入战斗掉落
// 复用 vstub.js 的 VM 桩
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
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
A(C('Config.pet.evolution.maxEvolveTimes')===4,'进化次数上限 maxEvolveTimes = 4（5 阶：初始+4 次进化，2026-09-06）');
A(C('Config.pet.evolution.materialName')==='进化素材','通用进化素材名 = 进化素材');
A(C('(()=>{const t=Config.pet.evolution.tree,s=Config.pet.starters;return s.every(x=>t[x.name]&&t[x.name].length===2&&t[x.name].every(r=>r.minLevel===10))})()'),'8 只基宠均有 2 条 Lv.10 首段路线');
A(C('(()=>{const t=Config.pet.evolution.tree;return Object.values(t).flat().some(r=>r.minLevel===25)&&Object.values(t).flat().some(r=>r.minLevel===60)})()'),'进化树包含 Lv.25 / Lv.60 后续门槛（2026-09-06：35→25）');
A(C('Evolve.getEvolutionRoutes({name:"腐噜兽"})[0].to')==='腐沼兽'&&C('Evolve.getEvolutionRoutes({name:"腐沼兽"})[0].to')==='腐沼王'&&C('Evolve.getEvolutionRoutes({name:"腐沼王"})[0].to')==='腐烂之母','腐噜兽可沿链进化至第3阶终点');
A(C('(()=>{const t=Config.pet.evolution.tree;return Object.values(t).flat().every(r=>!t[r.to]||t[r.to].length===0||t[r.to].every(x=>[25,60].includes(x.minLevel)))})()'),'所有后续路线门槛为 Lv.25 或 Lv.60');
A(C('Config.pet.evolution.boostItems.every(id=>{const i=Config.itemOf(id);return i&&i.category==="evolve"&&i.boost>0})'),'三个进化强化道具均有有效定义');
A(C('!Object.values(Config.drop.materialWeightsByTier).some(w=>w["强化丹B"]||w["天仙玉露"]) && (Config.towerDrops.items.some(i=>i.name==="强化丹B")) && (Config.towerDrops.items.some(i=>i.name==="天仙玉露"))'),'强化丹B与天仙玉露移出地图掉落（2026-09-09 归通天塔，towerDrops 已登记）');

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

/* ============ 4a. 进化强化道具：倍率结算、消耗与库存校验 ============ */
await mkPet('腐噜兽','🐹',10,'boosted',10);
const boostedId=C('globalThis.__boosted');
await C('Materials.gain("进化素材",1)');await C('Materials.gain("强化丹A",1)');await S(80);
const boosted=await C('Evolve.evolve('+boostedId+',0,0.2,"evo_dan_a")');
A(boosted.ok===true&&boosted.boost===0.22&&boosted.boostItem.id==='evo_dan_a','强化丹A将基础成长 +0.20 放大为 +0.22');
A(C('Materials.getQuantity("强化丹A")')===0,'强化丹A随进化成功正确扣除');
await mkPet('瘟熊','🐻',10,'boostMissing',10);
const boostMissingId=C('globalThis.__boostMissing');
await C('Materials.gain("进化素材",1)');await S(80);
const boostMissing=await C('Evolve.evolve('+boostMissingId+',0,0.2,"evo_dan_b")');
A(boostMissing.ok!==true&&/强化丹B/.test(boostMissing.error),'未持有强化丹B时拒绝进化且提示缺少道具');
A(C('Materials.getQuantity("进化素材")')===1,'强化道具不足时不扣阶段进化素材');
C('Materials.spendLocal("进化素材",1)'); // 清理本段特意保留的素材，避免影响后续不足素材用例

/* ============ 4b. 5 阶进化链实际执行（2026-09-06；2026-09-11 终阶额外×3 取消）：
 *   Lv10 一阶（进化素材）→ Lv25 二阶（精粹）→ Lv40 三阶·淬体（传说，形态不变）
 *   → Lv60 终阶（传说 ×1） ============ */
const chainId=evId;
C('Pet.getPets().find(p=>p.id==='+chainId+').level=25');
await C('Materials.gain("精粹进化素材",1)');await S(80);
const chain2=await C('Evolve.evolve('+chainId+',0)');
A(chain2.ok===true&&chain2.result==='血灾领主','血狐二阶 Lv.25 进化成功（精粹进化素材）');
A(C('Pet.getPets().find(p=>p.id==='+chainId+').evolveTimes')===2,'二阶后进化次数 = 2');
A(C('Pet.getEvolveStage(Pet.getPets().find(p=>p.id==='+chainId+'))')===3,'二阶后阶段 = 3');
C('Pet.getPets().find(p=>p.id==='+chainId+').level=40');
await C('Materials.gain("传说进化素材",1)');await S(80);
const chain3=await C('Evolve.evolve('+chainId+',0)');
A(chain3.ok===true&&chain3.result==='血灾领主'&&chain3.keepForm===true,'三阶 Lv.40 淬体：形态不变（keepForm）');
A(C('Pet.getEvolveStage(Pet.getPets().find(p=>p.id==='+chainId+'))')===4,'三阶后阶段 = 4');
A(C('Pet.getPets().find(p=>p.id==='+chainId+').growth')>chain2.newGrowth,'淬体阶成长继续提升（+0.3~0.4）');
C('Pet.getPets().find(p=>p.id==='+chainId+').level=60');
await C('Materials.gain("传说进化素材",1)');await S(80);
const chain4=await C('Evolve.evolve('+chainId+',0)');
A(chain4.ok===true&&chain4.result==='血月魔狐','终阶 Lv.60 进化成功（传说进化素材 ×1，额外素材已取消）');
A(C('Pet.getEvolveStage(Pet.getPets().find(p=>p.id==='+chainId+'))')===5,'终阶阶段 = 5');
A(C('Materials.getQuantity("传说进化素材")')===0,'终阶共消耗 传说进化素材 ×1');
const endRoutes=C('Evolve.getEvolutionRoutes(Pet.getPets().find(p=>p.id==='+chainId+'))');
A(endRoutes.length===0,'终阶后没有更多进化路线（5 阶走到头）');

/* ============ 4c. 涅槃：只有神级宠才能涅槃（手册 2.7） ============ */
A(C('Config.synthesize.mutation.chance===0.5'),'合成变异概率为设计要求 50%（当前配置='+C('Config.synthesize.mutation.chance')+'）');
await mkPet('腐噜兽','🐹',10,'mergeMain',60);
await mkPet('血狐','🦊',10,'mergeSub',60);
const mainId=C('globalThis.__mergeMain'),subId=C('globalThis.__mergeSub');
C('Pet.getPets().find(p=>p.id==='+mainId+').evolveTimes=4');
await C('Materials.gain("涅磐兽",10)');await S(80);
const mr=await C('Merge.nirvana('+mainId+','+subId+')');
A(mr.ok!==true&&/神级宠/.test(mr.error),'普通宠涅槃被拒：提示只有神级宠才能涅槃');
A(C('Materials.getQuantity("涅磐兽")')>=10,'被拒时不扣涅磐兽');

/* ============ 5. 素材不足 / 等级不足 / 次数上限 → 进化失败 ============ */
await mkPet('骨狼','🐺',10,'ev2',10);
const ev2Id=C('globalThis.__ev2');
let r2=await C('Evolve.evolve('+ev2Id+',0)'); // 未给 进化素材
A(r2.ok!==true&&/进化素材/.test(r2.error),'素材不足：进化失败并提示缺少 进化素材');
await mkPet('尸犬','🐶',10,'ev3',5);
const ev3Id=C('globalThis.__ev3');
let r3=await C('Evolve.evolve('+ev3Id+',0)');
A(r3.ok!==true&&/10/.test(r3.error),'等级不足（Lv.5）：进化失败并提示门槛 10');
/* ============ 5b. 上限判定 = 阶段走完（2026-09-10 规则修正） ============
 * 旧规则用「次数 >= maxEvolveTimes」当闸门，会被「次数与阶段脱钩」的老存档永久卡在中间阶。
 * 现场数据（用户实测）：血疫暴君 Lv58 / 进化次数 4 / 云端阶段 4 / 下一阶=终阶 → "能进化 false"，
 * 界面显示"进化已达上限(4次)，需涅槃重置" → 永远到不了终阶。
 * 现在：闸门只看「还有没有下一阶」，并顺手把次数校准成「阶段 − 1」。 */
await mkPet('瘟熊','🐻',10,'ev4',60);
const ev4Id=C('globalThis.__ev4');
await C('Materials.gain("传说进化素材",8)');await S(80);
C('(()=>{const p=Pet.getPets().find(p=>p.id==='+ev4Id+');p.evolveTimes=4;p.evolveStage=4})()'); // 复刻老存档：次数满、阶段卡在三阶
A(C('Evolve.canEvolve(Pet.getPets().find(p=>p.id==='+ev4Id+'))')===true,'次数已满但阶段没走完 → 仍可进化（不再被次数卡死）');
const r4=await C('Evolve.evolve('+ev4Id+',0)');
A(r4.ok===true&&C('Pet.getEvolveStage(Pet.getPets().find(p=>p.id==='+ev4Id+'))')===5,'脱钩的老存档能自救到终阶（阶段 4 → 5）');
A(C('Pet.getPets().find(p=>p.id==='+ev4Id+').evolveTimes')===4,'次数被校准回「阶段 − 1」= 4（不越界）');
const r5=await C('Evolve.evolve('+ev4Id+',0)');
A(r5.ok!==true&&/终阶/.test(r5.error),'阶段链走完才是真上限：终阶后再进化被拒');

/* ============ 6. 进化素材接入战斗掉落（改法一：单池·一场一抽） ============ */
C('Config.drop.pool = { none:0, material:1, equipment:0, egg:0 }');
C('Config.drop.poolByStage = { 1: { none:0, material:1, equipment:0, egg:0 } }'); // 2026-09-06：按阶段池优先于 pool，mock 必须覆盖（图1=stage1）
C('Config.drop.materialWeightsByTier[1] = { "进化素材": 1 }'); // 图1档只留进化素材占位权重，配合 areaEvolutionTiers=['进化素材'] 解析为普通进化素材
const rr = await C('Drop.rollReward({ eggBaseName:"血狐" }, { id:"corrupted-forest" })');
A(rr && rr.type === 'material' && rr.material === '进化素材' && rr.qty === 1, 'rollReward 掉落通用进化素材 ×1');
A(C('Materials.getQuantity("进化素材")') >= 1, '进化素材已计入材料库存（掉落生效）');

console.log(failures?'EVOLUTION TESTS FAILED: '+failures:'ALL EVOLUTION TESTS PASSED');process.exit(failures?1:0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
