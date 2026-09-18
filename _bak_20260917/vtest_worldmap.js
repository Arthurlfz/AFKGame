// vtest_worldmap.js —— 世界地图页配置回归测试
// 覆盖：① 点位 areaId 都能在 Config.battle.areas 找到 ② 专属材料名正确
//      ③ 进化素材档位正确 ④ 金装概率是数值 ⑤ 主城配置存在
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs=require('fs'),vm=require('vm');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',offsetHeight:0,offsetWidth:0,getBoundingClientRect(){return{left:0,top:0,width:0,height:0}}}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},els:els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('../js/pet/enemy-data.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('../js/core/worldmap.js','utf8'),ctx);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const C=code=>vm.runInContext(code,ctx);

/* ============ 1. 点位 areaId 全部能找到对应图 ============ */
const W=C('window.WorldMap');
A(!!W,'WorldMap 对象已挂载');
const points=C('window.WorldMap.points');
const areaIds=C('Config.battle.areas.map(a=>a.id)');
// 2026-08-30 地图扩展：6 图 → 10 图。点位必须与 Config.battle.areas 一一对应
// （曾经漏改：config 加到 10 图但点位还是 6 个，新图在世界地图上根本不显示）
A(Array.isArray(points)&&points.length===areaIds.length,
  `野图点位数量与 Config.battle.areas 一致（点位 ${points.length} / 图 ${areaIds.length}）`);
let allAreaOk=true;
for(const p of points){ if(!areaIds.includes(p.areaId)){allAreaOk=false;console.error('  点位 '+p.name+' areaId='+p.areaId+' 找不到');} }
A(allAreaOk,'每个野图点位的 areaId 都能在 Config.battle.areas 中找到');

/* ============ 2. 专属材料名正确 ============ */
const matOk = C(`(()=>{const mat={};
  window.WorldMap.points.forEach(p=>{const pv=window.WorldMap.buildPreview(p);mat[p.areaId]=pv.mat});
  const expect=window.Config.drop.areaMaterials;
  return Object.keys(expect).every(id=>mat[id]===expect[id].name);})()`);
A(matOk,'每个点位专属材料名与 Config.drop.areaMaterials 一致');

/* ============ 3. 进化素材档位正确 ============ */
const evoOk = C(`(()=>{const evo={};
  window.WorldMap.points.forEach(p=>{const pv=window.WorldMap.buildPreview(p);evo[p.areaId]=pv.evoTiers});
  const expect=window.Config.drop.areaEvolutionTiers;
  return Object.keys(expect).every(id=>JSON.stringify(evo[id])===JSON.stringify(expect[id]));})()`);
A(evoOk,'每个点位进化素材档位与 Config.drop.areaEvolutionTiers 一致');

/* ============ 4. 金装概率是有效数值 ============ */
const goldOk = C(`window.WorldMap.points.every(p=>{const v=window.WorldMap.buildPreview(p).gold;return typeof v==='number'&&v>=0;})`);
A(goldOk,'每个点位金装概率都是非负数值');

/* ============ 5. 主城配置存在 ============ */
const cap=C('window.WorldMap.capital');
A(!!cap&&cap.type==='capital'&&cap.name,'主城配置存在且类型为 capital（'+cap.name+'）');

/* ============ 6. 信息卡能正确拼出（tipHTML 关键字段） ============ */
// 直接验证 buildPreview 输出的关键字段（专属材料名有值）
const firstMat=C('window.WorldMap.buildPreview(window.WorldMap.points[0]).mat');
A(typeof firstMat==='string'&&firstMat.length>0,'首个点位专属材料名非空（'+firstMat+'）');

/* ============ 7. 材料掉落分布（materialWeightsByTier）正确推导 ============ */
const distOk = C(`(()=>{
  const dist = window.Config.drop.materialWeightsByTier || {};
  const areas = window.Config.battle.areas;
  return window.WorldMap.points.every(p=>{
    const pv = window.WorldMap.buildPreview(p);
    const idx = areas.findIndex(a=>a.id===p.areaId);
    const tier = idx>=0 ? idx+1 : -1;
    const tbl = tier>0 ? dist[tier] : null;
    if(!tbl) return false;                          // 每个点位都应有分布
    if(!Array.isArray(pv.dropDist)) return false;
    if(pv.dropDist.length!==Object.keys(tbl).length) return false; // 行数=表键数
    const sum = pv.dropDist.reduce((s,d)=>s+d.pct,0);
    return Math.abs(sum-100)<=2;                    // 百分比之和≈100
  });
})()`);
A(distOk,'每个点位材料掉落分布由 materialWeightsByTier 正确推导（行数匹配、占比和≈100%）');

console.log('ALL WORLDMAP TESTS PASSED');process.exit(0);
