// vtest_salvage_safe.js —— 分解安全：**穿在宠物身上的装备绝不能被分解**（2026-09-14 用户报，已复现）
// 旧写法的两个洞：
//   ① 保护只查「当前出战宠」的那一个槽位，其它宠物一概不管；
//   ② 「批量分解」那条路（Salvage.isSalvageable）压根不看宠物槽。
// 只要出现「宠物槽里有引用、背包里也还有本体」的形态（云端装备槽读取异常 / 多宠引用同一件），
// 身上穿的装备就会被分解掉 = 资产损失。
// 现在保护收在 isSalvageable 这一个判定点上，两条路自动都受保护。
// ⚠️ 同时反向守住「别把清理功能堵死」：该分解的还是要分解。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() { } }, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, dataset: {}, appendChild() { }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' } }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/market.js', '../js/equipment/salvage.js']) VTF.load(ctx, f);
let failures = 0; const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };
const C = code => vm.runInContext(code, ctx);

/* 备好两只宠物 + 一件装备（部位随机，所以槽名动态取） */
C(`globalThis.__a = Pet.createPet('腐噜兽','A',10,100,20,10,8); Pet.addPet(globalThis.__a);
   globalThis.__b = Pet.createPet('血狐','B',10,100,20,10,8); Pet.addPet(globalThis.__b);
   globalThis.__w = Equipment.generateEquipment(null,10,0,80); Equipment.addToInventory(globalThis.__w);
   globalThis.__slot = globalThis.__w.slot;`);
C(`Equipment.equipItem(globalThis.__a, globalThis.__w.id); Pet.setActive(globalThis.__b.id);`);

/* ---- ① 正常流程：穿上的装备离开背包，扫不到 ---- */
A(C('Equipment.getInventory().some(e=>e.id===globalThis.__w.id)') === false, '穿上后装备已离开背包');
A(C('Salvage.belowThreshold(99999).some(e=>e.id===globalThis.__w.id)') === false, '一键清理不会碰它（正常流程）');

/* ---- ② 危险形态：槽里引用 + 背包里还有同一件 → 必须仍然被挡住（这就是用户踩到的那种） ---- */
C(`Equipment.addToInventory(globalThis.__w);`);
A(C('globalThis.__a.equipment[globalThis.__slot] === globalThis.__w') === true, '构造出「既在背包又在宠物身上」的形态');
A(C('Salvage.isWorn(globalThis.__w)') === true, 'isWorn 认得出它穿在身上');
A(C('Salvage.isSalvageable(globalThis.__w)') === false, '批量分解的判定不再认它（旧写法这里返回 true = 会被分解）');
A(C('Salvage.belowThreshold(99999).some(e=>e.id===globalThis.__w.id)') === false, '一键清理也不认它');

/* ---- ③ 非出战宠身上的也要保护（旧写法只查 getActivePet） ---- */
A(C('Pet.getActivePet().id') === C('globalThis.__b.id'), '当前出战是 B（A 不是出战）');
A(C('Salvage.isWorn(globalThis.__w)') === true, 'A 不是出战宠，但它身上的装备同样算「穿着」');

/* ---- ④ 反向：该分解的必须还能分解（别把清理功能堵死） ---- */
C(`globalThis.__junk = Equipment.generateEquipment(null,1,0,1); Equipment.addToInventory(globalThis.__junk);`);
A(C('Salvage.isSalvageable(globalThis.__junk)') === true, '没穿的装备仍然可分解（清理功能没被堵死）');
A(C('Salvage.belowThreshold(99999).some(e=>e.id===globalThis.__junk.id)') === true, '没穿的低档装备仍会被一键清理扫到');

/* ---- ⑤ 锁定 / 在售的老保护没被改坏 ---- */
C(`globalThis.__junk.locked = true;`);
A(C('Salvage.isSalvageable(globalThis.__junk)') === false, '锁定装备依旧不可分解');

console.log(failures ? 'SALVAGE SAFE TESTS FAILED: ' + failures : 'ALL SALVAGE SAFE TESTS PASSED');
process.exit(failures ? 1 : 0);
