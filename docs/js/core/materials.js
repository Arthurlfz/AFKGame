/* ============================================================
 * materials.js —— 材料系统（当前仅「涅磐兽」一种，结构通用）
 * 职责：
 *  1. 材料数量本地持有（local 计数仅本模块维护）
 *  2. gain：获得材料 → 本地 +amount；已登录则调 add_material RPC 云端原子累加
 *  3. setCloudMaterials：登录/刷新时以云端为权威整体替换（丢失的只可能是未登录时的本地累计）
 * 依赖：supabase.js（getCurrentUser / getClient）
 * ============================================================ */
(function () {
  'use strict';

  const Supabase = window.Supabase;

  let local = {}; // { name: quantity }

  /* ---------- 待上报队列（掉落是高频的，攒一批再发） ----------
   * 原来每次掉材料都 await cloudGain（getUser + rpc 两次往返，实测共约 340ms），
   * 一场战斗连掉好几种就是一串串行等待，全卡在战斗结算里 → 挂机一顿一顿。
   * 现在：本地立即加（界面 0ms 生效）+ 入队，后台攒 4 秒合并上报。
   */
  const FLUSH_MS = 4000;
  // 云端 add_material 有 60 秒窗口限流（migrate_security_hardening.sql / Config.security），
  // 触发后不能按 4 秒猛刷重试（会一直撞锁定），退避到窗口结束再试一次。
  const rateWindowMs = () => {
    const cfg = (window.Config && window.Config.security && window.Config.security.addMaterial) || {};
    return ((cfg.windowSec || 60) * 1000);
  };
  let lastRateWarnAt = 0;  // 限流提示节流（不刷屏）
  let pending = {};        // { 材料名: 待上报数量 }
  let flushTimer = null;

  function warnRateLimited() {
    const now = Date.now();
    if (now - lastRateWarnAt < 30000) return; // 同一条提示最多 30 秒一次
    lastRateWarnAt = now;
    const msg = '材料同步太频繁，已自动降速稍后补传（本地不会丢）';
    if (window.console && console.warn) console.warn('[材料]', msg);
    if (window.UI && window.UI.showToast) { try { window.UI.showToast('⏳ 同步降速', msg); } catch (e) { /* 提示失败不挡流程 */ } }
  }

  /* ---------- 获得材料（掉落 / 发奖时调用） ---------- */
  // 本地立即生效；云端走队列（不 await 网络）。
  // 需要立刻落盘的场景自己调 flushMaterials()：消耗材料前、交任务发奖后、离场前。
  function gain(name, amount) {
    gainLocal(name, amount);
    enqueue(name, amount);
    return { ok: true, cloud: 'pending' };
  }

  function enqueue(name, amount) {
    const amt = amount || 1;
    pending[name] = (pending[name] || 0) + amt;
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushMaterials(); }, FLUSH_MS);
  }

  // 把攒着的材料立即上报云端。三种时机必须调：
  //   ① 消耗材料前（spend 是云端原子扣减，云端还没收到这笔就会报「余额不足」）
  //   ② 交任务发奖后（不落盘，玩家一刷新奖励就没了）
  //   ③ 切后台 / 关页面前（main.js 的 visibilitychange）
  // 上报失败的品种退回队列等下次重试；未登录的不重试（下次登录以云端为准）。
  async function flushMaterials() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const batch = pending;
    const names = Object.keys(batch);
    if (!names.length) return;
    pending = {};
    const failed = {};
    let hitRateLimit = false;
    await Promise.all(names.map(async (name) => {
      const r = await cloudGain(name, batch[name]);
      if (r && r.error) {
        failed[name] = batch[name];
        if (r.rateLimited) hitRateLimit = true; // 服务端限流：放慢重试节奏，别继续撞锁
      }
    }));
    const failedNames = Object.keys(failed);
    if (!failedNames.length) return;
    for (const n of failedNames) pending[n] = (pending[n] || 0) + failed[n];
    // 失败必须重试（本地已加、云端还没记，不补上去刷新就丢这批收益）；限流时退避到窗口结束
    const delay = hitRateLimit ? rateWindowMs() : FLUSH_MS;
    if (hitRateLimit) warnRateLimited();
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushMaterials(); }, delay);
  }

  /* ---------- 消耗材料（融合等用途调用） ---------- */
  // 先校验本地余额 → 调云端 spend_material RPC 原子扣减（余额不足返回 false 不动）
  // 云端扣成功才改本地计数（云端权威，避免本地扣了云端没扣的不同步）
  // 返回 { ok, error? }
  async function spend(name, amount) {
    amount = amount || 1;
    if ((local[name] || 0) < amount) return { ok: false, error: `${name} 不足` };
    // 先把还没上报的材料补上去：spend 是云端原子扣减，
    // 云端余额里还没有刚掉的这批，直接扣会误报「余额不足」。
    await flushMaterials();
    const user = await Supabase.getCurrentUser();
    if (!user) return { ok: false, error: '请先登录' };
    const { data, error } = await Supabase.getClient().rpc('spend_material', { p_name: name, p_amount: amount });
    if (error) return { ok: false, error: error.message };
    if (data === false) return { ok: false, error: `${name} 余额不足（云端）` };
    local[name] -= amount;
    if (local[name] <= 0) delete local[name];
    return { ok: true };
  }

  /* ---------- 本地 / 云端拆分（性能优化：本地先行 → 异步同步 → 失败回滚用） ---------- */
  // 纯本地累加（不回写云端；界面立即生效，云同步单独调 cloudGain）
  function gainLocal(name, amount) {
    amount = amount || 1;
    local[name] = (local[name] || 0) + amount;
  }
  // 纯本地扣减（购买后同步扣材料 / 云同步失败回滚用）；余额不足返回 { ok:false } 不改动
  function spendLocal(name, amount) {
    amount = amount || 1;
    if ((local[name] || 0) < amount) return { ok: false, error: `${name} 不足` };
    local[name] -= amount;
    if (local[name] <= 0) delete local[name];
    return { ok: true };
  }
  // 仅云端累加（RPC add_material；本地已由 gainLocal 加过，这里不重复加本地）
  async function cloudGain(name, amount) {
    amount = amount || 1;
    const user = await Supabase.getCurrentUser();
    if (!user) return { ok: true, cloud: false }; // 未登录：本地累计即可
    const { error } = await Supabase.getClient().rpc('add_material', { p_name: name, p_amount: amount });
    if (error) {
      // 本地已加过（gainLocal），云没记上；带 rateLimited 标记让 flush 退避重试而不是静默丢
      const msg = String((error && (error.message || error.details)) || error || '');
      return { ok: true, cloud: false, error, rateLimited: msg.indexOf('ERR_RATE_LIMIT') >= 0 };
    }
    return { ok: true, cloud: true };
  }
  // 仅云端扣减（RPC spend_material；本地已由 spendLocal 扣过）
  async function cloudSpend(name, amount) {
    amount = amount || 1;
    const user = await Supabase.getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    return Supabase.getClient().rpc('spend_material', { p_name: name, p_amount: amount });
  }

  /* ---------- 云端恢复（登录后 / 购买后调用） ---------- */
  // rows: [{ name, quantity }, ...] → 整体替换本地（云端权威）
  function setCloudMaterials(rows) {
    const next = {};
    for (const r of rows || []) next[r.name] = (next[r.name] || 0) + r.quantity;
    // 把还没上报的补回去：那是当前这个号已经拿到、但云端还没记账的部分。
    // 不加回去的话，玩家在上报窗口（4 秒）内刷新页面，这批掉落就凭空没了
    // ——云端查不到（还没报），本地又被云端快照覆盖。
    // 换号走 clearAll()（先补报再清空），不会串到别的号上。
    for (const n of Object.keys(pending)) next[n] = (next[n] || 0) + pending[n];
    local = next;
  }

  // 登出 / 换号：先把还没上报的补报到当前号（否则这批收益白丢），再彻底清空。
  async function clearAll() {
    await flushMaterials();
    local = {};
    pending = {};
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  /* ---------- 查询 ---------- */
  const getQuantity = name => local[name] || 0;
  const getLocal = () => ({ ...local });

  /* ---------- 云端读取（登录后调用） ---------- */
  async function loadCloudMaterials() {
    const user = await Supabase.getCurrentUser();
    if (!user) return { data: [], error: null };
    return Supabase.getClient().from('materials')
      .select('name,quantity')
      .order('created_at', { ascending: true });
  }

  /* ---------- 对外 API ---------- */
  window.Materials = {
    gain, spend, gainLocal, spendLocal, cloudGain, cloudSpend, flushMaterials, clearAll,
    getQuantity, setCloudMaterials, getLocal, loadCloudMaterials
  };
})();
