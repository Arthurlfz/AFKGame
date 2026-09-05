// vtest_ui.js —— 本轮 UI 修复回归测试
// 覆盖：① 宠物升级后血量回满 ② 上架表单聚焦保护（下拉打开期间不被 renderAll 重建弹回）
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},els:els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for (const f of VTF.FILES) VTF.load(ctx, f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("ui@test.com","123456")');await S(300);

/* ============ 1. 宠物升级后血量回满 ============ */
// 用真实配置构造血狐（growth=5, baseHp=85, statCoeff.hp 从 config 取，不写死 → 调数值不用改测试）
// 打残血后一次性给大量经验升到 5 级 → 满血上限提高，curHp 应回满到新上限
await C('(async()=>{const p=Pet.createPet("血狐","🦊",5,85,30,8,110);p.curHp=30;Pet.addPet(p);Pet.setActive(p.id);globalThis.__p=p.id})()');
const FOX_HP=C('(Config.pet.starters.find(s=>s.name==="血狐")||{}).statCoeff.hp');
const hpMax=n=>Math.round(85+n*5*FOX_HP); // 与 pet.js baseStats 同公式（含取整）
const beforeMax=C('Pet.getStats(Pet.getPets().find(p=>p.id===globalThis.__p)).hp');
A(beforeMax===hpMax(1),`1级满血上限 hp=85+1×5×${FOX_HP}=${hpMax(1)} 计算正确（实际 ${beforeMax}）`);
const info=C('Pet.grantExp(Pet.getPets().find(p=>p.id===globalThis.__p),5000)');
A(info.leveled===true&&info.newLevel>=5,'一次性大量经验触发升级（Lv.'+info.newLevel+'）');
const afterMax=C('Pet.getStats(Pet.getPets().find(p=>p.id===globalThis.__p)).hp');
const afterCur=C('Pet.getPets().find(p=>p.id===globalThis.__p).curHp');
A(afterCur===afterMax,'升级后血量回满：curHp('+afterCur+') === 新上限('+afterMax+')');
const expMax = hpMax(info.newLevel);
A(afterMax===expMax&&afterMax>beforeMax,'升级后上限按公式正确（'+beforeMax+' → '+afterMax+'，=85+'+info.newLevel+'×5×3='+expMax+'）');
// 未升级不强制回满（保持原血量，避免打断回血状态）
// 先正常 addPet（满血），再手动设残血模拟战斗受伤，给少量经验（不升级）→ curHp 应保持不被动
await C('(async()=>{const q=Pet.createPet("骨狼","🐺",5,105,25,10,40);Pet.addPet(q);q.curHp=40;globalThis.__q=q.id})()');
C('Pet.grantExp(Pet.getPets().find(p=>p.id===globalThis.__q),1)');
A(C('Pet.getPets().find(p=>p.id===globalThis.__q).curHp')===40,'未升级时血量不动（保持 40）');

/* ============ 2. 上架表单聚焦保护：下拉/输入聚焦期间 renderAll 不重建 ============ */
// 先确保有可上架宠物（云端建档）
await C('(async()=>{const p=Pet.getPets().find(p=>p.id===globalThis.__p);p.cloudId=(await Supabase.savePet(p)).data.id})()');await S(100);
C('UI.renderAll()'); // 正常渲染（无聚焦）
const sellBox=C('els["market-sell"]');
A(sellBox.children.length>0,'renderSellArea 正常渲染（含宠物上架行）');
// 模拟「材料下拉打开中」：activeElement 是 .sell-form 内的 select
C('document.activeElement={tagName:"SELECT",closest:function(){return {}}}');
sellBox.innerHTML='<marker>保留</marker>'; // 放入标记
C('UI.renderAll()'); // 聚焦保护应跳过重建
A(sellBox.innerHTML==='<marker>保留</marker>','聚焦保护：select 打开期间 renderAll 跳过重建（下拉不会被弹回）');
// 取消聚焦 → 恢复正常重建
C('document.activeElement=null');
C('UI.renderAll()');
A(sellBox.innerHTML!=='<marker>保留</marker>'&&sellBox.children.length>0,'取消聚焦后恢复重建');

/* ============ 3. 脱下装备按钮（renderEquipSlots 不崩 + 逻辑接口存在） ============ */
C('UI.renderAll()'); // 宠物页装备槽渲染不崩
A(typeof C('Equipment.unequip')==='function','脱下接口 Equipment.unequip 存在');

/* ============ 4. 服务器托管挂机：画面怪 = 服务器打的那只（前后端不匹配回归） ============ */
// 4.1 scaleEnemyOf 必须用剧本传入的战斗等级，不能被怪的静态 level 顶掉
//     （enemy-data 每只怪自带静态 level，用它缩放 → 画面等级/血量与真账错位）
C(`(function(){
  Battle.selectArea(Battle.getAreas()[0].id);
  globalThis.__raw = EnemyData.list[0];
  globalThis.__byScript = Battle.scaleEnemyOf(globalThis.__raw, 1);
  globalThis.__byStatic = Battle.scaleEnemyOf(globalThis.__raw);
})()`);
A(C('globalThis.__byScript.level')===1,'scaleEnemyOf 传入剧本等级 1 → 画面怪等级=1（不被静态 level 覆盖）');
A(C('globalThis.__byStatic.level')===C('globalThis.__raw.level'),'不传等级时回退怪的静态 level（保底不崩）');
A(C('globalThis.__byScript.hp')<C('globalThis.__byStatic.hp'),
  '等级真的进了缩放公式（Lv1 血 '+C('globalThis.__byScript.hp')+' < 静态 Lv'+C('globalThis.__raw.level')+' 血 '+C('globalThis.__byStatic.hp')+'）');

// 4.2 托管时 UI 的敌方数据源回退到 IdleBridge.getShowEnemy
//     （Battle.state.enemy 在托管模式下恒 null → tooltip/名字/血量同步全是空）
C('globalThis.__origIsActive = IdleBridge.isActive;');
C('IdleBridge.isActive = function(){ return true; }');
C('globalThis.__showEnemy = { name:"演出怪", level:50, maxHp:999, hp:999, enemyType:"mutant" }; IdleBridge.getShowEnemy = function(){ return globalThis.__showEnemy; }');
C('UI.updateBars(500, 1000, 333, 999)');
A(C('globalThis.__showEnemy.hp')===333,'托管时 updateBars 读到演出怪（血写回 333，证明不是 null）');
A(C('typeof IdleBridge.getShowEnemy')==='function','IdleBridge.getShowEnemy 已导出（UI 回退入口存在）');
C('IdleBridge.isActive = globalThis.__origIsActive;'); // 还原，避免影响后续

// 4.3 累计场数：托管时顶栏统计必须读服务器累计（本地 Battle 计数在托管时不涨）
C('globalThis.__origIsActive2 = IdleBridge.isActive; globalThis.__origTotal = IdleBridge.getTotalFights;');
C('IdleBridge.isActive = function(){ return true; }; IdleBridge.getTotalFights = function(){ return 7777; }');
C('Game.refreshStats()');
A(C('els["stat-fights"] && els["stat-fights"].textContent')==='7777','托管时顶栏累计场数取服务器值 7777（不再是停滞的本地计数）');
C('IdleBridge.isActive = globalThis.__origIsActive2; IdleBridge.getTotalFights = globalThis.__origTotal;');

console.log('ALL UI TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
