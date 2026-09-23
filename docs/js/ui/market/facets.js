/* ============================================================
 * ui/market/facets.js —— 市集左侧「级联筛选栏」
 * 职责（一件事）：维护筛选状态 + 渲染左侧那一栏 + 决定一条挂单命中不命中
 *
 * ⚠️ 筛选**维度与手感**必须和既有游戏一致（用户明确要求「筛选功能要求和我现在游戏一致」）：
 *   · 类型 → 下级逐级展开（宠物 → 特质 / 成长；装备 → 部位 → 稀有度 → 底材T → 词缀T → 词缀条件 → 排序）
 *   · **单选 + 级联**：改上级自动重置下级（不做多选叠加）
 *   本次只把这一栏从"顶部横排"挪到"左侧竖排"，语义一行没改。
 *
 * 状态存 localStorage['marketFilters']（与改版前同一个键，老玩家的筛选不会丢）。
 * 依赖：Config / Equipment（词缀池）/ MarketCalc（识别与搜索文本）；渲染产物是 DOM。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $ } = UI;
  const Config = window.Config;
  const Calc = window.MarketCalc;
  const EQUIP_SLOTS = (window.Equipment.SLOTS || []); // 12 部位
  const AFFIX_POOL = (window.Equipment.AFFIX_POOL || []);

  const MARKET_FILTER_KEY = 'marketFilters';
  const MARKET_FILTER_DEFAULT = {
    kind: 'all',          // 'all' | 'pet' | 'item' | 'material' | 'egg'
    slot: 'all',
    rarity: 'all',
    tier: 'all',
    baseTier: 'all',      // 底材T阶 all/'1'~'5'（词缀T阶筛选：最高词缀T ≤ 目标）
    growth: 'desc',       // 宠物排序：'desc' 成长高→低 / 'asc' / 'level-desc' 等级高→低
    sort: 'latest',       // 通用排序：latest / price-asc / price-desc / rarity-desc（装备）
    affixFilters: [],     // POE式词缀条件：[{type, min, max}]，多条默认"与"
    trait: 'all',         // 宠物血脉特质：'all' / 特质 id / 'none'（无特质捡漏）
    priceMin: null,       // 价格区间（按标价的收款材料数量筛，POE「价格区间」的等价物）
    priceMax: null,
  };

  function loadFilters() {
    try {
      const merged = Object.assign({}, MARKET_FILTER_DEFAULT, JSON.parse(localStorage.getItem(MARKET_FILTER_KEY) || '{}'));
      // 老存档兜底：affixFilters 曾被「✕ 清除」写成字符串 'all'，非数组会让 .some 直接抛错
      if (!Array.isArray(merged.affixFilters)) merged.affixFilters = [];
      return merged;
    } catch (e) {
      return Object.assign({}, MARKET_FILTER_DEFAULT);
    }
  }
  function saveFilters() {
    try { localStorage.setItem(MARKET_FILTER_KEY, JSON.stringify(marketFilters)); } catch (e) { /* 存不下不致命 */ }
  }

  let marketFilters = loadFilters();

  /* 改筛选 = 复位分页 + 重渲染。分页必须复位：
   * 换了筛选条件还留着"已展开 24 条"，玩家会以为筛选没生效（列表看着没变化）。 */
  function rerender() {
    if (window.MarketCards) window.MarketCards.resetPaging();
    UI.renderMarket();
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
    saveFilters();
    rerender();
  }

  function resetMarketFilters() {
    marketFilters = Object.assign({}, MARKET_FILTER_DEFAULT);
    saveFilters();
    rerender();
  }

  const filters = () => marketFilters;
  const isDirty = () => JSON.stringify(marketFilters) !== JSON.stringify(MARKET_FILTER_DEFAULT);

  /* ---------- 命中判定 ---------- */
  function normalizeTier(v) { return Number(String(v || '').replace(/^T/i, '')) || 0; }

  // 价格区间（按标价的收款材料数量；POE 交易站的 price range 等价物）
  function priceInRange(l) {
    const q = Number(l.material_qty || 0);
    if (marketFilters.priceMin != null && marketFilters.priceMin !== '' && q < Number(marketFilters.priceMin)) return false;
    if (marketFilters.priceMax != null && marketFilters.priceMax !== '' && q > Number(marketFilters.priceMax)) return false;
    return true;
  }

  function match(l) {
    const kind = Calc.listingKind(l);
    if (marketFilters.kind !== 'all' && marketFilters.kind !== kind) return false;
    if (!priceInRange(l)) return false;
    if (marketFilters.keyword) {
      const kw = String(marketFilters.keyword).trim().toLowerCase();
      if (kw && !Calc.listingHaystack(l).includes(kw)) return false;
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
      const affs = window.Equipment.flattenAffixes(l.item_affixes || l.affixes || []);
      // 词缀T = 装备里最高词缀T（best=数字最小）
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
  function sort(list) {
    const arr = list.slice();
    const priceOf = l => Number(l.material_qty || 0);
    const timeOf = l => new Date(Calc.getListingTime(l)).getTime() || 0;
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

  /* ---------- 「状态没变就别重建」 ----------
   * ⚠️ 为什么必须有：`main.js:810` 的回血时钟**每 1 秒**调一次 `renderAll()`，
   *   而 `renderAll` 里就有 `UI.renderMarket()`（ui-common.js:387）。
   *   以前这里每次都把左栏整块重建 ⇒ `.cf-step` 的级联入场动画
   *   （`.26s` + 最多 240ms 延迟，见 market-cascade.css）**每秒重播一遍**，
   *   玩家看到的就是「左栏一直在闪」，顺带悬浮态与输入焦点也被反复打断。
   * 现在按签名比对：只有**真正影响画面**的状态变了才重建 DOM。 */
  let lastStepsSig = '';
  let lastPathSig = '';
  let lastStructSig = '';

  // 「有哪几级筛选、每级什么值」（值变也要重建，好让选项高亮跟着走）
  function stepsSignature() {
    return JSON.stringify([marketFilters.kind, marketFilters.slot, marketFilters.rarity, marketFilters.tier,
      marketFilters.baseTier, marketFilters.growth, marketFilters.sort, marketFilters.trait, marketFilters.affixFilters]);
  }
  // 「当前筛选路径」那几个 chip（价格是两个字段、词缀条件是数组，都得进签名）
  function pathSignature() {
    return JSON.stringify([marketFilters.kind, marketFilters.trait, marketFilters.slot, marketFilters.rarity,
      marketFilters.tier, marketFilters.baseTier, marketFilters.affixFilters, marketFilters.priceMin, marketFilters.priceMax]);
  }

  /* ---------- 渲染：左侧筛选栏 ---------- */
  function stepVal(st, v) {
    if (v === 'all' || v == null) return '';
    if (st.key === 'sort' || st.key === 'growth' || st.key === 'viewMode') {
      const o = (st.opts || []).find(x => x.id === v);
      return o ? o.label : v;
    }
    if (st.key === 'trait' && v === 'none') return '无特质';
    if (st.key === 'kind') return Calc.KIND_LABEL[v] || v;
    return v;
  }

  function renderFilterPath(box) {
    const chips = [];
    const push = (key, label) => chips.push({ key, label });
    if (marketFilters.kind !== 'all') push('kind', Calc.KIND_LABEL[marketFilters.kind] || marketFilters.kind);
    const hasPrice = (marketFilters.priceMin != null && marketFilters.priceMin !== '') || (marketFilters.priceMax != null && marketFilters.priceMax !== '');
    if (hasPrice) push('price', '价格 ' + (marketFilters.priceMin != null && marketFilters.priceMin !== '' ? marketFilters.priceMin : '不限') + '–' + (marketFilters.priceMax != null && marketFilters.priceMax !== '' ? marketFilters.priceMax : '不限'));
    if (marketFilters.kind === 'pet') {
      if (marketFilters.trait !== 'all') {
        const t = marketFilters.trait === 'none' ? '无特质' : (((Config.petTraits || {})[marketFilters.trait] || {}).label || marketFilters.trait);
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
          saveFilters(); syncPriceInputs(); rerender(); return;
        }
        if (c.key === 'affixFilters') { setMarketFilter('affixFilters', []); return; }
        setMarketFilter(c.key, 'all');
      };
      box.appendChild(el);
    });
  }

  // POE式词缀条件行：选词缀 + min/max 数值范围，可加多条（默认"与"=全部满足）
  function renderAffixFilterRows(container) {
    if (!container) return;
    container.innerHTML = '';
    const filtersArr = marketFilters.affixFilters || [];
    const wrap = document.createElement('div');
    wrap.className = 'affix-filter-wrap';

    const renderRow = (af, idx) => {
      const row = document.createElement('div');
      row.className = 'affix-filter-row';
      const sel = document.createElement('select');
      sel.className = 'affix-type-sel';
      sel.setAttribute('aria-label', '词缀类型');
      sel.innerHTML = AFFIX_POOL.map(a => '<option value="' + a.type + '"' + (a.type === af.type ? ' selected' : '') + '>' + a.label + '</option>').join('');
      sel.onchange = () => { af.type = sel.value; saveFilters(); rerender(); };
      const min = document.createElement('input');
      min.className = 'affix-min'; min.type = 'number'; min.placeholder = 'min';
      min.value = af.min != null ? af.min : '';
      min.setAttribute('aria-label', '最小值');
      min.oninput = () => { af.min = min.value === '' ? null : Number(min.value); saveFilters(); rerender(); };
      const max = document.createElement('input');
      max.className = 'affix-max'; max.type = 'number'; max.placeholder = 'max';
      max.value = af.max != null ? af.max : '';
      max.setAttribute('aria-label', '最大值');
      max.oninput = () => { af.max = max.value === '' ? null : Number(max.value); saveFilters(); rerender(); };
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn-mini ghost affix-del'; del.textContent = '✕';
      del.setAttribute('aria-label', '删除该词缀条件');
      del.onclick = () => { marketFilters.affixFilters.splice(idx, 1); saveFilters(); rerender(); };
      row.appendChild(sel); row.appendChild(min); row.appendChild(max); row.appendChild(del);
      return row;
    };

    filtersArr.forEach((af, i) => wrap.appendChild(renderRow(af, i)));
    if (!filtersArr.length) {
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
      saveFilters(); rerender();
    };
    wrap.appendChild(add);
    container.appendChild(wrap);
  }

  /* 竖排渲染：每一级仍是 .cf-step（CSS 负责从左栏竖着排），
   * 元素 id 与容器结构保持与改版前一致 —— 守值测试与 CSS 都认这一套。 */
  function renderPanel(pool) {
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

    /* 重建判定（见文件上方「状态没变就别重建」）：
     * 签名没变且容器里还有节点 → 整块跳过，动画自然不会重播。
     * `!children.length` 是兜底：万一 DOM 被外部清空（切页重建等），签名没变也得补回来。 */
    const stepsSig = stepsSignature();
    const needSteps = stepsSig !== lastStepsSig || !stepsWrap.children || !stepsWrap.children.length;
    /* 入场动画**只在级联结构真变了时才播**：结构 = 类型 + 有没有词缀条件块。
     * 仅换一个选项值（白装 → 蓝装）不该让整栏闪一下 —— 这正是"一直在闪"的来源之一。 */
    const structSig = kind + '|' + ((marketFilters.affixFilters || []).length ? 'affix' : '');
    const animate = structSig !== lastStructSig;
    lastStructSig = structSig;

    if (!needSteps) {
      renderPathAndWatch(pathBox, pool);
      return;
    }
    lastStepsSig = stepsSig;

    stepsWrap.innerHTML = '';
    steps.forEach((st, i) => {
      const el = document.createElement('div');
      el.className = 'cf-step';
      el.dataset.step = st.key;
      el.style.setProperty('--i', i);
      if (animate) el.dataset.anim = '1';

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
      if (animate) el.dataset.anim = '1';
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

    renderPathAndWatch(pathBox, pool);
  }

  /* 「当前筛选路径」+ 关注摘要：每次渲染都可以安全调用（各自也有签名/文本量极小）。
   * 顺序固定：先路径 chips，再关注摘要，再绑控件 —— 别打乱，测试按这个顺序读 DOM。 */
  function renderPathAndWatch(pathBox, pool) {
    const pathSig = pathSignature();
    if (pathSig !== lastPathSig || !pathBox.children || !pathBox.children.length) {
      lastPathSig = pathSig;
      renderFilterPath(pathBox);
    }
    renderWatchSummary(pool);
    bindControls();
  }

  /* 左栏底部：关注情况一行（纯信息，不是筛选项） */
  function renderWatchSummary(pool) {
    const panel = $('market-filters');
    if (!panel || !window.MarketWatch) return;
    const html = window.MarketWatch.summaryHtml(pool);
    let box = $('mwSummary');
    if (!box) {
      // 老 DOM 里没有这个节点就自己建（HTML 与 JS 谁先到位都能用）
      box = document.createElement('div');
      box.id = 'mwSummary';
      panel.appendChild(box);
    }
    box.innerHTML = html;
  }

  // 价格区间输入框与筛选状态同步（输入框在静态 HTML 里，不随面板重建，所以焦点不会丢）
  function syncPriceInputs() {
    const pMin = $('market-price-min');
    const pMax = $('market-price-max');
    if (pMin && document.activeElement !== pMin) pMin.value = marketFilters.priceMin != null ? marketFilters.priceMin : '';
    if (pMax && document.activeElement !== pMax) pMax.value = marketFilters.priceMax != null ? marketFilters.priceMax : '';
  }

  /* 搜索框 / 价格区间 / 清空（每次渲染都会刷新绑定，幂等）。
   * 注：视图切换与视图模式的绑定在 index.js / cards.js，不在这里。 */
  function bindControls() {
    const kwInput = $('market-keyword');
    if (kwInput) {
      if (document.activeElement !== kwInput) kwInput.value = marketFilters.keyword || '';
      kwInput.oninput = () => {
        marketFilters = Object.assign({}, marketFilters, { keyword: kwInput.value });
        saveFilters();
        rerender();
      };
    }
    // 价格区间（用 change 而非 input：输入过程中不重建列表，回车/失焦才生效）
    const bindPrice = (el, key) => {
      if (!el) return;
      el.onchange = () => {
        const raw = String(el.value || '').trim();
        const val = raw === '' ? null : Math.max(0, Number(raw));
        marketFilters = Object.assign({}, marketFilters, { [key]: Number.isFinite(val) ? val : null });
        saveFilters();
        rerender();
      };
    };
    bindPrice($('market-price-min'), 'priceMin');
    bindPrice($('market-price-max'), 'priceMax');
    syncPriceInputs();

    const resetBtn = $('cfReset');
    if (resetBtn) resetBtn.onclick = () => resetMarketFilters();
  }

  window.MarketFacets = {
    filters, set: setMarketFilter, reset: resetMarketFilters, match, sort,
    render: renderPanel, syncPriceInputs, isDirty, DEFAULT: MARKET_FILTER_DEFAULT
  };

  /* ---------- 对外 API（保持改版前同一套名字，调用方零改动） ---------- */
  UI.getMarketFilters = filters;
})();
