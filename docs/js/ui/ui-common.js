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

  /* ---------- 消息出口（全游戏唯一：消息控制台） ----------
   * 历史坑：这里原本写战斗页的 #battle-log，而该面板在 v2 布局里早已 display:none，
   * 于是全项目 50+ 处播报（升级/进化/打造/登录/读档失败…）全部掉进黑洞，
   * 隐藏 DOM 还跟着每回合战斗无限增长（挂机一小时 = 几千个废节点）。
   * 现在只有一条路：控制台。一处可见、上限 100 条、自动滚动。
   *
   * 🔴 频道分类（cat）：**四个频道收什么，规则写在 `ui-console.js` 的「频道规则」常量块**，
   *    那里是全项目唯一权威，加消息前先去对一眼。这里只做转交，不做判断。
   *    省略 cat = 'system'。战斗流水必须显式传 'battle'、获得物传 'loot'，别图省事。
   *
   * ⚠️ 2026-09-13 修正（原注释说反了）：**addLog 与 showToast 都是富文本**。
   *    `UI.consoleLog(cat, html, …)` 第二个参数就叫 html（定义在 ui-console.js），**内部不转义**。
   *    实测 65 处 addLog 调用里有 **16 处直接传 `<svg>` 图标**（ui-bag / ui-craft 等）——
   *    若在这里转义，图标会整段显示成源码文本。所以**不能**给 addLog 加 escapeHtml。
   *    → **调用方负责 HTML 安全**：拼进来的玩家可控内容（昵称 / 宠物名等）必须自己先 escapeHtml。
   *    （聊天、社交分类走 ui-console.js 的 escHtml，那是另一条路，别混。）
   */
  function addLog(text, cat) {
    if (!UI.consoleLog) return;
    UI.consoleLog(cat || 'system', text == null ? '' : String(text));
  }
  function showToast(title, msg, cat) {
    if (!UI.consoleLog) return;
    UI.consoleLog(cat || 'system', (title ? '<b>' + title + '</b> ' : '') + (msg != null ? String(msg) : ''));
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
  /* 气泡本体由 CSS content:attr(data-tip) 渲染（game.css .q-tip::after），JS 只负责点按切换 */
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
    btn.classList.add('is-loading');
    // ⚠️ querySelector 可能不存在（测试 mock / 非标准宿主），缺了就按纯文字处理。
    const hasIcon = btn.querySelector && btn.querySelector('img, svg');
    const canStyle = !!(btn.style && typeof btn.style.setProperty === 'function');
    let pctEl = null;
    if (loadingText && !hasIcon) {
      btn.innerHTML = loadingText;
      if (btn.appendChild) {
        try {
          pctEl = document.createElement('b');
          pctEl.className = 'ld-pct';
          pctEl.textContent = '0%';
          btn.appendChild(pctEl);
        } catch (e) { pctEl = null; }
      }
    }
    // 金墨进度条：先快后慢推进到 88% 封顶（真实进度未知，请求完成瞬间补满 100% 再恢复）
    const setP = v => {
      if (canStyle) btn.style.setProperty('--p', v + '%');
      if (pctEl) pctEl.textContent = v + '%';
    };
    setP(0);
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(88, p + (p < 30 ? 12 : p < 60 ? 5 : 2.2));
      setP(Math.round(p));
    }, 320);
    try { return await task(); }
    finally {
      clearInterval(iv);
      setP(100);
      // 补满 100% 后短暂停留 220ms，让玩家看到「完成」再恢复按钮
      await new Promise(r => setTimeout(r, 220));
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.innerHTML = original;
    }
  }

  /* ---------- 动效层（2026-09-16）----------
   * 只有三件事，但全站都要用，所以放通用层：
   *   setNum     数字变化时滚动 + 弹一下（材料 / 魔石 / 经验）
   *   celebrate  进化 / 合成 / 涅槃的揭幕演出
   *   closeWithAnim 浮层收起（原来弹窗是"啪"一下消失）
   * ⚠️ 全是纯表现：**任何环境缺失都要静默跳过**，绝不能因为没有 document 就把业务流程打断。 */
  function hasDom() { return typeof document !== 'undefined' && !!document.body; }
  function raf(fn) {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function setNum(el, value, opt) {
    if (!el) return;
    opt = opt || {};
    const to = Number(value) || 0;
    const from = (el.__num == null) ? to : Number(el.__num);
    el.__num = to;
    const put = (v) => { el.textContent = opt.fmt ? opt.fmt(v) : String(v); };
    // 变化太小不滚动（差 1~2 点还滚会显得神经质）；没有 rAF 的环境（测试桩）直接落值
    const canRoll = Math.abs(to - from) >= 2 && typeof window !== 'undefined' && !!window.requestAnimationFrame;
    if (canRoll) {
      const dur = Math.min(600, 180 + Math.abs(to - from) * 4);
      const t0 = nowMs();
      const step = () => {
        const k = Math.min(1, (nowMs() - t0) / dur);
        put(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
        if (k < 1 && el.__num === to) raf(step); // 期间又被改成新目标 → 停手，交给新一轮
      };
      raf(step);
    } else {
      put(to);
    }
    if (from !== to && el.classList && el.classList.add) {
      el.classList.remove('num-bump');
      void el.offsetWidth; // 强制重排：不加这行，连着两次变化只会播一次动画
      el.classList.add('num-bump');
      setTimeout(() => el.classList && el.classList.remove('num-bump'), 520);
    }
  }

  /* 揭幕：一道光横扫 + 中央标题。2 秒后自行消失，不吃点击（pointer-events:none）。 */
  function celebrate(opt) {
    if (!hasDom()) return;
    opt = opt || {};
    const box = document.createElement('div');
    box.className = 'celebrate' + (opt.kind === 'god' ? ' is-god' : (opt.kind === 'mutant' ? ' is-mutant' : ''));
    const parts = [];
    if (opt.title) parts.push('<div class="cb-k">' + escapeHtml(opt.title) + '</div>');
    if (opt.name) parts.push('<div class="cb-n">' + escapeHtml(opt.name) + '</div>');
    if (opt.sub) parts.push('<div class="cb-s">' + escapeHtml(opt.sub) + '</div>');
    box.innerHTML = parts.join('');
    document.body.appendChild(box);
    setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 2100);
  }

  /* 浮层收起：先加 .is-closing 播收起，动画时长到再执行真正的移除。
   * ⚠️ done 里只能做「摘掉 show」这一件事 —— 队列里的下一条由调用方自己安排。 */
  function closeWithAnim(el, done) {
    if (!el || !hasDom()) { if (done) done(); return; }
    el.classList.add('is-closing');
    setTimeout(() => { el.classList.remove('is-closing'); if (done) done(); }, 170);
  }

  /* ---------- 血统被动卡片渲染（金色主题：宠物头像+名称+描述） ----------
   * 2026-09-10 移除 emoji 占位：图标位放该宠的真实头像（PetSprites 按名字解析），无素材留空。 */
  function bloodlineHtml(pet) {
    if (!pet || !window.Pet || !window.Pet.getBloodline) return '';
    const bl = window.Pet.getBloodline(pet);
    if (!bl) return '';
    const PS = window.PetSprites;
    const av = (PS && PS.avatarOf) ? PS.avatarOf(pet.name) : null;
    return '<div class="bloodline-card">' +
      '<span class="bloodline-icon">' + (av ? '<img class="pet-avatar-sprite" src="' + av + '" alt="">' : '') + '</span>' +
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
      winEl.style.left = curX + 'px';
      winEl.style.top = curY + 'px';
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
      // 统一定位模型：位置完全由 left/top 决定，transform 归还给 CSS（居中/开合动画）。
      // 旧实现 left:0/top:0 + translate3d(x,y) 在关窗后残留，重开时会被 .is-open 的
      // translate(-50%,-50%) 盖成「锚定原点再回拉半格」= 窗口飞左上角。
      winEl.classList.add('is-dragging');
      winEl.style.left = baseX + 'px';
      winEl.style.top = baseY + 'px';
      winEl.style.transform = 'none';
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
    UI.renderAwakenTab && UI.renderAwakenTab();
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
    UI.refreshGuideDots && UI.refreshGuideDots();   // 红点指路：跟着任务状态走（有事可做才亮）
    UI.renderMarket();
    UI.renderSellArea();
    UI.renderTradeRecords();
    UI.renderMergeHint();
    UI.renderEvolveHint();
    UI.renderResourceTrial && UI.renderResourceTrial();
    // 材料数字：交给 setNum —— 变了会滚一下 + 弹一下（原来是无声无息地换一行字）
    setNum($('phoenix-num'), Materials.getQuantity(Config.drop.phoenixName), { animate: true });
    setNum($('reforge-num'), Materials.getQuantity(Config.craft.reforge.name), { animate: true });
    setNum($('strip-num'), Materials.getQuantity(Config.craft.strip.name), { animate: true });
    setNum($('holy-num'), Materials.getQuantity(Config.craft.holy.name), { animate: true });
    setNum($('augment-num'), Materials.getQuantity(Config.craft.augment.name), { animate: true });
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
  /* ---------- 融合过渡动画（进化/合成时的中间态） ----------
   * 点确认 → 显示全屏暗层 + 旋转墨环 + "正在融合…"
   * 服务器返回成功 → 墨环变金 + "融合成功"，0.9s 后淡出
   * 服务器返回失败 → 直接淡出
   * 用法：const close = UI.showFusion(); ... await evolve(); close(true) / close(false) */
  function showFusion() {
    if (!hasDom()) return function(){};
    const box = document.createElement('div');
    box.className = 'fusion-overlay';
    box.innerHTML =
      '<div class="fusion-ring"></div>' +
      '<div class="fusion-text">正在融合…</div>';
    document.body.appendChild(box);
    let closed = false;
    return function done(success) {
      if (closed) return;
      closed = true;
      if (success) {
        box.classList.add('is-success');
        var t = box.querySelector('.fusion-text');
        if (t) t.textContent = '融合成功';
        setTimeout(function(){ if (box.parentNode) box.parentNode.removeChild(box); }, 900);
      } else {
        box.parentNode.removeChild(box);
      }
    };
  }

  UI.setNum = setNum;
  UI.celebrate = celebrate;
  UI.closeWithAnim = closeWithAnim;
  UI.showFusion = showFusion;
})();
