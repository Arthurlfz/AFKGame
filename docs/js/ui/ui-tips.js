/* ui-tips.js — 新功能首次提示
 * 每个提示只弹一次（localStorage 记），不打扰老玩家。
 * 用法：Tips.show('key', '标题', '内容') */
(function () {
  const KEY = 'tip_shown_v1';
  function getShown() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function show(key, title, body) {
    if (typeof localStorage === 'undefined' || typeof showToast !== 'function') return;
    const shown = getShown();
    if (shown[key]) return;
    shown[key] = true;
    try { localStorage.setItem(KEY, JSON.stringify(shown)); } catch (e) {}
    showToast(title, body);
  }
  window.Tips = { show };
})();
