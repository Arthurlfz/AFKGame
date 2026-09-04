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
  // 特质坐标系 → 词缀坐标系（魂铸词缀必须用词缀 type 参与 getEquipBonuses 结算）
  const SOUL_TYPE_MAP = { critRate: 'crit' };

  // 打造通用流程（reforge/strip 共用）：
  //  1. 本地先行：改词缀 + 本地扣材料（界面立即生效）
  //  2. 云端并行：cloudSpend（RPC 扣材料）+ updateCloudItem（单条更新词缀）
  //  3. 任一失败 → 回滚本地（词缀还原 + 材料加回）并提示
  async function applyCraft(eq, stoneName, stoneAmount, apply, onApplied, extraStone) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号' };
    if (!eq.cloudId) return { error: '这件装备还没同步云端，刷新后再试' };
    if (Market.isItemListed(eq.cloudId)) return { error: '装备正在市场出售，先取回再打造' };
    if (Materials.getQuantity(stoneName) < stoneAmount) return { error: `需要 ${stoneAmount} 颗${stoneName}，去挂机刷吧` };
    // 锁定石附加消耗（2026-09-03）：reforge/reroll 时每条已锁定词缀额外扣 1 颗锁定石（方案 B 持续消耗）
    if (extraStone && Materials.getQuantity(extraStone.name) < extraStone.amount) {
      return { error: `需要 ${extraStone.amount} 颗${extraStone.name}（已锁定 ${extraStone.amount} 条词缀），去图 16/17 挂机刷吧` };
    }

    // 本地先行：改词缀 + 本地扣材料
    const applied = apply(); // { changed, onFail() } 或 { error }
    if (applied.error) return applied;
    const spentLocal = Materials.spendLocal(stoneName, stoneAmount);
    if (!spentLocal.ok) { applied.onFail(); return { error: spentLocal.error || '材料不足' }; }
    if (extraStone) {
      const spentExtra = Materials.spendLocal(extraStone.name, extraStone.amount);
      if (!spentExtra.ok) { Materials.gainLocal(stoneName, stoneAmount); applied.onFail(); return { error: spentExtra.error || '材料不足' }; }
    }

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

    // 云端并行同步（材料扣减 + 装备词缀更新，各 1 次请求；附加石头再 +1 次）
    const cloudOps = [
      Materials.cloudSpend(stoneName, stoneAmount),
      Items.updateCloudItem(eq, { affixes: eq.affixes, rarity: eq.rarity.id })  // 颜色(增缀/剥离后条数变了)一并回写，否则刷新页面颜色回退
    ];
    if (extraStone) cloudOps.push(Materials.cloudSpend(extraStone.name, extraStone.amount));
    const [sp, up] = await Promise.all(cloudOps);
    const syncErr = (sp && sp.error) || (sp && sp.data === false ? new Error(`${stoneName} 余额不足（云端）`) : null) || (up && up.error);
    if (syncErr) {
      // 回滚本地：词缀还原 + 材料加回（含附加石头）
      applied.onFail();
      Materials.gainLocal(stoneName, stoneAmount);
      if (extraStone) Materials.gainLocal(extraStone.name, extraStone.amount);
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
    // 锁定石（2026-09-03）：重铸时已锁定的词缀保持不变，每条已锁定词缀额外消耗 1 颗锁定石（持续消耗）
    const lockedCount = flattenAffixes(eq.affixes).filter(a => a.locked).length;
    const extra = lockedCount ? { name: Config.craft.lock.name, amount: lockedCount } : null;
    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);
      const oldRarity = eq.rarity;
      // 重铸的 T 阶【必须跟着装备稀有度走】：以前这里写死 randInt(1,5) 且不看成色，
      // 白装也能洗出全 T1（还能洗到 6 条），稀有度系统被整个绕过。
      // 已锁定的词缀【完全保留】（类型 / T 阶 / 数值 / 位置 / fixed 标记都不动），未锁定的才重洗。
      const lockedTypes = new Set((old.prefix || []).concat(old.suffix || []).filter(a => a.locked).map(a => a.type));
      const rollBucket = (category) => {
        const pool = AFFIX_POOL.filter(a => a.category === category && !lockedTypes.has(a.type));
        const chosen = (old[category] || []).filter(a => a.locked).slice(); // 保留锁定词缀（原对象引用，标记保留）
        const used = new Set(chosen.map(a => a.type));
        const cnt = randInt(0, 3);
        for (let i = 0; i < cnt; i++) {
          const avail = pool.filter(a => !used.has(a.type));
          if (!avail.length) break;
          const aff = pick(avail);
          used.add(aff.type);
          const tier = window.Equipment.rollAffixTier(eq.rarity.id, window.Equipment.ilvlOf(eq));
          const T = tierOf(tier);
          chosen.push({ type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) });
        }
        return chosen;
      };
      let prefix = rollBucket('prefix');
      let suffix = rollBucket('suffix');
      if (prefix.length + suffix.length === 0) {
        const bucket = Math.random() < 0.5 ? 'prefix' : 'suffix';
        const pool = AFFIX_POOL.filter(a => a.category === bucket && !lockedTypes.has(a.type));
        if (pool.length) {
          const aff = pick(pool);
          const tier = window.Equipment.rollAffixTier(eq.rarity.id, window.Equipment.ilvlOf(eq));
          const T = tierOf(tier);
          const one = { type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) };
          if (bucket === 'prefix') prefix = [one]; else suffix = [one];
        }
      }
      eq.affixes = { prefix, suffix };
      syncRarity(eq); // 重铸会重摇词缀条数 → 颜色按新条数同步
      return { changed: { old, new: eq.affixes }, onFail: () => { eq.affixes = old; eq.rarity = oldRarity; } };
    }, onApplied, extra);
  }

  /* ---------- 剥离：随机移除一条词缀（仅剩 1 条时不可用） ---------- */
  // 返回 { ok, changed: {old, removed} } 或 { error }
  async function strip(eq, onApplied) {
    const C = Config.craft.strip;
    const locs = affixLocations(eq);
    if (locs.length <= 1) return { error: '装备仅剩 1 条词缀，无法剥离' };
    const unlockable = locs.filter(l => !l.aff.locked); // 锁定的词缀不会被剥离
    if (!unlockable.length) return { error: '所有词缀都已锁定，先解锁才能剥离' };
    return applyCraft(eq, C.name, C.amount, () => {
      const loc = pick(unlockable);
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
    // 锁定石（2026-09-03）：神圣石重 Roll 时锁定的词缀数值也不变，每条已锁定词缀额外消耗 1 颗锁定石
    const lockedCount = flattenAffixes(eq.affixes).filter(a => a.locked).length;
    const extra = lockedCount ? { name: Config.craft.lock.name, amount: lockedCount } : null;

    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes); // 深拷贝嵌套结构，便于回滚与对比
      const rerollBucket = arr => arr.map(a => {
        if (a.locked) return { ...a };          // 锁定的词缀：数值也不动
        const T = tierOf(a.tier);               // 用该词缀自身的 T 阶区间重随机
        return { ...a, value: randInt(T.min, T.max) };
      });
      const changed = { prefix: rerollBucket(old.prefix), suffix: rerollBucket(old.suffix) };
      eq.affixes = changed;
      return {
        changed: { old, new: changed },
        onFail: () => { eq.affixes = old; }     // 云同步失败时整组还原
      };
    }, onApplied, extra);
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
      const tier = window.Equipment.rollAffixTier(eq.rarity.id, window.Equipment.ilvlOf(eq)); // 按稀有度加权 + 装备等级解锁，白/蓝加不出 T1
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

  /* ---------- 锁定石：锁定一条词缀（重铸/神圣/剥离时保持不变） ---------- */
  // 锁定：消耗 1 颗锁定石；锁定的词缀在重铸/神圣中【完全不变】、剥离不会移除。
  // 锁定后每次重铸/神圣，每条已锁定词缀额外消耗 1 颗锁定石（持续消耗，防毕业太快）。
  // 上限：每件装备最多锁 Config.craft.lock.maxLocked（4）条。锁定标记挂在词缀对象上（locked:true），
  // 随 affixes 一起存取/上云（normalizeAffixes 保留全部字段），不需要改数据库表。
  // loc 由 affixLocations(eq) 提供（{ bucket, index, aff }），UI 点击对应词缀行传入。
  async function lockAffix(eq, loc, onApplied) {
    const C = Config.craft.lock;
    const aff = loc && loc.aff;
    if (!aff) return { error: '词缀不存在' };
    if (aff.locked) return { error: '该词缀已锁定' };
    const lockedCount = flattenAffixes(eq.affixes).filter(a => a.locked).length;
    if (lockedCount >= C.maxLocked) return { error: '最多同时锁定 ' + C.maxLocked + ' 条词缀，先解锁再锁新的' };
    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);
      aff.locked = true;
      return { changed: { old, new: eq.affixes }, onFail: () => { delete aff.locked; } };
    }, onApplied);
  }

  // 解锁：免费（放弃锁定，不消耗石头），只回写云端 affixes
  async function unlockAffix(eq, loc) {
    const aff = loc && loc.aff;
    if (!aff) return { error: '词缀不存在' };
    if (!aff.locked) return { error: '该词缀未锁定' };
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号' };
    if (!eq.cloudId) return { error: '这件装备还没同步云端，刷新后再试' };
    if (Market.isItemListed(eq.cloudId)) return { error: '装备正在市场出售，先取回再操作' };
    const old = normalizeAffixes(eq.affixes);
    delete aff.locked;
    const { error } = await Items.updateCloudItem(eq, { affixes: eq.affixes, rarity: eq.rarity.id });
    if (error) {
      eq.affixes = old;
      return { ok: false, error: '云端同步失败：' + (error.message || error) };
    }
    return { ok: true, changed: { old, new: eq.affixes } };
  }

  /* ---------- 魂铸：把宠物血脉/觉醒特质铸进装备（独立词缀，永久不可剥离/重铸/神圣石洗） ----------
   * 档位（config.soulCast.tiers）：普通（Lv40+/成长≥10 铸血脉 T=原阶）｜精锐（Lv40+/成长≥40 铸血脉 T+1 封顶 T1）｜传承（Lv60 终形态/成长≥60 铸觉醒 固定 T1）
   * 消耗：装备（任意稀有度）+ 1 只宠物（消失）+ 10 凝魂晶石；每件装备最多 1 条；上架后不可打造；随装备走可交易
   * 流程：本地先行（词缀+扣晶石）→ 云同步（晶石 RPC + equip_items.soul_affix）→ 成功才 removePet+deletePet
   */
  async function soulCast(eq, pet, tierKey, traitId) {
    const S = Config.soulCast || {};
    const T = (S.tiers && S.tiers[tierKey]) || (S.tiers && S.tiers.normal) || {};
    const C = S.materialCount || 10;
    if (!eq || !pet) return { ok: false, error: '缺少装备或宠物' };
    // 上架中装备不可魂铸（仅在市场模块存在时校验）
    if (window.Market && typeof window.Market.isItemListed === 'function' && window.Market.isItemListed(eq.cloudId)) {
      return { ok: false, error: '装备正在市场出售，先取回再魂铸' };
    }
    if (eq.soulAffix) return { ok: false, error: '这件装备已铸入魂铸词缀，每件最多 1 条（不可剥离/重铸/神圣石洗）' };
    if (Number(pet.level) < (T.minLevel != null ? T.minLevel : T.level)) return { ok: false, error: T.label + '魂铸需要宠物达到 ' + (T.minLevel != null ? T.minLevel : T.level) + ' 级（当前 ' + pet.level + ' 级）' };
    if (pet.growth < (T.minGrowth != null ? T.minGrowth : T.growth)) return { ok: false, error: T.label + '魂铸需要宠物成长 ' + (T.minGrowth != null ? T.minGrowth : T.growth) + ' 以上（当前 ' + pet.growth + '）' };
    if (T.needFinal) {
      const aw = window.Pet.getAwakenState(pet);
      if (!aw) return { ok: false, error: '传承魂铸需要 Lv60 终形态宠物（且已解锁主动技能）' };
    }
    if (Materials.getQuantity(S.material) < C) return { ok: false, error: '需要 ' + C + ' 颗' + S.material + '，满级挂机会自动凝聚' };

    // 铸出词缀（soulAffix 驼峰为装备内存字段；DB 列 soul_affix 由序列化映射）
    const defs = Config.petTraits || {};
    let aff = null;
    if (T.source === 'awaken') {
      const aw = window.Pet.getAwakenState(pet);
      if (!aw) return { ok: false, error: '该宠物尚未觉醒，无法传承魂铸' };
      const bonus = aw.bonus || {};
      const bType = bonus.stat || 'skillDmg';
      aff = {
        id: '魂·觉醒·' + pet.name, label: '魂·觉醒·' + pet.name,
        traitId: aw.id, tier: 1, awaken: true,
        stat: bType, value: bonus.value != null ? bonus.value : Math.round(aw.damage * 100),
        type: bType, source: 'soulcast',
        skillId: aw.skillId, skillName: aw.skillName, skillDamage: aw.damage,
      };
    } else {
      const traits = (pet.traits || []).slice().sort((a, b) => a.tier - b.tier); // T1 在前
      if (!traits.length) return { ok: false, error: '这只宠物没有血脉特质，无法魂铸' };
      const best = (traitId && traits.find(t => t.id === traitId)) || traits[0];
      const d = defs[best.id];
      if (!d) return { ok: false, error: '未知特质' };
      const tier = T.tierShift ? Math.max(1, best.tier - (T.tierShift || 1)) : best.tier;
      const type = SOUL_TYPE_MAP[d.type] || d.type;
      const value = (d.values && d.values[tier] != null) ? d.values[tier] : (d.values && d.values[best.tier]);
      aff = { id: '魂·' + d.label, label: '魂·' + d.label, traitId: best.id, tier, type, value, source: 'soulcast' };
    }

    // 本地先行：词缀 + 本地扣晶石（界面立即生效）
    const oldAffix = eq.soulAffix || null;
    eq.soulAffix = aff;
    const spentLocal = Materials.spendLocal(S.material, C);
    if (!spentLocal.ok) { eq.soulAffix = oldAffix; return { ok: false, error: spentLocal.error || '材料不足' }; }

    // 云端并行：晶石 RPC + equip_items.soul_affix 更新
    if (Materials.flushMaterials) await Materials.flushMaterials();
    const [sp, up] = await Promise.all([
      Materials.cloudSpend(S.material, C),
      Items.updateCloudItem(eq, { soul_affix: eq.soulAffix })
    ]);
    const syncErr = (sp && sp.error) || (sp && sp.data === false ? new Error(S.material + ' 余额不足（云端）') : null) || (up && up.error);
    if (syncErr) {
      eq.soulAffix = oldAffix;
      Materials.gainLocal(S.material, C);
      return { ok: false, error: '云端同步失败，已回滚：' + (syncErr.message || syncErr), rolledBack: true };
    }

    // 成功才消耗宠物（本地 + 云端）
    const petCloudId = pet.cloudId;
    window.Pet.removePet(pet.id);
    if (petCloudId) {
      const { error: delErr } = await Supabase.deletePet(petCloudId);
      if (delErr) console.warn('魂铸后云端删除宠物失败（刷新后会复活）：', delErr.message);
    }

    if (window.Quest && window.Quest.reportType) window.Quest.reportType('soulcast', 1);

    return { ok: true, soulAffix: aff, petName: pet.name, tierKey };
  }

  /* ---------- 对外 API ---------- */
  window.Craft = { reforge, strip, reroll, augment, lockAffix, unlockAffix, affixText, soulCast };
})();
