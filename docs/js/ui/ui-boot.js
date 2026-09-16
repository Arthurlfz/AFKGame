/* ============================================================
 * 启动加载画面（ui-boot.js）
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

    var t0 = Date.now();
    var done = function () {
      boot.classList.add('boot-done');
      setTimeout(function () { boot.remove(); }, 520);
      try { localStorage.setItem(KEY, ver || ''); } catch (e) {}
    };
    var finish = function () {
      var el = Date.now() - t0;
      if (el < 1150) setTimeout(done, 1150 - el); else done();
    };
    // 等资源全部加载完再收场（进度条时长 = max(加载耗时, 1.15s)）
    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish);
    setTimeout(finish, 4500); // 兜底：资源加载卡住也放行
  } catch (e) { /* 纯表现层，静默放行 */ }
})();
