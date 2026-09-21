// vtest_bag.js —— 背包分类页最小回归
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-shell.js','../js/ui/ui-login.js','../js/ui/ui-dialog.js','../js/ui/ui-popover.js','../js/ui/ui-battle.js','../js/ui/ui-battle-tip.js','../js/ui/ui-stage-fx.js','../js/ui/ui-battle-loot.js','../js/ui/ui-battle-roster.js','../js/ui/ui-battle-summary.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-bag.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/main.js'])VTF.load(ctx,f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("bag@test.com","123456")');await S(300);
// 准备一些数据
await C('(async()=>{const p=Pet.createPet("血狐","🦊",6,100,20,10,8);Pet.addPet(p);Pet.setActive(p.id);const s=await Supabase.savePet(p);p.cloudId=s.data.id;Equipment.addToInventory(Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="blue")));Materials.gainLocal(Config.craft.reforge.name,2);Materials.gainLocal("测试素材",3);await Drop.setEggs({"血狐":2});})()');
await S(120);
C('UI.renderAll()');
A(!!els['bag-root'],'背包页容器存在');
A(typeof C('UI.renderBag')==='function','renderBag 函数存在');
A(els['bag-root'].children.length>0,'背包页已渲染内容');
A(C('document.getElementById("tab-bag")')!==null,'背包页 tab 存在');

/* 数字滚动工具（2026-09-20，任务单 03）：全站唯一的滚动实现 = 动效层 UI.setNum。
 * 本环境没有 requestAnimationFrame ⇒ 走"直接落值"分支（这正是测试环境该有的行为，不是缺陷）。
 * 守两件：① 落值 + fmt 正确（fmt 坏掉会让"×12"变成裸数字）② opt.from 生效
 *        （弹窗/背包底部这些元素是**新建**的，没有 opt.from 就永远滚不起来）。 */
A(typeof C('UI.setNum')==='function','动效层导出 UI.setNum（全站唯一的数字滚动入口）');
{
  const r1=C('(function(){const b=document.createElement("b");UI.setNum(b,7,{fmt:function(v){return "×"+Math.round(v)}});return b.textContent})()');
  A(r1==='×7','UI.setNum 落值并套用 fmt（实际 '+r1+'）');
  const r2=C('(function(){const b=document.createElement("b");b.__num=3;UI.setNum(b,9);return b.textContent})()');
  A(r2==='9','UI.setNum 对常驻元素也落值（实际 '+r2+'）');
  const r3=C('(function(){const b=document.createElement("b");UI.setNum(b,5,{from:0});return b.__num})()');
  A(r3===5,'UI.setNum 接受 opt.from（新建元素从 0 起步，实际 __num='+r3+'）');
}
console.log('ALL BAG TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
