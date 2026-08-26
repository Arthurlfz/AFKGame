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

  /* ---------- 战报日志（通用组件：所有页面共享的日志槽，写入战斗记录面板） ---------- */
  function addLog(text, isCrit, isResult, isLose) {
    const log = $('battle-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (isCrit) entry.classList.add('crit');
    if (isResult) { entry.classList.add('result'); if (isLose) entry.classList.add('lose'); }
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- 系统消息：写入消息控制台（system 分类） ---------- */
  function showToast(title, msg) {
    if (!UI.consoleLog) return;
    const html = (title ? '<b>' + title + '</b>' : '') + (msg ? ' ' + msg : '');
    UI.consoleLog('system', html);
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
    UI.renderAreaSelector && UI.renderAreaSelector();
    UI.updateBattleArea && UI.updateBattleArea(window.Battle?.getCurrentArea());
    UI.syncCombatant && UI.syncCombatant(); // 未开战时把对战区同步成当前出战宠物（修复写死的莱姆）
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
  }

  /* ---------- 对外 API（通用部分；其余在页面 UI 文件中挂载） ---------- */
  UI.$ = $;
  UI.escapeHtml = escapeHtml;
  UI.setAuthUser = setAuthUser;
  UI.isLoggedIn = isLoggedIn;
  UI.addLog = addLog;
  UI.showToast = showToast;
  UI.clampTip = clampTip;
  UI.renderAll = renderAll;
})();
