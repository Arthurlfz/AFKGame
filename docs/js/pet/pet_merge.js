/* ============================================================
 * pet_merge.js —— 宠物合成 + 涅槃（原「融合」拆分为两个独立玩法）
 * 职责：
 *  1. 合成 synthesize：两只宠物 → 概率合成一只全新「·异变」稀有宠（复用变异规则）
 *       - 变异成功：出一只全新「·异变」宠，成长 = 主×mainW + 副×subW + 随机加成
 *       - 变异失败：出一只普通新宠（继承主宠形态），成长 = 加权和
 *       - 两只素材宠都消失；新宠等级回 1；消耗「合成之石」
 *  2. 涅槃 nirvana（= 原融合 merge）：主宠吸副宠成长 + 重置等级 + 突破成长上限
 *       - 主宠保留，吸副宠成长；副宠消失；等级重置回 1
 *       - 2026-09-06 第二版手册 2.4：消耗【道具化】= 选中的涅槃道具（默认涅槃丹，吸收 ×1.2）；
 *         涅磐兽不再作为涅槃消耗品（保留掉落与交易）。可选再投入凝魂晶石加乘。
 * 兼容：Merge.merge 保留为 nirvana 的别名（旧测试/旧调用仍可用）
 * 规则（config.synthesize / config.nirvana）
 * 依赖：pet.js / materials.js / supabase.js / market.js（在售检查）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { getPets, removePet, addPet, getStats, createPet } = window.Pet;
  const { randInt } = window.Util;
  const Materials = window.Materials;
  const Supabase = window.Supabase;
  const Market = window.Market;

  // 兼容读取配置：优先新配置，回退旧 Config.merge
  const NV = () => Config.nirvana || Config.merge || {};
  const SYN = () => Config.synthesize || Config.merge || {};

  // 防并发重入：合成/涅槃各有多次云端往返（getUser / 扣材料 / 建档 / 删素材，约 1 秒）。
  // 期间素材宠还没被移除（要等新宠建档后才 remove），所以【连点两下】两次调用都能通过校验
  // → 产出两只新宠、材料扣两份。玩家视角是"我只合成了一次，却多出一只"。
  const inFlight = new Set();

  // 获取可作素材的候选宠（等级足够 + 不是自身 + 云端在档 + 不在售 + 没穿装备）
  function getMergeCandidates(mainId, cfg) {
    const minLv = (cfg && cfg.minLevel) || 40;
    return getPets().filter(p =>
      p.id !== mainId &&
      p.level >= minLv &&
      p.cloudId &&
      !Market.isListed(p.cloudId) &&
      !Object.values(p.equipment || {}).some(Boolean)
    );
  }
  // 涅槃（融合）素材门槛：读 nirvana.minLevel（60）
  const canMerge = pet => {
    const minLv = NV().minLevel || 60;
    return pet.level >= minLv && !Object.values(pet.equipment || {}).some(Boolean);
  };
  // 合成素材门槛：读 synthesize.minLevel（40）—— 血泪：合成页曾误用 canMerge(读60)，
  // 全队 Lv40 却一只都显示不出来，玩家以为"没宠/没发经验包"。
  const canSynthesize = pet => {
    const minLv = (SYN().minLevel) || 40;
    return pet.level >= minLv && !Object.values(pet.equipment || {}).some(Boolean);
  };

  /* ---------- 变异（全局随机）----------
   * rollMutation(cfg)：随机 < chance 即变异成功（不依赖固定组合）
   * mutatedName(name)：给名字加「·异变」后缀（已带后缀不叠加） */
  function rollMutation(cfg) {
    const Mu = (cfg && cfg.mutation) || {};
    if (!Mu.chance) return false;
    return Math.random() < Mu.chance;
  }
  function mutatedName(name) {
    return name.endsWith('·异变') ? name : name + '·异变';
  }

  /* ---------- 涅槃成长计算（纯函数，nirvana 与 UI 预览共用） ---------- */
  // calcNirvanaGrowth(main, sub) → { growth, subRatioPenalty, capApplied }
  // bonusMult：凝魂晶石加成倍率（1 = 不投入）；预览与实际走同一函数，不会算歪
  function calcNirvanaGrowth(main, sub, bonusMult) {
    const M = NV();
    const minLv = M.minLevel || 60;
    /* 2026-09-06（手册 2.7）：吸收 50%【不衰减】——
     * 删掉旧的「副宠成长下限打折」与「60 成长分水岭减半」两重衰减，
     * 节奏改由涅磐兽消耗（5 只）控制。只保留副宠等级加成（练得高当肥料更值钱，不属于衰减）。 */
    const lvBonus = 1 + Math.max(0, (sub.level || 0) - minLv) * (M.levelBonus || 0); // 等级加成倍数
    // 成长软上限：主宠成长已达 maxGrowth 则不再涨（仅重置等级）
    const maxGrowth = M.maxGrowth || 100;
    let absorb = (sub.growth || 0) * (M.absorbRatio || 0.5) * lvBonus * (bonusMult || 1);
    if ((main.growth || 0) >= maxGrowth) absorb = 0;
    const growth = Math.round(((main.growth || 0) + absorb) * 10) / 10;
    // 字段保留（UI/旧调用在读），恒为 false：不再有衰减
    return { growth, absorb: Math.round(absorb * 10) / 10, subRatioPenalty: false, capApplied: false };
  }

  /* ---------- 合成成长计算（纯函数，synthesize 与 UI 预览共用） ----------
   * 2026-09-06 第二版手册 2.1：加法公式（废弃加权平均）。
   * 新宠成长 = 主宠成长 + 总提升，【永远不掉】（保底：总提升至少 +1）。 */
  function calcSynthesizeGrowth(main, sub, mutated, itemId) {
    const S = SYN();
    const baseBoost = (sub.growth || 0) * (S.baseBoostRatio || 0.25);
    const levelBoost = Math.min(((main.level || 1) + (sub.level || 1)) / 200, S.levelBoostMax || 0.5);
    const item = itemId ? (Config.itemOf ? Config.itemOf(itemId) : null) : null;
    const itemBoost = (item && item.boost) || 0;
    const randomRange = S.randomBoost || [1, 3];
    const randomBoost = randInt(randomRange[0], randomRange[1]);
    let totalBoost = baseBoost * (1 + levelBoost + itemBoost) + randomBoost;
    totalBoost = Math.max(1, Math.round(totalBoost));
    let growth = (main.growth || 0) + totalBoost;
    if (mutated && S.mutation) {
      growth += randInt(S.mutation.growthBonus[0], S.mutation.growthBonus[1]);
    }
    const cap = S.normalGrowthCap || 100;
    if (growth > cap) {
      growth = cap + (growth - cap) / 2;
    }
    return Math.round(growth * 10) / 10;
  }

  /* ---------- 神级宠合成判定（第二版手册 2.2，道具化） ----------
   * 门槛：主宠与副宠都【终阶】(evolveStage ≥ minStage) 且【成长 ≥ minGrowth】
   *   且等级 ≥ baseLevelRequire（至尊神石可按 levelRequireReduce 降低）。
   * 概率：由选中合成道具的 godChance 决定（合成之石 30% / 百变魔石 60% / 至尊神石 100%）。
   * 返回 { ready, chance, god, minGrowth, minStage, levelRequire, item }，UI 预览与实际合成共用。 */
  function godSynthInfo(main, sub, itemId) {
    const S = SYN();
    const G = S.god;
    const Pet = window.Pet;
    const empty = { ready: false, chance: 0, god: null, minGrowth: 60, minStage: 5, levelRequire: 60, item: null };
    if (!G || !Pet || !main || !sub) return empty;
    const item = itemId ? (Config.itemOf ? Config.itemOf(itemId) : null) : null;
    const st = p => (Pet.getEvolveStage ? Pet.getEvolveStage(p) : ((p.evolveTimes || 0) + 1));
    const minG = G.minGrowth || 60, minS = G.minStage || 5;
    const GP = Config.pet && Config.pet.godPets;
    const baseLevel = (GP && GP.baseLevelRequire) || 60;
    const levelReduce = (item && item.levelRequireReduce) || 0;
    const levelRequire = Math.max(1, baseLevel - levelReduce);
    const ready = st(main) >= minS && st(sub) >= minS
      && (main.growth || 0) >= minG && (sub.growth || 0) >= minG
      && (main.level || 1) >= levelRequire && (sub.level || 1) >= levelRequire;
    const chance = ready ? ((item && item.godChance != null) ? item.godChance : 0.3) : 0;
    const god = ready && GP && GP.ofLine
      ? GP.ofLine(main.lineId || main.name) : null;
    return { ready, chance, god, minGrowth: minG, minStage: minS, levelRequire, item };
  }

  /* ============================================================
   * 涅槃 nirvana（= 原融合 merge）：主宠吸副宠成长 + 重置等级
   * ============================================================ */
  async function nirvana(mainId, subId, useCrystal, useNirvanaPill, lockTraitId) {
    const k = 'nir:' + mainId + ':' + subId;
    if (inFlight.has(k)) return { error: '涅槃进行中，请勿重复点击' };
    inFlight.add(k);
    try { return await nirvanaInner(mainId, subId, useCrystal, useNirvanaPill, lockTraitId); }
    finally { inFlight.delete(k); }
  }
  async function nirvanaInner(mainId, subId, useCrystal, useNirvanaPill, lockTraitId) {
    const M = NV();
    const main = getPets().find(p => p.id === mainId);
    const sub = getPets().find(p => p.id === subId);
    if (!main || !sub) return { error: '宠物不存在' };
    if (main.id === sub.id) return { error: '不能选择同一只宠物' };
    /* 2026-09-06（手册 2.7）：只有【神级宠】才能涅槃。
     * 神级宠 = 主副宠都终阶 + 成长≥minGrowth 时合成，30% 概率出（持涅槃丹 100%）。
     * 普通宠/终阶普通宠一律拒绝 —— 手册 6.2 明令禁止给普通宠开涅槃。 */
    if (M.requireGodPet !== false) {
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
      if (!isGod) {
        const minG = (Config.pet && Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
        return { error: `只有神级宠才能涅槃（神级宠：两只终阶宠 + 成长≥${minG} 合成，30% 概率；持涅槃丹必出）` };
      }
    }
    if (main.level < M.minLevel || sub.level < M.minLevel) {
      return { error: `两只宠物都必须达到 ${M.minLevel} 级才能涅槃` };
    }
    // 服务端权威校验（手册 6.4，migrate_god_pet.sql 的 check_nirvana）：以库里的 is_god_pet 为准。
    // 旧库没跑迁移（RPC 不存在）时放行 —— 客户端校验已经挡在前面，这里只加一道保险。
    if (M.requireGodPet !== false && main.cloudId && Supabase.rpc) {
      try {
        const chk = await Supabase.rpc('check_nirvana', { p_pet: { cloud_id: main.cloudId } });
        if (chk && chk.data && chk.data.ok === false) {
          return { error: '涅槃被服务器拒绝：该宠物不是神级宠（' + (chk.data.code || 'not_god_pet') + '）' };
        }
      } catch (e) { /* RPC 不可用：放行 */ }
    }
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，涅槃会同步云端存档' };
    if (!main.cloudId || !sub.cloudId) return { error: '有宠物未同步云端，刷新页面后再试' };
    if (Market.isListed(main.cloudId)) return { error: `${main.name} 正在市场出售，先取回再涅槃` };
    if (Market.isListed(sub.cloudId)) return { error: `${sub.name} 正在市场出售，先取回再涅槃` };
    /* 凝魂晶石加成（可选）：投入 crystalBonus.amount 颗，本次吸收 ×(1 + absorbBonus)。
     * 只加成型道具可用（替换型语义冲突），当前涅槃道具都是 add 型。 */
    const CB = M.crystalBonus;
    let bonusMult = (useCrystal && CB) ? 1 + CB.absorbBonus : 1;
    if (bonusMult > 1 && Materials.getQuantity(CB.material) < CB.amount) {
      return { error: `${CB.material}不足，需要 ${CB.amount} 颗` };
    }
    /* 涅槃消耗【道具化】（2026-09-06 第二版手册 2.4）：
     * 消耗的是选中的涅槃道具（Config.items 里 category=nirvana，默认 defaultItem），
     * 涅磐兽已不再是涅槃消耗品（保留掉落与交易）。当前唯一道具 = 涅槃丹（吸收 ×1.2）。
     * 不用道具也能涅槃，只是拿不到加乘。 */
    const nirPill = useNirvanaPill ? (Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null) : null;
    if (nirPill && Materials.getQuantity(nirPill.name) < 1) {
      return { error: `${nirPill.name}不足` };
    }
    if (nirPill && nirPill.boostMult) bonusMult *= nirPill.boostMult;
    // 锁魂玉（2026-09-11）：指定副宠一条特质 100% 植入，其余特质本次一律不植。
    // 栏位已满且该类型主宠没有 → 新类型塞不进，提前拦（否则玉扣了特质进不来，玩家白亏）。
    let lockItem = null;
    if (lockTraitId) {
      const st = (sub.traits || []).find(t => t.id === lockTraitId);
      if (!st) return { error: '副宠身上没有可指定的特质' };
      const mine = (main.traits || []).find(t => t.id === lockTraitId);
      if (!mine && (main.traits || []).length >= ((Config.traitInherit && Config.traitInherit.cap) || 3)) {
        return { error: '特质栏已满（3 条），无法植入新类型特质' };
      }
      lockItem = Config.itemOf ? Config.itemOf('nir_lock') : null;
      if (!lockItem) return { error: '锁魂玉未配置' };
      if (Materials.getQuantity(lockItem.name) < 1) return { error: '锁魂玉不足（指定特质需要 1 颗）' };
    }

    if (useCrystal && bonusMult > 1) {
      const cs = await Materials.spend(CB.material, CB.amount);
      if (!cs.ok) return { error: cs.error || '材料扣减失败' };
    }
    if (nirPill) {
      const ps = await Materials.spend(nirPill.name, 1);
      if (!ps.ok) {
        if (useCrystal && bonusMult > 1) Materials.gain(CB.material, CB.amount);
        return { error: ps.error || `${nirPill.name}扣减失败` };
      }
    }
    if (lockTraitId && lockItem) {
      const ls = await Materials.spend(lockItem.name, 1);
      if (!ls.ok) {
        if (useCrystal && bonusMult > 1) Materials.gain(CB.material, CB.amount);
        if (nirPill) Materials.gain(nirPill.name, 1);
        return { error: ls.error || '锁魂玉扣减失败' };
      }
    }

    const oldGrowth = main.growth;
    const { growth: newGrowth } = calcNirvanaGrowth(main, sub, bonusMult);
    main.growth = newGrowth;
    // 涅槃植入：主宠特质全保留；副宠每条 30% 概率植入（同类型取高 T，不叠加）
    main.traits = implantNirvanaTraits(main, sub, lockTraitId);
    // 觉醒（pet.awakened）是觉醒石激活的永久标记：涅槃/转生不清除（2026-09-10 v2 拍板）

    // 涅槃 = 突破：重置进化次数 + 累计涅槃/转生次数 + 等级重置
    main.evolveTimes = 0;
    // 阶段：神级宠保持终阶（它不走进化树，重置成 1 阶会变成无法进化的死宠）；普通宠跟随次数回 1 阶
    main.evolveStage = (window.Pet && window.Pet.isGodPet && window.Pet.isGodPet(main)) ? 5 : 1;
    main.cultivateUsed = 0;   // 神宠培育次数：涅槃即重置一轮
    main.rebornCount = (main.rebornCount || 0) + 1;
    if (M.resetLevel) { main.level = 1; main.exp = 0; }
    main.curHp = getStats(main).hp;

    // 副宠消失。顺序铁律（2026-09-08）：先删云端、成功才删本地——
    // 反过来时云端删除失败（网络抖动）副宠会在刷新后"复活"（本地已删、云端还在，
    // loadPets 全量拉回就凭空多宠）。删除失败保留本地行，玩家资产不凭空消失，可重试放生。
    const delSub = await Supabase.deletePet(sub.cloudId);
    if (delSub.error) {
      console.warn('云端删除副宠失败，本地保留（刷新后仍在，请重试放生）：', delSub.error.message);
      if (window.UI && window.UI.addLog) window.UI.addLog(`⚠️ 副宠「${sub.name}」云端删除失败，它还在你的列表里，稍后可再试放生`);
    } else {
      removePet(sub.id);
    }

    // 主宠成长/等级同步云端
    const patch = { growth: newGrowth, evolve_times: main.evolveTimes, reborn_count: main.rebornCount, traits: main.traits, evolve_stage: main.evolveStage, cultivate_used: 0 };
    // 等级重置时必须连 exp 一起清零并同步：否则云端留着旧经验，
    // 刷新后会变成「Lv1 + 几千经验」，打一场直接连升几十级
    if (M.resetLevel) { patch.level = main.level; patch.exp = 0; }
    const { error: updErr } = await Supabase.updatePet(main.cloudId, patch);
    if (updErr) console.warn('云端更新宠物失败：', updErr.message);

    // 任务进度上报：所有 type=nirvana 的任务 +1
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('nirvana', 1);

    return { ok: true, main, oldGrowth, newGrowth, subName: sub.name };
  }

  /* ============================================================
   * 合成 synthesize：两只宠物 → 概率合成一只全新「·异变」宠
   * ============================================================ */
  async function synthesize(mainId, subId, itemId) {
    const k = 'syn:' + mainId + ':' + subId;
    if (inFlight.has(k)) return { error: '合成进行中，请勿重复点击' };
    inFlight.add(k);
    try { return await synthesizeInner(mainId, subId, itemId); }
    finally { inFlight.delete(k); }
  }
  async function synthesizeInner(mainId, subId, itemId) {
    const S = SYN();
    const main = getPets().find(p => p.id === mainId);
    const sub = getPets().find(p => p.id === subId);
    if (!main || !sub) return { error: '宠物不存在' };
    if (main.id === sub.id) return { error: '不能选择同一只宠物' };
    // 神级宠不准参与合成（2026-09-11 拍板）：只能涅槃——防止把神宠当素材合没
    const godOf = p => (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(p) : !!(p && p.isGodPet);
    if (godOf(main) || godOf(sub)) return { error: '神级宠不准参与合成（只能涅槃）' };
    if (main.level < S.minLevel || sub.level < S.minLevel) {
      return { error: `两只素材宠都必须达到 ${S.minLevel} 级才能合成` };
    }
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，合成会同步云端存档' };
    if (!main.cloudId || !sub.cloudId) return { error: '有宠物未同步云端，刷新页面后再试' };
    if (Market.isListed(main.cloudId)) return { error: `${main.name} 正在市场出售，先取回再合成` };
    if (Market.isListed(sub.cloudId)) return { error: `${sub.name} 正在市场出售，先取回再合成` };
    if (Materials.getQuantity(S.material.name) < S.material.amount) {
      return { error: `需要 ${S.material.amount} 颗${S.material.name}，去挂机刷材料吧` };
    }

    const spent = await Materials.spend(S.material.name, S.material.amount);
    if (!spent.ok) return { error: spent.error || '材料扣减失败' };

    // 选中合成道具校验+消耗（第二版手册 2.2：道具化）
    // 校验失败必须【退回已扣的合成之石】：道具不足/类别不对时玩家不该白亏基础材料
    const synthItem = itemId ? (Config.itemOf ? Config.itemOf(itemId) : null) : null;
    if (synthItem) {
      if (synthItem.category !== 'synth') { Materials.gain(S.material.name, S.material.amount); return { error: '所选道具不是合成道具' }; }
      if (Materials.getQuantity(synthItem.name) < 1) { Materials.gain(S.material.name, S.material.amount); return { error: synthItem.name + '不足' }; }
      const is = await Materials.spend(synthItem.name, 1);
      if (!is.ok) { Materials.gain(S.material.name, S.material.amount); return { error: is.error || '道具扣减失败' }; }
    }

    // 神级宠判定（第二版手册 2.2：道具化）：终阶 + 成长达标 + 等级达标 → 概率由选中道具 godChance 决定
    const gi = godSynthInfo(main, sub, itemId);
    let isGod = false;
    if (gi.ready && gi.god) {
      // 服务端权威校验（手册 6.4，migrate_god_pet.sql 的 check_god_synth）：双终阶+成长≥minGrowth。
      if (Supabase.rpc) {
        try {
          const Pet = window.Pet;
          const st = p => (Pet && Pet.getEvolveStage) ? Pet.getEvolveStage(p) : ((p.evolveTimes || 0) + 1);
          const chk = await Supabase.rpc('check_god_synth', {
            p_main: { evolve_stage: st(main), growth: main.growth },
            p_sub: { evolve_stage: st(sub), growth: sub.growth }
          });
          if (chk && chk.data && chk.data.ok === false) {
            return { error: '神级宠合成被服务器拒绝：' + (chk.data.code || '门槛不足') };
          }
        } catch (e) { /* RPC 不可用：放行 */ }
      }
      isGod = Math.random() < gi.chance;
    }

    // 变异判定：概率出全新「·异变」宠
    const mutated = rollMutation(S);
    let newGrowth = calcSynthesizeGrowth(main, sub, mutated, itemId);
    let newName = mutated ? mutatedName(main.name) : main.name;
    let bHp = main.baseHp, bAtk = main.baseAtk, bDef = main.baseDef;
    let lineId = main.lineId || main.name;
    let godStatCoeffBonus = 0;
    if (isGod && gi.god) {
      // 神级宠是【单独的宠物】：自己的名字、基础值、成长系数（普通宠 ×1.5），生而为终阶
      newName = gi.god.name;
      bHp = gi.god.baseHp; bAtk = gi.god.baseAtk; bDef = gi.god.baseDef;
      lineId = gi.god.name;
      // 第二版手册 2.2：神级宠出生上限 birthGrowthCap（满神60），超过部分折算 statCoeff 永久加成
      const GP = Config.pet && Config.pet.godPets;
      const cap = (GP && GP.birthGrowthCap) || 60;
      const excessRatio = (GP && GP.excessStatCoeffRatio) || 0.01;
      const excessMax = (GP && GP.excessStatCoeffMax) || 0.2;
      if (newGrowth > cap) {
        const excess = newGrowth - cap;
        godStatCoeffBonus = Math.min(excess * excessRatio, excessMax);
        newGrowth = cap;
      }
    }
    // 新宠继承主宠形态基础值，等级回 1（头像/立绘按名字由 PetSprites 解析）
    const baby = createPet(newName, null, newGrowth, bHp, bAtk, bDef, main.baseSpd, lineId);
    if (isGod) { baby.isGodPet = true; baby.evolveStage = 5; baby.statCoeffBonus = godStatCoeffBonus; }
    baby.level = 1;
    baby.exp = 0;
    baby.traits = inheritSynthTraits(main, sub, mutated, { subAll: synthItem && synthItem.id === 'synth_supreme' });   // 血脉特质继承（合成；至尊神石副宠词条 100%）
    addPet(baby);
    // 新宠云端建档（合成是新增一只，不是改主宠）。
    // 顺序铁律（2026-09-10）：建档【确认成功】之前，素材宠和材料一律不动。
    // 事故复盘：旧代码建档失败只 console.warn，后面照样删两只素材宠 → 新宠只存在本地，
    // 刷新即凭空消失（玩家白亏两只素材 + 材料；云端 0 条「·异变」行可证）。
    // 现在建档失败 = 整单回滚：新宠不入列、合成之石/道具全退、素材宠原地不动，可原样重试。
    const saved = await Supabase.savePet(baby);
    if (saved.data && saved.data.id) baby.cloudId = saved.data.id;
    if (!baby.cloudId) {
      const why = (saved.error && saved.error.message) || '未知错误';
      removePet(baby.id);
      Materials.gain(S.material.name, S.material.amount);
      if (synthItem) Materials.gain(synthItem.name, 1);
      return { error: '新宠云端建档失败，材料与素材宠已原样退还，请稍后重试（' + why + '）' };
    }

    // 两只素材宠都消失。顺序铁律（2026-09-08）：先删云端、成功才删本地——
    // 反过来时云端删除失败（网络抖动）素材宠会在刷新后"复活"，看起来就是"合成一次却多出一只"。
    // 删除失败时保留本地行并如实上报：玩家资产不凭空消失，也不与云端打架，可重试放生。
    const resurrected = [];
    const delMain = await Supabase.deletePet(main.cloudId);
    if (delMain.error) {
      resurrected.push(main.name);
      console.warn('云端删除主素材宠失败，本地保留：', delMain.error.message);
    } else {
      removePet(main.id);
    }
    const delSub = await Supabase.deletePet(sub.cloudId);
    if (delSub.error) {
      resurrected.push(sub.name);
      console.warn('云端删除副素材宠失败，本地保留：', delSub.error.message);
    } else {
      removePet(sub.id);
    }
    if (resurrected.length && window.UI && window.UI.addLog) {
      window.UI.addLog(`⚠️ 素材宠「${resurrected.join('、')}」云端删除失败，仍在你的列表里，可稍后再放生`);
    }

    // 任务进度上报：所有 type=synth 的任务 +1
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('synth', 1);

    return { ok: true, baby, mainName: main.name, subName: sub.name, mutated, newGrowth, isGod, synthItem, godStatCoeffBonus, resurrected };
  }

  /* ---------- 血脉特质继承 / 植入（设计 v1） ---------- */
  // 继承时 T 阶变化：20% +1 阶（封顶 T1）、10% -1 阶（最低 T3）
  function shiftTier(tier, upP, downP) {
    const r = Math.random();
    if (r < upP) return Math.max(1, tier - 1);
    if (r < upP + downP) return Math.min(3, tier + 1);
    return tier;
  }
  // 合成继承（2026-09-11 拍板重做）：主宠词条【全保留、只升不降】（升档 20%）——
  //   旧版主宠每条 70% 随机保留，玩家会莫名丢自己的血脉（直觉灾难），已废。
  // 副宠词条：40% 概率嫁接（主宠成长≥60 → 50%；opts.subAll=至尊神石 → 100%）——
  //   新类型直接新增（档位照抄副宠），已有类型取两边更高档；满 3 栏后新类型进不来，同类型仍可升档。
  // 变异成功追加 1 条（档位走 traitHatch.mutant：T1 20%、保底 T2——此前误用普通 roll）；
  //   满栏时：同类型取高阶，全新类型挤掉主宠档位最低的那条（T1 永不被顶）。
  function inheritSynthTraits(main, sub, mutated, opts) {
    const cfg = Config.traitInherit || {};
    const upP = cfg.up != null ? cfg.up : 0.2;
    const cap = cfg.cap != null ? cfg.cap : 3;
    const defs = Config.petTraits || {};
    const keys = Object.keys(defs);
    const out = [];
    const put = (id, tier) => {
      const ex = out.find(t => t.id === id);
      if (ex) { if (tier < ex.tier) ex.tier = tier; return true; }   // 同类型取更高档
      if (out.length >= cap) return false;                            // 满栏：新类型进不来
      out.push({ id, tier });
      return true;
    };
    for (const t of (main.traits || [])) put(t.id, shiftTier(t.tier, upP, 0));
    let giveP = (cfg.subKeep != null ? cfg.subKeep : cfg.synthGive) != null
      ? (cfg.subKeep != null ? cfg.subKeep : cfg.synthGive) : 0.4;
    if (opts && opts.subAll) giveP = 1;   // 至尊神石：副宠词条 100% 继承
    else if ((main.growth || 0) >= (cfg.growthMin != null ? cfg.growthMin : 60)) {
      giveP += (cfg.growthBonus != null ? cfg.growthBonus : 0.1);
    }
    for (const t of (sub.traits || [])) {
      if (Math.random() < Math.min(1, giveP)) put(t.id, t.tier);
    }
    if (mutated && keys.length) {
      const m = (Config.traitHatch && Config.traitHatch.mutant) || {};
      const id = keys[Math.floor(Math.random() * keys.length)];
      const t1 = m.t1Boost != null ? m.t1Boost : 10;
      const tier = Math.random() * 100 < t1 ? 1 : (m.minTier != null ? Math.min(m.minTier, 3) : 3);
      if (!put(id, tier)) {
        const worst = out.slice().sort((a, b) => b.tier - a.tier)[0];
        if (worst && worst.tier > tier) { out.splice(out.indexOf(worst), 1); out.push({ id, tier }); }
      }
    }
    return out;
  }
  // 涅槃植入：副宠每条 30% 概率植入主宠（同类型取高 T，不叠加）；主宠特质全保留
  function implantNirvanaTraits(main, sub, forcedId) {
    const cfg = Config.traitNirvana || {};
    const chance = cfg.implantChance != null ? cfg.implantChance : 0.3;
    const cap = (Config.traitInherit && Config.traitInherit.cap) || 3;
    const subTraits = (sub && sub.traits) || [];
    if (forcedId) {
      const st = subTraits.find(t => t.id === forcedId);
      const list = main.traits || (main.traits = []);
      if (st) {
        const same = list.find(t => t.id === st.id);
        if (same) { if (st.tier < same.tier) same.tier = st.tier; }
        else if (list.length < cap) list.push({ id: st.id, tier: st.tier });
      }
      return list;
    }
    if (!subTraits.length || !main) return (main && main.traits) || [];
    const list = main.traits || (main.traits = []);
    for (const st of subTraits) {
      if (forcedId || Math.random() >= chance) continue; // 锁魂玉定向：其余词条一律不进
      const same = list.find(t => t.id === st.id);
      if (same) {
        if (cfg.takeHigherT !== false && st.tier < same.tier) same.tier = st.tier; // 取高 T（数字小=高）
        continue;
      }
      if (list.length < cap) list.push({ id: st.id, tier: st.tier });
    }
    return list;
  }

  // 神宠培育（2026-09-11 新增）：神级宠吃玉露直接涨成长（天仙 0.5~0.8 / 琼浆 0.8~1.3），成长 100 封顶。
  // 普通宠不能用（成长走进化/合成）；道具云端原子扣，失败不涨。
  async function cultivate(petId, itemId) {
    const k = 'cul:' + petId + ':' + itemId;
    if (inFlight.has(k)) return { error: '培育进行中，请勿重复点击' };
    inFlight.add(k);
    try {
      const pet = getPets().find(p => p.id === petId);
      const item = itemId ? (Config.itemOf ? Config.itemOf(itemId) : null) : null;
      if (!pet) return { error: '宠物不存在' };
      const isGod = (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(pet) : !!pet.isGodPet;
      if (!isGod) return { error: '只有神级宠可以培育' };
      if (!item || !item.godGrowth) return { error: '所选道具不能用于神宠培育' };
      const maxCul = (Config.pet && Config.pet.godPets && Config.pet.godPets.cultivateMax) || 10;
      if ((pet.cultivateUsed || 0) >= maxCul) return { error: '本轮培育次数已用完（' + maxCul + '/' + maxCul + '），涅槃后可重置' };
      if ((pet.growth || 0) >= 100) return { error: '成长已达 100，培育封顶' };
      if (Materials.getQuantity(item.name) < 1) return { error: item.name + '不足' };
      const spent = await Materials.spend(item.name, 1);
      if (!spent.ok) return { error: spent.error || '道具扣减失败' };
      const g = item.godGrowth;
      const add = Math.round((g[0] + Math.random() * (g[1] - g[0])) * 10) / 10;
      const oldGrowth = pet.growth;
      pet.growth = Math.min(100, Math.round((pet.growth + add) * 10) / 10);
      pet.cultivateUsed = (pet.cultivateUsed || 0) + 1;
      if (pet.cloudId) {
        const r = await Supabase.updatePet(pet.cloudId, { growth: pet.growth, cultivate_used: pet.cultivateUsed });
        if (r && r.error) console.warn('云端更新培育成长失败：', r.error.message);
      }
      return { ok: true, pet, oldGrowth, add: Math.round((pet.growth - oldGrowth) * 10) / 10, itemName: item.name, used: pet.cultivateUsed, left: Math.max(0, maxCul - pet.cultivateUsed) };
    } finally { inFlight.delete(k); }
  }

  /* ---------- 对外 API ---------- */
  window.Merge = {
    nirvana,              // 涅槃：主宠涨成长（新）
    synthesize,           // 合成：出全新变异宠（新）
    merge: nirvana,       // 兼容别名：旧调用 Merge.merge = 涅槃
    getMergeCandidates, canMerge, canSynthesize,
    calcNirvanaGrowth, calcSynthesizeGrowth,
    inheritSynthTraits, implantNirvanaTraits, cultivate,
    // 神级宠（手册 2.6）
    godSynthInfo
  };
})();
