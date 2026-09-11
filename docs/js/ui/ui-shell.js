/* ============================================================
 * ui/ui-shell.js —— 界面外壳组件（Sidebar / TopBar / PageContainer）
 * 职责：
 *  1. 页面切换：左侧边栏按钮 ↔ 页面容器，只做 display 显隐，不销毁/重建 DOM
 *  2. 顶栏右上角按钮：背包/牧场跳对应页面；任务/消息/设置弹对话气泡
 *  3. 登录状态钩子 onAuthChange：登录页 ↔ 主界面切换（由 ui-common setAuthUser 驱动）
 *  4. 登录成功后默认进入「主城页（不归城）」
 * 依赖：ui-common（window.UI / $）；气泡组件 ui-dialog（UI.showDialog，可选，不存在时短路）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});

  /* ---------- 页面切换（display 显隐，DOM 常驻）+ URL hash 路由 ----------
   * 地址栏随切换同步为 #page（#battle/#pet/#equip/#market/#market-sell），
   * 支持浏览器前进/后退、可收藏/分享到具体页。改 hash 不重载页面，状态不丢。 */
  const PAGES = new Set(['worldmap', 'capital', 'battle', 'pet', 'bag', 'equip', 'market', 'market-sell', 'shop', 'codex']);
  // 我的上架已并入市集页：保留 'market-sell' 路由兼容（教程 t8 / 任务 / 装备页直达上架），
  // 统一落到市集页并切到「我的上架」视图；'market' 则复位到「全部在售」视图
  function resolveMarketPage(page) {
    if (page === 'market-sell') {
      if (window.UI && window.UI.setMarketView) window.UI.setMarketView('mine');
      return 'market';
    }
    if (page === 'market' && window.UI && window.UI.setMarketView) window.UI.setMarketView('all');
    return page;
  }
  function switchPage(page) {
    if (PAGES.has(page) && location.hash !== '#' + page) {
      location.hash = '#' + page; // 同步地址栏（触发 hashchange，由它统一渲染，避免重复）
      return;
    }
    renderPage(page);
  }
  // 真正渲染目标页（只做 display 显隐，DOM 常驻，数据不丢）
  function renderPage(page) {
    /* ⚠️ resolveMarketPage 不只是「算页面名」—— 它内部会触发市集整页重绘（renderMarket）。
     * 放在这里一抛错，下面切换 active 的代码就全执行不到 → 画面停在上一个页面，
     * 表现就是「点了市集却还是宠物页」，且因为没打断点击流程，很容易被当成没点到。
     * 切页是骨架、内容渲染是血肉：血肉坏了要能看到（console.error），骨架必须照常落地。 */
    try {
      page = resolveMarketPage(page); // market-sell → 市集页 + 我的上架视图
    } catch (e) {
      console.error('[shell] 市集视图切换失败，已跳过（页面仍会切过去）：', e);
    }
    /* 背包 / 装备不是独立 tab，而是浮窗（#bag-window），DOM 里根本没有 #tab-bag / #tab-equip。
     * 以前 switchPage('bag'/'equip') 找不到目标页 → 所有 .tab-page 都被摘掉 active = 整页空白
     * （主城「鉴定」「铸造」两栋建筑，点了就白屏）。现在改成「打开浮窗 + 留在当前页」。 */
    if (page === 'bag' || page === 'equip') {
      if (UI.openBagWindow) UI.openBagWindow();
      const sub = document.querySelector('.bag-subtab[data-bag-subtab="' + (page === 'equip' ? 'equip' : 'bag') + '"]');
      if (sub && sub.click) sub.click();
      return;
    }
    const pages = document.querySelectorAll('.tab-page');
    pages.forEach(p => p.classList.remove('active'));
    const target = document.getElementById('tab-' + page);
    if (target) target.classList.add('active');
    // 百科页内容懒渲染（幂等）：走 hash 变化时不触发 hashchange 的路径（如登录后 hash 残留）也能渲染
    if (page === 'codex' && UI.renderCodex) UI.renderCodex();
    const btns = document.querySelectorAll('.sb-btn');
    btns.forEach(b => {
      // 战斗页（page='battle'）从世界地图进入，侧边栏让「世界地图」保持高亮，避免空指示
      const isActive = b.dataset.page === page || (page === 'battle' && b.dataset.page === 'worldmap');
      b.classList.toggle('active', isActive);
    });
    // 给 body 打 battle-active 类（战斗页全宽背景用，避免依赖 :has() 选择器兼容性）
    if (document.body && document.body.classList) {
      document.body.classList.toggle('battle-active', page === 'battle');
    }
    // 世界地图页首次切换时渲染地图点位（幂等：内部判空）
    if (page === 'worldmap' && window.WorldMap && window.UI && window.UI.renderWorldMapPage) {
      window.UI.renderWorldMapPage();
    }
    // 主城页：切到该页就重渲染（拉最新数据：任务/市场/材料/宠物）
    if (page === 'capital' && window.UI && window.UI.renderCapitalPage) {
      window.UI.renderCapitalPage();
    }
  }
  // 从当前 hash 解析出目标页（非法/空 → 默认主城页）
  function pageFromHash() {
    const h = (location.hash || '').replace('#', '');
    return PAGES.has(h) ? h : 'capital';
  }
  // 顶栏入口统一跳转（背包→背包页 / 牧场→宠物页）
  function navTo(page) {
    switchPage(page);
  }
  // 浏览器前进/后退：hash 变了就渲染对应页（hash 相同不触发，天然防重入）
  function onHashChange() {
    renderPage(pageFromHash());
  }

  /* ---------- 登录状态钩子（ui-common setAuthUser 调用） ----------
   * 未登录：显示全屏登录页、隐藏主界面；登录后反之，并默认进入战斗页。
   * 主界面初始 display:none（HTML 写死），已有会话时 init 恢复会自动切回。 */
  function onAuthChange(loggedIn) {
    const app = document.getElementById('app');
    const login = document.getElementById('login-screen');
    if (!app || !login) return;
    app.style.display = loggedIn ? 'flex' : 'none';
    login.style.display = loggedIn ? 'none' : 'flex';
    if (loggedIn) {
      // 登录成功：若 hash 是内部页则进入该页，否则默认主城页；未登录时清空 hash 防止残留
      if (location.hash && PAGES.has(location.hash.replace('#', ''))) renderPage(location.hash.replace('#', ''));
      else switchPage('capital');
    } else if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search); // 清掉内部页 hash
    }
  }

  /* ---------- 顶栏占位气泡（任务/消息） ---------- */
  function showTodoDialog(name) {
    if (!UI.showDialog) return;
    UI.showDialog({ icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>', speaker: name, text: name + '功能开发中，敬请期待' });
  }
  // 设置：锚定按钮的 Popover（右上方弹出 + 尖角箭头 + 点空白关闭 + 防超屏，由 ui-popover 实现）
  /* 减少动效开关（2026-09-11 UX 审计）：body.rm-anim 全站动画清零（与 prefers-reduced-motion 同策略），
   * localStorage 持久化；登录态恢复后由 initShell 重新应用。 */
  const RM_KEY = 'fos_reduce_motion';
  function rmIsOn() { try { return localStorage.getItem(RM_KEY) === '1'; } catch (e) { return false; } }
  function rmApply(on) {
    if (document.body) document.body.classList.toggle('rm-anim', on);
    try { if (on) localStorage.setItem(RM_KEY, '1'); else localStorage.removeItem(RM_KEY); } catch (e) { /* 隐私模式忽略 */ }
  }
  function showSettingsDialog() {
    if (!UI.openPopover) return;
    const rmOn = rmIsOn();
    UI.openPopover({
      anchor: document.getElementById('btn-settings-sidebar'),
      html: `
        <div class="pop-title"><svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-0.15em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg> 设置</div>
        <div class="pop-desc">宠物养成循环原型<br><span style="color:var(--text-faint)">本地优先 · 云端存档 · 挂机宠物养成</span></div>
        <div class="set-row">
          <div class="set-row-label">减少动效<small>关闭界面动画，长时间挂机更省眼</small></div>
          <button type="button" class="set-toggle ${rmOn ? 'on' : ''}" id="pop-rm-toggle">${rmOn ? '已开启' : '已关闭'}</button>
        </div>
        <button class="btn-mini danger" id="pop-logout">登出账号</button>`,
      onClick: async (e) => {
        if (e.target.closest && e.target.closest('#pop-rm-toggle')) {
          rmApply(!rmIsOn());
          const t = document.getElementById('pop-rm-toggle');
          if (t) { t.classList.toggle('on', rmIsOn()); t.textContent = rmIsOn() ? '已开启' : '已关闭'; }
          if (e.stopPropagation) e.stopPropagation();
          return;
        }
        if (e.target.closest && e.target.closest('#pop-logout')) {
          UI.closePopover();
          if (window.Game) window.Game.onLogout();
        }
      }
    });
  }

  /* ---------- 外壳初始化（绑定侧边栏 + 顶栏按钮） ---------- */
  function initShell() {
    rmApply(rmIsOn()); // 恢复「减少动效」设置（2026-09-11）
    // 侧边栏 4 主按钮
    const sbBtns = document.querySelectorAll('.sb-btn[data-page], .topbar-btn[data-page]');
    sbBtns.forEach(btn => {
      btn.onclick = () => switchPage(btn.dataset.page);
    });
    // 顶栏：data-nav 跳页（背包/牧场）
    const navBtns = document.querySelectorAll('.top-btn[data-nav], .fs-btn[data-nav]');
    navBtns.forEach(btn => {
      btn.onclick = () => {
        navTo(btn.dataset.nav);
        // 从背包窗口点跳页时关闭背包窗口
        const bw = document.getElementById('bag-window');
        if (bw) { bw.classList.remove('is-open'); bw.style.display = 'none'; }
      };
    });
    // data-dialog 占位气泡（顶栏已挪走，这里兼容侧边栏的对话框按钮）
    const dlgBtns = document.querySelectorAll('[data-dialog]');
    dlgBtns.forEach(btn => {
      btn.onclick = () => showTodoDialog(btn.dataset.dialog);
    });
    // 侧边栏：设置按钮（已从顶栏挪来）
    const stBtn = document.getElementById('btn-settings-sidebar');
    if (stBtn) stBtn.onclick = showSettingsDialog;
    // 侧边栏：任务按钮 → 打开真实任务面板（ui-quest.js）
        // 顶部背包按钮 → 打开背包窗口
    const bagBtn = document.getElementById('topbar-bag');
    if (bagBtn) bagBtn.onclick = () => { if (window.UI && window.UI.openBagWindow) window.UI.openBagWindow(); };

    document.querySelectorAll('#btn-quest-sidebar, #topbar-quest').forEach(btn => {
      btn.onclick = () => { if (window.UI && window.UI.openQuestPanel) window.UI.openQuestPanel(); };
    });
    // 浏览器前进/后退 / 直接带 #hash 打开 → 渲染对应页
    window.addEventListener('hashchange', onHashChange);
    // 刷新（F5 / 直接打开）默认停在主城页（安全区），不记忆上次停的战斗页（第三菜单）。
    // 注意：前进/后退仍由 hashchange 驱动走 pageFromHash；这里仅控制"首次进入"的落点。
    renderPage('capital');
    // 若地址栏带着 #battle 之类内部 hash，刷新后统一落到主城（避免直接停进第三菜单）
    if (location.hash && location.hash !== '#capital') {
      history.replaceState(null, '', location.pathname + location.search + '#capital');
    }
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initShell);
  }

  /* ---------- 对外 API ---------- */
  UI.switchPage = switchPage;
  UI.navTo = navTo;
  UI.onAuthChange = onAuthChange;
})();
