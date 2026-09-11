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
    kind: 'all',          // 'all' | 'pet' | 'item' | 'material' | 'egg'（参考火炬之光的分类筛选）
    slot: 'all',
    rarity: 'all',
    tier: 'all',
    baseTier: 'all',      // 底材T阶 all/'1'~'5'（词缀T阶筛选：最高词缀T ≤ 目标）
    growth: 'desc',       // 宠物排序：'desc' 成长高→低 / 'asc' / 'level-desc' 等级高→低
    sort: 'latest',       // 通用排序：latest / price-asc / price-desc / rarity-desc（装备）
    affixFilters: [],     // POE式词缀条件：[{type, min, max}]，可与/或组合（默认与）
    trait: 'all',         // 宠物血脉特质筛选：'all' / 特质 id / 'none'（无特质捡漏）
    priceMin: null,       // 价格区间（按标价的收款材料数量筛选，POE「价格区间」的等价物）
    priceMax: null,
  };

  let marketFilters = loadMarketFilters();
  let marketView = 'all'; // 'all' 全部在售 | 'mine' 我的上架（并入市集）
  // 分页：每个分区各自记「已展开多少条」，切换筛选/视图时归零（POE 翻页 / 火炬翻页的等价物）
  let marketShown = { pet: 0, item: 0, material: 0, egg: 0 };
  function resetMarketPaging() { marketShown = { pet: 0, item: 0, material: 0, egg: 0 }; }

  function loadMarketFilters() {
    try {
      const merged = Object.assign({}, MARKET_FILTER_DEFAULT, JSON.parse(localStorage.getItem(MARKET_FILTER_KEY) || '{}'));
      // 老存档兜底：affixFilters 曾被「✕ 清除」写成字符串 'all'，非数组会让 .some 直接抛错
      if (!Array.isArray(merged.affixFilters)) merged.affixFilters = [];
      return merged;
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
    resetMarketPaging();
    UI.renderAll();
  }

  function resetMarketFilters() {
    marketFilters = { ...MARKET_FILTER_DEFAULT };
    saveMarketFilters();
    resetMarketPaging();
    UI.renderAll();
  }

  function setMarketView(v) {
    marketView = (v === 'mine') ? 'mine' : 'all';
    resetMarketPaging();
    UI.renderMarket();
  }
  UI.setMarketView = setMarketView;
  UI.getMarketView = function () { return marketView; };
  UI.getMarketFilters = function () { return marketFilters; };

  function normalizeTier(v) { return Number(String(v || '').replace(/^T/i, '')) || 0; }

  function getListingTime(listing) {
    return listing.created_at || listing.createdAt || listing.createdAtMs || listing.updated_at || 0;
  }

  /* 挂单归类：一张挂单只属于一类（宠物 / 装备 / 材料 / 蛋）。
   * 之前只判 pet_id / item_id，材料与蛋在「全部」里能看见、却筛不出来，也搜不到。 */
  function listingKind(l) {
    if (!l) return 'unknown';
    // 真实材料挂单没有 good_id / kind（那是 AI 假单的字段），靠 good_name 认；漏了这条会归到 unknown，
    // 结果就是「筛材料时真实单全被过滤掉」
    if (l.good_name || l.good_id || l.kind === 'material') return 'material';
    if (l.egg_type || l.kind === 'egg') return 'egg';
    if (l.pet_id) return 'pet';
    if (l.item_id) return 'item';
    return 'unknown';
  }
  const KIND_LABEL = { pet: '宠物', item: '装备', material: '材料', egg: '宠物蛋' };

  // 搜索文本：名称 + 词缀 + 特质名（参考 POE 交易站的词缀搜索、火炬的条件组搜索）
  function listingHaystack(l) {
    const parts = [l.item_name, l.pet_name, l.good_name, l.egg_type,
      l.egg_type ? window.Drop.makeEggName(l.egg_type) : ''];
    for (const a of flattenAffixes(l.item_affixes || l.affixes || [])) parts.push(a.label || a.type);
    if (l.item_soul) parts.push(l.item_soul.label);
    for (const t of (l.pet_traits || [])) {
      parts.push(t && t.id);
      const cfg = t && Config.petTraits && Config.petTraits[t.id];
      if (cfg && cfg.label) parts.push(cfg.label);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  // 价格区间（按标价的收款材料数量；POE 交易站的 price range 等价物）
  function priceInRange(l) {
    const q = Number(l.material_qty || 0);
    if (marketFilters.priceMin != null && marketFilters.priceMin !== '' && q < Number(marketFilters.priceMin)) return false;
    if (marketFilters.priceMax != null && marketFilters.priceMax !== '' && q > Number(marketFilters.priceMax)) return false;
    return true;
  }

  function matchMarketListing(l) {
    const kind = listingKind(l);
    if (marketFilters.kind !== 'all' && marketFilters.kind !== kind) return false;
    if (!priceInRange(l)) return false;
    if (marketFilters.keyword) {
      const kw = String(marketFilters.keyword).trim().toLowerCase();
      if (kw && !listingHaystack(l).includes(kw)) return false;
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

  const RARITY_RANK = { gold: 3, blue: 2, white: 1 };
  function sortMarketListings(list) {
    const arr = list.slice();
    const priceOf = l => Number(l.material_qty || 0);
    const timeOf = l => new Date(getListingTime(l)).getTime() || 0;
    if (marketFilters.kind === 'pet') {
      // 宠物：成长（核心价值）或等级排序
      if (marketFilters.growth === 'asc') arr.sort((a, b) => Number(a.pet_growth || 0) - Number(b.pet_growth || 0));
      else if (marketFilters.growth === 'level-desc') arr.sort((a, b) => Number(b.pet_level || 0) - Number(a.pet_level || 0));
      else arr.sort((a, b) => Number(b.pet_growth || 0) - Number(a.pet_growth || 0));
      return arr;
    }
    const s = marketFilters.sort;
    if (s === 'price-asc') arr.sort((a, b) => priceOf(a) - priceOf(b));
    else if (s === 'price-desc') arr.sort((a, b) => priceOf(b) - priceOf(a));
    else if (s === 'rarity-desc') arr.sort((a, b) => (RARITY_RANK[b.item_rarity] || 0) - (RARITY_RANK[a.item_rarity] || 0) || priceOf(b) - priceOf(a));
    else if (s === 'growth-desc') arr.sort((a, b) => Number(b.pet_growth || 0) - Number(a.pet_growth || 0));
    else arr.sort((a, b) => timeOf(b) - timeOf(a));
    return arr;
  }

  /* ---------- 参考价 / 比价标签 ----------
   * 「同类、同收款材料」的挂单标价中位数 = 参考价（火炬之光的「查价」、宪法 B3 的市场价）。
   * 跨材料不可比（10 重铸石 ≠ 10 神圣石），所以必须同 material_type 才算同组。 */
  function peerGroupKey(l) {
    const kind = listingKind(l);
    if (kind === 'item') return 'item:' + (l.item_slot || '?') + ':' + (l.item_rarity || '?');
    if (kind === 'pet') {
      const nm = l.pet_name || '';
      const root = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(nm) || nm) : nm;
      return 'pet:' + root;
    }
    if (kind === 'material') return 'material:' + (l.good_id || l.good_name || '?');
    if (kind === 'egg') return 'egg:' + (l.egg_type || '?');
    return 'other';
  }
  function medianQty(list, keyOf) {
    const vals = list.map(l => Number(l.material_qty || 0)).filter(v => v > 0).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }
  // 同组同收款材料的标价中位数（样本不足返回 null）
  function refQty(l, pool) {
    const T = Config.trade || {};
    const key = peerGroupKey(l);
    const peers = (pool || []).filter(x => x !== l && x.material_type === l.material_type && peerGroupKey(x) === key);
    if (peers.length < (T.refPriceMinSamples || 3)) return null;
    return medianQty(peers);
  }
  // 捡漏 / 比价标签（市场捡漏 = 三爽点之一，AI 的 isLeak 标记也在这里落地）
  function dealBadge(l, pool) {
    if (l.isLeak) return '<span class="mk-deal mk-deal--leak"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg> 捡漏</span>';
    const ref = refQty(l, pool);
    const q = Number(l.material_qty || 0);
    if (!ref || !q) return '';
    const T = Config.trade || {};
    const diff = (ref - q) / ref;
    if (diff >= (T.dealDiscount || 0.2)) return `<span class="mk-deal">低于市价 ${Math.round(diff * 100)}%</span>`;
    if (diff <= -(T.overpriceMarkup || 0.25)) return `<span class="mk-deal mk-deal--high">高于市价 ${Math.round(-diff * 100)}%</span>`;
    return '';
  }
  // 挂单挂了多久（POE/火炬都要看时效，我们只展示不强制下架）
  function ageLabel(l) {
    const t = new Date(getListingTime(l)).getTime();
    if (!t) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时前';
    return Math.floor(hours / 24) + ' 天前';
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
    if (st.key === 'kind') return KIND_LABEL[v] || v;
    return v;
  }

  function renderFilterPath(box) {
    const chips = [];
    const push = (key, label) => chips.push({ key, label });
    if (marketFilters.kind !== 'all') push('kind', KIND_LABEL[marketFilters.kind] || marketFilters.kind);
    const hasPrice = (marketFilters.priceMin != null && marketFilters.priceMin !== '') || (marketFilters.priceMax != null && marketFilters.priceMax !== '');
    if (hasPrice) push('price', '价格 ' + (marketFilters.priceMin != null && marketFilters.priceMin !== '' ? marketFilters.priceMin : '不限') + '–' + (marketFilters.priceMax != null && marketFilters.priceMax !== '' ? marketFilters.priceMax : '不限'));
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
      el.onclick = () => {
        // 价格是两个字段、词缀条件是数组，不能一律按 'all' 清（曾把数组清成字符串 'all' → 之后 .some 报错）
        if (c.key === 'price') {
          marketFilters = Object.assign({}, marketFilters, { priceMin: null, priceMax: null });
          saveMarketFilters(); resetMarketPaging(); syncPriceInputs(); UI.renderAll(); return;
        }
        if (c.key === 'affixFilters') { setMarketFilter('affixFilters', []); return; }
        setMarketFilter(c.key, 'all');
      };
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
        { id: 'material', label: '材料' },
        { id: 'egg', label: '宠物蛋' },
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
          { id: 'level-desc', label: '等级高→低' },
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
          { id: 'rarity-desc', label: '稀有度金→白' },
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

  // 价格区间输入框与筛选状态同步（输入框在静态 HTML 里，不随面板重建，所以焦点不会丢）
  function syncPriceInputs() {
    const pMin = $('market-price-min');
    const pMax = $('market-price-max');
    if (pMin && document.activeElement !== pMin) pMin.value = marketFilters.priceMin != null ? marketFilters.priceMin : '';
    if (pMax && document.activeElement !== pMax) pMax.value = marketFilters.priceMax != null ? marketFilters.priceMax : '';
  }

  // 搜索框 / 价格区间 / 清空 / 视图切换 / 交易信息折叠（每次渲染都会刷新绑定，幂等）
  function bindMarketControls() {
    const kwInput = $('market-keyword');
    if (kwInput) {
      if (document.activeElement !== kwInput) kwInput.value = marketFilters.keyword || '';
      kwInput.oninput = () => {
        marketFilters = Object.assign({}, marketFilters, { keyword: kwInput.value });
        saveMarketFilters();
        resetMarketPaging();
        UI.renderMarket();
        UI.renderTradeRecords();
      };
    }
    // 价格区间（用 change 而非 input：输入过程中不重建列表，回车/失焦才生效）
    const bindPrice = (el, key) => {
      if (!el) return;
      el.onchange = () => {
        const raw = String(el.value || '').trim();
        const val = raw === '' ? null : Math.max(0, Number(raw));
        marketFilters = Object.assign({}, marketFilters, { [key]: Number.isFinite(val) ? val : null });
        saveMarketFilters();
        resetMarketPaging();
        UI.renderMarket();
      };
    };
    bindPrice($('market-price-min'), 'priceMin');
    bindPrice($('market-price-max'), 'priceMax');
    syncPriceInputs();

    const resetBtn = $('cfReset');
    if (resetBtn) resetBtn.onclick = () => { resetMarketFilters(); syncPriceInputs(); };

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
  function buildItemCard(l, RARITY_LABEL, pool) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const color = Config.equipment.rarities.find(r => r.id === l.item_rarity)?.color || '#d8d8d8';
    const affixText = flattenAffixes(l.item_affixes || []).map(a => window.Equipment.formatAffix ? window.Equipment.formatAffix(a) : `${a.label}+${a.value}%`)
      .concat(l.item_soul ? [l.item_soul.label] : []).join(' ');
    const mat = Market.findMaterial(l.material_type);
    const legacy = !l.material_type;
    const mine = Market.isItemListed(l.item_id);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const deal = legacy ? '' : dealBadge(l, pool);
    const priceHtml = legacy
      ? '<span class="mk-price">旧版挂单</span>'
      : `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>${deal}`;
    const btnText = mine ? '取回' : legacy ? '不可购买' : '购买';
    const age = ageLabel(l);
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-avatar mk-avatar--item"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name" style="color:${color}">${escapeHtml(l.item_name || '未知装备')}</div>${mineTag}</div>
          <div class="mk-meta">${escapeHtml(l.item_slot || '')} · T${l.item_tier || '?'} · ${RARITY_LABEL[l.item_rarity] || l.item_rarity}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}${age ? ' · ' + age : ''}</div>
        </div>
      </div>
      <div class="mk-affix">${affixText ? escapeHtml(affixText) : '<span style="color:var(--text-faint)">无词缀</span>'}</div>
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : legacy ? 'disabled' : 'buy'}" ${legacy && !mine ? 'disabled' : ''}>${btnText}</button></div>`;
    // 装备详情 tooltip（hover 显示完整词缀）：直接复用背包悬停浮层机制（UI.bindTip → #bag-tooltip，不重写）
    const detailAffixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(l.item_affixes || []) : { prefix: [], suffix: [] };
    const detailLine = (items, cls) => (items || []).map(a => window.Equipment.formatAffixHtml(a, cls)).join('') || '<div class="tip-empty">无</div>';
    const ICONS = (window.UI && window.UI.EQUIP_ICON) || {};
    const iconHtml = '<div class="tip-icon"><span class="ico" style="border-color:' + color + '"><span class="emoji">' + (ICONS[l.item_slot] || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>') + '</span></span></div>';
    const tipHtml = iconHtml + `<div class="tip-name" style="color:${color}">${escapeHtml(l.item_name || '未知装备')}</div><div class="tip-line">槽位：<b>${escapeHtml(l.item_slot || '未知')}</b></div><div class="tip-line">底材：<b>T${l.item_tier || '?'}</b></div><div class="tip-section">词缀</div>${detailLine(detailAffixes.prefix, 'tip-prefix')}<hr class="tip-divider">${detailLine(detailAffixes.suffix, 'tip-suffix')}<div class="tip-section">魂铸</div>${l.item_soul ? `<div class="tip-affix soul-affix">${escapeHtml(l.item_soul.label || '')} <span class="tip-tier">T${l.item_soul.tier || 1}</span></div>` : '<div class="tip-empty">无</div>'}`;
    if (window.UI && UI.bindTip) UI.bindTip(div, tipHtml);

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
  function buildPetCard(l, pool) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const avatar = window.PetSprites && window.PetSprites.avatarOf ? window.PetSprites.avatarOf(l.pet_name) : null;
    const mat = Market.findMaterial(l.material_type);
    const legacy = !l.material_type;
    const mine = Market.isListed(l.pet_id);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const deal = legacy ? '' : dealBadge(l, pool);
    const priceHtml = legacy
      ? '<span class="mk-price">旧版挂单</span>'
      : `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>${deal}`;
    const traitsHtml = (UI.traitsHtml && l.pet_traits && l.pet_traits.length) ? `<div class="mk-traits">${UI.traitsHtml({ traits: l.pet_traits })}</div>` : '';
    const age = ageLabel(l);
    div.innerHTML = `
      <div class="mk-card-top">
        ${avatar ? `<img class="mk-avatar" src="${avatar}" alt="${escapeHtml(l.pet_name)}">` : '<div class="mk-avatar mk-avatar--item"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg></div>'}
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(l.pet_name)}</div>${mineTag}</div>
          <div class="mk-meta">成长${l.pet_growth} · Lv.${l.pet_level}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}${age ? ' · ' + age : ''}</div>
        </div>
      </div>
      ${traitsHtml}
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : legacy ? 'disabled' : 'buy'}" ${legacy && !mine ? 'disabled' : ''}>${mine ? '取回' : legacy ? '不可购买' : '购买'}</button></div>`;
    // 宠物属性 tooltip：直接复用宠物共享 tooltip（PetUI.bindPetTip + petTipHtml，不重写）。
    // 挂单快照只有名字/等级/成长/特质，血统与基础三围按名字从配置解析（与 pet.js 同源口径：resolveLineId / godInfoOf / starters / speeds）。
    const pName = l.pet_name || '';
    const rootName = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(pName) || pName) : pName;
    const pGod = (window.Pet && window.Pet.godInfoOf) ? window.Pet.godInfoOf({ name: pName }) : null;
    const pStarter = (Config.pet.starters || []).find(s => s.name === rootName);
    const pBase = pGod || pStarter || {};
    const petView = {
      name: pName,
      level: Number(l.pet_level) || 1,
      growth: Number(l.pet_growth) || 0,
      lineId: rootName,
      baseHp: pBase.baseHp != null ? pBase.baseHp : 100,
      baseAtk: pBase.baseAtk != null ? pBase.baseAtk : 20,
      baseDef: pBase.baseDef != null ? pBase.baseDef : 10,
      baseSpd: (pGod && pGod.speed) ? pGod.speed : ((Config.pet.speeds && Config.pet.speeds[rootName]) || 40),
      traits: Array.isArray(l.pet_traits) ? l.pet_traits : []
    };
    if (window.PetUI && PetUI.bindPetTip) PetUI.bindPetTip(div, petView);
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
  function buildEggCard(l, pool) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    // 假卖家蛋单不标"我的"（isMyEggListed 按蛋品种判，AI 蛋不该命中玩家上架标记）
    const mine = !l.isBot && (Market.isMyEggListed ? Market.isMyEggListed(l.egg_type) : false);
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const mat = Market.findMaterial(l.material_type);
    const deal = dealBadge(l, pool);
    const priceHtml = mat ? `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>${deal}` : '<span class="mk-price"></span>';
    const age = ageLabel(l);
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon">${l.egg_icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg>'}</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(window.Drop.makeEggName(l.egg_type))}</div>${mineTag}</div>
          <div class="mk-meta">宠物蛋${l.seller ? ' · ' + escapeHtml(l.seller) : ''}${age ? ' · ' + age : ''}</div>
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
      else { showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> 购买成功', `获得 ${window.Drop.makeEggName(l.egg_type)}，去「宠物 → 宠物蛋」孵化`); UI.renderAll(); }
    };
    return div;
  }

  /* ---------- 材料商品卡片（AI 假卖家挂单，2026-09-03 二阶段） ---------- */
  function buildMaterialCard(l, pool) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const mat = Market.findMaterial(l.material_type);
    const deal = dealBadge(l, pool);
    const goodQty = Number(l.good_qty || 1);
    const goodIcon = l.good_icon || Market.findMaterial(l.good_name).icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m7.5 4.27 9 5.15"/></svg>';
    // 真实玩家挂单带 seller_id，AI 假单不带（只有 seller 昵称）→ 用它判定「我的」
    const myId = (UI.getAuthUser && UI.getAuthUser() || {}).id;
    const mine = !l.isBot && !!(l.seller_id && myId && String(l.seller_id) === String(myId));
    const mineTag = mine ? '<span class="mk-tag-mine">我的</span>' : '';
    const priceHtml = mat ? `<span class="mk-price">${l.material_qty} <b>${mat.icon} ${mat.name}</b></span>${deal}` : '<span class="mk-price"></span>';
    const age = ageLabel(l);
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon">${goodIcon}</div>
        <div class="mk-card-info">
          <div class="mk-name-row"><div class="mk-name">${escapeHtml(l.good_name)}</div>${mineTag}</div>
          <div class="mk-meta">材料 ×${goodQty}${l.seller ? ' · ' + escapeHtml(l.seller) : ''}${age ? ' · ' + age : ''}</div>
        </div>
      </div>
      <div class="mk-card-foot">${priceHtml}<button class="mk-btn ${mine ? 'recall' : 'buy'}">${mine ? '取回' : '购买'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = async () => {
      if (mine) {
        const res = await Market.cancelMaterial(l.id);
        if (res.error) { showToast('❌ 取回失败', res.error); return; }
        showToast('↩️ 已取回', `${l.good_name} ×${goodQty} 已回到背包`);
        UI.renderAll();
        return;
      }
      if (!UI.isLoggedIn()) { showToast('❌ 需要登录', '登录后才能购买'); return; }
      const res = l.isBot ? await Market.buyBotMaterial(l.id) : await Market.buyMaterial(l.id);
      if (res.error) { showToast('❌ 购买失败', res.error); return; }
      // 真实单：云端已把货写进 materials，本地同步（加货 / 扣收款材料）；AI 假单内部已处理
      if (!l.isBot) {
        Materials.gainLocal(l.good_name, goodQty);
        Materials.spendLocal(l.material_type, l.material_qty || 0);
      }
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg> 购买成功', `获得 ${goodQty} × ${l.good_name}`);
      UI.renderAll();
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

  /* 单个分区渲染：按 Config.trade.pageSize 分页，超出给「显示更多」
   * （POE 交易站 / 火炬之光交易行的翻页等价物：市场几十上百条时不再一口气全铺出来） */
  function renderMarketSection(box, key, title, list, buildCard, pool) {
    const size = Number((Config.trade && Config.trade.pageSize) || 12);
    const shown = marketShown[key] || 0;
    const visible = list.slice(0, Math.max(size, shown + size));
    const sec = document.createElement('div');
    sec.className = 'mk-section';
    sec.innerHTML = title + '<span class="mk-count">' + list.length + ' 件'
      + (visible.length < list.length ? '（已显示 ' + visible.length + '）' : '') + '</span>';
    box.appendChild(sec);
    const grid = document.createElement('div');
    grid.className = 'mk-grid';
    for (const l of visible) grid.appendChild(buildCard(l, pool));
    box.appendChild(grid);
    if (visible.length < list.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'mk-more';
      more.innerHTML = '显示更多（还剩 ' + (list.length - visible.length) + ' 件）';
      more.onclick = () => { marketShown[key] = visible.length; renderMarket(); };
      box.appendChild(more);
    }
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

    /* 全部在售：宠物 / 装备 / 材料 / 宠物蛋。
     * 四类挂单都过同一套筛选（材料与蛋以前完全不筛：关键词、价格区间对它们无效）。
     * pool = 未筛选的原池，用来算「同类在售中位价」这个参考价 —— 样本不该被当前筛选砍掉。 */
    const petPool = Market.getListings();
    const itemPool = Market.getItemListings();
    const eggPool = Market.getEggListings ? Market.getEggListings() : [];
    const matPool = Market.getMaterialListings ? Market.getMaterialListings() : [];
    const RARITY_LABEL = { white: '白装', blue: '蓝装', gold: '金装' };

    const pets = sortMarketListings(petPool.filter(matchMarketListing)).filter(l => l.pet_id);
    const items = sortMarketListings(itemPool.filter(matchMarketListing));
    const mats = sortMarketListings(matPool.filter(matchMarketListing));
    const eggs = sortMarketListings(eggPool.filter(matchMarketListing));

    const total = pets.length + items.length + mats.length + eggs.length;
    const cnt = $('rpCount');
    if (cnt) cnt.textContent = '共 ' + total + ' 件';

    if (pets.length) renderMarketSection(box, 'pet', '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg> 宠物', pets, (l, pool) => buildPetCard(l, pool), petPool);
    if (items.length) renderMarketSection(box, 'item', '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ 装备', items, (l, pool) => buildItemCard(l, RARITY_LABEL, pool), itemPool);
    if (mats.length) renderMarketSection(box, 'material', '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg> 材料', mats, (l, pool) => buildMaterialCard(l, pool), matPool);
    if (eggs.length) renderMarketSection(box, 'egg', '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> 宠物蛋', eggs, (l, pool) => buildEggCard(l, pool), eggPool);

    /* 零结果要讲清楚是「筛选太窄」还是「真的没货」——
     * 以前一律写「没有符合条件的商品」，玩家（连作者本人）都会以为市场/商人挂了，
     * 实际多半是自己勾了「底材 T1」这类极窄条件。改过筛选就给一键清空。 */
    if (!total) {
      const dirty = JSON.stringify(marketFilters) !== JSON.stringify(MARKET_FILTER_DEFAULT);
      box.innerHTML = marketView === 'mine'
        ? '<div class="mk-empty">你还没有上架任何商品</div>'
        : dirty
          ? '<div class="mk-empty">没有符合当前筛选的商品<small>筛选条件可能太窄了，比如底材 T 阶只勾了 T1</small><button class="btn-mini" id="mk-clear-filters">清空筛选</button></div>'
          : '<div class="mk-empty">当前没有商品在售</div>';
      const clearBtn = document.getElementById('mk-clear-filters');
      if (clearBtn) clearBtn.onclick = resetMarketFilters;
    }
  }

  /* ---------- 查价（上架弹窗用） ----------
   * 同类商品 + 同收款材料的在售标价中位数 = 参考价（火炬之光交易行的「查价」）。
   * 跨收款材料不可比：10 个重铸石和 10 个神圣石不是一回事，所以必须同 material_type。 */
  function pseudoListing(kind, payload, matName) {
    if (kind === 'pet') return { pet_id: 'ref', pet_name: payload.name, material_type: matName, material_qty: 0 };
    if (kind === 'item') return { item_id: 'ref', item_slot: payload.slot, item_rarity: (payload.rarity && payload.rarity.id) || payload.rarity, material_type: matName, material_qty: 0 };
    if (kind === 'egg') return { egg_type: payload, material_type: matName, material_qty: 0 };
    return { good_id: payload, material_type: matName, material_qty: 0 };
  }
  function marketRefPrice(kind, payload, matName) {
    if (!matName) return null;
    const pool = kind === 'pet' ? Market.getListings()
      : kind === 'item' ? Market.getItemListings()
        : kind === 'egg' ? (Market.getEggListings ? Market.getEggListings() : [])
          : (Market.getBotMaterialListings ? Market.getBotMaterialListings() : []);
    const pseudo = pseudoListing(kind, payload, matName);
    const key = peerGroupKey(pseudo);
    const peers = (pool || []).filter(x => x.material_type === matName && peerGroupKey(x) === key);
    const min = Number((Config.trade && Config.trade.refPriceMinSamples) || 3);
    if (peers.length < min) return { median: null, samples: peers.length };
    return { median: medianQty(peers), samples: peers.length };
  }
  UI.marketRefPrice = marketRefPrice;

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
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg> 购买成功！', isPet ? `${l.pet_name} 已加入你的宠物列表`
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
