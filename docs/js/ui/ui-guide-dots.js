/* ============================================================
 * ui/ui-guide-dots.js —— 「红点」指路（2026-09-16）
 * 职责：有事可做的入口自动亮红点（侧边栏页签 / 宠物页 tab），并按业界通用规则处理：
 *   ① 三种表现：小红点（1 件）· 数字（≥2 件）· 无（0 件）
 *   ② 往上汇总：子级有 N 件 → 父级入口也 +N（不点进去也知道里面有事）
 *   ③ 点开就消：人已经在这一页了，这页的入口就不亮（门已经打开）
 *
 * 为什么要它：玩家反馈「引导文字太多读不下去，想要那种哪里需要就有红点的」。
 *   红点用**位置**代替说明；点进去之后具体怎么做，仍然写在任务面板 / 引导条里。
 *
 * 不负责：任务数据（quest.js）、跳转（ui-quest.js 的 goGuide）、引导条本身（ui-quest.js）。
 *
 * 数据来源（全项目各一份，这里只消费不复制）：
 *   · 引导链当前步：Quest.getGuideQuest().guide（config 里配好的 {page, tab, btn}）
 *   · 可提交的普通任务：Quest.getQuests() 里 done 的项，入口用 UI.guideOf(q) 推
 *
 * 刷新时机：由 ui-common 的 renderAll() 统一调用（与任务面板同批），自己不轮询。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const FLAG = 'data-guide-dot';

  /* 页面 id → 侧边栏按钮：战斗页不在侧边栏（要从世界地图进），
   * 所以「去挂机」这类引导的红点应该点在「世界地图」上，否则无处可亮。 */
  const PAGE_TO_SIDEBAR = { battle: 'worldmap', fight: 'worldmap' };
  /* 红点树（父子）：宠物页的子标签有事，要汇总到侧边栏「宠物资料」上。
   * 以后加了新子页签，在这里登记一行即可。 */
  const CHILD_PAGE = { evolve: 'pet', synth: 'pet', merge: 'pet', awaken: 'pet' };

  function targets() {
    const pages = Object.create(null);
    const tabs = Object.create(null);

    // 只记**最细的一层**：有子标签就只记子标签，父级靠下面的汇总得出
    // （两边都记的话，父级会被算两次，数字会虚高）
    function add(g) {
      if (!g) return;
      if (g.tab) { tabs[g.tab] = (tabs[g.tab] || 0) + 1; return; }
      const p = g.page ? (PAGE_TO_SIDEBAR[g.page] || g.page) : null;
      if (p) pages[p] = (pages[p] || 0) + 1;
    }

    const Quest = window.Quest;
    if (!Quest) return { pages, tabs };
    // 任务层任何异常都不许拖垮红点（它只是提示，不是主流程）
    try {
      const g = Quest.getGuideQuest ? Quest.getGuideQuest() : null;
      // 引导任务：没做完 → 红点亮在操作页；做完了待交 → 红点亮在任务按钮
      if (g && g.guide) {
        if (g.done) {
          pages['quest'] = (pages['quest'] || 0) + 1;
        } else {
          add(g.guide);
        }
      }
      const list = (Quest.getQuests ? Quest.getQuests() : []) || [];
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (!q || q.finished || q.unlocked === false) continue;
        // 已达成、可提交 → 红点亮在任务按钮（去交任务），不是操作页
        if (q.done) {
          pages['quest'] = (pages['quest'] || 0) + 1;
        }
      }
    } catch (e) { /* 忽略 */ }

    // 往上汇总：子标签有 N 件 → 父级入口也 +N
    Object.keys(tabs).forEach(t => {
      const p = CHILD_PAGE[t];
      if (p) pages[p] = (pages[p] || 0) + tabs[t];
    });
    return { pages, tabs };
  }

  /* 给一批元素贴/摘标记。skipActive=true 时：当前选中（正在看）的那个不亮 —— 点开就消。
   * 值就是件数：1 = 小红点，≥2 = 数字（样式在 app.css 里按值区分）。 */
  function paint(selector, keyName, map, skipActive) {
    if (!document.querySelectorAll) return;
    let nodes = null;
    try { nodes = document.querySelectorAll(selector); } catch (e) { return; }
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      // 能力判断：本项目测试用的是薄 DOM 桩，不是每个元素都有完整 API
      if (typeof el.getAttribute !== 'function' || typeof el.setAttribute !== 'function' || typeof el.removeAttribute !== 'function') continue;
      if (skipActive && el.classList && typeof el.classList.contains === 'function' && el.classList.contains('active')) {
        el.removeAttribute(FLAG); // 人已经在这一页了，门上的红点不再亮
        continue;
      }
      const key = el.getAttribute(keyName);
      if (!key) continue;
      const n = map[key] || 0;
      if (n > 0) el.setAttribute(FLAG, String(n));
      else el.removeAttribute(FLAG);
    }
  }

  function refreshGuideDots() {
    const t = targets();
    paint('.sb-btn[data-page], .topbar-btn[data-page]', 'data-page', t.pages, true);
    paint('.pet-tab[data-pet-tab]', 'data-pet-tab', t.tabs, true);
  }

  UI.refreshGuideDots = refreshGuideDots;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', refreshGuideDots);
  }
})();
