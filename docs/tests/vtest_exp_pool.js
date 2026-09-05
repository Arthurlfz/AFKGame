// vtest_exp_pool.js —— 满级经验池 + 凝魂晶石（涅槃加成 / 可交易）专项自测
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
let failures=0;const A=(ok,msg)=>{if(ok)console.log('PASS: '+msg);else{console.error('FAIL: '+msg);failures++}};const C=code=>vm.runInContext(code,ctx);const S=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await S(300);await C('Game.onLogin("exppool@test.com","123456")');await S(300);
const EP=C('Config.pet.expPool'),NV=C('Config.nirvana'),MAX=C('Config.pet.maxLevel');
A(!!EP&&EP.perCrystal>0&&!!EP.material,'经验池已配置：每 '+EP?.perCrystal+' 经验凝 1 颗'+EP?.material);
A(NV.crystalBonus&&NV.crystalBonus.material===EP.material,'凝魂晶石用途落在涅槃加成上');
A(C('Market.isPaymentMaterial("'+EP.material+'")')===true,'凝魂晶石可作交易支付材料');

/* ---- 1. 满级后经验入池，攒满才凝晶 ---- */
await C('(async()=>{const p=Pet.createPet("腐噜兽","x",10,100,20,10,8);p.level='+MAX+';Pet.addPet(p);await Supabase.savePet(p);globalThis.__m=p})()');await S(80);
let r=C('Pet.grantExp(globalThis.__m,'+(EP.perCrystal-1)+')');
A(r.maxed===true&&r.crystal===0&&C('Math.round(globalThis.__m.expPool)')===EP.perCrystal-1,'满级后不足门槛：经验只入池，不产晶石（池 '+(EP.perCrystal-1)+'）');
A(C('Materials.getQuantity("'+EP.material+'")')===0,'未达门槛时材料为 0');
r=C('Pet.grantExp(globalThis.__m,1)');
A(r.crystal===1&&C('Math.round(globalThis.__m.expPool)')===0,'攒满门槛：凝出 1 颗且池清零');
A(C('Materials.getQuantity("'+EP.material+'")')===1,'凝魂晶石进入账号材料（持有 1）');

/* ---- 2. 升到满级时多出来的经验不蒸发 ---- */
// 升到满级那一下：先填满足以升级的量，再让"超过满级经验条上限"的部分进池（这部分原本直接蒸发）
const needMax=C('Pet.expNeed('+MAX+')');
await C('(async()=>{const p=Pet.createPet("血狐","x",10,85,30,8,110);p.level='+(MAX-1)+';p.exp=Pet.expNeed(p.level)-1;Pet.addPet(p);await Supabase.savePet(p);globalThis.__n=p})()');await S(80);
r=C('Pet.grantExp(globalThis.__n,'+(needMax+EP.perCrystal+1)+')');
A(r.leveled===true&&r.newLevel===MAX&&r.maxed===true,'最后一级升满：Lv.'+(MAX-1)+' → Lv.'+MAX);
A(r.crystal===1&&C('Materials.getQuantity("'+EP.material+'")')===2,'升满时超出经验条上限的 '+EP.perCrystal+' 经验同样凝成 1 颗（累计 2）');
A(C('globalThis.__n.exp')===C('Pet.expNeed('+MAX+')'),'满级后经验条保持封顶');

/* ---- 3. 涅槃投入凝魂晶石：吸收 +30%，石头两样都扣 ---- */
async function mkPet(tag,growth,level){await C(`(async()=>{const p=Pet.createPet("腐噜兽","x",${growth},100,20,10,8);p.level=${level};Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__${tag}=p})()`);await S(80);return C(`globalThis.__${tag}.id`)}
// 材料用 gain 入库（走云端 RPC，spend 才扣得动），断言一律看"本次增减"，不受前面用例存量影响
const qCrystal=()=>C('Materials.getQuantity("'+EP.material+'")'),qBeast=()=>C('Materials.getQuantity("涅磐兽")');
const CB_AMT=NV.crystalBonus.amount;

/* ---- 3. 涅槃投入凝魂晶石：吸收 +30%，石头两样都扣 ---- */
const a=await mkPet('a',10,60),b=await mkPet('b',8,60);
let c0=qCrystal(),b0=qBeast();
await C('Materials.gain("'+EP.material+'",'+CB_AMT+')');await C('Materials.gain("涅磐兽",1)');await S(60);
r=await C(`Merge.nirvana(${a},${b},true)`);
A(r.ok===true,'投入晶石涅槃成功'+(r.error?'（'+r.error+'）':''));
A(Math.abs(r.newGrowth-Math.round((10+8*0.5*1.3)*10)/10)<0.05,'晶石加成：10 + 8×0.5×1.3 = '+r.newGrowth);
A(Math.abs(C('Merge.calcNirvanaGrowth({growth:10},{growth:8,level:60},1.3).growth')-r.newGrowth)<0.05,'预览与实测同源（calcNirvanaGrowth 带加成倍率）');
A(qCrystal()===c0,'凝魂晶石净扣 '+CB_AMT+' 颗（'+c0+' → '+qCrystal()+'）');
A(qBeast()===b0,'涅磐兽净扣 1 只（'+b0+' → '+qBeast()+'）');

/* ---- 4. 不投晶石走原数值 ---- */
const c=await mkPet('c',10,60),d=await mkPet('d',8,60);
c0=qCrystal();b0=qBeast();
await C('Materials.gain("涅磐兽",1)');await S(60);
r=await C(`Merge.nirvana(${c},${d},false)`);
A(r.ok===true&&Math.abs(r.newGrowth-14)<0.05,'不投晶石：10 + 8×0.5 = '+r.newGrowth+(r.error?'（'+r.error+'）':''));
A(qCrystal()===c0,'不投晶石时晶石一颗不动');
A(qBeast()===b0,'不投晶石时涅磐兽仍照常扣除 1 只');

/* ---- 5. 晶石不足：拒绝涅槃，且不白扣涅磐兽 ---- */
const e=await mkPet('e',10,60),f=await mkPet('f',8,60);
// 先把晶石清空再补到「刚好差 1 颗」，否则前面用例攒下的存量会让这次误判为材料充足
await C('Materials.spend("'+EP.material+'",'+qCrystal()+')');
c0=qCrystal();b0=qBeast();
await C('Materials.gain("'+EP.material+'",'+(CB_AMT-1)+')');await C('Materials.gain("涅磐兽",1)');await S(60);
r=await C(`Merge.nirvana(${e},${f},true)`);
A(!!r.error&&/不足/.test(r.error),'晶石不足时涅槃被拒绝：'+(r.error||''));
A(qBeast()===b0+1,'拒绝时涅磐兽未被扣（不白花稀有材料）');
A(qCrystal()===c0+CB_AMT-1,'拒绝时晶石保持原样');
console.log(failures?'EXP POOL TESTS FAILED: '+failures:'ALL EXP POOL TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
