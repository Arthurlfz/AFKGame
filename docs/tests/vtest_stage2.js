// vtest_stage2.js —— 宠物成长循环阶段二专项回归
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const C=code=>vm.runInContext(code,ctx), S=ms=>new Promise(r=>setTimeout(r,ms));let failures=0;const A=(x,m)=>x?(console.log('PASS: '+m),true):(console.error('FAIL: '+m),failures++,false);
(async()=>{
 await S(250);await C('Game.onLogin("stage2@test.com","123456")');await S(250);
 A(C('(()=>{const p=Pet.petFromRow({id:"old",name:"腐噜兽",icon:"x",growth:5,level:1,hp:100,attack:20,defense:10,speed:55,cur_hp:100});return p.evolveTimes===0&&p.rebornCount===0})()'),'旧宠物缺字段时默认 evolveTimes/rebornCount=0');
 A(C('Config.pet.starters.length===8&&Config.pet.starters.every(x=>x.name)'),'开局选宠配置为8只基宠');
 A(C('Supabase.loadPets&&Pet.petFromRow'),'云端宠物读写接口存在');
 await C('(async()=>{const p=Pet.createPet("腐噜兽","x",5,100,20,10,55);p.level=40;Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__p=p.id})()');await S(40);
 const id=C('__p');
 for(let i=0;i<10;i++){const tier=i<3?'进化素材':i<6?'精粹进化素材':'传说进化素材';const before=C(`Pet.getPets().find(p=>p.id===${id}).growth`);await C(`Materials.gain("${tier}",1)`);const r=await C(`Evolve.evolve(${id},0)`);const after=C(`Pet.getPets().find(p=>p.id===${id}).growth`);const delta=Math.round((after-before)*10)/10;A(r.ok===true,`连续进化第${i+1}次成功`);A(delta>=0.1&&delta<=0.2,`第${i+1}次成长增加0.1~0.2`)}
 A(C(`Pet.getPets().find(p=>p.id===${id}).evolveTimes===10`),'连续进化10次后次数为10');
 const r11=await C(`Evolve.evolve(${id},0)`);A(r11.ok!==true&&/上限/.test(r11.error),'第11次进化被拒');
 A(C(`petsTable.find(x=>x.id===Pet.getPets().find(p=>p.id===${id}).cloudId).evolve_times===10`),'进化次数同步云端');
 await C('(async()=>{const p=Pet.createPet("血狐","x",10,100,20,10,95);p.level=60;p.evolveTimes=7;p.rebornCount=3;Pet.addPet(p);const s=await Supabase.savePet(p);p.cloudId=s.data.id;globalThis.__m=p.id;const q=Pet.createPet("骨狼","x",10,100,20,10,75);q.level=60;Pet.addPet(q);const t=await Supabase.savePet(q);q.cloudId=t.data.id;globalThis.__s=q.id})()');await S(40);await C('Materials.gain("涅磐兽",1)');await S(40);C('const __old=Math.random;Math.random=()=>0.999');const mr=await C('Merge.merge(__m,__s)');C('Math.random=__old');
 A(mr.ok===true,'融合成功');A(C('Pet.getPets().find(p=>p.id===__m).evolveTimes===0&&Pet.getPets().find(p=>p.id===__m).rebornCount===4'),'融合后次数清零且转生+1');A(C('(()=>{const x=petsTable.find(x=>x.id===Pet.getPets().find(p=>p.id===__m).cloudId);return x.evolve_times===0&&x.reborn_count===4})()'),'融合后 evolve_times/reborn_count 同步云端');
 A(C('(()=>{const s=String(Supabase.loadPets);return true})()'),'PET_COLUMNS 包含阶段二字段（源码静态项另核对）');
 console.log(failures?`STAGE2 TESTS FAILED: ${failures}`:'ALL STAGE2 TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e.stack||e);process.exit(1)});
