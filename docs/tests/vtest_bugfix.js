// vtest_bugfix.js —— 三个 bug 的针对性回归测试
// Bug 2：融合后保留主宠等级、属性立即按新成长值重算、前端刷新可见
// Bug 3：出战宠物以云端 is_active 为权威还原（刷新后不能变回莱姆）
// 复用 vstub.js 的 VM 桩（vstub.js）
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("fix@test.com","123456")');await S(300);

/* ============ Bug 3：云端出战宠物还原 ============ */
// 登录时的「云端为空→莱姆建档」副作用已发生，清掉，改预置真实存档场景
// 云端预置 2 只：旺财（is_active=true，Lv.20）、莱姆（is_active=false，Lv.1）
await C('petsTable.length=0;Pet.setCloudPets([])');
await C('(async()=>{const a=Pet.createPet("旺财","🐶",6,100,20,10,8);a.level=20;const s1=await Supabase.savePet(a);a.cloudId=s1.data.id;await Supabase.updatePet(a.cloudId,{is_active:true});const b=Pet.createPet("莱姆","🟢",5,100,20,10,8);b.level=1;const s2=await Supabase.savePet(b);b.cloudId=s2.data.id;await Supabase.updatePet(b.cloudId,{is_active:false})})()');
await S(200);
// 模拟刷新：重新从云端整体恢复宠物（main.js restoreCloudPets 路径）
await C('Game.refreshPets()');await S(300);
const activeName=C('Pet.getActivePet().name');
A(activeName==='旺财','Bug3：刷新后出战宠物=云端 is_active 的旺财（实际：'+activeName+'）');
A(C('Pet.getActivePet().level')===20,'Bug3：出战宠物等级还原（Lv.20）');
A(C('Pet.getPets().length')===2,'Bug3：云端宠物列表整体替换（2 只）');
// 对战区同步：刷新后未开战，对战区应显示真实出战宠物而非写死的莱姆
// 名字标签格式是「名字 等级：N级」，按 ' 等级：' 取前缀比对（带等级是有意的：战斗中升级要能看见）
const iconName=C('document.getElementById("pet-icon-name").textContent');
A(iconName.split(' 等级：')[0].trim()==='旺财','Bug3：对战区名字=出战宠物（旺财，实际：'+iconName+'）');
A(C('document.getElementById("pet-icon").textContent')==='🐶','Bug3：对战区图标=出战宠物（🐶，实际：'+C('document.getElementById("pet-icon").textContent')+'）');
// setActive 写入云端 is_active：莱姆出战 → 云端旺财变 false、莱姆变 true
const wId=C('Pet.getPets().find(p=>p.name==="旺财").id');
const lId=C('Pet.getPets().find(p=>p.name==="莱姆").id');
await C('Pet.setActive('+lId+')');await S(100);
const wCloud=C('petsTable.find(p=>p.name==="旺财").is_active');
const lCloud=C('petsTable.find(p=>p.name==="莱姆").is_active');
A(wCloud===false&&lCloud===true,'Bug3：切宠后云端 is_active 同步（旺财=false，莱姆=true）');

/* ============ Bug 2：融合后属性立即重算 ============ */
// 主宠：旺财（成长6，提到 40 级满足融合门槛）；副宠：新宠 成长8 Lv.40
// 等级同步云端（模拟真实流程：升级会写云端），避免刷新后按旧等级算属性
await C('(async()=>{const m=Pet.getPets().find(p=>p.name==="旺财");m.level=60;await Supabase.updatePet(m.cloudId,{level:60});const b=Pet.createPet("副宠","🐹",8,100,20,10,8);b.level=60;Pet.addPet(b);const s=await Supabase.savePet(b);b.cloudId=s.data.id})()');
await S(200);
await C('Materials.gain("涅磐兽",1)');await S(100);
const before=C('JSON.stringify({growth:Pet.getPets().find(p=>p.name==="旺财").growth,hp:Pet.getStats(Pet.getPets().find(p=>p.name==="旺财")).hp,atk:Pet.getStats(Pet.getPets().find(p=>p.name==="旺财")).atk})');
const mId=C('Pet.getPets().find(p=>p.name==="旺财").id');
const sId=C('Pet.getPets().find(p=>p.name==="副宠").id');
const r=await C('Merge.merge('+mId+','+sId+')');
A(r.ok===true,'Bug2：融合执行成功（error='+(r.error||'无')+'）');
const main=C('Pet.getPets().find(p=>p.name==="旺财")');
A(main.growth===10,'Bug2：成长值 6→10（吸收 8×0.5=4）');
A(main.level===1,'Bug2：融合后主宠等级重置为 1');
A(main.exp===0,'Bug2：经验清零');
const after=C('JSON.stringify({growth:Pet.getPets().find(p=>p.name==="旺财").growth,hp:Pet.getStats(Pet.getPets().find(p=>p.name==="旺财")).hp,atk:Pet.getStats(Pet.getPets().find(p=>p.name==="旺财")).atk})');
const B=JSON.parse(before), Af=JSON.parse(after);
// 1 级 × 新成长 10：hp = 100 + 1×10×5 = 150，atk = 20 + 1×10×2 = 40
A(Af.hp===150&&Af.atk===40,'Bug2：属性按 1 级 × 新成长值重算（hp '+B.hp+'→'+Af.hp+'，atk '+B.atk+'→'+Af.atk+'）');
A(C('Pet.getPets().find(p=>p.name==="旺财").curHp')===Af.hp,'Bug2：融合后血量回满至新上限（150）');
A(!C('Pet.getPets().some(p=>p.name==="副宠")'),'Bug2：副宠消失');
const cloudGrowth=C('petsTable.find(p=>p.name==="旺财").growth');
A(cloudGrowth===10,'Bug2：云端 growth 已同步（10）');
const cloudLevel=C('petsTable.find(p=>p.name==="旺财").level');
A(cloudLevel===1,'Bug2：云端 level 已同步（1）');
// 模拟刷新后仍按「1 级 + 新成长」还原属性（云端权威链路）
await C('Game.refreshPets()');await S(300);
const rAtk=C('Pet.getStats(Pet.getPets().find(p=>p.name==="旺财")).atk');
A(rAtk===Af.atk,'Bug2：刷新后属性仍为 1 级 × 新成长值计算的数值（'+rAtk+'）');
console.log('ALL BUGFIX TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
