/* 验证「·异变」宠也能觉醒传承魂铸 */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', id: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const C = code => vm.runInContext(code, ctx);
const A = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) process.exitCode = 1 };

C(`(function(){
  const p=Pet.createPet('霜魂兔皇·异变','🐰',15.1,300,80,40,50,'霜魂兔皇');
  p.level=100; p.rebornCount=1; p.growth=65;
  p.traits=[{id:'战意',tier:1}];
  Pet.addPet(p);
  globalThis.__p=p;
  return true;
})()`);

const aw = C('Pet.getAwakenState(globalThis.__p)');
A(aw !== null && aw !== undefined, `「霜魂鬼皇·异变」觉醒状态非空（${aw ? 'form=' + aw.form : 'null'}）`);
const skill = C(`Config.pet.evolution.skillOf(globalThis.__p.name)`);
A(!!skill && skill.name === '霜魂月刃', `变异宠继承本体技能 ${skill ? skill.name : 'null'}`);

const can = C(`(function(){
  const t=Config.soulCast.tiers.legend;
  const p=globalThis.__p;
  return (p.level>=t.minLevel) && (p.growth>=t.minGrowth) && (Pet.getAwakenState(p)!==null);
})()`);
A(can === true, '传承档解锁条件：Lv≥60 + 成长≥60 + 觉醒状态非空');

console.log('\n变异宠觉醒传承验证完成');
process.exit(process.exitCode || 0);