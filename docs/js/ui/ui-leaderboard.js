/* ui-leaderboard.js — 排行榜（成长榜 + 通天塔榜）
 * 成长榜：查 pets，每人取成长最高那只，前 50，join profiles 拿昵称（2026-09-20 并行会话实现）。
 * 塔榜：查 profiles 的 tower_best_floor / tower_best_corrosion，前 50（任务单 08，2026-09-20 加）。
 * ⭐ 纯查询，不建表、不改数据。两个榜共用同一套行样式与"自己高亮"逻辑。 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  let tab = 'growth';   // 'growth' | 'tower'（记住玩家上次看的那个）
  /* 榜上这些人戴的名牌：uid → key。渲染榜之前**一次取回**（最多 50 个 uid），
   * 绝不逐条请求 —— getCurrentUser 单次 550ms 的教训。拿不到就当没名牌。 */
  let lbTags = {};

  /* 名字 + 名牌统一走 UI.nameTag（它负责转义），没名牌时退回普通名字。 */
  function nameHtml(r) {
    return (window.UI && window.UI.nameTag) ? window.UI.nameTag(r.name, lbTags[r.uid]) : escapeHtml(r.name);
  }

  async function myId() {
    try {
      const s = window.Supabase && window.Supabase.getSession ? await window.Supabase.getSession() : null;
      return s && s.user && s.user.id;
    } catch (e) { return null; }
  }
  async function client() {
    return (window.Supabase && window.Supabase.getClient) ? window.Supabase.getClient() : null;
  }

  /* ---------- 成长榜 ---------- */
  async function growthRows() {
    const c = await client();
    if (!c) return { rows: [], err: '未登录' };
    const { data: pets, error } = await c.from('pets').select('user_id, growth, level, name')
      .order('growth', { ascending: false }).limit(300);
    if (error) throw error;
    const best = {};
    for (const p of (pets || [])) {
      if (!p.user_id) continue;
      if (!best[p.user_id] || (p.growth || 0) > (best[p.user_id].growth || 0)) best[p.user_id] = p;
    }
    const ranked = Object.values(best).sort((a, b) => (b.growth || 0) - (a.growth || 0)).slice(0, 50);
    const uids = ranked.map(p => p.user_id);
    const { data: profs } = await c.from('profiles').select('id, nickname').in('id', uids);
    const nm = {}; for (const pr of (profs || [])) nm[pr.id] = pr.nickname || '匿名';
    return {
      rows: ranked.map(p => ({
        uid: p.user_id, name: nm[p.user_id] || '玩家',
        main: (p.growth || 0).toFixed(1), mainLabel: '成长', sub: (p.name || '') + ' Lv.' + (p.level || 1)
      }))
    };
  }

  /* ---------- 塔榜（任务单 08）---------- */
  async function towerRows() {
    const c = await client();
    if (!c) return { rows: [], err: '未登录' };
    const { data, error } = await c.from('profiles')
      .select('id, nickname, tower_best_floor, tower_best_corrosion')
      .order('tower_best_floor', { ascending: false })
      .order('tower_best_corrosion', { ascending: false })
      .limit(50);
    if (error) throw error;
    return {
      rows: (data || []).map(p => ({
        uid: p.id, name: p.nickname || '匿名',
        main: String(Number(p.tower_best_floor || 0)), mainLabel: '层',
        sub: '最高腐蚀 ' + Number(p.tower_best_corrosion || 0)
      }))
    };
  }

  function medal(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '<span class="lb-num">' + rank + '</span>';
  }

  function paint(body, rows, my) {
    if (!rows.length) { body.innerHTML = '<div class="lb-empty">暂无数据</div>'; return; }
    let html = '';
    let myRank = -1;
    rows.forEach((r, i) => {
      const rank = i + 1;
      if (r.uid === my) myRank = rank;
      html += '<div class="lb-row' + (r.uid === my ? ' me' : '') + '">'
        + '<span class="lb-rank">' + medal(rank) + '</span>'
        + '<span class="lb-name">' + nameHtml(r) + (r.uid === my ? '（你）' : '') + '</span>'
        + '<span class="lb-pet">' + escapeHtml(r.sub || '') + '</span>'
        + '<span class="lb-growth">' + escapeHtml(r.main) + '</span>'
        + '</div>';
    });
    body.innerHTML = '<div class="lb-list">' + html + '</div>'
      + (myRank > 0 ? '<div class="lb-my-rank">你的排名：第 ' + myRank + ' 名</div>' : '');
  }

  async function renderLeaderboard() {
    const body = document.getElementById('leaderboard-body');
    if (!body) return;
    body.innerHTML = '<div class="lb-loading">加载中…</div>';
    const my = await myId();
    try {
      const res = tab === 'tower' ? await towerRows() : await growthRows();
      if (res.err) { body.innerHTML = '<div class="lb-error">' + escapeHtml(res.err) + '</div>'; return; }
      // 名牌：整屏一次取完（失败/未登录返回 {}，当没名牌显示，不挡榜单）
      if (window.Supabase && window.Supabase.fetchPerksOf) {
        try { lbTags = await window.Supabase.fetchPerksOf(res.rows.map(r => r.uid)); } catch (e) { lbTags = {}; }
      }
      paint(body, res.rows, my);
    } catch (e) {
      body.innerHTML = '<div class="lb-error">加载失败：' + escapeHtml(e && (e.message || String(e))) + '</div>';
    }
  }

  /* ---------- 两个榜的切换条（插在 #leaderboard-body 上方一次，之后只切高亮）---------- */
  function ensureTabs() {
    const page = document.querySelector('#tab-leaderboard .lb-page');
    if (!page) return;
    if (document.getElementById('lb-tabs')) return;
    const bar = document.createElement('div');
    bar.className = 'lb-tabs';
    bar.id = 'lb-tabs';
    bar.innerHTML = `<button class="lb-tab" data-lb="growth">成长榜</button><button class="lb-tab" data-lb="tower">通天塔榜</button>`;
    page.insertBefore(bar, page.querySelector('.lb-body'));
    bar.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.lb-tab');
      if (!b) return;
      tab = b.dataset.lb === 'tower' ? 'tower' : 'growth';
      syncTabs();
      renderLeaderboard();
    });
    syncTabs();
  }
  function syncTabs() {
    document.querySelectorAll('#lb-tabs .lb-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.lb === tab);
    });
    const sub = document.querySelector('#tab-leaderboard .lb-sub');
    if (sub) sub.textContent = tab === 'tower' ? '全服通天塔最高层数' : '本周全服宠物成长值排行';
  }

  const orig = renderLeaderboard;
  window.UI = window.UI || {};
  window.UI.renderLeaderboard = function () { ensureTabs(); return orig(); };
})();
