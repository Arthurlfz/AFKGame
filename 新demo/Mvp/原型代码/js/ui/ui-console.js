/* ============================================================
 * ui/ui-console.js —— 消息控制台（常驻底部横条）
 * 职责：
 *  1. 统一消息中心：UI.consoleLog(category, html)，category ∈ system / social / loot
 *  2. 常驻横条：集中显示系统 / 社交 / 掉落三类消息
 *  3. 分类开关：点击 chip 高亮=开、低亮=关，状态存 localStorage 刷新保持
 *  4. 消息最多保留 100 条，自动滚动到最新
 * 依赖：ui-common（window.UI / $）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const $ = id => document.getElementById(id);

  const CAT_META = {
    system: { icon: '⚙️', label: '系统' },
    social: { icon: '💬', label: '社交' },
    loot:   { icon: '✦', label: '掉落' }
  };
  const KEY = 'console_filter_v1';
  const MAX = 100;

  const history = [];                 // { cat, time, html }
  const filter = loadFilter();

  function loadFilter() {
    try {
      const f = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (f && typeof f === 'object') {
        return { system: f.system !== false, social: f.social !== false, loot: f.loot !== false };
      }
    } catch (e) { /* ignore */ }
    return { system: true, social: true, loot: true };
  }
  function saveFilter() {
    try { localStorage.setItem(KEY, JSON.stringify(filter)); } catch (e) { /* ignore */ }
  }

  const timeNow = () => new Date().toTimeString().slice(0, 5);

  /* ---------- 统一入口（分类写日志 + 刷新显示） ---------- */
  function consoleLog(cat, html) {
    history.push({ cat, time: timeNow(), html });
    if (history.length > MAX) history.shift();
    render();
  }

  function toggleFilter(cat) {
    filter[cat] = !filter[cat];
    saveFilter();
    render();
  }

  function clearConsole() {
    history.length = 0;
    render();
  }

  /* ---------- 渲染（chips 开关态 + 过滤后的消息流） ---------- */
  function render() {
    const list = $('console-list');
    if (!list) return;
    Object.keys(CAT_META).forEach(cat => {
      const chip = document.querySelector('.console-chip[data-cat="' + cat + '"]');
      if (chip) chip.classList.toggle('on', !!filter[cat]);
    });
    const frag = document.createDocumentFragment();
    for (const m of history) {
      if (!filter[m.cat]) continue;
      const el = document.createElement('div');
      el.className = 'console-entry ' + m.cat;
      el.innerHTML =
        '<span class="console-time">' + m.time + '</span>' +
        '<span class="console-cat">' + CAT_META[m.cat].icon + '</span>' +
        '<span class="console-text">' + m.html + '</span>';
      frag.appendChild(el);
    }
    list.innerHTML = '';
    list.appendChild(frag);
    list.scrollTop = list.scrollHeight;
  }

  /* ---------- HTML 转义（玩家输入防 XSS，写入控制台 social 分类时使用） ---------- */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 发送社交消息（玩家在输入框打字，回车 / 点发送） ---------- */
  function sendSocial() {
    const input = $('console-input');
    if (!input) return;
    const text = String(input.value || '').trim();
    if (!text) return;
    consoleLog('social', '💬 <b>我</b>：' + escHtml(text));
    input.value = '';
    input.focus();
  }

  /* ---------- console 可拖可调：拖顶部改高度 / 拖标题栏移动 / 吸底还原 ---------- */
  function initConsoleDrag() {
    const bar = $('console-bar');
    const resize = $('console-resize');
    const head = $('console-bar-head');
    const snap = $('console-snap');
    if (!bar) return;
    const MIN_H = 120, MAX_H = () => window.innerHeight * 0.6;

    function enterDrag() {
      const r = bar.getBoundingClientRect();
      bar.classList.add('dragging');
      bar.style.setProperty('--cx', r.left + 'px');
      bar.style.setProperty('--cy', (window.innerHeight - r.bottom) + 'px');
    }
    function leaveDrag() {
      bar.classList.remove('dragging');
      bar.style.height = '';
      bar.style.removeProperty('--cx');
      bar.style.removeProperty('--cy');
    }

    if (resize) {
      resize.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const startY = e.clientY, startH = bar.offsetHeight;
        const mv = ev => {
          const nh = Math.min(MAX_H(), Math.max(MIN_H, startH + (startY - ev.clientY)));
          bar.style.height = nh + 'px';
        };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });
    }

    if (head) {
      head.addEventListener('mousedown', e => {
        if (e.target.closest && e.target.closest('.console-chip, .console-snap, .console-clear, .console-spacer')) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const r0 = bar.getBoundingClientRect();
        let l0 = r0.left, t0 = r0.top;
        if (!bar.classList.contains('dragging')) { l0 = r0.left; t0 = r0.top; }
        enterDrag();
        const mv = ev => {
          const nl = Math.min(window.innerWidth - 40, Math.max(0, l0 + (ev.clientX - startX)));
          const nt = Math.min(window.innerHeight - 40, Math.max(0, t0 + (ev.clientY - startY)));
          bar.style.setProperty('--cx', nl + 'px');
          bar.style.setProperty('--cy', (window.innerHeight - nt - bar.offsetHeight) + 'px');
        };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });
    }

    if (snap) {
      snap.addEventListener('click', e => { e.stopPropagation(); leaveDrag(); });
    }
  }

  /* ---------- 绑定（chip 开关 / 清空 / 社交输入） ---------- */
  function initConsole() {
    const bar = $('console-bar');
    if (!bar) return;
    initConsoleDrag();
    bar.addEventListener('click', e => {
      const chip = e.target.closest && e.target.closest('.console-chip');
      if (chip) { toggleFilter(chip.dataset.cat); return; }
      const clear = e.target.closest && e.target.closest('#console-clear');
      if (clear) clearConsole();
      const send = e.target.closest && e.target.closest('#console-send');
      if (send) sendSocial();
    });
    const input = $('console-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          sendSocial();
        }
      });
    }
    render();
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initConsole);
  }

  /* ---------- 对外 API ---------- */
  UI.consoleLog = consoleLog;
  UI.consoleClear = clearConsole;
})();
