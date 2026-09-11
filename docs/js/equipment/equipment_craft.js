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

  // 会消耗掉「锁定」的打造操作（2026-09-11 用户拍板）：
  // 锁定石只保【一次】打造操作 —— 重铸/剥离/神圣/增缀 任一生效后锁定立即失效，
  // 想继续锁就得再上一颗锁定石。这条规则收口在 applyCraft（不散在各操作里），
  // 漏一个就会变成「锁定一直不失效」，之前只有 reforge 清、其余三种不清就是这么来的。
  const LOCK_CONSUMING = ['reforge', 'strip', 'reroll', 'augment'];
  // 让锁定失效，返回还原函数（云同步失败回滚时用）。非打造操作（lockSide/unlockSide）原样不动。
  function expireLock(eq, actionType) {
    if (LOCK_CONSUMING.indexOf(actionType) < 0) return () => {};
    if (!eq.lockPrefix && !eq.lockSuffix) return () => {};
    const p = eq.lockPrefix, s = eq.lockSuffix;
    delete eq.lockPrefix;
    delete eq.lockSuffix;
    return () => { eq.lockPrefix = p; eq.lockSuffix = s; };
  }

  // 词缀数值表分派（2026-09-04 独立定标）：与 equipment.js 的 affixTiersFor 同一套映射，杜绝两套口径
  const AFFIX_TIER_TABLES = {
    spd: () => Config.equipment.speedAffixTiers,
    lifesteal: () => Config.equipment.lifestealAffixTiers,
    crit: () => Config.equipment.critAffixTiers,
    critDamage: () => Config.equipment.critDamageAffixTiers,
    pen: () => Config.equipment.penAffixTiers,
    dmgBonus: () => Config.equipment.dmgBonusAffixTiers,
    dr: () => Config.equipment.drAffixTiers
  };
  const tierOf = (t, type) => {
    const get = type && AFFIX_TIER_TABLES[type];
    const tiers = (get ? get() : null) || Config.equipment.affixTiers;
    return tiers.find(x => x.tier === t);
  };
  // 词缀 T 阶的颜色（T1 最好 → 暗金，T5 最差 → 灰；低饱和金属系）
  const TIER_COLORS = { 1: '#c9a86a', 2: '#b99a6a', 3: '#7fae7f', 4: '#7f9fc4', 5: '#6c7684' };
  // 特质坐标系 → 词缀坐标系（魂铸词缀必须用词缀 type 参与 getEquipBonuses 结算）
  const SOUL_TYPE_MAP = { critRate: 'crit' };

  // 打造通用流程（reforge/strip 共用）：
  //  1. 本地先行：改词缀 + 本地扣材料（界面立即生效）
  //  2. 云端并行：cloudSpend（RPC 扣材料）+ updateCloudItem（单条更新词缀）
  //  3. 任一失败 → 回滚本地（词缀还原 + 材料加回）并提示
  async function applyCraft(eq, stoneName, stoneAmount, apply, onApplied, extraStone, actionType) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号' };
    if (!eq.cloudId) return { error: '这件装备还没同步云端，刷新后再试' };
    if (Market.isItemListed(eq.cloudId)) return { error: '装备正在市场出售，先取回再打造' };
    if (eq.identified === false) return { error: '装备尚未鉴定，使用鉴定石揭晓后才能打造' };
    if (Materials.getQuantity(stoneName) < stoneAmount) return { error: `需要 ${stoneAmount} 颗${stoneName}，去挂机刷吧` };
    // 锁定石附加消耗（2026-09-03）：reforge/reroll 时每条已锁定词缀额外扣 1 颗锁定石（方案 B 持续消耗）
    if (extraStone && Materials.getQuantity(extraStone.name) < extraStone.amount) {
      return { error: `需要 ${extraStone.amount} 颗${extraStone.name}（已锁定 ${extraStone.amount} 条词缀），去副本·淬炼试炼（20 层）刷吧` };
    }

    // 本地先行：改词缀 + 本地扣材料
    const applied = apply(); // { changed, onFail() } 或 { error }
    if (applied.error) return applied;
    // 锁定失效必须在【云同步之前】：Items.updateCloudItem 会把 _lockPrefix/_lockSuffix 一起写库，
    // 晚于它清就会出现「本地看着解锁了、刷新又锁回来」。
    const restoreLock = expireLock(eq, actionType);
    const failLocal = () => { applied.onFail(); restoreLock(); };
    const spentLocal = Materials.spendLocal(stoneName, stoneAmount);
    if (!spentLocal.ok) { failLocal(); return { error: spentLocal.error || '材料不足' }; }
    if (extraStone) {
      const spentExtra = Materials.spendLocal(extraStone.name, extraStone.amount);
      if (!spentExtra.ok) { Materials.gainLocal(stoneName, stoneAmount); failLocal(); return { error: spentExtra.error || '材料不足' }; }
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
    let syncErr = (sp && sp.error) || (sp && sp.data === false ? new Error(`${stoneName} 余额不足（云端）`) : null) || (up && up.error);
    // 余额不足先重试一次：上面那次 flush 可能撞上限流（ERR_RATE_LIMIT）被退回队列，
    // 云端也就没收到刚掉的那批石头。此时直接回滚，玩家看到的就是「词条跳过去又跳回来」。
    if (syncErr && sp && sp.data === false && !sp.error) {
      await Materials.flushMaterials();
      const again = await Materials.cloudSpend(stoneName, stoneAmount);
      if (again && again.data !== false && !again.error) syncErr = null;
    }
    if (syncErr) {
      // 回滚本地：词缀还原 + 锁定还原 + 材料加回（含附加石头）
      failLocal();
      Materials.gainLocal(stoneName, stoneAmount);
      if (extraStone) Materials.gainLocal(extraStone.name, extraStone.amount);
      return { ok: false, error: '云端同步失败，已回滚：' + (syncErr.message || syncErr), rolledBack: true };
    }
    // 任务进度上报：所有 type=craft 的任务 +1（重铸/剥离/神圣/增缀四种石头都算打造）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('craft', 1, actionType ? { action: actionType } : undefined);

    return { ok: true, changed: applied.changed, stone: stoneName };
  }

  /* ---------- 重铸：随机重铸装备词缀（数量 / 类型 / T 阶 / 数值 全部随机） ---------- */
  // POE 锁前锁后 + 一次性锁定：锁定前缀 → 前缀整组保留，后缀整组重 roll；锁定后缀 → 反之。
  // 锁定石是消耗品：锁定动作耗 1 颗（见 lockSide）；本次重铸生效后锁定由 applyCraft 统一清掉，
  // 再锁需重新上锁定石（别在这里 delete，四种石头要同一个出口，见 expireLock）。
  // 两侧都锁 → 禁止。返回 { ok, changed: {old, new} } 或 { error }
  async function reforge(eq, onApplied) {
    const C = Config.craft.reforge;
    const lockPrefix = !!eq.lockPrefix, lockSuffix = !!eq.lockSuffix;
    if (lockPrefix && lockSuffix) return { error: '只能锁定前缀或后缀其中一边，先解锁另一边' };
    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);
      const oldRarity = eq.rarity;
      const rollBucket = (category, keep) => {
        if (keep) return (old[category] || []).slice(); // 锁定侧：整组保留（原对象引用）
        const pool = AFFIX_POOL.filter(a => a.category === category);
        const chosen = [];
        const used = new Set();
        const cnt = randInt(0, 3);
        for (let i = 0; i < cnt; i++) {
          const avail = pool.filter(a => !used.has(a.type));
          if (!avail.length) break;
          const aff = pick(avail);
          used.add(aff.type);
          const tier = window.Equipment.rollAffixTier(window.Equipment.ilvlOf(eq));
          const T = tierOf(tier, aff.type);
          chosen.push({ type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) });
        }
        return chosen;
      };
      let prefix = rollBucket('prefix', lockPrefix);
      let suffix = rollBucket('suffix', lockSuffix);
      if (prefix.length + suffix.length === 0) {
        const bucket = lockPrefix ? 'suffix' : (lockSuffix ? 'prefix' : (Math.random() < 0.5 ? 'prefix' : 'suffix'));
        const pool = AFFIX_POOL.filter(a => a.category === bucket);
        if (pool.length) {
          const aff = pick(pool);
          const tier = window.Equipment.rollAffixTier(window.Equipment.ilvlOf(eq));
          const T = tierOf(tier, aff.type);
          const one = { type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) };
          if (bucket === 'prefix') prefix = [one]; else suffix = [one];
        }
      }
      eq.affixes = { prefix, suffix };
      syncRarity(eq); // 重铸会重摇词缀条数 → 颜色按新条数同步
      return { changed: { old, new: eq.affixes }, onFail: () => { eq.affixes = old; eq.rarity = oldRarity; } };
    }, onApplied, undefined, 'reforge');
  }

  /* ---------- 剥离：随机移除一条词缀（仅剩 1 条时不可用） ---------- */
  // 返回 { ok, changed: {old, removed} } 或 { error }
  async function strip(eq, onApplied) {
    const C = Config.craft.strip;
    const lockPrefix = !!eq.lockPrefix, lockSuffix = !!eq.lockSuffix;
    if (lockPrefix && lockSuffix) return { error: '只能锁定前缀或后缀其中一边，先解锁另一边' };
    // POE 锁前锁后：锁定侧不可剥离，只能从「未锁定的一侧」随机移除
    const locs = affixLocations(eq).filter(l => (l.bucket === 'prefix' ? !lockPrefix : !lockSuffix));
    if (locs.length <= 1) return { error: (lockPrefix || lockSuffix) ? '锁定侧不可剥离，未锁定侧仅剩 1 条词缀' : '装备仅剩 1 条词缀，无法剥离' };
    return applyCraft(eq, C.name, C.amount, () => {
      const loc = pick(locs);
      const old = normalizeAffixes(eq.affixes);
      const oldRarity = eq.rarity;
      const removed = eq.affixes[loc.bucket][loc.index];
      eq.affixes[loc.bucket].splice(loc.index, 1);
      syncRarity(eq); // 词缀-1 → 颜色按条数同步（如金→蓝→白）
      return { changed: { old, removed }, onFail: () => { eq.affixes = old; eq.rarity = oldRarity; } };
    }, onApplied, undefined, 'strip');
  }

  // 词缀展示：如「攻击 +12%（T4）」，带 T 阶颜色
  // 命中/闪避/速度/穿透为固定值词缀（fixed），不显示 %，其余（atk/hp/def/crit/critDamage/lifesteal/dmgBonus/dr/dropQty/dropRare/matDrop）为百分比
  const FIXED_AFFIX_TYPES = new Set(['hit', 'dodge', 'spd', 'pen']);
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
    // POE 锁前锁后：锁定侧数值也不动（只重 Roll 未锁侧）。
    // 神圣石同样会消耗掉锁定（锁定只保一次打造，见 expireLock）
    const lockPrefix = !!eq.lockPrefix, lockSuffix = !!eq.lockSuffix;
    if (lockPrefix && lockSuffix) return { error: '只能锁定前缀或后缀其中一边，先解锁另一边' };
    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes); // 深拷贝嵌套结构，便于回滚与对比
      const rerollBucket = (arr, keep) => arr.map(a => {
        if (keep) return { ...a };              // 锁定侧：数值也不动
        const T = tierOf(a.tier, a.type);       // 用该词缀自身的 T 阶区间重随机
        return { ...a, value: randInt(T.min, T.max) };
      });
      const changed = { prefix: rerollBucket(old.prefix, lockPrefix), suffix: rerollBucket(old.suffix, lockSuffix) };
      eq.affixes = changed;
      return {
        changed: { old, new: changed },
        onFail: () => { eq.affixes = old; }     // 云同步失败时整组还原
      };
    }, onApplied, undefined, 'reroll');
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
    const lockPrefix = !!eq.lockPrefix, lockSuffix = !!eq.lockSuffix;
    if (lockPrefix && lockSuffix) return { error: '只能锁定前缀或后缀其中一边，先解锁另一边' };
    const pfx = eq.affixes.prefix, sfx = eq.affixes.suffix;
    // 后端校验：前后缀都已满（共 6 条）不能使用增缀石（双保险，前端也校验）
    if (pfx.length >= 3 && sfx.length >= 3) return { error: '前后缀均已满（共 6 条），无法再增加' };
    // POE 锁前锁后：锁定侧不能新增词缀，只能补到未锁定的一侧
    let target;
    if (lockPrefix) target = 'suffix';
    else if (lockSuffix) target = 'prefix';
    else if (pfx.length < 3) target = 'prefix';
    else target = 'suffix';
    if ((target === 'prefix' ? pfx.length : sfx.length) >= 3) {
      return { error: target === 'prefix' ? '前缀已满（且锁定后缀，无法新增到前缀）' : '后缀已满（且锁定前缀，无法新增到后缀）' };
    }

    const used = flattenAffixes(eq.affixes).map(a => a.type); // 已有类型（全局不重复）
    const pool = AFFIX_POOL.filter(a => a.category === target && !used.includes(a.type));
    if (!pool.length) return { error: target === 'prefix' ? '前缀类型已用尽（攻击/生命/防御/吸血均已占用）' : '后缀类型已用尽' };

    return applyCraft(eq, C.name, C.amount, () => {
      const old = normalizeAffixes(eq.affixes);  // 深拷贝嵌套结构，便于回滚与对比
      const oldRarity = eq.rarity;
      const aff = pick(pool);
      const tier = window.Equipment.rollAffixTier(window.Equipment.ilvlOf(eq)); // T 阶只由装备等级解锁（2026-09-11）
      const T = tierOf(tier, aff.type);
      const added = { type: aff.type, label: aff.label, tier, value: randInt(T.min, T.max) };
      eq.affixes[target] = [...eq.affixes[target], added];
      syncRarity(eq); // 词缀+1 → 颜色按条数同步（如白→蓝→金）
      return {
        changed: { old, new: added, target },
        onFail: () => { eq.affixes = old; eq.rarity = oldRarity; }      // 云同步失败时整组还原
      };
    }, onApplied, undefined, 'augment');
  }

  /* ---------- 锁定石：POE 锁前/锁后，一次锁定只保一次打造（2026-09-11 拍板） ----------
   * 只锁一边：eq.lockPrefix 或 eq.lockSuffix（布尔）。锁定侧在重铸中整组保留、剥离/增缀不触及。
   * 锁定动作消耗 1 颗锁定石（applyCraft）；四种打造操作任一生效后锁定由 expireLock 统一失效。
   * 持久化：affixes JSON 附加键 _lockPrefix/_lockSuffix（与 _ilvl 同模式，零 DB 改动）。
   * side 取值 'prefix' | 'suffix'。
   */
  async function lockSide(eq, side, onApplied) {
    const C = Config.craft.lock;
    if (side === 'prefix' && eq.lockSuffix) return { error: '已锁定后缀，先解锁后缀才能锁前缀' };
    if (side === 'suffix' && eq.lockPrefix) return { error: '已锁定前缀，先解锁前缀才能锁后缀' };
    return applyCraft(eq, C.name, C.amount, () => {
      const oldP = eq.lockPrefix, oldS = eq.lockSuffix;
      if (side === 'prefix') eq.lockPrefix = true; else eq.lockSuffix = true;
      return {
        changed: { old: { lockPrefix: !!oldP, lockSuffix: !!oldS }, new: { lockPrefix: !!eq.lockPrefix, lockSuffix: !!eq.lockSuffix } },
        onFail: () => { eq.lockPrefix = oldP; eq.lockSuffix = oldS; }
      };
    }, onApplied);
  }
  // 解锁：免费（放弃锁定，不消耗石头），只回写云端 affixes
  async function unlockSide(eq, side, onApplied) {
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号' };
    if (!eq.cloudId) return { error: '这件装备还没同步云端，刷新后再试' };
    if (Market.isItemListed(eq.cloudId)) return { error: '装备正在市场出售，先取回再操作' };
    if (eq.identified === false) return { error: '装备尚未鉴定，鉴定后才能操作' };
    const oldP = eq.lockPrefix, oldS = eq.lockSuffix;
    if (side === 'prefix') delete eq.lockPrefix; else delete eq.lockSuffix;
    if (onApplied) { try { onApplied({ ok: true }); } catch (e) {} }
    const up = await Items.updateCloudItem(eq, { affixes: eq.affixes });
    if (up && up.error) {
      eq.lockPrefix = oldP; eq.lockSuffix = oldS;
      return { ok: false, error: '云端同步失败，已回滚：' + (up.error.message || up.error), rolledBack: true };
    }
    return { ok: true };
  }

  /* ---------- 魂铸：把宠物血脉/觉醒特质铸进装备（独立词缀，永久不可剥离/重铸/神圣石洗） ----------
   * 档位（config.soulCast.tiers）：普通（Lv40+/成长≥10 铸血脉 T=原阶）｜精锐（Lv40+/成长≥40 铸血脉 T+1 封顶 T1）｜传承（已觉醒/成长≥60 铸觉醒 固定 T1）
   * 消耗：装备（任意稀有度）+ 1 只宠物（消失）+ 10 凝魂晶石；每件装备最多 1 条；上架后不可打造；随装备走可交易
   * 流程：本地先行（词缀+扣晶石）→ 云同步（晶石 RPC + equip_items.soul_affix）→ 成功才 removePet+deletePet
   */
  async function soulCast(eq, pet, tierKey, traitId) {
    const S = Config.soulCast || {};
    const T = (S.tiers && S.tiers[tierKey]) || (S.tiers && S.tiers.normal) || {};
    const C = S.materialCount || 10;
    if (!eq || !pet) return { ok: false, error: '缺少装备或宠物' };
    if (eq.identified === false) return { ok: false, error: '装备尚未鉴定，鉴定后才能魂铸' };
    // 上架中装备不可魂铸（仅在市场模块存在时校验）
    if (window.Market && typeof window.Market.isItemListed === 'function' && window.Market.isItemListed(eq.cloudId)) {
      return { ok: false, error: '装备正在市场出售，先取回再魂铸' };
    }
    if (eq.soulAffix) return { ok: false, error: '这件装备已铸入魂铸词缀，每件最多 1 条（不可剥离/重铸/神圣石洗）' };
    if (Number(pet.level) < (T.minLevel != null ? T.minLevel : T.level)) return { ok: false, error: T.label + '魂铸需要宠物达到 ' + (T.minLevel != null ? T.minLevel : T.level) + ' 级（当前 ' + pet.level + ' 级）' };
    if (pet.growth < (T.minGrowth != null ? T.minGrowth : T.growth)) return { ok: false, error: T.label + '魂铸需要宠物成长 ' + (T.minGrowth != null ? T.minGrowth : T.growth) + ' 以上（当前 ' + pet.growth + '）' };
    if (T.needFinal) {
      const aw = window.Pet.getAwakenState(pet);
      if (!aw) return { ok: false, error: '传承魂铸需要已觉醒的终形态宠物（去宠物页·觉醒页用觉醒石觉醒）' };
    }
    const haveCrystal = Materials.getQuantity(S.material);
    if (haveCrystal < C) return { ok: false, error: '需要 ' + C + ' 颗' + S.material + '（当前 ' + haveCrystal + ' 颗）：满级魂兽挂机会自动凝聚，走完新手引导也会送一份' };

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
  window.Craft = { reforge, strip, reroll, augment, lockSide, unlockSide, affixText, soulCast };
})();
