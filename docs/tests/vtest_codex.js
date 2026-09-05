// 百科页回归测试：验证页面可渲染、数值与 Config 一致、内容为百科而非攻略
//  - 静态：PAGES 含 codex、侧边栏按钮、页面骨架、脚本引入
//  - 运行时：UI.renderCodex 不抛错，渲染出 8 个目录项与 8 个卡片
//  - 数值：等级上限 / speedScale / 税率 / 基宠名 / 部位数 均取自 Config 与 Equipment
//  - 内容定性：不含账号、市场假人、攻略板块，且无 em-dash
// 复用 vstub.js 的 VM 桩（vstub.js）
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() { }, remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-codex.js', '../js/main.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

/* ---------- 静态检查 ---------- */
const shell = fs.readFileSync('../js/ui/ui-shell.js', 'utf8');
A(/PAGES\s*=\s*new Set\(\[[^\]]*'codex'/.test(shell), 'ui-shell.js 的 PAGES 集合已包含 codex（否则页面打不开）');
const html = fs.readFileSync('../游戏.html', 'utf8');
A(/data-page="codex"/.test(html), '侧边栏按钮带 data-page="codex"（否则点击无响应）');
A(/id="tab-codex"/.test(html), '页面骨架存在 #tab-codex');
A(/ui-codex\.js\?v=\d/.test(html), '已引入 ui-codex.js 且带版本号');
const css = fs.readFileSync('../css/game.css', 'utf8');
A(/#tab-codex \.codex-body/.test(css), 'game.css 已新增 #tab-codex 样式段');

/* ---------- 渲染 ---------- */
C('UI.renderCodex()');
const nav = C('document.getElementById("codex-nav").innerHTML');
const content = C('document.getElementById("codex-content").innerHTML');
A((nav.match(/codex-nav-btn/g) || []).length === 8, '目录渲染出 8 个板块按钮');
A((content.match(/codex-card/g) || []).length === 8, '内容区渲染出 8 个词条卡片');
A(C('UI.codexEntries.length') === 8, '词条清单共 8 个板块');

/* ---------- 数值与 Config 一致（防写死第二份数值） ---------- */
const maxLv = C('Config.pet.maxLevel');
A(content.indexOf('等级上限 ' + maxLv) !== -1, '宠物板块显示等级上限（读 Config，当前 ' + maxLv + '）');
const scale = C('Config.battle.speedScale');
A(content.indexOf('速度 ÷ ' + scale) !== -1, '战斗板块显示 speedScale（读 Config，当前 ' + scale + '）');
const stopPct = C('Math.round(Config.battle.stopHpRatio*100)');
A(content.indexOf('血量低于 ' + stopPct + '%') !== -1, '战斗板块显示停挂机血量线（读 Config，当前 ' + stopPct + '%）');
const taxPer = C('Config.trade.taxPer');
A(content.indexOf('每满 ' + taxPer + ' 个材料') !== -1, '市场板块显示交易税（读 Config，当前每满 ' + taxPer + '）');
const maxList = C('Config.trade.maxListings');
A(content.indexOf('最多同时挂 ' + maxList + ' 单') !== -1, '市场板块显示挂单上限（读 Config，当前 ' + maxList + '）');
const firstName = C('Config.pet.starters[0].name');
A(content.indexOf(firstName) !== -1, '宠物表包含基宠名（读 Config，首只 ' + firstName + '）');
const slotCount = C('Equipment.SLOTS.length');
A(content.indexOf('装备共 ' + slotCount + ' 个部位') !== -1, '装备板块显示部位数（读 Equipment，当前 ' + slotCount + '）');
const areaCount = C('Config.battle.areas.length');
A((content.match(/<tr><td class="codex-key">/g) || []).length > areaCount, '表格行数覆盖全部地图条目（地图共 ' + areaCount + ' 张）');
const nirLv = C('Config.nirvana.minLevel');
A(content.indexOf(nirLv + ' 级') !== -1, '变强板块显示涅槃门槛（读 Config，当前 ' + nirLv + ' 级）');

/* ---------- 内容定性：百科不是攻略 ---------- */
A(!/流浪商人/.test(content), '百科不含市场假人（流浪商人）内容');
A(!/邀请码|云端存档|密码/.test(content), '百科不含账号内容');
A(!/避坑|先干嘛|推荐优先|建议你/.test(content), '百科不含攻略性质内容');
A(!/—|–/.test(content), '百科文案无 em-dash');
A(!/NaN|undefined/.test(content), '百科无 NaN / undefined 脏数值');

console.log('ALL CODEX TESTS PASSED');
