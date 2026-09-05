/* ============================================================
 * vtest_equip_persist.js —— 装备槽持久化（穿装备 → F5 → 还在身上）
 * 守的承诺：玩家穿上装备，刷新页面后装备必须还在宠物身上、且不在背包里重复出现。
 * 历史 bug：线上 pets 表缺 equipment 列，syncEquipToCloud 每次写入 42703 且错误被静默吞掉，
 *          玩家穿装备看着成功，F5 后全部回背包（2026-08-29 已加列 + 补错误上报）。
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
  '../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js', '../js/main.js']) VTF.load(ctx, f);
vm.runInContext('UI.initChat=function(){}', ctx); // 桩不支持 chat 查询链
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);

(async () => {
await S(200);
await C('(async()=>{return await Game.onLogin("alice@test.com","123456")})()');
await S(250);
await C(`(async()=>{
  const S0=Config.pet.starters[0];const B=Config.pet.legacyBase||{hp:100,atk:20,def:10};
  const pet=Pet.addPet(Pet.createPet(S0.name,S0.icon,S0.growth,S0.baseHp||B.hp,S0.baseAtk||B.atk,S0.baseDef||B.def,Config.pet.speeds[S0.name]||40,S0.name));
  Pet.setActive(pet.id);const u=await Supabase.getCurrentUser();
  if(u){const r=await Supabase.savePet(pet);if(r.data&&r.data.id){pet.cloudId=r.data.id;await Supabase.updatePet(pet.cloudId,{is_active:true})}}
  if(window.Game&&window.Game.startGameRuntime)window.Game.startGameRuntime();
})()`);
await S(250);
A(C('Pet.getActivePet() && !!Pet.getActivePet().cloudId') === true, '出战宠物已建档（有 cloudId）');

// —— 掉一件装备（确定性循环，直到背包有货）——
const inv0 = await C(`(async()=>{
  const area=Config.battle.areas[0];
  const e={name:"测试怪",rarity:"普通",level:5,tier:"common",rarityWeights:{white:70,blue:25,gold:5}};
  let guard=0;
  // 掉率已砍到 1.5%，兜底次数要够大，否则测试会随机扑空（不是产品 bug）
  while(Equipment.getInventory().length===0 && guard<3000){ await Drop.rollReward(e,area); guard++; }
  return Equipment.getInventory().length;
})()`);
A(inv0 > 0, `掉落装备已入库（背包 ${inv0} 件）`);

// —— 穿到身上 ——
const equipInfo = C(`(function(){
  const inv=Equipment.getInventory(); const p=Pet.getActivePet();
  const r=Equipment.equipItem(p, inv[0].id);
  return r && r.equipped ? {slot:r.equipped.slot, name:r.equipped.name, cloudId:r.equipped.cloudId, id:r.equipped.id} : null;
})()`);
A(!!equipInfo, `装备已穿上（${equipInfo && equipInfo.slot}：${equipInfo && equipInfo.name}）`);
A(!!(equipInfo && equipInfo.cloudId), '穿上的装备有 cloudId（否则刷新必然脱落）');

// —— 等防抖写入（syncEquipToCloud 300ms）——
await S(700);
const cloudEq = C(`(function(){
  const row=petsTable.find(p=>p.id===Pet.getActivePet().cloudId);
  return row && row.equipment ? row.equipment : null;
})()`);
A(!!cloudEq, '装备槽已写入云端 pets.equipment');
A(!!(cloudEq && cloudEq[equipInfo.slot] === equipInfo.cloudId),
  `云端槽位记录正确（${equipInfo.slot} → ${cloudEq && cloudEq[equipInfo.slot]}）`);

// —— 模拟 F5：重新拉宠物 + 重新拉背包 + 恢复装备槽 ——
await C('(async()=>{ await Game.refreshPets(); await Game.refreshItems(); await Game.restorePetEquipment(); })()');
await S(300);
const after = C(`(function(){
  const p=Pet.getActivePet();
  const eq=p.equipment && p.equipment['${equipInfo.slot}'];
  const inBag=Equipment.getInventory().some(e=>e.cloudId==='${equipInfo.cloudId}');
  return JSON.stringify({
    slots:Object.keys(p.equipment||{}).length,
    hasEq:!!eq, eqName:eq&&eq.name, eqCloudId:eq&&eq.cloudId, inBag
  });
})()`);
const r = JSON.parse(after);
A(r.slots === 12, `12 个装备槽结构完整（实际 ${r.slots}）`);
A(r.hasEq === true, `刷新后装备仍在身上（${r.eqName}）`);
A(r.eqCloudId === equipInfo.cloudId, '刷新后装备 cloudId 一致（是同一件）');
A(r.inBag === false, '装备没有同时留在背包里（无重复）');
console.log('ALL EQUIP PERSIST TESTS PASSED');
process.exit(0);
})();
