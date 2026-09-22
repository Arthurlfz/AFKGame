/* ui-social.js — 市集轻社交：关注卖家 + 卖家留言板（任务单 05）
 * 数据来自 follows / board_messages 两张表（2026-09-20 建），卖家昵称 join profiles。
 * ⚠️ 只做展示与自己那份关注/留言 —— **交易/定价逻辑一律不碰**。 */
(function () {
  'use strict';

  const UI = window.UI || {};
  const esc = UI.escapeHtml || (s => String(s == null ? '' : s));
  const S = () => (window.Supabase && window.Supabase.getClient ? window.Supabase.getClient() : null);
  async function me() {
    try { const s = await window.Supabase.getSession(); return s && s.user && s.user.id; } catch (e) { return null; }
  }
  async function nameOf(ids) {
    const c = S(); if (!c || !ids.length) return {};
    const { data } = await c.from('profiles').select('id, nickname').in('id', ids);
    const m = {}; for (const p of (data || [])) m[p.id] = p.nickname || '玩家';
    return m;
  }
  /* 名牌（2026-09-20）：社交面板里的名字也走统一渲染。
   * 进面板时按 uid **一次取完**（卖家 + 留言作者），拿不到就显示普通名字。 */
  let socTags = {};
  const tagOf = (id, name) => (UI.nameTag ? UI.nameTag(name || '玩家', socTags[id]) : esc(name || '玩家'));

  /* ---------- 关注 ---------- */
  async function isFollowing(sellerId) {
    const c = S(), myId = await me();
    if (!c || !myId || !sellerId || sellerId === myId) return false;
    const { data } = await c.from('follows').select('id')
      .eq('follower_id', myId).eq('seller_id', sellerId).limit(1);
    return !!(data && data.length);
  }
  async function setFollow(sellerId, on) {
    const c = S(), myId = await me();
    if (!c || !myId || !sellerId || sellerId === myId) return { error: '不能关注自己' };
    if (on) return c.from('follows').upsert({ follower_id: myId, seller_id: sellerId }, { onConflict: 'follower_id,seller_id' });
    return c.from('follows').delete().eq('follower_id', myId).eq('seller_id', sellerId);
  }
  // 我关注的卖家（带昵称）
  async function following() {
    const c = S(), myId = await me();
    if (!c || !myId) return [];
    const { data } = await c.from('follows').select('seller_id, created_at').eq('follower_id', myId);
    const ids = (data || []).map(r => r.seller_id);
    const names = await nameOf(ids);
    return ids.map(id => ({ id, name: names[id] || '玩家' }));
  }

  /* ---------- 留言板 ---------- */
  async function board(sellerId) {
    const c = S(); if (!c || !sellerId) return [];
    const { data } = await c.from('board_messages').select('id, author_id, body, created_at')
      .eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(50);
    const names = await nameOf([...new Set((data || []).map(r => r.author_id))]);
    // authorId 一并带出去：渲染层要靠它查作者戴的名牌
    return (data || []).map(r => ({
      id: r.id, body: r.body, created_at: r.created_at,
      author: names[r.author_id] || '玩家', authorId: r.author_id
    }));
  }
  async function post(sellerId, body) {
    const c = S(), myId = await me();
    const txt = String(body || '').trim();
    if (!c || !myId || !sellerId) return { error: '请先登录' };
    if (!txt) return { error: '留言不能为空' };
    if (txt.length > 200) return { error: '留言最多 200 字' };
    return c.from('board_messages').insert({ seller_id: sellerId, author_id: myId, body: txt });
  }
  // 他的在售（只列标题与价，复用挂单表现有字段）
  async function selling(sellerId) {
    const c = S(); if (!c || !sellerId) return [];
    const out = [];
    const { data: pets } = await c.from('pet_listings').select('id, pet_name, pet_growth, material_type, material_qty, status')
      .eq('seller_id', sellerId).eq('status', 'active').limit(20);
    for (const r of (pets || [])) out.push({ kind: '宠', name: r.pet_name, mat: r.material_type, qty: r.material_qty });
    const { data: items } = await c.from('equip_listings').select('id, item_name, item_slot, material_type, material_qty, status')
      .eq('seller_id', sellerId).eq('status', 'active').limit(20);
    for (const r of (items || [])) out.push({ kind: '装', name: r.item_name, mat: r.material_type, qty: r.material_qty });
    return out;
  }

  /* ---------- 卖家面板（一个浮层看完：关注 / 在售 / 留言板） ---------- */
  function panelHtml(sellerId, name, opt) {
    const st = opt || {};
    const followBtn = st.following ? '<button class="soc-btn ghost" data-act="unfollow">已关注 · 取消</button>'
      : '<button class="soc-btn primary" data-act="follow">＋ 关注他</button>';
    const sellRows = (st.selling || []).length
      ? (st.selling || []).map(r => `<div class="soc-row"><span class="soc-tag">${esc(r.kind)}</span>`
        + `<span class="soc-name">${esc(r.name || '—')}</span>`
        + `<span class="soc-price">${r.qty || 0} ${esc(r.mat || '')}</span></div>`).join('')
      : '<div class="soc-empty">他现在没有在售的东西</div>';
    const msgs = (st.board || []).length
      ? (st.board || []).map(m => `<div class="soc-msg"><b>${tagOf(m.authorId, m.author)}</b>${esc(m.body)}</div>`).join('')
      : '<div class="soc-empty">还没有人留言</div>';
    return `<div class="soc-panel">
      <div class="soc-head"><span class="soc-title">卖家 · ${tagOf(sellerId, name)}</span>${followBtn}</div>
      <div class="soc-sub">他的在售</div>
      <div class="soc-list">${sellRows}</div>
      <div class="soc-sub">留言板</div>
      <div class="soc-msgs">${msgs}</div>
      <div class="soc-input"><input class="soc-text" maxlength="200" placeholder="说点什么（最多 200 字）">
        <button class="soc-btn primary" data-act="send">发送</button></div>
    </div>`;
  }

  function render(host, sellerId, name) {
    host.innerHTML = '<div class="soc-empty">加载中…</div>';
    Promise.all([isFollowing(sellerId), selling(sellerId), board(sellerId)]).then(async ([f, s, b]) => {
      // 名牌：卖家 + 留言作者一次取完（失败就当没名牌，不挡面板）
      if (window.Supabase && window.Supabase.fetchPerksOf) {
        try { socTags = await window.Supabase.fetchPerksOf([sellerId].concat((b || []).map(m => m.authorId))); }
        catch (e) { socTags = {}; }
      }
      host.innerHTML = panelHtml(sellerId, name, { following: f, selling: s, board: b });
      bind(host, sellerId, name);
    }).catch(() => { host.innerHTML = '<div class="soc-empty">加载失败</div>'; });
  }

  function bind(host, sellerId, name) {
    host.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.act;
        if (act === 'follow' || act === 'unfollow') {
          await setFollow(sellerId, act === 'follow');
          if (UI.showToast) UI.showToast(act === 'follow' ? '已关注' : '已取消关注', name || '');
          render(host, sellerId, name);
          return;
        }
        if (act === 'send') {
          const input = host.querySelector('.soc-text');
          const res = await post(sellerId, input && input.value);
          if (res && res.error) { if (UI.showToast) UI.showToast('发不出去', res.error); return; }
          render(host, sellerId, name);
        }
      };
    });
  }

  /* ---------- 我的关注 ---------- */
  async function myFollowsHtml() {
    const list = await following();
    if (!list.length) return '<div class="soc-empty">你还没关注任何人</div>';
    // 名牌：关注列表一次取完（失败就当没名牌，不挡列表）
    if (window.Supabase && window.Supabase.fetchPerksOf) {
      try { socTags = await window.Supabase.fetchPerksOf(list.map(f => f.id)); } catch (e) { socTags = {}; }
    }
    const rows = [];
    for (const f of list) {
      const items = await selling(f.id);
      rows.push('<div class="soc-row"><span class="soc-name">'
        + `<a class="soc-link" data-seller="${esc(f.id)}">${tagOf(f.id, f.name)}</a></span>`
        + `<span class="soc-price">在售 ${items.length} 件</span></div>`);
    }
    return '<div class="soc-panel"><div class="soc-head"><span class="soc-title">我的关注</span></div>'
      + '<div class="soc-list">' + rows.join('') + '</div></div>';
  }

  async function openMyFollows() {
    const host = document.createElement('div');
    host.className = 'soc-wrap';
    document.body.appendChild(host);
    host.innerHTML = await myFollowsHtml();
    host.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('.soc-link');
      if (!a) return;
      host.remove();
      openSellerPanel(a.dataset.seller, a.textContent.trim());
    });
    host.addEventListener('click', e => { if (e.target === host) host.remove(); });
  }

  function openSellerPanel(sellerId, name) {
    if (!sellerId) { if (UI.showToast) UI.showToast('看不了', '这个挂单没有真实卖家（AI 挂单）'); return; }
    const host = document.createElement('div');
    host.className = 'soc-wrap';
    document.body.appendChild(host);
    const box = document.createElement('div');
    box.className = 'soc-box';
    host.appendChild(box);
    render(box, sellerId, name);
    host.addEventListener('click', e => { if (e.target === host) host.remove(); });
  }

  /* ---------- 市集页入口：我的关注（2026-09-20 补）
   * 做法：往 `#tab-market` 头部插一条自己的小栏（只插一次）。**不去改市场页的结构与事件**，
   * 所以市场页怎么改都不会把这里弄坏（反过来也一样）。 */
  function ensureFollowEntry() {
    const page = document.getElementById('tab-market');
    if (!page || document.getElementById('soc-my-follows')) return;
    const bar = document.createElement('div');
    bar.className = 'soc-entry';
    bar.innerHTML = '<button class="soc-btn ghost" id="soc-my-follows">我的关注</button>';
    page.insertBefore(bar, page.firstChild);
    bar.querySelector('#soc-my-follows').onclick = () => openMyFollows();
  }

  /* ---------- 卡片上的卖家名 → 打开面板（事件委托，不去改市场页的事件结构） ---------- */
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('.mk-seller-link') : null;
    if (!el) return;
    e.stopPropagation();
    openSellerPanel(el.dataset.seller, el.textContent.trim());
  });

  window.UI = window.UI || {};
  window.UI.Social = { openSellerPanel, openMyFollows, isFollowing, setFollow, following, board, post, selling };
  window.UI.ensureFollowEntry = ensureFollowEntry;
})();
