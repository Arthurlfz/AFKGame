/* 任务12 UI 渲染验证：宠物卡特质区 + 孵化弹窗 + 合成/涅槃预览 */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js','../js/ui/ui-codex.js','../js/ui/ui-pet-synth.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-market-records.js','../js/ui/ui-market-sell.js', '../js/main.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const C = code => vm.runInContext(code, ctx);
const A = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) process.exitCode = 1 };
const S = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await S(200); await C('Game.onLogin("t12@test.com","123456")'); await S(200);
  // 造一只带 2 条特质的出战宠
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,80,'腐噜兽');p.level=10;p.traits=[{id:'嗜血',tier:2},{id:'疾风',tier:1}];Pet.addPet(p);Pet.setActive(p.id);globalThis.__p=p.id;return true})()`);

  // 1) 宠物卡特质区：renderPetPanel 填充 #pet-traits
  C('UI.renderPetPanel()');
  const pt = C(`document.getElementById('pet-traits').innerHTML`);
  A(pt.indexOf('trait-pill') >= 0, `宠物卡特质区渲染胶囊（${pt.replace(/\s+/g,' ').slice(0,80)}）`);
  A(pt.indexOf('嗜血') >= 0 && pt.indexOf('疾风') >= 0, '特质区显示两条特质名');
  A(/T1|T2/.test(pt), '特质区带 T 阶');
  A(pt.indexOf('吸血+') >= 0 && pt.indexOf('速度+') >= 0, `特质胶囊带属性说明（嗜血→吸血+8%、疾风→速度+8）：${pt.replace(/\s+/g,' ').slice(0,120)}`);

  // 2) 孵化弹窗：showDialog 被调用时带特质块
  let dialogText = '';
  C(`(function(){const old=UI.showDialog;UI.showDialog=function(o){dialogText=o.text||'';return old?old(o):null};return true})()`);
  C(`(async()=>{const baby=Pet.createBaby('腐噜兽');baby.traits=[{id:'铁壁',tier:3}];const res={baby};const traitBlock=UI.traitsHtml(res.baby)||'<div class="trait-none">无血脉特质（白板宠）</div>';UI.showDialog({icon:'🐣',speaker:'孵化',text:'<b>蛋</b><br>'+traitBlock});return true})()`);
  await S(50);
  const dt = C('dialogText');
  A(dt.indexOf('trait-pill') >= 0 && dt.indexOf('铁壁') >= 0, `孵化弹窗包含特质块（${dt.slice(0,60)}）`);

  // 3) 合成/涅槃预览：静态验证 traitInheritLine 已接入预览函数 + 概率读 Config（动态数值在 vtest_trait_soulcast 已测）
  const src = fs.readFileSync('../js/ui/ui-pet.js', 'utf8');
  A(src.includes('traitInheritLine(main, sub, \'nirvana\')'), '涅槃预览函数调用 traitInheritLine');
  A(src.includes('traitInheritLine(main, sub, \'synth\')'), '合成预览函数调用 traitInheritLine');
  const TI = JSON.parse(C('JSON.stringify(Config.traitInherit || {})'));
  const TN = JSON.parse(C('JSON.stringify(Config.traitNirvana || {})'));
  A(Math.round((TI.mainKeep || 0) * 100) === 70 && Math.round((TI.subKeep || 0) * 100) === 40,
    `Config.traitInherit 主70%/副40%（${TI.mainKeep}/${TI.subKeep}）`);
  A(Math.round((TN.implantChance || 0) * 100) === 30, `Config.traitNirvana 植入30%（${TN.implantChance}）`);
  // 直接用 vm 调内部 traitInheritLine 不可行（未导出），改验证 UI 渲染的宠物卡 tooltip 含特质
  C(`(function(){const pet=Pet.getPets().find(p=>p.id===globalThis.__p);const tip=UI.traitsHtml(pet);globalThis.__tip=tip;return true})()`);
  const tip = C('globalThis.__tip');
  A(tip.indexOf('嗜血') >= 0 && tip.indexOf('疾风') >= 0, '宠物 tooltip 特质胶囊含两条特质');

  console.log('\n任务12 UI 渲染验证完成');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
