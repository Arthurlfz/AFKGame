/* ============================================================
 * trial/ui-trial-settle.js —— 副本结算面板 + 来源导航（单一职责）
 * 职责：
 *  1. 结算面板：到达层数 + 对应档位奖励（已入背包）+ 消耗（免费/门票）
 *  2. 来源导航：session（面板来源 → 回面板；节点来源 → 回副本详情页）
 * 不负责：战斗推进（trial-engine.js）、入口面板/详情页（ui-trial-entry.js）。
 * 依赖：trial-access、ui-common（toast）、ui-trial-entry（返回入口）。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = value => UI.escapeHtml ? UI.escapeHtml(String(value || '')) : String(value || '');

  /* 结算后的返回目标：node = 大地图副本节点详情页；panel = 资源副本面板 */
  let session = { from: 'panel', point: null };
  UI.setTrialSession = s => { session = { from: (s && s.from) || 'panel', point: (s && s.point) || null }; };

  /* 结算后返回：节点来源 → 副本详情页；面板来源 → 资源副本面板 */
  function backToEntry(route) {
    if (session.from === 'panel') {
      if (UI.openResourceTrial) UI.openResourceTrial();
      return;
    }
    if (session.point && UI.showTrialDetail) UI.showTrialDetail(session.point);
  }
  UI.backToTrialEntry = backToEntry;

  /* ---------- 结算面板：打完副本（死亡/通关）后弹出 ---------- */
  UI.showTrialSettle = function (result, route) {
    const wrap = $('trial-settle');
    const card = $('trial-settle-card');
    if (!wrap || !card) { // 老页面结构没有结算容器：退回入口
      backToEntry(route);
      return;
    }
    const cleared = !!(result && result.ok !== false && result.cleared);
    const maxFloor = (result && result.maxFloor) || 0;
    const total = (result && result.floors) || (window.Config.resourceTrials || {}).floors || 20;
    const rewards = (result && result.reward)
      ? (Array.isArray(result.reward) ? result.reward : [result.reward]) : [];
    const info = (window.TrialAccess && window.TrialAccess.entryInfo)
      ? window.TrialAccess.entryInfo(route.id) : null;
    const consumedTxt = result && result.consumed === 'ticket'
      ? '门票 ×1' : (info && info.freePerDay > 0 ? '免费进入' : '门票 ×0');
    const freeTxt = info ? `今日免费剩余 ${info.freeLeft}/${info.freePerDay || '—'}` : '';
    const tierFloor = (result && result.tierFloor) || 0;
    const tierTxt = tierFloor > 0 ? `达成第 ${tierFloor} 层档位` : '未达成层档位（基础补偿）';
    card.innerHTML = `
      <div class="ts-badge ${cleared ? 'is-clear' : 'is-fail'}">${cleared ? '✓ 通关' : '✕ 爬塔结束'}</div>
      <div class="ts-title">${esc(route.name)}</div>
      <div class="ts-stat">到达 <b>${maxFloor}</b>/${total} 层 · ${cleared ? '全程通关' : '中途力竭'}</div>
      <div class="ts-reward">
        <div class="ts-reward-h">${cleared ? '通关奖励（已入背包）' : (tierFloor > 0 ? `第 ${tierFloor} 层档位奖励（已入背包）` : '失败补偿（已入背包）')}</div>
        <div class="ts-reward-list">${rewards.map(item => `<span class="ts-item">${esc(item.name)} ×${item.qty}</span>`).join('') || '<span class="ts-item">—</span>'}</div>
      </div>
      <div class="ts-note">${esc(tierTxt)} · 消耗：${consumedTxt}${freeTxt ? ' · ' + freeTxt : ''}</div>
      <div class="ts-actions">
        <button type="button" class="fs-btn fs-btn--primary" id="ts-again">再打一次</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="ts-back">返回副本</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="ts-close">关闭</button>
      </div>`;
    wrap.hidden = false;
    bindSettle(route);
  };

  function bindSettle(route) {
    const wrap = $('trial-settle');
    if (!wrap) return;
    const again = $('ts-again');
    if (again) again.onclick = async () => {
      again.disabled = true;
      wrap.hidden = true;
      try {
        if (UI.startTrialBattle) await UI.startTrialBattle(route, { from: session.from, point: session.point });
      } catch (e) {
        if (UI.showToast) UI.showToast('副本异常', (e && e.message) || '未知错误');
      } finally {
        again.disabled = false;
      }
    };
    const back = $('ts-back');
    if (back) back.onclick = () => { wrap.hidden = true; backToEntry(route); };
    const close = $('ts-close');
    if (close) close.onclick = () => {
      wrap.hidden = true;
      const el = $('area-detail');
      if (el) el.hidden = true;
      if (session.from === 'panel' && UI.openResourceTrial) UI.openResourceTrial();
      if (UI.renderResourceTrial) UI.renderResourceTrial();
    };
  }
})();
