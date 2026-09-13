// vtest_materials.js —— 材料本地账的不变式（2026-09-14 用户报「用掉之后背包还留着 ×0 图标」）
// 守住的东西：local 里只许存「数量 > 0」的品种。
//   背景：云端 materials 表会留着 quantity=0 的空行（扣到 0 不删行），
//   而 setCloudMaterials 是以云端快照整体替换本地的入口 —— 旧写法会把 0 行原样收进来，
//   于是一个玩家早就用光的材料会在背包里永远留着一个「×0」的图标。
//   gain / spend / spendLocal 一直都是「到 0 就删键」，只漏了这个入口。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: { setProperty() { } }, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, dataset: {}, appendChild() { }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' } }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/core/materials.js']) VTF.load(ctx, f);
let failures = 0; const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };
const C = code => vm.runInContext(code, ctx);

/* ---- ① 云端 0 行不许进本地（这就是用户看到的 ×0 图标） ---- */
C(`Materials.setCloudMaterials([
  { name: '重铸石', quantity: 3 },
  { name: '鉴定石', quantity: 0 },
  { name: '腐印·暴怒', quantity: 0 }
])`);
const local1 = C('JSON.stringify(Materials.getLocal())');
A(local1 === JSON.stringify({ '重铸石': 3 }), '量 0 的云端行被丢掉（本地只留正数）：' + local1);
A(C(`Materials.getQuantity('鉴定石')`) === 0, '没有的品种 getQuantity 仍返回 0（调用方语义不变）');
A(C(`('鉴定石' in Materials.getLocal())`) === false, '量 0 的品种不再出现在本地账里（背包不会再画 ×0 图标）');

/* ---- ② 脏数据（负数 / null / 字符串数字）也不许污染本地 ---- */
C(`Materials.setCloudMaterials([
  { name: '重铸石', quantity: -2 },
  { name: '鉴定石', quantity: null },
  { name: '增缀石', quantity: '4' }
])`);
const local2 = C('JSON.stringify(Materials.getLocal())');
A(local2 === JSON.stringify({ '增缀石': 4 }), '负数与 null 被丢掉、字符串数字仍按数字收：' + local2);

/* ---- ③ 扣到 0 = 键消失（老行为，确认没被改坏） ---- */
C(`Materials.setCloudMaterials([{ name: '重铸石', quantity: 2 }])`);
C(`Materials.spendLocal('重铸石', 2)`);
A(C(`Materials.getQuantity('重铸石')`) === 0 && C(`('重铸石' in Materials.getLocal())`) === false, '扣到 0 时本地键被删掉');

/* ---- ④ 还没上报的掉落不许被云端快照吞掉（旧注释承诺的行为） ---- */
C(`Materials.setCloudMaterials([{ name: '鉴定石', quantity: 5 }])`);
C(`Materials.gain('剥离石', 2)`);
const withPending = C('JSON.stringify(Materials.getLocal())');
C(`Materials.setCloudMaterials([{ name: '鉴定石', quantity: 5 }])`);
A(C('JSON.stringify(Materials.getLocal())') === withPending, '刷新快照后未上报的掉落仍在（不会被误杀）');

console.log(failures ? 'MATERIALS TESTS FAILED: ' + failures : 'ALL MATERIALS TESTS PASSED');
process.exit(failures ? 1 : 0);
