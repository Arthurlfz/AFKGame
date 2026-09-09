/* ============================================================
 * trial/ui-trial-battle.js —— 副本·整页战斗驱动（单一职责）
 * 职责：
 *  1. startTrialBattle：入口（面板/节点）统一走这里 → 切整页战斗页 → TrialEngine.start
 *  2. 层数进度写进战斗页顶部信息区（第 X/20 层 · 守关者 Lv.Y），战斗画面
 *     （头像/血条/行动条/飘字/日志）全部复用战斗页现有渲染通道，不自带渲染循环
 * 不负责：进入资格/层推进（trial-engine.js）、结算面板与导航（ui-trial-settle.js）。
 * 依赖：trial-engine、ui-shell（switchPage）、ui-battle（resetBattle/updateBars/addLog）。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = value => UI.escapeHtml ? UI.escapeHtml(String(value || '')) : String(value || '');

  /* ---------- 层数进度：写进战斗页顶部信息区 + 三层背景切换 ----------
   * 与 UI.updateBattleArea 同一套路（#battle-area-info + .battle-stage data-area-id），
   * 但文案是副本口径；背景复用 route.bgAreaId 指向的现有地图背景。 */
  UI.updateTrialFloor = function (info) {
    const box = $('battle-area-info');
    if (box) {
      box.innerHTML = `副本：<b style="color:#ffcf6b">${esc(info.route.name)}</b> · 第 <b>${info.floor}</b>/${info.total} 层 · 守关者 ${esc(info.enemy.name)} Lv.${info.enemy.level}`;
    }
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (stage && typeof stage.setAttribute === 'function') {
      if (info.route.bgAreaId) stage.setAttribute('data-area-id', info.route.bgAreaId);
      const h = stage.offsetHeight || 0;
      if (stage.style && stage.style.setProperty) stage.style.setProperty('--bg-w', (h * (1376 / 768)) + 'px');
      if (stage.classList && !stage.classList.contains('stage-scroll')) stage.classList.add('stage-scroll');
    }
  };

  /* 引擎运行事件 → 战斗页表现（trial-engine 每个层事件都会推到这里） */
  UI.onTrialEvent = function (event) {
    if (!event) return;
    if (event.type === 'floor') {
      UI.updateTrialFloor(event);
      if (UI.renderCombatantData) {
        try { UI.renderCombatantData(); } catch (e) { /* 表现层异常不中断 */ }
      }
    }
    if (event.type === 'log' && UI.addLog) UI.addLog(event.text);
    if (event.type === 'floorFail' && UI.addLog) UI.addLog('💀 战斗失败……');
  };

  /* ---------- 主流程：进副本 = 切整页战斗页 + 引擎逐层推进 ----------
   * 面板与节点详情页的「进入」按钮都走这里。资格/门票守门、层推进、
   * 野图挂机暂停/恢复都在 core 层（trial-access/engine）保证，UI 只做导航与表现。 */
  async function startTrialBattle(route, opts) {
    const E = window.TrialEngine;
    opts = opts || {};
    if (!E) return;
    const r = (typeof route === 'string') ? E && window.TrialAccess && window.TrialAccess.routeOf(route) : route;
    if (!r) {
      if (UI.showToast) UI.showToast('副本不存在', '该副本配置缺失。');
      return;
    }
    // 记录来源（面板 / 节点），结算面板的返回导航用（session 归 ui-trial-settle 管）
    if (UI.setTrialSession) UI.setTrialSession({ from: opts.from || 'panel', point: opts.point || null });
    // 面板入口：先收起面板，切到整页战斗页
    if ((opts.from || 'panel') === 'panel') {
      const panel = $('resource-trial-panel');
      if (panel) panel.hidden = true;
    }
    if (UI.switchPage) UI.switchPage('battle');
    try {
      const res = await E.start(r.id, {});
      if (!res || res.ok === false) {
        if (UI.showToast) UI.showToast('无法进入副本', (res && res.error) || '未知原因');
        if (UI.backToTrialEntry) UI.backToTrialEntry(r);
        return;
      }
      if (UI.showTrialSettle) UI.showTrialSettle(res, r);
    } catch (e) {
      if (UI.showToast) UI.showToast('副本异常', (e && e.message) || '未知错误');
      if (UI.backToTrialEntry) UI.backToTrialEntry(r);
    }
  }

  UI.startTrialBattle = startTrialBattle;
})();
