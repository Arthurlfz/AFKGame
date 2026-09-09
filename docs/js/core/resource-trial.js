(function () {
  'use strict';

  const state = { running: false, route: null, round: 0, result: null };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cfg = () => window.Config && window.Config.resourceTrials || {};
  const routes = () => Array.isArray(cfg().routes) ? cfg().routes : [];

  function routeOf(id) { return routes().find(route => route.id === id) || null; }

  function rewardFor(route, pet) {
    // 涅磐兽早已不是涅槃消耗品（涅槃消耗的是涅槃丹，见 pet_merge.js），发它玩家不知道干嘛用
    if (route.reward === 'phoenix') return { name: '涅槃丹', qty: 1 };
    if (route.reward === 'craft') {
      return Number(pet.level) >= 25
        ? [{ name: '增缀石', qty: 1 }, { name: '剥离石', qty: 1 }]
        : [{ name: '重铸石', qty: 2 }];
    }
    const level = Number(pet.level) || 1;
    if (level >= 40) return { name: '传说进化素材', qty: 1 };
    if (level >= 25) return { name: '精粹进化素材', qty: 1 };
    return { name: '进化素材', qty: 2 };
  }

  /* 单场结果（2026-09-09 修正伤害模型）
   * 旧模型：taken = (敌攻 - 玩家防) × 回合数，success = taken < 最大血 × 0.78。
   *   实测（成长 3 起步宠，Lv5~60，三条路线）：玩家防御成长远快于试炼敌攻 →
   *   全程 0 伤害 → 100% 通关、失败分支是死代码，试炼毫无风险也没有强度区分度。
   * 新模型：每回合按最大生命的固定比例掉血，比例随轮次递增，总伤害 = 比例 × 回合数。
   *   - 攻击越高 → 打得越快 → 回合越少 → 挨打越少（强度真正决定结果）
   *   - 轮次越深 → 比例越高（后段有压力，撑不住就失败，只发区域材料补偿）
   *   - 血量跨场累计，不回满（连续 5 场是一场远征，不是 5 次独立判定）
   * 参数全在 Config.resourceTrials：hitRatio（每回合基础掉血比例）/ roundRatio（每轮递增）。 */
  function roundResult(pet, route, round, hpLeft) {
    const stats = window.Pet.getStats(pet) || {};
    const level = Number(pet.level) || 1;
    const maxHp = Number(stats.hp) || 1;
    const enemyDef = Math.round((8 + level * 0.9 + round * 2) * route.difficulty);
    const enemyHp = Math.round((55 + level * 5 + round * 12) * route.difficulty);
    const damage = Math.max(1, Math.floor((Number(stats.atk) || 1) - enemyDef));
    const turns = Math.ceil(enemyHp / damage);
    const perHit = maxHp * (cfg().hitRatio || 0.05) * route.difficulty * (1 + round * (cfg().roundRatio || 0.15));
    const taken = perHit * Math.max(1, turns);
    const left = hpLeft - taken;
    return { round: round + 1, turns, taken: Math.round(taken), hpLeft: Math.max(0, left), success: left > 0 };
  }

  async function start(routeId, options) {
    options = options || {};
    if (!cfg().enabled) return { ok: false, error: '资源试炼尚未开放' };
    if (state.running) return { ok: false, error: '已有资源试炼进行中' };
    const route = routeOf(routeId);
    const pet = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
    if (!route) return { ok: false, error: '试炼路线不存在' };
    if (!pet) return { ok: false, error: '请先选择出战宠物' };
    if ((Number(pet.level) || 1) < (route.minLevel || 1)) return { ok: false, error: `需要宠物达到 Lv${route.minLevel}` };
    const ticket = cfg().ticketName || '资源试炼门票';
    if (!window.Materials || !window.Materials.spend) return { ok: false, error: '材料系统不可用' };
    const spent = await window.Materials.spend(ticket, 1);
    if (!spent || spent.ok === false) return { ok: false, error: spent && spent.error || `缺少${ticket}` };

    state.running = true;
    state.route = route;
    state.round = 0;
    state.result = null;
    if (window.UI && window.UI.renderResourceTrial) window.UI.renderResourceTrial();
    const results = [];
    let hpLeft = Number((window.Pet.getStats(pet) || {}).hp) || 1;
    for (let i = 0; i < (cfg().rounds || 5); i++) {
      const result = roundResult(pet, route, i, hpLeft);
      hpLeft = result.hpLeft;
      results.push(result);
      state.round = i + 1;
      if (window.UI && window.UI.renderResourceTrial) window.UI.renderResourceTrial();
      if (!options.instant) await wait(cfg().roundDelayMs || 420);
      if (!result.success) break;
    }
    const cleared = results.length === (cfg().rounds || 5) && results.every(result => result.success);
    const reward = cleared ? rewardFor(route, pet) : { name: '区域材料', qty: 1 };
    for (const item of (Array.isArray(reward) ? reward : [reward])) window.Materials.gain(item.name, item.qty);
    const maxHp = Number((window.Pet.getStats(pet) || {}).hp) || 1;
    state.result = { cleared, reward, rounds: results.length, hpPercent: Math.max(0, Math.round(hpLeft / maxHp * 100)) };
    state.running = false;
    if (window.UI && window.UI.renderResourceTrial) window.UI.renderResourceTrial();
    if (window.UI && window.UI.showToast) window.UI.showToast(cleared ? '资源试炼完成' : '资源试炼结束', cleared ? '已获得定向资源' : '强度不足，获得少量补偿');
    return { ok: true, cleared, reward, rounds: results.length, hpPercent: state.result.hpPercent };
  }

  function getState() { return { running: state.running, route: state.route, round: state.round, result: state.result }; }
  window.ResourceTrial = { routes, routeOf, start, getState };
})();
