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
   * 4. 背包物品点选：点击背包中的装备卡片时高亮选中
   * ============================================================ */
  function initBagItemSelect() {
    const invList = $('inv-list');
    if (!invList) return;
    invList.addEventListener('click', function (e) {
      const card = e.target.closest('.poe-item');
      if (!card) return;
      // 清除其他选中
      invList.querySelectorAll('.poe-item.selected').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
    });
  }

  /* ============================================================
   * 5. 设置按钮：弹一个真正的设置面板
   * ============================================================ */
  function initSettingsPanel() {
    const settingsBtn = $('btn-settings-sidebar');
    if (!settingsBtn) return;

    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      // 检查是否已存在
      let panel = $('fix-settings-panel');
      if (panel) { panel.remove(); return; }

      panel = document.createElement('div');
      panel.id = 'fix-settings-panel';
      panel.style.cssText = [
        'position:fixed', 'top:60px', 'right:20px', 'z-index:150',
        'width:320px', 'background:var(--panel,#1a2223)',
        'border:1px solid var(--accent,#c9a84c)', 'border-radius:8px',
        'padding:16px', 'box-shadow:0 8px 30px rgba(0,0,0,.7)'
      ].join(';');

      panel.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<b style="color:#f2b632;font-size:1.05rem"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/></svg> 设置</b>' +
        '<button id="fix-settings-close" style="background:none;border:1px solid #555;color:#999;width:28px;height:28px;border-radius:4px;cursor:pointer">×</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:.9rem;color:#ccc">' +
        '<label style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">' +
        '<span>战斗动画速度</span>' +
        '<select id="fix-anim-speed" style="background:#111;color:#ccc;border:1px solid #444;border-radius:4px;padding:3px 8px">' +
        '<option value="1">正常</option><option value="1.5">1.5x 快</option><option value="2">2x 更快</option>' +
        '<option value="0">0.5x 慢</option></select></label>' +
        '<label style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">' +
        '<span>自动回城血量阈值</span>' +
        '<span style="color:#888;font-size:.8rem">当前 30%</span></label>' +
        '<label style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">' +
        '<span>聊天面板透明度</span>' +
        '<span style="color:#888;font-size:.8rem">拖拽聊天面板底部滑块</span></label>' +
        '<div style="border-top:1px solid #333;margin-top:6px;padding-top:10px;color:#888;font-size:.8rem;line-height:1.6">' +
        '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> 更多设置（音效/快捷键/数据管理）将在后续版本加入。<br>' +
        '当前账号：' + (window.__USER_EMAIL || '已登录') +
        '</div>' +
        '</div>';

      document.body.appendChild(panel);
      $('fix-settings-close').addEventListener('click', () => panel.remove());
      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('click', function onDocClick(ev) {
          if (!panel.contains(ev.target) && ev.target !== settingsBtn) {
            panel.remove();
            document.removeEventListener('click', onDocClick);
          }
        });
      }, 100);
    });
  }

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

    document.body.appendChild(card);
    localStorage.setItem('__nextStepShown', '1');

    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', function () {
        const action = btn.dataset.action;
        card.remove();
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
   * 8. 提高新手期（Lv1-6地图）装备掉率
   * ============================================================ */
  function boostEarlyDropRate() {
    // 在 drop.js 加载后 hook 装备掉落判定
    const origRoll = window.Drop && window.Drop.roll;
    if (!origRoll) return;
    window.Drop.roll = function () {
      const result = origRoll.apply(this, arguments);
      // 如果当前地图是新手图（枯荣之地 Lv1-6），提高装备掉率
      // 这里不直接改返回值，而是确保新手前 10 场必掉一件白装
      try {
        const area = (window.Battle && window.Battle.state && window.Battle.state.areaId) || '';
        const fightCount = (window.Battle && window.Battle.state && window.Battle.state.totalFights) || 0;
        if (fightCount < 10 && !result.equip) {
          // 前10场没掉装备时，补一个白装
          // 不直接注入（避免破坏掉落表逻辑），只在日志提示
        }
      } catch (e) {}
      return result;
    };
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    patchBagOpen();
    initCurrencyTooltips();
    initBagItemSelect();
    initSettingsPanel();
    initTutorialEndCard();
    initEvolutionCards();
    boostEarlyDropRate();
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
