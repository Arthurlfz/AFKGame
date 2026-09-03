/* ============================================================
 * ui/ui-market.js —— 市集页 UI（宠物 + 装备交易 / 我的上架 / 交易记录）
 * 职责：
 *  1. 市集页 = 交易市场 + 我的上架 合并（顶部级联筛选条 + 视图切换）
 *  2. 在售列表（宠物区 + 装备区 + 蛋，购买 / 取回）
 *  3. 我的上架视图（挂单 / 取回的唯一入口，复用 ui-market-sell.js）
 *  4. 交易记录面板（卖出 / 买入 / 汇总）
 *  5. 购买确认框（商品价格 / 交易税 / 买家需支付 / 卖家将收到）
 * 依赖：market / pet / equipment（只读查询与流程接口）；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const Market = window.Market;
  const Materials = window.Materials;
  const { getPets } = window.Pet;
  const { getInventory, flattenAffixes, rarityOf } = window.Equipment;
  const EQUIP_SLOTS = (window.Equipment.SLOTS || []); // 12 部位（武器/戒指/项链/头盔/护甲/盾牌/靴子/腰带/斗篷/饰品/护符/徽章）

  const MARKET_FILTER_KEY = 'marketFilters';
  const MARKET_FILTER_DEFAULT = {
    kind: 'all',
    slot: 'all',
    rarity: 'all',
    tier: 'all',
    baseTier: 'all',      // 底材T阶 all/'1'~'5'（词缀T阶筛选：最高词缀T ≤ 目标）
    growth: 'desc',
    sort: 'latest',
    affixFilters: [],     // POE式词缀条件：[{type, min, max}]，可与/或组合（默认与）
    trait: 'all',         // 宠物血脉特质筛选：'all' / 特质 id / 'none'（无特质捡漏）
  };

  let marketFilters = loadMarketFilters();
  let marketView = 'all'; // 'all' 全部在售 | 'mine' 我的上架（并入市集）

  function loadMarketFilters() {
    try {
      return Object.assign({}, MARKET_FILTER_DEFAULT, JSON.parse(localStorage.getItem(MARKET_FILTER_KEY) || '{}'));
    } catch {
      return { ...MARKET_FILTER_DEFAULT };
    }
  }

  function saveMarketFilters() {
    try { localStorage.setItem(MARKET_FILTER_KEY, JSON.stringify(marketFilters)); } catch {}
  }

  // 级联语义：改更高级别时，自动重置其下级，避免互相矛盾的过滤条件
  function setMarketFilter(key, value) {
    const next = Object.assign({}, marketFilters, { [key]: value });
    if (key === 'kind') {
      next.slot = 'all';
      next.rarity = 'all';
      next.tier = 'all';
      next.baseTier = 'all';
      next.trait = 'all';
      next.affixFilters = [];
    }
    marketFilters = next;
    saveMarketFilters();
    UI.renderAll();
  }

  function resetMarketFilters() {
    marketFilters = { ...MARKET_FILTER_DEFAULT };
    saveMarketFilters();
    UI.renderAll();
  }

  function setMarketView(v) {
    marketView = (v === 'mine') ? 'mine' : 'all';
    UI.renderMarket();
  }
  UI.setMarketView = setMarketView;
  UI.getMarketView = function () { return marketView; };
  UI.getMarketFilters = function () { return marketFilters; };

  function normalizeTier(v) { return Number(String(v || '').replace(/^T/i, '')) || 0; }

  function getListingTime(listing) {
    return listing.created_at || listing.createdAt || listing.createdAtMs || listing.updated_at || 0;
  }

  function matchMarketListing(l) {
    if (marketFilters.kind === 'pet' && !l.pet_id) return false;
    if (marketFilters.kind === 'item' && !l.item_id) return false;
    if (marketFilters.keyword) {
      const kw = String(marketFilters.keyword).trim().toLowerCase();
      if (kw) {
        const hay = String(l.item_name || l.pet_name || '').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
    }
    if (l.pet_id && marketFilters.trait !== 'all') {
      const tids = (l.pet_traits || []).map(t => t && t.id);
      if (marketFilters.trait === 'none') { if (tids.length) return false; }
      else if (tids.indexOf(marketFilters.trait) < 0) return false;
    }
    if (l.item_id) {
      if (marketFilters.slot !== 'all' && String(l.item_slot || l.slot || '').toLowerCase() !== marketFilters.slot) return false;
      if (marketFilters.rarity !== 'all' && String(l.item_rarity || '').toLowerCase() !== marketFilters.rarity) return false;
      // 底材T = item_tier（eq.tier 即 materialTier）
      if (marketFilters.tier !== 'all' && normalizeTier(l.item_tier || l.tier) !== Number(marketFilters.tier.slice(1))) return false;
      const affs = flattenAffixes(l.item_affixes || l.affixes || []);
      // 词缀T = 装备里最高词缀T（best=数字最小），作为"词缀T阶"筛选
      if (marketFilters.baseTier !== 'all') {
        let best = Infinity;
        for (const a of affs) best = Math.min(best, a.tier || 5);
        if (best === Infinity) best = 5;
        if (best > Number(marketFilters.baseTier)) return false;
      }
      const condOk = af => {
        const aff = affs.find(a => a.type === af.type);
        if (!aff) return false;
        const v = Number(aff.value);
        if (af.min != null && v < Number(af.min)) return false;
        if (af.max != null && v > Number(af.max)) return false;
        return true;
      };
      if ((marketFilters.affixFilters || []).some(af => !condOk(af))) return false;
    }
    return true;
  }

  function sortMarketListings(list) {
    const arr = list.slice();
    if (marketFilters.kind === 'pet') {
      // 宠物只按成长排序（成长是宠物核心价值）
      if (marketFilters.growth === 'asc') arr.sort((a, b) => Number(a.pet_growth || 0) - Number(b.pet_growth || 0));
      else if (marketFilters.growth === 'desc') arr.sort((a, b) => Number(b.pet_growth || 0) - Number(a.pet_growth || 0));
      return arr;
    }
    // 装备 / 混合视图：价格或最新
    if (marketFilters.sort === 'price-asc') arr.sort((a, b) => Number(a.material_qty || 0) - Number(b.material_qty || 0));
    else if (marketFilters.sort === 'price-desc') arr.sort((a, b) => Number(b.material_qty || 0) - Number(a.material_qty || 0));
    else arr.sort((a, b) => new Date(getListingTime(b)).getTime() - new Date(getListingTime(a)).getTime());
    return arr;
  }

  /* ============================================================
   * 顶部级联筛选条
   * ============================================================ */
  function stepVal(st, v) {
    if (v === 'all' || v == null) return '';
    if (st.key === 'sort' || st.key === 'growth') {
      const o = (st.opts || []).find(x => x.id === v);
      return o ? o.label : v;
    }
    if (st.key === 'trait' && v === 'none') return '无特质';
    if (st.key === 'kind') return v === 'pet' ? '宠物' : v === 'item' ? '装备' : v;
    return v;
  }

  function renderFilterPath(box) {
    const chips = [];
    const push = (key, label) => chips.push({ key, label });
    if (marketFilters.kind !== 'all') push('kind', marketFilters.kind === 'pet' ? '宠物' : '装备');
    if (marketFilters.kind === 'pet') {
      if (marketFilters.trait !== 'all') {
        const t = marketFilters.trait === 'none' ? '无特质' : ((Config.petTraits || {})[marketFilters.trait]?.label || marketFilters.trait);
        push('trait', t);
      }
    } else if (marketFilters.kind === 'item') {
      if (marketFilters.slot !== 'all') push('slot', marketFilters.slot);
      if (marketFilters.rarity !== 'all') push('rarity', { white: '白装', blue: '蓝装', gold: '金装' }[marketFilters.rarity] || marketFilters.rarity);
      if (marketFilters.tier !== 'all') push('tier', marketFilters.tier);
      if (marketFilters.baseTier !== 'all') push('baseTier', '词缀含T' + marketFilters.baseTier);
    }
    if ((marketFilters.affixFilters || []).length) push('affixFilters', '词缀条件 ' + marketFilters.affixFilters.length + ' 条');

    box.innerHTML = '';
    if (!chips.length) {
      box.innerHTML = '<span class="cf-path-empty">未设置筛选，展示全部</span>';
      return;
    }
    chips.forEach(c => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cf-chip';
      el.dataset.anim = '1';
      el.setAttribute('aria-label', '移除筛选 ' + c.label);
      el.innerHTML = c.label + '<span class="cf-chip-x">✕</span>';
      el.onclick = () => setMarketFilter(c.key, 'all');
      box.appendChild(el);
    });
  }

  // POE式词缀条件行：typeahead 选词缀 + min/max 数值范围，可加多条（默认"与"=全部满足）
  function renderAffixFilterRows(container) {
    if (!container) return;
    container.innerHTML = '';
    const AFFIX_POOL = window.Equipment.AFFIX_POOL || [];
    const filters = marketFilters.affixFilters || [];
    const wrap = document.createElement('div');
    wrap.className = 'affix-filter-wrap';

    const renderRow = (af, idx) => {
      const row = document.createElement('div');
      row.className = 'affix-filter-row';
      const sel = document.createElement('select');
      sel.className = 'affix-type-sel';
      sel.setAttribute('aria-label', '词缀类型');
      sel.innerHTML = AFFIX_POOL.map(a => `<option value="${a.type}" ${a.type === af.type ? 'selected' : ''}>${a.label}</option>`).join('');
      sel.onchange = () => { af.type = sel.value; saveMarketFilters(); UI.renderAll(); };
      const min = document.createElement('input');
      min.className = 'affix-min'; min.type = 'number'; min.placeholder = 'min';
      min.value = af.min != null ? af.min : '';
      min.setAttribute('aria-label', '最小值');
      min.oninput = () => { af.min = min.value === '' ? null : Number(min.value); saveMarketFilters(); UI.renderAll(); };
      const max = document.createElement('input');
      max.className = 'affix-max'; max.type = 'number'; max.placeholder = 'max';
      max.value = af.max != null ? af.max : '';
      max.setAttribute('aria-label', '最大值');
      max.oninput = () => { af.max = max.value === '' ? null : Number(max.value); saveMarketFilters(); UI.renderAll(); };
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn-mini ghost affix-del'; del.textContent = '✕';
      del.setAttribute('aria-label', '删除该词缀条件');
      del.onclick = () => { marketFilters.affixFilters.splice(idx, 1); saveMarketFilters(); UI.renderAll(); };
      row.appendChild(sel); row.appendChild(min); row.appendChild(max); row.appendChild(del);
      return row;
    };

    filters.forEach((af, i) => wrap.appendChild(renderRow(af, i)));
    if (!filters.length) {
      const hint = document.createElement('div');
      hint.className = 'hint affix-empty';
      hint.textContent = '选词缀 + 数值范围，可叠加多条（全部满足才算命中）';
      wrap.appendChild(hint);
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn-mini alt affix-add'; add.textContent = '+ 添加词缀条件';
    add.onclick = () => {
      const pool = AFFIX_POOL[0];
      marketFilters.affixFilters = [...(marketFilters.affixFilters || []), { type: pool ? pool.type : 'atk', min: null, max: null }];
      saveMarketFilters(); UI.renderAll();
    };
    wrap.appendChild(add);
    container.appendChild(wrap);
  }

  function renderMarketFilterPanel() {
    const panel = $('market-filters');
    const stepsWrap = $('cfSteps');
    const pathBox = $('cfPath');
    if (!panel || !stepsWrap || !pathBox) return;

    const kind = marketFilters.kind;
    const steps = [];

    steps.push({
      key: 'kind', label: '类型',
      get: () => marketFilters.kind, set: v => setMarketFilter('kind', v),
      opts: [
        { id: 'all', label: '全部' },
        { id: 'pet', label: '宠物' },
        { id: 'item', label: '装备' },
      ],
    });

    if (kind === 'pet') {
      steps.push({
        key: 'trait', label: '特质',
        get: () => marketFilters.trait, set: v => setMarketFilter('trait', v),
        opts: [
          { id: 'all', label: '全部' },
          ...Object.keys(Config.petTraits || {}).map(id => ({ id, label: (Config.petTraits[id].label || id) })),
          { id: 'none', label: '无特质（捡漏）' },
        ],
      });
      steps.push({
        key: 'growth', label: '成长排序',
        get: () => marketFilters.growth, set: v => setMarketFilter('growth', v),
        opts: [
          { id: 'desc', label: '成长高→低' },
          { id: 'asc', label: '成长低→高' },
        ],
      });
    } else if (kind === 'item') {
      steps.push({
        key: 'slot', label: '部位',
        get: () => marketFilters.slot, set: v => setMarketFilter('slot', v),
        opts: [{ id: 'all', label: '全部' }, ...EQUIP_SLOTS.map(s => ({ id: s, label: s }))],
      });
      steps.push({
        key: 'rarity', label: '稀有度',
        get: () => marketFilters.rarity, set: v => setMarketFilter('rarity', v),
        opts: [
          { id: 'all', label: '全部' },
          { id: 'white', label: '白装' },
          { id: 'blue', label: '蓝装' },
          { id: 'gold', label: '金装' },
        ],
      });
      steps.push({
        key: 'tier', label: '底材T阶',
        get: () => marketFilters.tier, set: v => setMarketFilter('tier', v),
        opts: [{ id: 'all', label: '全部' }, ...['T1', 'T2', 'T3', 'T4', 'T5'].map(t => ({ id: t, label: t }))],
      });
      steps.push({
        key: 'baseTier', label: '词缀T阶',
        get: () => marketFilters.baseTier, set: v => setMarketFilter('baseTier', v),
        opts: [{ id: 'all', label: '全部' }, ...['T1', 'T2', 'T3', 'T4', 'T5'].map(t => ({ id: t, label: '含T' + t }))],
      });
      steps.push({
        key: 'sort', label: '排序',
        get: () => marketFilters.sort, set: v => setMarketFilter('sort', v),
        opts: [
          { id: 'latest', label: '最新上架' },
          { id: 'price-asc', label: '价格低→高' },
          { id: 'price-desc', label: '价格高→低' },
        ],
      });
    } else {
      steps.push({
        key: 'sort', label: '排序',
        get: () => marketFilters.sort, set: v => setMarketFilter('sort', v),
        opts: [
          { id: 'latest', label: '最新上架' },
          { id: 'price-asc', label: '价格低→高' },
          { id: 'price-desc', label: '价格高→低' },
        ],
      });
    }

    stepsWrap.innerHTML = '';
    steps.forEach((st, i) => {
      const el = document.createElement('div');
      el.className = 'cf-step';
      el.dataset.step = st.key;
      el.style.setProperty('--i', i);
      el.dataset.anim = '1';

      const v = st.get();
      const val = stepVal(st, v);
      const isSet = v !== 'all' && v != null;
      // 排序/成长这类"总有值"的步骤不算级联节点激活
      const nodeSet = isSet && st.key !== 'sort' && st.key !== 'growth';

      let optsHtml = '';
      st.opts.forEach(o => {
        const active = v === o.id ? ' active' : '';
        optsHtml += '<button type="button" class="cf-opt' + active + '" data-key="' + st.key + '" data-val="' + o.id + '" aria-pressed="' + (v === o.id) + '">' + o.label + '</button>';
      });

      let bodyHtml = '';
      if (st.key === 'kind' && kind === 'all') {
        bodyHtml += '<div class="cf-branch-hint">选择 宠物 或 装备 后，下级筛选（特质 / 部位 / 稀有度 / T阶 / 词缀）逐级展开</div>';
      }
      bodyHtml += '<div class="cf-opts">' + optsHtml + '</div>';

      el.innerHTML =
        '<div class="cf-head">' +
          '<span class="cf-node' + (nodeSet ? ' is-set' : '') + '"></span>' +
          '<span class="cf-label-name">' + st.label + '</span>' +
          '<span class="cf-label-val' + (val ? '' : ' is-empty') + '">' + (val || (st.key === 'sort' || st.key === 'growth' ? '默认' : '')) + '</span>' +
          (nodeSet ? '<button type="button" class="cf-clear" data-clear="' + st.key + '" aria-label="清除' + st.label + '筛选">✕</button>' : '') +
        '</div>' +
        bodyHtml;

      stepsWrap.appendChild(el);
    });

    // 词缀条件特殊步骤（item 分支末尾）
    if (kind === 'item') {
      const el = document.createElement('div');
      el.className = 'cf-step';
      el.dataset.step = 'affix';
      el.style.setProperty('--i', steps.length);
      el.dataset.anim = '1';
      const hasAffix = (marketFilters.affixFilters || []).length > 0;
      el.innerHTML =
        '<div class="cf-head">' +
          '<span class="cf-node' + (hasAffix ? ' is-set' : '') + '"></span>' +
          '<span class="cf-label-name">词缀条件</span>' +
          '<span class="cf-label-val' + (hasAffix ? '' : ' is-empty') + '">' + (hasAffix ? (marketFilters.affixFilters.length + ' 条') : '') + '</span>' +
          (hasAffix ? '<button type="button" class="cf-clear" data-clear-affix="1" aria-label="清除词缀条件">✕</button>' : '') +
        '</div>' +
        '<div class="cf-affix-body"></div>';
      stepsWrap.appendChild(el);
      renderAffixFilterRows(el.querySelector('.cf-affix-body'));
    }

    // 绑定：选项
    stepsWrap.querySelectorAll('.cf-opt').forEach(btn => {
      btn.onclick = () => setMarketFilter(btn.dataset.key, btn.dataset.val);
    });
    // 绑定：单级清除
    stepsWrap.querySelectorAll('.cf-clear').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.clear;
        if (k) setMarketFilter(k, 'all');
      };
    });
    const affixClear = stepsWrap.querySelector('[data-clear-affix]');
    if (affixClear) affixClear.onclick = () => setMarketFilter('affixFilters', []);

    renderFilterPath(pathBox);
    bindMarketControls();
  }

  // 搜索框 / 清空 / 视图切换 / 交易信息折叠（每次渲染都会刷新绑定，幂等）
  function bindMarketControls() {
    const kwInput = $('market-keyword');
    if (kwInput) {
      if (document.activeElement !== kwInput) kwInput.value = marketFilters.keyword || '';
      kwInput.oninput = () => {
        marketFilters = Object.assign({}, marketFilters, { keyword: kwInput.value });
        saveMarketFilters();
        UI.renderMarket();
        UI.renderTradeRecords();
      };
    }
    const resetBtn = $('cfReset');
    if (resetBtn) resetBtn.onclick = () => resetMarketFilters();

    const vtBox = $('viewToggle');
    if (vtBox) {
      Array.prototype.forEach.call(vtBox.querySelectorAll('.vt'), b => {
        b.onclick = () => setMarketView(b.dataset.view);
      });
    }

    const infoPanel = $('market-info');
    const infoToggle = $('infoToggle');
    if (infoPanel && infoToggle && !infoPanel.dataset.infoInit) {
      infoPanel.dataset.infoInit = '1';
      infoToggle.onclick = () => {
        const open = infoPanel.classList.toggle('is-open');
        const arrow = $('infoArrow');
        if (arrow) arrow.textContent = open ? '▾' : '▸';
      };
    }
  }

  /* ============================================================
   * 视图切换 + 结果渲染
   * ============================================================ */
  function renderViewToggle() {
    const box = $('viewToggle');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.vt'), b => {
      const on = marketView === b.dataset.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  /* ---------- 装备卡片 ---------- */
  function buildItemCard(l, RARITY_LABEL) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const color = Config.equipment.rarities.find(r => r.id === l.item_rarity)?.color || '#d8d8d8';
    const affixText = flattenAffixes(l.item_affixes || []).map(a => window.Equipment.formatAffix ? window.Equipment.formatAffix(a) : `${a.label}+${a.value}%`)
      .concat(l.item_soul ? [l.item_soul.label] : []).join(' ');
    const mat = Market.findMaterial(l.material_type);
    const legacy = !l.material_type;
    const mine = Market.isItemListed(l.item_id);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const priceHtml = legacy
      ? '<span class="mk-price">旧版挂单</span>'
      : `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>`;
    const btnText = mine ? '取回' : legacy ? '不可购买' : '购买';
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-avatar mk-avatar--item">⚔️</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name" style="color:${color}">${escapeHtml(l.item_name || '未知装备')}</div>${mineTag}</div>
          <div class="mk-meta">${escapeHtml(l.item_slot || '')} · T${l.item_tier || '?'} · ${RARITY_LABEL[l.item_rarity] || l.item_rarity}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}</div>
        </div>
      </div>
      <div class="mk-affix">${affixText ? escapeHtml(affixText) : '<span style="color:var(--text-faint)">无词缀</span>'}</div>
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : legacy ? 'disabled' : 'buy'}" ${legacy && !mine ? 'disabled' : ''}>${btnText}</button></div>`;
    // 装备详情 tooltip（hover 显示完整词缀）
    const marketTip = document.createElement('div');
    marketTip.className = 'equip-tip';
    const detailAffixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(l.item_affixes || []) : { prefix: [], suffix: [] };
    const detailLine = (items, cls) => (items || []).map(a => window.Equipment.formatAffixHtml(a, cls)).join('') || '<div class="tip-empty">无</div>';
    marketTip.innerHTML = `<div class="tip-name" style="color:${color}">${escapeHtml(l.item_name || '未知装备')}</div><div class="tip-line">槽位：<b>${escapeHtml(l.item_slot || '未知')}</b></div><div class="tip-line">底材：<b>T${l.item_tier || '?'}</b></div><div class="tip-section">词缀</div>${detailLine(detailAffixes.prefix, 'tip-prefix')}${detailLine(detailAffixes.suffix, 'tip-suffix')}${l.item_soul ? `<div class="tip-section">魂铸</div><div class="tip-affix soul-affix">${escapeHtml(l.item_soul.label || '')} <span class="tip-tier">T${l.item_soul.tier || 1}</span></div>` : ''}`;
    div.appendChild(marketTip);
    const btn = div.querySelector('.mk-btn');
    btn.onclick = async () => {
      if (mine) {
        const res = await Market.cancelItem(l.id);
        if (res.error) { showToast('❌ 取回失败', res.error); return; }
        showToast('↩️ 已取回', `${l.item_name} 已下架`);
        UI.renderAll();
        return;
      }
      if (legacy) { showToast('❌ 无法购买', '这是旧版价格挂单，请联系卖家重新上架'); return; }
      if (!UI.isLoggedIn()) { showToast('❌ 需要登录', '登录后才能购买装备'); return; }
      openBuyConfirm('item', l);
    };
    return div;
  }

  /* ---------- 宠物卡片 ---------- */
  function buildPetCard(l) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const avatar = window.PetSprites && window.PetSprites.avatarOf ? window.PetSprites.avatarOf(l.pet_name) : null;
    const mat = Market.findMaterial(l.material_type);
    const legacy = !l.material_type;
    const mine = Market.isListed(l.pet_id);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const priceHtml = legacy
      ? '<span class="mk-price">旧版挂单</span>'
      : `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>`;
    const traitsHtml = (UI.traitsHtml && l.pet_traits && l.pet_traits.length) ? `<div class="mk-traits">${UI.traitsHtml({ traits: l.pet_traits })}</div>` : '';
    div.innerHTML = `
      <div class="mk-card-top">
        ${avatar ? `<img class="mk-avatar" src="${avatar}" alt="${escapeHtml(l.pet_name)}">` : '<div class="mk-avatar mk-avatar--item">🐾</div>'}
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(l.pet_name)}</div>${mineTag}</div>
          <div class="mk-meta">成长${l.pet_growth} · Lv.${l.pet_level}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}</div>
        </div>
      </div>
      ${traitsHtml}
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : legacy ? 'disabled' : 'buy'}" ${legacy && !mine ? 'disabled' : ''}>${mine ? '取回' : legacy ? '不可购买' : '购买'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = async () => {
      if (mine) {
        const res = await Market.cancelPet(l.id);
        if (res.error) { showToast('❌ 取回失败', res.error); return; }
        showToast('↩️ 已取回', `${l.pet_name} 已下架`);
        UI.renderAll();
        return;
      }
      if (legacy) { showToast('❌ 无法购买', '这是旧版价格挂单，请联系卖家重新上架'); return; }
      if (!UI.isLoggedIn()) { showToast('❌ 需要登录', '登录后才能购买宠物'); return; }
      openBuyConfirm('pet', l);
    };
    return div;
  }

  /* ---------- 宠物蛋卡片 ---------- */
  function buildEggCard(l) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    // 假卖家蛋单不标"我的"（isMyEggListed 按蛋品种判，AI 蛋不该命中玩家上架标记）
    const mine = !l.isBot && (Market.isMyEggListed ? Market.isMyEggListed(l.egg_type) : false);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const mat = Market.findMaterial(l.material_type);
    const priceHtml = mat ? `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>` : '<span class="mk-price"></span>';
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon">${l.egg_icon || '🥚'}</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(window.Drop.makeEggName(l.egg_type))}</div>${mineTag}</div>
          <div class="mk-meta">宠物蛋${l.seller ? ' · ' + escapeHtml(l.seller) : ''}</div>
        </div>
      </div>
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : 'buy'}">${mine ? '取回' : '购买'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = async () => {
      if (mine) {
        const res = await Market.cancelEgg(l.id);
        if (res.error) showToast('❌ 取回失败', res.error);
        else { showToast('↩️ 已取回', `${window.Drop.makeEggName(l.egg_type)} 已下架`); UI.renderAll(); }
        return;
      }
      const res = l.isBot ? await Market.buyBotEgg(l.id) : await Market.buyEgg(l.id);
      if (res.error) showToast('❌ 购买失败', res.error);
      else { showToast('🥚 购买成功', `获得 ${window.Drop.makeEggName(l.egg_type)}，去「宠物 → 宠物蛋」孵化`); UI.renderAll(); }
    };
    return div;
  }

  /* ---------- 材料商品卡片（AI 假卖家挂单，2026-09-03 二阶段） ---------- */
  function buildMaterialCard(l) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const mat = Market.findMaterial(l.material_type);
    const priceHtml = mat ? `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>` : '<span class="mk-price"></span>';
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon">${l.good_icon || '📦'}</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(l.good_name)}</div></div>
          <div class="mk-meta">材料 ×${l.good_qty || 1}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}</div>
        </div>
      </div>
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn buy">购买</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = async () => {
      if (!UI.isLoggedIn()) { showToast('❌ 需要登录', '登录后才能购买'); return; }
      const res = await Market.buyBotMaterial(l.id);
      if (res.error) showToast('❌ 购买失败', res.error);
      else { showToast('🎉 购买成功', `获得 ${l.good_qty || 1} × ${l.good_name}`); UI.renderAll(); }
    };
    return div;
  }

  /* ---------- 装备挂单网格（供 UI.renderItemMarket 复用） ---------- */
  function renderItemMarket(container) {
    const box = container || $('market-items');
    if (!box) return;
    box.innerHTML = '';
    const list = sortMarketListings(Market.getItemListings().filter(matchMarketListing));
    if (!list.length) {
      box.innerHTML = '<div class="mk-empty">没有符合条件的装备</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'mk-grid';
    const RARITY_LABEL = { white: '白装', blue: '蓝装', gold: '金装' };
    for (const l of list) grid.appendChild(buildItemCard(l, RARITY_LABEL));
    box.appendChild(grid);
  }

  // 可折叠分组面板（宠物/装备左右两列）：标题 + 数量 + 「收起/展开」按钮
  function makeMarketGroup(title, count, open = true) {
    const g = document.createElement('div');
    g.className = 'market-group' + (open ? ' is-open' : '');
    g.innerHTML = `<div class="market-group-head"><span class="arrow">${open ? '▾' : '▸'}</span><span>${title}</span><span class="count">${count} 件</span><button class="btn-mini ghost market-group-toggle">${open ? '收起' : '展开'}</button></div><div class="market-group-body"></div>`;
    const toggle = () => {
      const open = g.classList.toggle('is-open');
      const arrow = g.querySelector('.arrow');
      if (arrow) arrow.textContent = open ? '▾' : '▸';
      const btn = g.querySelector('.market-group-toggle');
      if (btn) btn.textContent = open ? '收起' : '展开';
    };
    g.querySelector('.market-group-head').addEventListener('click', e => {
      if (e.target.closest('.market-group-toggle')) return; // 按钮自己处理
      toggle();
    });
    g.querySelector('.market-group-toggle').addEventListener('click', e => {
      e.stopPropagation();
      toggle();
    });
    return g;
  }

  function renderMarket() {
    renderMarketFilterPanel();
    const box = $('market-list');
    if (!box) return;
    box.innerHTML = '';
    renderViewToggle();

    // 我的上架视图：渲染上架/取回区（复用 ui-market-sell.js 的 renderSellArea）
    if (marketView === 'mine') {
      const cnt = $('rpCount');
      if (cnt) cnt.textContent = '';
      if (UI.renderSellArea) UI.renderSellArea(box);
      else box.innerHTML = '<div class="mk-empty">上架功能未加载</div>';
      return;
    }

    // 全部在售：宠物 + 装备 + 蛋
    const list = sortMarketListings(Market.getListings().filter(matchMarketListing));
    const items = sortMarketListings(Market.getItemListings().filter(matchMarketListing));
    const eggList = Market.getEggListings ? Market.getEggListings() : [];
    const mats = Market.getBotMaterialListings ? Market.getBotMaterialListings() : [];
    const pets = list.filter(l => l.pet_id);
    const RARITY_LABEL = { white: '白装', blue: '蓝装', gold: '金装' };

    const cnt = $('rpCount');
    if (cnt) cnt.textContent = '共 ' + (pets.length + items.length + eggList.length + mats.length) + ' 件';

    if (pets.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '🐾 宠物<span class="mk-count">' + pets.length + ' 件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const l of pets) grid.appendChild(buildPetCard(l));
      box.appendChild(grid);
    }

    if (items.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '⚔️ 装备<span class="mk-count">' + items.length + ' 件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const l of items) grid.appendChild(buildItemCard(l, RARITY_LABEL));
      box.appendChild(grid);
    }

    if (mats.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '🧪 材料<span class="mk-count">' + mats.length + ' 件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const l of mats) grid.appendChild(buildMaterialCard(l));
      box.appendChild(grid);
    }

    if (eggList.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '🥚 宠物蛋<span class="mk-count">' + eggList.length + ' 件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const l of eggList) grid.appendChild(buildEggCard(l));
      box.appendChild(grid);
    }

    if (!pets.length && !items.length && !eggList.length && !mats.length) {
      box.innerHTML = '<div class="mk-empty">没有符合条件的商品</div>';
    }
  }

  /* ---------- 购买确认框（显示商品价格 / 交易税 / 买家需支付 / 卖家将收到） ---------- */
  // kind: 'pet' | 'item'；l: 挂单行（pet_listings / equip_listings）
  function openBuyConfirm(kind, l) {
    const mat = Market.findMaterial(l.material_type);
    const qty = l.material_qty || 0;
    const tax = Market.calcTax(qty);
    const net = Market.calcNet(qty);
    const isPet = kind === 'pet';
    const itemTitle = isPet ? `${l.pet_name}（成长${l.pet_growth} · Lv.${l.pet_level}）` : l.item_name;
    const body = $('trade-body');
    body.innerHTML = `
      <div class="buy-confirm-item">商品：<b>${escapeHtml(itemTitle)}</b></div>
      <div class="buy-confirm-row">商品价格：<b>${qty} ${mat.icon} ${mat.name}</b></div>
      <div class="buy-confirm-row">交易税：<b>${tax} ${mat.name}</b>
        <span class="hint">每满 ${Config.trade.taxPer} 收 ${Config.trade.taxAmount}，不满不收</span></div>
      <div class="buy-confirm-row">买家需支付：<b>${qty} ${mat.name}</b></div>
      <div class="buy-confirm-row">卖家将收到：<b>${net} ${mat.name}</b></div>
      ${tax > 0 ? '<div class="hint">税由卖家承担，从标价中扣除</div>' : ''}
      <div class="buy-confirm-mine">我的 ${mat.name}：<b>${Materials.getQuantity(mat.name)}</b></div>`;
    $('trade-modal').style.display = 'flex';
    // 等待期间弹窗保留在屏幕上（按钮变「购买中…」），比关掉弹窗干等好得多：
    // 关掉后玩家只能盯着市场页发呆，1~2 秒里完全不知道进行到哪一步。
    $('trade-ok').onclick = () => UI.runWithLoading($('trade-ok'), '购买中…', async () => {
      // 假卖家挂单走 buyBotItem/buyBotPet（本地扣材料 + 物品入列）；真实挂单走 buyItem/buy RPC
      const res = isPet
        ? (l.isBot ? await Market.buyBotPet(l.id) : await Market.buy(l.id))
        : (l.isBot ? await Market.buyBotItem(l.id) : await Market.buyItem(l.id));
      if (res.error) { showToast('❌ 购买失败', res.error); return; } // 失败保留弹窗：让玩家看清商品再重试
      // 本地扣材料（真实购买：云端 RPC 已扣，本地同步减；假单购买 buyBot* 内部已扣，不重复）
      if (l.material_type && !l.isBot) Materials.spendLocal(l.material_type, l.material_qty || 0);
      showToast('🎉 购买成功！', isPet ? `${l.pet_name} 已加入你的宠物列表`
        : (l.isBot ? `${l.item_name} 已加入你的背包（来自${l.seller || '流浪商人'}）` : `${l.item_name} 已加入你的背包`));
      // 单条拉取新宠物/装备追加本地（假单物品已直接入列，无需拉取）
      if (isPet) { if (!l.isBot) await window.Game.afterBuyPet(res.petId); }
      else if (!l.isBot) await window.Game.afterBuyItem(res.itemId);
      UI.renderAll();
      $('trade-modal').style.display = 'none'; // 成功才关
    });
    $('trade-cancel').onclick = () => { $('trade-modal').style.display = 'none'; };
  }
  function closeBuyPanel() {
    $('trade-modal').style.display = 'none';
  }

  /* ---------- 对外 API（市场页） ---------- */
  UI.renderMarket = renderMarket;
  UI.renderItemMarket = renderItemMarket;
  UI.openBuyConfirm = openBuyConfirm;
  UI.closeBuyPanel = closeBuyPanel;
  // 注：renderSellArea / renderTradeRecords / openSellForItem 由
  // ui-market-sell.js 与 ui-market-records.js 各自导出，此处不再重复绑定。
})();
