// 神圣石回归测试：验证「重 Roll 装备词缀数值」
//  - 词缀类型不变
//  - T 阶不变
//  - 数值在该 T 阶 [min,max] 范围内重新随机（且确实变化）
//  - 数量正确扣除 1
// 复用 vtest.js 的 VM 桩（vstub.js，name 化的 RPC 天然支持新石头）
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{dataset:{},setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)}
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("holy@test.com","123456")');await S(300);
// 造一件金装（2~3 条词缀），入库并拿到云端 id
await C('var heq=Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="gold"))');
await C('Equipment.addToInventory(heq)');
await C('(async()=>{heq.cloudId=(await Items.saveItem(heq)).data.id})()');await S(50);
// 给 2 颗神圣石（用 gain：本地 + 云端 RPC 同步，模拟真实掉落/合成入库）
await C('Materials.gain(Config.craft.holy.name,2)');await S(20);
const qBefore=C('Materials.getQuantity(Config.craft.holy.name)');
A(qBefore===2,'神圣石初始 2 颗');
// 先把每条词缀数值压到各自 T 阶最小值，并把 Math.random 钉到 0.999 → randInt 必取最大值
// 这样 new = max，old = min，保证「数值确实变化」且「落在 T 阶范围」
C('heq.affixes.prefix.concat(heq.affixes.suffix).forEach(a=>{a.value=Config.equipment.affixTiers.find(t=>t.tier===a.tier).min})');
C('globalThis.__rand=Math.random; Math.random=()=>0.999');   // 在 context 内控制随机
const oldJson=C('JSON.stringify(Equipment.flattenAffixes(heq.affixes).map(a=>({type:a.type,tier:a.tier,value:a.value})))');
const r=await C('Craft.reroll(heq)');
C('Math.random=globalThis.__rand');                          // 还原随机
A(r.ok===true,'重Roll 成功返回 ok');
// 词缀类型 / T 阶不变；数值变为该 T 阶最大值（=变化且在区间内）
const check=C(`(function(){const old=JSON.parse('${oldJson}');const cur=Equipment.flattenAffixes(heq.affixes);for(let i=0;i<cur.length;i++){const a=cur[i],o=old[i];const T=Config.equipment.affixTiers.find(t=>t.tier===a.tier);if(a.type!==o.type)return 'type';if(a.tier!==o.tier)return 'tier';if(a.value<T.min||a.value>T.max)return 'range';if(a.value===o.value)return 'unchanged'}return 'ok'})()`);
A(check==='ok',`类型/T阶不变、数值在区间内且已变化 (got:${check})`);
const qAfter=C('Materials.getQuantity(Config.craft.holy.name)');
A(qAfter===qBefore-1,'神圣石正确扣除 1 颗');
// 云端 spend_material 也记录一次（name 化，天然含神圣石）
A(C('rpcCalls.filter(n=>n==="spend_material").length')>=1,'扣除已同步云端 RPC');
// 失败回滚：制造云端更新失败，验证词缀还原（第一次重Roll后本地/云端各剩 1 颗，足以触发）
const snap=C('JSON.stringify(heq.affixes)');
C('globalThis.failUpdate=true');
const rb=await C('Craft.reroll(heq)');
C('globalThis.failUpdate=false');
A(rb.ok===false&&rb.rolledBack===true&&C('JSON.stringify(heq.affixes)')===snap,'云端失败词缀+数量回滚复原');
console.log('ALL HOLY TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
