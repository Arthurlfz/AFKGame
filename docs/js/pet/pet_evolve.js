/* ============================================================
 * pet_evolve.js —— 宠物进化系统
 * 职责：
 *  1. 校验进化条件：基宠达到 minLevel（30）+ 在进化路线内 + 已登录 + 不在售
 *  2. 执行进化：100% 成功；只消耗对应进化素材（不耗涅磐兽）；等级不变；
 *     成长值 + growthBoost 随机加成；名字变为进化体；属性按新成长自动重算
 *  3. 进化体名字/成长同步云端，刷新后仍是进化体
 * 规则（config.pet.evolution）：minLevel / growthBoost / routes
 * 依赖：pet.js / materials.js / supabase.js / market.js（在售检查）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { getPets, getStats } = window.Pet;
  const { randInt, randFloat } = window.Util;
  const Materials = window.Materials;
  const Supabase = window.Supabase;
  const Market = window.Market;

  const E = () => Config.pet.evolution;

  /* ---------- 5 阶进化（2026-09-06，手册 2.5） ----------
   * 阶段 1~5：初始 / 一阶 Lv10 / 二阶 Lv25 / 三阶 Lv40（淬体·形态不变） / 终阶 Lv60。
   * 「下一阶」由 Config.pet.evolution.stages 唯一决定 —— 素材档位、等级门槛、成长加成都从它读，
   * 不再按 evolveTimes 猜档（旧代码用 3/6 切档，与 5 阶对不上）。 */
  const Pet = window.Pet;
  const stageOf = pet => (Pet && Pet.getEvolveStage) ? Pet.getEvolveStage(pet) : Math.min(5, ((pet && pet.evolveTimes) || 0) + 1);
  function nextStageOf(pet) {
    const cfg = E();
    if (!cfg || !pet) return null;
    return (cfg.stages || []).find(s => s.stage === stageOf(pet) + 1) || null;
  }
  // 取某宠下一阶的进化路线：
  //  · 换形态阶（form:true）→ 走进化树，形态名/图标来自 tree，等级门槛用 stages 的（覆盖 tree 旧值）
  //  · 淬体阶（form:false，三阶 Lv40）→ 占位路线：形态不变，只涨成长
  function getEvolutionRoutes(pet) {
    const cfg = E();
    if (!cfg || !pet) return [];
    const next = nextStageOf(pet);
    if (!next) return [];   // 已到终阶，没有下一阶
    if (!next.form) {
      return [{ to: pet.name, minLevel: next.minLevel, keepForm: true, stage: next.stage, label: next.label, desc: next.desc }];
    }
    const routes = (cfg.tree && cfg.tree[pet.name]) || [];
    if (routes.length) {
      return routes.map(r => Object.assign({}, r, {
        minLevel: next.minLevel, stage: next.stage, label: next.label, desc: next.desc, keepForm: false
      }));
    }
    // 形态树到头（终形态被重复进化等异常）：降级成淬体，保证阶段链能走完
    return [{ to: pet.name, minLevel: next.minLevel, keepForm: true, stage: next.stage, label: next.label, desc: next.desc }];
  }
  // 当前形态是否有进化路线（不管等级/次数，用于显示进化入口）
  function hasRoute(pet) {
    return getEvolutionRoutes(pet).length > 0;
  }
  /* 是否可进化：只认「还有下一阶」+ 等级门槛。
   * ⚠️ 2026-09-10 修（用户实测卡死案例）：不再用 `evolveTimes >= maxEvolveTimes` 当闸门。
   *   次数是【历史累计值】，会和阶段脱钩 —— 老规则（10 次进化时代）存下来的宠会出现
   *   「次数已满 4、阶段却只到三阶」，被次数硬卡在中间阶，永远到不了终阶
   *   （现场数据：血疫暴君 Lv58 / 进化次数 4 / 云端阶段 4 / 下一阶=终阶但"能进化=false"）。
   *   阶段链本身是有限的（stages 只有 5 阶），所以「没有下一阶」已经是天然上限；
   *   次数从此只作展示，并在 evolve 里被校准成「阶段 − 1」。 */
  function canEvolve(pet) {
    const cfg = E();
    if (!cfg || !pet) return false;
    const routes = getEvolutionRoutes(pet);
    if (!routes.length) return false;
    return routes.some(r => pet.level >= (r.minLevel || 1));
  }
  // 当前阶 → 下一阶所需素材名（由 stages 决定：普通 / 精粹 / 传说）
  function getEvoTier(pet) {
    const next = nextStageOf(pet);
    return (next && next.material) || (E() && E().materialName) || '进化素材';
  }
  // 取某条路线所需素材信息：{ name, amount, total, have, enough, extra?, stage, label }
  // extra = 可选的终阶额外消耗（2026-09-11 起当前 config 未配置；机制保留，配了才收）
  // ⚠️ extra 与主素材同名时，判定与扣款都按合并总量（total）——
  //   分开判会“每笔都够、合起来不够”，第二笔原子扣款失败（2026-09-11 修过的真 bug）。
  function getRouteMaterial(pet, routeIndex) {
    const route = getEvolutionRoutes(pet)[routeIndex];
    if (!route) return null;
    const next = nextStageOf(pet);
    const name = (next && next.material) || E().materialName || '进化素材';
    const amount = (next && next.amount) || 1;
    const ex = (next && next.extra) || null;
    const sameName = !!(ex && ex.name === name);
    const total = amount + (sameName ? ex.amount : 0);
    const have = Materials.getQuantity(name);
    const haveExtra = ex ? Materials.getQuantity(ex.name) : 0;
    return {
      name, amount, total, have,
      enough: have >= total,
      extra: ex ? { name: ex.name, amount: ex.amount, have: haveExtra, enough: haveExtra >= ex.amount, sameName } : null,
      stage: next ? next.stage : null,
      label: (next && next.label) || ''
    };
  }

  /* ---------- 执行进化 ---------- */
  // evolve(petId, routeIndex, boostOverride, boostItemId)：预览定好基础成长，所选道具再按倍率放大。
  // boostItemId 只能来自 Config.pet.evolution.boostItems；不传即不消耗道具，兼容旧调用。
  // 成功返回 { ok, pet, oldGrowth, newGrowth, boost, boostItem, result, material, keepForm }，失败返回 { error }
  async function evolve(petId, routeIndex, boostOverride, boostItemId) {
    const cfg = E();
    const pet = getPets().find(p => p.id === petId);
    if (!pet) return { error: '宠物不存在' };

    const next = nextStageOf(pet);
    // 条件：还有下一阶（终阶后不能再进化；想继续变强走合成/神级宠/涅槃）
    // ⚠️ 这里就是唯一的上限判定（阶段链走完）——不再叠加「次数上限」，见 canEvolve 注释。
    if (!next) return { error: '已是终阶，无法继续进化（想再变强请走合成 → 神级宠）' };

    const routes = getEvolutionRoutes(pet);
    const route = routes[routeIndex];
    if (!route) return { error: '该形态无法再进化' };
    const rm = getRouteMaterial(pet, routeIndex) || { name: getEvoTier(pet), amount: 1, have: 0, enough: false };
    const materialName = rm.name;
    // 条件：等级门槛（下一阶的门槛等级，如 Lv10/25/40/60）
    if (pet.level < (route.minLevel || 1)) {
      return { error: `需要达到 Lv.${route.minLevel} 才能进化到${next.label}（当前 Lv.${pet.level}）` };
    }
    // 条件：已登录（素材要云端扣、进化后名字/成长要云端存）
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，进化会同步云端存档' };
    // 条件：已在云端建档
    if (!pet.cloudId) return { error: '宠物未同步云端，刷新页面后再试' };
    // 条件：在售中的宠物不能进化（挂单快照会失效）
    if (Market.isListed(pet.cloudId)) return { error: `${pet.name} 正在市场出售，先取回再进化` };
    // 条件：进化素材足够（若下一阶配了 extra 还要额外素材）
    if (rm.have < rm.amount) {
      return { error: `需要 ${rm.amount} 个${materialName}，去挂机刷材料吧` };
    }
    if (rm.extra && rm.extra.have < rm.extra.amount) {
      return { error: `${next.label}还需要 ${rm.extra.amount} 个${rm.extra.name}` };
    }
    const boostItem = boostItemId ? Config.itemOf(boostItemId) : null;
    if (boostItemId && (!boostItem || !(cfg.boostItems || []).includes(boostItemId) || boostItem.category !== 'evolve')) {
      return { error: '所选进化道具无效' };
    }
    if (boostItem && Materials.getQuantity(boostItem.name) < 1) {
      return { error: `${boostItem.name}不足` };
    }

    // ---- 执行：先扣素材（云端原子扣，成功才继续） ----
    // extra 与主素材同名 → 合并成一笔扣（分开扣会“先扣的吃掉余额”导致第二笔失败）
    const sameNameExtra = !!(rm.extra && rm.extra.name === materialName);
    const mainTotal = rm.amount + (sameNameExtra ? rm.extra.amount : 0);
    const spent = await Materials.spend(materialName, mainTotal);
    if (!spent.ok) return { error: spent.error || '素材扣减失败' };
    // 异名额外素材：扣失败则把主素材退回去，不让玩家白亏
    if (rm.extra && !sameNameExtra) {
      const ex = await Materials.spend(rm.extra.name, rm.extra.amount);
      if (!ex.ok) {
        await Materials.gain(materialName, mainTotal);
        return { error: ex.error || '素材扣减失败' };
      }
    }
    if (boostItem) {
      const itemSpent = await Materials.spend(boostItem.name, 1);
      if (!itemSpent.ok) {
        await Materials.gain(materialName, mainTotal);
        if (rm.extra && !sameNameExtra) await Materials.gain(rm.extra.name, rm.extra.amount);
        return { error: itemSpent.error || `${boostItem.name}扣减失败` };
      }
    }

    // ---- 计算结果；先不改本地，等云端更新成功后再提交 ----
    const oldGrowth = pet.growth;
    const range = (next.growthBoost && next.growthBoost.length === 2) ? next.growthBoost : (cfg.growthBoost || [0.1, 0.2]);
    const baseBoost = Number.isFinite(boostOverride)
      ? boostOverride
      : randFloat(range[0], range[1]);
    const boost = Math.round(baseBoost * (1 + (boostItem ? boostItem.boost || 0 : 0)) * 100) / 100;
    const newGrowth = Math.round((oldGrowth + boost) * 10) / 10;
    const keepForm = !!route.keepForm;
    const nextName = keepForm ? pet.name : route.to;
    /* 次数 = 阶段 − 1（不变量，2026-09-10）：正常宠两者本来就相等；
     * 对「次数与阶段脱钩」的老存档，这里顺手校准回规范值 ——
     * 否则界面会拿错误的次数显示"已达上限"，把玩家挡在终阶门外。 */
    const nextEvolveTimes = Math.max(0, next.stage - 1);

    // ---- 同步云端（含新阶段 evolve_stage，旧库缺列时 Supabase 层自动剔除）；失败则退还素材 ----
    const { error: updErr } = await Supabase.updatePet(pet.cloudId, {
      name: nextName, growth: newGrowth, evolve_times: nextEvolveTimes, evolve_stage: next.stage
    });
    if (updErr) {
      await Materials.gain(materialName, mainTotal);
      if (rm.extra && !sameNameExtra) await Materials.gain(rm.extra.name, rm.extra.amount);
      if (boostItem) await Materials.gain(boostItem.name, 1);
      return { error: `云端存档失败：${updErr.message || '请稍后重试'}` };
    }

    // ---- 云端成功后提交本地状态 ----
    pet.growth = newGrowth;
    pet.name = nextName;
    pet.evolveTimes = nextEvolveTimes;
    pet.evolveStage = next.stage;
    pet.curHp = getStats(pet).hp;

    // 任务进度上报：所有 type=evolve 的任务进度 +1（petName 供宠物专属任务区分）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('evolve', 1, { petName: pet ? pet.name : null });

    return { ok: true, pet, oldGrowth, newGrowth, boost, boostItem, result: pet.name, material: materialName, keepForm, stage: next.stage, stageLabel: next.label };
  }

  /* ---------- 对外 API ---------- */
  window.Evolve = { evolve, getEvolutionRoutes, hasRoute, canEvolve, getRouteMaterial, getEvoTier, nextStageOf, getEvoStage: stageOf };
})();
