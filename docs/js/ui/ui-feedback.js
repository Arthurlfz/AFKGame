/* ============================================================
 * ui/ui-feedback.js —— 玩家反馈入口（2026-09-17）
 *
 * 为什么做：内测最值钱的东西是玩家的抱怨。以前玩家遇到 bug 只能去群里说，
 *   更多人干脆不说 —— 而"不说"是内测最大的损失：他不说，你就永远不知道。
 *
 * 设计：
 *   ① 入口在顶栏（跟背包/任务并列），不藏进设置里 —— 反馈要顺手。
 *   ② 提交时自动带上【当前页面 + 浏览器 + 最近 5 条报错】，
 *      玩家不用自己描述"我在哪、怎么触发的"。
 *   ③ 只写不读：feedback 表的 RLS 只开 insert，玩家看不到也改不了别人（或自己）的反馈，
 *      管理员在开发者面板里看。
 *
 * 依赖：ui-common（$ / UI / showToast）、core/supabase（sendFeedback）
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI || {};
  const $ = id => document.getElementById(id);

  /* 全局报错兜底：收集最近 5 条，提交反馈时一起带上去。
   * 玩家看到的是"游戏白屏了"，我们看到的是那一行 TypeError —— 差别就在这。 */
  const recentErrors = [];
  /* ⚠️ 测试桩（vtest_* 的 vm ctx）里 window / document 不一定有 addEventListener，
   * 裸调用会直接 ReferenceError 把整个模块炸掉（表现为「进程退出码 1」且没有 FAIL 行）。
   * 这里是纯增强功能，缺了就跳过。 */
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', e => {
      try {
        recentErrors.push(String((e && e.message) || '').slice(0, 200)
          + (e && e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
        if (recentErrors.length > 5) recentErrors.shift();
      } catch (_) { /* 收集失败不影响游戏 */ }
    });
    window.addEventListener('unhandledrejection', e => {
      try {
        recentErrors.push('Promise: ' + String((e && e.reason && e.reason.message) || e.reason || '').slice(0, 200));
        if (recentErrors.length > 5) recentErrors.shift();
      } catch (_) { /* 同上 */ }
    });
  }

  let kind = 'bug';
  let built = false;

  function buildModal() {
    if (built || $('fb-modal')) return;
    built = true;
    const box = document.createElement('div');
    box.className = 'modal-mask';
    box.id = 'fb-modal';
    box.style.display = 'none';
    box.innerHTML =
      '<div class="modal">' +
        '<div class="modal-title">✍️ 反馈 / 提意见</div>' +
        '<div class="modal-body">' +
          '<div class="fb-kinds" id="fb-kinds">' +
            '<button class="fb-kind is-on" data-kind="bug">🐛 遇到问题</button>' +
            '<button class="fb-kind" data-kind="idea">💡 有个想法</button>' +
            '<button class="fb-kind" data-kind="other">✍️ 其它</button>' +
          '</div>' +
          '<textarea id="fb-text" class="fb-text" maxlength="2000" ' +
            'placeholder="说说你遇到了什么（越具体越好，比如：在市集点取回没反应）"></textarea>' +
          '<div class="fb-hint">提交时会自动带上：你当前所在的页面、浏览器、以及最近的错误记录 —— 这些不用你写。</div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn-mini ghost" id="fb-cancel">取消</button>' +
          '<button class="btn-mini primary" id="fb-ok">提交</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);

    $('fb-kinds').addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.fb-kind');
      if (!b) return;
      kind = b.dataset.kind || 'bug';
      [...$('fb-kinds').children].forEach(x => x.classList.toggle('is-on', x === b));
    });
    $('fb-cancel').onclick = close;
    box.addEventListener('click', e => { if (e.target === box) close(); });
    $('fb-ok').onclick = submit;
  }

  function open() {
    buildModal();
    const box = $('fb-modal');
    const t = $('fb-text');
    if (t) t.value = '';
    box.style.display = 'flex';
    if (t) setTimeout(() => t.focus(), 50);
  }
  function close() {
    const box = $('fb-modal');
    if (box) box.style.display = 'none';
  }

  function ctxOf() {
    let page = '';
    try {
      const el = document.querySelector('.tab-page.active') || document.querySelector('.page.active');
      page = (el && el.id) || (location.hash || '').replace('#', '');
    } catch (_) { /* 忽略 */ }
    return JSON.stringify({
      page: page,
      ua: (navigator && navigator.userAgent) ? String(navigator.userAgent).slice(0, 300) : '',
      errors: recentErrors.slice()
    });
  }

  async function submit() {
    const t = $('fb-text');
    const text = (t && t.value || '').trim();
    if (!text) { if (UI.showToast) UI.showToast('✍️ 写一句吧', '哪怕一句"这里点不动"也很有用'); if (t) t.focus(); return; }
    if (!window.Supabase || !window.Supabase.sendFeedback) {
      if (UI.showToast) UI.showToast('❌ 提交失败', '网络未就绪，稍后再试');
      return;
    }
    const btn = $('fb-ok');
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    const r = await window.Supabase.sendFeedback(kind, text, ctxOf());
    if (btn) { btn.disabled = false; btn.textContent = '提交'; }
    if (r && r.error) {
      if (UI.showToast) UI.showToast('❌ 提交失败', r.error);
      return;
    }
    close();
    if (UI.showToast) UI.showToast('✅ 收到了，谢谢！', '你的反馈已经记下来了');
  }

  function init() {
    const btn = $('topbar-feedback');
    if (btn) btn.onclick = open;
    // ESC 关掉（与背包/聊天同一套习惯）
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const box = $('fb-modal');
        if (box && box.style.display === 'flex') close();
      });
    }
  }

  UI.openFeedback = open;
  // 同样是防御：桩里 document 可能没有 readyState / addEventListener
  const doc = (typeof document !== 'undefined') ? document : null;
  if (doc && typeof doc.addEventListener === 'function' && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else init();
})();
