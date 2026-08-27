/* ============================================================
 * debug-grid.js —— 战斗舞台边界/坐标调试工具（临时）
 * 用法：在 游戏.html 末尾临时引入，或控制台执行。
 * 作用：
 *  1. 在 .battle-stage 上叠加半透明网格 + 边界框
 *  2. 鼠标移动时实时显示坐标（相对舞台左上角）
 *  3. 显示舞台四角坐标 + 宽高
 * 用完后从游戏移除本文件。
 * ============================================================ */
(function () {
  'use strict';

  function findStage() {
    return document.querySelector('#tab-battle .battle-stage');
  }

  function init() {
    const stage = findStage();
    if (!stage) { console.warn('[debug-grid] 未找到 .battle-stage'); return; }

    // 叠加层容器（绝对定位盖住舞台，不拦截交互：pointer-events:none）
    let ov = document.getElementById('debug-grid-overlay');
    if (ov) { ov.remove(); }
    ov = document.createElement('div');
    ov.id = 'debug-grid-overlay';
    ov.style.cssText =
      'position:absolute;inset:0;z-index:9999;pointer-events:none;' +
      'background-image:repeating-linear-gradient(0deg,rgba(255,120,90,.10) 0 1px,transparent 1px 100px),' +
      'repeating-linear-gradient(90deg,rgba(120,140,255,.10) 0 1px,transparent 1px 100px),' +
      'repeating-linear-gradient(0deg,rgba(255,120,90,.06) 0 1px,transparent 1px 20px),' +
      'repeating-linear-gradient(90deg,rgba(120,140,255,.06) 0 1px,transparent 1px 20px);';
    stage.appendChild(ov);

    // 坐标读数标签
    const tag = document.createElement('div');
    tag.id = 'debug-grid-coord';
    tag.style.cssText =
      'position:fixed;z-index:10000;background:rgba(0,0,0,.8);color:#0f0;' +
      'font:12px/1.4 monospace;padding:6px 10px;border:1px solid #0f0;border-radius:3px;' +
      'top:8px;left:8px;pointer-events:none;white-space:pre;';
    document.body.appendChild(tag);

    function update() {
      const r = stage.getBoundingClientRect();
      const css = getComputedStyle(stage);
      tag.textContent =
        '舞台宽高: ' + Math.round(r.width) + ' × ' + Math.round(r.height) + 'px\n' +
        '舞台左上: (' + Math.round(r.left) + ', ' + Math.round(r.top) + ')\n' +
        '舞台右下: (' + Math.round(r.right) + ', ' + Math.round(r.bottom) + ')\n' +
        '鼠标: (鼠标放到舞台上查看坐标)\n' +
        '当前地图 data-area-id: ' + (stage.getAttribute('data-area-id') || '无');
    }

    document.addEventListener('mousemove', function (e) {
      const r = stage.getBoundingClientRect();
      const x = Math.round(e.clientX - r.left);
      const y = Math.round(e.clientY - r.top);
      // 只在舞台内才更新坐标行
      if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) {
        const lines = tag.textContent.split('\n');
        lines[3] = '鼠标: (' + x + ', ' + y + ')  ← 相对舞台左上角';
        tag.textContent = lines.join('\n');
      }
    });

    update();
    window.addEventListener('resize', update);
    console.log('[debug-grid] 已启用。舞台边界+坐标显示中，拖动物品/宠物看位置。');
  }

  // 战斗 tab 切换时舞台可能重建，轮询重挂
  let timer = null;
  function watch() {
    if (timer) return;
    timer = setInterval(function () {
      const stage = findStage();
      if (stage && !stage.querySelector('#debug-grid-overlay')) init();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }

  window.DebugGrid = { init: init, stop: function () { if (timer) { clearInterval(timer); timer = null; } } };
})();
