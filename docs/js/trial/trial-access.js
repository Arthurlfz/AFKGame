/* ============================================================
 * trial/trial-access.js —— 副本进入资格（单一职责）
 * 职责：每日免费次数（北京时间 12:00 刷新）+ 门票消耗 + 资格查询。
 * 从旧 core/resource-trial.js 原样迁移（行为不变），只做模块化拆分。
 * 存储：本地 localStorage（副本当前是本地玩法；正式化为服务端权威时，
 *       把 used 一并搬到云端账本）。
 * 依赖：config（Config.resourceTrials）、materials（门票数量/消耗）。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => window.Config && window.Config.resourceTrials || {};
  const routes = () => Array.isArray(cfg().routes) ? cfg().routes : [];

  /* ============ 每日免费进入次数 ============
   * 每个副本每天有 Config.resourceTrials.freeEntriesPerDay 次免费进入；
   * 免费次数于【北京时间 12:00】刷新（即 12:00 起的 24 小时为一个「试炼日」），
   * 用尽后进入需消耗 1 张门票（ticketName）。
   */
  const USAGE_KEY = 'fos_trial_usage';

  // 计算「试炼日」键：以北京时间 12:00 为换日点。
  // 当天 12:00 ~ 次日 11:59 属于同一试炼日（key = 起始日）。
  // 例：北京时间 2026-09-10 11:59 → "2026-9-9"；12:00 → "2026-9-10"。
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

  /* 服务端权威下的免费次数缓存（服务器账本为准）。
   * 面板每帧都可能问，不能每次都打一次网络 —— 10 秒刷一次 + 首问触发，够用。 */
  const serverFree = {};
  let serverFreeTs = 0;
  /* 取回来之后要**让界面重画** —— 否则第一次渲染时值还没到，
   * 玩家看到的就是"三个副本都不能免费进"（2026-09-23 用户报「门票没对齐」的真因）。 */
  function repaintTrialUi() {
    const UI = window.UI || {};
    try {
      if (UI.refreshTrialMarkers) UI.refreshTrialMarkers();
      if (UI.renderResourceTrial) UI.renderResourceTrial();
      if (UI.refreshTrialDetail) UI.refreshTrialDetail();
    } catch (e) { /* 表现层异常不影响资格 */ }
  }
  function refreshServerFree() {
    const S = window.TrialServer;
    if (!S || !S.freeLeftOf) return;
    const now = Date.now();
    if (now - serverFreeTs < 10000) return;
    serverFreeTs = now;
    routes().forEach(r => {
      Promise.resolve(S.freeLeftOf(r.id))
        .then(n => { serverFree[r.id] = n; repaintTrialUi(); })
        .catch(() => { serverFree[r.id] = null; repaintTrialUi(); });
    });
  }
  // 服务端权威下的免费剩余：undefined = 还没问到（UI 显示"—"，且**不要禁用按钮**）
  function srvFreeLeft(routeId) {
    return Object.prototype.hasOwnProperty.call(serverFree, routeId) ? serverFree[routeId] : undefined;
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
    const srv = !!(window.TrialServer && window.TrialServer.isOn());
    if (srv) refreshServerFree();          // 服务端模式：免费次数在服务器账本里，本地那份不再算数
    return routes().map(route => {
      if (srv) {
        const n = srvFreeLeft(route.id);
        return { routeId: route.id, used: 0, freePerDay: free, freeLeft: (n === undefined ? null : n) };
      }
      const used = usage.used[route.id] || 0;
      return { routeId: route.id, used, freePerDay: free, freeLeft: Math.max(0, free - used) };
    });
  }

  // 单条路线的进入资格：免费剩余 / 门票数量（节点详情页用）
  function entryInfo(routeId) {
    /* 服务端权威开着时，免费次数在**服务器账本**里（本地那份已经不再被消耗，永远显示满 = 假信息）。
     * 这时用服务器数出来的值；拿不到（未登录/网络）返回 null，UI 按"未知"处理，别当成 0。 */
    let info = getDailyInfo().find(i => i.routeId === routeId)
      || { freeLeft: 0, freePerDay: 0, used: 0 };
    if (window.TrialServer && window.TrialServer.isOn()) {
      refreshServerFree();
      const n = srvFreeLeft(routeId);
      // undefined（还没问到）→ null：UI 显示"—"且**不禁用按钮**，由服务器最终判定
      info = { freeLeft: (n === undefined ? null : n), freePerDay: freePerDay(), used: 0 };
    }
    const ticket = cfg().ticketName || '资源试炼门票';
    const ticketQty = (window.Materials && window.Materials.getQuantity)
      ? window.Materials.getQuantity(ticket) : 0;
    return {
      freeLeft: info.freeLeft, freePerDay: info.freePerDay, used: info.used,
      ticketName: ticket, ticketQty
    };
  }

  /* 消耗一次进入资格：先扣每日免费次数，免费次数用尽后消耗 1 张门票。
   * 返回 { ok, consumed: 'free'|'ticket', freeLeft, error }。
   * 失败不回退（扣下就是进了）；调用方必须先自己做好等级等前置拦截。 */
  async function consumeEntry(routeId) {
    ensureDay();
    const free = freePerDay();
    const used = usage.used[routeId] || 0;
    let consumed = 'free';
    if (used >= free) {
      const ticket = cfg().ticketName || '资源试炼门票';
      if (!window.Materials || !window.Materials.spend) {
        return { ok: false, error: '材料系统不可用' };
      }
      const spent = await window.Materials.spend(ticket, 1);
      if (!spent || spent.ok === false) {
        return { ok: false, error: (spent && spent.error) || `缺少${ticket}` };
      }
      consumed = 'ticket';
    }
    usage.used[routeId] = used + 1;
    saveUsage();
    return { ok: true, consumed, freeLeft: Math.max(0, free - (usage.used[routeId] || 0)) };
  }

  window.TrialAccess = { routes, routeOf: id => routes().find(r => r.id === id) || null, getDailyInfo, entryInfo, consumeEntry, dayKeyOf };
})();
