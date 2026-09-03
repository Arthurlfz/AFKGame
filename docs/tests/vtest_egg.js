// vtest_egg.js —— 宠物蛋「按品种」存取回归
// 背景：登录/刷新恢复时只恢复了总数、丢掉品种明细，导致所有蛋退化成一个通用品种，
//       界面拼出「宠物蛋蛋」，且血狐/骨狼等真实品种刷新后消失。
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},history:{replaceState(){},pushState(){}},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-shell.js','../js/ui/ui-login.js','../js/ui/ui-dialog.js','../js/ui/ui-popover.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-bag.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);
await C('Game.onLogin("egg@test.com","123456")');
await S(200);
// 建一只宠物：没有宠物时 onAuthenticated 会提前返回，走不到恢复蛋那一步
await C('(async()=>{const p=Pet.createPet("血狐","🦊",6,100,20,10,8);Pet.addPet(p);Pet.setActive(p.id);const s=await Supabase.savePet(p);p.cloudId=s.data.id;})()');
await S(120);

// —— 蛋显示名：品种 + '蛋'，已带'蛋'字的品种不再重复拼（否则出现"宠物蛋蛋"）——
A(C(`Drop.makeEggName('血狐')`)==='血狐蛋',"makeEggName('血狐') = 血狐蛋");
A(C(`Drop.makeEggName('宠物蛋')`)==='宠物蛋',"makeEggName('宠物蛋') = 宠物蛋（不出现「宠物蛋蛋」）");
A(C(`Drop.makeEggName(null)`)==='宠物蛋','makeEggName(null) 兜底 = 宠物蛋');

// —— 掉蛋落库：drop.js 调 Supabase.addEgg，接口缺失会让每次掉蛋都抛 TypeError（战斗结算直接崩）——
A(C('typeof Supabase.addEgg')==='function','Supabase.addEgg 已存在（掉蛋落库入口）');
const before=C('petEggTable.length');
await C(`Supabase.addEgg('血狐')`);await S(60);
A(C('petEggTable.length')===before+1,'掉蛋写入云端 pet_egg 一行');
A(C(`petEggTable[petEggTable.length-1].egg_type==='血狐'&&petEggTable[petEggTable.length-1].status==='未孵化'`),'落库带品种且状态为「未孵化」');
C('petEggTable.pop()'); // 撤掉这颗测试蛋，避免污染后面「刷新后按品种恢复」的断言

// —— 刷新（重新登录）后按品种恢复 ——
// 云端 pet_egg 三行：血狐×1、骨狼×2
C(`petEggTable.push(
  {id:'e1',owner_id:'user-a',egg_type:'血狐',status:'未孵化'},
  {id:'e2',owner_id:'user-a',egg_type:'骨狼',status:'未孵化'},
  {id:'e3',owner_id:'user-a',egg_type:'骨狼',status:'未孵化'})`);
await C('Game.onLogin("egg@test.com","123456")');
await S(200);
const eggs=JSON.parse(C('JSON.stringify(Drop.getEggs())'));
console.log('  恢复后的蛋：'+JSON.stringify(eggs));
A(eggs['血狐']===1,'刷新后血狐蛋 ×1（品种没丢）');
A(eggs['骨狼']===2,'刷新后骨狼蛋 ×2（品种没丢）');
A(C('Drop.getEggCount()')===3,'刷新后蛋总数 3');
A(C(`JSON.stringify(Object.keys(Drop.getEggs()))`)===JSON.stringify(['血狐','骨狼']),'不会出现「宠物蛋」这个退化品种');

// —— 孵化指定品种：只扣该品种 ——
await C('(async()=>{return await Drop.hatchEgg("骨狼")})()');
await S(150);
const eggs2=JSON.parse(C('JSON.stringify(Drop.getEggs())'));
A(eggs2['骨狼']===1,'孵化后骨狼蛋 2 → 1');
A(eggs2['血狐']===1,'孵化不影响血狐蛋');
A(JSON.parse(C('JSON.stringify(petEggTable.filter(r=>r.status==="已孵化").length)'))===1,'云端标记 1 颗已孵化');

// —— 旧数据兼容：egg_type 为 null 的蛋（加品种列之前掉的）也要能孵化掉，否则刷新后会"复活" ——
C(`petEggTable.push({id:'e4',owner_id:'user-a',egg_type:null,status:'未孵化'})`);
await C('Game.onLogin("egg@test.com","123456")');
await S(200);
A(C(`Drop.getEggs()['宠物蛋']`)===1,'旧数据（无品种）的蛋归入「宠物蛋」');
const h2=await C('(async()=>{return await Drop.hatchEgg("宠物蛋")})()');
await S(150);
A(!(h2&&h2.error),'旧数据的蛋能孵化（云端不会报「没有可孵化的蛋」）');
A(C(`petEggTable.filter(r=>r.id==='e4'&&r.status==='已孵化').length`)===1,'旧数据的蛋孵化后云端标记已孵化（刷新不会复活）');

// —— 登出/切号：本地蛋清空，不能串号 ——
await C('Game.onLogout()');
A(C('Drop.getEggCount()')===0,'登出后本地蛋清空（换号不串蛋）');

// —— 静态防回归：恢复入口必须按品种整体替换，不许再只恢复总数 ——
const mainSrc=fs.readFileSync('../js/main.js','utf8');
A(/Drop\.setEggs\(/.test(mainSrc),'main.js 用 setEggs 按品种恢复');
A(!/setEggCount|Drop\.setEggCount/.test(mainSrc),'main.js 不再使用已删除的 setEggCount');
const dropSrc=fs.readFileSync('../js/core/drop.js','utf8');
A(!/setEggCount/.test(dropSrc),'drop.js 已删除 setEggCount（避免总数退化成通用品种）');
A(/baseName\.endsWith\('蛋'\)/.test(dropSrc),'drop.js 蛋名拼接防重复「蛋」字');
console.log('ALL EGG TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
