/* ============================================================
 * 启动加载画面 v3（ui-boot.js）
 * 效果：副题 → 标题逐字 → 英文 → 一排宠物徽章依次登场（左→右）
 *       → 一排排进度格子点亮。
 * 规则（用户拍板 B 方案）：只在「首次进入」或「版本更新」时显示，
 * 同版本再次打开秒进、不打扰。
 *
 * 版本号自动取自 ui-fixes.css 的 ?v= —— 每次改资源升版本，
 * 这里的"新版本"判定自动跟随，无需额外维护。
 * 纯表现层：任何环境异常都静默放行，绝不影响游戏加载。
 * ============================================================ */
(function () {
  try {
    var boot = document.getElementById('boot-screen');
    if (!boot) return;

    var link = document.querySelector('link[href*="ui-fixes.css"]');
    var m = link && (link.getAttribute('href') || '').match(/[?&]v=([\w.-]+)/);
    var ver = m ? m[1] : '';
    var KEY = 'evernight_boot_ver';
    var oldVer = null;
    try { oldVer = localStorage.getItem(KEY); } catch (e) {}

    var firstTime = !oldVer;
    // 同版本再打开 → 秒进
    if (ver && !firstTime && oldVer === ver) { boot.remove(); return; }

    boot.hidden = false;
    var verEl = document.getElementById('boot-ver');
    if (verEl) verEl.textContent = (firstTime ? '初始版本 ' : '已更新至 ') + 'v' + (ver || '?');

    // —— 标题四字逐个弹出（stagger 0.16s）——
    var chars = boot.querySelectorAll('.boot-line--title span');
    for (var c = 0; c < chars.length; c++) {
      chars[c].style.animationDelay = (0.28 + c * 0.16) + 's';
    }

    // —— 一排宠物徽章左→右依次登场（stagger 0.14s）——
    var pets = boot.querySelectorAll('.boot-pet');
    for (var p = 0; p < pets.length; p++) {
      pets[p].style.animationDelay = (1.3 + p * 0.14) + 's';
    }

    // —— 进度条：14 格，一格一格点亮（90ms/格）——
    var bar = document.getElementById('boot-bar');
    if (bar) {
      for (var g = 0; g < 14; g++) {
        var cell = document.createElement('i');
        cell.style.animationDelay = (1.75 + g * 0.09) + 's';
        bar.appendChild(cell);
      }
    }

    var t0 = Date.now();
    var done = function () {
      boot.classList.add('boot-done');
      setTimeout(function () { boot.remove(); }, 520);
      try { localStorage.setItem(KEY, ver || ''); } catch (e) {}
    };
    var finish = function () {
      var el = Date.now() - t0;
      if (el < 2500) setTimeout(done, 2500 - el); else done();
    };
    // 等资源全部加载完再收场（宠物全登场 ≈ 1.3 + 5×0.14 ≈ 2.0s，最少停留 2.5s）
    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish);
    setTimeout(finish, 5500); // 兜底：资源加载卡住也放行
  } catch (e) { /* 纯表现层，静默放行 */ }
})();
