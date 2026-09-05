// 增缀石回归测试（前后缀结构版）：验证「按前后缀优先级给装备新增一条随机词缀」
//  - 前缀未满（<3）→ 优先加前缀；前缀满（=3）→ 加后缀；前后缀都满（共 6）→ 报错
//  - 新增词缀：类型随机（不与现有重复、且属于目标桶）、T 阶随机（1~5）、数值按该 T 阶区间随机
//  - 数量正确扣除 1；云端同步（spend_material RPC）/ 失败回滚
// 复用 vstub.js 的 VM 桩（name 化的 RPC 天然支持增缀石）
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{dataset:{},setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)}
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
// 2026-09-04 吸血移入前缀池（equipment.js AFFIX_POOL 同口径），新增三类纯数值词缀归后缀
const PREFIX_TYPES=['atk','hp','def','lifesteal'], SUFFIX_TYPES=['spd','crit','critDamage','pen','dmgBonus','dr'];
// 从 VM 上下文取一次 T 阶数值区间表，供 Node 侧做区间断言（Node 侧无 Config）
const TIERS=JSON.parse(C('JSON.stringify(Config.equipment.affixTiers)'));
const tierRange=t=>TIERS.find(x=>x.tier===t);
const countP=C=>C('eq.affixes.prefix.length'), countS=C=>C('eq.affixes.suffix.length'), countAll=C=>(C('eq.affixes.prefix.length')+C('eq.affixes.suffix.length'));
(async()=>{
await S(300);await C('Game.onLogin("aug@test.com","123456")');await S(300);
// 构造一件确定词缀的装备：前缀 1 条(atk)，后缀 0 条；入库拿云端 id
await C('var eq={id:1,name:"测试剑",slot:"武器",tier:4,rarity:{id:"white",label:"白装",color:"#ccc"},base:{type:"atk",label:"攻击",value:10},affixes:{prefix:[{type:"atk",label:"攻击",tier:4,value:10}],suffix:[]},locked:false,fresh:false}');
await C('(async()=>{eq.cloudId=(await Items.saveItem(eq)).data.id})()');await S(50);
A(countP(C)===1&&countS(C)===0,'初始：前缀 1 条、后缀 0 条');
// 给 10 颗增缀石（gain：本地 + 云端 RPC 同步，模拟真实掉落/合成入库）
await C('Materials.gain(Config.craft.augment.name,10)');await S(20);
const qBefore=C('Materials.getQuantity(Config.craft.augment.name)');
A(qBefore===10,'增缀石初始 10 颗');
// —— 失败回滚：制造云端更新失败，验证词缀还原 + 数量复原 ——
const pBefore=countP(C), sBefore=countS(C), qRB=qBefore;
C('globalThis.failUpdate=true');
const rb=await C('Craft.augment(eq)');
C('globalThis.failUpdate=false');
A(rb.ok===false&&rb.rolledBack===true,'云端失败返回 rolledBack');
A(countP(C)===pBefore&&countS(C)===sBefore,'云端失败词缀数复原（前缀'+pBefore+'/后缀'+sBefore+'）');
A(C('Materials.getQuantity(Config.craft.augment.name)')===qRB,'云端失败数量复原');
// —— 前后缀优先级填充：前缀先到 3，再后缀到 3，共 6 ——
// 钉随机到 0.999（仅让结果可复现；断言不依赖具体类型，只看 target/计数/归属/区间）
C('globalThis.__rand=Math.random; Math.random=()=>0.999');
const usedTypes=new Set();
let total=countAll(C);
for(let i=0;i<5;i++){
  const r=await C('Craft.augment(eq)');
  A(r.ok===true,`第 ${i+1} 次增缀成功`);
  // 优先级：前两次必须加前缀（此时前缀<3），第三次起必须加后缀（前缀已满）
  A(r.changed.target===(i<2?'prefix':'suffix'),`第 ${i+1} 次优先级正确（target=${r.changed.target}，期望 ${i<2?'prefix':'suffix'}）`);
  // 计数 +1 且不超过上限
  const np=countP(C), ns=countS(C);
  A(np+ns===total+1,`第 ${i+1} 次词缀总数 +1（${total} → ${np+ns}）`);
  A(np<=3&&ns<=3,`第 ${i+1} 次上限满足（前缀 ${np}/3 · 后缀 ${ns}/3）`);
  const n=r.changed.new;
  const cat=n.type===r.changed.target?r.changed.target:(PREFIX_TYPES.includes(n.type)?'prefix':'suffix');
  A(cat===r.changed.target,`第 ${i+1} 次新增词缀属于目标桶（${n.type} → ${r.changed.target}）`);
  A(!usedTypes.has(n.type),`第 ${i+1} 次新增词缀类型不重复（${n.type}）`);
  usedTypes.add(n.type);
  A(n.tier>=1&&n.tier<=5,`第 ${i+1} 次 T 阶合法（T${n.tier}）`);
  const T=tierRange(n.tier);
  A(n.value>=T.min&&n.value<=T.max,`第 ${i+1} 次数值落在该 T 阶区间`);
  total=np+ns;
}
C('Math.random=globalThis.__rand');
A(countP(C)===3&&countS(C)===3,`前缀满 3 / 后缀满 3（共 ${countAll(C)} 条）`);
// 扣石正确：5 次成功 = 扣 5（回滚那次已退回）
A(C('Materials.getQuantity(Config.craft.augment.name)')===qBefore-5,`增缀石正确扣除 5 颗（${qBefore} → ${qBefore-5}）`);
A(C('rpcCalls.filter(n=>n==="spend_material").length')>=6,'增缀已同步云端 RPC（含 1 次失败尝试）');
// —— 前后缀都满 → 不能再增 ——
const r6=await C('Craft.augment(eq)');
A(r6.ok!==true&&/均已满/.test(r6.error||''),'前后缀均满时报错：'+JSON.stringify(r6.error));
console.log('ALL AUGMENT TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
