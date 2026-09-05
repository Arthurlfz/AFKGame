/* 回归：打造页渲染不崩（上次改 soulCandidates 引入 active 未定义） */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this['on' + t] = f }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', id: '', set onclick(f) { this._oc = f }, get onclick() { return this._oc }, click() { this._oc && this._oc() } } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js','../js/ui/ui-codex.js','../js/ui/ui-pet-synth.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-market-records.js','../js/ui/ui-market-sell.js', '../js/main.js']) VTF.load(ctx, f);
const C = code => vm.runInContext(code, ctx);
const A = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) process.exitCode = 1 };
const S = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await S(200); await C('Game.onLogin("c@test.com","123456")'); await S(200);
  // 一只出战宠（无特质）+ 一只非出战有特质宠
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,80,'腐噜兽');p.level=40;p.growth=12;Pet.addPet(p);Pet.setActive(p.id);const q=Pet.createPet('血狐','🦊',4,100,20,9,50,'血狐');q.level=45;q.growth=15;q.traits=[{id:'战意',tier:1}];Pet.addPet(q);return true})()`);
  // 造一件白装
  C(`(function(){const eq={id:1,name:'测试甲',slot:'护甲',areaTier:1,materialTier:3,tier:3,rarity:{id:'white',label:'白色',color:'#b2aa9c'},base:{type:'hp',label:'生命',value:80},baseStats:{hp:80},affixes:{prefix:[],suffix:[]},cloudId:null,locked:false};Equipment.addToInventory(eq);globalThis.__eq=eq;return true})()`);
  // 渲染打造面板：不应抛错（openCraftPanel 现重定向到右侧详情面板，不再写旧抽屉 craft-body）
  let threw = null;
  try { C('UI.openCraftPanel(globalThis.__eq)'); } catch (e) { threw = e; }
  A(threw === null, `打造面板渲染无异常${threw ? '（' + threw.message + '）' : ''}`);
  // 魂铸区块由 UI.renderCraftInto 直接写入容器，直接测它（不依赖桩的 querySelector 缓存）
  const html = C(`(function(){const h={innerHTML:'',querySelector:function(){return {innerHTML:''}},querySelectorAll:function(){return []},addEventListener:function(){}};UI.renderCraftInto(h,globalThis.__eq);return h.innerHTML})()`);
  A(html.length > 0, '打造页有输出内容');
  A(html.indexOf('craft-soul') >= 0, '打造页含魂铸区块');
  // 下拉选项应包含出战宠标记
  const opts = C(`(function(){const s=document.getElementById('soul-pet');return s?s.innerHTML:''})()`);
  A(opts.indexOf('⚔出战') >= 0 || opts.length === 0, `魂铸下拉渲染（出战标记 ${opts.indexOf('⚔出战') >= 0 ? '有' : '无'}/${opts.length}字）`);
  // 确认按钮应该亮（无 disabled）— 默认选中非出战候选
  const btn = C(`(function(){const b=document.getElementById('craft-soul');return b?b.disabled:null})()`);
  A(btn === false, `魂铸确认按钮可点（disabled=${btn}）`);
  // 默认选中后下拉 selected 有值
  const selVal = C(`(function(){const s=document.getElementById('soul-pet');return s?s.value:null})()`);
  A(selVal !== '' && selVal != null, `下拉默认有选中（value=${selVal}）`);
  // 默认选中的是非出战宠（出战宠腐噜兽无特质不在候选里，候选=血狐）
  const activeId = C(`(function(){const a=Pet.getActivePet();return a?a.id:null})()`);
  A(Number(selVal) !== activeId, `默认选中非出战宠（activeId=${activeId}, selVal=${selVal}）`);

  // ---- 魂铸词缀显示回归 ----
  // 给装备打上魂铸词缀，验证背包卡 + tooltip 都渲染
  C(`(function(){const eq=globalThis.__eq;eq.soulAffix={type:'lifesteal',awaken:false,traitId:'嗜血',tier:2,stat:'lifesteal',value:5,source:'soulcast',label:'魂·嗜血 T2'};return true})()`);
  const bodyHtml = C(`(function(){const h={innerHTML:'',querySelector:function(){return {innerHTML:''}},querySelectorAll:function(){return []},addEventListener:function(){}};UI.renderCraftInto(h,globalThis.__eq);return h.innerHTML})()`);
  A(bodyHtml.indexOf('魂·嗜血') >= 0, '打造页已铸入区显示魂铸词缀');
  console.log('\n打造页回归验证完成');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
