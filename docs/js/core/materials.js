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

  /* ---------- 获得材料（掉落时由 drop.js 调用） ---------- */
  // 返回 { ok, cloud }：cloud=true 表示已同步云端；云端失败不阻塞本地（下次登录会覆盖，可接受）
  async function gain(name, amount) {
    gainLocal(name, amount);
    return cloudGain(name, amount);
  }

  /* ---------- 消耗材料（融合等用途调用） ---------- */
  // 先校验本地余额 → 调云端 spend_material RPC 原子扣减（余额不足返回 false 不动）
  // 云端扣成功才改本地计数（云端权威，避免本地扣了云端没扣的不同步）
  // 返回 { ok, error? }
  async function spend(name, amount) {
    amount = amount || 1;
    if ((local[name] || 0) < amount) return { ok: false, error: `${name} 不足` };
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
    if (error) return { ok: true, cloud: false, error };
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
    local = {};
    for (const r of rows || []) local[r.name] = (local[r.name] || 0) + r.quantity;
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
    gain, spend, gainLocal, spendLocal, cloudGain, cloudSpend,
    getQuantity, setCloudMaterials, getLocal, loadCloudMaterials
  };
})();
