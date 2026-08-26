/* ============================================================
 * ui/ui-login.js —— LoginPage 全屏登录页组件
 * 职责：
 *  1. 绑定登录表单（邮箱 / 密码 / 登录按钮 / 注册入口）
 *  2. 登录/注册流程复用 main.js 暴露的 window.Game.onLogin / onSignup（不改业务逻辑）
 *  3. 登录按钮防连点；回车提交；登录成功后由 onAuthChange 自动切入主界面
 * 依赖：ui-common（window.UI / $）；main（window.Game，DOMContentLoaded 时已就绪）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});
  function $(id) { return document.getElementById(id); }

  function bindLogin() {
    const email = $('login-email');
    const pwd = $('login-pwd');
    const btn = $('login-btn');
    const signup = $('login-signup-btn');
    const err = $('login-err');
    if (!email || !pwd || !btn) return;

    const setBusy = (busy) => {
      btn.disabled = busy;
      btn.textContent = busy ? '登录中…' : '登录';
    };
    const doLogin = async () => {
      if (btn.disabled) return;
      setBusy(true);
      if (err) err.textContent = '';
      try {
        // 复用现有登录流程（main.js onLogin：Supabase.signIn + 云端恢复）
        const result = await window.Game.onLogin(email.value.trim(), pwd.value);
        if (result && result.error && err) err.textContent = result.error.message || '登录失败，请检查邮箱和密码';
      } catch (e) {
        if (err) err.textContent = e.message || '登录失败，请稍后重试';
      } finally {
        setBusy(false);
      }
    };
    const doSignup = async () => {
      if (btn.disabled) return;
      setBusy(true);
      if (err) err.textContent = '';
      try {
        const result = await window.Game.onSignup(email.value.trim(), pwd.value);
        if (result && result.error && err) err.textContent = result.error.message || '注册失败，请稍后重试';
      } catch (e) {
        if (err) err.textContent = e.message || '注册失败，请稍后重试';
      } finally {
        setBusy(false);
      }
    };

    btn.onclick = doLogin;
    if (signup) signup.onclick = doSignup;
    // 回车提交（注册在登录页用回车 = 登录）
    const onEnter = (e) => { if (e.key === 'Enter') doLogin(); };
    email.addEventListener('keydown', onEnter);
    pwd.addEventListener('keydown', onEnter);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', bindLogin);
  }

  /* ---------- 对外 API ---------- */
  UI.bindLogin = bindLogin;
})();
