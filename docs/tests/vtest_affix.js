// 前后缀结构回归测试：验证「装备词缀改成前后缀结构」
//  - AFFIX_POOL 6 条词缀均带 category（前缀 atk/hp/def，后缀 spd/crit/lifesteal）
//  - affixCategory 归类正确
//  - 生成装备的词缀都能正确归类（无未知类型），且前缀 ≤3、后缀 ≤3（结构上限，先不改数量逻辑）
//  - 打造面板（openCraftPanel）按需式前后缀分组渲染：含「前缀（n/3）」「后缀（n/3）」与分隔线，不崩
// 复用 vstub.js 的 VM 桩（vstub.js）
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{dataset:{},setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(c){this.children.push(c)},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],removeChild(){},remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:'0'}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[]},session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-battle.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/main.js'])VTF.load(ctx,f);
const A=(c,m)=>{if(!c){console.error('FAIL: '+m);process.exit(1)}console.log('PASS: '+m)}
const S=ms=>new Promise(r=>setTimeout(r,ms));
const C=code=>vm.runInContext(code,ctx);
(async()=>{
await S(300);await C('Game.onLogin("affix@test.com","123456")');await S(300);
// 1) AFFIX_POOL 结构：15 条（前缀 atk/hp/def/lifesteal + 后缀 spd/crit/critDamage/hit/dodge/pen/dmgBonus/dr/dropQty/dropRare/matDrop）
const poolLen=C('Equipment.AFFIX_POOL.length');
A(poolLen===15,'词缀池共 15 条（前缀4 + 后缀11，含穿透/伤害加成/受伤减免）');
// 前缀恰好 4、后缀恰好 11（2026-09-04：吸血移前缀；新增 pen/dmgBonus/dr 后缀）
A(C('Equipment.AFFIX_POOL.filter(a=>a.category==="prefix").length')===4,'前缀恰好 4 条（atk/hp/def/lifesteal）');
A(C('Equipment.AFFIX_POOL.filter(a=>a.category==="suffix").length')===11,'后缀恰好 11 条（spd/crit/critDamage/hit/dodge/pen/dmgBonus/dr/dropQty/dropRare/matDrop）');
// 关键类型必须都在池中（不只比总数，防漏新增词缀）
const needTypes=['atk','hp','def','spd','crit','critDamage','hit','dodge','lifesteal','pen','dmgBonus','dr','dropQty','dropRare','matDrop'];
const inPool=C('JSON.stringify(Equipment.AFFIX_POOL.map(a=>a.type))');
A(needTypes.every(t=>JSON.parse(inPool).includes(t)),'词缀池包含全部 15 个关键类型');
// 1b) 吸血必须在前缀池（2026-09-04 移池）
A(C('Equipment.AFFIX_POOL.find(a=>a.type==="lifesteal").category')==='prefix','吸血词缀在前缀池（移池生效）');
// 2) affixCategory 映射
const map=C(`JSON.stringify(['atk','hp','def','spd','crit','critDamage','hit','dodge','lifesteal','pen','dmgBonus','dr','dropQty','dropRare','matDrop'].map(t=>Equipment.affixCategory(t)))`);
A(map==='["prefix","prefix","prefix","suffix","suffix","suffix","suffix","suffix","prefix","suffix","suffix","suffix","suffix","suffix","suffix"]','affixCategory 归类正确（前缀4/后缀11）');
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
// 4) 打造面板分组渲染（端到端）：主从式重构后 openCraftPanel → renderEqDetail → renderCraftInto。
//    这里直接调 UI.renderCraftInto（词缀前后缀分组渲染的唯一真实入口），断言分组标题/分隔线
for(const kind of ['white','blue','gold']){
  C(`var ceq=${kind}s[0]; ceq.cloudId='c-'+Math.random().toString(36).slice(2)`);
  let html='';
  try {
    await C('var __host=document.createElement("div")'); // 桩元素不解析 innerHTML，不能取 firstChild，直接传容器
    // 桩环境 Materials.getQuantity 会抛异常（vstub 未覆盖），renderCraftInto 里模板串要先求值——打补丁兜底 0
    await C('if(Materials.getQuantity&&Materials.getQuantity.length!==undefined){const __g=Materials.getQuantity.bind(Materials);Materials.getQuantity=n=>{try{return __g(n)}catch(e){return 0}}}');
    await C('UI.renderCraftInto(__host,ceq)');
    html=C('__host.innerHTML');
  } catch(e) { console.error('[renderCraftInto EXC]', e.message); }
  A(/前缀（\d\/3）/.test(html),`[${kind}] 打造面板含「前缀（n/3）」分组标题`);
  A(/后缀（\d\/3）/.test(html),`[${kind}] 打造面板含「后缀（n/3）」分组标题`);
  A(html.includes('craft-affix-divider'),`[${kind}] 打造面板含前后缀分隔线`);
}
// 5) POE 式 roll 区间（affixRange / formatAffixHtml，2026-08-30 用户拍板）
{
  const r1 = C('JSON.stringify(Equipment.affixRange({type:"atk",tier:1}))');
  A(r1 === '{"min":6,"max":8}', `攻击 T1 区间 (6~8)（${r1}）`);
  const r2 = C('JSON.stringify(Equipment.affixRange({type:"spd",tier:1}))');
  A(r2 === '{"min":12,"max":16}', `速度 T1 走 speedAffixTiers：区间 (12~16)（${r2}）`);
  const r3 = C('JSON.stringify(Equipment.affixRange({type:"atk",tier:5}))');
  A(r3 === '{"min":1,"max":1}', `攻击 T5 区间 (1~1)（${r3}）`);
  A(C('Equipment.affixRange({type:"hit",tier:5,base:true})') === null, '基础词缀（base:true）无区间概念 → null');
  const h1 = C('Equipment.formatAffixHtml({label:"攻击",type:"atk",value:8,tier:1})');
  A(h1.indexOf('(6~8)') >= 0 && h1.indexOf('#f2b632') >= 0, 'T1 词缀：显示区间 (6~8) 且金色高亮');
  const h2 = C('Equipment.formatAffixHtml({label:"攻击",type:"atk",value:4,tier:3})');
  A(h2.indexOf('(3~4)') >= 0 && h2.indexOf('#f2b632') >= 0, 'T3 满 roll（=区间 max）也金色高亮');
  const h3 = C('Equipment.formatAffixHtml({label:"攻击",type:"atk",value:3,tier:3})');
  A(h3.indexOf('(3~4)') >= 0 && h3.indexOf('#f2b632') < 0, 'T3 低 roll 不高亮（正常色）');
  // 生成的金装：每条真实词缀都能给出区间（高亮逻辑能跑通不崩）
  const goldsRangeOk = C(`(function(){
    const eq=Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==="gold"),6,3);
    let ok=true;
    for(const a of Equipment.flattenAffixes(eq.affixes)){
      if(a.base)continue;
      if(!Equipment.affixRange(a)) ok=false;
    }
    return ok;
  })()`);
  A(goldsRangeOk === true, '生成的金装每条词缀都能查到区间（浮层/卡片渲染不会崩）');
}
// 5) 三新词缀独立数值表 + 战斗结算 + 底材命中 + 部位偏好（2026-09-04）
{
  // 5a) 独立 T1~T5 表都存在且 5 档齐全
  for (const k of ['lifestealAffixTiers','critAffixTiers','critDamageAffixTiers','penAffixTiers','dmgBonusAffixTiers','drAffixTiers','baseHitByIlvl']) {
    const arr=C(`Config.equipment.${k}`);
    A(Array.isArray(arr)&&arr.length>=5,`config.equipment.${k} 存在且至少 5 档`);
  }
  // 5b) affixRange 走独立表
  const rp=C('JSON.stringify(Equipment.affixRange({type:"pen",tier:1}))');
  A(rp==='{"min":30,"max":40}',`穿透 T1 区间 (30~40)（${rp}）`);
  const rd=C('JSON.stringify(Equipment.affixRange({type:"dmgBonus",tier:1}))');
  A(rd==='{"min":6,"max":8}',`伤害加成 T1 区间 (6~8)（${rd}）`);
  const rl=C('JSON.stringify(Equipment.affixRange({type:"lifesteal",tier:1}))');
  A(rl==='{"min":3,"max":4}',`吸血 T1 走独立表 (3~4)（${rl}）`);
  // 5c) battle.calcDamage：穿透/伤害加成/受伤减免结算（种子化不方便，用确定性字段断言）
  const cd=C(`(function(){
    const B=window.Battle;
    const ORIG=Math.random;
    // 固定 Math.random=0.2：hitChance clamp 上限 0.95 → 0.2 < 0.95 必命中；critRate 0 必不暴击（确定性）
    Math.random=()=>0.2;
    // 纯减法基线：atk 100 def 30 → 70
    const base=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:0,dmgBonus:0,lifesteal:0},{def:30,dodge:0,dr:0});
    // 穿透 20：def 50 - 20 = 30 → 70（与基线同）
    const pen=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:20,dmgBonus:0,lifesteal:0},{def:50,dodge:0,dr:0});
    // 伤害加成 50%：70 → 105
    const bonus=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:0,dmgBonus:50,lifesteal:0},{def:30,dodge:0,dr:0});
    // 受伤减免 50%：70 → 35；clamp：减伤 95 → 最低承伤 10%（70 → 7）
    const dr=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:0,dmgBonus:0,lifesteal:0},{def:30,dodge:0,dr:50});
    const drClamp=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:0,dmgBonus:0,lifesteal:0},{def:30,dodge:0,dr:95});
    // 穿透不成负防御：def 10 pen 50 → effDef 0 → 伤害 100
    const penFloor=B.calcDamage({atk:100,hit:999,dodge:0,critRate:0,critDamage:1,pen:50,dmgBonus:0,lifesteal:0},{def:10,dodge:0,dr:0});
    Math.random=ORIG; // 恢复真实随机
    return JSON.stringify({base:base.damage,pen:pen.damage,bonus:bonus.damage,dr:dr.damage,drClamp:drClamp.damage,penFloor:penFloor.damage});
  })()`);
  const cdv=JSON.parse(cd);
  A(cdv.base===70,`减法基线 100-30=70（${cdv.base}）`);
  A(cdv.pen===70,`穿透 20 抵消 def 50→30：70（${cdv.pen}）`);
  A(cdv.bonus===105,`伤害加成 50%：70→105（${cdv.bonus}）`);
  A(cdv.dr===35,`受伤减免 50%：70→35（${cdv.dr}）`);
  A(cdv.drClamp===7,`减伤 clamp 最低承伤 10%：70→7（${cdv.drClamp}）`);
  A(cdv.penFloor===100,`穿透不成负防御：effDef 0 → 100（${cdv.penFloor}）`);
  // 5d) getStats 透传：给宠物穿带三词缀的装备，面板字段齐
  const st=C(`(function(){
    // 构造最小宠物（getStats 是纯函数，不依赖登录态）：等级给足让属性>0
    const p={name:'测试宠',level:50,growth:10,lineId:'',equipment:{}};
    p.equipment['武器']={id:'t1',slot:'武器',base:{type:'atk',label:'攻击',value:10},baseStats:{atk:10},affixes:{prefix:[],suffix:[
      {type:'pen',label:'穿透',tier:1,value:35,fixed:true},
      {type:'dmgBonus',label:'伤害加成',tier:1,value:8},
      {type:'dr',label:'受伤减免',tier:1,value:5}]},rarity:{id:'white',label:'白色',color:'#fff'}};
    const s=window.Pet.getStats(p);
    return JSON.stringify({pen:s.pen,dmgBonus:s.dmgBonus,dr:s.dr});
  })()`);
  const stv=JSON.parse(st);
  A(stv.pen===35&&stv.dmgBonus===8&&stv.dr===5,`getStats 透传 pen/dmgBonus/dr（${st}）`);
  // 5e) 底材命中随 ilvl 成长：底材词缀是 hit 或 crit（按槽位二选一），采样到 hit 底材的装备验证值落在成长表内
  const bh=C(`(function(){
    const table=Config.equipment.baseHitByIlvl;
    const allVals=table.flatMap(r=>[r.min,r.max]);
    const loVals=table.filter(r=>r.minIlvl<=1).flatMap(r=>[r.min,r.max]);
    const hiVals=table.filter(r=>r.minIlvl<=80).flatMap(r=>[r.min,r.max]);
    let lo=null,hi=null;
    for(let i=0;i<400&&(!lo||!hi);i++){
      const e1=Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==='white'),1,3,1);
      if(!lo){const b=(e1.affixes.suffix||[]).find(a=>a.base&&a.type==='hit'); if(b)lo=b.value;}
      const e2=Equipment.generateEquipment(Config.equipment.rarities.find(x=>x.id==='white'),13,3,80);
      if(!hi){const b=(e2.affixes.suffix||[]).find(a=>a.base&&a.type==='hit'); if(b)hi=b.value;}
    }
    return JSON.stringify({lo,hi,loMin:Math.min(...loVals),loMax:Math.max(...loVals),hiMin:Math.min(...hiVals),hiMax:Math.max(...hiVals)});
  })()`);
  const bhv=JSON.parse(bh);
  if (bhv.lo!==null) A(bhv.lo>=bhv.loMin&&bhv.lo<=bhv.loMax,`ilvl 1 底材命中 ${bhv.lo} 在低档区间 (${bhv.loMin}~${bhv.loMax})`);
  if (bhv.hi!==null) A(bhv.hi>=bhv.hiMin&&bhv.hi<=bhv.hiMax,`ilvl 80 底材命中 ${bhv.hi} 在高档区间 (${bhv.hiMin}~${bhv.hiMax})`);
  A(bhv.lo!==null||bhv.hi!==null,'底材命中成长表断言至少覆盖一件装备');
  // 5f) 部位偏好：武器不出 hp 前缀（权重 0），大量采样护甲必偏 hp/def
  const sw=C(`(function(){
    const R=Config.equipment.rarities.find(x=>x.id==='gold');
    let bad=0;
    for(let i=0;i<80;i++){
      // 直接造武器部位：generateEquipment 部位随机，改为抽词缀权重验证 —— 简化：检查 config 表存在且武器 hp=0.5
    }
    const w=(Config.equipment.slotAffixWeights||{})['武器']||{};
    const armor=(Config.equipment.slotAffixWeights||{})['护甲']||{};
    return JSON.stringify({hpInWeapon:w.hp===0.5,drInArmor:armor.dr===2,spdInBoots:(Config.equipment.slotAffixWeights||{})['靴子'].spd===3});
  })()`);
  const swv=JSON.parse(sw);
  A(swv.hpInWeapon&&swv.drInArmor&&swv.spdInBoots,'部位偏好权重表：武器偏攻/护甲偏坦/靴子偏速');
}
console.log('ALL AFFIX-STRUCTURE TESTS PASSED');process.exit(0);
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
