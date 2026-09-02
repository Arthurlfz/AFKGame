/* ============================================================
 * vtest_equip_compare.js —— 换装属性对比（背包页）
 * 守的设计承诺：
 *  1. 背包里每件装备的详情浮层，都能显示「换上它」相对【当前身上装备】的属性增减
 *  2. 增减走 Pet.getStats（与战斗同源，含 atk%/hp%/def% 百分比词缀对裸属性的换算）
 *  3. 提升显示绿色 +、下降显示红色 −；属性无变化时明确提示
 *  4. 明确【不展示评分】——评分只用于背包排序/批量清理，不参与战斗
 *  5. 试穿是只读的：不会真的改动宠物装备、不会触发云端同步
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
const created = []; // 记录所有 createElement 出来的节点，用来抓装备详情浮层（class=equip-tip）
function el() {
  const o = { dataset: {}, className: '', textContent: '', innerHTML: '', id: '', value: '', disabled: false,
    style: { setProperty() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    appendChild(c) { this.children.push(c) }, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {},
    scrollTop: 0, scrollHeight: 0, offsetHeight: 0, offsetWidth: 0,
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 } },
    click() { this._onclick && this._onclick() } };
  created.push(o);
  return o;
}
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/main.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);
const S = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await S(300); await C('Game.onLogin("cmp@test.com","123456")'); await S(300);
  // 建一只出战宠物（武器部位先空着）
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,80,'腐噜兽');p.level=10;Pet.addPet(p);Pet.setActive(p.id);globalThis.__p=p.id;return true})()`);
  const petId = C('globalThis.__p');
  A(!!petId, '已建立 Lv.10 出战宠物');
  const baseAtk = C('Pet.getStats(Pet.getPets().find(p=>p.id===globalThis.__p)).atk');

  // 手工造装备（避开随机器）：同部位「武器」，纯固定值攻击，方便断言差值
  const mkItem = (id, atk, extraAffix) => C(`(function(){
    const eq={id:${id},name:'测试剑${id}',slot:'武器',areaTier:1,materialTier:3,tier:3,
      rarity:{id:'white',label:'白色',color:'#b2aa9c'},
      base:{type:'atk',label:'攻击',value:${atk}},baseStats:{atk:${atk}},
      affixes:{prefix:[],suffix:${extraAffix ? JSON.stringify([extraAffix]) : '[]'}},
      cloudId:null,locked:false};
    Equipment.addToInventory(eq);return true})()`);
  mkItem(901, 30); // 弱：攻击 +30
  const equipped = C('Equipment.equipItem(Pet.getActivePet(), 901)');
  A(equipped && equipped.equipped, '已穿上弱武器（攻击 +30）');
  const atkWithWeak = C('Pet.getStats(Pet.getPets().find(p=>p.id===globalThis.__p)).atk');
  A(atkWithWeak === baseAtk + 30, `穿装后攻击生效：${baseAtk} → ${atkWithWeak}`);

  // 强武器（攻击 +50）与一件完全相同的（+30，用于验证「无变化」）
  mkItem(902, 50);
  mkItem(903, 30);
  // 一件带 hp% 百分比词缀的（验证百分比词缀也走 getStats 换算，不是简单加减）
  mkItem(904, 30, { type: 'hp', label: '生命', tier: 3, value: 10 });

  // 渲染背包，抓详情浮层
  created.length = 0;
  C('UI.renderInventory()');
  const tips = created.filter(e => e.className === 'equip-tip').map(e => e.innerHTML || '');
  A(tips.length >= 3, `渲染出 ${tips.length} 个装备详情浮层`);

  const tipOf = name => tips.find(h => h.indexOf(name) >= 0) || '';
  // 只取「对比身上装备」之后的内容再断言：浮层里还有基底/词缀展示行（如「生命 +10%」），
  // 直接在整段 HTML 上正则会匹配到展示行而不是对比结果。
  const cmpOf = h => { const i = h.indexOf('对比身上装备'); return i >= 0 ? h.slice(i) : ''; };
  const strong = cmpOf(tipOf('测试剑902')), same = cmpOf(tipOf('测试剑903')), pctItem = cmpOf(tipOf('测试剑904'));
  const grab = (h, label) => (h.match(new RegExp(label + ' [+−]([\\d.]+)')) || [])[1];

  A(strong.indexOf('对比身上装备') >= 0, '详情浮层里有「对比身上装备」分段');
  A(strong.indexOf('攻击 +20') >= 0, `强武器对比区显示 攻击 +20（实际：攻击 ${grab(strong, '攻击')}）`);
  A(strong.indexOf('#5fd18b') >= 0, '提升用绿色标记');

  A(same.indexOf('属性无变化') >= 0, '与身上完全相同的装备提示「属性无变化」');

  // 百分比词缀：+10% 生命，按「等级底座」换算（不乘成长量，2026-09-01 用户拍板的 statParts 拆分）
  const pctHpDelta = Number(grab(pctItem, '生命') || 0);
  const petCoreHp = C('Pet.statParts(Pet.getPets().find(p=>p.id===globalThis.__p)).core.hp');
  const expectHp = Math.round(petCoreHp * 1.1) - petCoreHp;
  A(pctHpDelta === expectHp, `百分比词缀按底座换算：生命 +${pctHpDelta}（期望 +${expectHp} = 底座 ${petCoreHp} × 10%，而非固定 +10）`);

  A(tips.every(h => h.indexOf('评分') < 0), '对比里不展示评分（评分只用于排序/清理）');

  // 试穿是只读的：渲染完对比后，宠物身上仍然是最初那件弱武器
  const stillWeak = C(`(function(){const eq=Pet.getActivePet().equipment['武器'];return eq&&eq.id})()`);
  A(stillWeak === 901, `试穿只读：身上仍是原装备（id=${stillWeak}），对比没有改状态`);

  console.log('ALL EQUIP COMPARE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
