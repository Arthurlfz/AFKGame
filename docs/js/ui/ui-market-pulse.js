/* ============================================================
 * ui/ui-market-pulse.js —— 市集顶部的「活人感」条（2026-09-17）
 *
 * 为什么做：市集页以前是"死的" —— 玩家挂完单，页面上没有任何东西在动，
 *   他判断"这市场没人"的依据就是**页面毫无动静**。而这游戏主打的就是玩家之间真实交易。
 *   这一条做两件事：
 *     ① 在线人数（最近 10 分钟有心跳的账号数）
 *     ② 最近成交轮播（谁买走了什么、卖了多少钱）—— 每 4 秒换一条
 *
 * 数据源：Supabase.marketPulse()（服务端聚合，见 migrate_market_pulse.sql）
 * 刷新：只在【市集页可见】时每 30 秒拉一次；切走就停，不白烧请求。
 *
 * 依赖：ui-common（$ / UI）、core/supabase
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const escapeHtml = UI.escapeHtml || (s => String(s == null ? '' : s));

  let deals = [];
  let dealIdx = 0;
  let dealTimer = null;
  let pollTimer = null;
  let lastData = null;

  const matName = t => {
    const M = (window.Market && window.Market.findMaterial) ? window.Market.findMaterial(t) : null;
    return (M && M.name) || t || '';
  };
  const tsOf = v => { const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; };
  function ago(iso) {
    const m = Math.floor((Date.now() - tsOf(iso)) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    return h < 24 ? h + ' 小时前' : Math.floor(h / 24) + ' 天前';
  }

  function dealLine(d) {
    if (!d) return '';
    const who = escapeHtml(d.who || '有人');
    const item = escapeHtml(d.item || '物品');
    return `<span class="mp-who">${who}</span> 买走了 <span class="mp-item">${item}</span>`
      + ` <span class="mp-price">→ ${Number(d.qty || 0)} ${escapeHtml(matName(d.mat))}</span>`
      + `<span class="mp-ago">${ago(d.at)}</span>`;
  }

  function paint() {
    const host = $('market-pulse');
    if (!host) return;
    if (!lastData) { host.innerHTML = ''; return; }
    const on = Number(lastData.online || 0);
    const dot = on > 0 ? 'is-live' : '';
    host.innerHTML =
      `<div class="mp-online ${dot}" title="最近 10 分钟内有活动的玩家数"><span class="mp-dot"></span>在线 <b>${on}</b> 人</div>`
      + `<div class="mp-deal" id="mp-deal-slot">${dealLine(deals[dealIdx]) || '<span class="mp-idle">还没有成交记录 —— 你挂上去卖，可能就是第一条</span>'}</div>`;
  }

  function rotate() {
    if (deals.length < 2) return;
    const slot = $('mp-deal-slot');
    if (!slot) { dealIdx = (dealIdx + 1) % deals.length; return; }
    slot.classList.add('is-out');
    setTimeout(() => {
      dealIdx = (dealIdx + 1) % deals.length;
      slot.innerHTML = dealLine(deals[dealIdx]);
      slot.classList.remove('is-out');
    }, 220);
  }

  async function pull() {
    if (!window.Supabase || !window.Supabase.marketPulse) return;
    if (UI.isLoggedIn && !UI.isLoggedIn()) return;
    try {
      const r = await window.Supabase.marketPulse(8);
      if (r && r.error) return;
      lastData = r.data || {};
      deals = Array.isArray(lastData.deals) ? lastData.deals : [];
      paint();
    } catch (e) { /* 拿不到就不显示，绝不打断市集页 */ }
  }

  const marketVisible = () => {
    const p = $('tab-market');
    return !!(p && p.classList && p.classList.contains('active'));
  };

  function start() {
    pull();
    if (typeof setInterval !== 'function') return;   // 测试桩里没有 setInterval
    if (!pollTimer) {
      pollTimer = setInterval(() => { if (marketVisible()) pull(); }, 30000);
      if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
    }
    if (!dealTimer && deals.length > 1) {
      dealTimer = setInterval(rotate, 4000);
      if (dealTimer && typeof dealTimer.unref === 'function') dealTimer.unref();
    }
  }

  // 切到市集页就拉一次（切页由 ui-shell 广播；这里只监听，不新增轮询）
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('.sb-btn[data-page="market"]');
      if (b) setTimeout(pull, 60);
    });
  }
  UI.pullMarketPulse = start;
  start();
})();
