/* ============================================================
 * ui/ui-dialog.js —— DialogBox 对话气泡组件
 * 用途：掉落提示 / 融合提醒 / 分解确认 / 错误提示 等关键节点消息
 * 特点：
 *  1. 消息队列：连续触发多条时排队逐条显示，不互相挤掉
 *  2. 点击关闭：✕ 按钮 / 点击气泡区域（带按钮时由按钮决定）
 *  3. 可选按钮（如确认/登出），可选自动关闭（autoCloseMs）
 * 用法：UI.showDialog({ icon, speaker, text(html), type:'info'|'error', buttons:[{label,onClick,danger}], autoCloseMs })
 * 依赖：ui-common（window.UI / $）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});
  function $(id) { return document.getElementById(id); }

  const queue = [];
  let showing = false;
  let autoTimer = null;

  /* ---------- 渲染当前消息 ---------- */
  function render(opt) {
    const box = $('dialog-box');
    const icon = $('dialog-icon');
    const speaker = $('dialog-speaker');
    const text = $('dialog-text');
    const actions = $('dialog-actions');
    if (!box || !text) return;

    if (icon) icon.textContent = opt.icon || '💬';
    if (speaker) speaker.textContent = opt.speaker || '系统';
    text.innerHTML = opt.text || '';
    box.className = 'dialog-box' + (opt.type === 'error' ? ' error' : '');

    // 可选按钮
    if (actions) {
      actions.innerHTML = '';
      const btns = opt.buttons || [];
      for (const b of btns) {
        const el = document.createElement('button');
        el.className = 'btn-mini' + (b.danger ? ' danger' : '');
        el.textContent = b.label || '确定';
        el.onclick = () => {
          closeDialog(); // 按钮点击先关闭（推进队列）
          if (b.onClick) b.onClick();
        };
        actions.appendChild(el);
      }
    }

    // 可选自动关闭（默认不自动，关键提示需点击关闭）
    if (opt.autoCloseMs && opt.autoCloseMs > 0) {
      autoTimer = setTimeout(() => { if (showing) closeDialog(); }, opt.autoCloseMs);
    }
    box.classList.add('show');
    showing = true;
  }

  /* ---------- 队列驱动 ---------- */
  function showDialog(opt) {
    opt = opt || {};
    // 对话同步写入消息控制台（社交分类），气泡本身行为不变
    if (UI.consoleLog) {
      const text = String(opt.text || '').replace(/<[^>]*>/g, ''); // 控制台只留纯文本
      UI.consoleLog('social', (opt.icon || '💬') + ' <b>' + (opt.speaker || '系统') + '</b>：' + text);
    }
    queue.push(opt);
    if (!showing) {
      const next = queue.shift();
      render(next);
    }
  }
  function closeDialog() {
    const box = $('dialog-box');
    clearTimeout(autoTimer);
    autoTimer = null;
    showing = false;
    if (box) box.classList.remove('show');
    if (queue.length) {
      const next = queue.shift();
      render(next);
    }
  }

  /* ---------- 事件绑定（点击 ✕ / 点击气泡本体关闭；按钮点击在 render 内处理） ---------- */
  function bindEvents() {
    const box = $('dialog-box');
    if (!box) return;
    const closeBtn = $('dialog-close');
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeDialog(); };
    // 点击气泡区域关闭（按钮点击已 stopPropagation，不会误关）
    box.addEventListener('click', (e) => {
      if (!e.target.closest('.dialog-actions')) closeDialog();
    });
  }
  // 点击气泡以外的页面空白区域 → 关闭气泡（需求：点空白关闭浮层）
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', (e) => {
      if (!showing) return;
      const box = $('dialog-box');
      if (!box || !box.classList.contains('show')) return;
      if (e.target.closest && e.target.closest('#dialog-box')) return; // 气泡内部由各自控件处理
      closeDialog();
    });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', bindEvents);
  }

  /* ---------- 对外 API ---------- */
  UI.showDialog = showDialog;
  UI.closeDialog = closeDialog;
})();
