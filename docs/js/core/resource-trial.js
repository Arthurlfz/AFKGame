(function () {
  'use strict';

  const state = { running: false, route: null, round: 0, result: null };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cfg = () => window.Config && window.Config.resourceTrials || {};
  const routes = () => Array.isArray(cfg().routes) ? cfg().routes : [];

  function routeOf(id) { return routes().find(route => route.id === id) || null; }

  /* ============ 每日免费进入次数（2026-09-09） ============
   * 每个副本每天有 Config.resourceTrials.freeEntriesPerDay 次免费进入；
   * 免费次数于【北京时间 12:00】刷新（即 12:00 起的 24 小时为一个「试炼日」），
   * 用尽后进入需消耗 1 张门票（ticketName）——「每日刷新进入次数，或有卷可重新进入」。
   * 存储：本地 localStorage（资源试炼当前是本地 MVP，与 HANDOFF 文档一致；
   * 正式化为服务端权威结算时，把 used 一并搬到云端账本）。
   */
  const USAGE_KEY = 'fos_trial_usage';

  // 计算「试炼日」键：以北京时间 12:00 为换日点。
  // 当天 12:00 ~ 次日 11:59 属于同一试炼日（key = 起始日）。
  // 例：北京时间 2026-09-09 11:59 → "2026-9-8"；12:00 → "2026-9-9"。
  function dayKeyOf(date) {
    const bj = new Date((date || new Date()).getTime() + 8 * 3600 * 1000); // 北京 = UTC+8
    const y = bj.getUTCFullYear(), m = bj.getUTCMonth() + 1, d = bj.getUTCDate();
    if (bj.getUTCHours() < 12) {
      const prev = new Date(Date.UTC(y, m - 1, d - 1));
      return prev.getUTCFullYear() + '-' + (prev.getUTCMonth() + 1) + '-' + prev.getUTCDate();
    }
    return y + '-' + m + '-' + d;
  }

  function loadUsage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(USAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.dayKey && parsed.used) return parsed;
        }
      }
    } catch (e) { /* 存储不可用（隐私模式/测试 VM）时退化为内存态 */ }
    return { dayKey: '', used: {} };
  }
  let usage = loadUsage();

  function saveUsage() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    } catch (e) { /* 写失败不阻塞试炼流程 */ }
  }

  // 换日（过了北京时间 12:00 或首次进入）则清零当天已用次数
  function ensureDay() {
    const key = dayKeyOf(new Date());
    if (usage.dayKey !== key) {
      usage = { dayKey: key, used: {} };
      saveUsage();
    }
  }

  // 每日免费次数（配置缺省/非法 → 0 = 纯门票模式，兼容旧配置）
  function freePerDay() {
    const n = Number(cfg().freeEntriesPerDay);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }

  // 全部路线的每日进入信息（UI 面板 / 地图标记徽标用）
  function getDailyInfo() {
    ensureDay();
    const free = freePerDay();
    return routes().map(route => {
      const used = usage.used[route.id] || 0;
      return { routeId: route.id, used, freePerDay: free, freeLeft: Math.max(0, free - used) };
    });
  }

  // 单条路线的进入资格：免费剩余 / 门票数量（节点详情页用）
  function entryInfo(routeId) {
    const info = getDailyInfo().find(i => i.routeId === routeId)
      || { freeLeft: 0, freePerDay: 0, used: 0 };
    const ticket = cfg().ticketName || '资源试炼门票';
    const ticketQty = (window.Materials && window.Materials.getQuantity)
      ? window.Materials.getQuantity(ticket) : 0;
    return {
      freeLeft: info.freeLeft, freePerDay: info.freePerDay, used: info.used,
      ticketName: ticket, ticketQty
    };
  }

  /* 奖励全部由 Config.resourceTrials.routes[].tiers / .consolation 决定（2026-09-09）。
   * 旧写法把材料名硬编码在这里 —— 调数值要改 JS，且没法被测试静态校验，
   * 于是"某种资源到底从哪来"这件事在代码里散落两份，资源归属矩阵形同虚设。 */
  function tierOf(route, level) {
    const tiers = Array.isArray(route.tiers) ? route.tiers : [];
    let best = null;
    for (const tier of tiers) {
      if (level >= (Number(tier.minLevel) || 1) && (!best || (Number(tier.minLevel) || 1) > (Number(best.minLevel) || 1))) best = tier;
    }
    return best;
  }

  function rewardFor(route, pet) {
    const level = Number(pet && pet.level) || 1;
    const tier = tierOf(route, level);
    if (tier && Array.isArray(tier.items) && tier.items.length) return tier.items.slice();
    return null;
  }

  /* 失败补偿：只给本路线相关的基础进度。
   * 旧写法给「区域材料」—— 违反基线 2.2「不定掉区域材料」，而且和所选方向无关，
   * 玩家打输了拿到的东西跟他要追求的目标没关系，失败就没有可读的意义。 */
  function consolationFor(route) {
    const items = Array.isArray(route.consolation) ? route.consolation : null;
    return items && items.length ? items.slice() : [{ name: '重铸石', qty: 1 }];
  }

  /* 单场结果（2026-09-09 修正伤害模型）
   * 旧模型：taken = (敌攻 - 玩家防) × 回合数，success = taken < 最大血 × 0.78。
   *   实测（成长 3 起步宠，Lv5~60，三条路线）：玩家防御成长远快于试炼敌攻 →
   *   全程 0 伤害 → 100% 通关、失败分支是死代码，试炼毫无风险也没有强度区分度。
   * 新模型：每回合按最大生命的固定比例掉血，比例随轮次递增，总伤害 = 比例 × 回合数。
   *   - 攻击越高 → 打得越快 → 回合越少 → 挨打越少（强度真正决定结果）
   *   - 轮次越深 → 比例越高（后段有压力，撑不住就失败，改发本路线的基础补偿）
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
    return { round: round + 1, turns, taken: Math.round(taken), hpLeft: Math.max(0, left), success: left > 0,
      damage: Math.round(damage), enemyHp: Math.round(enemyHp), maxHp: Math.round(maxHp) };
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

    /* 进入资格（2026-09-09 节点化）：先扣每日免费次数，免费次数用尽后消耗门票。
     * 等级不够在扣次数之前拦截 → 被等级拦截不消耗门票也不消耗免费次数（与旧行为一致）。
     * 免费/门票一旦扣下，失败不回退（与旧规则「失败不退门票」一致）。 */
    ensureDay();
    const free = freePerDay();
    const used = usage.used[routeId] || 0;
    let consumed = 'free';
    if (used >= free) {
      const ticket = cfg().ticketName || '资源试炼门票';
      if (!window.Materials || !window.Materials.spend) return { ok: false, error: '材料系统不可用' };
      const spent = await window.Materials.spend(ticket, 1);
      if (!spent || spent.ok === false) return { ok: false, error: spent && spent.error || `缺少${ticket}` };
      consumed = 'ticket';
    }
    usage.used[routeId] = used + 1;
    saveUsage();

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
      // 逐场回调（战斗画面演出用）：startTrialBattle 在 onRound 里渲染本场视觉并控制节奏
      if (options.onRound) await options.onRound(result, i, route, pet);
      if (!options.instant) await wait(cfg().roundDelayMs || 420);
      if (!result.success) break;
    }
    const cleared = results.length === (cfg().rounds || 5) && results.every(result => result.success);
    const reward = cleared ? rewardFor(route, pet) : consolationFor(route);
    for (const item of (Array.isArray(reward) ? reward : [reward])) window.Materials.gain(item.name, item.qty);
    const maxHp = Number((window.Pet.getStats(pet) || {}).hp) || 1;
    state.result = { cleared, reward, rounds: results.length, hpPercent: Math.max(0, Math.round(hpLeft / maxHp * 100)) };
    state.running = false;
    if (window.UI && window.UI.renderResourceTrial) window.UI.renderResourceTrial();
    if (window.UI && window.UI.showToast) window.UI.showToast(cleared ? '资源试炼完成' : '资源试炼结束', cleared ? '已获得定向资源' : '强度不足，获得少量补偿');
    return {
      ok: true, cleared, reward, rounds: results.length, hpPercent: state.result.hpPercent,
      consumed, freeLeft: Math.max(0, free - (usage.used[routeId] || 0))
    };
  }

  function getState() { return { running: state.running, route: state.route, round: state.round, result: state.result }; }
  window.ResourceTrial = { routes, routeOf, start, getState, rewardFor, consolationFor, getDailyInfo, entryInfo, dayKeyOf };
})();
