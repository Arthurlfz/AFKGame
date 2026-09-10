/* ============================================================
 * ui/ui-market-notify.js —— 市集「离线成交」结算通知
 * 职责：
 *  1. 按账号记住「上次已读的最新卖出记录时间」（localStorage，不落库）
 *  2. 每次上线比对 trade_records 的卖出记录，找出这之后新增的成交
 *  3. 一次性汇总弹一条（POE2 异步交易 / 火炬之光「交易记录领取」的等价物）
 * 说明：挂单本身是云端持久化的，真正的「离线被买走」发生在服务器；这里做的是
 *      把「你不在时被买走的东西」在下次上线时明确告诉玩家 —— 以前只能自己翻记录。
 * 依赖：market（tradeRecords 由 Market.refresh 拉取）、ui-common、ui-dialog（可选，缺失时降级为 toast）
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI || {};
  const Market = window.Market || {};
  const escapeHtml = UI.escapeHtml || (s => String(s == null ? '' : s));

  const KEY_PREFIX = 'fos_market_seen_sale_';
  const MAX_ROWS = 6;

  function seenKey() {
    const u = (UI.getAuthUser && UI.getAuthUser()) || null;
    return (u && u.id) ? KEY_PREFIX + u.id : null;
  }
  function readSeen(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function writeSeen(key, iso) {
    try { localStorage.setItem(key, iso); } catch (e) { /* 隐私模式等写不了就算了 */ }
  }
  function ts(v) { const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function matOf(type) { return Market.findMaterial(type); }

  function check() {
    const key = seenKey();
    if (!key) return;
    if (UI.isLoggedIn && !UI.isLoggedIn()) return;
    const recs = Market.getTradeRecords ? (Market.getTradeRecords() || []) : [];
    const sells = recs.filter(r => r.role === 'sell');
    if (!sells.length) return;

    // 最新一笔卖出记录的时间（作为「已读到哪」的水位线）
    let latest = sells[0].created_at;
    for (const r of sells) if (ts(r.created_at) > ts(latest)) latest = r.created_at;

    const seen = readSeen(key);
    if (!seen) { writeSeen(key, latest); return; } // 首次进游戏：只记水位，不弹（避免把历史记录当"离线成交"刷屏）

    const seenMs = ts(seen);
    const fresh = sells.filter(r => ts(r.created_at) > seenMs);
    writeSeen(key, latest);
    if (!fresh.length) return;

    const byMat = {};
    for (const r of fresh) byMat[r.material_type] = (byMat[r.material_type] || 0) + Number(r.net_qty || 0);
    const sumHtml = Object.keys(byMat).map(k => {
      const m = matOf(k);
      return `<b>${byMat[k]}</b> ${m.icon} ${escapeHtml(m.name)}`;
    }).join('　') || '—';

    const rows = fresh.slice(0, MAX_ROWS).map(r => {
      const m = matOf(r.material_type);
      return '<div class="mo-row">'
        + `<span class="mo-time">${fmtTime(r.created_at)}</span>`
        + `<span class="mo-name">${escapeHtml(r.item_name)}</span>`
        + `<span class="mo-price">${r.price_qty} ${m.icon} ${escapeHtml(m.name)}</span>`
        + '</div>';
    }).join('');
    const more = fresh.length > MAX_ROWS
      ? `<div class="hint">…另有 ${fresh.length - MAX_ROWS} 笔，见下方「交易记录」</div>` : '';

    const html = `<div class="mo-title">你不在的这段时间，挂单成交了 <b>${fresh.length}</b> 笔</div>`
      + rows + more
      + `<div class="mo-sum">净入账（已扣税）：${sumHtml}</div>`;

    if (UI.showDialog) {
      UI.showDialog({
        icon: '🛒', speaker: '商会', text: html,
        buttons: [{ label: '去市集看看', onClick: () => { if (UI.switchPage) UI.switchPage('market'); } }]
      });
    } else if (UI.showToast) {
      UI.showToast('🛒 离线成交', `${fresh.length} 笔挂单被买走，材料已入包`);
    }
    if (UI.consoleLog) UI.consoleLog('social', `🛒 离线期间挂单成交 ${fresh.length} 笔，共入账 ${sumHtml.replace(/<[^>]*>/g, '')}`);
  }

  UI.checkMarketOfflineSales = check;
})();
