/* ============================================================
 * ui/ui-common.js —— UI 通用组件与渲染枢纽（不绑定任何具体页面）
 * 职责：
 *  1. 共享底层工具：escapeHtml / $ / showToast / addLog
 *  2. 通用组件：tooltip 避让(clampTip + 全局事件委托)、账号区(renderAuth)
 *  3. 渲染枢纽 renderAll：按顺序调用各页面 UI 模块（battle/pet/equipment/market/craft）
 *  4. 初始化并对外暴露 window.UI（其余 UI 文件向同一 window.UI 挂载方法）
 * 依赖（只读查询接口，不改状态）：config / equipment / materials / market / pet
 * ============================================================ */
(function () {
  'use strict';

  // 所有 UI 文件都挂载到同一个 window.UI 命名空间；common 先跑负责初始化它
  const UI = (window.UI = window.UI || {});

  const Config = window.Config;
  const Materials = window.Materials;

  /* ---------- 基础工具（通用组件，供各页面 UI 复用） ---------- */
  function $(id) { return document.getElementById(id); }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 账号区（登录/注册/登出，流程由 main.js 编排） ---------- */
  let authUser = null;
  function setAuthUser(user) {
    authUser = user || null;
    // 新手引导：状态按账号隔离（引导开始/跳过/毕业礼包标记都跟账号走，换号各自独立）
    if (window.TutorialMode && window.TutorialMode.bindUser) {
      try { window.TutorialMode.bindUser((authUser && (authUser.email || authUser.id)) || ''); }
      catch (e) { console.warn('[ui] TutorialMode.bindUser 失败', e); }
    }
    renderAuth();
    // 外壳登录钩子（ui-shell 定义）：未登录 → 全屏登录页；登录 → 主界面（默认战斗页）
    if (UI.onAuthChange) UI.onAuthChange(!!authUser);
  }
  function isLoggedIn() { return !!authUser; }
  function renderAuth() {
    const box = $('auth-box');
    box.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'acc-label';
    label.textContent = '账号';
    box.appendChild(label);
    if (authUser) {
      const mail = document.createElement('b');
      mail.style.color = '#4ecca3';
      mail.textContent = authUser.email;
      box.appendChild(mail);
      const spacer = document.createElement('span');
      spacer.style.flex = '1';
      box.appendChild(spacer);
      const logout = document.createElement('button');
      logout.className = 'btn-mini ghost';
      logout.textContent = '登出';
      logout.onclick = () => window.Game.onLogout();
      box.appendChild(logout);
    } else {
      const email = document.createElement('input');
      email.type = 'email';
      email.id = 'auth-email';
      email.placeholder = '邮箱';
      email.autocomplete = 'email';
      const pwd = document.createElement('input');
      pwd.type = 'password';
      pwd.id = 'auth-pwd';
      pwd.placeholder = '密码';
      pwd.autocomplete = 'current-password';
      const login = document.createElement('button');
      login.className = 'btn-mini primary';
      login.textContent = '登录';
      login.onclick = () => window.Game.onLogin($('auth-email').value.trim(), $('auth-pwd').value);
      const signup = document.createElement('button');
      signup.className = 'btn-mini ghost';
      signup.textContent = '注册';
      signup.onclick = () => window.Game.onSignup($('auth-email').value.trim(), $('auth-pwd').value);
      box.appendChild(email);
      box.appendChild(pwd);
      box.appendChild(login);
      box.appendChild(signup);
      const hint = document.createElement('span');
      hint.className = 'acc-hint';
      hint.textContent = '登录后孵化宠物会自动云端存档';
      box.appendChild(hint);
    }
  }

  /* ---------- 消息出口（全游戏唯一：底部消息控制台 system 分类） ----------
   * 历史坑：这里原本写战斗页的 #battle-log，而该面板在 v2 布局里早已 display:none，
   * 于是全项目 50+ 处播报（升级/进化/打造/登录/读档失败…）全部掉进黑洞，
   * 隐藏 DOM 还跟着每回合战斗无限增长（挂机一小时 = 几千个废节点）。
   * 现在只有一条路：控制台。一处可见、上限 100 条、自动滚动。
   * addLog = 纯文本日志（内部转义，防 XSS）；showToast = 富文本提示（调用方负责 HTML 安全）。
   */
  function addLog(text) {
    if (!UI.consoleLog) return;
    UI.consoleLog('system', escapeHtml(text == null ? '' : String(text)));
  }
  function showToast(title, msg) {
    if (!UI.consoleLog) return;
    UI.consoleLog('system', (title ? '<b>' + title + '</b> ' : '') + (msg != null ? String(msg) : ''));
  }


  /* ---------- tooltip 避让（通用组件：装备卡 / 快捷装备行共用） ---------- */
  // 默认上方居中；上方空间不足 → 移到下方；水平方向 clamp 进视口
  function clampTip(anchor) {
    const tip = anchor.querySelector('.equip-tip, .quick-tip');
    if (!tip) return;
    tip.style.top = ''; tip.style.bottom = ''; tip.style.left = ''; tip.style.transform = '';
    const cardRect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (tipRect.top < 8) { // 上方放不下 → 显示在下方
      tip.style.top = cardRect.height + 6 + 'px';
      tip.style.bottom = 'auto';
    }
    const t2 = tip.getBoundingClientRect();
    let left = cardRect.left + cardRect.width / 2 - t2.width / 2;
    left = Math.max(8, Math.min(left, vw - t2.width - 8));
    tip.style.left = (left - cardRect.left) + 'px';
    tip.style.transform = 'none';
  }
  // 事件委托：hover 装备卡/快捷装备行时修正浮层位置（stub 环境无真实事件，不影响测试）
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      const anchor = t && t.closest ? t.closest('.equip-card, .quick-eq') : null;
      if (anchor && anchor.querySelector('.equip-tip, .quick-tip')) clampTip(anchor);
    });
  }

  /* ---------- 问号 tooltip：.q-tip[data-tip] 悬停显示（CSS）+ 点击切换显示 ---------- */
  function initQuestionTips() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('click', (e) => {
      const tip = e.target.closest && e.target.closest('.q-tip, .bonus-tip, .equip-inv .quick-eq, #equip-slots .slot-item');
      // 关掉其他已打开的，再切换当前
      document.querySelectorAll('.q-tip.open, .bonus-tip.open, .equip-inv .quick-eq.open, #equip-slots .slot-item.open')
        .forEach(t => { if (t !== tip) t.classList.remove('open'); });
      if (tip) tip.classList.toggle('open');
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initQuestionTips);
  }

  /* ---------- 按钮 loading 态（打造 / 购买等所有要等云端的操作共用） ----------
   * 实测一次云端 rpc 340ms，打造/购买要串两三次往返 = 1~2 秒。
   * 这段时间若按钮只是禁用、没有任何文字变化，玩家的感受就是「点了没反应、卡住了」。
   * 所以点下立刻换文字 + 禁用，结束（成功或失败）后恢复原文与可用状态。
   * 注意：禁用必须保留 —— 连点会重复扣材料/重复打造，这个坑踩过两次（见 ui-craft / quest 注释）。
   * 成功后调用方通常会 render() 重建该按钮，此时对本函数持有的旧节点赋值无害。
   */
  async function runWithLoading(btn, loadingText, task) {
    if (!btn || btn.disabled) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText;
    try { return await task(); }
    finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  /* ---------- 血统被动卡片渲染（金色主题：图标+名称+描述） ---------- */
  function bloodlineHtml(pet) {
    if (!pet || !window.Pet || !window.Pet.getBloodline) return '';
    const bl = window.Pet.getBloodline(pet);
    if (!bl) return '';
    return '<div class="bloodline-card">' +
      '<span class="bloodline-icon">' + (bl.icon || '✨') + '</span>' +
      '<div class="bloodline-info">' +
        '<div class="bloodline-name">血统 · ' + escapeHtml(bl.name) + '</div>' +
        '<div class="bloodline-desc">' + escapeHtml(bl.desc || '') + '</div>' +
      '</div>' +
    '</div>';
  }


  /* ---------- 通用窗口拖动（标题栏按住拖动整个窗口） ---------- */
  function makeDraggable(winEl, handleEl) {
    if (!winEl || !handleEl || winEl._dragBound) return;
    winEl._dragBound = true;  // 防止重复绑定

    let isDragging = false;
    let startX = 0, startY = 0;
    let baseX = 0, baseY = 0;
    let rafId = null;
    let curX = 0, curY = 0;

    function applyTransform() {
      rafId = null;
      winEl.style.transform = 'translate3d(' + curX + 'px,' + curY + 'px,0)';
    }

    function onMouseDown(e) {
      // 点击关闭按钮等交互元素时不拖动
      if (e.target.closest('button, input, select, a, textarea')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = winEl.getBoundingClientRect();
      baseX = rect.left;
      baseY = rect.top;
      curX = baseX;
      curY = baseY;
      // 拖动时禁用 transition（否则窗口会追着鼠标跑），用 translate3d 走 GPU
      winEl.classList.add('is-dragging');
      winEl.style.left = '0';
      winEl.style.top = '0';
      winEl.style.transform = 'translate3d(' + baseX + 'px,' + baseY + 'px,0)';
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      curX = baseX + (e.clientX - startX);
      curY = baseY + (e.clientY - startY);
      // rAF 节流：每帧最多更新一次，避免高频重绘卡顿
      if (rafId === null) rafId = requestAnimationFrame(applyTransform);
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      winEl.classList.remove('is-dragging');
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    handleEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /* ---------- 渲染枢纽（按页面顺序调用各 UI 模块，统一刷新） ---------- */
  function renderAll() {
    UI.renderPetPanel();
    UI.renderPetList();
    UI.renderMergeTab && UI.renderMergeTab();
    UI.renderSynthTab && UI.renderSynthTab();
    UI.renderEvolveTab && UI.renderEvolveTab();
    UI.renderBag && UI.renderBag();
    UI.renderEquipSlots();
    UI.renderPetEquipInv && UI.renderPetEquipInv();
    UI.renderInventory();
    UI.renderInvFilter();
    UI.renderInvToolbar();
    UI.updateBattleArea && UI.updateBattleArea(window.Battle?.getCurrentArea());
    UI.renderCombatantData && UI.renderCombatantData();     // 出战宠物区数据（经验/等级）：战斗中也要刷新
    UI.syncCombatantSnapshot && UI.syncCombatantSnapshot(); // 立绘快照：仅非战斗时同步
    UI.renderRoster && UI.renderRoster();   // 战斗页左侧出战宠物竖列
    UI.renderMarket();
    UI.renderSellArea();
    UI.renderTradeRecords();
    UI.renderMergeHint();
    UI.renderEvolveHint();
    $('phoenix-num').textContent = String(Materials.getQuantity(Config.drop.phoenixName));
    $('reforge-num').textContent = String(Materials.getQuantity(Config.craft.reforge.name));
    $('strip-num').textContent = String(Materials.getQuantity(Config.craft.strip.name));
    $('holy-num').textContent = String(Materials.getQuantity(Config.craft.holy.name));
    $('augment-num').textContent = String(Materials.getQuantity(Config.craft.augment.name));
    UI.renderEggPanel && UI.renderEggPanel(); // 宠物页孵化面板（ui-pet 定义，未定义时跳过）
    UI.renderQuestTracker && UI.renderQuestTracker(); // 任务追踪栏（ui-quest 定义，未定义时跳过）
    UI.renderShop && UI.renderShop();                 // 魔石商店页（ui-shop 定义，用缓存数据重绘，不打接口）
  }

  /* ---------- 对外 API（通用部分；其余在页面 UI 文件中挂载） ---------- */
  UI.$ = $;
  UI.escapeHtml = escapeHtml;
  UI.setAuthUser = setAuthUser;
  UI.getAuthUser = function () { return authUser; };
  UI.isLoggedIn = isLoggedIn;
  UI.addLog = addLog;
  UI.showToast = showToast;
  UI.clampTip = clampTip;
  UI.runWithLoading = runWithLoading;
  UI.renderAll = renderAll;
  UI.makeDraggable = makeDraggable;
  UI.bloodlineHtml = bloodlineHtml;
})();
