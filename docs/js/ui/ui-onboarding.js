/* ============================================================
 * ui-onboarding.js —— 通用 onboarding 引擎（spotlight / hotspot / tour / NPC 气泡）
 * 2026-09-03 新建（新手引导重构 · 目标驱动主线）
 *
 * 设计要点（防回归）：
 *  1. 定位自带 null 防护：target 不存在 / getBoundingClientRect 异常 → try-catch 降级，不崩。
 *     不复用 ui-popover.position()（其当前无防护）。
 *  2. 遮罩一律 pointer-events:none，只压暗不挡点击（沿用 09-02 教训）；
 *     镂空压暗用 box-shadow 0 0 0 9999px 撑暗场，目标元素本身可点。
 *  3. 动效只走 transform/opacity；prefers-reduced-motion 已在 design-tokens 全局关闭。
 *  4. 位置 ticker 仅展示期运行，clear() 后即停，无常驻空转。
 *  5. 引擎不耦合任何引导业务；新手引导只是第一个使用者（世界地图/装备页首次进入可复用）。
 *
 * API:
 *   Onboarding.startTour(steps, { onDone, onSkip })
 *      steps: [{ target, title, npc, cta, npcName, npcTitle }]
 *   Onboarding.spotlight(target, { title, npc, cta, npcName, npcTitle, onNext, dismissable })
 *      → 返回控制器 { next(), skip(), close() }
 *   Onboarding.hotspot(target, { title, npc, npcName, npcTitle, dismissOnAction })
 *      → 返回控制器 { close() }
 *   Onboarding.clear()      —— 关闭当前所有提示
 *   Onboarding.isActive()   —— 是否展示中
 *
 * avatar 传参：npcAvatar 为 string；以 '<' 开头视为 SVG/HTML，否则视为图片 src。
 * ============================================================ */
