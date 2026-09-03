/* ============================================================
 * ui/ui-login.js —— LoginPage 全屏登录页组件
 * 职责：
 *  1. 绑定登录表单（邮箱 / 密码 / 登录按钮 / 注册入口）
 *  2. 登录/注册模式切换：默认登录；点「注册」切到注册模式（显示昵称框 + 邀请码框）
 *  3. 注册校验：昵称（可留空，留空系统自动生成）+ 邀请码 + 密码强度（config.auth）
 *  4. 复用 main.js 暴露的 window.Game.onLogin / onSignup
 * 依赖：ui-common（window.UI / $）；main（window.Game）；core/config（window.Config）
 * ============================================================ */
(function () {
  'use strict';

  const UI = (window.UI = window.UI || {});
  function $(id) { return document.getElementById(id); }

  function bindLogin() {
    const email = $('login-email');
    const pwd = $('login-pwd');
    const nickname = $('login-nickname');
    const invite = $('login-invite');
    const btn = $('login-btn');
    const signup = $('login-signup-btn');
    const err = $('login-err');
    if (!email || !pwd || !btn) return;

    // 当前模式：'login' | 'signup'
    let mode = 'login';

    function setBusy(busy) {
      btn.disabled = busy;
      btn.textContent = busy ? (mode === 'signup' ? '注册中…' : '登录中…') : (mode === 'signup' ? '注册' : '登录');
    }
    function setErr(msg) { if (err) err.textContent = msg || ''; }

    // 注册模式：显示昵称框 + 邀请码框；登录模式：都隐藏
    function applyMode() {
      if (nickname) nickname.style.display = mode === 'signup' ? 'block' : 'none';
      if (invite) invite.style.display = mode === 'signup' ? 'block' : 'none';
      btn.textContent = mode === 'signup' ? '注册' : '登录';
      signup.textContent = mode === 'signup' ? '已有账号？去登录' : '没有账号？注册';
      setErr('');
    }

    function switchMode() {
      mode = mode === 'signup' ? 'login' : 'signup';
      applyMode();
    }

    // 密码强度校验（读 config.auth，不满足返回错误文案，满足返回 null）
    function pwdCheck(pw) {
      const a = (window.Config && window.Config.auth) || {};
      const minLen = a.pwdMinLen || 6;
      if (pw.length < minLen) return '密码至少 ' + minLen + ' 位';
      if (a.pwdRequireLetter && !/[A-Za-z]/.test(pw)) return '密码需包含字母';
      if (a.pwdRequireDigit && !/[0-9]/.test(pw)) return '密码需包含数字';
      return null;
    }

    // 昵称校验（读 config.auth.nickname）：留空 = 交给系统自动生成；填了就要够长
    function nickCheck(v) {
      const n = (window.Config && window.Config.auth && window.Config.auth.nickname) || {};
      const minLen = n.minLen || 2;
      const maxLen = n.maxLen || 12;
      const s = (v || '').trim();
      if (!s) return null;
      if (s.length < minLen) return '昵称至少 ' + minLen + ' 个字';
      if (s.length > maxLen) return '昵称最多 ' + maxLen + ' 个字';
      return null;
    }

    // 邀请码校验（读 config.auth.inviteCodes）
    function inviteCheck(code) {
      const codes = (window.Config && window.Config.auth && window.Config.auth.inviteCodes) || [];
      if (!codes.length) return null; // 未配置邀请码 = 关闭限制
      const trimmed = (code || '').trim();
      if (!trimmed) return '请输入邀请码';
      if (!codes.includes(trimmed)) return '邀请码无效';
      return null;
    }

    const doLogin = async () => {
      if (btn.disabled) return;
      setBusy(true);
      setErr('');
      try {
        const result = await window.Game.onLogin(email.value.trim(), pwd.value);
        if (result && result.error) setErr(result.error.message || '登录失败，请检查邮箱和密码');
      } catch (e) {
        setErr(e.message || '登录失败，请稍后重试');
      } finally {
        setBusy(false);
      }
    };

    const doSignup = async () => {
      if (btn.disabled) return;
      setErr('');

      // 昵称校验（留空 = 系统自动生成，填了才校验长度）
      const nErr = nickCheck(nickname && nickname.value);
      if (nErr) { setErr(nErr); if (nickname) nickname.focus(); return; }

      // 再校验邀请码（config 未配置邀请码则跳过）
      const iErr = inviteCheck(invite && invite.value);
      if (iErr) { setErr(iErr); if (invite) invite.focus(); return; }

      // 最后校验密码强度
      const pErr = pwdCheck(pwd.value);
      if (pErr) { setErr(pErr); return; }

      setBusy(true);
      try {
        const result = await window.Game.onSignup(email.value.trim(), pwd.value, (nickname && nickname.value || '').trim());
        if (result && result.error) setErr(result.error.message || '注册失败，请稍后重试');
      } catch (e) {
        setErr(e.message || '注册失败，请稍后重试');
      } finally {
        setBusy(false);
      }
    };

    btn.onclick = () => (mode === 'signup' ? doSignup() : doLogin());
    if (signup) signup.onclick = switchMode;
    const onEnter = (e) => { if (e.key === 'Enter') (mode === 'signup' ? doSignup() : doLogin()); };
    email.addEventListener('keydown', onEnter);
    pwd.addEventListener('keydown', onEnter);
    if (nickname) nickname.addEventListener('keydown', onEnter);
    if (invite) invite.addEventListener('keydown', onEnter);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', bindLogin);
  }

  /* ---------- 对外 API ---------- */
  UI.bindLogin = bindLogin;
})();
