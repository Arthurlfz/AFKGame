/* ============================================================
 * pet_merge.js —— 宠物合成 + 涅槃（原「融合」拆分为两个独立玩法）
 * 职责：
 *  1. 合成 synthesize：两只宠物 → 概率合成一只全新「·异变」稀有宠（复用变异规则）
 *       - 变异成功：出一只全新「·异变」宠，成长 = 主×mainW + 副×subW + 随机加成
 *       - 变异失败：出一只普通新宠（继承主宠形态），成长 = 加权和
 *       - 两只素材宠都消失；新宠等级回 1；消耗「合成之石」
 *  2. 涅槃 nirvana（= 原融合 merge）：主宠吸副宠成长 + 重置等级 + 突破成长上限
 *       - 主宠保留，吸副宠成长；副宠消失；等级重置回 1；消耗「涅磐兽」
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
  const canMerge = pet => {
    const minLv = NV().minLevel || 40;
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
  function calcNirvanaGrowth(main, sub) {
    const M = NV();
    const minLv = M.minLevel || 40;
    const lvBonus = 1 + Math.max(0, (sub.level || 0) - minLv) * (M.levelBonus || 0); // 等级加成倍数
    // 副宠成长下限校验：不足则吸收打折
    const subReq = (main.growth || 0) * (M.subGrowthRatio || 0);
    const subRatioPenalty = sub.growth < subReq;
    const ratio = subRatioPenalty ? (M.lowGrowthPenalty || 0.2) : 1;
    // 60 成长分水岭：主宠成长达标后吸收减半
    const capApplied = (main.growth || 0) >= (M.growthCap || 60);
    const capRatio = capApplied ? (M.capRatio || 0.5) : 1;
    // 成长软上限：主宠成长已达 maxGrowth 则不再涨（仅重置等级）
    const maxGrowth = M.maxGrowth || 100;
    let absorb = sub.growth * M.absorbRatio * lvBonus * ratio * capRatio;
    if ((main.growth || 0) >= maxGrowth) absorb = 0;
    const growth = Math.round(((main.growth || 0) + absorb) * 10) / 10;
    return { growth, subRatioPenalty, capApplied };
  }

  /* ---------- 合成成长计算（纯函数，synthesize 与 UI 预览共用） ---------- */
  // calcSynthesizeGrowth(main, sub, mutated) → 合成后新宠成长
  //   加权和 = 主×mainW + 副×subW；变异成功再 +随机加成
  function calcSynthesizeGrowth(main, sub, mutated) {
    const S = SYN();
    const base = (main.growth || 0) * (S.mainW || 0.6) + (sub.growth || 0) * (S.subW || 0.4);
    const bonus = mutated && S.mutation ? randInt(S.mutation.growthBonus[0], S.mutation.growthBonus[1]) : 0;
    return Math.round((base + bonus) * 10) / 10;
  }

  /* ============================================================
   * 涅槃 nirvana（= 原融合 merge）：主宠吸副宠成长 + 重置等级
   * ============================================================ */
  async function nirvana(mainId, subId) {
    const M = NV();
    const main = getPets().find(p => p.id === mainId);
    const sub = getPets().find(p => p.id === subId);
    if (!main || !sub) return { error: '宠物不存在' };
    if (main.id === sub.id) return { error: '不能选择同一只宠物' };
    if (main.level < M.minLevel || sub.level < M.minLevel) {
      return { error: `两只宠物都必须达到 ${M.minLevel} 级才能涅槃` };
    }
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，涅槃会同步云端存档' };
    if (!main.cloudId || !sub.cloudId) return { error: '有宠物未同步云端，刷新页面后再试' };
    if (Market.isListed(main.cloudId)) return { error: `${main.name} 正在市场出售，先取回再涅槃` };
    if (Market.isListed(sub.cloudId)) return { error: `${sub.name} 正在市场出售，先取回再涅槃` };
    if (Materials.getQuantity(M.material.name) < M.material.amount) {
      return { error: `需要 ${M.material.amount} 只${M.material.name}，去挂机刷材料吧` };
    }

    const spent = await Materials.spend(M.material.name, M.material.amount);
    if (!spent.ok) return { error: spent.error || '材料扣减失败' };

    const oldGrowth = main.growth;
    const { growth: newGrowth } = calcNirvanaGrowth(main, sub);
    main.growth = newGrowth;

    // 涅槃 = 突破：重置进化次数 + 累计涅槃/转生次数 + 等级重置
    main.evolveTimes = 0;
    main.rebornCount = (main.rebornCount || 0) + 1;
    if (M.resetLevel) { main.level = 1; main.exp = 0; }
    main.curHp = getStats(main).hp;

    // 副宠消失
    removePet(sub.id);
    const { error: delErr } = await Supabase.deletePet(sub.cloudId);
    if (delErr) console.warn('云端删除副宠失败：', delErr.message);

    // 主宠成长/等级同步云端
    const patch = { growth: newGrowth, evolve_times: main.evolveTimes, reborn_count: main.rebornCount };
    // 等级重置时必须连 exp 一起清零并同步：否则云端留着旧经验，
    // 刷新后会变成「Lv1 + 几千经验」，打一场直接连升几十级
    if (M.resetLevel) { patch.level = main.level; patch.exp = 0; }
    const { error: updErr } = await Supabase.updatePet(main.cloudId, patch);
    if (updErr) console.warn('云端更新宠物失败：', updErr.message);

    return { ok: true, main, oldGrowth, newGrowth, subName: sub.name };
  }

  /* ============================================================
   * 合成 synthesize：两只宠物 → 概率合成一只全新「·异变」宠
   * ============================================================ */
  async function synthesize(mainId, subId) {
    const S = SYN();
    const main = getPets().find(p => p.id === mainId);
    const sub = getPets().find(p => p.id === subId);
    if (!main || !sub) return { error: '宠物不存在' };
    if (main.id === sub.id) return { error: '不能选择同一只宠物' };
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

    // 变异判定：概率出全新「·异变」宠
    const mutated = rollMutation(S);
    const newGrowth = calcSynthesizeGrowth(main, sub, mutated);
    const newName = mutated ? mutatedName(main.name) : main.name;
    // 新宠继承主宠形态基础值（图标/基底），等级回 1
    const baby = createPet(newName, main.icon, newGrowth, main.baseHp, main.baseAtk, main.baseDef, main.baseSpd, main.lineId || main.name);
    baby.level = 1;
    baby.exp = 0;
    addPet(baby);
    // 新宠云端建档（合成是新增一只，不是改主宠）
    const saved = await Supabase.savePet(baby);
    if (saved.data && saved.data.id) baby.cloudId = saved.data.id;
    if (saved.error) console.warn('云端保存合成宠失败：', saved.error.message);

    // 两只素材宠都消失
    removePet(main.id);
    removePet(sub.id);
    await Supabase.deletePet(main.cloudId);
    const { error: delErr } = await Supabase.deletePet(sub.cloudId);
    if (delErr) console.warn('云端删除素材宠失败：', delErr.message);

    return { ok: true, baby, mainName: main.name, subName: sub.name, mutated, newGrowth };
  }

  /* ---------- 对外 API ---------- */
  window.Merge = {
    nirvana,              // 涅槃：主宠涨成长（新）
    synthesize,           // 合成：出全新变异宠（新）
    merge: nirvana,       // 兼容别名：旧调用 Merge.merge = 涅槃
    getMergeCandidates, canMerge,
    calcNirvanaGrowth, calcSynthesizeGrowth
  };
})();
