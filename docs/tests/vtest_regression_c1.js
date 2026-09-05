// vtest_regression_c1.js —— 第1大陆配置与关键链路专项回归
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{dataset:{},setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},append(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/pet/enemy-data.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
const C=code=>vm.runInContext(code,ctx),A=(x,m)=>x?(console.log('PASS: '+m),true):(console.error('FAIL: '+m),failures++),S=ms=>new Promise(r=>setTimeout(r,ms));let failures=0;
(async()=>{
 await S(200);
 const areas=C('Config.battle.areas'), enemies=C('EnemyData.list');
 // 2026-08-31 地图扩展：10 图 → 17 图（61-100 级第二幕），每图 6 级（图17[97,100] 为 4 级）
 A(areas.length===17,'野外图共 17 张（1-17，覆盖 1-100 级）');
 A(new Set(areas.map(a=>a.id)).size===17,'17 图 id 唯一');
     const ranges=[[1,6],[7,12],[13,18],[19,24],[25,30],[31,36],[37,42],[43,48],[49,54],[55,60],[61,66],[67,72],[73,78],[79,84],[85,90],[91,96],[97,100]], growth=[3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35];
 areas.forEach((a,i)=>{A(JSON.stringify(a.levelRange)===JSON.stringify(ranges[i]),`图${i+1} levelRange 正确`);A(a.recGrowth===growth[i],`图${i+1} recGrowth 正确（${a.recGrowth}）`);A(typeof a.growthRange==='undefined','图'+ (i+1)+' 已移除旧 growthRange 字段');const ids=a.enemyIds||[];A(ids.length>0&&ids.every(id=>enemies.some(e=>e.id===id)),`图${i+1} enemyIds 全可解析`);const pool=C(`Battle.getAreas().find(a=>a.id===${JSON.stringify(a.id)})`);for(const lv of [a.levelRange[0],a.levelRange[1],Math.floor((a.levelRange[0]+a.levelRange[1])/2)]){const n=C(`(()=>{const a=Battle.getAreas().find(x=>x.id===${JSON.stringify(a.id)});return (function(){const es=EnemyData.list,[amin,amax]=a.levelRange,pl=${lv};const bandMin=Math.max(amin,Math.floor((Math.min(amax,Math.max(amin,pl))-1)/5)*5+1),bandMax=Math.min(amax,bandMin+4);const ids=new Set(a.enemyIds);const inArea=e=>(e.levelRange||[e.level,e.level])[1]>=amin&&(e.levelRange||[e.level,e.level])[0]<=amax;const inBand=e=>(e.levelRange||[e.level,e.level])[1]>=bandMin&&(e.levelRange||[e.level,e.level])[0]<=bandMax;const p=es.filter(e=>ids.has(e.id)&&inArea(e));return p.filter(inBand).length||p.length})()})()`);A(n>0,`图${i+1} 玩家等级${lv} 怪池非空`);}});
 const roots=C('Config.pet.starters.map(s=>s.name)'),tree=C('Config.pet.evolution.tree');
 const resolve=name=>{const map={},mark=base=>{const stack=[base];while(stack.length){const cur=stack.pop();for(const r of tree[cur]||[]){if(map[r.to]===undefined){map[r.to]=base;stack.push(r.to)}}}};roots.forEach(mark);return map[name]};
 for(const root of roots){const stack=[root],seen=new Set();while(stack.length){const cur=stack.pop();for(const r of tree[cur]||[]){seen.add(r.to);stack.push(r.to)}}for(const name of seen){const p=C(`Pet.petFromRow({id:'x',name:${JSON.stringify(name)},icon:'x',growth:5,level:1,hp:100,attack:20,defense:10,speed:1,cur_hp:100})`);A(p.lineId===root,`${root} 终端/后代 ${name} 反查根源正确`);}}
 const shadow=C(`Pet.petFromRow({id:'x',name:'影蚀魔君',icon:'x',growth:5,level:1,hp:100,attack:20,defense:10,speed:1,cur_hp:100})`);A(shadow.lineId==='幽影兔','影蚀魔君 lineId=幽影兔');// 速度不写死：从 Config.pet.speeds 的基宠取（速度带调整后不必改测试）
A(C('Pet.getBaseSpeed(globalThis.shadow||{name:"影蚀魔君",lineId:"幽影兔"})')===C('Config.pet.speeds["幽影兔"]'),
  '影蚀魔君基础速度沿用基宠（'+C('Config.pet.speeds["幽影兔"]')+'）');
 // 2026-08-31 用户拍板：腐变本源做最终地图（第 17 张，97-100）；腐变之源降为第一幕终章（第 10 张）
 A(areas[9].id==='blight-heart',
   `腐变之源是第一幕终章（第 10 张，Lv${areas[9].levelRange[0]}-${areas[9].levelRange[1]}）`);
 A(areas[areas.length-1].id==='blight-origin',
   `最终地图是腐变本源（第 ${areas.length} 张，Lv${areas[areas.length-1].levelRange[0]}-${areas[areas.length-1].levelRange[1]}）`);
 // 主线任务 unlockLevel 不早于对应图下限（防任务先于图解锁、引导跳错图）
 {
   const qs=JSON.parse(C('JSON.stringify(Config.drop.quests)')).filter(q=>q.category==='main');
   const byArea={}; for(const a of areas) byArea[a.id]=a;
   const bad=qs.filter(q=>{const a=q.area?byArea[q.area]:null;return a?q.unlockLevel<a.levelRange[0]:false;});
   A(!bad.length,`主线任务解锁不早于对应图下限${bad.length?'，违规：'+bad.map(q=>q.id+'(Lv'+q.unlockLevel+'<图'+byArea[q.area].levelRange[0]+')').join('；'):''}`);
 }
 A(C('Config.trade.taxPer===8&&Config.trade.taxAmount===1'),'交易税配置每满8收1');
 A(C('Market.calcTax(7)===0&&Market.calcTax(8)===1&&Market.calcTax(16)===2'),'交易税边界正确');
 A(C('Config.marketBot.enabled===true'),'假单机制开启');
 console.log(failures?`C1 REGRESSION FAILED: ${failures}`:'ALL C1 REGRESSION PASSED');process.exit(failures?1:0);
})().catch(e=>{console.error('EXC',e.stack||e);process.exit(1)});
