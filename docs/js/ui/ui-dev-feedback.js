/* ============================================================
 * ui/ui-dev-feedback.js —— 开发者面板 · 玩家反馈（2026-09-17）
 *
 * 管理员看玩家反馈的地方。反馈表只开 insert（玩家写不读），
 * 这里是唯一的读取路径 —— 走 admin_list_feedback RPC（服务端校验管理员邮箱）。
 *
 * 依赖：ui-dev（DevPanel.registerTab）、core/supabase（listFeedback）
 * ============================================================ */
(function () {
  'use strict';
  const DP = window.DevPanel;
  if (!DP) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const KIND_LABEL = { bug: '🐛 问题', idea: '💡 想法', other: '✍️ 其它' };

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ctx 是提交时自动带的 JSON（页面 / 浏览器 / 最近报错），折叠显示，别糊一屏
  function ctxLine(ctx) {
    let o = null;
    try { o = JSON.parse(ctx || '{}'); } catch (_) { return esc(ctx || ''); }
    const bits = [];
    if (o.page) bits.push('页面 ' + esc(o.page));
    if (o.errors && o.errors.length) bits.push('报错 ' + o.errors.length + ' 条');
    return bits.join(' · ') + (o.errors && o.errors.length
      ? '<div class="fb-err">' + o.errors.map(esc).join('<br>') + '</div>' : '');
  }

  async function render(host) {
    host.innerHTML = '<div class="dev-hint">正在读取玩家反馈…</div>';
    if (!window.Supabase || !window.Supabase.listFeedback) {
      host.innerHTML = '<div class="dev-hint">反馈功能未就绪（Supabase.listFeedback 不存在）</div>';
      return;
    }
    const { data, error } = await window.Supabase.listFeedback(100);
    if (error) {
      host.innerHTML = '<div class="dev-hint">读取失败：' + esc(error.message || '')
        + '<br>（非管理员会被服务端挡下：ERR_NOT_ADMIN）</div>';
      return;
    }
    const rows = data || [];
    if (!rows.length) {
      host.innerHTML = '<div class="dev-hint">还没有玩家提交过反馈。</div>';
      return;
    }
    host.innerHTML =
      '<div class="dev-hint">共 ' + rows.length + ' 条（最新在前）</div>'
      + rows.map(function (r) {
          return '<div class="fb-row">'
            + '<div class="fb-row-head"><b>' + esc(KIND_LABEL[r.kind] || r.kind) + '</b>'
            + '<span class="fb-who">' + esc(r.nickname || r.email || '匿名') + '</span>'
            + '<span class="fb-time">' + fmtTime(r.created_at) + '</span></div>'
            + '<div class="fb-body">' + esc(r.body) + '</div>'
            + (r.ctx ? '<div class="fb-ctx">' + ctxLine(r.ctx) + '</div>' : '')
            + '</div>';
        }).join('');
  }

  DP.registerTab('fb', { render: render });
})();
