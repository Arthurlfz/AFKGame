/* ============================================================
 * ui/ui-popover.js —— 锚定按钮的 Popover 气泡浮层组件
 * 用途：点击齿轮（设置）等按钮弹出内容面板
 * 特点（按需求）：
 *  1. 气泡在按钮【右上方】弹出，尖角箭头指向按钮
 *  2. 点击页面其他空白区域关闭浮层
 *  3. 自动避让：不超出可视屏幕范围（上方空间不足 → 移到下方，水平方向 clamp）
 *  4. 仅点击触发，不是 hover 悬浮触发
 * 用法：UI.openPopover({ anchor, html, onClick?(e) }) / UI.closePopover()
 * 依赖：ui-common（window.UI / $）；HTML 容器 #popover-box 在游戏.html
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});
  function $(id) { return document.getElementById(id); }

  let currentAnchor = null; // 当前锚点元素（点击同一按钮 → 切换关闭）

  /* ---------- 定位：右上方（anchor 正上方偏右），防超屏 ---------- */
  function position(box, anchor) {
    const rect = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // 隐藏状态下测量尺寸（内容已渲染）；注意：测量用的 display:block 是内联样式，
    // 测完必须清空（box.style.display=''），否则会压过 .popover-box 的 display:none，
    // 导致 closePopover 移除 .show 后气泡仍然可见（Bug：Popover 不会消失）
    box.style.visibility = 'hidden';
    box.style.display = 'block';
    const bw = box.offsetWidth || 240;
    const bh = box.offsetHeight || 120;
    let top = rect.top - bh - 8;          // 气泡底边在按钮上方 8px
    let cls = 'arrow-down';               // 气泡在上方 → 箭头朝下指向按钮
    if (top < 8) { top = rect.bottom + 8; cls = 'arrow-up'; } // 上方放不下 → 移到按钮下方，箭头朝上
    top = Math.max(8, top);
    // 右上方：气泡右边缘对齐按钮右侧附近（略向左让出箭头空间）
    let left = rect.right - bw + 12;
    left = Math.max(8, Math.min(left, vw - bw - 8)); // 水平方向 clamp 进视口
    // 箭头水平位置对准按钮中心（clamp 在气泡内）
    const arrow = box.querySelector('.popover-arrow');
    if (arrow) {
      const ax = Math.max(12, Math.min(rect.left + rect.width / 2 - left, bw - 24));
      arrow.style.left = ax + 'px';
    }
    box.className = 'popover-box show ' + cls;
    box.style.top = top + 'px';
    box.style.left = left + 'px';
    box.style.display = ''; // 清空内联 display：显隐交给 .show 类（display:none 时才能隐藏）
    box.style.visibility = 'visible';
  }

  /* ---------- 打开 / 关闭 ---------- */
  function openPopover(opt) {
    const box = $('popover-box');
    const content = $('popover-content');
    if (!box || !content || !opt || !opt.anchor) return;
    // 点击同一锚点 → 切换关闭
    if (box.classList.contains('show') && opt.anchor === currentAnchor) {
      closePopover();
      return;
    }
    currentAnchor = opt.anchor;
    content.innerHTML = opt.html || '';
    if (opt.onClick) content.onclick = opt.onClick;
    position(box, opt.anchor);
  }
  function closePopover() {
    const box = $('popover-box');
    if (box) box.classList.remove('show');
    currentAnchor = null;
  }

  /* ---------- 关闭交互（仅点击触发，无 hover） ----------
   * 用 pointerdown 而非 click：气泡打开后会盖住按钮附近区域（点击"按钮"实际点进气泡），
   * 且 click 在 mousedown/mouseup 目标不一致时会丢失 —— pointerdown 阶段处理保证必关。
   * 规则：
   *  - 点气泡内部：交互元素（按钮等）不关（交给内容 onClick）；其余空白区域一律关闭
   *  - 点锚点按钮：不关，由按钮 onclick 的 openPopover toggle 处理（再点一次关闭）
   *  - 点其他任意位置：关闭
   *  - 兜底：Esc 键 / 页面滚动也关闭
   */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', (e) => {
      const box = $('popover-box');
      if (!box || !box.classList.contains('show')) return;
      const t = e.target;
      if (!t || !t.closest) { closePopover(); return; } // 文本/非元素节点 → 直接关
      if (t.closest('#popover-box')) {
        // 气泡内部：点交互元素（登出按钮等）不关，由内容 onClick 处理；其余空白关闭
        if (t.closest('button, a, input, select, [data-keep-open]')) return;
        closePopover();
        return;
      }
      if (currentAnchor && currentAnchor.contains && currentAnchor.contains(t)) return; // 锚点由按钮 toggle
      closePopover();
    });
    // 兜底：Esc 关闭；页面滚动时浮层位置可能错位，一并关闭
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('scroll', () => closePopover(), true);
    }
  }

  /* ---------- 对外 API ---------- */
  UI.openPopover = openPopover;
  UI.closePopover = closePopover;
})();
