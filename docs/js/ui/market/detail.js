/* ============================================================
 * ui/market/detail.js —— 市集右侧「常驻详情栏」
 * 职责（一件事）：把**当前选中**的那条挂单摊开讲清楚，并给它一个下单入口
 *   1. 这件东西到底是什么（分类型字段，只摆真实存在的字段）
 *   2. 买它要付多少、税多少、卖家实收多少、我手里够不够
 *   3. 同类更低价的还有哪几条（点了直接切过去 —— 这就是"市场捡漏"的动线）
 *
 * 【血泪】不编数据：挂单里没有的字段（孵化时长、卖家昵称…）一律不显示。
 *   以前有过"界面上写了、服务端根本没有"的字段，玩家当真，出事还得回头解释。
 * 依赖：MarketCalc（口径与比价）/ MarketWatch / MarketPage（下单）；工具来自 ui-common。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $, escapeHtml } = UI;
  const Config = window.Config;
  const Market = window.Market;
  const Materials = window.Materials;
  const Calc = window.MarketCalc;

  let selectedKey = null;   // 当前选中（用 MarketCalc.listingKey 定位，挂单被买走后自然失效）
  let pool = [];            // 全部在售（未筛选）：同类低价要从"全市场"里找，不能被当前筛选砍掉
  let shown = null;         // 当前摊开的那条（refreshNumbers 用：只改数字，不重建 DOM）

  function find(key) {
    if (!key) return null;
    return pool.find(x => Calc.listingKey(x) === key) || null;
  }

  const selected = () => find(selectedKey);

  /* 选中。l 为 null 时清空（由 render 决定回退到哪条）。 */
  function select(l) {
    selectedKey = l ? Calc.listingKey(l) : null;
    render();
  }

  /* 同类低价：同款 + 同收款材料，价升序前 5（含自己，标出来）。
   * 为什么必须同收款材料：10 重铸石 ≠ 10 神圣石，跨材料排名没有意义。 */
  function cheaperPeers(l) {
    const key = Calc.peerGroupKey(l);
    return pool
      .filter(x => x !== l && Calc.peerGroupKey(x) === key && x.material_type === l.material_type)
      .sort((a, b) => Number(a.material_qty || 0) - Number(b.material_qty || 0))
      .slice(0, 5);
  }

  function rowsOf(l) {
    const kind = Calc.listingKind(l);
    const rows = [];
    if (kind === 'pet') {
      const gVal = Number(l.pet_growth) || 0;
      const godMinG = (Config.synthesize && Config.synthesize.god && Config.synthesize.god.minGrowth) || 60;
      const peers = pool.filter(x => x !== l && Calc.peerGroupKey(x) === Calc.peerGroupKey(l));
      const gMed = peers.length >= 3 ? Calc.medianQty(peers, x => Number(x.pet_growth || 0)) : null;
      rows.push(['成长资质', '<span class="v gold">' + gVal.toFixed(1) + '</span>']);
      rows.push(['对比同款', gMed == null
        ? '<span class="v dim">样本不足，暂无比价</span>'
        : (gVal > gMed ? '<span class="v" style="color:var(--gold-hi)">高于同款中位 ' + Number(gMed).toFixed(1) + '</span>'
          : '<span class="v">同款中位 ' + Number(gMed).toFixed(1) + '</span>')]);
      rows.push(['等级', '<span class="v">Lv.' + (l.pet_level || 1) + '</span>']);
      rows.push(['特质', (l.pet_traits || []).length
        ? (UI.traitsHtml ? UI.traitsHtml({ traits: l.pet_traits }) : '')
        : '<span class="v dim">无特质</span>']);
      if (gVal >= godMinG) rows.push(['合成价值', '<span class="v" style="color:var(--gold-hi)">成长达 ' + godMinG + '，可搏神级宠</span>']);
    } else if (kind === 'item') {
      const color = (Config.equipment.rarities.find(r => r.id === l.item_rarity) || {}).color || '#d8d8d8';
      rows.push(['稀有度', '<span class="v" style="color:' + color + '">' + ({ white: '白装', blue: '蓝装', gold: '金装' }[l.item_rarity] || l.item_rarity || '未知') + '</span>']);
      rows.push(['部位', '<span class="v">' + escapeHtml(l.item_slot || '未知') + '</span>']);
      rows.push(['底材T阶', '<span class="v gold">T' + (l.item_tier || '?') + '</span>']);
      const affs = window.Equipment.flattenAffixes(l.item_affixes || []);
      affs.forEach((a, i) => rows.push([i === 0 ? '词缀' : '', '<span class="v">' + escapeHtml(a.label || a.type) + ' +' + a.value + '</span>']));
      if (!affs.length) rows.push(['词缀', '<span class="v dim">无词缀</span>']);
      if (l.item_soul) rows.push(['魂铸', '<span class="v" style="color:var(--r-blue)">' + escapeHtml(l.item_soul.label || '') + ' T' + (l.item_soul.tier || 1) + '</span>']);
    } else if (kind === 'egg') {
      rows.push(['品种', '<span class="v">' + escapeHtml(l.egg_type || '未知') + '</span>']);
      rows.push(['用法', '<span class="v dim">买下后去「宠物」页孵化，孵出具基础形态</span>']);
    } else {
      rows.push(['材料', '<span class="v">' + escapeHtml(l.good_name || '未知') + ' ×' + Number(l.good_qty || 1) + '</span>']);
    }
    rows.push(['卖家', l.seller_id
      ? '<span class="mk-seller-link" data-seller="' + escapeHtml(l.seller_id) + '">' + (l.seller ? escapeHtml(l.seller) : '玩家') + '</span>'
      : (l.seller ? escapeHtml(l.seller) : '未知')]);
    const age = Calc.ageLabel(l);
    if (age) rows.push(['挂出', '<span class="v">' + age + '</span>']);
    return rows;
  }

  /* pool     = 全部在售（未筛选）：同类低价要比"全市场"，不能被当前筛选砍掉样本
   * fallback = 当前屏幕上第一条：没选中任何东西时，默认摊开**玩家看得见的那件**，
   *            而不是全市场第一条（否则改筛选后右栏讲的是屏幕上没有的东西） */
  function render(p, fallback) {
    if (p) pool = p;
    const box = $('market-detail');
    if (!box) return;

    let l = selected();
    if (!l) l = fallback || pool[0] || null;
    if (!l) {
      selectedKey = null;
      box.innerHTML = '<div class="md-empty">左边还没有可看的东西<br><small>选一件商品，这里会摊开它的详情</small></div>';
      return;
    }
    selectedKey = Calc.listingKey(l);
    shown = l;

    const kind = Calc.listingKind(l);
    const mine = window.MarketCards ? window.MarketCards.isMine(kind, l) : false;
    const legacy = !l.material_type;
    const mat = Market.findMaterial(l.material_type);
    const qty = Number(l.material_qty || 0);
    const tax = Market.calcTax(qty);
    const net = Market.calcNet(qty);
    const hold = mat ? Materials.getQuantity(mat.name) : 0;
    const enough = hold >= qty;

    const m = window.MarketCards ? window.MarketCards.modelOf(l, pool) : null;
    const nameHtml = m ? escapeHtml(m.name) : '—';
    const nameColor = m && m.nameColor ? ' style="color:' + m.nameColor + '"' : '';
    const tile = m ? m.tileHtml : '';
    const kindLabel = Calc.KIND_LABEL[kind] || '商品';
    const watchBtn = window.MarketWatch
      ? '<button type="button" class="fs-btn fs-btn--ghost md-fav' + (window.MarketWatch.isWatched(l) ? ' on' : '') + '">'
        + (window.MarketWatch.isWatched(l) ? '★ 已关注' : '☆ 关注此款') + '</button>'
      : '';

    const priceBlock = legacy
      ? '<div class="md-warn">这是旧版挂单（没有收款物信息），不能购买。请联系卖家重新上架。</div>'
      : '<div class="md-total"><div><div class="md-total-lb">一口价</div>'
        + '<div class="md-total-amt">' + qty + '<small>' + mat.name + '</small></div></div>'
        + '<div class="md-total-side">交易税 ' + tax + '（卖家承担）<br>卖家实收 <b>' + net + '</b><br>'
        + '我的「' + mat.name + '」<b id="mdHoldNum" class="' + (enough ? '' : 'is-short') + '">' + hold + '</b></div></div>';

    const buyLabel = mine ? '取 回 下 架' : legacy ? '不 可 购 买' : '封 章 购 入';
    const buyDisabled = (!mine && legacy) || (!UI.isLoggedIn());
    const buyTip = !UI.isLoggedIn() && !mine ? '登录后才能购买' : '';

    const peers = cheaperPeers(l);
    const peersHtml = peers.length
      ? peers.map(x => {
        const mx = window.MarketCards ? window.MarketCards.modelOf(x, pool) : null;
        return '<button type="button" class="md-mini" data-jump="' + Calc.listingKey(x) + '">'
          + '<span class="md-mini-tile">' + (mx ? mx.tileHtml : '') + '</span>'
          + '<span class="md-mini-name">' + escapeHtml(mx ? mx.name : '—') + '</span>'
          + '<span class="md-mini-price">' + Number(x.material_qty || 0) + '<small>' + escapeHtml(mat.name) + '</small></span>'
          + '</button>';
      }).join('')
      : '<div class="md-mini-empty">同类暂时没有别的在售</div>';

    box.innerHTML =
      '<div class="md-plate">'
      +   '<div class="md-tile">' + tile + '</div>'
      +   '<div class="md-name"' + nameColor + '>' + nameHtml + '</div>'
      +   '<div class="md-sub"><span class="md-kind">' + kindLabel + '</span>'
      +     (mine ? '<span class="mk-tag-mine">我的</span>' : '')
      +     (window.MarketWatch ? window.MarketWatch.badgeHtml(l) : '')
      +   '</div>'
      + '</div>'
      + '<div class="md-stats">' + rowsOf(l).map(r => '<div class="md-row"><span class="k">' + r[0] + '</span>' + r[1] + '</div>').join('') + '</div>'
      + '<div class="md-buy">' + priceBlock
      +   '<button type="button" class="fs-btn fs-btn--primary md-buy-btn"' + (buyDisabled ? ' disabled' : '') + (buyTip ? ' title="' + buyTip + '"' : '') + '>' + buyLabel + '</button>'
      +   watchBtn
      +   (window.MarketWatch && window.MarketWatch.hitOf(l)
        ? '<div class="md-warn-hit">★ 你关注的这一款降价了（关注时 ' + window.MarketWatch.hitOf(l).was + ' → 现在 ' + qty + '）</div>' : '')
      + '</div>'
      + '<div class="md-sec">同 类 低 价</div>'
      + '<div class="md-mini-list">' + peersHtml + '</div>';

    // 事件
    const buyBtn = box.querySelector('.md-buy-btn');
    if (buyBtn && !buyDisabled) buyBtn.onclick = () => window.MarketPage.onBuyClick(l, buyBtn);
    const fav = box.querySelector('.md-fav');
    if (fav) fav.onclick = () => { window.MarketWatch.toggle(l, true); UI.renderMarket(); };
    box.querySelectorAll('[data-jump]').forEach(el => {
      el.onclick = () => { selectedKey = el.dataset.jump; render(); };
    });
    if (window.MarketCards) window.MarketCards.paintSellerTags(false);   // 吃缓存：右栏刷新很频繁，别每次都打接口
  }

  /* ---------- 只刷「会实时变的数字」，不重建 DOM ----------
   * 右栏里有一样东西**每秒都可能变**：你身上有多少「这种收款材料」（挂机掉材料）。
   * 如果把它塞进整页的重画签名 ⇒ 每秒重建一次整页，等于把闪烁问题原样搬回来；
   * 所以拆成两件事：结构按签名重画（贵、少）、数字每帧就地改（便宜、稳）。
   * ⚠️ 以后右栏要加别的"玩家身上的数字"（例如背包里某物数量），也走这里。 */
  function refreshNumbers() {
    if (!shown) return;
    const el = $('mdHoldNum');
    if (!el) return;
    const mat = Market.findMaterial(shown.material_type);
    if (!mat) return;
    const hold = Materials.getQuantity(mat.name);
    const txt = String(hold);
    if (el.textContent !== txt) el.textContent = txt;
    const short = hold < (Number(shown.material_qty) || 0);
    if (el.classList && el.classList.toggle) el.classList.toggle('is-short', short);
  }

  window.MarketDetail = { select, render, selected, refreshNumbers, selectedKey: () => selectedKey };
})();
