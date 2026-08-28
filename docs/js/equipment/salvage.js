/* ============================================================
 * salvage.js v2.0.0 —— 装备管理：锁定 + 一键分解
 * 职责：
 *  1. 锁定/解锁装备（locked 状态存库 equip_items.locked，防分解）
 *  2. 一键分解预览：统计可分解件数与预计产出（按稀有度，config.salvage）
 *  3. 一键分解执行：只分解「未锁定 且 未在售」的装备
 *     - 白装 → 无产出；蓝装 → 强化石；金装 → 祝福石（通货已移除）
 *     - 材料经 Materials.gain 本地 + 云端原子累加；装备云端行批量删除
 * 依赖：equipment.js（背包）、materials.js（材料）、
 *       market.js（在售检查）、items.js（云端删除）
 * 状态：无（全部走各模块接口）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { getInventory, addToInventory, removeFromInventory, rarityOf, affixCount } = window.Equipment;
  function rarityForCount(eq) {
    const count = affixCount({ affixes: eq && eq.affixes });
    return count >= 4 ? 'gold' : count >= 2 ? 'blue' : 'white';
  }
  function syncedRarity(eq) {
    const id = rarityForCount(eq);
    return (Config.equipment.rarities || []).find(r => r.id === id) || rarityOf(eq);
  }
  const { gainLocal, spendLocal, cloudGain } = window.Materials;
  const isItemListed = () => window.Market && window.Market.isItemListed ? window.Market.isItemListed.apply(window.Market, arguments) : false;
  const Items = window.Items;

  // 可分解判定：未锁定 且 未在售（在售装备分解会让挂单快照失效）
  function isSalvageable(eq) {
    return !eq.locked && !isItemListed(eq.cloudId);
  }

  /* ---------- 锁定 / 解锁 ---------- */
  // 翻转锁定状态；有云端 id 时同步 equip_items.locked（失败只记日志，本地照常）
  async function toggleLock(eq) {
    eq.locked = !eq.locked;
    if (eq.cloudId) {
      const { error } = await Items.updateCloudItem(eq, { locked: eq.locked });
      if (error) console.warn('云端锁定状态同步失败：', error.message);
    }
    return { ok: true, locked: eq.locked };
  }

  /* ---------- 分解预览（确认框用） ---------- */
  // previewEquips(equips)：按指定装备列表统计 { count, byRarity, gains, skipped }
  // skipped = 列表中不可分解的件数（已锁定/在售）
  function previewEquips(equips) {
    const S = Config.salvage;
    const byRarity = { white: 0, blue: 0, gold: 0 };
    let skipped = 0;
    const gains = {};
    for (const eq of equips || []) {
      if (!isSalvageable(eq)) { skipped++; continue; }
      const rarity = syncedRarity(eq);
      const r = S[rarity.id] || S.white;
      byRarity[rarity.id] = (byRarity[rarity.id] || 0) + 1;
      for (const k in r) gains[k] = (gains[k] || 0) + r[k];
    }
    const count = byRarity.white + byRarity.blue + byRarity.gold;
    return { count, byRarity, gains, skipped };
  }
  // 一键分解预览（全部可分解装备）
  function getSalvagePreview() {
    return previewEquips(getInventory());
  }

  /* ---------- 分解结算（本地先行 → 云端合并 → 失败回滚） ---------- */
  // targets 必须是已过滤可分解的装备数组
  async function settleSalvage(targets) {
    const S = Config.salvage;
    // 1. 本地先行：汇总产出 → 本地一次性到账 + 移除装备
    const gains = {};
    const cloudIds = [];
    for (const eq of targets) {
      const rarity = syncedRarity(eq);
      const r = S[rarity.id] || S.white;
      for (const k in r) gains[k] = (gains[k] || 0) + r[k];
      if (eq.cloudId) cloudIds.push(eq.cloudId);
      removeFromInventory(eq.id);
    }
    for (const k in gains) gainLocal(Config.craft[k].name, gains[k]);

    // 2. 云端同步（合并：材料按种类各 1 次 RPC + 装备批量删 1 次 IN 请求）
    const syncTasks = Object.keys(gains).map(k => cloudGain(Config.craft[k].name, gains[k]));
    const [dRes, ...matRes] = await Promise.all([
      cloudIds.length ? Items.deleteCloudItems(cloudIds) : Promise.resolve({ data: null, error: null }),
      ...syncTasks
    ]);
    const syncErr = (dRes && dRes.error) || matRes.find(r => r && r.error);

    // 3. 同步失败 → 回滚本地（材料扣回、装备放回），提示错误
    if (syncErr) {
      for (const k in gains) spendLocal(Config.craft[k].name, gains[k]);
      for (let i = targets.length - 1; i >= 0; i--) addToInventory(targets[i]); // 倒序放回，保持原顺序
      return { ok: false, error: '云端同步失败，已回滚：' + (syncErr.message || syncErr), rolledBack: true };
    }
    return { ok: true, count: targets.length, gains };
  }

  /* ---------- 一键分解（全部可分解） ---------- */
  async function salvageAll() {
    const targets = getInventory().filter(isSalvageable);
    if (!targets.length) return { ok: false, error: '没有可分解的装备（已锁定的跳过）' };
    return settleSalvage(targets);
  }

  /* ---------- 批量分解（指定装备列表） ---------- */
  // salvageList(equips)：分解指定列表中的未锁定/未在售装备；返回 { ok, count, gains, skipped }
  async function salvageList(equips) {
    const list = equips || [];
    const targets = list.filter(isSalvageable);
    const skipped = list.length - targets.length;
    if (!targets.length) return { ok: false, error: '选中的装备都不可分解（已锁定/在售）', skipped };
    const res = await settleSalvage(targets);
    return { ...res, skipped };
  }

  /* ---------- 对外 API ---------- */
  window.Salvage = { isSalvageable, toggleLock, getSalvagePreview, previewEquips, salvageAll, salvageList };
})();
