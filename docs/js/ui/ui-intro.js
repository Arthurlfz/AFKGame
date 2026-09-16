/* ============================================================
 * ui/ui-intro.js —— 片头（Remotion 渲染的 mp4）
 * 职责：
 *  1. 首次进入时，在登录页上覆盖播一遍片头（docs/assets/video/opening.mp4）
 *  2. 播完 / 点「跳过片头」/ 出错 / 超时 → 淡出移除，写入「看过」标记
 * 不负责：视频内容（在 video/ 工程里用 Remotion 生成、渲染后拷进来）。
 * 为什么挂在登录页：未登录才需要仪式感；已登录直接进游戏，不该被拦 8 秒。
 *
 * 🔴 防御式约定（2026-09-15 踩过）：本项目测试用**薄 DOM 桩**，桩里没有
 * `getComputedStyle` / `closest` / `firstChild` 这类 API，直接调用会让
 * 十几个测试集体变红（症状像"把项目改坏了"）。所以：
 *   ① 每个 DOM 能力先 typeof 判断；② 整段再包一层 try/catch ——
 * 片头是锦上添花，**任何异常都不许影响进游戏**。
 * ============================================================ */
(function () {
  'use strict';

  const SEEN_KEY = 'fof_intro_seen';   // 看过就不再播（免得每次登录都等 8 秒）
  // 兜底：视频卡住/加载慢也要让玩家进得去。
  // ⚠️ 2026-09-16 从 12s 降到 9s：片头是全屏覆盖层，它多留一秒，玩家就多一秒点不到登录/注册。
  const MAX_MS = 9000;

  function byId(id) {
    return (typeof document.getElementById === 'function') ? document.getElementById(id) : null;
  }
  function hasFn(obj, name) {
    return !!obj && typeof obj[name] === 'function';
  }
  function seenBefore() {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 隐私模式写不了，忽略 */ }
  }
  // 登录页当前是否可见：优先问计算样式（真浏览器），拿不到就退回 hidden 属性（桩/异常）
  function isScreenHidden(el) {
    if (!el) return false;
    if (typeof window.getComputedStyle === 'function') {
      try { return window.getComputedStyle(el).display === 'none'; } catch (e) { /* 落到下面 */ }
    }
    return el.hidden === true;
  }

  function start() {
    const intro = byId('login-intro');
    const video = byId('login-intro-video');
    const skipBtn = byId('login-intro-skip');
    const screen = byId('login-screen');
    if (!intro || !video) return;

    let done = false;
    let timer = null;
    function removeIntro() {
      if (!intro.parentNode) return;
      if (hasFn(intro.classList, 'add')) intro.classList.add('is-out');
      window.setTimeout(function () {
        if (intro.parentNode) intro.parentNode.removeChild(intro);
      }, 420);
    }
    function finish() {
      if (done) return;
      done = true;
      if (timer) window.clearTimeout(timer);
      markSeen();
      removeIntro();
    }

    if (seenBefore()) { removeIntro(); return; }
    if (isScreenHidden(screen)) { removeIntro(); return; }

    intro.hidden = false;
    /* 点片头任意处都能跳过（2026-09-16）：这层是铺满全屏的覆盖层，
     * 只要它还在这儿，玩家就**点不到下面的登录 / 注册**。原来只有右下角一个小按钮能跳过，
     * 玩家不知道要点那儿 → 表现为"点注册没反应"。整个层都可点，随手一点就进。 */
    if (hasFn(intro, 'addEventListener')) intro.addEventListener('click', finish);
    if (hasFn(skipBtn, 'addEventListener')) skipBtn.addEventListener('click', finish);
    if (hasFn(video, 'addEventListener')) {
      video.addEventListener('ended', finish);
      video.addEventListener('error', finish);   // 视频缺失/解码失败：别把玩家卡在这层
    }
    timer = window.setTimeout(finish, MAX_MS);

    if (hasFn(video, 'play')) {
      try {
        const p = video.play();
        // 自动播放被拦（有声音策略 / 省电模式）→ 直接跳过，不挡进入
        if (p && typeof p.catch === 'function') p.catch(finish);
      } catch (e) { finish(); }
    } else {
      finish();
    }
  }

  function boot() {
    // 片头永远只是"能播就播"：任何异常都吞掉，绝不影响进游戏与测试
    try { window.setTimeout(start, 120); } catch (e) { /* 忽略 */ }
  }

  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
