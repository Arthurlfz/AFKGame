/* 回归：打造「锁定一次性」+ 打造结果区不写孤儿节点
 *
 * 2026-09-11 玩家报两个打造 bug：
 *  ① 锁定石锁上后一直不失效（根因：只有 reforge 清了锁定，剥离/神圣/增缀三种没清）
 *  ② 用重铸石后词条「跳动两次」（根因：云同步失败回滚会二次渲染；而结果区节点
 *     在 renderCraftInto 重建 DOM 后已成孤儿，错误提示写进孤儿节点 → 玩家只看到
 *     词条闪过去又闪回来，看不到任何失败原因）
 */
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this['on' + t] = f }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', id: '', set onclick(f) { this._oc = f }, get onclick() { return this._oc }, click() { this._oc && this._oc() } } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of VTF.FILES) VTF.load(ctx, f);
const C = code => vm.runInContext(code, ctx);
const A = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) process.exitCode = 1 };
const S = ms => new Promise(r => setTimeout(r, ms));

// 造一件装备：前缀 1 条 + 后缀 2 条（保证剥离/增缀都可用）
let seq = 0;
async function makeEq() {
  const id = 'eq-' + (++seq);
  C(`(function(){const eq={id:${seq},name:'测试甲${seq}',slot:'护甲',areaTier:6,materialTier:3,tier:3,ilvl:60,
    rarity:{id:'gold',label:'金色',color:'#c9a86a'},base:{type:'hp',label:'生命',value:80},baseStats:{hp:80},
    affixes:{prefix:[{type:'atk',label:'攻击',tier:3,value:11}],suffix:[{type:'spd',label:'速度',tier:2,value:9},{type:'crit',label:'暴击率',tier:3,value:4}]},
    cloudId:'${id}',locked:false};Equipment.addToInventory(eq);globalThis.__eq=eq;return true})()`);
  ctx.itemsTable.push({ id, user_id: C('session.user.id'), name: '测试甲', slot: '护甲', base_stat: { type: 'hp', label: '生命', value: 80 }, affixes: { prefix: [], suffix: [] }, tier: 3, rarity: 'gold', locked: false, identified: true });
  return id;
}
const cloudLock = id => !!(ctx.itemsTable.find(x => x.id === id) || {}).affixes && !!(ctx.itemsTable.find(x => x.id === id).affixes || {})._lockPrefix;
const hasLock = () => C('!!(globalThis.__eq.lockPrefix || globalThis.__eq.lockSuffix)');

(async () => {
  await S(200); await C('Game.onLogin("c@test.com","123456")'); await S(300);
  const uid = C('session.user.id');
  for (const n of ['重铸石', '锁定石', '剥离石', '神圣石', '增缀石']) {
    C(`Materials.gainLocal('${n}', 99)`);
    ctx.materialsTable.push({ id: 'm-' + n, user_id: uid, name: n, quantity: 99 });
  }

  /* ---- ① 四种打造操作，锁定都必须失效 ---- */
  const ops = [
    ['reforge', '重铸石', '(on) => Craft.reforge(globalThis.__eq, on)'],
    ['strip', '剥离石', '(on) => Craft.strip(globalThis.__eq, on)'],
    ['reroll', '神圣石', '(on) => Craft.reroll(globalThis.__eq, on)'],
    ['augment', '增缀石', '(on) => Craft.augment(globalThis.__eq, on)']
  ];
  for (const [name, stone, call] of ops) {
    const id = await makeEq();
    await C('Craft.lockSide(globalThis.__eq, "prefix")');
    A(hasLock(), `${name}：上锁定石后确实锁上了`);
    const r = await C(`(${call})(function(){})`);
    A(!r.error, `${name}：打造成功（${r.error || 'ok'}）`);
    A(!hasLock(), `${name}：生效后锁定失效（不能一直锁着）`);
    await S(50);
    A(cloudLock(id) === false, `${name}：云端 _lockPrefix 也清了（刷新不会锁回来）`);
  }

  /* ---- ② 上锁本身不能被「锁失效」误伤 ---- */
  const id2 = await makeEq();
  const lr = await C('Craft.lockSide(globalThis.__eq, "suffix")');
  A(!lr.error && hasLock(), 'lockSide：上锁动作自己不会被锁定失效规则清掉');
  await S(50);
  A(cloudLock(id2) === false, 'lockSide（锁后缀）：_lockPrefix 应为 false');

  /* ---- ③ 云同步失败回滚：词缀与锁定都要还原 ---- */
  const id3 = await makeEq();
  await C('Craft.lockSide(globalThis.__eq, "prefix")');
  const before = C('JSON.stringify(globalThis.__eq.affixes)');
  C('globalThis.failUpdate = true');
  const rr = await C('Craft.reforge(globalThis.__eq, function(){})');
  C('globalThis.failUpdate = false');
  A(!!(rr && rr.rolledBack), '云同步失败：返回回滚标记');
  A(C('JSON.stringify(globalThis.__eq.affixes)') === before, '云同步失败：词缀已还原（不会留下改过的装备）');
  A(hasLock(), '云同步失败：锁定也还原（不能白吃掉玩家的锁定石）');

  /* ---- ④ 结果文字写进「当前」结果区（不再写孤儿节点） ---- */
  let renders = 0;
  const nodes = {};
  const mkNode = () => ({ innerHTML: '', disabled: false, dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: '', set onclick(f) { this._oc = f }, get onclick() { return this._oc } });
  const results = [];
  const host = {
    _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; renders++; },
    querySelector(sel) {
      // #craft-result 每次返回新节点 —— 真实 DOM 里 renderCraftInto 重建后也是新节点
      if (sel === '#craft-result') { const n = mkNode(); results.push(n); return n; }
      return nodes[sel] || (nodes[sel] = mkNode());
    },
    querySelectorAll() { return []; }, addEventListener() {}, style: {}, classList: { add() {}, remove() {} }, appendChild() {}
  };
  ctx.__host = host;

  // 走 UI：点一次重铸按钮 → 结果文字必须落在「最后一次」结果区节点里
  await makeEq();
  results.length = 0;
  C('UI.renderCraftInto(globalThis.__host, globalThis.__eq)');
  const btn = nodes['#craft-reforge'];
  A(typeof btn.onclick === 'function', '重铸按钮绑定了 onclick');
  await btn.onclick();
  await S(300);
  const last = results[results.length - 1];
  A(!!last && /重铸完成/.test(last.innerHTML || ''), '重铸结果文字写进了当前结果区（不再写孤儿节点）');

  /* ---- ⑤ 余额不足时重试一次再回滚（不会一失败就回滚） ---- */
  const id6 = await makeEq();
  const spendBefore = ctx.rpcCalls.filter(x => x === 'spend_material').length;
  await C('Craft.reforge(globalThis.__eq, function(){})');
  const spendAfter = ctx.rpcCalls.filter(x => x === 'spend_material').length;
  A(spendAfter - spendBefore === 1, `云端余额充足时只扣一次（实际 ${spendAfter - spendBefore} 次，重试只在失败时触发）`);

  console.log('\n打造锁定 / 结果区回归完成');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
