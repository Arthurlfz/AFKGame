/* ============================================================
 * ui/ui-market.js —— 市场页 UI（宠物 + 装备交易 / 我的上架 / 交易记录）
 * 职责：
 *  1. 在售市场（宠物区 + 装备区，购买 / 取回）
 *  2. 我的上架（挂单 / 取回的唯一入口）
 *  3. 交易记录面板（卖出 / 买入 / 汇总）
 *  4. 购买确认框（商品价格 / 交易税 / 买家需支付 / 卖家将收到）
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

  const MARKET_FILTER_KEY = 'marketFilters';
  const MARKET_FILTER_DEFAULT = {
    kind: 'all',
    slot: 'all',
    rarity: 'all',
    tier: 'all',
    growth: 'desc',
    sort: 'latest',
  };

  let marketFilters = loadMarketFilters();

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

  function setMarketFilter(key, value) {
    marketFilters = Object.assign({}, marketFilters, { [key]: value });
    saveMarketFilters();
    UI.renderAll();
  }

  function resetMarketFilters() {
    marketFilters = { ...MARKET_FILTER_DEFAULT };
    saveMarketFilters();
    UI.renderAll();
  }

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
    if (l.item_id) {
      if (marketFilters.slot !== 'all' && String(l.item_slot || l.slot || '').toLowerCase() !== marketFilters.slot) return false;
      if (marketFilters.rarity !== 'all' && String(l.item_rarity || '').toLowerCase() !== marketFilters.rarity) return false;
      if (marketFilters.tier !== 'all' && normalizeTier(l.item_tier || l.tier) !== Number(marketFilters.tier.slice(1))) return false;
    }
    return true;
  }

  function sortMarketListings(list) {
    const arr = list.slice();
    if (marketFilters.kind === 'pet' || marketFilters.kind === 'all') {
      if (marketFilters.growth === 'asc') arr.sort((a, b) => Number(a.pet_growth || 0) - Number(b.pet_growth || 0));
      else if (marketFilters.growth === 'desc') arr.sort((a, b) => Number(b.pet_growth || 0) - Number(a.pet_growth || 0));
      return arr;
    }
    if (marketFilters.sort === 'price-asc') arr.sort((a, b) => Number(a.material_qty || 0) - Number(b.material_qty || 0));
    else if (marketFilters.sort === 'price-desc') arr.sort((a, b) => Number(b.material_qty || 0) - Number(a.material_qty || 0));
    else arr.sort((a, b) => new Date(getListingTime(b)).getTime() - new Date(getListingTime(a)).getTime());
    return arr;
  }

  function renderMarketControls(box) {
    // 顶部筛选条已移除：筛选统一放左侧 #market-filters 面板，这里保持为空
  }

  /* ---------- 左侧筛选面板（POE 式折叠分组，纯前端交互，不改交易逻辑） ---------- */
  function fillFilterGroup(panel, group, items) {
    const body = panel.querySelector('.filter-group[data-group="' + group + '"] .filter-body');
    if (!body) return;
    body.innerHTML = '';
    items.forEach(({ key, val, label, title }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-mini filter-btn' + (marketFilters[key] === val ? ' primary' : '');
      btn.textContent = label;
      btn.title = title || label;
      btn.dataset.key = key;
      btn.dataset.val = val;
      btn.onclick = () => setMarketFilter(key, val);
      body.appendChild(btn);
    });
  }

  function renderMarketFilterPanel() {
    const panel = $('market-filters');
    if (!panel) return;
    fillFilterGroup(panel, 'type', [
      { key: 'kind', val: 'all', label: '全部' },
      { key: 'kind', val: 'pet', label: '宠物' },
      { key: 'kind', val: 'item', label: '装备' },
    ]);
    fillFilterGroup(panel, 'slot', [
      { key: 'slot', val: 'all', label: '全部' },
      { key: 'slot', val: 'weapon', label: '武器' },
      { key: 'slot', val: 'armor', label: '防具' },
      { key: 'slot', val: 'accessory', label: '饰品' },
    ]);
    fillFilterGroup(panel, 'rarity', [
      { key: 'rarity', val: 'all', label: '全部' },
      { key: 'rarity', val: 'white', label: '白' },
      { key: 'rarity', val: 'blue', label: '蓝' },
      { key: 'rarity', val: 'gold', label: '金' },
    ]);
    fillFilterGroup(panel, 'tier', [
      { key: 'tier', val: 'all', label: '全部' },
      ...['T1', 'T2', 'T3', 'T4', 'T5'].map(t => ({ key: 'tier', val: t, label: t })),
    ]);
    // 价格范围分组：复用现有排序（价格低→高 / 高→低 / 最新）
    fillFilterGroup(panel, 'price', [
      { key: 'sort', val: 'price-asc', label: '价格低→高' },
      { key: 'sort', val: 'price-desc', label: '价格高→低' },
      { key: 'sort', val: 'latest', label: '最新上架' },
    ]);
    // 宠物成长值分组（选择宠物时联动显示）
    fillFilterGroup(panel, 'growth', [
      { key: 'growth', val: 'desc', label: '成长从高到低' },
      { key: 'growth', val: 'asc', label: '成长从低到高' },
    ]);
    // 属性筛选分组：占位说明（真实属性搜索由顶部搜索框承担）
    const attrBody = panel.querySelector('.filter-group[data-group="attr"] .filter-body');
    if (attrBody && !attrBody.textContent.trim()) attrBody.innerHTML = '<div class="hint">用顶部搜索框按名称 / 词缀搜索</div>';

    // 条件联动：宠物 → 显示成长，隐藏部位/T阶/价格；装备 → 反之
    const kind = marketFilters.kind;
    const toggleGroup = (g, on) => {
      const el = panel.querySelector('.filter-group[data-group="' + g + '"]');
      if (el) el.style.display = on ? '' : 'none';
    };
    toggleGroup('growth', kind === 'pet');
    toggleGroup('slot', kind !== 'pet');
    toggleGroup('tier', kind !== 'pet');
    toggleGroup('price', kind !== 'pet');
    toggleGroup('attr', kind !== 'pet');

    // 排序下拉
    const sortSel = $('market-sort');
    if (sortSel) {
      sortSel.value = marketFilters.sort || 'latest';
      sortSel.onchange = () => setMarketFilter('sort', sortSel.value);
    }
    // 搜索框
    const kwInput = $('market-keyword');
    if (kwInput) {
      kwInput.value = marketFilters.keyword || '';
      kwInput.oninput = () => {
        marketFilters = Object.assign({}, marketFilters, { keyword: kwInput.value });
        saveMarketFilters();
        UI.renderMarket();
        UI.renderTradeRecords();
      };
    }
    // 快捷类型按钮
    panel.querySelectorAll('[data-kind-quick]').forEach(b => {
      const active = marketFilters.kind === b.dataset.kindQuick;
      b.classList.toggle('primary', active);
      b.onclick = () => setMarketFilter('kind', b.dataset.kindQuick);
    });
    // 折叠交互（只绑定一次）
    if (!panel.dataset.filterInit) {
      panel.dataset.filterInit = '1';
      panel.querySelectorAll('.filter-head').forEach(head => {
        head.onclick = () => {
          const g = head.closest('.filter-group');
          if (!g) return;
          const open = g.classList.toggle('is-open');
          const arrow = head.querySelector('.arrow');
          if (arrow) arrow.textContent = open ? '▾' : '▸';
        };
      });
      const resetBtn = document.createElement('div');
      resetBtn.className = 'market-control-actions';
      resetBtn.innerHTML = '<button class="btn-mini ghost" id="market-filter-reset">重置筛选</button>';
      panel.appendChild(resetBtn);
      const rb = $('market-filter-reset');
      if (rb) rb.onclick = () => resetMarketFilters();
    }
  }

  /* ---------- 装备挂单行 ---------- */
  function renderItemMarket(container) {
    const box = container || $('market-items');
    if (!box) return;
    box.innerHTML = '';
    const list = sortMarketListings(Market.getItemListings().filter(matchMarketListing));
    if (!list.length) {
      box.innerHTML = '<div class="inv-empty">没有符合条件的商品</div>';
      return;
    }
    const RARITY_LABEL = { white: '白装', blue: '蓝装', gold: '金装' };
    for (const l of list) {
      const div = document.createElement('div');
      div.className = 'market-item item';
      const info = document.createElement('div');
      info.className = 'm-info';
      const color = Config.equipment.rarities.find(r => r.id === l.item_rarity)?.color || '#d8d8d8';
      const affixText = flattenAffixes(l.item_affixes || []).map(a => `${a.label}+${a.value}%`).join(' ');
      info.innerHTML = `
        <div class="m-name" style="color:${color}">${escapeHtml(l.item_name)} <span style="font-size:0.833rem">${RARITY_LABEL[l.item_rarity] || l.item_rarity}·T${l.item_tier}</span></div>
        <div class="m-desc">${escapeHtml(affixText)}</div>`;
      const mat = Market.findMaterial(l.material_type);
      const legacy = !l.material_type;
      const price = document.createElement('div');
      price.className = 'm-price';
      price.textContent = legacy ? '旧版挂单' : `${l.material_qty} ${mat.icon} ${mat.name}`;
      const mine = Market.isItemListed(l.item_id);
      const btn = document.createElement('button');
      btn.className = 'btn-sm' + (mine ? ' alt' : '');
      btn.textContent = mine ? '取回' : legacy ? '不可购买' : '购买';
      if (legacy && !mine) btn.disabled = true;
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
      div.appendChild(info);
      div.appendChild(price);
      div.appendChild(btn);
      box.appendChild(div);
    }
  }

  // 可折叠分组面板（宠物/装备左右两列）：标题 + 数量 + 「收起/展开」按钮
  function makeMarketGroup(title, count) {
    const g = document.createElement('div');
    g.className = 'market-group is-open';
    g.innerHTML = `<div class="market-group-head"><span class="arrow">▾</span><span>${title}</span><span class="count">${count} 件</span><button class="btn-mini ghost market-group-toggle">收起</button></div><div class="market-group-body"></div>`;
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
    renderMarketControls(box);
    const list = sortMarketListings(Market.getListings().filter(matchMarketListing));
    const items = sortMarketListings(Market.getItemListings().filter(matchMarketListing));

    const groups = document.createElement('div');
    groups.className = 'market-groups';
    box.appendChild(groups);

    // 宠物分组（可折叠，左列）
    const petList = list.filter(l => l.pet_id);
    const petGroup = makeMarketGroup('🐾 宠物', petList.length);
    groups.appendChild(petGroup);
    const petBody = petGroup.querySelector('.market-group-body');
    if (!petList.length) {
      petBody.innerHTML = '<div class="inv-empty">没有符合条件的商品</div>';
    } else {
      for (const l of petList) {
        const div = document.createElement('div');
        div.className = 'market-item';
        const info = document.createElement('div');
        info.className = 'm-info';
        info.innerHTML = `<span class="m-name">${escapeHtml(l.pet_name)}</span><span class="m-growth">成长${l.pet_growth}</span><span class="m-level">Lv.${l.pet_level}</span>`;
        const mat = Market.findMaterial(l.material_type);
        const legacy = !l.material_type;
        const price = document.createElement('div');
        price.className = 'm-price';
        price.textContent = legacy ? '旧版挂单' : `${l.material_qty} ${mat.icon} ${mat.name}`;
        const mine = Market.isListed(l.pet_id);
        const btn = document.createElement('button');
        btn.className = 'btn-sm' + (mine ? ' alt' : '');
        btn.textContent = mine ? '取回' : legacy ? '不可购买' : '购买';
        if (legacy && !mine) btn.disabled = true;
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
        div.appendChild(info);
        div.appendChild(price);
        div.appendChild(btn);
        petBody.appendChild(div);
      }
    }

    // 装备分组（可折叠，右列）
    const itemGroup = makeMarketGroup('⚔️ 装备', items.length);
    groups.appendChild(itemGroup);
    const itemBody = itemGroup.querySelector('.market-group-body');
    itemBody.id = 'market-items';
    renderItemMarket(itemBody);

    // 宠物蛋分组（可折叠）
    const eggList = Market.getEggListings ? Market.getEggListings() : [];
    const eggGroup = makeMarketGroup('🥚 宠物蛋', eggList.length);
    groups.appendChild(eggGroup);
    const eggBody = eggGroup.querySelector('.market-group-body');
    if (!eggList.length) eggBody.innerHTML = '<div class="inv-empty">还没有宠物蛋在售</div>';
    for (const l of eggList) {
      const mine = Market.isMyEggListed ? Market.isMyEggListed(l.egg_type) : false;
      const row = document.createElement('div');
      row.className = 'market-item sell-row';
      row.innerHTML = `
        <div class="m-info"><span class="m-name">🥚 ${escapeHtml(l.egg_type || '')}蛋</span>
        <span class="m-growth">${escapeHtml(l.material_type || '')} ×${l.material_qty}</span></div>
        ${mine
          ? '<button class="btn-sm alt sell-recall">取回</button>'
          : '<button class="btn-sm sell-buy">购买</button>'}`;
      eggBody.appendChild(row);
      const buyBtn = row.querySelector('.sell-buy');
      if (buyBtn) {
        buyBtn.onclick = async () => {
          const res = await Market.buyEgg(l.id);
          if (res.error) showToast('❌ 购买失败', res.error);
          else { showToast('🥚 购买成功', `获得 ${l.egg_type}蛋，去「宠物 → 宠物蛋」孵化`); UI.renderAll(); }
        };
      }
      const recall = row.querySelector('.sell-recall');
      if (recall) {
        recall.onclick = async () => {
          const res = await Market.cancelEgg(l.id);
          if (res.error) showToast('❌ 取回失败', res.error);
          else { showToast('↩️ 已取回', `${l.egg_type}蛋 已下架`); UI.renderAll(); }
        };
      }
    }
  }

  /* ---------- 我的上架（市场页：挂单 / 取回的唯一入口） ---------- */
  // 展开状态：正在填写的上架表单（按 cloudId 记录）。renderAll 高频重建时保持展开，
  // 避免"刚展开的表单被收起"和"正在打开的材料下拉被销毁弹回"
  let expandedPetId = null, expandedItemId = null, expandedEggId = null;

  function renderSellArea() {
    const box = $('market-sell');
    // 聚焦保护：材料下拉打开 / 数量输入框正在编辑时，跳过本次重建。
    // 每秒回血时钟、市场轮询、每场结算都会触发 renderAll → 整块重建 #market-sell，
    // 不保护的话正在打开的原生 select 会被销毁，表现为"下拉打开后马上弹回去"
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT') && ae.closest && ae.closest('.sell-form')) return;
    box.innerHTML = '';
    if (!UI.isLoggedIn()) {
      box.innerHTML = '<div class="inv-empty">登录后可在市场挂单出售宠物 / 装备</div>';
      return;
    }
    const evoMatName = (Config.pet.evolution && Config.pet.evolution.materialName) || '进化素材';
    const evolutionItems = Object.keys(Config.drop.evolutionMaterials || {})
      .map(name => ({ id: name, name, icon: '🧬', category: 'evo' }))
      .filter(item => item.name === evoMatName); // 通用进化素材只显示一个
    const paymentGroups = [
      { key: 'currency', label: '通货', items: Config.trade.materials.filter(m => m.category === 'stone' && Market.isPaymentMaterial(m.name)) },
      { key: 'evo', label: '进化素材', items: evolutionItems },
      { key: 'other', label: '其他', items: Config.trade.materials.filter(m => ['egg', 'beast'].includes(m.category) && Market.isPaymentMaterial(m.name)) },
    ];
    const paymentPanel = () => `
      <div class="sell-payment">
        <div class="sell-payment-search"><input type="text" class="sell-input pay-search" placeholder="搜索收款物"></div>
        <div class="sell-payment-tabs">
          ${paymentGroups.map((g, gi) => `<button class="btn-mini ${gi === 0 ? 'primary' : 'ghost'} pay-tab" data-pay-tab="${g.key}">${g.label}</button>`).join('')}
        </div>
        ${paymentGroups.map((g, gi) => `
          <div class="sell-payment-group" data-pay-group="${g.key}" style="${gi === 0 ? '' : 'display:none'}">
            <div class="sell-payment-list">
              ${g.items.map(m => `<button class="btn-mini pay-item" data-pay-name="${m.name}" data-pay-key="${g.key}">${m.icon} ${m.name}</button>`).join('') || '<div class="hint">暂无</div>'}
            </div>
          </div>
        `).join('')}
      </div>`;
    const sellForm = () => `
      <div class="sell-form">
        ${paymentPanel()}
        <input type="hidden" class="sell-input sell-mat">
        <input type="number" class="sell-input sell-qty" placeholder="数量" min="1">
        <div class="sell-actions">
          <button class="btn-mini primary sell-ok">确认</button>
          <button class="btn-mini ghost sell-cancel">取消</button>
        </div>
      </div>`;

    const groups = document.createElement('div');
    groups.className = 'market-groups';
    box.appendChild(groups);

    // 宠物区（左列，可折叠）
    const pets = getPets().filter(p => p.cloudId);
    const petGroup = makeMarketGroup('🐾 宠物上架', pets.length);
    groups.appendChild(petGroup);
    const petBody = petGroup.querySelector('.market-group-body');
    if (!pets.length) petBody.innerHTML = '<div class="inv-empty">还没有可上架的宠物（需先云端存档）</div>';
    for (const pet of pets) {
        const row = document.createElement('div');
        row.className = 'market-item sell-row';
        const mine = Market.isListed(pet.cloudId);
        const expanded = expandedPetId === pet.cloudId;
        row.innerHTML = `
          <div class="m-info"><span class="m-name">${escapeHtml(pet.name)}</span><span class="m-growth">成长${pet.growth}</span><span class="m-level">Lv.${pet.level}</span></div>
          ${expanded
            ? sellForm()
            : (mine ? '<button class="btn-sm alt sell-recall">取回</button>' : '<button class="btn-sm sell-open">上架</button>')}`;
        petBody.appendChild(row);
        const openBtn = row.querySelector('.sell-open');
        if (openBtn) {
          openBtn.onclick = () => {
            expandedPetId = pet.cloudId; // 记录展开态 → renderAll 后保持展开
            UI.renderAll();
          };
        }
        const recall = row.querySelector('.sell-recall');
        if (recall) {
          recall.onclick = async () => {
            const listing = Market.getPetListing(pet.cloudId);
            if (!listing) return;
            const res = await Market.cancelPet(listing.listingId);
            if (res.error) showToast('❌ 取回失败', res.error);
            else { showToast('↩️ 已取回', `${pet.name} 已下架`); UI.renderAll(); }
          };
        }
        const applySearch = () => {
          const searchEl = row.querySelector('.pay-search');
          const kw = (searchEl ? searchEl.value : '').trim().toLowerCase();
          row.querySelectorAll('.pay-item').forEach(btn => {
            const hit = !kw || (btn.dataset.payName || '').toLowerCase().includes(kw);
            btn.style.display = hit ? '' : 'none';
          });
        };
        const paySearch = row.querySelector('.pay-search');
        if (paySearch) paySearch.oninput = applySearch;
        row.querySelectorAll('.pay-tab').forEach(btn => {
          btn.onclick = () => {
            row.querySelectorAll('.pay-tab').forEach(x => x.classList.remove('primary'));
            row.querySelectorAll('.pay-tab').forEach(x => x.classList.add('ghost'));
            btn.classList.add('primary');
            btn.classList.remove('ghost');
            const key = btn.dataset.payTab;
            row.querySelectorAll('.sell-payment-group').forEach(g => {
              const active = g.dataset.payGroup === key;
              g.classList.toggle('active', active);
              g.style.display = active ? '' : 'none';
            });
            applySearch();
          };
        });
        row.querySelectorAll('.pay-item').forEach(btn => {
          btn.onclick = () => {
            row.querySelectorAll('.pay-item').forEach(x => x.classList.remove('primary'));
            btn.classList.add('primary');
            row.querySelector('.sell-mat').value = btn.dataset.payName || '';
          };
        });
        applySearch();
        const okBtn = row.querySelector('.sell-ok');
        if (okBtn) {
          okBtn.onclick = async () => {
            const mat = row.querySelector('.sell-mat').value;
            const qty = Number(row.querySelector('.sell-qty').value);
            if (!mat) { showToast('❌ 上架失败', '请选择收款物'); return; }
            if (!Number.isInteger(qty) || qty < 1) { showToast('❌ 上架失败', '请填正整数数量'); return; }
            const res = await Market.listPet(pet, mat, qty);
            expandedPetId = null;
            if (res.error) showToast('❌ 上架失败', res.error);
            else showToast('📢 上架成功', `${pet.name} 已挂到市场，收 ${qty} ${mat}`);
            UI.renderAll();
          };
        }
        const cancelBtn = row.querySelector('.sell-cancel');
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            expandedPetId = null;
            UI.renderAll();
          };
        }
      }

    // 装备区（右列，可折叠）
    const equips = getInventory().filter(e => e.cloudId);
    const eqGroup = makeMarketGroup('⚔️ 装备上架', equips.length);
    groups.appendChild(eqGroup);
    const eqBody = eqGroup.querySelector('.market-group-body');
    if (!equips.length) eqBody.innerHTML = '<div class="inv-empty">还没有可上架的装备（需先云端存档）</div>';
    for (const eq of equips) {
        const row = document.createElement('div');
        row.className = 'market-item item sell-row';
        // 供装备页「上架」按钮跳转定位；浏览器 dataset 是只读 getter，不能整体赋值（VM 桩无 dataset 则用普通属性）
        if (row.dataset) row.dataset.cloudId = eq.cloudId;
        else row._cloudId = eq.cloudId;
        const mine = Market.isItemListed(eq.cloudId);
        const expanded = expandedItemId === eq.cloudId;
        row.innerHTML = `
          <div class="m-info"><div class="m-name" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}</div><div class="m-desc">${rarityOf(eq).label}装 · T${eq.tier}｜${eq.slot}</div></div>
          ${expanded
            ? sellForm()
            : (mine ? '<button class="btn-sm alt sell-recall">取回</button>' : '<button class="btn-sm sell-open">上架</button>')}`;
        eqBody.appendChild(row);
        const openBtn = row.querySelector('.sell-open');
        if (openBtn) {
          openBtn.onclick = () => {
            expandedItemId = eq.cloudId; // 记录展开态 → renderAll 后保持展开
            UI.renderAll();
          };
        }
        const recall = row.querySelector('.sell-recall');
        if (recall) {
          recall.onclick = async () => {
            const listing = Market.getItemListing(eq.cloudId);
            if (!listing) return;
            const res = await Market.cancelItem(listing.listingId);
            if (res.error) showToast('❌ 取回失败', res.error);
            else { showToast('↩️ 已取回', `${eq.name} 已下架`); UI.renderAll(); }
          };
        }
        const applySearch = () => {
          const searchEl = row.querySelector('.pay-search');
          const kw = (searchEl ? searchEl.value : '').trim().toLowerCase();
          row.querySelectorAll('.pay-item').forEach(btn => {
            const hit = !kw || (btn.dataset.payName || '').toLowerCase().includes(kw);
            btn.style.display = hit ? '' : 'none';
          });
        };
        const paySearch = row.querySelector('.pay-search');
        if (paySearch) paySearch.oninput = applySearch;
        row.querySelectorAll('.pay-tab').forEach(btn => {
          btn.onclick = () => {
            row.querySelectorAll('.pay-tab').forEach(x => x.classList.remove('primary'));
            row.querySelectorAll('.pay-tab').forEach(x => x.classList.add('ghost'));
            btn.classList.add('primary');
            btn.classList.remove('ghost');
            const key = btn.dataset.payTab;
            row.querySelectorAll('.sell-payment-group').forEach(g => {
              const active = g.dataset.payGroup === key;
              g.classList.toggle('active', active);
              g.style.display = active ? '' : 'none';
            });
            applySearch();
          };
        });
        row.querySelectorAll('.pay-item').forEach(btn => {
          btn.onclick = () => {
            row.querySelectorAll('.pay-item').forEach(x => x.classList.remove('primary'));
            btn.classList.add('primary');
            row.querySelector('.sell-mat').value = btn.dataset.payName || '';
          };
        });
        applySearch();
        const okBtn = row.querySelector('.sell-ok');
        if (okBtn) {
          okBtn.onclick = async () => {
            const mat = row.querySelector('.sell-mat').value;
            const qty = Number(row.querySelector('.sell-qty').value);
            if (!mat) { showToast('❌ 上架失败', '请选择收款物'); return; }
            if (!Number.isInteger(qty) || qty < 1) { showToast('❌ 上架失败', '请填正整数数量'); return; }
            const res = await Market.listItem(eq, mat, qty);
            expandedItemId = null;
            if (res.error) showToast('❌ 上架失败', res.error);
            else showToast('📢 上架成功', `${eq.name} 已挂到市场，收 ${qty} ${mat}`);
            UI.renderAll();
          };
        }
        const cancelBtn = row.querySelector('.sell-cancel');
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            expandedItemId = null;
            UI.renderAll();
          };
        }
      }

    // 宠物蛋上架（来自宠物页「宠物蛋」tab 的蛋品种）
    const Drop = window.Drop;
    const eggMap = (Drop && Drop.getEggs) ? Drop.getEggs() : {};
    const eggEntries = Object.entries(eggMap).filter(([, n]) => n > 0);
    const eggGroup = makeMarketGroup('🥚 宠物蛋上架', eggEntries.length);
    groups.appendChild(eggGroup);
    const eggBody = eggGroup.querySelector('.market-group-body');
    if (!eggEntries.length) eggBody.innerHTML = '<div class="inv-empty">还没有可上架的蛋（先去挂机捡蛋）</div>';
    for (const [baseName, n] of eggEntries) {
      const mine = Market.isMyEggListed ? Market.isMyEggListed(baseName) : false;
      const expanded = expandedEggId === baseName;
      const row = document.createElement('div');
      row.className = 'market-item sell-row';
      row.innerHTML = `
        <div class="m-info"><span class="m-name">🥚 ${escapeHtml(baseName)}蛋</span><span class="m-growth">×${n}</span></div>
        ${expanded
          ? sellForm()
          : (mine ? '<button class="btn-sm alt sell-recall">取回</button>' : '<button class="btn-sm sell-open">上架</button>')}`;
      eggBody.appendChild(row);
      const openBtn = row.querySelector('.sell-open');
      if (openBtn) {
        openBtn.onclick = () => {
          expandedEggId = baseName;
          UI.renderAll();
        };
      }
      const recall = row.querySelector('.sell-recall');
      if (recall) {
        recall.onclick = async () => {
          const my = Market.getMyListedEggs ? Market.getMyListedEggs().find(x => x.eggType === baseName) : null;
          if (!my) return;
          const res = await Market.cancelEgg(my.listingId);
          if (res.error) showToast('❌ 取回失败', res.error);
          else { showToast('↩️ 已取回', `${baseName}蛋 已下架`); UI.renderAll(); }
        };
      }
      const applySearch = () => {
        const searchEl = row.querySelector('.pay-search');
        const kw = (searchEl ? searchEl.value : '').trim().toLowerCase();
        row.querySelectorAll('.pay-item').forEach(btn => {
          const hit = !kw || (btn.dataset.payName || '').toLowerCase().includes(kw);
          btn.style.display = hit ? '' : 'none';
        });
      };
      const paySearch = row.querySelector('.pay-search');
      if (paySearch) paySearch.oninput = applySearch;
      row.querySelectorAll('.pay-tab').forEach(btn => {
        btn.onclick = () => {
          row.querySelectorAll('.pay-tab').forEach(x => x.classList.remove('primary'));
          row.querySelectorAll('.pay-tab').forEach(x => x.classList.add('ghost'));
          btn.classList.add('primary');
          btn.classList.remove('ghost');
          const key = btn.dataset.payTab;
          row.querySelectorAll('.sell-payment-group').forEach(g => {
            const active = g.dataset.payGroup === key;
            g.classList.toggle('active', active);
            g.style.display = active ? '' : 'none';
          });
        };
      });
      const payItems = row.querySelectorAll('.pay-item');
      const selMat = row.querySelector('.sell-mat');
      if (selMat && payItems.length) {
        const first = payItems[0];
        selMat.value = first.dataset.payName;
        payItems.forEach(p => p.classList.toggle('primary', p === first));
      }
      if (payItems.length) {
        payItems.forEach(p => {
          p.onclick = () => {
            row.querySelectorAll('.pay-item').forEach(x => x.classList.remove('primary'));
            p.classList.add('primary');
            row.querySelector('.sell-mat').value = p.dataset.payName;
          };
        });
      }
      const okBtn = row.querySelector('.sell-ok');
      if (okBtn) {
        okBtn.onclick = async () => {
          const mat = row.querySelector('.sell-mat').value;
          const qty = Number(row.querySelector('.sell-qty').value);
          if (!mat) { showToast('❌ 上架失败', '请选择收款物'); return; }
          if (!Number.isInteger(qty) || qty < 1) { showToast('❌ 上架失败', '请填正整数数量'); return; }
          const res = await Market.listEgg(baseName, mat, qty);
          expandedEggId = null;
          if (res.error) showToast('❌ 上架失败', res.error);
          else showToast('📢 上架成功', `${baseName}蛋 已挂到市场，收 ${qty} ${mat}`);
          UI.renderAll();
        };
      }
      const cancelBtn = row.querySelector('.sell-cancel');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          expandedEggId = null;
          UI.renderAll();
        };
      }
    }

    if (!pets.length && !equips.length && !eggEntries.length) {
      const hint = document.createElement('div');
      hint.className = 'inv-empty';
      hint.textContent = '还没有可上架的物品（宠物/装备/蛋）';
      box.insertBefore(hint, groups);
    }
  }

  /* ---------- 交易记录面板（卖出 / 买入 / 汇总） ---------- */
  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      return `<span class="net-chip ${n >= 0 ? 'pos' : 'neg'}">${m.icon} ${m.name} ${n >= 0 ? '+' : ''}${n}</span>`;
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
          <span class="tr-price">${r.price_qty} ${mat.icon} ${mat.name}</span>`;
        buyBox.appendChild(row);
      }
    }
  }

  /* ---------- 装备页「上架」直达：跳我的上架页并自动展开该装备的上架表单 ---------- */
  function openSellForItem(eq) {
    if (!eq || !eq.cloudId) { showToast('❌ 无法上架', '该装备需先云端存档'); return; }
    if (UI.switchPage) UI.switchPage('market-sell'); // 切到我的上架页（display 显隐，不销毁页面）
    UI.renderAll(); // 重建我的上架页（含上架区）
    const rows = document.querySelectorAll('#market-sell .sell-row');
    let row = null;
    rows.forEach(r => {
      const cid = r.dataset ? r.dataset.cloudId : r._cloudId;
      if (cid === eq.cloudId) row = r;
    });
    if (!row) { showToast('⚠️ 未找到上架入口', '该装备可能已在售或未存档'); return; }
    const openBtn = row.querySelector('.sell-open');
    if (openBtn) openBtn.click(); // 复用现有「上架」展开表单逻辑
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
    $('trade-ok').onclick = async () => {
      $('trade-modal').style.display = 'none';
      // 假卖家挂单走 buyBotItem/buyBotPet（本地扣材料 + 物品入列）；真实挂单走 buyItem/buy RPC
      const res = isPet
        ? (l.isBot ? await Market.buyBotPet(l.id) : await Market.buy(l.id))
        : (l.isBot ? await Market.buyBotItem(l.id) : await Market.buyItem(l.id));
      if (res.error) { showToast('❌ 购买失败', res.error); return; }
      // 本地扣材料（真实购买：云端 RPC 已扣，本地同步减；假单购买 buyBot* 内部已扣，不重复）
      if (l.material_type && !l.isBot) Materials.spendLocal(l.material_type, l.material_qty || 0);
      showToast('🎉 购买成功！', isPet ? `${l.pet_name} 已加入你的宠物列表`
        : (l.isBot ? `${l.item_name} 已加入你的背包（来自${l.seller || '流浪商人'}）` : `${l.item_name} 已加入你的背包`));
      // 单条拉取新宠物/装备追加本地（假单物品已直接入列，无需拉取）
      if (isPet) { if (!l.isBot) await window.Game.afterBuyPet(res.petId); }
      else if (!l.isBot) await window.Game.afterBuyItem(res.itemId);
      UI.renderAll();
    };
    $('trade-cancel').onclick = () => { $('trade-modal').style.display = 'none'; };
  }
  function closeBuyPanel() {
    $('trade-modal').style.display = 'none';
  }

  /* ---------- 对外 API（市场页） ---------- */
  UI.renderMarket = renderMarket;
  UI.renderItemMarket = renderItemMarket;
  UI.renderSellArea = renderSellArea;
  UI.renderTradeRecords = renderTradeRecords;
  UI.openBuyConfirm = openBuyConfirm;
  UI.closeBuyPanel = closeBuyPanel;
  UI.openSellForItem = openSellForItem;
})();
