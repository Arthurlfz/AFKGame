/* ui-friends.js — 好友 + 私聊（任务单 07，2026-09-20）
 * 表：friendships（user_id 发起方 / friend_id 接收方 / status），messages（from_id / to_id / body / read）。
 * ⭐ 好友关系存**一条记录、双向可见**：A 发起、B 同意后，两边列表都查得到对方（取「我发起的 ∩ accepted」并上「发给我的 accepted」）。
 * ⚠️ 不做实时推送：Realtime 需要 `alter publication supabase_realtime add table public.messages`，属改库配置、未授权 ⇒ 打开时拉一次 + 手动刷新按钮。 */
(function () {
  'use strict';

  const UI = window.UI || {};
  const esc = UI.escapeHtml || (s => String(s == null ? '' : s));
  const S = () => (window.Supabase && window.Supabase.getClient ? window.Supabase.getClient() : null);
  async function me() {
    try { const s = await window.Supabase.getSession(); return s && s.user && s.user.id; } catch (e) { return null; }
  }
  const ONLINE_MS = 5 * 60 * 1000;
  const isOnline = p => !!(p && p.last_seen_at && (Date.now() - new Date(p.last_seen_at).getTime()) < ONLINE_MS);
  /* 好友 / 请求方戴的名牌：uid → key，进页面时**一次取完**（不逐条请求）。
   * 拿不到就显示普通名字 —— 名牌只是装饰，不能因为它让好友页渲染失败。 */
  let frTags = {};
  const nameOf = (id, name) => (UI.nameTag ? UI.nameTag(name || '玩家', frTags[id]) : esc(name || '玩家'));
  async function profilesOf(ids) {
    const c = S(); if (!c || !ids.length) return {};
    const { data } = await c.from('profiles').select('id, nickname, last_seen_at').in('id', ids);
    const m = {}; for (const p of (data || [])) m[p.id] = p;
    return m;
  }

  /* ---------- 好友关系 ---------- */
  async function friendIds() {
    const c = S(), my = await me(); if (!c || !my) return [];
    const [a, b] = await Promise.all([
      c.from('friendships').select('friend_id').eq('user_id', my).eq('status', 'accepted'),
      c.from('friendships').select('user_id').eq('friend_id', my).eq('status', 'accepted')
    ]);
    const out = [].concat(
      (a.data || []).map(r => r.friend_id),
      (b.data || []).map(r => r.user_id)
    );
    return [...new Set(out.filter(Boolean))];
  }
  // 收到的请求（带行 id，用来同意/拒绝）
  async function inbox() {
    const c = S(), my = await me(); if (!c || !my) return [];
    const { data } = await c.from('friendships').select('id, user_id').eq('friend_id', my).eq('status', 'pending');
    return data || [];
  }
  // 我已发出、对方还没处理的
  async function outbox() {
    const c = S(), my = await me(); if (!c || !my) return [];
    const { data } = await c.from('friendships').select('friend_id').eq('user_id', my).eq('status', 'pending');
    return (data || []).map(r => r.friend_id).filter(Boolean);
  }
  async function search(q) {
    const c = S(), my = await me(); if (!c || !q) return [];
    const { data } = await c.from('profiles').select('id, nickname').ilike('nickname', '%' + String(q).trim() + '%').limit(20);
    return (data || []).filter(p => p.id !== my);
  }
  async function add(targetId) {
    const c = S(), my = await me();
    if (!c || !my || !targetId || targetId === my) return { error: '不能加自己' };
    return c.from('friendships').upsert({ user_id: my, friend_id: targetId, status: 'pending' }, { onConflict: 'user_id,friend_id' });
  }
  async function reply(rowId, ok) {
    const c = S(); if (!c) return { error: '请先登录' };
    if (ok) return c.from('friendships').update({ status: 'accepted' }).eq('id', rowId);
    return c.from('friendships').delete().eq('id', rowId);
  }
  async function unfriend(friendId) {
    const c = S(), my = await me(); if (!c || !my) return { error: '请先登录' };
    await c.from('friendships').delete().eq('user_id', my).eq('friend_id', friendId);
    return c.from('friendships').delete().eq('user_id', friendId).eq('friend_id', my);
  }

  /* ---------- 消息 ---------- */
  async function thread(friendId) {
    const c = S(), my = await me(); if (!c || !my || !friendId) return [];
    const [sent, got] = await Promise.all([
      c.from('messages').select('id, from_id, to_id, body, created_at').eq('from_id', my).eq('to_id', friendId).order('created_at', { ascending: false }).limit(100),
      c.from('messages').select('id, from_id, to_id, body, created_at').eq('from_id', friendId).eq('to_id', my).order('created_at', { ascending: false }).limit(100)
    ]);
    return (sent.data || []).concat(got.data || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  }
  async function send(friendId, body) {
    const c = S(), my = await me();
    const t = String(body || '').trim();
    if (!c || !my || !friendId) return { error: '请先登录' };
    if (!t) return { error: '消息不能为空' };
    if (t.length > 300) return { error: '消息最多 300 字' };
    return c.from('messages').insert({ from_id: my, to_id: friendId, body: t });
  }
  async function markRead(friendId) {
    const c = S(), my = await me(); if (!c || !my) return;
    await c.from('messages').update({ read: true }).eq('to_id', my).eq('from_id', friendId).eq('read', false);
  }
  async function unreadFrom() {
    const c = S(), my = await me(); if (!c || !my) return [];
    const { data } = await c.from('messages').select('from_id').eq('to_id', my).eq('read', false);
    return [...new Set((data || []).map(r => r.from_id).filter(Boolean))];
  }

  /* ---------- 页面 ---------- */
  async function renderFriends() {
    const body = document.getElementById('friends-body');
    if (!body) return;
    const my = await me();
    if (!my) { body.innerHTML = '<div class="fr-empty">登录后才能用好友</div>'; return; }
    body.innerHTML = '<div class="fr-empty">加载中…</div>';
    const [ids, inc, out] = await Promise.all([friendIds(), inbox(), outbox()]);
    const prof = await profilesOf(ids.concat(inc.map(r => r.user_id), out));
    const unread = await unreadFrom();

    const rows = ids.map(id => {
      const p = prof[id] || {};
      const hot = unread.indexOf(id) >= 0 ? '<span class="fr-dot" title="有未读"></span>' : '';
      return `<div class="fr-row">
        <span class="fr-name"><a class="fr-link" data-fid="${esc(id)}">${nameOf(id, p.nickname)}</a>${hot}</span>
        <span class="fr-state ${isOnline(p) ? 'on' : ''}">${isOnline(p) ? '在线' : '离线'}</span>
        <button class="fr-btn" data-act="chat" data-fid="${esc(id)}">私聊</button>
        <button class="fr-btn ghost" data-act="del" data-fid="${esc(id)}">删除</button>
      </div>`;
    }).join('') || '<div class="fr-empty">还没有好友 · 下面搜昵称加一个</div>';

    const incRows = inc.map(r => {
      const p = prof[r.user_id] || {};
      return `<div class="fr-row"><span class="fr-name">${nameOf(r.user_id, p.nickname)} 想加你为好友</span>
        <button class="fr-btn" data-act="accept" data-rid="${esc(r.id)}">同意</button>
        <button class="fr-btn ghost" data-act="reject" data-rid="${esc(r.id)}">拒绝</button></div>`;
    }).join('') || '<div class="fr-empty">没有待处理的好友请求</div>';

    const outTxt = out.length
      ? '<div class="fr-empty">已发出、等待对方同意：' + out.map(id => esc((prof[id] || {}).nickname || '玩家')).join('、') + '</div>'
      : '';

    body.innerHTML = `
      <div class="fr-search">
        <input class="fr-input" id="fr-q" placeholder="搜昵称加好友">
        <button class="fr-btn primary" data-act="search">搜索</button>
        <button class="fr-btn ghost" data-act="refresh">刷新</button>
      </div>
      <div class="fr-sub">好友</div>
      <div class="fr-list">${rows}</div>
      <div class="fr-sub">好友请求</div>
      <div class="fr-list">${incRows}</div>
      <div id="fr-result" class="fr-result"></div>
      ${outTxt}`;

    body.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.act;
        const res = document.getElementById('fr-result');
        if (act === 'search') {
          const q = (document.getElementById('fr-q') || {}).value;
          const hits = await search(q);
          res.innerHTML = hits.length
            ? hits.map(h => `<div class="fr-row"><span class="fr-name">${esc(h.nickname || '玩家')}</span>
                <button class="fr-btn primary" data-act="add" data-fid="${esc(h.id)}">加好友</button></div>`).join('')
            : '<div class="fr-empty">没搜到这个人</div>';
          res.querySelectorAll('[data-act="add"]').forEach(b2 => {
            b2.onclick = async () => {
              const r = await add(b2.dataset.fid);
              if (UI.showToast) UI.showToast(r && r.error ? '发送失败' : '已发出请求', r && r.error ? r.error : '等对方同意');
              renderFriends();
            };
          });
          return;
        }
        if (act === 'refresh') { renderFriends(); return; }
        if (act === 'chat') { openChat(btn.dataset.fid, (prof[btn.dataset.fid] || {}).nickname); return; }
        if (act === 'del') {
          if (!window.confirm('删除这个好友？（聊天记录不会删，只是解除关系）')) return;
          await unfriend(btn.dataset.fid);
          renderFriends();
          return;
        }
        if (act === 'accept' || act === 'reject') {
          await reply(btn.dataset.rid, act === 'accept');
          renderFriends();
        }
      };
    });
    body.querySelectorAll('.fr-link').forEach(a => {
      a.onclick = () => openChat(a.dataset.fid, a.textContent.trim());
    });
  }

  /* ---------- 私聊窗 ---------- */
  async function openChat(friendId, name) {
    if (!friendId) return;
    const wrap = document.createElement('div');
    wrap.className = 'fr-wrap';
    wrap.innerHTML = `<div class="fr-chat">
      <div class="fr-chat-head"><span class="fr-chat-title">${esc(name || '玩家')}</span>
        <button class="fr-btn ghost" data-act="close">关闭</button></div>
      <div class="fr-msgs" id="fr-msgs"><div class="fr-empty">加载中…</div></div>
      <div class="fr-send"><input class="fr-input" id="fr-text" maxlength="300" placeholder="说点什么（最多 300 字）">
        <button class="fr-btn primary" data-act="send">发送</button></div>
    </div>`;
    document.body.appendChild(wrap);

    const box = wrap.querySelector('#fr-msgs');
    async function paint() {
      const list = await thread(friendId);
      const my = await me();
      box.innerHTML = list.length
        ? list.map(m => `<div class="fr-msg ${String(m.from_id) === String(my) ? 'mine' : ''}">${esc(m.body)}</div>`).join('')
        : '<div class="fr-empty">还没有说过话</div>';
      box.scrollTop = box.scrollHeight;
    }
    await paint();
    await markRead(friendId);
    // 聊天窗开着时，收到对方新消息就补画（实时订阅调这个）
    UI._chatRepaint = async () => { await paint(); await markRead(friendId); };
    const clear = () => { if (UI._chatRepaint) UI._chatRepaint = null; };
    wrap.addEventListener('click', e => { if (e.target === wrap) clear(); });
    const oldRemove = wrap.remove.bind(wrap);
    wrap.remove = () => { clear(); oldRemove(); };

    wrap.addEventListener('click', async e => {
      const btn = e.target.closest && e.target.closest('[data-act]');
      if (btn && btn.dataset.act === 'close') { wrap.remove(); return; }
      if (btn && btn.dataset.act === 'send') {
        const input = wrap.querySelector('#fr-text');
        const r = await send(friendId, input && input.value);
        if (r && r.error) { if (UI.showToast) UI.showToast('发不出去', r.error); return; }
        if (input) input.value = '';
        await paint();
        return;
      }
      if (e.target === wrap) wrap.remove();
    });
  }

  /* ---------- 侧边栏红点：有未读就亮 ---------- */
  async function refreshFriendDot() {
    const btn = document.querySelector('.sb-btn[data-page="friends"] .sb-dot');
    if (!btn) return;
    const n = (await unreadFrom()).length;
    btn.hidden = !n;
    if (n) btn.textContent = n;
  }

  /* 实时：订阅自己的收件箱（messages / friendships 已加入 supabase_realtime publication，2026-09-20）。
   * 收到新私聊 → 刷红点 + 若那个人的聊天窗开着就补画；收到好友请求 → 刷红点。
   * ⚠️ 订阅失败（老库没进 publication / 网络）就静默退回 30 秒轮询 —— 功能不消失。 */
  function subscribeRealtime() {
    const c = S();
    if (!c || !c.channel) return;
    me().then(my => {
      if (!my) return;
      try {
        c.channel('fr-inbox')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'to_id=eq.' + my },
            () => { refreshFriendDot(); if (UI._chatRepaint) UI._chatRepaint(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: 'friend_id=eq.' + my },
            () => { refreshFriendDot(); })
          .subscribe();
      } catch (e) { /* 静默：下面还有轮询兜底 */ }
    });
  }

  // 兜底轮询（订阅成功也留着：实时偶尔会掉线，30 秒一次的成本可以忽略）
  setInterval(refreshFriendDot, 30000);
  setTimeout(subscribeRealtime, 3000);   // 等登录态就位再订阅

  window.UI = window.UI || {};
  window.UI.renderFriends = renderFriends;
  window.UI.openChat = openChat;
  window.UI.refreshFriendDot = refreshFriendDot;
  window.UI.Friends = { friendIds, inbox, outbox, search, add, reply, unfriend, thread, send, markRead, unreadFrom };
})();
