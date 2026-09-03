/* ============================================================
 * vtest_trade_records_rls.js —— 交易记录越权收口测试（2026-09-03）
 * 检查目标：
 *  1. 迁移文件（supabase/migrate_security_hardening.sql）删掉了 anon 可全量读的
 *     trade_records_select_all / trade_records_open_all，只重建 authenticated
 *     的 select_own（player_id = auth.uid()::text）
 *  2. 前端 supabase.js loadTradeRecords 始终带 .eq('player_id', 自己)，
 *     拿到的数据只有自己的行（服务端 RLS 之外的第一道闸）
 * 运行：node vtest_trade_records_rls.js（须在 tests/ 目录）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
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
  session: null, tradeTable: [], materialsTable: [], petsTable: [], itemsTable: [],
  listingsTable: [], itemListTable: [], profilesTable: [], uidSeq: 0
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const S = ms => new Promise(r => setTimeout(r, ms));
const C = code => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };

(async () => {
  await S(40);
  const mig = fs.readFileSync('../../supabase/migrate_security_hardening.sql', 'utf8').replace(/\r\n/g, '\n');

  console.log('=== 交易记录越权收口（trade_records RLS）===\n');
  // ---- 迁移文件收口 ----
  assert(/revoke execute on all functions in schema public from anon/i.test(mig), '迁移开头：anon 函数执行权全收回');
  assert(mig.includes('drop policy if exists "trade_records_select_all" on public.trade_records'), '删除 anon 可全量读的 trade_records_select_all');
  assert(mig.includes('drop policy if exists "trade_records_open_all" on public.trade_records'), '兼容删除仓库旧名 trade_records_open_all');
  assert(!/create\s+policy\s+"trade_records_select_all"/i.test(mig), '不再重建 select_all（无 anon 全量读侧门）');
  assert(mig.includes('create policy "trade_records_select_own" on public.trade_records\n  for select to authenticated using (player_id = auth.uid()::text)'),
    '新建 authenticated select_own：player_id = auth.uid()::text');
  assert(mig.includes('alter table public.trade_records enable row level security;'), 'trade_records RLS 已启用');

  // ---- 前端：loadTradeRecords 只查自己的 player_id ----
  const sup = fs.readFileSync('../js/core/supabase.js', 'utf8');
  assert(sup.includes(".eq('player_id', user.id)"), 'supabase.js loadTradeRecords 带 .eq(player_id, 自己)');

  // ---- 行为：vstub 按 eq 过滤，alice 只拿到自己的记录 ----
  ctx.tradeTable.push(
    { id: 'tr-1', player_id: 'user-a', role: 'sell', item_name: '剑', material_type: '重铸石', price_qty: 10, tax_qty: 1, net_qty: 9, listing_id: 'el-1', counterparty: '流浪商人', created_at: new Date().toISOString() },
    { id: 'tr-2', player_id: 'user-b', role: 'sell', item_name: '盾', material_type: '重铸石', price_qty: 5, tax_qty: 0, net_qty: 5, listing_id: 'el-2', counterparty: 'user-a', created_at: new Date().toISOString() },
    { id: 'tr-3', player_id: 'user-b', role: 'buy', item_name: '甲', material_type: '剥离石', price_qty: 3, tax_qty: 0, net_qty: 3, listing_id: 'el-3', counterparty: 'user-a', created_at: new Date().toISOString() }
  );
  C('Supabase.init()');
  await C('Supabase.signIn("alice@test.com","123456")');
  await S(30);
  assert(C('session.user.id') === 'user-a', 'A(alice) 登录（vstub 用户 id=user-a）');
  const recs = await C('Supabase.loadTradeRecords()');
  assert(!recs.error, 'loadTradeRecords 无报错');
  assert(recs.data.length === 1 && recs.data[0].player_id === 'user-a', 'alice 只查到自己的 1 条记录（user-b 的 2 条被 eq 挡掉）');
  assert(recs.data[0].counterparty === '流浪商人', '查到的记录内容正确（剑/卖/流浪商人）');

  console.log('\nALL TRADE RECORDS RLS TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1); });
