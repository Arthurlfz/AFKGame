/* ============================================================
 * equipment.js —— 装备系统
 * 职责：
 *  1. 装备随机生成（部位 / 基底属性 / 稀有度白蓝金 / 1~3条随机词缀）
 *  2. 背包管理（掉落入库、穿脱进出）
 *  3. 稀有度挑选（按怪的 rarityWeights）与装备加成计算
 * 状态：背包 inventory 仅本模块持有
 * 依赖：无（最先加载，故通用工具函数也定义在此并挂 window.Util）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;

  /* ---------- 通用工具（本文件最先加载，故放这里） ---------- */
  const Util = {
    randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    pickWeighted(items) { // items: [{weight,...}]，按权重随机
      let total = items.reduce((s, i) => s + i.weight, 0), r = Math.random() * total;
      for (const it of items) { if ((r -= it.weight) < 0) return it; }
      return items[0];
    }
  };
  window.Util = Util;

  /* ---------- 装备规则（数值来自 config.js，名字/词缀池留在本地） ---------- */
  const SLOTS = ['武器', '防具', '饰品'];
  const B = Config.equipment.baseValues;
  const SLOT_INFO = {
    武器: { names: ['短剑', '战斧', '长弓', '法杖', '铁锤', '长枪'],
            bases: [{ type: 'atk', label: '攻击', min: B.武器.atk[0], max: B.武器.atk[1] }] },
    防具: { names: ['皮甲', '锁甲', '铁盾', '胸甲', '披风'],
            bases: [{ type: 'def', label: '防御', min: B.防具.def[0], max: B.防具.def[1] },
                    { type: 'hp',  label: '生命', min: B.防具.hp[0],  max: B.防具.hp[1] }] },
    饰品: { names: ['护符', '戒指', '项链', '徽章', '坠饰'],
            bases: [{ type: 'spd', label: '速度', min: B.饰品.spd[0], max: B.饰品.spd[1] },
                    { type: 'atk', label: '攻击', min: B.饰品.atk[0], max: B.饰品.atk[1] }] }
  };
  // 词缀池：每条词缀带 category（前缀 prefix / 后缀 suffix）
  // 前缀：攻击 / 生命 / 防御（最多 3 条）；后缀：速度 / 暴击率 / 吸血（最多 3 条）
  // 装备总词缀上限 6 条（生成数量仍由各 rarity 的 affixMin/affixMax 控制，见 generateEquipment）
  const AFFIX_POOL = [
    { type: 'atk', label: '攻击', category: 'prefix' },
    { type: 'hp', label: '生命', category: 'prefix' },
    { type: 'def', label: '防御', category: 'prefix' },
    { type: 'spd', label: '速度', category: 'suffix' },
    { type: 'crit', label: '暴击率', category: 'suffix' },
    { type: 'lifesteal', label: '吸血', category: 'suffix' },
    { type: 'hit', label: '命中', category: 'suffix' },
    { type: 'dodge', label: '闪避', category: 'suffix' }
  ];
  // 词缀归类：按 type 返回 'prefix' | 'suffix'（未知类型兜底为前缀）
  function affixCategory(type) {
    const a = AFFIX_POOL.find(x => x.type === type);
    return a ? a.category : 'prefix';
  }

  /* ---------- 词缀容器兼容层 ----------
   * 新结构：eq.affixes = { prefix: [Affix], suffix: [Affix] }（前缀最多 3、后缀最多 3、总共最多 6）
   * 旧数据（历史装备）可能是扁平数组 [Affix]，normalizeAffixes 在读取时自动归类，保证向后兼容。
   * Affix = { type, label, tier, value }（无需再存 category，桶本身就代表前后缀）
   */
  // 任意形态 → 标准嵌套 {prefix,suffix}（旧扁平数组按类型归类；清洗 null/缺 type 的脏词缀）
  function normalizeAffixes(raw) {
    if (!raw) return { prefix: [], suffix: [] };
    const clean = a => (a && a.type ? { ...a } : null);
    if (Array.isArray(raw)) {
      const out = { prefix: [], suffix: [] };
      for (const a of raw) { const c = clean(a); if (c) out[affixCategory(c.type)].push(c); }
      return out;
    }
    return {
      prefix: (Array.isArray(raw.prefix) ? raw.prefix : []).map(clean).filter(Boolean),
      suffix: (Array.isArray(raw.suffix) ? raw.suffix : []).map(clean).filter(Boolean)
    };
  }
  // 任意形态 → 扁平数组（展示 / 市场快照用）
  function flattenAffixes(affixes) {
    if (!affixes) return [];
    if (Array.isArray(affixes)) return affixes.map(a => ({ ...a }));
    return [...(affixes.prefix || []), ...(affixes.suffix || [])].map(a => ({ ...a }));
  }
  // 总词缀数
  function affixCount(eq) {
    const a = eq.affixes || {};
    return (a.prefix ? a.prefix.length : 0) + (a.suffix ? a.suffix.length : 0);
  }
  // 带位置遍历 [{bucket,index,aff}]（打造需原地修改某条词缀）
  function affixLocations(eq) {
    const loc = [];
    const a = eq.affixes || {};
    for (const b of ['prefix', 'suffix']) (a[b] || []).forEach((aff, i) => loc.push({ bucket: b, index: i, aff }));
    return loc;
  }

  let uid = 1;
  let inventory = []; // 背包：装备数组，新掉落在前

  /* ---------- 装备生成 ---------- */
  // 按稀有度权重挑选品质（weights: {white, blue, gold}，来自 config 怪物定义）
  function pickRarity(weights) {
    const items = Config.equipment.rarities.map(r => ({ ...r, weight: (weights && weights[r.id]) || 0 }));
    return Util.pickWeighted(items);
  }
  // T 阶按稀有度映射（展示用；金色=最强档）：金→T1、蓝→T2、白→T4
  const TIER_BY_RARITY = { gold: 1, blue: 2, white: 4 };
  // generateEquipment(rarity)：按指定稀有度生成装备（rarity 来自 pickRarity）
  // 白装 1 条词缀、蓝装 1~2 条、金装 2~3 条；词缀从池中抽取不重复
  // 每条词缀带 T 阶（T1 最强 → T5 最弱，范围按稀有度），数值由 T 阶决定（config.equipment.affixTiers）
  function generateEquipment(rarity) {
    const slot = Util.pick(SLOTS);
    const info = SLOT_INFO[slot];
    const base = Util.pick(info.bases);
    const baseVal = Util.randInt(base.min, base.max);
    const count = Util.randInt(rarity.affixMin, rarity.affixMax);
    const pool = [...AFFIX_POOL];
    const range = Config.equipment.affixTierByRarity[rarity.id] || [4, 5];
    const affixes = { prefix: [], suffix: [] }; // 词缀按前后缀分桶（各最多 3 条）
    for (let i = 0; i < count && pool.length; i++) {
      const aff = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; // 去重
      const tier = Util.randInt(range[0], range[1]);
      const T = Config.equipment.affixTiers.find(t => t.tier === tier);
      affixes[affixCategory(aff.type)].push({
        type: aff.type, label: aff.label,
        tier,
        value: Util.randInt(T.min, T.max) // 数值 = 该 T 阶区间随机
      });
    }
    return {
      id: uid++, name: Util.pick(info.names), slot,
      tier: TIER_BY_RARITY[rarity.id] || 4,
      rarity: { id: rarity.id, label: rarity.label, color: rarity.color },
      base: { type: base.type, label: base.label, value: baseVal },
      affixes,
      cloudId: null, // 云端 items.id（存档/市场上架用）
      locked: false, // 锁定：一键分解跳过（状态存库 equip_items.locked）
      fresh: true    // 新掉落标记：查看详情后清除（纯本地，不存库）
    };
  }

  /* ---------- 背包管理 ---------- */
  function getInventory() { return inventory; }
  function addToInventory(eq) { inventory.unshift(eq); }
  function removeFromInventory(id) {
    const i = inventory.findIndex(e => e.id === id);
    if (i >= 0) inventory.splice(i, 1);
  }
  // 云端装备恢复：整体替换本地背包（items.js 调用）
  function replaceInventory(equips) { inventory = equips; }

  /* ---------- 穿脱（pet 对象由调用方传入，本模块不持有宠物状态） ---------- */
  // 返回 { equipped, replaced }，replaced 为被顶替回背包的旧装备（可能为 null）
  function equipItem(pet, id) {
    const i = inventory.findIndex(e => e.id === id);
    if (i < 0) return null;
    const eq = inventory[i];
    // 上架中的装备不可穿戴（需先取回），避免挂单快照与实物不一致
    const M = window.Market;
    if (M && M.isItemListed && eq.cloudId && M.isItemListed(eq.cloudId)) {
      if (window.UI && window.UI.showToast) window.UI.showToast('⚠️ 已上架的装备不能穿戴', '请先在市场取回');
      return null;
    }
    const old = pet.equipment[eq.slot];
    if (old) inventory[i] = old;      // 同部位旧装备回背包
    else inventory.splice(i, 1);
    pet.equipment[eq.slot] = eq;
    return { equipped: eq, replaced: old };
  }
  // 返回脱下的装备（null 表示该部位本来就空）
  function unequip(pet, slot) {
    const eq = pet.equipment[slot];
    if (!eq) return null;
    pet.equipment[slot] = null;
    inventory.unshift(eq);
    return eq;
  }

  /* ---------- 加成计算（供 pet.js 的 getStats 使用） ---------- */
  // 返回 { flat: {atk,hp,def,spd}, pct: {...} }，词缀数组逐条累加
  // 防御：旧/脏数据装备缺 base 或缺 value 时跳过该条，保证属性计算不抛错、不产生 NaN
  function getEquipBonuses(pet) {
    const flat = { atk: 0, hp: 0, def: 0, spd: 0 };
    const pct = { atk: 0, hp: 0, def: 0, spd: 0 };
    for (const slot of SLOTS) {
      const eq = pet.equipment[slot];
      if (!eq || !eq.base) continue;
      flat[eq.base.type] = (flat[eq.base.type] || 0) + (eq.base.value || 0);
      for (const aff of flattenAffixes(eq.affixes)) pct[aff.type] = (pct[aff.type] || 0) + (aff.value || 0);
    }
    return { flat, pct };
  }

  /* ---------- 展示文案 ---------- */
  function describeItem(eq) {
    const affixes = flattenAffixes(eq.affixes).map(a => `${a.label}+${a.value}%`).join(' ');
    const b = baseOf(eq);
    return `${eq.slot}｜${b.label}+${b.value}｜${affixes}`;
  }

  // 稀有度兜底：旧存档装备的 rarity 可能是空对象/字符串/缺字段，统一返回合法 {id,label,color}（缺省=白装）
  function rarityOf(eq) {
    const r = eq && eq.rarity;
    if (r && r.id && r.label && r.color) return r;
    // 兼容 rarity 是字符串（旧数据存了 id）
    if (typeof r === 'string') {
      const hit = Config.equipment.rarities.find(x => x.id === r);
      if (hit) return hit;
    }
    return Config.equipment.rarities[0]; // 白装
  }
  // 基底兜底：旧装备 base 可能缺字段，返回合法 {type,label,value}
  function baseOf(eq) {
    const b = eq && eq.base;
    if (b && b.label) return b;
    return { type: 'atk', label: '攻击', value: 0 };
  }

  /* ---------- 对外 API ---------- */
  window.Equipment = {
    SLOTS, AFFIX_POOL, affixCategory, normalizeAffixes, flattenAffixes, affixCount, affixLocations,
    pickRarity, generateEquipment, getInventory, addToInventory, removeFromInventory, replaceInventory,
    equipItem, unequip, getEquipBonuses, describeItem, rarityOf, baseOf
  };
})();
