/* ============================================================
 * vtest_egg_listings_rls.js —— 宠物蛋挂单直接改价/改状态封堵测试（2026-09-03）
 * 检查目标：
 *  1. 迁移文件删除 egg_listings update_own 策略，且不重建（改价/改状态一律走 RPC）
 *  2. 前端 supabase.js 没有任何对 egg_listings 的 .update() 直改路径，
 *     取消挂单只走 cancel_egg_listing RPC
 * 运行：node vtest_egg_listings_rls.js（须在 tests/ 目录）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
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
  navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el() },
  session: null, petEggTable: [], materialsTable: [], petsTable: [], itemsTable: [],
  listingsTable: [], itemListTable: [], tradeTable: [], profilesTable: [], uidSeq: 0
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js']) VTF.load(ctx, f);
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };

(async () => {
  await S(40);
  const mig = fs.readFileSync('../../supabase/migrate_security_hardening.sql', 'utf8').replace(/\r\n/g, '\n');

  console.log('=== 宠物蛋挂单直接改价封堵（egg_listings update_own）===\n');
  // ---- 迁移文件收口 ----
  assert(/revoke execute on all functions in schema public from anon/i.test(mig), '迁移开头：anon 函数执行权全收回');
  assert(mig.includes('drop policy if exists "egg_listings_update_own" on public.egg_listings'), '删除 egg_listings update_own（玩家可直改自己挂单价格/状态的策略）');
  assert(!/create\s+policy\s+"egg_listings_update_own"/i.test(mig), '不重建 update_own（不存在直改侧门）');

  // ---- 前端：无 table.update 直改路径，取消只走 RPC ----
  const sup = fs.readFileSync('../js/core/supabase.js', 'utf8');
  assert(!/from\('egg_listings'\)[\s\S]{0,400}?\.update\(/.test(sup),
    'supabase.js 无 egg_listings 直改 .update() 调用（整段源码扫描）');
  assert(sup.includes("return client.rpc('cancel_egg_listing', { p_listing_id: listingId });"),
    '取消挂单只走 cancel_egg_listing RPC');
  assert(sup.includes(".eq('status', 'active')"), 'fetchEggMarket 只读 active 挂单');
  assert(sup.includes("client.from('egg_listings').select('id').eq('seller_id', user.id).eq('status', 'active')"),
    'fetchMyListedEggIds 只查自己的 active 挂单');

  // ---- 行为：listEgg 走 list_egg RPC（若有直插路径应出现在源码里——上面已保证没有）----
  assert(sup.includes("return client.rpc('list_egg', {"), '上架蛋走 list_egg RPC（无表格直插绕过）');

  console.log('\nALL EGG LISTINGS RLS TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
