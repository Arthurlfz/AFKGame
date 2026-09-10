/* ============================================================
 * ui/ui-session-guard.js —— 会话遮罩（本标签被其他标签页接管时显示）
 * 职责：盖住整个页面并说明原因，提供「在此标签页继续」把所有权抢回来。
 * 结构挂在 body 层：浮层铁律 —— .tab-page 是 display:none 切换的，
 *   position:fixed 也逃不出 display:none 的祖先，塞进 tab 页里会"该显示时不显示"。
 * 依赖：ui-common（window.UI）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});
  const ID = 'session-guard';

  let guardEl = null;
  let continueHandler = null;

  function build() {
    if (guardEl) return guardEl;
    const el = document.createElement('div');
    el.className = 'session-guard';
    el.id = ID;
    el.innerHTML =
      '<div class="sg-box">' +
        '<div class="sg-seal">止</div>' +
        '<h3 class="sg-title"></h3>' +
        '<p class="sg-text"></p>' +
        '<button type="button" class="fs-btn fs-btn--primary sg-continue"></button>' +
      '</div>';
    el.querySelector('.sg-continue').addEventListener('click', function () {
      const fn = continueHandler;
      hide();
      if (typeof fn === 'function') {
        try { fn(); } catch (e) { console.warn('[session-guard] 继续回调异常', e); }
      }
    });
    document.body.appendChild(el);
    guardEl = el;
    return el;
  }

  // opts: { title, text, continueText, onContinue }；不给 onContinue 就不显示按钮
  function show(opts) {
    const o = opts || {};
    const el = build();
    el.querySelector('.sg-title').textContent = o.title || '本页面已暂停';
    el.querySelector('.sg-text').textContent = o.text || '游戏已在另一个标签页中运行。';
    const btn = el.querySelector('.sg-continue');
    btn.textContent = o.continueText || '在此标签页继续';
    btn.style.display = typeof o.onContinue === 'function' ? '' : 'none';
    continueHandler = o.onContinue || null;
    el.classList.add('show');
  }

  function hide() {
    if (!guardEl) return;
    guardEl.classList.remove('show');
    continueHandler = null;
  }

  /* ---------- 对外 API ---------- */
  UI.showSessionGuard = show;
  UI.hideSessionGuard = hide;
  UI.isSessionGuardShown = function () { return !!(guardEl && guardEl.classList.contains('show')); };
})();
