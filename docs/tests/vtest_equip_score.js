/* ============================================================
 * vtest_equip_score.js —— 装备评分 + 按评分清理
 * 守 2026-08-30「装备又多又乱」的根治方案：
 *  1. 评分能把 7 个维度压成一个可比较的数（金>蓝>白、T1>T5、稳定不抖动）
 *  2. 一键清理只清低于阈值的，并且保护「已锁定 / 在售 / 比身上穿得好的」
 *     （老的一键分解是清空全部可分解装备，玩家根本不敢点）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {},
    addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f }, querySelector: () => el(),
    querySelectorAll() { return this.children || [] }, children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', id: '' };
}
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder,
  AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket,
  navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
  session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.document.createDocumentFragment = () => el();
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/pet/enemy-data.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
  '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js',
  '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js',
  '../js/ui/ui-console.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js',
  '../js/ui/ui-market.js', '../js/main.js']) VTF.load(ctx, f);
vm.runInContext('UI.initChat=function(){}', ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);

// 造一件指定稀有度/图档/底材/部位的装备（slot 强制指定，便于同部位比较）
const mk = (rarity, areaTier, matTier, slot) => C(`(function(){
  const R=Config.equipment.rarities.find(r=>r.id==='${rarity}');
  const eq=Equipment.generateEquipment(R, ${areaTier}, ${matTier});
  eq.slot='${slot}'; return Equipment.addToInventory(eq), eq.id;
})()`);

(async () => {
await S(200);
await C('(async()=>{return await Game.onLogin("alice@test.com","123456")})()');
await S(250);
await C(`(async()=>{
  const S0=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};
  const pet=Pet.addPet(Pet.createPet(S0.name,S0.icon,S0.growth,S0.baseHp||B.hp,S0.baseAtk||B.atk,S0.baseDef||B.def,Config.pet.speeds[S0.name]||40,S0.name));
  Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();
  if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}
})()`);
await S(250);

/* ---------- 1. 评分分层：金 > 蓝 > 白，T1 > T5 ---------- */
const avg = (rarity) => C(`(function(){
  const R=Config.equipment.rarities.find(r=>r.id==='${rarity}');let s=0;
  for(let i=0;i<300;i++){const eq=Equipment.generateEquipment(R,4,3);eq.slot='武器';s+=Equipment.scoreOf(eq);}
  return Math.round(s/300);
})()`);
const sw = avg('white'), sb = avg('blue'), sg = avg('gold');
console.log(`  平均评分（图4/T3底材/武器）：白 ${sw} < 蓝 ${sb} < 金 ${sg}`);
A(sw < sb && sb < sg, '评分能区分稀有度（金 > 蓝 > 白）');

const t1Score = C(`(function(){
  const eq=Equipment.generateEquipment(Config.equipment.rarities[0],4,3);
  eq.slot='武器';
  eq.affixes={prefix:[{type:'atk',label:'攻击',tier:1,value:8}],suffix:[]};
  return Equipment.scoreOf(eq);
})()`);
const t5Score = C(`(function(){
  const eq=Equipment.generateEquipment(Config.equipment.rarities[0],4,3);
  eq.slot='武器';
  eq.affixes={prefix:[{type:'atk',label:'攻击',tier:5,value:1}],suffix:[]};
  return Equipment.scoreOf(eq);
})()`);
A(t1Score > t5Score, `T1 词缀评分高于 T5（${t1Score} > ${t5Score}）`);

const stable = C(`(function(){
  const eq=Equipment.generateEquipment(Config.equipment.rarities[2],5,2);
  const a=Equipment.scoreOf(eq),b=Equipment.scoreOf(eq);
  return a===b;
})()`);
A(stable === true, '同一件装备评分稳定（不会每次调用都变）');

/* ---------- 2. 按阈值清理：只清低于阈值的 ---------- */
// 手工构造装备（基底固定 atk100，词缀分数可控）→ 分数梯度确定，避免"跨部位不可比"干扰测试
C('(function(){Equipment.replaceInventory([]);})()');
const put = (slot, atkPct) => C(`(function(){
  const eq=Equipment.generateEquipment(Config.equipment.rarities[2],4,3);
  eq.slot='${slot}'; eq.baseStats={atk:100};
  eq.affixes={prefix:[{type:'atk',label:'攻击',tier:1,value:${atkPct}}],suffix:[]};
  Equipment.addToInventory(eq);
  return Equipment.scoreOf(eq);
})()`);
const sLow = put('武器', 2);   // 100 + 2*5  = 110
const sMid = put('靴子', 5);   // 100 + 5*5  = 125
const sHigh = put('头盔', 8);  // 100 + 8*5  = 140
console.log(`  三件装备评分：武器 ${sLow} / 靴子 ${sMid} / 头盔 ${sHigh}`);
A(sLow < sMid && sMid < sHigh, '评分随词缀数值单调递增（可用于排序）');

const midThreshold = sMid;
const picked = JSON.parse(C(`(function(){return JSON.stringify(Salvage.belowThreshold(${midThreshold}).map(e=>e.slot))})()`));
console.log(`  阈值 ${midThreshold} → 选中`, JSON.stringify(picked));
A(picked.indexOf('武器') >= 0, '低于阈值的装备被选中清理');
A(picked.indexOf('头盔') < 0, '高于阈值的装备被保留');

/* ---------- 3. 保护规则 ---------- */
// 3a 已锁定
C(`(function(){const e=Equipment.getInventory().find(x=>x.slot==='武器');e.locked=true;})()`);
const afterLock = JSON.parse(C(`(function(){return JSON.stringify(Salvage.belowThreshold(${midThreshold}).map(e=>e.slot))})()`));
A(afterLock.indexOf('武器') < 0, '已锁定的装备不被清理');
C(`(function(){const e=Equipment.getInventory().find(x=>x.slot==='武器');e.locked=false;})()`);

// 3b 比身上穿得好的要留下（同部位，分数高于已穿）
C(`(function(){
  const pet=Pet.getActivePet();
  const boots=Equipment.getInventory().find(e=>e.slot==='靴子');
  Equipment.equipItem(pet, boots.id);   // 靴子穿到身上（125 分）
})()`);
const betterScore = put('靴子', 20); // 同部位、200 分（远高于身上的 125）
const protect = JSON.parse(C(`(function(){
  const pet=Pet.getActivePet();
  const worn=pet.equipment['靴子'];
  return JSON.stringify({wornScore:Equipment.scoreOf(worn),
    picked:Salvage.belowThreshold(99999).map(e=>e.slot)});
})()`));
console.log(`  身上靴子 ${protect.wornScore} 分，背包同部位 ${betterScore} 分（更高）`);
A(protect.picked.indexOf('靴子') < 0, '比身上穿得好的同部位装备被保护（阈值拉满也不清）');
A(protect.picked.indexOf('武器') >= 0, '比身上差的仍会被清理');

/* ---------- 4. 执行清理 ---------- */
const res = await C(`(async()=>{ return JSON.stringify(await Salvage.salvageBelow(${midThreshold})); })()`);
const r = JSON.parse(res);
console.log('  清理结果：', JSON.stringify(r));
A(r.ok !== false || !r.error, `按阈值清理可执行（${r.error || r.count + ' 件'}）`);
if (r.ok) A(r.count >= 1, `确实清理了装备（${r.count} 件）`);

console.log('ALL EQUIP SCORE TESTS PASSED');
process.exit(0);
})();
