const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){}},appendChild(){},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',type:'number'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el()},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],uidSeq:0,rpcCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
const STUB=`function tq(src,pre){const q={filters:Object.assign({},pre||{}),eq(k,v){this.filters[k]=v;return this},order(o){this.orderBy=o;return this},then(r){let out=src.slice().filter(x=>Object.keys(this.filters).every(k=>x[k]===this.filters[k]));r({data:out,error:null})}};return q}
function ins(t,row,src){uidSeq++;const rec=Object.assign({id:t+'-uuid-'+uidSeq},row);src.push(rec);return{data:rec,error:null}}
supabase.createClient=function(){return{auth:{getSession:async()=>({data:{session:session}}),signInWithPassword:async({email})=>{session={user:{id:'user-a',email}};return{data:{session},error:null}},signUp:async()=>({data:{session:null,user:null},error:null}),signOut:async()=>{session=null;return{error:null}}},
from(t){
  if(t==='materials')return{select:()=>tq(materialsTable,session?{user_id:session.user.id}:{})};
  if(t==='pets'||t==='equip_items'){
    const src=t==='pets'?petsTable:itemsTable;
    return{select:()=>tq(src,session?{user_id:session.user.id}:{}),insert:row=>({select:()=>({single:async()=>ins(t,row,src)})}),
      update:(patch)=>({eq:(col,val)=>({then:async()=>{const row=src.find(x=>x[col]===val);if(row)Object.assign(row,patch);return{data:null,error:null}}})}),
      delete:()=>({eq:(col,val)=>({then:async()=>{const i=src.findIndex(x=>x[col]===val);if(i>=0)src.splice(i,1);return{data:null,error:null}}})})};
  }
  if(t==='pet_listings'||t==='equip_listings'){const src=t==='pet_listings'?listingsTable:itemListTable;return{select:()=>tq(src,{}),insert:row=>({select:()=>({single:async()=>{const r=ins(t,row,src);r.data.status='active';return r}})})}}
  return{select:()=>tq([],{})};
},
rpc:async(fn,args)=>{
  rpcCalls.push(fn);
  if(fn==='add_material'){const uid=session?session.user.id:'anon';const row=materialsTable.find(x=>x.user_id===uid&&x.name===args.p_name);if(row)row.quantity+=args.p_amount;else materialsTable.push({id:'mat-'+(++uidSeq),user_id:uid,name:args.p_name,quantity:args.p_amount});return{data:null,error:null}}
  if(fn==='spend_material'){const uid=session?session.user.id:'anon';const row=materialsTable.find(x=>x.user_id===uid&&x.name===args.p_name&&x.quantity>=args.p_amount);if(!row)return{data:false,error:null};row.quantity-=args.p_amount;return{data:true,error:null}}
  return{data:null,error:{message:'unknown'}}
}}}`;
vm.runInContext(STUB,ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/pet/pet_merge.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);
await C('(async()=>{const a=Pet.createPet("主宠A","🐱",6,100,20,10,8);a.level=60;Pet.addPet(a);const b=Pet.createPet("副宠B","🐶",8,100,20,10,8);b.level=60;Pet.addPet(b)})()');
const aId=C('Pet.getPets().find(p=>p.name==="主宠A").id');
const bId=C('Pet.getPets().find(p=>p.name==="副宠B").id');
await C('Game.onLogin("alice@test.com","123456")');await S(300);
await C('(async()=>{const a=Pet.getPets().find(p=>p.name==="主宠A");a.cloudId=(await Supabase.savePet(a)).data.id;const b=Pet.getPets().find(p=>p.name==="副宠B");b.cloudId=(await Supabase.savePet(b)).data.id})()');await S(200);
await C('Materials.gain("涅磐兽",1)');await S(150);
await C('Market.refresh()');
try{
  const r=await C('Merge.merge('+aId+','+bId+')');
  console.log('merge 返回:', JSON.stringify(r));
}catch(e){
  console.log('merge 抛出异常:', e && (e.stack || e.message || String(e)));
}
console.log('petsTable:', JSON.stringify(vm.runInContext('petsTable',ctx)));
console.log('materialsTable:', JSON.stringify(vm.runInContext('materialsTable',ctx)));
console.log('rpcCalls:', vm.runInContext('rpcCalls',ctx).join(','));
process.exit(0);
})().catch(e=>{console.error('OUTER',e);process.exit(1)});