(function () {
  'use strict';

  const NOOP = function () {};
  const RE_MOTION = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  /* ---------- 内部状态：同一时刻只存在一种引导形态 ---------- */
  let host = null;        // 挂载容器（fixed 全屏层）
  let active = null;      // 当前控制器 { kind, close, next, skip, refresh }
  let rafId = null;       // 位置 ticker

  /* ---------- 极小 DOM 工具 ---------- */
  function mk(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function qs(sel) {
    if (typeof sel === 'string') {
      try { return document.querySelector(sel); } catch (e) { return null; }
    }
    return (sel && sel.nodeType === 1) ? sel : null;
  }
  function rectOf(node) {
    try {
      if (node && typeof node.getBoundingClientRect === 'function') {
        const r = node.getBoundingClientRect();
        if (r && typeof r.left === 'number' && !isNaN(r.left)) return r;
      }
    } catch (e) { /* 忽略定位异常 */ }
    return null;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function getHost() {
    if (!host) {
      host = mk('div', 'ob-host');
      if (document.body) document.body.appendChild(host);
    }
    return host;
  }
  function clearHost() {
    const h = getHost();
    h.innerHTML = '';
  }
  function tickerRun(fn) {
    tickerStop();
    if (!RE_MOTION || !RE_MOTION.matches) { // 即使关闭动效，定位仍需每帧同步
      const loop = function () {
        rafId = null;
        try { if (fn) fn(); } catch (e) { /* 忽略 */ }
        if (active) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }
  }
  function tickerStop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }
  /* target 每帧重新 query：页面切换/DOM 重建后仍能跟随最新元素 */
  function resolveTarget(spec) {
    return qs(spec && spec.sel);
  }

  /* ---------- avatar 渲染 ---------- */
  function avatarHtml(av) {
    if (!av) return '';
    if (typeof av === 'string') {
      return av.charAt(0) === '<' ? av : '<img class="ob-avatar-img" src="' + av + '" alt="">';
    }
    return '';
  }
  function setName(n, fallback) { return n || fallback || '引路人'; }
  function setTitle(t) { return t || ''; }

  /* ---------- 共享：单条气泡内容（NPC 名 / 标题 / 台词） ---------- */
  function bubbleInner(opts) {
    const name = setName(opts.npcName, opts.npcName);
    const role = opts.npcTitle || '';
    const title = opts.title || '';
    const text = opts.npc || opts.text || '';
    return (
      '<div class="ob-bubble">' +
        (role || name
          ? '<div class="ob-bubble-head">' +
              '<span class="ob-bubble-name">' + escapeHtml(name) + '</span>' +
              (role ? '<span class="ob-bubble-role">' + escapeHtml(role) + '</span>' : '') +
            '</div>'
          : '') +
        (title ? '<div class="ob-bubble-title">' + escapeHtml(title) + '</div>' : '') +
        '<div class="ob-bubble-text">' + text + '</div>' +
      '</div>'
    );
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 位置：给一个矩形与气泡元素，找不超屏的落点 ----------
   * prefer: 'bottom'|'top'|'right'|'left'，默认 'bottom'。
   * 返回 { left, top, side }，side 表示箭头指向目标的方向。 */
  function placeNear(rc, w, h, gap, prefer) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safe = 14;
    const p = prefer === true ? 'bottom' : (prefer || 'bottom');
    const fits = {};
    const put = (side, l, t) => {
      fits[side] = { left: clamp(Math.round(l), safe, Math.max(safe, vw - w - safe)), top: clamp(Math.round(t), safe, Math.max(safe, vh - h - safe)), side };
    };
    if (rc.bottom + gap + h <= vh - safe) put('top', rc.left + rc.width / 2 - w / 2, rc.bottom + gap);
    if (rc.top - gap - h >= safe) put('bottom', rc.left + rc.width / 2 - w / 2, rc.top - gap - h);
    if (rc.right + gap + w <= vw - safe) put('left', rc.right + gap, rc.top + rc.height / 2 - h / 2);
    if (rc.left - gap - w >= safe) put('right', rc.left - gap - w, rc.top + rc.height / 2 - h / 2);
    const order = {
      bottom: ['top', 'bottom', 'left', 'right'],
      top:    ['bottom', 'top', 'left', 'right'],
      right:  ['left', 'right', 'bottom', 'top'],
      left:   ['right', 'left', 'bottom', 'top']
    };
    for (const s of (order[p] || order.bottom)) {
      if (fits[s]) return fits[s];
    }
    return fits['top'] || { left: safe, top: safe, side: 'top' };
  }

  /* ============================================================
   * spotlight —— 全屏压暗 + 目标镂空高亮 + 贴边导购气泡
   * ============================================================ */
  function spotlight(target, opts) {
    clear();
    opts = opts || {};
    const spec = { sel: typeof target === 'string' ? target : null, node: typeof target === 'string' ? null : target };
    const h = getHost();
    h.className = 'ob-host';
    h.innerHTML = '';

    const root = mk('div', 'ob-root ob-root--spot');
    root.innerHTML =
      '<div class="ob-veil"></div>' +
      '<div class="ob-hole"></div>' +
      '<div class="ob-float">' +
        '<div class="ob-float-bubble">' + bubbleInner(opts) + '</div>' +
        '<div class="ob-float-actions">' +
          '<button class="ob-btn ob-btn--ghost ob-skip" type="button">' + (opts.dismissable ? '关闭' : '跳过') + '</button>' +
          '<button class="ob-btn ob-btn--gold ob-next" type="button">' + (opts.cta || '下一步') + '</button>' +
        '</div>' +
      '</div>';
    h.appendChild(root);

    const hole = root.querySelector('.ob-hole');
    const float = root.querySelector('.ob-float');
    let warned = false;
    const GAP = 18;

    float.querySelector('.ob-skip').addEventListener('click', function (e) { e.stopPropagation(); doSkip(); });
    float.querySelector('.ob-next').addEventListener('click', function (e) { e.stopPropagation(); doNext(); });

    function refresh() {
      const el = spec.sel ? qs(spec.sel) : spec.node;
      const rc = rectOf(el);
      if (!rc || rc.width < 1 || rc.height < 1) {
        if (!warned) { warned = true; console.warn('[onboarding] spotlight target 不可见/缺失:', spec.sel || target); }
        hole.style.display = 'none';
        float.style.display = 'none';
        return;
      }
      hole.style.display = 'block';
      float.style.display = 'flex';
      hole.style.left = Math.round(rc.left) + 'px';
      hole.style.top = Math.round(rc.top) + 'px';
      hole.style.width = Math.round(rc.width) + 'px';
      hole.style.height = Math.round(rc.height) + 'px';

      const fw = float.offsetWidth || 260;
      const fh = float.offsetHeight || 120;
      const p = placeNear(rc, fw, fh, GAP, 'right');
      float.style.left = p.left + 'px';
      float.style.top = p.top + 'px';
      float.setAttribute('data-side', p.side);
    }
    function doNext() {
      let keep = false;
      if (typeof opts.onNext === 'function') {
        try { keep = opts.onNext() === false; } catch (e) { keep = false; }
      }
      if (!keep) clear();
    }
    function doSkip() {
      if (typeof opts.onSkip === 'function') {
        try { if (opts.onSkip() === false) return; } catch (e) { /* 忽略 */ }
      }
      clear();
    }
    refresh();
    tickerRun(refresh);

    active = { kind: 'spot', close: clear, next: doNext, skip: doSkip, refresh: refresh };
    return { next: doNext, skip: doSkip, close: clear };
  }

  /* ============================================================
   * hotspot —— 目标脉冲光环 + 轻量气泡（不压暗、不打断操作）
   * ============================================================ */
  function hotspot(target, opts) {
    clear();
    opts = opts || {};
    const spec = { sel: typeof target === 'string' ? target : null, node: typeof target === 'string' ? null : target };
    const h = getHost();
    h.className = 'ob-host';
    h.innerHTML = '';

    const root = mk('div', 'ob-root ob-root--hot');
    root.innerHTML =
      '<div class="ob-hot-ring" aria-hidden="true"></div>' +
      '<div class="ob-hot-bubble">' + bubbleInner(opts) + '</div>';
    h.appendChild(root);

    const ring = root.querySelector('.ob-hot-ring');
    const bubble = root.querySelector('.ob-hot-bubble');
    let warned = false;
    const GAP = 12;

    function refresh() {
      const el = spec.sel ? qs(spec.sel) : spec.node;
      const rc = rectOf(el);
      if (!rc || rc.width < 1 || rc.height < 1) {
        if (!warned) { warned = true; console.warn('[onboarding] hotspot target 不可见/缺失:', spec.sel || target); }
        ring.style.display = 'none';
        bubble.style.display = 'none';
        return;
      }
      ring.style.display = 'block';
      bubble.style.display = 'block';
      const pad = 7;
      ring.style.left = Math.round(rc.left - pad) + 'px';
      ring.style.top = Math.round(rc.top - pad) + 'px';
      ring.style.width = Math.round(rc.width + pad * 2) + 'px';
      ring.style.height = Math.round(rc.height + pad * 2) + 'px';

      const bw = bubble.offsetWidth || 260;
      const bh = bubble.offsetHeight || 84;
      const p = placeNear(rc, bw, bh, GAP, true);
      bubble.style.left = p.left + 'px';
      bubble.style.top = p.top + 'px';
      bubble.setAttribute('data-side', p.side);
    }

    // 动作后自动消失（可配 dismissOnAction:false 关闭）
    let removed = false;
    function closeHot() {
      if (removed) return;
      removed = true;
      const el = spec.sel ? qs(spec.sel) : spec.node;
      if (el && opts.dismissOnAction !== false) {
        el.removeEventListener('click', onAction, true);
      }
      clear();
    }
    function onAction() { closeHot(); }

    refresh();
    tickerRun(refresh);

    if (opts.dismissOnAction !== false) {
      const el = spec.sel ? qs(spec.sel) : spec.node;
      if (el) el.addEventListener('click', onAction, true);
    }

    active = { kind: 'hot', close: closeHot, refresh: refresh };
    return { close: closeHot };
  }

  /* ============================================================
   * tour —— 步骤序列（内部用 spotlight 逐帧播放）
   * ============================================================ */
  function startTour(steps, opts) {
    clear();
    opts = opts || {};
    const list = (steps || []).filter(function (s) { return s && (s.target || s.npc); });
    if (!list.length) {
      if (opts.onDone) try { opts.onDone(); } catch (e) { /* 忽略 */ }
      return { next: NOOP, skip: NOOP, close: clear };
    }
    let idx = 0;
    const total = list.length;

    function meta(i) {
      const s = list[i];
      const o = Object.assign({}, s);
      o.onSkip = function () {
        if (opts.onSkip) { try { opts.onSkip(); } catch (e) { /* 忽略 */ } }
        clear();
        return false;
      };
      o.onNext = function () {
        if (idx < total - 1) { idx += 1; render(idx); return false; }
        if (opts.onDone) { try { opts.onDone(); } catch (e) { /* 忽略 */ } }
        return true; // 走 clear
      };
      return o;
    }
    function render(i) {
      const s = list[i];
      // 标题行附带步骤角标 n/N
      const st = mk('div', 'ob-step-dot', '');
      spotlight(s.target, Object.assign(meta(i), {
        title: s.title,
        npc: s.npc,
        cta: s.cta || (i < total - 1 ? '下一步' : '开始'),
        npcName: s.npcName,
        npcTitle: s.npcTitle,
        npcAvatar: s.npcAvatar,
        step: i + 1,
        total: total
      }));
    }
    render(0);
    return { next: NOOP, skip: NOOP, close: clear };
  }

  /* ---------- 清场 ---------- */
  function clear() {
    active = null;
    tickerStop();
    if (host) { host.innerHTML = ''; host.className = 'ob-host'; }
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (active.skip) active.skip();
    }
  }
  function attachKey() { document.addEventListener('keydown', onKey, true); }
  // 状态钩子：spotlight/tour 开始后挂键盘（在 clear 后由上层调用）
  const isActive = function () { return !!active; };

  /* ---------- 对外暴露 ---------- */
  window.Onboarding = {
    startTour: function (steps, opts) { attachKey(); return startTour(steps, opts); },
    spotlight: function (target, opts) { attachKey(); return spotlight(target, opts); },
    hotspot: function (target, opts) { return hotspot(target, opts); },
    clear: clear,
    isActive: isActive
  };
})();
