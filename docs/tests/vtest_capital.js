// vtest_capital.js —— 主城页（城寨全景 + 建筑热区）+ 内嵌 console（上下分栏）回归测试
// 覆盖：① 主城页渲染 API 存在 ② 城寨舞台 DOM 结构（底图 + 建筑热区容器）③ 建筑热区数量=6 且坐标合法
//      ④ console 双容器：日志进 history 且两个容器（抽屉+内嵌）都被更新
//      ⑤ 建筑热区渲染不依赖宠物/装备（空号也安全）
// 复用 vstub.js 桩；从 tests/ 目录运行（相对路径 ../js/）
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
// 扩展 el 桩：appendChild 记录子节点（检测建筑热区渲染），querySelectorAll 按 class 返回子节点
function el(inner){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector(sel){return this._q&&this._q[sel]||null},querySelectorAll(){return[]},children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0',offsetHeight:0,offsetWidth:0,getBoundingClientRect(){return{left:0,top:0,width:0,height:0}}}}
const els={};
// 给测试需要的两个内嵌 console 容器 + 抽屉 body 预置子节点（.chat-tabs / .chat-list / .chat-input-row）
function makeConsole(){const e=el();e._q={};e._q['.chat-tabs']=el();e._q['.chat-list']=el();e._q['.chat-input-row']=el();e._q['.chat-input']=el();e._q['.chat-send']=el();e._q['[data-console-input]']=el();e._q['[data-console-send]']=el();e._q['[data-console-expand]']=el();e.querySelectorAll=()=>[];return e}
els['chat-modal']=makeConsole();           // 抽屉 root（带 .chat-tabs/.chat-list/.chat-input-row）
els['capital-buildings']=el();             // 主城建筑热区容器
els['capital-stage']=el();                 // 主城舞台
els['capital-tip']=el();
els['btn-capital-return-map']=el();
els['btn-capital-rest']=el();
// document.querySelectorAll('.inline-console') → 返回两个内嵌容器（世界地图/战斗页各一）
const inlineConsoles=[makeConsole(),makeConsole()];
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelectorAll:sel=>sel==='.inline-console'?inlineConsoles:[],querySelector:()=>null,addEventListener(){},documentElement:{style:{setProperty(){}}}},els:els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/core/worldmap.js','../js/ui/ui-common.js','../js/ui/ui-console.js','../js/ui/ui-shell.js','../js/ui/ui-worldmap.js','../js/ui/ui-capital.js'])VTF.load(ctx,f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)};
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
// 模拟已登录（不依赖 main.js 的 Game 对象）：设置 session，supabase.js 走已登录分支
C('session={user:{id:"user-a",email:"cap@test.com"}}');
await C('(async()=>{await Supabase.init&&Supabase.init();})()').catch(()=>{});
await S(200);

/* ============ 1. 主城页渲染 API 存在且能安全渲染（无宠物/无装备） ============ */
A(typeof C('UI.renderCapitalPage')==='function','UI.renderCapitalPage 存在');
C('UI.renderCapitalPage()');
const bldgCount=C('els["capital-buildings"].children.length');
A(bldgCount===6,'建筑热区渲染 6 个（实际 '+bldgCount+'）');

/* ============ 2. 每个建筑热区坐标合法（0~100 百分比） ============ */
const coordsOk=C(`(()=>{
  const els2=els["capital-buildings"].children;
  return els2.every(el=>{
    const s=el.style;
    const x=parseFloat(s.left||'0'), y=parseFloat(s.top||'0');
    return isFinite(x)&&isFinite(y)&&x>=0&&x<=100&&y>=0&&y<=100;
  });
})()`);
A(coordsOk,'每个建筑热区坐标都是合法百分比（0~100）');

/* ============ 3. 建筑热区包含 6 个目标名称 ============ */
const namesOk=C(`(()=>{
  const names=['孵化','兽栏','鉴定','铸造','商会','任务中心'];
  const html=els["capital-buildings"].children.map(c=>c.innerHTML).join('');
  return names.every(n=>html.indexOf(n)>=0);
})()`);
A(namesOk,'6 个建筑名称齐全（孵化/兽栏/鉴定/铸造/商会/任务中心）');

/* ============ 3.5 建筑名字标签不带 emoji（暗黑水墨风，字符风格统一） ============ */
const noEmoji=C(`(()=>{
  const html=els["capital-buildings"].children.map(c=>c.innerHTML).join('');
  return !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html);
})()`);
A(noEmoji,'建筑热区标签不含 emoji（保持暗黑水墨风）');

/* ============ 4. console 双容器：一条日志 → 抽屉 + 两个内嵌容器列表都收到 ============ */
C('UI.consoleLog("social","💬 <b>我</b>：测试世界消息",{name:"我",self:true,text:"测试世界消息"})');
const drawerList=els['chat-modal']._q['.chat-list'].innerHTML;
A(drawerList.indexOf('测试世界消息')>=0,'抽屉消息流收到世界消息');
const inline0=inlineConsoles[0]._q['.chat-list'].innerHTML;
const inline1=inlineConsoles[1]._q['.chat-list'].innerHTML;
A(inline0.indexOf('测试世界消息')>=0,'内嵌 console（世界地图）收到同一份消息');
A(inline1.indexOf('测试世界消息')>=0,'内嵌 console（战斗页）收到同一份消息');

/* ============ 5. 频道 tab 渲染到所有容器（activeTab 单一来源） ============ */
const tabsHtml=inlineConsoles[0]._q['.chat-tabs'].innerHTML;
A(tabsHtml.indexOf('世界')>=0&&tabsHtml.indexOf('系统')>=0&&tabsHtml.indexOf('掉落')>=0,'内嵌 console 频道 tab 渲染完整');

/* ============ 6. 幂等性：重复调用 renderCapitalPage 不重复渲染（DOM 常驻） ============ */
C('UI.renderCapitalPage()');
C('UI.renderCapitalPage()');
A(C('els["capital-buildings"].children.length')===6,'renderCapitalPage 幂等：重复调用不重复加建筑热区');

console.log('ALL CAPITAL TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
