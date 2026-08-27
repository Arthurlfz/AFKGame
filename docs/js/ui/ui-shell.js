/* ============================================================
 * ui/ui-shell.js —— 界面外壳组件（Sidebar / TopBar / PageContainer）
 * 职责：
 *  1. 页面切换：左侧边栏按钮 ↔ 页面容器，只做 display 显隐，不销毁/重建 DOM
 *  2. 顶栏右上角按钮：背包/牧场跳对应页面；任务/消息/设置弹对话气泡
 *  3. 登录状态钩子 onAuthChange：登录页 ↔ 主界面切换（由 ui-common setAuthUser 驱动）
 *  4. 登录成功后默认进入「野外探险/战斗页」
 * 依赖：ui-common（window.UI / $）；气泡组件 ui-dialog（UI.showDialog，可选，不存在时短路）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});

  /* ---------- 页面切换（display 显隐，DOM 常驻）+ URL hash 路由 ----------
   * 地址栏随切换同步为 #page（#battle/#pet/#equip/#market/#market-sell），
   * 支持浏览器前进/后退、可收藏/分享到具体页。改 hash 不重载页面，状态不丢。 */
  const PAGES = new Set(['battle', 'pet', 'bag', 'equip', 'market', 'market-sell']);
  function switchPage(page) {
    if (PAGES.has(page) && location.hash !== '#' + page) {
      location.hash = '#' + page; // 同步地址栏（触发 hashchange，由它统一渲染，避免重复）
      return;
    }
    renderPage(page);
  }
  // 真正渲染目标页（只做 display 显隐，DOM 常驻，数据不丢）
  function renderPage(page) {
    const pages = document.querySelectorAll('.tab-page');
    pages.forEach(p => p.classList.remove('active'));
    const target = document.getElementById('tab-' + page);
    if (target) target.classList.add('active');
    const btns = document.querySelectorAll('.sb-btn');
    btns.forEach(b => b.classList.toggle('active', b.dataset.page === page));
  }
  // 从当前 hash 解析出目标页（非法/空 → 默认战斗页）
  function pageFromHash() {
    const h = (location.hash || '').replace('#', '');
    return PAGES.has(h) ? h : 'battle';
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
      // 登录成功：若 hash 是内部页则进入该页，否则默认战斗页；未登录时清空 hash 防止残留
      if (location.hash && PAGES.has(location.hash.replace('#', ''))) renderPage(location.hash.replace('#', ''));
      else switchPage('battle');
    } else if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search); // 清掉内部页 hash
    }
  }

  /* ---------- 顶栏占位气泡（任务/消息） ---------- */
  function showTodoDialog(name) {
    if (!UI.showDialog) return;
    UI.showDialog({ icon: '📜', speaker: name, text: name + '功能开发中，敬请期待' });
  }
  // 开发测试补给：只补材料，不改宠物等级或战斗数值；已登录时同步到云端。
  async function grantDevResources() {
    const packs = {
      '进化素材': 30,
      '精粹进化素材': 30,
      '传说进化素材': 30,
      '涅磐兽': 10,
      '合成之石': 10,
      '重铸石': 10,
      '剥离石': 10,
      '神圣石': 10,
      '增缀石': 10
    };
    if (!window.Materials) return;
    await Promise.all(Object.entries(packs).map(([name, amount]) => window.Materials.gain(name, amount)));
    UI.renderAll && UI.renderAll();
    UI.showToast && UI.showToast('开发补给已发放', '进化、涅槃、合成和打造材料已补齐。');
  }

  // 设置：锚定按钮的 Popover（右上方弹出 + 尖角箭头 + 点空白关闭 + 防超屏，由 ui-popover 实现）
  function showSettingsDialog() {
    if (!UI.openPopover) return;
    UI.openPopover({
      anchor: document.getElementById('btn-settings-sidebar'),
      html: `
        <div class="pop-title">⚙️ 设置</div>
        <div class="pop-desc">宠物养成循环原型<br><span style="color:var(--text-faint)">本地优先 · 云端存档 · 挂机宠物养成</span></div>
        <button class="btn-mini" id="pop-dev-resources">发放开发补给</button>
        <button class="btn-mini danger" id="pop-logout">登出账号</button>`,
      onClick: async (e) => {
        if (e.target.closest && e.target.closest('#pop-dev-resources')) {
          UI.closePopover();
          await grantDevResources();
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
    // 侧边栏 4 主按钮
    const sbBtns = document.querySelectorAll('.sb-btn[data-page]');
    sbBtns.forEach(btn => {
      btn.onclick = () => switchPage(btn.dataset.page);
    });
    // 顶栏：data-nav 跳页（背包/牧场）
    const navBtns = document.querySelectorAll('.top-btn[data-nav]');
    navBtns.forEach(btn => {
      btn.onclick = () => navTo(btn.dataset.nav);
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
    const questBtn = document.getElementById('btn-quest-sidebar');
    if (questBtn) {
      questBtn.onclick = () => { if (window.UI && window.UI.openQuestPanel) window.UI.openQuestPanel(); };
    }
    // 浏览器前进/后退 / 直接带 #hash 打开 → 渲染对应页
    window.addEventListener('hashchange', onHashChange);
    if (location.hash && PAGES.has(location.hash.replace('#', ''))) renderPage(location.hash.replace('#', ''));
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initShell);
  }

  /* ---------- 对外 API ---------- */
  UI.switchPage = switchPage;
  UI.navTo = navTo;
  UI.onAuthChange = onAuthChange;
})();
