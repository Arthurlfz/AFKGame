/* ============================================================
 * ui/ui-console.js —— 消息中心（底部聊天弹窗 + 页面内嵌 console）
 * 职责：
 *  1. 统一消息入口：UI.consoleLog(category, html)，category ∈ system / social / loot
 *  2. 底部聊天弹窗（2026-08-31 用户拍板）：💬世界 / ⚙️系统 / ✦掉落 三频道 + 输入发送
 *  3. 页面内嵌 console（2026-09-01）：世界地图页 / 战斗页下半区，与抽屉共享同一份 history，
 *     三频道消息流 + 输入框；比例可拖拽（默认 65/35，localStorage 记忆）
 *  4. 实时聊天：Supabase Realtime 订阅广播，玩家互相能看到
 *  5. 消息最多保留 100 条；弹窗透明可调（底部 ◐ 滑块）
 * 注：常驻底部消息条已于 2026-08-31 移除（旧聊天输入一并移除），消息只进弹窗/内嵌 console。
 * 依赖：ui-common（window.UI / $）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const $ = id => document.getElementById(id);

  const MAX = 100;
  const history = [];                 // { cat, time, html, ...structured }
  let activeTab = 'social';           // 当前频道（单选视图，抽屉与内嵌 console 共享）
  const QUICK_PHRASES = ['求组队 刷精英！', '收进化素材，价可谈', '求带新图，等级不够', '刚才那件装备谁捡了？', '这波掉落给力！'];
  const TAB_META = [
    { id: 'social', icon: '💬', label: '世界' },
    { id: 'system', icon: '⚙️', label: '系统' },
    { id: 'loot', icon: '✦', label: '掉落' }
  ];

  const timeNow = () => new Date().toTimeString().slice(0, 5);

  /* ---------- 统一入口（分类写日志 + 刷新全部消息容器显示） ----------
   * structured：可选结构化字段（如社交消息的 {name,self,text}），弹窗优先用它排版
   * （名字/内容分离），没有就退回 html。 */
  function consoleLog(cat, html, structured) {
    history.push(Object.assign({ cat, time: timeNow(), html }, structured || {}));
    if (history.length > MAX) history.shift();
    renderChatPanel();
  }

  /* ---------- HTML 转义（玩家输入防 XSS，写入社交分类时使用） ---------- */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ========== 实时聊天（Supabase Realtime：写库 + 订阅广播，玩家互相能看到） ========== */
  const seenIds = new Set();      // 已显示的消息 id（避免自己发的被 Realtime 再推一次导致重复）
  let chatChannel = null;         // Realtime 订阅句柄
  let myName = '玩家';            // 当前登录显示名
  let lastSendTime = 0;           // 防刷屏

  // 渲染一条聊天消息进社交分类（name 已转义；同时存结构化字段供弹窗排版）
  function renderChatMessage(name, text, isSelf) {
    const tag = isSelf ? '<b style="color:var(--accent)">' + escHtml(name) + '</b>' : '<b>' + escHtml(name) + '</b>';
    consoleLog('social', '💬 ' + tag + '：' + escHtml(text), { name: escHtml(name), self: isSelf, text: escHtml(text) });
  }

  // 加载最近聊天历史（进游戏先显示）
  async function loadChatHistory() {
    if (!window.Supabase || !window.Supabase.fetchRecentMessages) return;
    const { data, error } = await window.Supabase.fetchRecentMessages(50);
    if (error || !data || !data.length) return;
    // 历史按时间正序显示（查询是倒序的，翻转）
    const rows = [...data].reverse();
    for (const r of rows) {
      if (seenIds.has(r.id)) continue;
      seenIds.add(r.id);
      renderChatMessage(r.sender_name, r.message, r.user_id === (window.__chatMyId || ''));
    }
    // 历史只进本地，不依赖 Realtime 广播
  }

  // 订阅 Realtime：别人发消息实时收到
  function initChatRealtime() {
    if (!window.Supabase || !window.Supabase.getClient) return;
    const client = window.Supabase.getClient();
    if (!client || chatChannel) return;
    chatChannel = client
      .channel('public:chat_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        const row = payload && payload.new;
        if (!row || !row.id || !row.message) return;
        if (seenIds.has(row.id)) return;   // 自己发的（本地已显示过）跳过
        seenIds.add(row.id);
        renderChatMessage(row.sender_name, row.message, false);
      })
      .subscribe();
  }

  // 发送社交消息（玩家在任意输入框打字，回车 / 点发送）
  async function sendSocialFrom(inputEl) {
    if (!inputEl) return;
    const text = String(inputEl.value || '').trim();
    if (!text) return;

    // 防刷屏：两次发送间隔至少 1.5 秒
    const now = Date.now();
    if (now - lastSendTime < 1500) {
      UI.showToast && UI.showToast('⏳ 太快了', '每条消息至少间隔 1.5 秒');
      return;
    }
    lastSendTime = now;

    // 探测登录态：有 user session 才走 Supabase 广播；未登录本地回显（不污染系统频道）
    let user = null;
    try { user = await (window.Supabase.getCurrentUser && window.Supabase.getCurrentUser()); } catch (e) { /* ignore */ }
    if (!user || !window.Supabase || !window.Supabase.sendChatMessage) {
      consoleLog('social', '💬 <b>我</b>：' + escHtml(text), { name: '我', self: true, text: escHtml(text) });
      inputEl.value = '';
      inputEl.focus();
      return;
    }

    // 显示名：优先 profiles.nickname 缓存（登录时 loadMyProfile 已拉取），回落邮箱前缀；每次发都读最新昵称
    window.__chatMyId = window.__chatMyId || user.id;
    myName = (window.Supabase && window.Supabase.getMyDisplayName && window.Supabase.getMyDisplayName()) ||
             (user.email || '').split('@')[0] || '玩家';

    const { data, error } = await window.Supabase.sendChatMessage(myName, text);
    if (error) {
      UI.showToast && UI.showToast('❌ 发送失败', error.message || '请先登录');
      lastSendTime = 0; // 失败允许重试
      return;
    }
    // 本地即时显示自己这条（并记录 id，Realtime 推回来时跳过）
    if (data && data.id) seenIds.add(data.id);
    renderChatMessage(myName, text, true);
    inputEl.value = '';
    inputEl.focus();
  }
  function sendSocial() { sendSocialFrom($('chat-input')); }

  /* ---------- 消息容器（抽屉 + 页面内嵌 console 共用同一份 history） ----------
   * 每个容器是一个 root：内部找 .chat-tabs（频道条）与 .chat-list（消息流）。
   * 抽屉 root = #chat-modal；内嵌 root = 每个 .inline-console。
   * 渲染函数统一操作「当前 activeTab」，一处切频道，两处同步。 */
  function consoleRoots() {
    const roots = [];
    const drawer = $('chat-modal');
    if (drawer) roots.push(drawer);
    document.querySelectorAll('.inline-console').forEach(el => roots.push(el));
    return roots;
  }

  // 聊天弹窗社交消息：名字 / 内容分离排版（demo 样式）；系统/掉落消息退回 html 渲染
  function chatMsgHtml(m) {
    if (m.cat === 'social') {
      return '<div class="chat-msg social' + (m.self ? ' self' : '') + '">' +
        '<span class="chat-time">' + m.time + '</span>' +
        '<span class="chat-name">' + (m.name || '') + '</span>' +
        (m.self ? '<span class="chat-me-tag">我</span>' : '') +
        '<span class="chat-text">' + (m.text || m.html) + '</span></div>';
    }
    return '<div class="chat-msg ' + m.cat + '">' +
      '<span class="chat-time">' + m.time + '</span>' +
      '<span class="chat-ic">' + (m.cat === 'loot' ? '✦' : '⚙️') + '</span>' +
      '<span class="chat-text">' + m.html + '</span></div>';
  }

  /* 渲染单个容器的频道 tab（点谁切谁，切后刷新所有容器） */
  function renderTabs(tabsEl) {
    if (!tabsEl) return;
    tabsEl.innerHTML = TAB_META.map(t => {
      const n = history.filter(m => m.cat === t.id).length;
      return '<button class="chat-tab' + (t.id === activeTab ? ' on' : '') + '" data-cat="' + t.id + '">' +
        '<span class="chat-tab-dot"></span>' + t.icon + ' ' + t.label +
        '<span class="chat-tab-cnt">' + n + '</span></button>';
    }).join('');
    tabsEl.querySelectorAll('.chat-tab').forEach(btn => {
      btn.onclick = () => { activeTab = btn.dataset.cat; renderChatPanel(); };
    });
  }

  /* 渲染单个容器的消息流（当前 activeTab 频道） */
  function renderList(listEl) {
    if (!listEl) return;
    const rows = history.filter(m => m.cat === activeTab);
    listEl.innerHTML = rows.length ? rows.map(chatMsgHtml).join('') : '<div class="chat-empty">该频道暂无消息</div>';
    listEl.scrollTop = listEl.scrollHeight;
  }

  /* 刷新全部消息容器（抽屉 + 所有内嵌 console），由 consoleLog / 切频道 / 发送触发 */
  function renderChatPanel() {
    for (const root of consoleRoots()) {
      const tabs = root.querySelector('.chat-tabs');
      const list = root.querySelector('.chat-list');
      if (tabs) renderTabs(tabs);
      if (list) renderList(list);
    }
  }

  /* ---------- 底部聊天弹窗（透明可调；对齐任务面板/装备打造的浮层体系） ---------- */
  function openChatPanel() {
    renderChatPanel();
    const modal = $('chat-modal');
    if (!modal) return;
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('is-open'));
  }
  function closeChatPanel() {
    const modal = $('chat-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    window.setTimeout(() => { if (!modal.classList.contains('is-open')) modal.style.display = 'none'; }, 300);
  }

  /* ---------- 内嵌 console 初始化（世界地图页 / 战斗页下半区） ----------
   * 每个 .inline-console：
   *  - 频道 tab 已在 renderChatPanel 里渲染（复用 .chat-tabs 结构）
   *  - 输入框回车发送 / 发送按钮
   *  - 「⌕ 全屏」按钮 → 打开抽屉 */
  function initInlineConsoles() {
    document.querySelectorAll('.inline-console').forEach(scope => {
      if (scope.__consoleBound) return;
      scope.__consoleBound = true;
      const input = scope.querySelector('[data-console-input]');
      if (input) {
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            sendSocialFrom(input);
          }
        });
        const send = scope.querySelector('[data-console-send]');
        if (send) send.onclick = () => sendSocialFrom(input);
      }
      const expand = scope.querySelector('[data-console-expand]');
      if (expand) expand.onclick = openChatPanel;
    });
  }

  /* ---------- 拖拽分隔条：调整内嵌 console 高度（默认 65/35，localStorage 记忆） ---------- */
  const SPLIT_KEY = 'fof_inline_console_ratio';
  let splitter = null, dragging = false;

  function applyConsoleRatio() {
    const saved = parseFloat(localStorage.getItem(SPLIT_KEY));
    const ratio = (saved > 0.15 && saved < 0.6) ? saved : 0.35;
    document.documentElement.style.setProperty('--console-ratio', (ratio * 100) + '%');
  }

  function initSplitters() {
    applyConsoleRatio();
    document.querySelectorAll('.console-splitter').forEach(el => {
      if (el.__splitBound) return;
      el.__splitBound = true;
      el.addEventListener('mousedown', onSplitStart);
    });
  }

  // 拖拽状态（模块级，供 onMove/onUp 读写）
  let dragConsole = null;
  function onSplitStart(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    if (splitter || dragging) return;
    splitter = el;
    dragging = true;
    el.classList.add('dragging');
    // 目标 inline-console 就是分隔条的下一个兄弟
    const consoleEl = el.nextElementSibling;
    if (!consoleEl || !consoleEl.classList.contains('inline-console')) { stopDrag(); return; }
    dragConsole = consoleEl;
    // 记录起点（相对分隔条所在父容器）
    const parent = el.parentElement;
    const parentH = parent.clientHeight || 0;
    const startY = e.clientY;
    // 当前比例换算成像素
    const startRatio = parseFloat(getComputedStyle(consoleEl).flexBasis) || 35;

    function onMove(ev) {
      const dy = ev.clientY - startY;
      // 分隔条下移 = console 变矮；以「父容器内可调区」为基准（下限 12%，上限 55%）
      const pctPerPx = 100 / parentH;
      let ratio = startRatio - dy * pctPerPx;
      ratio = Math.max(12, Math.min(55, ratio));
      document.documentElement.style.setProperty('--console-ratio', ratio + '%');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      stopDrag();
      // 记住用户偏好（存 0~1 小数，applyConsoleRatio 恢复时用）
      const ratio = dragConsole ? parseFloat(getComputedStyle(dragConsole).flexBasis) : 0;
      if (isFinite(ratio) && ratio > 0) localStorage.setItem(SPLIT_KEY, String(Math.round(ratio) / 100));
      dragConsole = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function stopDrag() {
    if (splitter) splitter.classList.remove('dragging');
    splitter = null;
    dragging = false;
  }

  /* ---------- 绑定（弹窗开关/频道/发送/透明度 + 入口） ---------- */
  function initConsole() {
    const modal = $('chat-modal');
    if (!modal) return;
    const cancel = $('chat-cancel');
    if (cancel) cancel.onclick = closeChatPanel;
    const scrim = $('chat-scrim');
    if (scrim) scrim.onclick = closeChatPanel;
    const sb = $('btn-chat-sidebar');
    if (sb) sb.onclick = openChatPanel;
    const input = $('chat-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          sendSocial();
        }
      });
    }
    const send = $('chat-send');
    if (send) send.onclick = sendSocial;
    const quick = $('chat-quick');
    if (quick) {
      quick.innerHTML = QUICK_PHRASES.map(s => '<button class="chat-quick-btn" data-text="' + escHtml(s) + '">' + s + '</button>').join('');
      quick.querySelectorAll('.chat-quick-btn').forEach(b => b.onclick = () => {
        const i = $('chat-input');
        if (i) { i.value = b.dataset.text; i.focus(); }
      });
    }
    const alpha = $('chat-alpha');
    if (alpha) alpha.oninput = () => { const d = $('chat-drawer'); if (d) d.style.setProperty('--panel-alpha', (alpha.value / 100)); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChatPanel(); });
    initInlineConsoles();
    initSplitters();
    renderChatPanel();
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initConsole);
  }

  /* ---------- 对外 API ---------- */
  UI.consoleLog = consoleLog;
  UI.openChatPanel = openChatPanel;
  UI.closeChatPanel = closeChatPanel;
  // 登录后调用：加载聊天历史 + 订阅实时消息（未登录不调用，避免无会话订阅失败）
  UI.initChat = function () {
    loadChatHistory();
    initChatRealtime();
  };
})();
