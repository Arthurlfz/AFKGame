// 抽样验证：AI 假货的市场覆盖谱系（图档 / 稀有度 / 底材T / 价格）
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } }; })();
function el() { return { textContent: '', innerHTML: '', style: { setProperty() {} }, classList: { add() {}, remove() {} }, appendChild(c) { this.children.push(c) }, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0' }; }
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el() }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
  '../js/core/items.js', '../js/core/materials.js', '../js/pet/enemy-data.js', '../js/core/drop.js',
  '../js/core/market.js', '../js/core/market_bot.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
const C = code => vm.runInContext(code, ctx);

(async () => {
  const N = 2000;
  const areaTier = {}, rarity = {}, matTier = {}, price = {};
  let listings = 0;
  for (let i = 0; i < N; i++) {
    const l = await C('MarketBot.__test.makeListing()');
    if (!l) continue; // 空车/材料/蛋
    listings++;
    const at = C(`(() => { const areaList = Config.battle.areas; return areaList.findIndex(a => a.id === "${l.eq ? '' : ''}") ; })()`);
    // 用 makeListing 返回里没有 areaTier，直接从 eq 无法拿；改用 price 反推不可行 —— 换个思路：直接抓 aiDrop 的 area
  }
  // 更直接：单独抽 aiDrop 统计图档（areaTier），再统计 listable 装备的稀有度/底材/价格
  const areaCnt = {}, rareCnt = {}, tierCnt = {}, priceList = [];
  let eqCnt = 0, eggCnt = 0, matCnt = 0, noneCnt = 0;
  for (let i = 0; i < N; i++) {
    const { area, result } = await C('MarketBot.__test.aiDrop()');
    const areaList = C('Config.battle.areas');
    const at = areaList.findIndex(a => a.id === area.id) + 1;
    areaCnt[at] = (areaCnt[at] || 0) + 1;
    if (result.type === 'equipment') { eqCnt++; rareCnt[result.eq.rarity.id] = (rareCnt[result.eq.rarity.id] || 0) + 1; tierCnt[result.eq.tier] = (tierCnt[result.eq.tier] || 0) + 1; }
    if (result.type === 'egg') eggCnt++;
    if (result.type === 'material') matCnt++;
    if (result.type === 'none') noneCnt++;
  }
  // 定价梯度实测
  for (const [rar, t] of [['white', 1], ['blue', 5], ['gold', 9], ['gold', 17]]) {
    const p = C(`MarketBot.__test.rollPrice("${rar}", ${t})`);
    priceList.push(`${rar}@图${t} → ${p.material_qty} ${p.material_type}`);
  }
  console.log('=== AI 真实掉落抽样（' + N + ' 次 rollReward dry）===');
  console.log('掉落构成：', JSON.stringify({ none: noneCnt, material: matCnt, equipment: eqCnt, egg: eggCnt }));
  console.log('AI 挂机图档分布：', JSON.stringify(areaCnt));
  console.log('装备稀有度分布：', JSON.stringify(rareCnt));
  console.log('装备底材T分布：', JSON.stringify(tierCnt));
  console.log('定价梯度实测：');
  priceList.forEach(x => console.log('  ' + x));
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
