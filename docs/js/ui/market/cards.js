/* ============================================================
 * ui/market/cards.js —— 市集结果区的渲染（分区 / 列表 / 网格）
 * 职责（一件事）：把挂单池画成玩家看得懂的一屏结果
 *   1. 四种商品各一份"展示模型"（宠物 / 装备 / 材料 / 宠物蛋）
 *   2. 两种版式：**列表**（默认，一行一件，比价最顺手）/ **网格**（看立绘）
 *   3. 分区（按类型分块）+ 分页（每区 Config.trade.pageSize 条，超出给「显示更多」）
 *   4. 卖家名牌（渲染后另补，见 paintSellerTags）
 *
 * 模型 → 版式的两层结构是关键：文案只写一遍，列表行与网格卡都从同一份模型出，
 *   不会出现"列表里写了卖家属地、网格里忘了"这种两处不同步的老问题。
 *
 * 【血泪】卖家昵称不在挂单里（只有 seller_id），是服务端 join 出来的。
 *   本地绝不"造"一个名字 —— 名牌靠 paintSellerTags 异步补，失败就只显示原名。
 * 【血泪】成长 8 和成长 3 长得一样大是内测被点名的坑：成长必须比等级显眼。
 * 依赖：MarketCalc / MarketWatch / MarketBatch / MarketDetail；工具来自 ui-common。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml } = UI;
  const Config = window.Config;
  const Market = window.Market;
  const Calc = window.MarketCalc;

  const VIEW_KEY = 'market_view_mode';

  /* ---------- 版式（列表 / 网格）---------- */
  let viewMode = (function () {
    try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch (e) { return 'list'; }
  })();
  function getViewMode() { return viewMode; }
  function setViewMode(m) {
    viewMode = (m === 'grid') ? 'grid' : 'list';
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) { /* 存不下不致命 */ }
  }

  /* ---------- 分页：每个分区各自记「已展开多少条」---------- */
  let shown = { pet: 0, item: 0, material: 0, egg: 0 };
  function resetPaging() { shown = { pet: 0, item: 0, material: 0, egg: 0 }; }

  // 批量挑选模式是否打开（由 index.js 的工具栏切换，这里只读）
  const batchOn = () => !!(window.MarketBatch && window.MarketBatch.isActive());

  /* ---------- 「我的」判定 ----------
   * 四类的判据各不相同（历史原因：字段名不一样），逐类照旧，不改语义。 */
  function isMine(kind, l) {
    if (kind === 'pet') return Market.isListed(l.pet_id);
    if (kind === 'item') return Market.isItemListed(l.item_id);
    if (kind === 'egg') {
      // 假卖家蛋单不标「我的」（isMyEggListed 按蛋品种判，AI 蛋不该命中玩家上架标记）
      return !l.isBot && (Market.isMyEggListed ? Market.isMyEggListed(l.egg_type) : false);
    }
    // 真实玩家挂单带 seller_id，AI 假单不带 → 用它判定「我的」
    const myId = (UI.getAuthUser && UI.getAuthUser() || {}).id;
    return !l.isBot && !!(l.seller_id && myId && String(l.seller_id) === String(myId));
  }

  const RARITY_LABEL = { white: '白装', blue: '蓝装', gold: '金装' };

  /* ============================================================
   * 一、展示模型：把一条挂单翻译成"要给玩家看的那几个字段"
   * ============================================================ */
  function modelOf(l, pool) {
    const kind = Calc.listingKind(l);
    const mine = isMine(kind, l);
    const legacy = !l.material_type;              // 旧版挂单没有收款物字段，不可购买
    const age = Calc.ageLabel(l);
    const sellerId = l.seller_id || '';
    const sellerHtml = l.seller
      ? (sellerId
        ? '<span class="mk-seller-link" data-seller="' + escapeHtml(sellerId) + '">' + escapeHtml(l.seller) + '</span>'
        : escapeHtml(l.seller))
      : (l.isBot ? '流浪商人' : '');

    const m = {
      key: Calc.listingKey(l),
      kind: kind, listing: l, mine: mine, legacy: legacy,
      buyLabel: mine ? '取回' : legacy ? '不可购买' : '购买',
      sellerHtml: sellerHtml, age: age,
      priceQty: Number(l.material_qty || 0),
      mat: Market.findMaterial(l.material_type),
      dealHtml: legacy ? '' : Calc.dealBadge(l, pool),
      watchHtml: window.MarketWatch ? window.MarketWatch.badgeHtml(l) : '',
      starHtml: window.MarketWatch ? window.MarketWatch.starHtml(l) : '',
      canBatch: !mine && !legacy,   // 只有"能买的"才进批量挑选
      name: '', metaHtml: '', subHtml: '', tileHtml: '', tipHtml: '', tipKind: ''
    };

    if (kind === 'pet') {
      m.name = l.pet_name || '未知宠物';
      /* 成长区分度（2026-09-21 内测 🟠6）：
       * ⛔ 不引进"品级" —— 只把玩家判断好坏真正需要的信息摆出来：
       *   ① 成长提亮放大（它是宠物核心价值），比等级显眼；
       *   ② 与同款（同一进化线）在售成长中位数比 → 高于中位给「高于同款」；
       *   ③ 达到神级合成门槛（Config.synthesize.god.minGrowth = 唯一事实源）→「可搏神级宠」。 */
      const godMinG = (Config.synthesize && Config.synthesize.god && Config.synthesize.god.minGrowth) || 60;
      const gVal = Number(l.pet_growth) || 0;
      const peers = (pool || []).filter(x => x !== l && Calc.peerGroupKey(x) === Calc.peerGroupKey(l));
      const gMed = peers.length >= 3 ? Calc.medianQty(peers, x => Number(x.pet_growth || 0)) : null;
      const gHi = gMed != null && gVal > gMed;
      const gGod = gVal >= godMinG;
      m.metaHtml = '<span class="mk-growth">成长 ' + gVal.toFixed(1) + '</span>'
        + (gHi ? '<span class="mk-tag-hi" title="高于同款在售成长中位 ' + Number(gMed).toFixed(1) + '">高于同款</span>' : '')
        + (gGod ? '<span class="mk-tag-god" title="成长 ' + godMinG + ' 起：可在合成里搏一只神级宠">可搏神级宠</span>' : '')
        + ' · Lv.' + (l.pet_level || 1);
      m.traitsHtml = (UI.traitsHtml && l.pet_traits && l.pet_traits.length) ? UI.traitsHtml({ traits: l.pet_traits }) : '';
      const avatar = (window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(l.pet_name) : null;
      m.tileHtml = avatar
        ? '<img class="mk-avatar" src="' + avatar + '" alt="' + escapeHtml(m.name) + '">'
        : '<div class="mk-avatar mk-avatar--item"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 8.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"/><path d="M18.8 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 13.2c-3 0-4.8 1.7-4.8 3.9 0 2.4 1.8 4.4 4.8 4.4s4.8-2 4.8-4.4c0-2.2-1.8-3.9-4.8-3.9z"/></svg></div>';
      m.tipKind = 'pet';
    } else if (kind === 'item') {
      m.name = l.item_name || '未知装备';
      m.nameColor = (Config.equipment.rarities.find(r => r.id === l.item_rarity) || {}).color || '#d8d8d8';
      const affixText = window.Equipment.flattenAffixes(l.item_affixes || [])
        .map(a => window.Equipment.formatAffix ? window.Equipment.formatAffix(a) : (a.label + '+' + a.value + '%'))
        .concat(l.item_soul ? [l.item_soul.label] : []).join(' ');
      m.affixText = affixText;
      m.metaHtml = escapeHtml(l.item_slot || '') + ' · T' + (l.item_tier || '?') + ' · ' + (RARITY_LABEL[l.item_rarity] || l.item_rarity || '');
      m.tileHtml = '<div class="mk-avatar mk-avatar--item">'
        + ((UI.EQUIP_ICON ? UI.EQUIP_ICON[l.item_slot] : null) || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>')
        + '</div>';
      // 装备详情 tooltip（hover 全文词缀）：复用背包那套浮层（UI.bindTip），不另写
      const detailAffixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(l.item_affixes || []) : { prefix: [], suffix: [] };
      const detailLine = (items, cls) => (items || []).map(a => window.Equipment.formatAffixHtml(a, cls)).join('') || '<div class="tip-empty">无</div>';
      const ICONS = UI.EQUIP_ICON || {};
      const iconHtml = '<div class="tip-icon"><span class="ico" style="border-color:' + m.nameColor + '"><span class="emoji">'
        + (ICONS[l.item_slot] || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>')
        + '</span></span></div>';
      m.tipHtml = iconHtml + '<div class="tip-name" style="color:' + m.nameColor + '">' + escapeHtml(m.name) + '</div>'
        + '<div class="tip-line">槽位：<b>' + escapeHtml(l.item_slot || '未知') + '</b></div>'
        + '<div class="tip-line">底材：<b>T' + (l.item_tier || '?') + '</b></div>'
        + '<div class="tip-section">词缀</div>' + detailLine(detailAffixes.prefix, 'tip-prefix')
        + '<hr class="tip-divider">' + detailLine(detailAffixes.suffix, 'tip-suffix')
        + '<div class="tip-section">魂铸</div>'
        + (l.item_soul ? '<div class="tip-affix soul-affix">' + escapeHtml(l.item_soul.label || '') + ' <span class="tip-tier">T' + (l.item_soul.tier || 1) + '</span></div>' : '<div class="tip-empty">无</div>');
      m.tipKind = 'equip';
    } else if (kind === 'egg') {
      m.name = window.Drop.makeEggName(l.egg_type);
      m.metaHtml = '宠物蛋';
      m.tileHtml = '<div class="mk-egg-icon">'
        + ((UI.MAT_ICONS ? UI.MAT_ICONS[m.name] : null) || '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">')
        + '</div>';
    } else {
      m.name = l.good_name || '材料';
      const goodQty = Number(l.good_qty || 1);
      m.goodQty = goodQty;
      m.metaHtml = '材料 ×' + goodQty;
      m.tileHtml = '<div class="mk-egg-icon">'
        + ((UI.MAT_ICONS ? UI.MAT_ICONS[l.good_name] : null) || l.good_icon || Market.findMaterial(l.good_name).icon
          || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m7.5 4.27 9 5.15"/></svg>')
        + '</div>';
    }
    return m;
  }

  function priceHtmlOf(m) {
    if (m.legacy) return '<span class="mk-price">旧版挂单</span>';
    if (!m.mat) return '<span class="mk-price"></span>';
    return '<span class="mk-price">' + m.priceQty + ' <b>' + m.mat.icon + ' ' + m.mat.name + '</b></span>';
  }

  // 通用徽标行：我的 / 关注降价
  function badgesOf(m) {
    return (m.mine ? '<span class="mk-tag-mine">我的</span>' : '') + m.watchHtml;
  }

  /* ============================================================
   * 二、版式：列表行 / 网格卡
   * ============================================================ */
  function renderListRow(m) {
    const div = document.createElement('div');
    div.className = 'mk-row'
      + (m.mine ? ' is-mine' : '')
      + (m.watchHtml ? ' is-watch-hit' : '');
    div.dataset.key = m.key;
    div.setAttribute('tabindex', '0');
    const sellerSide = m.sellerHtml
      ? '<div class="mk-row-side">' + m.sellerHtml + (m.age ? '<small>挂出 ' + m.age + '</small>' : '') + '</div>'
      : '<div class="mk-row-side">' + (m.age ? '<small>挂出 ' + m.age + '</small>' : '') + '</div>';
    const sub = m.kind === 'item'
      ? '<div class="mk-affix mk-affix--row">' + (m.affixText ? escapeHtml(m.affixText) : '<span style="color:var(--text-faint)">无词缀</span>') + '</div>'
      : (m.traitsHtml ? '<div class="mk-traits">' + m.traitsHtml + '</div>' : '');
    div.innerHTML =
      (batchOn() && m.canBatch ? '<label class="mk-pick" title="勾选后可多件一起结账"><input type="checkbox" data-pick="1" aria-label="选中用于批量结账"></label>' : '')
      + '<div class="mk-row-tile">' + m.tileHtml + '</div>'
      + '<div class="mk-row-main">'
      +   '<div class="mk-name-row"><span class="mk-name"' + (m.nameColor ? ' style="color:' + m.nameColor + '"' : '') + '>' + escapeHtml(m.name) + '</span>' + badgesOf(m) + '</div>'
      +   '<div class="mk-meta">' + m.metaHtml + '</div>'
      +   sub
      + '</div>'
      + sellerSide
      + '<div class="mk-row-price">' + priceHtmlOf(m) + '<span class="mk-deal-wrap">' + m.dealHtml + '</span></div>'
      + '<div class="mk-row-acts"><button class="mk-btn ' + (m.mine ? 'recall' : m.legacy ? 'disabled' : 'buy') + '"' + (m.legacy && !m.mine ? ' disabled' : '') + '>' + m.buyLabel + '</button>' + m.starHtml + '</div>';
    return div;
  }

  function renderGridCard(m) {
    const div = document.createElement('div');
    div.className = 'mk-card' + (m.mine ? ' is-mine' : '') + (m.watchHtml ? ' is-watch-hit' : '');
    div.dataset.key = m.key;
    div.setAttribute('tabindex', '0');
    const affix = m.kind === 'item'
      ? '<div class="mk-affix">' + (m.affixText ? escapeHtml(m.affixText) : '<span style="color:var(--text-faint)">无词缀</span>') + '</div>'
      : (m.traitsHtml ? '<div class="mk-traits">' + m.traitsHtml + '</div>' : '');
    div.innerHTML =
      (batchOn() && m.canBatch ? '<label class="mk-pick mk-pick--card" title="勾选后可多件一起结账"><input type="checkbox" data-pick="1" aria-label="选中用于批量结账"></label>' : '')
      + '<div class="mk-card-top">' + m.tileHtml
      +   '<div class="mk-card-info">'
      +     '<div class="mk-name-row"><div class="mk-name"' + (m.nameColor ? ' style="color:' + m.nameColor + '"' : '') + '>' + escapeHtml(m.name) + '</div>' + badgesOf(m) + '</div>'
      +     '<div class="mk-meta">' + m.metaHtml + (m.sellerHtml ? ' · ' + m.sellerHtml : '') + (m.age ? ' · ' + m.age : '') + '</div>'
      +   '</div>'
      + '</div>'
      + affix
      + '<div class="mk-card-foot">' + priceHtmlOf(m) + m.dealHtml
      +   '<button class="mk-btn ' + (m.mine ? 'recall' : m.legacy ? 'disabled' : 'buy') + '"' + (m.legacy && !m.mine ? ' disabled' : '') + '>' + m.buyLabel + '</button>'
      + '</div>'
      + m.starHtml;
    return div;
  }

  // 版式分发 + 事件绑定（关注星标 / 批量勾选 / 点击选中 / 购买取回）
  function decorate(node, m) {
    if (m.tipHtml && UI.bindTip && m.tipKind === 'equip') UI.bindTip(node, m.tipHtml);
    if (m.tipKind === 'pet' && window.PetUI && window.PetUI.bindPetTip) bindPetTipFor(node, m);
    node.classList.toggle('is-sel', !!(window.MarketBatch && window.MarketBatch.has(m.key)));

    // 星标：关注这一款
    const star = node.querySelector('.mk-watch');
    if (star) star.onclick = (e) => {
      e.stopPropagation();
      if (window.MarketWatch) window.MarketWatch.toggle(m.listing, true);
      UI.renderMarket();
    };
    // 勾选：多件一起结账。
    // ⚠️ 用 preventDefault 掐掉 <label> 往 <input> 的转发，只留这一个入口 ——
    //    否则「点标签」会触发两次（标签转发一次 + 冒泡到行一次），勾选一开一关等于没反应。
    const pickWrap = node.querySelector('.mk-pick');
    if (pickWrap && m.canBatch) {
      pickWrap.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePick(m);
      };
    }
    // 行/卡空白处：批量模式下 = 勾选，否则 = 选中看右侧详情
    node.onclick = (e) => {
      if (e.target.closest && (e.target.closest('.mk-btn') || e.target.closest('.mk-watch') || e.target.closest('.mk-pick') || e.target.closest('.mk-seller-link'))) return;
      if (batchOn() && m.canBatch) { togglePick(m); return; }
      if (window.MarketDetail) window.MarketDetail.select(m.listing);
    };
    const btn = node.querySelector('.mk-btn');
    if (btn && !btn.disabled) btn.onclick = (e) => { e.stopPropagation(); window.MarketPage.onBuyClick(m.listing, btn); };
  }

  function togglePick(m) {
    if (window.MarketBatch) window.MarketBatch.toggle(m.key);
    refreshSelection();
  }

  // 宠物悬浮详情：复用宠物共享 tooltip（PetUI.bindPetTip + petTipHtml，不重写）
  function bindPetTipFor(node, m) {
    const l = m.listing;
    const pName = l.pet_name || '';
    const rootName = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(pName) || pName) : pName;
    const pGod = (window.Pet && window.Pet.godInfoOf) ? window.Pet.godInfoOf({ name: pName }) : null;
    const pStarter = (Config.pet.starters || []).find(s => s.name === rootName);
    const pBase = pGod || pStarter || {};
    window.PetUI.bindPetTip(node, {
      name: pName,
      level: Number(l.pet_level) || 1,
      growth: Number(l.pet_growth) || 0,
      lineId: rootName,
      baseHp: pBase.baseHp != null ? pBase.baseHp : 100,
      baseAtk: pBase.baseAtk != null ? pBase.baseAtk : 20,
      baseDef: pBase.baseDef != null ? pBase.baseDef : 10,
      baseSpd: (pGod && pGod.speed) ? pGod.speed : ((Config.pet.speeds && Config.pet.speeds[rootName]) || 40),
      traits: Array.isArray(l.pet_traits) ? l.pet_traits : []
    });
  }

  /* 勾选状态变了：只改受影响的节点 + 刷新结算条，**不整页重渲染**（避免滚动位置被顶掉） */
  let nodeIndex = {};
  function refreshSelection() {
    Object.keys(nodeIndex).forEach(k => {
      const on = window.MarketBatch && window.MarketBatch.has(k);
      nodeIndex[k].classList.toggle('is-sel', !!on);
      const cb = nodeIndex[k].querySelector('[data-pick]');
      if (cb) cb.checked = !!on;
    });
    if (window.MarketBatch) window.MarketBatch.renderBar();
  }

  /* ============================================================
   * 三、分区渲染（含分页）
   * ============================================================ */
  function renderSection(box, group) {
    const size = Number((Config.trade && Config.trade.pageSize) || 12);
    const list = group.list;
    const visible = list.slice(0, Math.max(size, (shown[group.key] || 0) + size));
    const sec = document.createElement('div');
    sec.className = 'mk-section';
    sec.innerHTML = group.title + '<span class="mk-count">' + list.length + ' 件'
      + (visible.length < list.length ? '（已显示 ' + visible.length + '）' : '') + '</span>';
    box.appendChild(sec);

    const wrap = document.createElement('div');
    wrap.className = viewMode === 'grid' ? 'mk-grid' : 'mk-list';
    for (const l of visible) {
      const m = modelOf(l, group.pool);
      const node = viewMode === 'grid' ? renderGridCard(m) : renderListRow(m);
      decorate(node, m);
      if (m.key) nodeIndex[m.key] = node;
      wrap.appendChild(node);
    }
    box.appendChild(wrap);
    if (visible.length < list.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'mk-more';
      more.innerHTML = '显示更多（还剩 ' + (list.length - visible.length) + ' 件）';
      more.onclick = () => { shown[group.key] = visible.length; UI.renderMarket(); };
      box.appendChild(more);
    }
  }

  /* 画整块结果区。groups = [{key, title, list, pool}]，都是**已筛选已排序**的池子。 */
  function renderResults(box, groups) {
    box.innerHTML = '';
    nodeIndex = {};
    const nonEmpty = groups.filter(g => g.list.length);
    nonEmpty.forEach(g => renderSection(box, g));

    const total = nonEmpty.reduce((n, g) => n + g.list.length, 0);
    if (!total) {
      /* 零结果要讲清楚是「筛选太窄」还是「真的没货」——
       * 以前一律写「没有符合条件的商品」，玩家（连作者本人）都会以为市场挂了，
       * 实际多半是自己勾了「底材 T1」这类极窄条件。改过筛选就给一键清空。 */
      const dirty = window.MarketFacets.isDirty();
      box.innerHTML = dirty
        ? '<div class="mk-empty">没有符合当前筛选的商品<small>筛选条件可能太窄了，比如底材 T 阶只勾了 T1</small><button class="btn-mini" id="mk-clear-filters">清空筛选</button></div>'
        : '<div class="mk-empty">当前没有商品在售</div>';
      const clearBtn = document.getElementById('mk-clear-filters');
      if (clearBtn) clearBtn.onclick = () => window.MarketFacets.reset();
    }
    return total;
  }

  /* ---------- 卖家名牌（2026-09-20） ----------
   * 牌子的颜色画在 `.mk-seller-link[data-seller]` 上，**渲染后补齐**而不是渲染前 await：
   * renderMarket 是同步函数、被 renderAll 直接调用，改成异步会让整页渲染推迟一帧
   * （点筛选会看到闪动），而名牌只是锦上添花。
   * ⚠️ 节点文本已经过一次转义，读回来的 textContent 是原文，再交给 UI.nameTag（它内部转义）。
   *
   * 2026-09-23 加缓存：`Supabase.fetchPerksOf` **内部没有缓存**（supabase.js:557，每次调用都打接口）。
   * 而整页现在"数据没变就不重画"，跳过的那些帧仍要负责把新节点的名牌补上 ——
   * 不缓存就会变成每秒一个请求。现在：真实渲染时取一次新的，跳过的帧只吃缓存。
   * `data-tag-key` 记住已画过的牌子，重复调用是空操作（不再每次重写 innerHTML）。 */
  let perksCache = null, perksAt = 0;
  const PERKS_TTL = 30000;

  function paintSellerTags(fresh) {
    if (!UI.nameTag || !window.Supabase || !window.Supabase.fetchPerksOf) return;
    const nodes = Array.prototype.slice.call(document.querySelectorAll('.mk-seller-link[data-seller]'));
    if (!nodes.length) return;
    const paint = map => {
      if (!map) return;
      nodes.forEach(n => {
        const key = map[n.dataset.seller];
        // 没有名牌、或已经画过同一个牌子 → 不动（避免每秒重写一遍 DOM）
        if (!key || n.dataset.tagKey === key) return;
        n.dataset.tagKey = key;
        n.innerHTML = UI.nameTag(n.textContent, key);
      });
    };
    if (!fresh && perksCache && (Date.now() - perksAt) < PERKS_TTL) { paint(perksCache); return; }
    const uids = [];
    nodes.forEach(n => { const id = n.dataset.seller; if (id && uids.indexOf(id) < 0) uids.push(id); });
    window.Supabase.fetchPerksOf(uids).then(map => {
      perksCache = map || {};
      perksAt = Date.now();
      paint(perksCache);
    }).catch(() => { /* 名牌失败静默：卖家名照常显示 */ });
  }

  window.MarketCards = {
    getViewMode, setViewMode, resetPaging, renderResults, paintSellerTags,
    modelOf, isMine, refreshSelection,
    // 分页进度也要进"没变就不重画"的签名，否则点「显示更多」/切筛选后复位分页都不会重画
    pagingSignature: () => JSON.stringify(shown)
  };

  /* sell.js 按老写法从 window.MarketUI 取 makeMarketGroup（它在本文件加载前就解构了，
   * 所以必须在这里挂上去，否则那边永远是 undefined）。 */
  const MarketUI = window.MarketUI || (window.MarketUI = {});
  // 可折叠分组面板（「我的上架」用）：标题 + 数量 + 收起/展开
  MarketUI.makeMarketGroup = function (title, count, open) {
    if (open === undefined) open = true;
    const g = document.createElement('div');
    g.className = 'market-group' + (open ? ' is-open' : '');
    g.innerHTML = '<div class="market-group-head"><span class="arrow">' + (open ? '▾' : '▸') + '</span><span>' + title + '</span><span class="count">' + count + ' 件</span><button class="btn-mini ghost market-group-toggle">' + (open ? '收起' : '展开') + '</button></div><div class="market-group-body"></div>';
    const toggle = () => {
      const isOpen = g.classList.toggle('is-open');
      const arrow = g.querySelector('.arrow');
      if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
      const btn = g.querySelector('.market-group-toggle');
      if (btn) btn.textContent = isOpen ? '收起' : '展开';
    };
    g.querySelector('.market-group-head').addEventListener('click', e => {
      if (e.target.closest('.market-group-toggle')) return;
      toggle();
    });
    g.querySelector('.market-group-toggle').addEventListener('click', e => { e.stopPropagation(); toggle(); });
    return g;
  };
})();
