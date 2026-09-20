/* ============================================================
 * ui/ui-stage-fx.js —— 唯一职责：战斗页的「舞台 / 全屏反馈原语」（只管表现，不含任何业务判断）。
 * 从 ui-battle.js 迁出（2026-09-21，一个文件一个职责）。三个原语：
 *   banner(cls, lines, life)  舞台横幅（掉落 / Boss 降临 / 升级共用）；返回元素供调用方挂事件
 *   flash(cls, ms)            给 `#tab-battle .battle-stage` 挂一个短命 class（震屏 / 扫光），播完自动摘
 *   goldPulse()               屏幕四缘金色脉冲（玩家不在战斗页也能余光看到）
 * 依赖：UI.escapeHtml（通用组件，ui-common 先加载）。
 * ⚠️ 消费者一律**用时取**（`window.StageFx`）：测试 harness 的清单顺序里本模块可能排在消费者之后。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const esc = (s) => (UI.escapeHtml ? UI.escapeHtml(s) : String(s));

  /* 舞台横幅：cls 决定样式，lines = [{c:class, t:文本}]，播完自己删。返回元素供挂事件。 */
  function banner(cls, lines, life) {
    if (typeof document === 'undefined' || !document.body) return null;
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = (lines || []).map(l => '<div class="' + l.c + '">' + esc(l.t || '') + '</div>').join('');
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, life || 2300);
    return el;
  }

  // 舞台高光：给 .battle-stage 挂一个短命 class 触发 CSS 动画（震屏/扫光），播完自动摘除
  function flash(cls, ms) {
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (!stage || !stage.classList) return;
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), ms);
  }

  // 金装掉落：屏幕四缘金色脉冲（玩家不在战斗页也能余光看到）
  function goldPulse() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.add('gold-pulse-edge');
    setTimeout(() => document.body.classList.remove('gold-pulse-edge'), 1200);
  }

  window.StageFx = { banner: banner, flash: flash, goldPulse: goldPulse };
})();
