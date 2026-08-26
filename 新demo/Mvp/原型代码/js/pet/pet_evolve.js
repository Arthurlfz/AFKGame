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
  const { randInt } = window.Util;
  const Materials = window.Materials;
  const Supabase = window.Supabase;
  const Market = window.Market;

  const E = () => Config.pet.evolution;

  // 取某宠可用的进化路线（当前形态在 tree 有下一形态则返回真实形态；
  // 形态到头但次数未满时，返回一个「继续进化涨成长、形态不变」的占位路线，保证能进化满 maxEvolveTimes 次）
  function getEvolutionRoutes(pet) {
    const cfg = E();
    if (!cfg || !pet) return [];
    const routes = cfg.tree && cfg.tree[pet.name];
    if (routes && routes.length) return routes.slice();
    // 形态到头：若次数还没满，给一个占位「强化进化」（名字/图标不变，只涨成长）
    if ((pet.evolveTimes || 0) < (cfg.maxEvolveTimes || 10)) {
      return [{ to: pet.name, icon: pet.icon, minLevel: 0, keepForm: true, label: '继续进化（成长+）' }];
    }
    return [];
  }
  // 当前形态是否有进化路线（不管等级/次数，用于显示进化入口）
  function hasRoute(pet) {
    return getEvolutionRoutes(pet).length > 0;
  }
  // 是否可进化：次数未满（等级门槛在 evolve 里按具体路线判定）
  function canEvolve(pet) {
    const cfg = E();
    if (!cfg || !pet) return false;
    if ((pet.evolveTimes || 0) >= (cfg.maxEvolveTimes || 10)) return false;
    const routes = getEvolutionRoutes(pet);
    if (!routes.length) return false;
    return routes.some(r => pet.level >= (r.minLevel || 1));
  }
  // 按已进化次数决定当前用哪档进化素材：1~3次=进化素材，4~6次=精粹进化素材，7~10次=传说进化素材
  // （与设计稿"1~3阶/4~6阶/7~10阶"对齐；次数不足无法用更高档）
  function getEvoTier(pet) {
    const t = pet.evolveTimes || 0;
    if (t >= 6) return '传说进化素材';
    if (t >= 3) return '精粹进化素材';
    return '进化素材';
  }
  // 取某条路线所需素材信息：{ name, amount, have, enough }
  function getRouteMaterial(pet, routeIndex) {
    const route = getEvolutionRoutes(pet)[routeIndex];
    if (!route) return null;
    const amount = 1;
    const matName = getEvoTier(pet);
    const have = Materials.getQuantity(matName);
    return { name: matName, amount, have, enough: have >= amount };
  }

  /* ---------- 执行进化 ---------- */
  // evolve(petId, routeIndex)：进化一次。有下一形态则换形态；形态到头则形态不变、只涨成长。
  // 成功返回 { ok, pet, oldGrowth, newGrowth, result, material, keepForm }，失败返回 { error }
  async function evolve(petId, routeIndex) {
    const cfg = E();
    const pet = getPets().find(p => p.id === petId);
    if (!pet) return { error: '宠物不存在' };

    const materialName = getEvoTier(pet); // 按已进化次数用对应档素材
    const maxTimes = cfg.maxEvolveTimes || 10;

    // 条件：进化次数未满（吃满后需融合=转生重置）
    if ((pet.evolveTimes || 0) >= maxTimes) {
      return { error: `进化已达上限(${maxTimes}次)，需通过融合(转生)重置次数后才能继续进化` };
    }

    const routes = getEvolutionRoutes(pet);
    const route = routes[routeIndex];
    if (!route) return { error: '该形态无法再进化' };
    // 条件：等级门槛（形态到头时的占位路线 minLevel=0，不卡等级）
    if (pet.level < (route.minLevel || 1)) {
      return { error: `需要达到 Lv.${route.minLevel} 才能进化（当前 Lv.${pet.level}）` };
    }
    // 条件：已登录（素材要云端扣、进化后名字/成长要云端存）
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，进化会同步云端存档' };
    // 条件：已在云端建档
    if (!pet.cloudId) return { error: '宠物未同步云端，刷新页面后再试' };
    // 条件：在售中的宠物不能进化（挂单快照会失效）
    if (Market.isListed(pet.cloudId)) return { error: `${pet.name} 正在市场出售，先取回再进化` };
    // 条件：通用进化素材足够
    if (Materials.getQuantity(materialName) < 1) {
      return { error: `需要 1 个${materialName}，去挂机刷材料吧` };
    }

    // ---- 执行：先扣素材（云端原子扣，成功才继续） ----
    const spent = await Materials.spend(materialName, 1);
    if (!spent.ok) return { error: spent.error || '素材扣减失败' };

    // ---- 计算结果；先不改本地，等云端更新成功后再提交 ----
    const oldGrowth = pet.growth;
    const boost = randInt(cfg.growthBoost[0], cfg.growthBoost[1]);
    const newGrowth = Math.round((oldGrowth + boost) * 10) / 10;
    const keepForm = !!route.keepForm;
    const nextName = keepForm ? pet.name : route.to;
    const nextIcon = keepForm ? pet.icon : route.icon;
    const nextEvolveTimes = (pet.evolveTimes || 0) + 1;

    // ---- 同步云端；失败则退还素材，不提交本地进化 ----
    const { error: updErr } = await Supabase.updatePet(pet.cloudId, {
      name: nextName, growth: newGrowth, evolve_times: nextEvolveTimes
    });
    if (updErr) {
      await Materials.gain(materialName, 1);
      return { error: `云端存档失败：${updErr.message || '请稍后重试'}` };
    }

    // ---- 云端成功后提交本地状态 ----
    pet.growth = newGrowth;
    pet.name = nextName;
    pet.icon = nextIcon;
    pet.evolveTimes = nextEvolveTimes;
    pet.curHp = getStats(pet).hp;

    // 任务进度上报：所有 type=evolve 的任务进度 +1
    (Config.drop.quests || []).forEach(q => { if (q.type === 'evolve' && window.Quest) window.Quest.report(q.id, 1); });

    return { ok: true, pet, oldGrowth, newGrowth, result: pet.name, material: materialName, keepForm };
  }

  /* ---------- 对外 API ---------- */
  window.Evolve = { evolve, getEvolutionRoutes, hasRoute, canEvolve, getRouteMaterial };
})();
