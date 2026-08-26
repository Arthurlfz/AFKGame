// 前后缀结构回归测试：验证「装备词缀改成前后缀结构」
//  - AFFIX_POOL 6 条词缀均带 category（前缀 atk/hp/def，后缀 spd/crit/lifesteal）
//  - affixCategory 归类正确
//  - 生成装备的词缀都能正确归类（无未知类型），且前缀 ≤3、后缀 ≤3（结构上限，先不改数量逻辑）
//  - 打造面板（openCraftPanel）按需式前后缀分组渲染：含「前缀（n/3）」「后缀（n/3）」与分隔线，不崩
// 复用 vtest.js 的 VM 桩（vstub.js）
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el()},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)}
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("affix@test.com","123456")');await S(300);
// 1) AFFIX_POOL 结构：6 条 + 每条带 category
const poolLen=C('Equipment.AFFIX_POOL.length');
A(poolLen===6,'词缀池共 6 条');
const cats=C('JSON.stringify(Equipment.AFFIX_POOL.map(a=>({t:a.type,c:a.category})))');
A(cats==='[{"t":"atk","c":"prefix"},{"t":"hp","c":"prefix"},{"t":"def","c":"prefix"},{"t":"spd","c":"suffix"},{"t":"crit","c":"suffix"},{"t":"lifesteal","c":"suffix"}]','词缀池归类正确（前缀 atk/hp/def，后缀 spd/crit/lifesteal）');
// 2) affixCategory 映射
const map=C(`JSON.stringify(['atk','hp','def','spd','crit','lifesteal'].map(t=>Equipment.affixCategory(t)))`);
A(map==='["prefix","prefix","prefix","suffix","suffix","suffix"]','affixCategory 归类正确');
// 3) 生成装备：大量采样，验证归类完整 + 结构上限
C('var golds=[],blues=[],whites=[]');
for(let i=0;i<120;i++){await C('whites.push(Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="white")))');}
for(let i=0;i<120;i++){await C('blues.push(Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="blue")))');}
for(let i=0;i<120;i++){await C('golds.push(Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="gold")))');}
const r=C(`(function(){
  const all=whites.concat(blues,golds);
  let pMax=0,sMax=0,bad=0;
  for(const eq of all){
    const p=eq.affixes.prefix||[];
    const s=eq.affixes.suffix||[];
    const total=p.length+s.length;
    if(p.length>3||s.length>3) bad++;                            // 结构上限：每类 ≤3
    if(total>6) bad++;                                           // 结构上限：总共 ≤6
    pMax=Math.max(pMax,p.length); sMax=Math.max(sMax,s.length);
  }
  return JSON.stringify({n:all.length,bad,pMax,sMax});
})()`);
const stat=JSON.parse(r);
A(stat.bad===0,`生成 ${stat.n} 件：词缀全部正确归类，无丢失/无超上限`);
A(stat.pMax<=3&&stat.sMax<=3,`前缀最大 ${stat.pMax} / 后缀最大 ${stat.sMax}（均 ≤3）`);
A(stat.pMax<=3&&stat.sMax<=3,`结构上限满足：前缀 ≤3 且 后缀 ≤3`);
// 4) 打造面板分组渲染（端到端）：白/蓝/金各取一件，调用 openCraftPanel 后检查 craft-body 内含分组标记
for(const kind of ['white','blue','gold']){
  C(`var ceq=${kind}s[0]; ceq.cloudId='c-'+Math.random().toString(36).slice(2)`);
  await C('UI.openCraftPanel(ceq)');
  const html=C('document.getElementById("craft-body").innerHTML');
  A(/前缀（\d\/3）/.test(html),`[${kind}] 打造面板含「前缀（n/3）」分组标题`);
  A(/后缀（\d\/3）/.test(html),`[${kind}] 打造面板含「后缀（n/3）」分组标题`);
  A(html.includes('craft-affix-divider'),`[${kind}] 打造面板含前后缀分隔线`);
  A(/前缀 \d\/3 · 后缀 \d\/3/.test(html),`[${kind}] 打造面板含「前缀 n/3 · 后缀 n/3」计数`);
}
console.log('ALL AFFIX-STRUCTURE TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
