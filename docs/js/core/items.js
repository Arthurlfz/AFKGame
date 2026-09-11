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
  const { replaceInventory, normalizeAffixes, syncRarity } = window.Equipment;
  const Supabase = window.Supabase;
  const db = () => Supabase.getClient();

  /* ---------- 写入云端（登录时调用；掉落装备后由 drop.js 调） ---------- */
  async function saveItem(eq) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { data: null, error: new Error('未登录') };
    const { data, error } = await db().from('equip_items').insert({
      user_id: user.id,
      name: eq.name, slot: eq.slot,
      base_stat: eq.base, affixes: { ...eq.affixes, _ilvl: eq.ilvl ?? null },
      tier: eq.tier, rarity: eq.rarity.id,
      locked: !!eq.locked,
      identified: eq.identified !== false, // 掉落未鉴定(false)持久化；undefined/true 一律按已鉴定存（旧调用兜底）
      soul_affix: eq.soulAffix || null
    }).select().single();
    if (!error && data && data.id) eq.cloudId = data.id; // 回写云端 id，供上架
    return { data, error };
  }

  /* ---------- 读取云端 ---------- */
  async function loadCloudItems() {
    return db().from('equip_items').select('*').order('created_at', { ascending: true });
  }
  // 更新云端装备字段（打造后词缀变化；需已登录 + 装备有 cloudId）
  /* opts.verify（2026-09-11 审计第 3 批）：同 updatePet —— 给「先扣通货、后写云端」的
   * 不可逆链条用（打造 / 魂铸）。不带 .select() 时 0 行更新与成功无法区分，
   * 打造会报成功但云端词缀没落库，刷新即回退（玩家白花石头）。
   * 默认【不开】：鉴定/解锁这类"只是没同步"的调用点不需要，
   * 而测试里有多处直接用假 cloudId 造装备，全局开会让它们因"测试没建档"而变红。 */
  async function updateCloudItem(eq, patch, opts) {
    if (!eq.cloudId) return { data: null, error: new Error('装备未同步云端') };
    if (patch && patch.affixes) patch.affixes = { ...patch.affixes, _ilvl: eq.ilvl ?? null, _lockPrefix: !!eq.lockPrefix, _lockSuffix: !!eq.lockSuffix };
    const verify = !!(opts && opts.verify);
    const q = db().from('equip_items').update(patch).eq('id', eq.cloudId);
    const res = verify ? await q.select('id') : await q;
    if (verify && !res.error && !(res.data && res.data.length)) {
      return { data: null, error: new Error('这件装备已不在你的存档里（可能在别的标签页被出售或分解），本次改动未生效') };
    }
    return res;
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
    // 装备等级(ilvl)随 affixes JSON 的 _ilvl 键持久化（避免加 DB 列）；旧装备无则 null → 兜底换算
    const ilvl = (row.affixes && row.affixes._ilvl) != null ? row.affixes._ilvl : null;
    const norm = normalizeAffixes(row.affixes);
    // 云端 base_stat 兜底（早期数据可能为 null/缺字段）：给默认攻击基底，避免属性计算炸（曾导致回血时钟中断）
    const base = (row.base_stat && row.base_stat.type)
      ? row.base_stat
      : { type: 'atk', label: '攻击', value: 0 };
    const eq = {
      id: Date.now() + Math.floor(Math.random() * 1000), // 本地唯一 id（与 uid++ 错开）
      cloudId: row.id,
      name: row.name || '旧装备', slot: row.slot || '武器',
      tier: row.tier || 4,
      ilvl: ilvl != null ? Number(ilvl) : null,
      rarity: { id: 'white', label: '白', color: '#b2aa9c' }, // 占位，下面按词缀条数统一重算
      base,
      affixes: { prefix: norm.prefix, suffix: norm.suffix },
      locked: !!row.locked, // 锁定状态（防分解，存库）
      // POE 锁前锁后（2026-09-04）：affixes JSON 附加键 _lockPrefix/_lockSuffix（与 _ilvl 同模式，零 DB 改动）
      lockPrefix: !!(row.affixes && row.affixes._lockPrefix),
      lockSuffix: !!(row.affixes && row.affixes._lockSuffix),
      // 魂铸词缀（DB 列 soul_affix → 内存字段 soulAffix 驼峰；旧库无列则 null）
      soulAffix: row.soul_affix || null,
      // 未鉴定状态（DB 列 identified，默认 true；undefined 视为已鉴定，兼容迁移前的旧行）
      identified: row.identified !== false
    };
    syncRarity(eq); // 颜色一律按词缀条数推导（单一来源），覆盖旧数据或任何写入偏差，刷新页面也不回退
    const dTier = DEFAULT_AFFIX_TIER[eq.rarity.id] || 4;
    const fix = a => (a && a.type ? (a.tier ? a : { ...a, tier: dTier }) : null); // 清洗 null/缺 type 脏词缀
    eq.affixes.prefix = eq.affixes.prefix.map(fix).filter(Boolean).map(a => ({ ...a, value: a.value || 0 }));
    eq.affixes.suffix = eq.affixes.suffix.map(fix).filter(Boolean).map(a => ({ ...a, value: a.value || 0 }));
    return eq;
  }
  // 用云端列表整体替换本地背包（云端是权威）
  function setCloudItems(rows) {
    replaceInventory((rows || []).map(fromCloud));
  }

  /* ---------- 对外 API ---------- */
  window.Items = { saveItem, loadCloudItems, updateCloudItem, deleteCloudItems, setCloudItems, fromCloud };
})();
