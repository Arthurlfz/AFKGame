/* ============================================================
 * ui-shortcuts.js —— 键盘快捷键（独立模块）
 *   Q   → 打开任务面板
 *   1~5 → 宠物页切tab（资料/进化/合成/涅槃/觉醒）
 *   空格 → 开始/暂停挂机（仅战斗页）
 * 规则：输入框聚焦不响应、不覆盖浏览器快捷键
 * ============================================================ */
(function () {
  'use strict';
  document.addEventListener('keydown', function (e) {
    try {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const UI = window.UI;
      if (!UI) return;

      if (e.key === 'q' || e.key === 'Q') {
        if (UI.openQuestPanel) { e.preventDefault(); UI.openQuestPanel(); }
        return;
      }
      if (e.key === ' ') {
        if (document.body.classList.contains('battle-active') && UI.toggleIdle) { e.preventDefault(); UI.toggleIdle(); }
        return;
      }
      if (e.key >= '1' && e.key <= '5') {
        const petPage = document.getElementById('tab-pet');
        if (!petPage || !petPage.classList.contains('active')) return;
        const tabs = ['profile', 'evolve', 'synth', 'merge', 'awaken'];
        const btn = document.querySelector('.pet-tab[data-pet-tab="' + tabs[Number(e.key)-1] + '"]');
        if (btn) { e.preventDefault(); btn.click(); }
      }
    } catch (err) { /* 静默 */ }
  });
})();
