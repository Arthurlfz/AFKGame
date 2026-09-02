(function () {
  'use strict';
  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;
  const Config = window.Config;
  const Market = window.Market;
  const Materials = window.Materials;
  const { getPets, getStats, getActivePet } = window.Pet;
  const { SLOTS, unequip, describeItem, rarityOf, equipItem, getInventory, flattenAffixes } = window.Equipment;
  const PetSprites = window.PetSprites;
  const MarketUI = window.MarketUI || (window.MarketUI = {});
  const { makeMarketGroup } = MarketUI;

  let expandedPetId = null, expandedItemId = null, expandedEggId = null;

  /* ---------- 定价弹窗（点「上架」弹出：选收款物 + 数量 + 确认） ---------- */
  let sellModalState = null; // { kind: 'pet'|'item'|'egg', payload, selectedMat }

  function buildPaymentPanel() {
    const evoMatName = (Config.pet.evolution && Config.pet.evolution.materialName) || '进化素材';
    const evolutionItems = Config.trade.materials
      .filter(m => m.category === 'evo'&& m.name === evoMatName)
      .map(m => ({ id: m.id, name: m.name, icon: m.icon, category: 'evo'}));
    const paymentGroups = [
      { key: 'currency', label: '通货', items: Config.trade.materials.filter(m => m.category === 'stone'&& Market.isPaymentMaterial(m.name)) },
      { key: 'evo', label: '进化素材', items: evolutionItems },
      { key: 'other', label: '其他', items: Config.trade.materials.filter(m => ['egg', 'beast', 'soul'].includes(m.category) && Market.isPaymentMaterial(m.name)) },
    ];
    return paymentGroups;
  }

  function openSellModal(kind, payload) {
    const paymentGroups = buildPaymentPanel();
    let mask = $('mk-sell-modal');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.id = 'mk-sell-modal';
      mask.style.display = 'none';
      mask.innerHTML = `
        <div class="modal">
          <div class="modal-title"> 上架定价</div>
          <div class="modal-body mk-sell-modal-body" id="mk-sell-body"></div>
          <div class="modal-actions">
            <button class="btn-mini ghost" id="mk-sell-cancel">取消</button>
            <button class="btn-mini primary" id="mk-sell-ok">确认上架</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
    }
    sellModalState = { kind, payload, selectedMat: ''};

    const title = kind === 'pet'? `${payload.name}（成长${payload.growth} · Lv.${payload.level}）`
      : kind === 'item'? `${payload.name}` : `${window.Drop.makeEggName(payload)}`;
    const avatar = (kind === 'pet'&& window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(payload.name) : null;
    const body = $('mk-sell-body');
    body.innerHTML = `
      <div class="mk-sell-target">
        ${kind === 'pet'
          ? (avatar ? `<img class="mk-avatar" src="${avatar}">` : '<div class="mk-avatar mk-avatar--item="></div>')
          : kind === 'item'? '<div class="mk-avatar mk-avatar--item="></div>': '<div class="mk-egg-icon"></div>'}
        <div class="mk-card-info"><div class="mk-name">${escapeHtml(title)}</div><div class="mk-meta">选择收款物并定价</div></div>
      </div>
      <div class="sell-payment">
        <div class="sell-payment-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          ${paymentGroups.map((g, gi) => `<button class="btn-mini ${gi === 0 ? 'primary': 'ghost'} pay-tab" data-pay-tab="${g.key}">${g.label}</button>`).join('')}
        </div>
        ${paymentGroups.map((g, gi) => `
          <div class="sell-payment-group" data-pay-group="${g.key}" style="${gi === 0 ? '': 'display:none'}">
            <div class="sell-payment-list" style="display:flex;flex-wrap:wrap;gap:6px;">
              ${g.items.map(m => `<button class="btn-mini pay-item" data-pay-name="${m.name}" data-pay-key="${g.key}">${m.icon} ${m.name}</button>`).join('') || '<div class="hint">暂无</div>'}
            </div>
          </div>`).join('')}
      </div>
      <div class="mk-sell-price-row">
        <label>上架数量（≥1）</label>
        <input type="number" class="mk-sell-qty-input" id="mk-sell-qty" min="1" value="1">
      </div>
      <div class="hint" style="line-height:1.6">每满 <b>${Config.trade.taxPer}</b> 个材料收 <b>${Config.trade.taxAmount}</b> 个税（不满不收），税由卖家承担。</div>`;

    // 收款物 tab 切换
    body.querySelectorAll('.pay-tab').forEach(btn => {
      btn.onclick = () => {
        body.querySelectorAll('.pay-tab').forEach(x => { x.classList.remove('primary'); x.classList.add('ghost'); });
        btn.classList.add('primary'); btn.classList.remove('ghost');
        const key = btn.dataset.payTab;
        body.querySelectorAll('.sell-payment-group').forEach(g => {
          const on = g.dataset.payGroup === key;
          g.style.display = on ? '': 'none';
        });
      };
    });
    // 收款物选择
    body.querySelectorAll('.pay-item').forEach(btn => {
      btn.onclick = () => {
        body.querySelectorAll('.pay-item').forEach(x => x.classList.remove('primary'));
        btn.classList.add('primary');
        sellModalState.selectedMat = btn.dataset.payName || '';
      };
    });
    // 默认选第一个收款物
    const firstPay = body.querySelector('.pay-item');
    if (firstPay) { firstPay.classList.add('primary'); sellModalState.selectedMat = firstPay.dataset.payName || ''; }

    $('mk-sell-cancel').onclick = () => { mask.style.display = 'none'; };
    $('mk-sell-ok').onclick = async () => {
      const qty = Number($('mk-sell-qty').value);
      if (!sellModalState.selectedMat) { showToast('上架失败', '请选择收款物'); return; }
      if (!Number.isInteger(qty) || qty < 1) { showToast('上架失败', '请填正整数数量'); return; }
      const mat = sellModalState.selectedMat;
      let res = null;
      if (kind === 'pet') res = await Market.listPet(payload, mat, qty);
      else if (kind === 'item') res = await Market.listItem(payload, mat, qty);
      else res = await Market.listEgg(payload, mat, qty);
      if (res.error) { showToast('上架失败', res.error); return; }
      const name = kind === 'pet'? payload.name : kind === 'item'? payload.name : window.Drop.makeEggName(payload);
      showToast('上架成功', `${name} 已挂到市场，收 ${qty} ${mat}`);
      mask.style.display = 'none';
      sellModalState = null;
      UI.renderAll();
    };
    mask.style.display = 'flex';
  }

  function renderSellArea() {
    const box = $('market-sell');
    // 聚焦保护：定价弹窗打开时跳过重建（每秒回血/市场轮询会触发 renderAll）
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('.mk-sell-modal-body')) return;
    box.innerHTML = '';
    if (!UI.isLoggedIn()) {
      box.innerHTML = '<div class="mk-empty">登录后可在市场挂单出售宠物 / 装备</div>';
      return;
    }

    const pets = getPets().filter(p => p.cloudId);
    const equips = getInventory().filter(e => e.cloudId);
    const Drop = window.Drop;
    const eggMap = (Drop && Drop.getEggs) ? Drop.getEggs() : {};
    const eggEntries = Object.entries(eggMap).filter(([, n]) => n > 0);

    // ---- 宠物上架（卡片） ----
    if (pets.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '宠物上架<span class="mk-count">'+ pets.length + '件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const pet of pets) grid.appendChild(buildSellPetCard(pet));
      box.appendChild(grid);
    }

    // ---- 装备上架（卡片 + hover 属性） ----
    if (equips.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '装备上架<span class="mk-count">'+ equips.length + '件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const eq of equips) grid.appendChild(buildSellItemCard(eq));
      box.appendChild(grid);
    }

    // ---- 宠物蛋上架 ----
    if (eggEntries.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '宠物蛋上架<span class="mk-count">'+ eggEntries.length + '件</span>';
      box.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const [baseName, n] of eggEntries) grid.appendChild(buildSellEggCard(baseName, n));
      box.appendChild(grid);
    }

    if (!pets.length && !equips.length && !eggEntries.length) {
      box.innerHTML = '<div class="mk-empty">还没有可上架的物品（宠物/装备/蛋）</div>';
    }
  }

  /* ---- 上架用宠物卡 ---- */
  function buildSellPetCard(pet) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    if (div.dataset) div.dataset.cloudId = pet.cloudId;
    else div._cloudId = pet.cloudId;
    const mine = Market.isListed(pet.cloudId);
    const avatar = window.PetSprites && window.PetSprites.avatarOf ? window.PetSprites.avatarOf(pet.name) : null;
    div.innerHTML = `
      <div class="mk-card-top">
        ${avatar ? `<img class="mk-avatar" src="${avatar}" alt="${escapeHtml(pet.name)}">` : '<div class="mk-avatar mk-avatar--item="></div>'}
        <div class="mk-card-info">
          <div class="mk-name">${escapeHtml(pet.name)}</div>
          <div class="mk-meta">成长${pet.growth} · Lv.${pet.level}</div>
        </div>
      </div>
      <div class="mk-card-foot"><button class="mk-btn ${mine ? 'recall': 'buy'}">${mine ? '取回': '上架'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = mine ? async () => {
      const listing = Market.getPetListing(pet.cloudId);
      if (!listing) return;
      const res = await Market.cancelPet(listing.listingId);
      if (res.error) showToast('取回失败', res.error);
      else { showToast('已取回', `${pet.name} 已下架`); UI.renderAll(); }
    } : () => openSellModal('pet', pet);
    return div;
  }

  /* ---- 上架用装备卡（hover 显示属性） ---- */
  function buildSellItemCard(eq) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    if (div.dataset) div.dataset.cloudId = eq.cloudId;
    else div._cloudId = eq.cloudId;
    const mine = Market.isItemListed(eq.cloudId);
    const r = rarityOf(eq);
    const desc = describeItem ? describeItem(eq) : '';
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-avatar mk-avatar--item="></div>
        <div class="mk-card-info">
          <div class="mk-name" style="color:${r.color}">${escapeHtml(eq.name)}</div>
          <div class="mk-meta">${r.label}装 · T${eq.tier}｜${eq.slot}</div>
        </div>
      </div>
      <div class="mk-affix">${escapeHtml(desc) || '<span style="color:var(--text-faint)">无词缀</span>'}</div>
      <div class="mk-card-foot"><button class="mk-btn ${mine ? 'recall': 'buy'}">${mine ? '取回': '上架'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = mine ? async () => {
      const listing = Market.getItemListing(eq.cloudId);
      if (!listing) return;
      const res = await Market.cancelItem(listing.listingId);
      if (res.error) showToast('取回失败', res.error);
      else { showToast('已取回', `${eq.name} 已下架`); UI.renderAll(); }
    } : () => openSellModal('item', eq);
    return div;
  }

  /* ---- 上架用宠物蛋卡 ---- */
  function buildSellEggCard(baseName, n) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const mine = Market.isMyEggListed ? Market.isMyEggListed(baseName) : false;
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon"></div>
        <div class="mk-card-info">
          <div class="mk-name">${escapeHtml(window.Drop.makeEggName(baseName))}</div>
          <div class="mk-meta">持有 ×${n}</div>
        </div>
      </div>
      <div class="mk-card-foot"><button class="mk-btn ${mine ? 'recall': 'buy'}">${mine ? '取回': '上架'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = mine ? async () => {
      const my = Market.getMyListedEggs ? Market.getMyListedEggs().find(x => x.eggType === baseName) : null;
      if (!my) return;
      const res = await Market.cancelEgg(my.listingId);
      if (res.error) showToast('取回失败', res.error);
      else { showToast('已取回', `${window.Drop.makeEggName(baseName)} 已下架`); UI.renderAll(); }
    } : () => openSellModal('egg', baseName);
    return div;
  }

  /* ---------- 装备页「上架」直达：跳我的上架页并自动展开该装备的上架定价 ---------- */
  function openSellForItem(eq) {
    if (!eq || !eq.cloudId) { showToast('无法上架', '该装备需先云端存档'); return; }
    if (UI.switchPage) UI.switchPage('market-sell'); // 切到我的上架页（display 显隐，不销毁页面）
    UI.renderAll(); // 重建我的上架页（含上架区）
    // 定位该装备卡片，若在售则直接提示；否则打开定价弹窗
    const mine = Market.isItemListed(eq.cloudId);
    if (mine) { showToast('已在售', '该装备正在市场出售，先取回'); return; }
    const listing = Market.getItemListing(eq.cloudId);
    if (listing) { showToast('已在售', '该装备正在市场出售，先取回'); return; }
    openSellModal('item', eq);
  }

  /* ---------- 对外 API ---------- */
  UI.renderSellArea = renderSellArea;
  UI.openSellForItem = openSellForItem;
})();
