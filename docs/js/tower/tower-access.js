/* ============================================================
 * tower/tower-access.js —— 通天塔进入资格（单一职责）
 * 职责：每日免费次数（北京时间 12:00 换日）+ 「通天塔重置卡」消耗 + 资格查询 + 成绩记档。
 * 与副本的区别：塔是 freePerDay=1（不是 3），且额外次数只能靠重置卡（不是门票）。
 * 存储：本地 localStorage（塔当前是本地玩法；第二批切服务端权威时，
 *       把 used 一并搬到云端账本 tower_runs）。
 * 术语（2026-09-10 用户指定）：对外文案叫【腐蚀度】，字段 `bestCorrosion`
 *   （兼容读旧的 bestHot，老存档不会丢纪录）。
 * 依赖：tower-config（Config.tower）、materials（重置卡数量/消耗）、
 *       trial-access（换日函数 dayKeyOf，直接复用不重写）。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => (window.Config && window.Config.tower) || {};

  const USAGE_KEY = 'fos_tower_usage';

  /* 换日键：与副本同口径（北京时间 12:00 为一个「塔日」的起点）。
   * 直接复用 window.TrialAccess.dayKeyOf —— 两个系统必须同一个换日点，
   * 否则玩家会看到「副本刷新了、塔没刷新」。trial-access 未加载时兜底自算。 */
  function dayKeyOf(date) {
    if (window.TrialAccess && typeof window.TrialAccess.dayKeyOf === 'function') {
      return window.TrialAccess.dayKeyOf(date);
    }
    const bj = new Date((date || new Date()).getTime() + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear(), m = bj.getUTCMonth() + 1, d = bj.getUTCDate();
    if (bj.getUTCHours() < 12) {
      const prev = new Date(Date.UTC(y, m - 1, d - 1));
      return prev.getUTCFullYear() + '-' + (prev.getUTCMonth() + 1) + '-' + prev.getUTCDate();
    }
    return y + '-' + m + '-' + d;
  }

  // 旧存档兼容：腐蚀度曾叫 bestHot
  const bestCorrOf = u => Number((u && (u.bestCorrosion != null ? u.bestCorrosion : u.bestHot)) || 0);

  function loadUsage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(USAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.dayKey && parsed.used != null) {
            return { dayKey: parsed.dayKey, used: parsed.used, bestFloor: parsed.bestFloor || 0, bestCorrosion: bestCorrOf(parsed) };
          }
        }
      }
    } catch (e) { /* 存储不可用（隐私模式/测试 VM）→ 退化为内存态 */ }
    return { dayKey: '', used: 0, bestFloor: 0, bestCorrosion: 0 };
  }
  let usage = loadUsage();

  function saveUsage() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    } catch (e) { /* 写失败不阻塞流程 */ }
  }

  function ensureDay() {
    const key = dayKeyOf(new Date());
    if (usage.dayKey !== key) {
      // 换日只清「今天用了几次」；历史最佳层数/腐蚀度是成绩，跨日保留
      usage = { dayKey: key, used: 0, bestFloor: usage.bestFloor || 0, bestCorrosion: usage.bestCorrosion || 0 };
      saveUsage();
    }
  }

  function freePerDay() {
    const n = Number(cfg().freePerDay);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }
  function cardName() {
    return cfg().resetCardName || '通天塔重置卡';
  }
  function cardQty() {
    return (window.Materials && window.Materials.getQuantity)
      ? window.Materials.getQuantity(cardName()) : 0;
  }

  // 今日进入信息（节点徽标 / 详情页显示用）
  function getDailyInfo() {
    ensureDay();
    const free = freePerDay();
    return {
      used: usage.used, freePerDay: free,
      freeLeft: Math.max(0, free - usage.used),
      bestFloor: usage.bestFloor || 0, bestCorrosion: usage.bestCorrosion || 0
    };
  }

  // 完整资格（详情页用）：免费剩余 + 重置卡数量 + 历史纪录
  function entryInfo() {
    const info = getDailyInfo();
    return {
      freeLeft: info.freeLeft, freePerDay: info.freePerDay, used: info.used,
      cardName: cardName(), cardQty: cardQty(),
      bestFloor: info.bestFloor, bestCorrosion: info.bestCorrosion
    };
  }

  /* 消耗一次进入资格：先扣每日免费次数；免费次数用尽后消耗 1 张重置卡。
   * 返回 { ok, consumed: 'free'|'card', freeLeft, error }。
   * 失败不回退（扣下就是进了）；调用方必须先自行做等级等前置拦截。 */
  async function consumeEntry() {
    ensureDay();
    const free = freePerDay();
    let consumed = 'free';
    if (usage.used >= free) {
      const card = cardName();
      if (!window.Materials || !window.Materials.spend) {
        return { ok: false, error: '材料系统不可用' };
      }
      const spent = await window.Materials.spend(card, 1);
      if (!spent || spent.ok === false) {
        return { ok: false, error: (spent && spent.error) || `缺少${card}（魔石商店购买，每周限购）` };
      }
      consumed = 'card';
    }
    usage.used += 1;
    saveUsage();
    return { ok: true, consumed, freeLeft: Math.max(0, free - usage.used) };
  }

  /* 成绩记档：只在「刷新纪录」时写盘。bestFloor 与 bestCorrosion 分开记（塔靠腐蚀度继续，
   * 所以「最高腐蚀度」是后期更重要的那个数字）。参数名兼容旧的 hot。 */
  function recordResult(maxFloor, corrosion) {
    ensureDay();
    const corr = Number(corrosion != null ? corrosion : arguments[1]) || 0;
    let changed = false;
    if ((Number(maxFloor) || 0) > (usage.bestFloor || 0)) { usage.bestFloor = Number(maxFloor) || 0; changed = true; }
    if (corr > (usage.bestCorrosion || 0)) { usage.bestCorrosion = corr; changed = true; }
    if (changed) saveUsage();
    return changed;
  }

  window.TowerAccess = { dayKeyOf, getDailyInfo, entryInfo, consumeEntry, recordResult, freePerDay, cardName, cardQty };
})();
