(function () {
  'use strict';
  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;
  const Config = window.Config;
  const Market = window.Market;
  const Materials = window.Materials;
  const { SLOTS, unequip, describeItem, rarityOf, equipItem, getInventory, flattenAffixes } = window.Equipment;
  const PetSprites = window.PetSprites;
  const MarketUI = window.MarketUI || (window.MarketUI = {});

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // 交易对手显示：只区分「真人」还是「NPC 流浪商人」。
  // 游戏里市场本就不暴露真实玩家身份（挂单只存 seller_id，不显示名字），
  // 所以这里也不显示对方 uuid —— 等 profiles 昵称系统做好、且玩家自己公开昵称后，再换成昵称。
  function counterLabel(v) {
    if (!v) return '';
    return v === '流浪商人'? '流浪商人': '玩家';
  }
  // 对手那一格：老记录没有 counterparty 就不显示这一格（历史数据不回填）
  function counterCell(r) {
    if (!r.counterparty) return '';
    const verb = r.role === 'sell'? '卖给': '买自';
    return `<span class="tr-who">${verb} ${escapeHtml(counterLabel(r.counterparty))}</span>`;
  }
  function renderTradeRecords() {
    const recs = Market.getTradeRecords();
    const sells = recs.filter(r => r.role === 'sell');
    const buys = recs.filter(r => r.role === 'buy');

    // 汇总：卖出净收入 - 买入花费，按材料类型分组
    const netByMat = {};
    for (const r of recs) {
      const key = r.material_type;
      if (r.role === 'sell') netByMat[key] = (netByMat[key] || 0) + r.net_qty;
      else netByMat[key] = (netByMat[key] || 0) - r.price_qty;
    }
    const summaryHtml = (Config.trade.materials.map(m => {
      const n = netByMat[m.name] || 0;
      return `<span class="net-chip ${n >= 0 ? 'pos': 'neg'}">${m.icon} ${m.name} ${n >= 0 ? '+': ''}${n}</span>`;
    }).join('')) || '<span class="hint">暂无交易</span>';

    $('tr-sell-count').textContent = String(sells.length);
    $('tr-buy-count').textContent = String(buys.length);
    $('tr-summary-mats').innerHTML = summaryHtml;

    // 卖出记录
    const sellBox = $('tr-sell-list');
    sellBox.innerHTML = '';
    if (!sells.length) {
      sellBox.innerHTML = '<div class="inv-empty">还没有卖出记录</div>';
    } else {
      for (const r of sells) {
        const mat = Market.findMaterial(r.material_type);
        const row = document.createElement('div');
        row.className = 'tr-row';
        row.innerHTML = `
          <span class="tr-time">${formatTime(r.created_at)}</span>
          <span class="tr-name">${escapeHtml(r.item_name)}</span>
          ${counterCell(r)}
          <span class="tr-price">${r.price_qty} ${mat.icon} ${mat.name}</span>
          <span class="tr-tax">税 -${r.tax_qty}</span>`;
        sellBox.appendChild(row);
      }
    }
    // 买入记录
    const buyBox = $('tr-buy-list');
    buyBox.innerHTML = '';
    if (!buys.length) {
      buyBox.innerHTML = '<div class="inv-empty">还没有买入记录</div>';
    } else {
      for (const r of buys) {
        const mat = Market.findMaterial(r.material_type);
        const row = document.createElement('div');
        row.className = 'tr-row';
        row.innerHTML = `
          <span class="tr-time">${formatTime(r.created_at)}</span>
          <span class="tr-name">${escapeHtml(r.item_name)}</span>
          ${counterCell(r)}
          <span class="tr-price">${r.price_qty} ${mat.icon} ${mat.name}</span>`;
        buyBox.appendChild(row);
      }
    }
  }


  /* ---------- 对外 API ---------- */
  UI.renderTradeRecords = renderTradeRecords;
})();
