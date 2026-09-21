// vtest_exp_pool.js —— 【2026-09-16 重写】凝魂晶石退役 + 魂铸新材料 守值
// 原名是「满级经验池 + 凝魂晶石专项自测」，但那套机制已按用户拍板**整条删除**
// （用户：「没必要有了」；理由与沿革见 config.js 的 pet 段说明）。
// 本文件改为守两件事：
//   ① 凝魂晶石 / 满级经验池 / 涅槃晶石加成 **确实已被删除**（防以后有人"顺手"加回来）
//   ② 替代方案生效：魂铸的消耗品是「合成之石」
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-battle-tip.js','../js/ui/ui-stage-fx.js','../js/ui/ui-battle-loot.js','../js/ui/ui-battle-act.js','../js/ui/ui-battle-roster.js','../js/ui/ui-battle-summary.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
let failures=0;const A=(ok,msg)=>{if(ok)console.log('PASS: '+msg);else{console.error('FAIL: '+msg);failures++}};const C=code=>vm.runInContext(code,ctx);const S=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await S(300);await C('Game.onLogin("exppool@test.com","123456")');await S(300);
const MAX=C('Config.pet.maxLevel');

/* ---- 1. 已退役的三样东西：一个都不许回来 ---- */
A(C('Config.pet.expPool')===undefined,'满级经验池配置已删除（Config.pet.expPool 不存在）');
A(C('Config.nirvana.crystalBonus')===undefined,'涅槃的凝魂晶石加成已删除（Config.nirvana.crystalBonus 不存在）');
A(C('!(Config.materialInfo||{})["凝魂晶石"]'),'凝魂晶石已从材料登记表移除（背包不再显示它）');

/* ---- 2. 满级溢出经验：不产任何材料、不再往池里累加 ---- */
await C('(async()=>{const p=Pet.createPet("腐噜兽","x",10,100,20,10,8);p.level='+MAX+';Pet.addPet(p);await Supabase.savePet(p);globalThis.__m=p})()');await S(80);
let r=C('Pet.grantExp(globalThis.__m,999999)');
A(r.maxed===true,'满级时 grantExp 仍返回 maxed（经验条封顶逻辑没被牵连）');
A(r.crystal===0,'满级溢出经验不再产出任何材料（crystal 恒为 0）');
A(C('globalThis.__m.expPool||0')===0,'不再往经验池累加（expPool 保持 0）');

/* ---- 3. 涅槃：只剩「涅槃丹」一条加乘路径 ---- */
async function mkPet(tag,growth,level){await C(`(async()=>{const p=Pet.createPet("腐噜兽","x",${growth},100,20,10,8);p.level=${level};p.isGodPet=true;/* 2026-09-06：只有神级宠能涅槃 */Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__${tag}=p})()`);await S(80);return C(`globalThis.__${tag}.id`)}
const nb=()=>C('Materials.getQuantity("涅槃丹")');

// 3a. 不投任何道具：10 + 8×0.5 = 14
const a=await mkPet('a',10,60),b=await mkPet('b',8,60);
r=await C(`Merge.nirvana(${a},${b},false)`);
A(r.ok===true&&Math.abs(r.newGrowth-14)<0.05,'不投道具：10 + 8×0.5 = '+r.newGrowth+(r.error?'（'+r.error+'）':''));

// 3b. ⭐ 旧入参 useCrystal=true 必须【被忽略】—— 这是"加成真的删了"的硬证据
const a2=await mkPet('a2',10,60),b2=await mkPet('b2',8,60);
r=await C(`Merge.nirvana(${a2},${b2},true)`);
A(r.ok===true&&Math.abs(r.newGrowth-14)<0.05,'useCrystal=true 被忽略（仍为 14，不再 ×1.3）：'+r.newGrowth+(r.error?'（'+r.error+'）':''));
A(Math.abs(C('Merge.calcNirvanaGrowth({growth:10},{growth:8,level:60},1).growth')-14)<0.05,'预览同源：倍率 1 时 = 14');

// 3c. 涅槃丹仍生效：10 + 8×0.5×1.2 = 14.8，且只扣 1 颗
const a3=await mkPet('a3',10,60),b3=await mkPet('b3',8,60);
await C('Materials.gain("涅槃丹",1)');await S(60);
const b0=nb();
r=await C(`Merge.nirvana(${a3},${b3},false,true)`);
A(r.ok===true&&Math.abs(r.newGrowth-14.8)<0.05,'涅槃丹加成仍在：10 + 8×0.5×1.2 = '+r.newGrowth+(r.error?'（'+r.error+'）':''));
A(b0-nb()===1,'涅槃丹消耗 1 颗');

/* ---- 4. 替代方案：魂铸的消耗品 = 合成之石 ---- */
A(C('Config.soulCast.material')==='合成之石','魂铸消耗品是合成之石（替代已退役的凝魂晶石）');
A(C('Config.soulCast.materialCount')===10,'魂铸消耗 10 个（与原设计的分量对齐：10 个 ≈ 2.6 小时挂机）');
await C('(function(){const p=Pet.createPet("腐噜兽","x",10,100,20,10,8);p.level=40;p.traits=[{id:"嗜血",tier:2}];Pet.addPet(p);globalThis.__sc=p;return p.id})()');await S(60);
const sc=await C('Craft.soulCast({identified:true,name:"测试装备",slot:"武器"},globalThis.__sc,"normal")');
A(sc&&sc.ok===false&&/合成之石/.test(sc.error||''),'魂铸材料不足时提示的是「合成之石」：'+((sc&&sc.error)||''));

console.log(failures?'SOULCAST / RETIRED-MECHANICS TESTS FAILED: '+failures:'ALL SOULCAST & RETIRED-MECHANICS TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
