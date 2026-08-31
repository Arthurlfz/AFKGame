/* ============================================================
 * equipment_craft.js —— 装备打造（强化石 / 祝福石）
 * 职责：
 *  1. 重铸（reforge）：随机重铸全部词缀（数量 / 类型 / T 阶 / 数值 全部随机）
 *  2. 剥离（strip）：随机移除一条词缀（仅剩 1 条时不可用）
 *  3. 每次消耗 1 颗石头（云端原子扣减）；装备在售时禁止打造（挂单快照会失效）
 *  4. 打造结果同步云端（equip_items 表 affixes 更新）
 * 规则与数值：config.craft（石头名/数量）、config.equipment.affixTiers（T 阶数值区间）
 * 依赖：equipment.js（词缀结构）、materials.js（石头扣减）、supabase.js / items.js（云端同步）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { AFFIX_POOL, flattenAffixes, affixLocations, normalizeAffixes, affixCount, syncRarity } = window.Equipment;
  const Materials = window.Materials;
  const Items = window.Items;
  const Supabase = window.Supabase;
  const Market = window.Market;
  const { randInt, pick } = window.Util;

  const tierOf = t => Config.equipment.affixTiers.find(x => x.tier === t);
  // 词缀 T 阶的颜色（T1 最好 → 暗金，T5 最差 → 灰；低饱和金属系）
  const TIER_COLORS = { 1: '#c9a86a', 2: '#b99a6a', 3: '#7fae7f', 4: '#7f9fc4', 5: '#6c7684' };

  // 打造通用流程（reforge/strip 共用）：
  //  1. 本地先行：改词缀 + 本地扣材料（界面立即生效）
  //  2. 云端并行：cloudSpend（RPC 扣材料）+ updateCloudItem（单条更新词缀）
  //  3. 任一失败 → 回滚本地（词缀还原 + 材料加回）并提示
  async function applyCraft(eq, stoneName, stoneAmount, apply, onApplied) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号' };
    if (!eq.cloudId) return { error: '这件装备还没同步云端，刷新后再试' };
    if (Market.isItemListed(eq.cloudId)) return { error: '装备正在市场出售，先取回再打造' };
    if (Materials.getQuantity(stoneName) < stoneAmount) return { error: `需要 ${stoneAmount} 颗${stoneName}，去挂机刷吧` };

    // 本地先行：改词缀 + 本地扣材料
    const applied = apply(); // { changed, onFail() } 或 { error }
    if (applied.error) return applied;
    const spentLocal = Materials.spendLocal(stoneName, stoneAmount);
    if (!spentLocal.ok) { applied.onFail(); return { error: spentLocal.error || '材料不足' }; }

    // 本地已生效（词缀改好、石头扣了）→ 立刻通知界面刷新，不等云端。
    // 实测打造要串 getUser + rpc 两次往返（约 0.9 秒），等它回来再刷新，
    // 玩家点完按钮会有近一秒"没反应"。云端失败时下面会回滚，调用方再刷一次即可。
    // 用 try/catch 包住：界面回调出错绝不能影响打造本身的落库。
    if (onApplied) {
      try { onApplied({ ok: true, changed: applied.changed, stone: stoneName }); }
      catch (e) { if (window.console) console.warn('[打造] 界面回调出错：', e); }
    }

    // 扣石头之前，先把掉落攒着还没上报的补到云端（cloudSpend 是云端原子扣减，
    // 云端还没收到刚掉的那批就会误报「余额不足」）。
    // pending 通常为空（4 秒自动上报窗口），多数情况这里立即返回，不耽误时间。
    await Materials.flushMaterials();

    // 云端并行同步（材料扣减 + 装备词缀更新，各 1 次请求）
    const [sp, up] = await Promise.all([
      Materials.cloudSpend(stoneName, stoneAmount),
      Items.updateCloudItem(eq, { affixes: eq.affixes, rarity: eq.rarity.id })  // 颜色(增缀/剥离后条数变了)一并回写，否则刷新页面颜色回退
    ]);
    const syncErr = (sp && sp.error) || (sp && sp.data === false ? new Error(`${stoneName} 余额不足（云端）`) : null) || (up && up.error);
    if (syncErr) {
      // 回滚本地：词缀还原 + 材料加回
      applied.onFail();
      Materials.gainLocal(stoneName, stoneAmount);
      return { ok: false, error: '云端同步失败，已回滚：' + (syncErr.message || syncErr), rolledBack: true };
    }
    // 任务进度上报：所有 type=craft 的任务 +1（重铸/剥离/神圣/增缀四种石头都算打造）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('craft', 1);

    return { ok: true, changed: applied.changed, stone: stoneName };
  }

  /* ---------- 重铸：随机重铸装备全部词缀（数量 / 类型 / T 阶 / 数值 全部随机） ---------- */
  // 返回 { ok, changed: {old, new} } 或 { error }
  async function reforge(eq, onApplied) {
    const C = Config.craft.reforge;
    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);
      const oldRarity = eq.rarity;
      // 重铸的 T 阶【必须跟着装备稀有度走】：以前这里写死 randInt(1,5) 且不看成色，
      // 白装也能洗出全 T1（还能洗到 6 条），稀有度系统被整个绕过。
      const rollBucket = (category) => {
        const pool = AFFIX_POOL.filter(a => a.category === category);
        const chosen = [];
        const used = new Set();
        const cnt = randInt(0, 3);
        for (let i = 0; i < cnt; i++) {
          const avail = pool.filter(a => !used.has(a.type));
          if (!avail.length) break;
          const aff = pick(avail);
          used.add(aff.type);
          const tier = window.Equipment.rollAffixTier(eq.rarity.id);
          const T = tierOf(tier);
          chosen.push({ type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) });
        }
        return chosen;
      };
      let prefix = rollBucket('prefix');
      let suffix = rollBucket('suffix');
      if (prefix.length + suffix.length === 0) {
        const bucket = Math.random() < 0.5 ? 'prefix' : 'suffix';
        const aff = pick(AFFIX_POOL.filter(a => a.category === bucket));
        const tier = window.Equipment.rollAffixTier(eq.rarity.id);
        const T = tierOf(tier);
        const one = { type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) };
        if (bucket === 'prefix') prefix = [one]; else suffix = [one];
      }
      eq.affixes = { prefix, suffix };
      syncRarity(eq); // 重铸会重摇词缀条数 → 颜色按新条数同步
      return { changed: { old, new: eq.affixes }, onFail: () => { eq.affixes = old; eq.rarity = oldRarity; } };
    }, onApplied);
  }

  /* ---------- 剥离：随机移除一条词缀（仅剩 1 条时不可用） ---------- */
  // 返回 { ok, changed: {old, removed} } 或 { error }
  async function strip(eq, onApplied) {
    const C = Config.craft.strip;
    const locs = affixLocations(eq);
    if (locs.length <= 1) return { error: '装备仅剩 1 条词缀，无法剥离' };
    return applyCraft(eq, C.name, C.amount, () => {
      const loc = pick(locs);
      const old = normalizeAffixes(eq.affixes);
      const oldRarity = eq.rarity;
      const removed = eq.affixes[loc.bucket][loc.index];
      eq.affixes[loc.bucket].splice(loc.index, 1);
      syncRarity(eq); // 词缀-1 → 颜色按条数同步（如金→蓝→白）
      return { changed: { old, removed }, onFail: () => { eq.affixes = old; eq.rarity = oldRarity; } };
    }, onApplied);
  }

  // 词缀展示：如「攻击 +12%（T4）」，带 T 阶颜色
  // 命中/闪避/速度为固定值词缀（fixed），不显示 %，其余（atk/hp/def/crit/critDamage/lifesteal/dropQty/dropRare/matDrop）为百分比
  const FIXED_AFFIX_TYPES = new Set(['hit', 'dodge', 'spd']);
  function affixText(aff) {
    const color = TIER_COLORS[aff.tier] || '#9a9a9a';
    const suffix = FIXED_AFFIX_TYPES.has(aff.type) ? '' : '%';
    return `<span style="color:${color}">${aff.label} +${aff.value}${suffix}（T${aff.tier}）</span>`;
  }

  /* ---------- 神圣石：重 Roll 装备【全部】词缀数值（类型/T 阶不变） ---------- */
  // 用途：把每条词缀的数值在该词缀自身 T 阶的 [min,max] 区间内重新随机
  //   —— 词缀类型（攻击/生命…）不变，T 阶不变，只改数值（前缀/后缀都重 Roll）
  // 返回 { ok, changed: {old:{prefix,suffix}, new:{prefix,suffix}} } 或 { error }
  async function reroll(eq, onApplied) {
    const C = Config.craft.holy;
    if (affixCount(eq) === 0) return { error: '这件装备没有词缀，无法重铸' };

    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes); // 深拷贝嵌套结构，便于回滚与对比
      const rerollBucket = arr => arr.map(a => {
        const T = tierOf(a.tier);               // 用该词缀自身的 T 阶区间重随机
        return { ...a, value: randInt(T.min, T.max) };
      });
      const changed = { prefix: rerollBucket(old.prefix), suffix: rerollBucket(old.suffix) };
      eq.affixes = changed;
      return {
        changed: { old, new: changed },
        onFail: () => { eq.affixes = old; }     // 云同步失败时整组还原
      };
    }, onApplied);
  }

  /* ---------- 增缀石：按前后缀优先级给装备【新增】一条随机词缀 ---------- */
  // 规则（前后缀结构，上限 前缀3 + 后缀3 = 共 6）：
  //  - 前缀未满（< 3）→ 优先加前缀
  //  - 前缀已满（= 3）→ 加后缀
  //  - 前后缀都已满（共 6）→ 不能使用
  //  - 新增 1 条词缀：类型随机（不与现有重复、且属于目标桶）、T 阶随机（1~5）、数值按该 T 阶区间随机
  // 返回 { ok, changed: { old:{prefix,suffix}, new:{affix}, target } } 或 { error }
  async function augment(eq, onApplied) {
    const C = Config.craft.augment;
    const pfx = eq.affixes.prefix, sfx = eq.affixes.suffix;
    // 后端校验：前后缀都已满（共 6 条）不能使用增缀石（双保险，前端也校验）
    if (pfx.length >= 3 && sfx.length >= 3) return { error: '前后缀均已满（共 6 条），无法再增加' };
    let target;
    if (pfx.length < 3) target = 'prefix';
    else target = 'suffix';

    const used = flattenAffixes(eq.affixes).map(a => a.type); // 已有类型（全局不重复）
    const pool = AFFIX_POOL.filter(a => a.category === target && !used.includes(a.type));
    if (!pool.length) return { error: target === 'prefix' ? '前缀类型已用尽（攻击/生命/防御均已占用）' : '后缀类型已用尽（速度/暴击率/吸血均已占用）' };

    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);  // 深拷贝嵌套结构，便于回滚与对比
      const oldRarity = eq.rarity;
      const aff = pick(pool);
      const tier = window.Equipment.rollAffixTier(eq.rarity.id); // 按稀有度加权，白/蓝加不出 T1
      const T = tierOf(tier);
      const added = { type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) };
      eq.affixes[target] = [...eq.affixes[target], added];
      syncRarity(eq); // 词缀+1 → 颜色按条数同步（如白→蓝→金）
      return {
        changed: { old, new: added, target },
        onFail: () => { eq.affixes = old; eq.rarity = oldRarity; }      // 云同步失败时整组还原
      };
    }, onApplied);
  }

  /* ---------- 对外 API ---------- */
  window.Craft = { reforge, strip, reroll, augment, affixText };
})();
