/* ============================================================
 * equipment.js v2.0.0 —— 装备系统
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
    randFloat(a, b) { return a + Math.random() * (b - a); }, // 小数区间随机（randInt 是取整的，传小数边界会出错值）
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    pickWeighted(items) { // items: [{weight,...}]，按权重随机
      let total = items.reduce((s, i) => s + i.weight, 0), r = Math.random() * total;
      for (const it of items) { if ((r -= it.weight) < 0) return it; }
      return items[0];
    }
  };
  window.Util = Util;

  /* ---------- 装备规则（数值来自 config.js，名字/词缀池留在本地） ---------- */
  const SLOTS = ['武器', '戒指', '项链', '头盔', '护甲', '盾牌', '靴子', '腰带', '斗篷', '饰品', '护符', '徽章'];
  const B = Config.equipment.baseValues;
  const LABELS = { atk: '攻击', hp: '生命', def: '防御', spd: '速度', crit: '暴击率', critDamage: '暴击伤害', hit: '命中', dodge: '闪避', lifesteal: '吸血' };
  const NAMES = {
    武器: ['短剑', '战斧', '长弓', '法杖'], 戒指: ['铁戒', '骨戒'], 项链: ['狼牙项链', '灵魂项链'],
    头盔: ['铁盔', '骨盔'], 护甲: ['锁甲', '胸甲'], 盾牌: ['圆盾', '塔盾'],
    靴子: ['战靴', '影靴'], 腰带: ['重腰带', '猎手腰带'], 斗篷: ['黑斗篷', '影纱'],
    饰品: ['徽记坠饰', '战斗饰品'], 护符: ['生命护符', '吸血护符'], 徽章: ['铁徽章', '王者徽章']
  };
  const SLOT_INFO = Object.fromEntries(SLOTS.map(slot => [slot, {
    names: NAMES[slot] || [slot],
    bases: Object.entries(B[slot] || {}).map(([type, value]) => ({ type, label: LABELS[type] || type, value }))
  }]));
  // 前缀≤3：攻击/生命/防御；后缀≤3：机制属性与资源属性。
  // 词缀权重（POE 式：基础战斗词缀权重高常出，机制中，资源/极品词缀权重低稀出）
  const AFFIX_POOL = [
    { type: 'atk', label: '攻击', category: 'prefix', weight: 100 },
    { type: 'hp', label: '生命', category: 'prefix', weight: 100 },
    { type: 'def', label: '防御', category: 'prefix', weight: 100 },
    { type: 'spd', label: '速度', category: 'suffix', weight: 60 },
    { type: 'crit', label: '暴击率', category: 'suffix', weight: 55 },
    { type: 'critDamage', label: '暴击伤害', category: 'suffix', weight: 45 },
    { type: 'hit', label: '命中', category: 'suffix', weight: 50 },
    { type: 'dodge', label: '闪避', category: 'suffix', weight: 40 },
    { type: 'lifesteal', label: '吸血', category: 'suffix', weight: 35 },
    { type: 'dropQty', label: '掉落数量', category: 'suffix', weight: 15 },
    { type: 'dropRare', label: '掉落稀有度', category: 'suffix', weight: 12 },
    { type: 'matDrop', label: '材料掉率', category: 'suffix', weight: 10 }
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
  // 词缀 T 阶抽取（唯一入口）：按 config.equipment.affixTierWeights 的稀有度权重抽。
  // 掉落 / 重铸 / 增缀 都调这里 —— 以前重铸是 randInt(1,5) 且不看成色，白装能洗出全 T1。
  function rollAffixTier(rarityId, ilvl) {
    const w = (Config.equipment.affixTierWeights || {})[rarityId];
    const entries = Object.entries(w || { 4: 60, 5: 40 });
    const total = entries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
    let r = Math.random() * total;
    let picked = Number(entries[entries.length - 1][0]);
    for (const [t, v] of entries) { r -= (Number(v) || 0); if (r < 0) { picked = Number(t); break; } }
    // 装备等级解锁（POE 式 ilvl gate）：T 阶要装备等级达到门槛才能 roll 出。
    // ilvl 为空视为 100（存量装备不追溯，避免刷新后降级破坏市场）；低于门槛抽到高档 T → 降到允许的最高 T。
    const lv = ilvl == null ? 100 : Number(ilvl);
    const gates = (Config.equipment.affixIlvlGates || {});
    let best = 5;
    for (const [t, g] of Object.entries(gates)) { if (lv >= Number(g) && Number(t) < best) best = Number(t); }
    if (picked < best) picked = best;
    return picked;
  }
  // 图档 → 怪等级下限（兜底换算用；与 config.areaLevels 对齐）
  function levelOfAreaTier(t) {
    const arr = (Config.equipment.areaLevels) || [];
    const v = Number(arr[Number(t) - 1]);
    return isFinite(v) && v > 0 ? v : 1;
  }
  // 装备等级(ilvl)：新装备出生时写入；老装备按图档兜底换算；都没有视为 100（存量不追溯）
  function ilvlOf(eq) {
    if (eq && eq.ilvl != null) return Number(eq.ilvl);
    if (eq && eq.areaTier != null) return levelOfAreaTier(eq.areaTier);
    return 100;
  }
  // 稀有度（颜色）由词缀总条数唯一决定：1 条=白 / 2 条=蓝 / 3 条及以上=金。
  // 掉落时先由图档定稀有度→再定词缀条数区间（白1/蓝2/金3~6），故与条数一致；
  // 打造（增缀/剥离/重铸）加减词缀后必须调本函数把颜色同步成当前条数，保证"颜色随词缀走"。
  function rarityIdFromCount(count) {
    return count >= 3 ? 'gold' : count >= 2 ? 'blue' : 'white';
  }
  function syncRarity(eq) {
    const id = rarityIdFromCount(affixCount(eq));
    const r = (Config.equipment.rarities || []).find(x => x.id === id) || Config.equipment.rarities[0];
    eq.rarity = { id: r.id, label: r.label, color: r.color };
    return eq.rarity;
  }
  // generateEquipment(rarity, areaTier=1, materialTier=3)：基底=部位基准×地图档次×底材 T 阶系数。
  // 白装 1 条、蓝装 2 条、金装至少 3 条词缀；每件装备仍保证带 1 条基础词缀。
  function generateEquipment(rarity, areaTier, materialTier, ilvl) {
    rarity = rarity || Config.equipment.rarities[0];
    // 图档上限与 baseTierMultipliers 档数一致（地图 10 图后这里还钳 6 → 图7~10 掉落和图6 一样强，已修）
    const maxTier = (Config.equipment.baseTierMultipliers || []).length || 6;
    areaTier = Math.max(1, Math.min(maxTier, areaTier || 1));
    materialTier = Math.max(1, Math.min(5, materialTier || 3));
    if (ilvl == null) ilvl = levelOfAreaTier(areaTier);
    const slot = Util.pick(SLOTS);
    const info = SLOT_INFO[slot];
    const multiplier = (Config.equipment.baseTierMultipliers[areaTier - 1] || 1) *
      (Config.equipment.materialTierMultipliers[materialTier] || 1);
    const baseStats = {};
    for (const b of info.bases) baseStats[b.type] = Math.round(b.value * multiplier * 100) / 100;
    const firstBase = info.bases[0];
    const base = { type: firstBase.type, label: firstBase.label, value: baseStats[firstBase.type] };
    const count = Util.randInt(rarity.affixMin, rarity.affixMax);
    const affixes = { prefix: [], suffix: [] };
    const baselineType = baseStats.hit !== undefined ? 'hit' : 'crit';
    const baseline = { type: baselineType, label: LABELS[baselineType], tier: 5, value: baselineType === 'hit' ? 5 : 2, base: true };
    affixes.suffix.push(baseline);
    const pool = AFFIX_POOL.filter(a => a.type !== baselineType);
    // 补词缀：targetCount 为词缀总条数上限（含基础词缀）。每次只选「目标桶未满(≤3)」的类型，
    // 避免前缀/后缀超过单桶上限 3 条（金装 4~6 条时若全堆一个桶会爆结构）。
    const targetCount = Math.min(count, 7); // 结构上限：基础1 + 前缀3 + 后缀3 = 7
    while (affixCount({ affixes }) < targetCount && pool.length) {
      const available = pool.filter(a => (affixes[a.category] || []).length < 3);
      if (!available.length) break;
      // 按词缀权重加权抽取：基础战斗词缀常出、资源/极品词缀稀出（POE 式）
      const aff = Util.pickWeighted(available.map(a => ({ ...a, weight: a.weight || 50 })));
      pool.splice(pool.indexOf(aff), 1);
      const tier = rollAffixTier(rarity.id, ilvl); // T 阶按稀有度加权 + 装备等级解锁（白/蓝抽不到 T1，低等级抽不到高档 T）
      const tiers = aff.type === 'spd' ? Config.equipment.speedAffixTiers : Config.equipment.affixTiers;
      const T = tiers.find(t => t.tier === tier) || tiers[tiers.length - 1];
      const fixed = ['hit', 'dodge', 'spd'].includes(aff.type);
      affixes[aff.category].push({ type: aff.type, label: aff.label, tier, value: Util.randInt(T.min, T.max), fixed });
    }
    const eq = {
      id: uid++, name: Util.pick(info.names), slot, areaTier, materialTier, ilvl,
      tier: materialTier, rarity: { id: rarity.id, label: rarity.label, color: rarity.color },
      base, baseStats, affixes, cloudId: null, locked: false, fresh: true
    };
    syncRarity(eq); // 颜色以词缀条数为准（1白/2蓝/3+金），掉落时与图档稀有度一致，打造加减词缀后实时同步
    return eq;
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
  // 穿/脱装备后把装备槽同步到云端 pets.equipment（{部位: cloudId}），防抖合并多次操作
  let _equipSyncTimer = null;
  // 装备槽写云端失败必须让玩家知道：以前这个 promise 没人接，pets 列缺失/写入失败时
  // 玩家穿装备看着成功，F5 之后装备全回背包，还查不到原因。
  function syncEquipToCloud(pet) {
    if (!pet || !pet.cloudId) return;
    const S = window.Supabase;
    if (!S || !S.petEquipmentToCloud) return;
    clearTimeout(_equipSyncTimer);
    _equipSyncTimer = setTimeout(async () => {
      const { error } = await S.updatePet(pet.cloudId, { equipment: S.petEquipmentToCloud(pet) });
      if (error && window.UI && window.UI.addLog) {
        window.UI.addLog(`⚠️ 装备槽云端同步失败：${error.message || '未知错误'}（刷新后装备可能脱落）`);
      }
    }, 300);
  }

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
    syncEquipToCloud(pet); // 装备槽同步云端（F5 不脱落）
    // 任务进度上报：所有 type=equip 的任务 +1
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('equip', 1);
    return { equipped: eq, replaced: old };
  }
  // 返回脱下的装备（null 表示该部位本来就空）
  function unequip(pet, slot) {
    const eq = pet.equipment[slot];
    if (!eq) return null;
    pet.equipment[slot] = null;
    inventory.unshift(eq);
    syncEquipToCloud(pet); // 脱下同步云端
    return eq;
  }

  /* ---------- 评分（装备价值单值化） ----------
   * 一件装备有 7 个维度（部位/图档/底材T/稀有度/词缀类型/T阶/数值），玩家没法一眼判断
   * "这件比那件好"，18 件/小时堆起来就是"又多又乱"。评分把它压成一个整数：
   *   基底（固定值属性）+ 词缀（百分比类按 1% 折算、机制类按点数、资源类按刷图收益）
   * 用途：卡片展示 / 排序 / 按阈值批量分解。【不参与任何战斗计算】，权重在 config.equipment.score。
   */
  function scoreOf(eq) {
    if (!eq) return 0;
    const W = Config.equipment.score || {};
    const stat = W.stat || {}, pct = W.pct || {}, res = W.resource || {};
    let s = 0;
    for (const [k, v] of Object.entries(eq.baseStats || {})) s += (Number(v) || 0) * (stat[k] || 0);
    for (const a of flattenAffixes(eq.affixes || {})) {
      const v = Number(a.value) || 0;
      if (a.type in res) s += v * res[a.type];                    // 资源类：掉落数量/稀有度/材料率
      else if (!a.fixed && a.type in pct) s += v * pct[a.type];   // 百分比类：atk%/hp%/def%
      else s += v * (stat[a.type] || 0);                          // 固定值类：spd/hit/dodge/暴击/暴伤/吸血
    }
    return Math.round(s);
  }

  /* ---------- 加成计算（供 pet.js 的 getStats 使用） ---------- */
  // 返回 { flat: {atk,hp,def,spd}, pct: {...} }；底材/地图档次只影响装备基底，atk/hp/def 词缀汇总后作用于宠物成长后的裸属性。
  // 防御：旧/脏数据装备缺 base 或缺 value 时跳过该条，保证属性计算不抛错、不产生 NaN
  function getEquipBonuses(pet) {
    const flat = { atk: 0, hp: 0, def: 0, spd: 0, crit: 0, critDamage: 0, hit: 0, dodge: 0, lifesteal: 0 };
    const pct = { atk: 0, hp: 0, def: 0, spd: 0 };
    const resources = { dropQty: 1, dropRare: 1, matDrop: 1 };
    const contributions = [];
    for (const slot of SLOTS) {
      const eq = pet.equipment && pet.equipment[slot];
      if (!eq) continue;
      const stats = eq.baseStats || (eq.base ? { [eq.base.type]: eq.base.value || 0 } : {});
      const affixes = flattenAffixes(eq.affixes);
      const own = {};
      for (const [type, value] of Object.entries(stats)) own[type] = value;
      for (const aff of affixes) {
        if (['dropQty', 'dropRare', 'matDrop'].includes(aff.type)) resources[aff.type] *= 1 + (aff.value || 0) / 100;
        else if (['atk', 'hp', 'def'].includes(aff.type)) pct[aff.type] += (aff.value || 0) / 100;
        // 机制百分比词缀（暴击/暴伤/吸血）：直接加「百分比点数」（如 +6% → flat.lifesteal += 6，getStats 再 /100 转小数）
        else if (['crit', 'critDamage', 'lifesteal'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
        // 固定值词缀（命中/闪避/速度）：直接加数值
        else if (['hit', 'dodge', 'spd'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
        else own[aff.type] = (own[aff.type] || 0) + (stats[aff.type] || 0) * (aff.value || 0) / 100;
      }
      // 魂铸词缀（独立于 affixes：不会被重铸/剥离/神圣石影响，永久保留；type 走词缀坐标系 critRate→crit）
      if (eq.soulAffix) {
        const aff = eq.soulAffix;
        if (['atk', 'hp', 'def'].includes(aff.type)) pct[aff.type] += (aff.value || 0) / 100;
        else if (['crit', 'critDamage', 'lifesteal'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
        else if (['hit', 'dodge', 'spd'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
        else own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      }
      for (const [type, value] of Object.entries(own)) flat[type] = (flat[type] || 0) + value;
      contributions.push({ slot, stats: own });
    }
    return { flat, pct, resources, contributions };
  }

  /* ---------- 展示文案 ---------- */
  // 词缀展示统一入口：命中/闪避/速度为固定值词缀，不显示 %；攻击/生命/防御词缀按成长相关百分比显示，其余机制/资源词缀按配置显示。
  const FIXED_AFFIX_TYPES = new Set(['hit', 'dodge', 'spd']);
  const PERCENT_AFFIX_TYPES = new Set(['atk', 'hp', 'def', 'crit', 'critDamage', 'lifesteal', 'dropQty', 'dropRare', 'matDrop']);
  function formatAffix(a) {
    return `${a.label} +${a.value}${FIXED_AFFIX_TYPES.has(a.type) ? '' : PERCENT_AFFIX_TYPES.has(a.type) ? '%' : ''}`;
  }

  /* ---------- roll 区间（2026-08-30 用户拍板，参考流放之路的装备显示） ----------
   * 玩家痛点：一条词缀 "+6 攻击" 看不出这数值算好算差 —— 要能一眼看到它在该 T 阶的
   * 区间（如 攻击 +6 (6~8)），roll 到区间顶就是"这条 T1 是满值"，求而不得。
   * 规则：
   *  - 区间来源：spd 走 speedAffixTiers，其余走 affixTiers（与生成/打造同一张表，杜绝两套）
   *  - 基础词缀（base:true，如命中 +5）没有区间概念 → 返回 null
   *  - T1 词缀、或 roll 达到该 T 阶 max → 金色高亮（高值）
   */
  function affixRange(a) {
    if (!a || !a.type || a.base || !a.tier) return null;
    const tiers = a.type === 'spd' ? Config.equipment.speedAffixTiers : Config.equipment.affixTiers;
    const T = (tiers || []).find(t => t.tier === a.tier);
    return T ? { min: T.min, max: T.max } : null;
  }
  // 词缀的 HTML 行（带区间 + 高亮）。cls 可传 tip-prefix / tip-suffix / tip-affix 等控制样式。
  // equipment.js 最先加载、不依赖 ui-common，故这里不调 escapeHtml —— 词缀内容全部来自内部生成数据。
  function formatAffixHtml(a, cls) {
    const label = String((a && a.label) || '?');
    const val = (a && a.value) || 0;
    const pct = a && FIXED_AFFIX_TYPES.has(a.type) ? '' : PERCENT_AFFIX_TYPES.has(a.type) ? '%' : '';
    const range = affixRange(a);
    // 区间不带 %（POE 风格）：值已经标了 +8%，区间写 (6~8) 更清爽
    const rangeHtml = range ? ` <span class="tip-range">(${range.min}~${range.max})</span>` : '';
    const hi = !!(range && (a.tier === 1 || val >= range.max));
    return `<div class="${cls || 'tip-affix'}"${hi ? ' style="color:#f2b632"' : ''}>` +
      `${label} +${val}${pct}${rangeHtml} <span class="tip-tier">T${a ? (a.tier || '?') : '?'}</span></div>`;
  }
  function describeItem(eq) {
    const affixes = flattenAffixes(eq.affixes).map(formatAffix).join(' ');
    const soul = eq.soulAffix ? (' 魂·' + (eq.soulAffix.label || eq.soulAffix.traitId || '?') + (eq.soulAffix.tier ? ' T' + eq.soulAffix.tier : '')) : '';
    const b = baseOf(eq);
    return `${eq.slot}｜${b.label}+${b.value}｜${affixes}${soul}`;
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
    pickRarity, generateEquipment, rollAffixTier, ilvlOf, syncRarity, scoreOf, getInventory, addToInventory, removeFromInventory, replaceInventory,
    equipItem, unequip, getEquipBonuses, describeItem, formatAffix, formatAffixHtml, affixRange, rarityOf, baseOf
  };
})();
