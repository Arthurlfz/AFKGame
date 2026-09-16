/* ============================================================
 * ui-fixes.js — 交互体验修复补丁（2026-09-10 实测后修复）
 * 加载时机：最后加载，在 main.js 之后
 * 修复项：ESC关弹窗、货币tooltip、战斗日志、背包物品点选、
 *        设置页、教程结束引导、进化方向提示
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ---------- 已有bug修补：UI.renderMergeHint 未定义 ---------- */
  if (window.UI && typeof window.UI.renderMergeHint !== 'function') {
    window.UI.renderMergeHint = function () { /* noop shim */ };
  }

  /* ---------- 已有bug修补：openBagWindow 因 renderBag 报错导致 is-open 没加上 ---------- */
  function patchBagOpen() {
    if (!window.UI || !UI.openBagWindow || UI.__bagPatched) return;
    const origOpen = UI.openBagWindow;
    UI.openBagWindow = function () {
      try { origOpen(); } catch (e) { console.warn('[fix] openBagWindow error:', e); }
      // 强制确保 is-open 加上（rAF 在后台标签页不触发，用 setTimeout）
      const host = $('bag-window');
      if (host) {
        host.style.display = 'block';
        setTimeout(() => { host.classList.add('is-open'); }, 50);
      }
    };
    UI.__bagPatched = true;
  }

  /* ============================================================
   * 1. ESC 键关闭背包/聊天弹窗
   * ============================================================ */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // 「下一步」卡片 z-index（230）比背包（100）高，ESC 先关最上面那层
    const nextCard = document.querySelector('.next-step-card');
    if (nextCard) { nextCard.remove(); return; }
    // 背包开着就关背包
    const bag = $('bag-window');
    const bagOpen = bag && (bag.classList.contains('is-open') || getComputedStyle(bag).display === 'block');
    if (bagOpen) {
      const closeBtn = $('bag-cancel');
      if (closeBtn) closeBtn.click();
      return;
    }
    // 聊天开着就关聊天
    const chat = $('chat-modal');
    const chatOpen = chat && (chat.classList.contains('is-open') || getComputedStyle(chat).display !== 'none');
    if (chatOpen) {
      const closeBtn = $('chat-cancel');
      if (closeBtn) closeBtn.click();
    }
  });

  /* ============================================================
   * 2. 货币 tooltip（第6点第二点：给每种货币加用途说明）
   * ============================================================ */
  function initCurrencyTooltips() {
    // 顶栏魔石 chip
    const gem = $('gem-balance');
    if (gem) {
      gem.title = '魔石：充值/活动获得的硬通货，魔石商店购买稀有道具';
    }
    // 市集里出现的各种货币图标加 tooltip
    const currencyNames = ['神圣石', '重铸石', '增缀石', '剥离石', '涅槃兽', '鉴定石', '强化丹'];
    document.querySelectorAll('[class*="price"], [class*="cost"], [class*="price"]').forEach(el => {
      const text = el.textContent || '';
      for (const cn of currencyNames) {
        if (text.includes(cn) && !el.title) {
          const tips = {
            '神圣石': '神圣石：市集交易货币，打怪/卖装备获得',
            '重铸石': '重铸石：随机重洗装备所有词缀',
            '增缀石': '增缀石：给装备新增一条词缀',
            '剥离石': '剥离石：移除装备上不需要的词缀',
            '涅槃兽': '涅槃兽：宠物涅槃重生材料',
            '鉴定石': '鉴定石：鉴定未鉴定装备',
            '强化丹': '强化丹：提升装备基础属性'
          };
          el.title = tips[cn] || cn;
          break;
        }
      }
    });
  }

  /* ============================================================
   * 4. （已删除 2026-09-14）背包物品点选
   *    这段是死代码：#inv-list 里现在放的是 ui-equipment.js 渲染的 `.equip-card`，
   *    而它找的是 `.poe-item`（背包弹窗那套）→ 永远匹配不上，什么都不做。
   *    选择逻辑已收在 ui-equipment.js 的 `.ec-sel` 角标上（点卡片=只看详情）。
   * ============================================================ */

  /* ============================================================
   * 5. 设置面板 —— 2026-09-17 整段删除，理由见下，别再抄回来。
   *
   * 这里以前给「设置」按钮 addEventListener 造了一个 #fix-settings-panel，
   * 而 ui-shell.js:191 早就用 onclick 绑了它自己的设置 Popover ——
   * 同一个按钮两套处理器 ⇒ 点一次【同时弹出两个设置面板】，内容还互相矛盾。
   * 更要命的是这个旧面板里的东西全是假的：
   *   · 「战斗动画速度」下拉没有 change 监听 —— 选 0.5x/2x 画面毫无变化
   *   · 「自动回城血量阈值 当前 30%」是写死的字符串，既不能改也不读真实配置
   *   · 「更多设置将在后续版本加入」—— 永远是这句话
   * 真设置（减少动效 / 登出）在 ui-shell.js 的 showSettingsDialog 里，
   * 删掉这份重复的假面板 = 一次点开两个、死控件、假数字三个问题一起消失。
   * ============================================================ */

  /* ============================================================
   * 6. 教程结束后弹出"下一步做什么"卡片
   * ============================================================ */
  /* MutationObserver 是浏览器 API，node 测试环境没有它。
   * 缺了它只损失「纯增强」行为（自动弹下一步卡片 / 给卡片补动画 class），
   * 绝不能因此把整个模块初始化炸掉 —— 2026-09-10 就是它让 vtest_ui / vtest_task12_ui
   * 直接抛 ReferenceError 崩掉（表现为「进程退出码 1」且没有 FAIL 行）。
   * ⚠️ 不能只靠 `if (!el) return` 兜底：测试桩的 getElementById 永远返回假元素、不会 null。 */
  const canObserve = () => (typeof MutationObserver === 'function');

  function initTutorialEndCard() {
    // 监听教程完成事件：观察 quest-tracker 的变化
    const tracker = $('quest-tracker');
    if (!tracker || !canObserve()) return;

    // 用 MutationObserver 检测教程完成
    let shown = false;
    const observer = new MutationObserver(function () {
      if (shown) return;
      const text = tracker.textContent || '';
      // 教程全部完成后 tracker 会隐藏或不再显示引导
      if (tracker.style.display === 'none' || text.includes('引导结束') || text.includes('选择下一步')) {
        // 延迟一点等动画结束
        setTimeout(showNextStepCard, 800);
      }
    });
    observer.observe(tracker, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] });
  }

  function showNextStepCard() {
    if (document.querySelector('.next-step-card')) return;
    if (localStorage.getItem('__nextStepShown')) return; // 每个会话只弹一次

    const card = document.createElement('div');
    card.className = 'next-step-card';
    card.innerHTML =
      '<h3><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg> 新手教程完成！</h3>' +
      '<p>你已经掌握了核心循环：挂机 → 掉装备 → 重铸词缀 → 进化宠物。接下来想做什么？</p>' +
      '<div class="next-step-options">' +
      '<button data-action="battle"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ 继续挂机升级</button>' +
      '<button data-action="trial"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg> 资源试炼</button>' +
      '<button data-action="market"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 逛市集买装备</button>' +
      '<button data-action="pet"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg> 看看宠物养成</button>' +
      '</div>';

    /* 🔴 2026-09-17：这张卡片以前【没有任何关闭方式】—— 没有 ×、没有 ESC、
     * 点外面也不关，只能从四个选项里挑一个或者刷新页面。现在三条路都给上。 */
    const closeCard = () => {
      card.remove();
      document.removeEventListener('click', onOutsideClick);
    };
    function onOutsideClick(ev) { if (!card.contains(ev.target)) closeCard(); }

    const xBtn = document.createElement('button');
    xBtn.className = 'next-step-close';
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', '关闭');
    xBtn.textContent = '×';
    xBtn.addEventListener('click', closeCard);
    card.appendChild(xBtn);

    document.body.appendChild(card);
    localStorage.setItem('__nextStepShown', '1');
    // 延后一拍再挂「点外面关闭」，否则弹出卡片的那一次点击会立刻把它自己关掉
    setTimeout(() => document.addEventListener('click', onOutsideClick), 0);

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', function () {
        const action = btn.dataset.action;
        closeCard();
        navigateTo(action);
      });
    });
  }

  function navigateTo(action) {
    // 触发侧边栏导航
    const navMap = {
      battle: 'worldmap',
      trial: 'worldmap',
      market: 'market',
      pet: 'pet'
    };
    const target = navMap[action];
    if (!target) return;
    const btn = document.querySelector('.sb-btn[data-page="' + target + '"]');
    if (btn) btn.click();
    // 如果是战斗，额外点一下"开始挂机"
    if (action === 'battle' || action === 'trial') {
      setTimeout(() => {
        const idleBtn = document.querySelector('#nd-idle, [id*="idle"]');
        if (idleBtn && idleBtn.offsetParent) idleBtn.click();
      }, 1500);
    }
  }

  /* ============================================================
   * 7. 进化方向卡片加 class 用于 CSS 动画
   * ============================================================ */
  function initEvolutionCards() {
    const preview = $('evolve-preview');
    if (!preview || !canObserve()) return;
    const obs = new MutationObserver(function () {
      preview.querySelectorAll('[class*="dir"], [class*="choice"], [class*="path"]').forEach(el => {
        el.classList.add('evolve-direction-card');
      });
    });
    obs.observe(preview, { childList: true, subtree: true });
  }


  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    patchBagOpen();
    initCurrencyTooltips();
    initTutorialEndCard();
    initEvolutionCards();
    // 货币 tooltip 延迟再跑一次（等市集内容渲染完）
    setTimeout(initCurrencyTooltips, 2000);
    // 延迟再 patch 一次（等 main.js 加载完 UI 对象）
    setTimeout(patchBagOpen, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
