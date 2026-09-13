/* ============================================================
 * vtest_server_config.js —— 服务端全局配置同步（市场机器人总开关）
 * 守的是什么（2026-09-13 立的）：
 *   旧开关只改本机内存 —— 别人电脑上的机器人照跑、刷新还复原，等于关不掉。
 *   现在开关落在服务器 game_config_overrides 上，全员生效、刷新不丢。
 * 验收场景：
 *   1. 服务端说「关」→ 本地跟着关（这是整个开关存在的理由）
 *   2. 服务端说「开」→ 本地跟着开
 *   3. 读不到配置（网络抖 / 表没配）→ **保持现状**，绝不擅自把机器人停了
 *   4. 服务器没设过 bot.enabled → 沿用 config.js 默认值，不越权替策划决定
 *   5. 管理员写开关 → 真的发到服务器，且本地立刻生效
 * 运行：node vtest_server_config.js（须在 tests/ 目录）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return {
  getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) },
  removeItem: k => { delete m[k] }
}; })();
function el() { return {
  textContent: '', innerHTML: '', style: { setProperty() {} }, classList: { add() {}, remove() {} },
  appendChild(c) { this.children.push(c) }, append() {}, addEventListener() {}, querySelector: () => el(),
  querySelectorAll: () => [], children: [], removeChild() {}, remove() {},
  scrollTop: 0, scrollHeight: 0, disabled: false, value: '0'
}; }
const els = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch,
  URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData,
  Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto,
  location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el() },
  session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [],
  materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: []
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js',
  '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js',
  '../js/core/market.js', '../js/core/market_bot.js', '../js/core/server-config.js']) {
  VTF.load(ctx, f);
}
const C = code => vm.runInContext(code, ctx);
const S = ms => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };

/* 桩：直接用内存变量当「服务器上的配置」，不碰真实数据库。
 * 结构按 loadServerConfig 的真实返回造（jsonb 对象，不是字符串）。 */
C(`
  window.__cfg = null;
  window.__saved = null;
  Supabase.loadServerConfig = async function () { return window.__cfg; };
  Supabase.saveServerConfig = async function (c) { window.__saved = c; return { ok: true }; };
`);

(async function main() {
  // 基线：本地默认开着（config.js marketBot.enabled = true）
  assert(C('Config.marketBot.enabled === true'), '基线：本地默认机器人是开的');

  // 1. 服务端说关 → 跟着关
  C('window.__cfg = { bot: { enabled: false } };');
  await C('ServerConfig.sync()'); await S(10);
  assert(C('ServerConfig.isBotEnabled() === false'), '服务端说「关」→ 机器人关');
  assert(C('Config.marketBot.enabled === false'), '服务端说「关」→ 同步到本地 Config（不是只改个显示值）');

  // 2. 服务端说开 → 跟着开
  C('window.__cfg = { bot: { enabled: true } };');
  await C('ServerConfig.sync()'); await S(10);
  assert(C('ServerConfig.isBotEnabled() === true'), '服务端说「开」→ 机器人开');

  // 3. 读不到配置 → 保持现状（网络抖一下就停机器人，比晚 60 秒生效严重得多）
  C('Config.marketBot.enabled = true; window.__cfg = null;');
  await C('ServerConfig.sync()'); await S(10);
  assert(C('Config.marketBot.enabled === true'), '读不到配置 → 保持现状，绝不擅自停机器人');

  // 4. 服务器没设过 → 沿用本地默认，不越权
  C('window.__cfg = {};');
  await C('ServerConfig.sync()'); await S(10);
  assert(C('Config.marketBot.enabled === true'), '服务器没设过 → 沿用本地默认值');
  assert(C('ServerConfig.isServerControlled() === false'), '服务器没设过 → 不算「被服务器接管」');

  // 5. 管理员关：真的写到服务器 + 本地立刻生效
  await C('ServerConfig.setBotEnabled(false)'); await S(10);
  assert(C('Config.marketBot.enabled === false'), '管理员关 → 本地立刻生效');
  assert(C('window.__saved && window.__saved.bot && window.__saved.bot.enabled === false'),
    '管理员关 → 配置真的发到服务器（不是只改本机内存）');

  // 6. 关掉时清掉假货：市场上不该还摆着机器人的东西
  C(`
    Market.addBotListing({ id: 'bot-x', item_name: '假货', material_type: '重铸石', material_qty: 1, eq: {} });
    ServerConfig.setBotEnabled(false);
  `);
  await S(20);
  assert(C('Market.getBotListings().length === 0'), '关掉机器人 → 市场上的假货一并清空');

  console.log('\n全部通过');
  process.exit(0);
})().catch(e => { console.error('❌ EXC ' + (e && e.stack || e)); process.exit(1); });
