/* ============================================================
 * js/fx/hit-fx.js —— 唯一职责：播「命中·脚底墨爆」这一件表现。
 *
 * 谁调它：`js/ui/ui-battle.js` 的 `showDamage()`（伤害/暴击实际生效那一刻）。
 *   HitFx.play(target)   target = 'pet'（我方宠物被打中）| 'enemy'（敌方怪被打中）
 * 素材：`assets/effects/hit-ink/命中墨爆.png` = 9 帧 × 256 横向帧条（透明底）。
 * 样式（位置/尺寸/层级）在 `css/fx.css` 的 `.hit-fx`——本文件只管"怎么播"。
 *
 * 🔴 两条硬约束（都是踩过的坑，改之前先读）：
 *   1) 必须用 JS 定时器逐帧写 `background-position-x`（像素值），不能交给 CSS animation：
 *      `design-tokens.css` / `market-cascade.css` 里有
 *      `@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;iteration-count:1!important}}`，
 *      开「减少动态效果」的机器上 CSS 动画会被压成静帧（逐帧立绘 2026-09-21 就是这么翻车的，而且那是 *{} + !important，盖不住）。
 *   2) 图片 URL 必须由 JS 写内联 `background-image`：CSS 里的相对 url() 容易按错误目录解析成 404。
 *
 * ⚠️ 本模块【可选加载】：调用方一律写成 `if (window.HitFx) window.HitFx.play(...)`。
 *    原因：约 30 个测试 harness 只加载 ui-battle.js，没有加载本文件；
 *    少了这个判断，那些测试会抛 `HitFx is not defined`（这是项目里既有的可选模块写法）。
 * ============================================================ */
(function () {
  'use strict';

  var SRC = 'assets/effects/hit-ink/命中墨爆.png'; // 相对 docs/
  var FRAMES = 9;

  /* 节奏 = 出手者攻击素材自己的时长（不写死），换素材 / 改 attack.dur 会自动跟着走：
   * 9 帧里第 5~6 帧（≈2/3 处）炸开，正对攻击素材后 3 格的下劈。
   * ⚠️ 兜底 800ms：静态立绘的宠与怪都没有逐帧攻击素材（45ms/帧 = 405ms 太短，用户反馈看不清）。 */
  var DEFAULT_MS = 800;
  var MIN_FRAME_MS = 30; // 极端短素材的防抖下限，别让一帧 <30ms（那样等于闪一下）

  function iconOf(side) {
    return document.getElementById(side === 'pet' ? 'pet-icon' : 'enemy-icon');
  }

  /* 出手者的攻击素材时长（毫秒）；量不到就用兜底值。 */
  function durationMs(side) {
    var icon = iconOf(side);
    var node = icon && icon.querySelector ? icon.querySelector('.pet-anim') : null;
    var anim = (node && window.PetSprites && window.PetSprites.animOf)
      ? window.PetSprites.animOf(node.dataset.petName)
      : null;
    var d = anim && anim.attack && parseFloat(anim.attack.dur);
    return d > 0 ? Math.round(d * 1000) : DEFAULT_MS;
  }

  function play(target) {
    var host = iconOf(target);
    if (!host) return;
    clearInterval(host.__fxT);
    if (host.__fxEl) { host.__fxEl.remove(); host.__fxEl = null; }
    var el = document.createElement('div');
    el.className = 'hit-fx';
    el.style.backgroundImage = 'url("' + SRC + '")';
    el.style.backgroundSize = (FRAMES * 100) + '% 100%';
    host.appendChild(el);
    host.__fxEl = el;
    // 出手者是"被打中者的对面"：打中敌人 ⇒ 我方出手；打中我方 ⇒ 敌方出手
    var frameMs = Math.max(MIN_FRAME_MS, Math.round(durationMs(target === 'pet' ? 'enemy' : 'pet') / FRAMES));
    var k = 0;
    function step() {
      if (!el.isConnected) { clearInterval(host.__fxT); host.__fxEl = null; return; } // 怪下场/切页兜底
      if (k >= FRAMES) { clearInterval(host.__fxT); el.remove(); host.__fxEl = null; return; }
      el.style.backgroundPositionX = (-k * el.clientWidth) + 'px'; // 必须像素：百分比是按整张 9 格帧条算的
      k++;
    }
    step();
    host.__fxT = setInterval(step, frameMs);
  }

  window.HitFx = { play: play };
})();
