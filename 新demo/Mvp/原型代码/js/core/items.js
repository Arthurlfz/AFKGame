/* ============================================================
 * items.js —— 装备存档
 * 职责：
 *  1. 掉落装备写入 items 表（归属当前玩家），回写 cloudId
 *  2. 从云端读取玩家装备列表，整体替换本地背包
 *  3. 云端行 ↔ 装备对象转换（含稀有度还原）
 * 依赖：equipment.js（背包/装备结构）、supabase.js（数据层）、config.js（稀有度表）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { replaceInventory, normalizeAffixes } = window.Equipment;
  const Supabase = window.Supabase;
  const db = () => Supabase.getClient();

  /* ---------- 写入云端（登录时调用；掉落装备后由 drop.js 调） ---------- */
  async function saveItem(eq) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { data: null, error: new Error('未登录') };
    const { data, error } = await db().from('equip_items').insert({
      user_id: user.id,
      name: eq.name, slot: eq.slot,
      base_stat: eq.base, affixes: eq.affixes,
      tier: eq.tier, rarity: eq.rarity.id,
      locked: !!eq.locked
    }).select().single();
    if (!error && data && data.id) eq.cloudId = data.id; // 回写云端 id，供上架
    return { data, error };
  }

  /* ---------- 读取云端 ---------- */
  async function loadCloudItems() {
    return db().from('equip_items').select('*').order('created_at', { ascending: true });
  }
  // 更新云端装备字段（打造后词缀变化；需已登录 + 装备有 cloudId）
  async function updateCloudItem(eq, patch) {
    if (!eq.cloudId) return { data: null, error: new Error('装备未同步云端') };
    return db().from('equip_items').update(patch).eq('id', eq.cloudId);
  }
  // 批量删除云端装备（分解用；空数组直接返回成功）。
  // 合并为一次 IN 请求（PostgREST），避免逐条删除的网络开销；RLS 保证只能删自己的
  async function deleteCloudItems(cloudIds) {
    const ids = (cloudIds || []).filter(Boolean);
    if (!ids.length) return { data: null, error: null };
    return db().from('equip_items').delete().in('id', ids);
  }

  /* ---------- 云端行 → 装备对象 ---------- */
  // 旧数据兼容：历史词缀没有 tier 字段，按稀有度补默认档（金 T2 / 蓝 T4 / 白 T5）
  const DEFAULT_AFFIX_TIER = { gold: 2, blue: 4, white: 5 };
  function fromCloud(row) {
    const rarity = Config.equipment.rarities.find(r => r.id === row.rarity) || Config.equipment.rarities[0];
    const dTier = DEFAULT_AFFIX_TIER[rarity.id] || 4;
    const fix = a => (a && a.type ? (a.tier ? a : { ...a, tier: dTier }) : null); // 清洗 null/缺 type 脏词缀
    const norm = normalizeAffixes(row.affixes);
    // 云端 base_stat 兜底（早期数据可能为 null/缺字段）：给默认攻击基底，避免属性计算炸（曾导致回血时钟中断）
    const base = (row.base_stat && row.base_stat.type)
      ? row.base_stat
      : { type: 'atk', label: '攻击', value: 0 };
    return {
      id: Date.now() + Math.floor(Math.random() * 1000), // 本地唯一 id（与 uid++ 错开）
      cloudId: row.id,
      name: row.name || '旧装备', slot: row.slot || '武器',
      tier: row.tier || 4,
      rarity: { id: rarity.id, label: rarity.label, color: rarity.color },
      base,
      affixes: {
        prefix: norm.prefix.map(fix).filter(Boolean).map(a => ({ ...a, value: a.value || 0 })),
        suffix: norm.suffix.map(fix).filter(Boolean).map(a => ({ ...a, value: a.value || 0 }))
      },
      locked: !!row.locked // 锁定状态（防分解，存库）
    };
  }
  // 用云端列表整体替换本地背包（云端是权威）
  function setCloudItems(rows) {
    replaceInventory((rows || []).map(fromCloud));
  }

  /* ---------- 对外 API ---------- */
  window.Items = { saveItem, loadCloudItems, updateCloudItem, deleteCloudItems, setCloudItems, fromCloud };
})();
