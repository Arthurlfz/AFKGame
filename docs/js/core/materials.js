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

  let local = {};       // { name: quantity } 总数量
  /* 绑定数量（2026-09-16 策划拍板：任务产出全绑定，不可交易）
   * 🔴 不变式：boundLocal[name] ≤ local[name]（云端 materials 表有同名 check 约束）。
   * 可自由交易的数量 = getFreeQuantity = 总数 − 绑定数。 */
  let boundLocal = {};  // { name: quantity }

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
  let pendingBound = {};   // { 材料名: 其中「绑定」的待上报数量 }
  let flushTimer = null;

  function warnRateLimited() {
    const now = Date.now();
    if (now - lastRateWarnAt < 30000) return; // 同一条提示最多 30 秒一次
    lastRateWarnAt = now;
    const msg = '材料同步太频繁，已自动降速稍后补传（本地不会丢）';
    if (window.console && console.warn) console.warn('[材料]', msg);
    if (window.UI && window.UI.showToast) { try { window.UI.showToast('⏳ 同步降速', msg); } catch (e) { /* 提示失败不挡流程 */ } }
  }

  /* ---------- 经验包判定（2026-09-18） ----------
   * ⭐ 【唯一判定处】：名字在 `Config.expPacks` 名单里 = 经验包。
   *   掉落（drop.js）与塔结算（tower-rewards.gainMat）**都必须调它**，
   *   不许各自再抄一份名单 —— "同一逻辑两份"是本项目头号病因。
   * 为什么需要它：经验包一律【绑定】（防"花钱买练级"绕过涅槃的练级成本）。
   *   原来经验包只在任务与塔里产（那两条路都自己绑了）；
   *   2026-09-18 起**地图也开始掉经验包**，而掉落走的是 `Materials.gain` 不带 bound
   *   ⇒ 不接上就等于开出"可交易的经验"。 */
  const isExpPack = name => ((window.Config && window.Config.expPacks) || []).some(p => p.name === name);

  /* ---------- 获得材料（掉落 / 发奖时调用） ---------- */
  // 本地立即生效；云端走队列（不 await 网络）。
  // 需要立刻落盘的场景自己调 flushMaterials()：消耗材料前、交任务发奖后、离场前。
  /* 第三参 opts.bound：这批是不是绑定（任务产出传 true）。
   * 绑定的只在本地与云端各记一份「绑定数量」，总量照常加 —— 两者是包含关系不是并列。 */
  function gain(name, amount, opts) {
    /* 2026-09-18：**经验包一律绑定**，而且是 `gain` 自己认（不用调用方记得传）。
     * 为什么放在这里：地图掉落 / 任务发奖 / 塔结算都要绑，放调用点就会漏（漏一处 = 开出可交易的经验）。
     * ⭐ 顺带的好处：测试里的 Materials 桩不用再加 isExpPack 也能正确跑。 */
    const bound = !!(opts && opts.bound) || isExpPack(name);
    gainLocal(name, amount, bound);
    enqueue(name, amount, bound);
    return { ok: true, cloud: 'pending' };
  }

  function enqueue(name, amount, bound) {
    const amt = amount || 1;
    pending[name] = (pending[name] || 0) + amt;
    if (bound) pendingBound[name] = (pendingBound[name] || 0) + amt;
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
    const batchBound = pendingBound;   // 这批里绑定的部分（与 batch 同 key 对齐）
    const names = Object.keys(batch);
    if (!names.length) return;
    pending = {};
    pendingBound = {};
    const failed = {};
    const failedBound = {};
    let hitRateLimit = false;
    await Promise.all(names.map(async (name) => {
      const r = await cloudGain(name, batch[name], batchBound[name] || 0);
      if (r && r.error) {
        failed[name] = batch[name];
        failedBound[name] = batchBound[name] || 0;
        if (r.rateLimited) hitRateLimit = true; // 服务端限流：放慢重试节奏，别继续撞锁
      }
    }));
    const failedNames = Object.keys(failed);
    if (!failedNames.length) return;
    for (const n of failedNames) {
      pending[n] = (pending[n] || 0) + failed[n];
      pendingBound[n] = (pendingBound[n] || 0) + (failedBound[n] || 0);
    }
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
    applyLocalDeduct(name, amount);
    return { ok: true };
  }

  /* ---------- 多材料【原子】扣减（2026-09-15） ---------- */
  /* 一次请求扣完好几种材料 —— 走服务端 spend_materials(jsonb)：
   * 服务端在一个事务里逐项扣，**任一项不足就整体回滚**（前面已扣的自动退回）。
   * 为什么要它：
   *   ① 往返 N 趟 → 1 趟（涅槃/合成/进化/收集任务原本要扣 2~N 种）；
   *   ② 干掉了"扣一半再退回"的中间态 —— 原来靠客户端逐级 Materials.gain 补偿，
   *      补偿期间是真会出现"材料被吞了再吐回来"的可见状态。
   * 服务端还会**把同名材料合并成一笔**（分两笔扣时第一笔会把余额吃到不够第二笔），
   * 所以调用方不用再自己合并同名项（pet_evolve.js 里那套合并逻辑现在可以留着不管，服务端兜了）。
   * items: [{ name, amount }, ...]；返回 { ok, error? }，语义与 spend 一致。
   * 空清单 / 全是 0 → 直接 { ok:true }，**不发请求**（涅槃可以一分钱不花）。 */
  async function spendMany(items) {
    const list = (items || []).filter(it => it && it.name && it.amount > 0);
    if (!list.length) return { ok: true };
    const need = {};
    for (const it of list) need[it.name] = (need[it.name] || 0) + it.amount;
    for (const n of Object.keys(need)) {
      if ((local[n] || 0) < need[n]) return { ok: false, error: `${n} 不足` };
    }
    // 同 spend：先把还没上报的掉落补上去，否则云端余额里还没有这批，直接扣会误报「余额不足」
    await flushMaterials();
    const user = await Supabase.getCurrentUser();
    if (!user) return { ok: false, error: '请先登录' };
    let res;
    try {
      // ⚠️ jsonb 参数直接传数组，别 JSON.stringify（PostgREST 只认表级权限那条坑）
      res = await Supabase.getClient().rpc('spend_materials', {
        p_items: list.map(it => ({ name: it.name, amount: it.amount }))
      });
    } catch (e) { res = { data: null, error: e }; }
    const error = res && res.error;
    /* 旧库没有这个函数（迁移没跑）→ 退回单体版逐个扣：慢一点、可能留下中间态，但功能不能直接崩。
     * ⚠️ 只对「函数不存在」这一类错降级；扣款失败（余额不足）绝不能降级重试，那是重复扣款。 */
    if (error && /PGRST202|Could not find the function|function .* does not exist/i.test(String(error.message || '') + String(error.code || ''))) {
      for (const it of list) {
        const one = await spend(it.name, it.amount);
        if (!one.ok) return one;
      }
      return { ok: true };
    }
    if (error) {
      const msg = String(error.message || '');
      if (msg.indexOf('INSUFFICIENT_MATERIAL') >= 0) {
        const who = msg.split('INSUFFICIENT_MATERIAL:')[1];
        return { ok: false, error: who ? `${who} 不足（云端）` : '材料不足（云端）' };
      }
      return { ok: false, error: msg || '材料扣减失败' };
    }
    if (res && res.data === false) return { ok: false, error: '材料不足（云端）' };
    for (const n of Object.keys(need)) applyLocalDeduct(n, need[n]);
    return { ok: true };
  }

  /* ---------- 本地 / 云端拆分（性能优化：本地先行 → 异步同步 → 失败回滚用） ---------- */
  // 纯本地累加（不回写云端；界面立即生效，云同步单独调 cloudGain）
  // bound：这批算绑定（任务产出），只影响「能交易多少」，总量一样加
  function gainLocal(name, amount, bound) {
    amount = amount || 1;
    local[name] = (local[name] || 0) + amount;
    if (bound) boundLocal[name] = (boundLocal[name] || 0) + amount;
  }
  /* 本地扣减统一走这里：**绑定的先扣**（绑定不可交易，先消耗掉对玩家更有利，
   * 也与云端 spend_material / spend_materials 的 greatest(0, bound_qty - n) 同口径）。 */
  function applyLocalDeduct(name, amount) {
    if (boundLocal[name]) {
      boundLocal[name] -= amount;
      if (boundLocal[name] <= 0) delete boundLocal[name];
    }
    local[name] -= amount;
    if (local[name] <= 0) delete local[name];
  }
  // 纯本地扣减（购买后同步扣材料 / 云同步失败回滚用）；余额不足返回 { ok:false } 不改动
  function spendLocal(name, amount) {
    amount = amount || 1;
    if ((local[name] || 0) < amount) return { ok: false, error: `${name} 不足` };
    applyLocalDeduct(name, amount);
    return { ok: true };
  }
  // 仅云端累加（RPC add_material；本地已由 gainLocal 加过，这里不重复加本地）
  // bound：这次上报的量里有多少是绑定的（云端记进 bound_qty 列）
  async function cloudGain(name, amount, bound) {
    amount = amount || 1;
    const bn = Math.max(0, Math.min(Math.round(Number(bound) || 0), amount));
    const user = await Supabase.getCurrentUser();
    if (!user) return { ok: true, cloud: false }; // 未登录：本地累计即可
    const { error } = await Supabase.getClient().rpc('add_material', { p_name: name, p_amount: amount, p_bound: bn });
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
    const nextBound = {};
    for (const r of rows || []) {
      const q = Number(r && r.quantity) || 0;
      /* 只收正数：云端会留着 quantity=0 的空行（扣到 0 不删行），
       * 收进来就在本地凭空造出一个「数量 0」的键 → 背包素材区出现「×0 的图标」
       * （2026-09-14 用户实报：「用掉之后图标还在，显示 0」）。
       * gain / spend / spendLocal 一直都是「到 0 就删键」，这里补齐同一条不变式。 */
      if (q <= 0) continue;
      next[r.name] = (next[r.name] || 0) + q;
      // 绑定数量（云端列 bound_qty）：同类多行合并时一并累加，且不得超过本品种总数
      const b = Math.min(Number(r && r.bound_qty) || 0, q);
      if (b > 0) nextBound[r.name] = (nextBound[r.name] || 0) + b;
    }
    // 把还没上报的补回去：那是当前这个号已经拿到、但云端还没记账的部分。
    // 不加回去的话，玩家在上报窗口（4 秒）内刷新页面，这批掉落就凭空没了
    // ——云端查不到（还没报），本地又被云端快照覆盖。
    // 换号走 clearAll()（先补报再清空），不会串到别的号上。
    for (const n of Object.keys(pending)) next[n] = (next[n] || 0) + pending[n];
    for (const n of Object.keys(pendingBound)) nextBound[n] = (nextBound[n] || 0) + pendingBound[n];
    // 不变式：local 里只存正数（数量为 0 的品种 = 没有这个品种）
    for (const n of Object.keys(next)) if (!(next[n] > 0)) delete next[n];
    // 不变式：绑定只记在还存在的品种上，且 ≤ 总数（与云端 check 约束同口径）
    for (const n of Object.keys(nextBound)) {
      if (!(nextBound[n] > 0) || !next[n]) delete nextBound[n];
      else if (nextBound[n] > next[n]) nextBound[n] = next[n];
    }
    local = next;
    boundLocal = nextBound;
  }

  // 登出 / 换号：先把还没上报的补报到当前号（否则这批收益白丢），再彻底清空。
  async function clearAll() {
    await flushMaterials();
    local = {};
    boundLocal = {};
    pending = {};
    pendingBound = {};
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  /* ---------- 查询 ---------- */
  const getQuantity = name => local[name] || 0;
  const getLocal = () => ({ ...local });
  // 绑定数量 / 可交易数量（市场上架、赠送等只能用 free 这部分）
  const getBoundQuantity = name => boundLocal[name] || 0;
  const getFreeQuantity = name => Math.max(0, (local[name] || 0) - (boundLocal[name] || 0));
  const getBoundLocal = () => ({ ...boundLocal });

  /* ---------- 云端读取（登录后调用） ---------- */
  async function loadCloudMaterials() {
    const user = await Supabase.getCurrentUser();
    if (!user) return { data: [], error: null };
    return Supabase.getClient().from('materials')
      .select('name,quantity,bound_qty')
      .order('created_at', { ascending: true });
  }

  /* ---------- 对外 API ---------- */
  window.Materials = {
    gain, spend, spendMany, gainLocal, spendLocal, cloudGain, cloudSpend, flushMaterials, clearAll,
    getQuantity, setCloudMaterials, getLocal, loadCloudMaterials,
    getBoundQuantity, getFreeQuantity, getBoundLocal, isExpPack
  };
})();
