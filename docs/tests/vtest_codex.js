// 百科页回归测试（2026-09-09 页签式重构）
//  - 静态：PAGES 含 codex、侧边栏按钮、页面骨架、脚本引入；页签式已移除搜索框
//  - 运行时：UI.renderCodex 渲染 8 个页签按钮；逐页签 UI.codexShow 构建无异常
//  - 数值：各板块数值均取自 Config / Equipment / Config.towerDrops（禁止写死第二份）
//  - 内容定性：不含账号、市场假人、攻略板块，且无 em-dash
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: (k) => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() { }, remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-codex.js', '../js/main.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

/* ---------- 静态检查 ---------- */
const shell = fs.readFileSync('../js/ui/ui-shell.js', 'utf8');
A(/PAGES\s*=\s*new Set\(\[[^\]]*'codex'/.test(shell), 'ui-shell.js 的 PAGES 集合已包含 codex（否则页面打不开）');
const html = fs.readFileSync('../游戏.html', 'utf8');
A(/data-page="codex"/.test(html), '侧边栏按钮带 data-page="codex"（否则点击无响应）');
A(/id="tab-codex"/.test(html), '页面骨架存在 #tab-codex');
A(/ui-codex\.js\?v=\d/.test(html), '已引入 ui-codex.js 且带版本号');
A(!/codex-search/.test(html), '页签式百科已移除搜索框（2026-09-09 重构）');
const css = fs.readFileSync('../css/game.css', 'utf8');
A(/#tab-codex \.codex-body/.test(css), 'game.css 已新增 #tab-codex 样式段');

/* ---------- 渲染：页签式，一次只渲染当前板块 ---------- */
C('UI.renderCodex()');
const nav = C('document.getElementById("codex-nav").innerHTML');
A((nav.match(/codex-nav-btn/g) || []).length === 8, '页签渲染出 8 个板块按钮');
A(C('UI.codexEntries.length') === 8, '词条清单共 8 个板块');
// 逐页签切换构建（build() 每次现算，config 改了自动反映）
const tabs = C('UI.codexEntries.map(e => e.id)');
let all = '';
for (const t of tabs) {
  C(`UI.codexShow('${t}')`);
  const one = C('document.getElementById("codex-content").innerHTML');
  A(one.indexOf('该板块暂时无法显示') === -1, `板块 ${t} 构建成功（无渲染异常兜底）`);
  all += one;
}
A((all.match(/codex-card/g) || []).length === 8, '8 个板块逐页签渲染成功');
C(`UI.codexShow('battle')`);
const cur = C('document.getElementById("codex-content").innerHTML');
A(cur.indexOf('codex-battle') !== -1 && (cur.match(/codex-card/g) || []).length === 1, '同一时刻只渲染当前页签的一个板块');

/* ---------- 数值与 Config 一致（防写死第二份数值；用逐页签拼接的 all 检查） ---------- */
const maxLv = C('Config.pet.maxLevel');
A(all.indexOf('等级上限 ' + maxLv) !== -1, '宠物板块显示等级上限（读 Config，当前 ' + maxLv + '）');
const scale = C('Config.battle.speedScale');
A(all.indexOf('速度 ÷ ' + scale) !== -1, '战斗板块显示 speedScale（读 Config，当前 ' + scale + '）');
const stopPct = C('Math.round(Config.battle.stopHpRatio*100)');
A(all.indexOf('血量低于 ' + stopPct + '%') !== -1, '战斗板块显示停挂机血量线（读 Config，当前 ' + stopPct + '%）');
const taxPer = C('Config.trade.taxPer');
A(all.indexOf('每满 ' + taxPer + ' 个材料') !== -1, '市场板块显示交易税（读 Config，当前每满 ' + taxPer + '）');
const maxList = C('Config.trade.maxListings');
A(all.indexOf('最多同时挂 ' + maxList + ' 单') !== -1, '市场板块显示挂单上限（读 Config，当前 ' + maxList + '）');
const firstName = C('Config.pet.starters[0].name');
A(all.indexOf(firstName) !== -1, '宠物表包含基宠名（读 Config，首只 ' + firstName + '）');
const slotCount = C('Equipment.SLOTS.length');
A(all.indexOf('装备共 ' + slotCount + ' 个部位') !== -1, '装备板块显示部位数（读 Equipment，当前 ' + slotCount + '）');
const areaCount = C('Config.battle.areas.length');
A((all.match(/<tr><td class="codex-key">/g) || []).length > areaCount, '表格行数覆盖全部地图条目（地图共 ' + areaCount + ' 张）');
const nirLv = C('Config.nirvana.minLevel');
A(all.indexOf('Lv.' + nirLv) !== -1, '变强板块显示涅槃门槛（读 Config，当前 Lv.' + nirLv + '）');
const stageGates = C('Config.pet.evolution.stages.filter(s=>s.minLevel>1).map(s=>s.minLevel).join("/")');
A(stageGates.split('/').every(lv => all.indexOf('Lv.' + lv) !== -1), '宠物/变强板块覆盖全部 5 阶门槛（读 Config：' + stageGates + '）');
const godName = C('Config.pet.godPets.list[0].name');
A(all.indexOf(godName) !== -1, '宠物板块列出神级宠（读 Config，首只 ' + godName + '）');
A(all.indexOf('T1 ' + C('Config.traitHatch.tierRoll[1]') + '%') !== -1, '孵化特质概率可见（读 Config.traitHatch.tierRoll）');
A(all.indexOf('魂铸') !== -1 && all.indexOf(C('Config.soulCast.material')) !== -1, '装备/变强板块覆盖魂铸（读 Config）');

/* ---------- 2026-09-09 新增板块：掉落与鉴定 / 资源副本 / 通天塔归属 ---------- */
for (const n of C('Config.towerDrops.items.map(i => i.name)')) {
  A(all.indexOf(n) !== -1, '掉落板块列出已归塔的高级物品「' + n + '」（读 Config.towerDrops）');
}
const ticket = C('Config.resourceTrials.ticketName');
A(all.indexOf(ticket) !== -1, '副本板块显示门票名（读 Config，当前 ' + ticket + '）');
const freeN = C('Config.resourceTrials.freeEntriesPerDay');
A(all.indexOf('每天免费 ' + freeN + ' 次') !== -1, '副本板块显示每日免费次数（读 Config，当前 ' + freeN + '）');
const routeName = C('Config.resourceTrials.routes[0].name');
A(all.indexOf(routeName) !== -1, '副本板块列出资源副本路线（读 Config，首条 ' + routeName + '）');
A(all.indexOf('鉴定') !== -1, '掉落板块覆盖鉴定规则（未鉴定装备需鉴定石揭晓）');
const dmgLine = all.indexOf('攻击 × 攻击 ÷（攻击 + 有效防御）');
A(dmgLine !== -1, '战斗板块展示新伤害公式（2026-09-09 递减对抗）');

/* ---------- 内容定性：百科不是攻略 ---------- */
A(!/流浪商人/.test(all), '百科不含市场假人（流浪商人）内容');
A(!/邀请码|云端存档|密码/.test(all), '百科不含账号内容');
A(!/避坑|先干嘛|推荐优先|建议你/.test(all), '百科不含攻略性质内容');
A(!/—|–/.test(all), '百科文案无 em-dash');
A(!/NaN|undefined/.test(all), '百科无 NaN / undefined 脏数值');

console.log('ALL CODEX TESTS PASSED');
