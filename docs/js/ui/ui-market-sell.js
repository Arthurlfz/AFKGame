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

  /* ---------- 上架可选收款物（唯一来源 = Config.trade.materials 白名单） ----------
   * 2026-09-10 修：旧写法手写 3 组，其中「进化素材」硬编码 `name === '进化素材'`
   * （精粹 / 传说进化素材被剔掉），而通天塔新增的 12 个「腐印」（category='affix'）
   * 不属于任何一组 —— config 里明明能交易，界面上永远选不到。
   * 现在按 category 自动归组：只要进了 Config.trade.materials 白名单，这里就一定选得到。 */
  const PAY_GROUP_ORDER = [
    { cat: 'stone', key: 'stone', label: '通货' },
    { cat: 'evo', key: 'evo', label: '进化素材' },
    { cat: 'evolve', key: 'evolve', label: '进化丹' },
    { cat: 'synth', key: 'synth', label: '合成石' },
    { cat: 'affix', key: 'affix', label: '腐印' },
    { cat: 'beast', key: 'beast', label: '兽类素材' },
    { cat: 'egg', key: 'egg', label: '宠物蛋' },
    { cat: 'soul', key: 'soul', label: '魂石' },
  ];
  function buildPaymentPanel() {
    const mats = (Config.trade.materials || []).filter(m => Market.isPaymentMaterial(m.name));
    const groups = [];
    const push = (key, label, items) => { if (items.length) groups.push({ key, label, items }); };
    for (const g of PAY_GROUP_ORDER) push(g.key, g.label, mats.filter(m => (m.category || 'other') === g.cat));
    // 兜底：config 以后新增了没登记过的 category，也不会在界面上凭空消失
    const known = PAY_GROUP_ORDER.map(g => g.cat);
    push('misc', '其他', mats.filter(m => known.indexOf(m.category || 'other') < 0));
    return groups;
  }

  function openSellModal(kind, payload) {
    // 挂单额度校验（Config.trade.maxListings 以前只写在配置和百科里，从没拦过人）
    const quota = Market.listQuota ? Market.listQuota() : null;
    if (quota && !quota.ok) {
      showToast('❌ 挂单已满', `最多同时挂 ${quota.max} 单（宠物 / 装备 / 蛋共用），先取回一件再挂`);
      return;
    }
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
      : kind === 'item'? `${payload.name}`
        : kind === 'material'? `${payload.name} ×${payload.qty}`
          : `${window.Drop.makeEggName(payload)}`;
    const avatar = (kind === 'pet'&& window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(payload.name) : null;
    const body = $('mk-sell-body');
    body.innerHTML = `
      <div class="mk-sell-target">
        ${kind === 'pet'
          ? (avatar ? `<img class="mk-avatar" src="${avatar}">` : '<div class="mk-avatar mk-avatar--item"></div>')
          : kind === 'item'? '<div class="mk-avatar mk-avatar--item"></div>'
            : kind === 'material'? `<div class="mk-egg-icon">${Market.findMaterial(payload.name).icon || '📦'}</div>`
              : '<div class="mk-egg-icon">🥚</div>'}
        <div class="mk-card-info"><div class="mk-name">${escapeHtml(title)}</div><div class="mk-meta">选择收款物并定价</div></div>
      </div>
      <div class="sell-payment">
        <div class="sell-payment-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          ${paymentGroups.map((g, gi) => `<button class="btn-mini ${gi === 0 ? 'primary': 'ghost'} pay-tab" data-pay-tab="${g.key}">${g.label}<span class="pay-tab-num">${g.items.length}</span></button>`).join('')}
        </div>
        ${paymentGroups.map((g, gi) => `
          <div class="sell-payment-group" data-pay-group="${g.key}" style="${gi === 0 ? '': 'display:none'}">
            <div class="sell-payment-list" style="display:flex;flex-wrap:wrap;gap:6px;">
              ${g.items.map(m => `<button class="btn-mini pay-item" data-pay-name="${m.name}" data-pay-key="${g.key}">${m.icon} ${m.name}</button>`).join('') || '<div class="hint">暂无</div>'}
            </div>
          </div>`).join('')}
      </div>
      ${kind === 'material' ? `
      <div class="mk-sell-price-row">
        <label>出售数量（持有 ${payload.qty}）</label>
        <input type="number" class="mk-sell-qty-input" id="mk-sell-good-qty" min="1" max="${payload.qty}" value="${payload.qty}">
      </div>` : ''}
      <div class="mk-sell-price-row">
        <label>要收多少份（≥1）</label>
        <input type="number" class="mk-sell-qty-input" id="mk-sell-qty" min="1" value="1">
      </div>
      <div class="sell-ref" id="mk-sell-ref"></div>
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

    /* 查价 + 税后到手（参考火炬之光交易行的「上架查价」）：
     * 参考价 = 同类商品 + 同收款材料 的在售标价中位数；随收款物/数量实时刷新。
     * 只改这个容器的内容，不重渲染面板，所以输入时不会丢焦点。 */
    const readQty = () => Number(($('mk-sell-qty') || {}).value) || 0;
    const refreshRef = () => {
      const refBox = $('mk-sell-ref');
      if (!refBox) return;
      const matName = sellModalState.selectedMat;
      const qty = readQty();
      const info = (UI.marketRefPrice && matName) ? UI.marketRefPrice(kind, payload, matName) : null;
      const tax = Market.calcTax(qty);
      const lines = [];
      if (info && info.median) {
        let s = `同类在售 ${info.samples} 件，中位价 <b>${Math.round(info.median * 10) / 10}</b> ${matName}`;
        if (qty > 0) {
          const diff = (info.median - qty) / info.median;
          if (diff >= (Config.trade.dealDiscount || 0.2)) s += ` · <span class="sell-ref-good">比市价低 ${Math.round(diff * 100)}%，好卖</span>`;
          else if (diff <= -(Config.trade.overpriceMarkup || 0.25)) s += ` · <span class="sell-ref-bad">比市价高 ${Math.round(-diff * 100)}%，可能滞销</span>`;
        }
        lines.push(s);
      } else {
        lines.push(`<span class="hint">同类在售样本不足${info ? '（仅 ' + info.samples + ' 件）' : ''}，暂无参考价</span>`);
      }
      lines.push(`税 ${tax}，你实收 <b>${Math.max(0, qty - tax)}</b> ${matName || ''}`);
      refBox.innerHTML = lines.map(t => '<div class="sell-ref-line">' + t + '</div>').join('');
    };

    // 收款物选择
    body.querySelectorAll('.pay-item').forEach(btn => {
      btn.onclick = () => {
        body.querySelectorAll('.pay-item').forEach(x => x.classList.remove('primary'));
        btn.classList.add('primary');
        sellModalState.selectedMat = btn.dataset.payName || '';
        refreshRef();
      };
    });
    // 默认选第一个收款物
    const firstPay = body.querySelector('.pay-item');
    if (firstPay) { firstPay.classList.add('primary'); sellModalState.selectedMat = firstPay.dataset.payName || ''; }
    const qtyEl = $('mk-sell-qty');
    if (qtyEl) qtyEl.oninput = refreshRef;
    refreshRef();

    $('mk-sell-cancel').onclick = () => { mask.style.display = 'none'; };
    // 上架是多次云端往返：按钮锁 + 载入态，防连点重复挂单（铁律：异步写操作必须闸门）
    const okBtn = $('mk-sell-ok');
    const readGoodQty = () => Number(($('mk-sell-good-qty') || {}).value);
    okBtn.onclick = () => UI.runWithLoading(okBtn, '上架中…', async () => {
      const qty = Number($('mk-sell-qty').value);
      if (!sellModalState.selectedMat) { showToast('上架失败', '请选择收款物'); return; }
      if (!Number.isInteger(qty) || qty < 1) { showToast('上架失败', '请填正整数数量'); return; }
      const mat = sellModalState.selectedMat;
      let res = null;
      let name = '';
      if (kind === 'pet') { res = await Market.listPet(payload, mat, qty); name = payload.name; }
      else if (kind === 'item') { res = await Market.listItem(payload, mat, qty); name = payload.name; }
      else if (kind === 'material') {
        const gq = readGoodQty();
        if (!Number.isInteger(gq) || gq < 1) { showToast('上架失败', '请填正整数出售数量'); return; }
        if (gq > payload.qty) { showToast('上架失败', `最多只能卖 ${payload.qty} 份`); return; }
        res = await Market.listMaterial(payload.name, gq, mat, qty);
        name = `${payload.name} ×${gq}`;
      }
      else { res = await Market.listEgg(payload, mat, qty); name = window.Drop.makeEggName(payload); }
      if (res.error) { showToast('上架失败', res.error); return; }
      // 材料：云端 list_material 已原子扣库存，本地同步减（与购买流程同口径）
      if (kind === 'material') Materials.spendLocal(payload.name, readGoodQty() || 0);
      showToast('上架成功', `${name} 已挂到市场，收 ${qty} ${mat}`);
      mask.style.display = 'none';
      sellModalState = null;
      UI.renderAll();
    });
    mask.style.display = 'flex';
  }

  function renderSellArea(box) {
    // 支持注入容器（市集页「我的上架」视图传结果区容器）；
    // 兼容旧调用：renderAll 无参调用时回退到 #market-sell（页面已并入市集，不再存在 → 直接跳过）
    const target = box || $('market-sell');
    if (!target) return;
    // 聚焦保护：定价弹窗打开时跳过重建（每秒回血/市场轮询会触发 renderAll）
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('.mk-sell-modal-body')) return;
    target.innerHTML = '';
    if (!UI.isLoggedIn()) {
      target.innerHTML = '<div class="mk-empty">登录后可在市场挂单出售宠物 / 装备</div>';
      return;
    }

    /* 与级联筛选联动：按当前市集「类型」过滤上架分区。
     * 「材料」不是玩家可上架的品类（能卖的是宠物/装备/蛋，材料只当收款物），
     * 所以 kind='material' 时不过滤，否则「我的上架」会看起来一片空白。 */
    const mf = (UI.getMarketFilters ? UI.getMarketFilters() : null) || {};
    const k = mf.kind || 'all';
    const showAll = k === 'all' || k === 'material';
    const showPet = showAll || k === 'pet';
    const showItem = showAll || k === 'item';
    const showEgg = k !== 'item';

    const pets = getPets().filter(p => p.cloudId && showPet);
    const equips = getInventory().filter(e => e.cloudId && showItem);
    const Drop = window.Drop;
    const eggMap = (Drop && Drop.getEggs) ? Drop.getEggs() : {};
    const eggEntries = Object.entries(eggMap).filter(([, n]) => n > 0 && showEgg);

    /* 材料上架（2026-09-10「万物皆可交易」）：列出手里有的、在白名单里的材料。
     * 以前只有 AI 能卖材料 —— 玩家从通天塔/守关 Boss 打出来的高价值材料完全没有出口。 */
    const showMat = showAll || k === 'material';
    const held = (Materials.getLocal ? Materials.getLocal() : {});
    const matEntries = showMat
      ? Object.keys(held)
        .filter(n => held[n] > 0 && Market.isPaymentMaterial(n))
        .map(n => ({ name: n, qty: held[n] }))
        .sort((a, b) => b.qty - a.qty)
      : [];

    const total = pets.length + equips.length + eggEntries.length + matEntries.length;
    const cnt = $('rpCount');
    if (cnt) cnt.textContent = '我的 ' + total + ' 件';

    // 挂单额度条：宠物 + 装备 + 蛋 共用 Config.trade.maxListings
    const quota = Market.listQuota ? Market.listQuota() : null;
    if (quota) {
      const bar = document.createElement('div');
      bar.className = 'mk-quota' + (quota.ok ? '' : ' is-full');
      bar.innerHTML = `挂单额度 <b>${quota.used}/${quota.max}</b>`
        + (quota.ok ? `　还可挂 ${quota.left} 单` : '　已满，先取回一件再挂');
      target.appendChild(bar);
    }
    // 「材料」类型下的说明：材料不是可上架品类，别让玩家以为这里该有材料卡
    if (k === 'material') {
      const tip = document.createElement('div');
      tip.className = 'mk-quota';
      tip.innerHTML = '材料不是可上架的品类：能卖的是宠物 / 装备 / 宠物蛋；材料只在「定价」弹窗里作为收款物出现。';
      target.appendChild(tip);
    }

    // ---- 宠物上架（卡片） ----
    if (pets.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '宠物上架<span class="mk-count">'+ pets.length + '件</span>';
      target.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const pet of pets) grid.appendChild(buildSellPetCard(pet));
      target.appendChild(grid);
    }

    // ---- 装备上架（卡片 + hover 属性） ----
    if (equips.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '装备上架<span class="mk-count">'+ equips.length + '件</span>';
      target.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const eq of equips) grid.appendChild(buildSellItemCard(eq));
      target.appendChild(grid);
    }

    // ---- 宠物蛋上架 ----
    if (eggEntries.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '宠物蛋上架<span class="mk-count">'+ eggEntries.length + '件</span>';
      target.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const [baseName, n] of eggEntries) grid.appendChild(buildSellEggCard(baseName, n));
      target.appendChild(grid);
    }

    // ---- 材料上架（以物易物：卖 N 份某材料，收 M 份某材料） ----
    if (matEntries.length) {
      const sec = document.createElement('div');
      sec.className = 'mk-section';
      sec.innerHTML = '材料上架<span class="mk-count">' + matEntries.length + ' 种</span>';
      target.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'mk-grid';
      for (const entry of matEntries) grid.appendChild(buildSellMaterialCard(entry));
      target.appendChild(grid);
    }

    if (!pets.length && !equips.length && !eggEntries.length && !matEntries.length) {
      // 用 append 而不是 innerHTML：否则会把上面的「挂单额度」条一起覆盖掉
      const empty = document.createElement('div');
      empty.className = 'mk-empty';
      empty.textContent = '还没有可上架的物品（宠物/装备/蛋）';
      target.appendChild(empty);
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

  /* ---- 上架用材料卡（以物易物：卖 N 份某材料 ←→ 收 M 份某材料） ---- */
  function buildSellMaterialCard(entry) {
    const div = document.createElement('div');
    div.className = 'mk-card';
    const mat = Market.findMaterial(entry.name);
    const listed = Market.getMaterialListing ? Market.getMaterialListing(entry.name) : null;
    div.innerHTML = `
      <div class="mk-card-top">
        <div class="mk-egg-icon">${mat.icon || '📦'}</div>
        <div class="mk-card-info">
          <div class="mk-name">${escapeHtml(entry.name)}</div>
          <div class="mk-meta">持有 ×${entry.qty}${listed ? ' · 已挂 ×' + (listed.goodQty || 0) : ''}</div>
        </div>
      </div>
      <div class="mk-card-foot"><button class="mk-btn ${listed ? 'recall' : 'buy'}">${listed ? '取回' : '上架'}</button></div>`;
    const btn = div.querySelector('.mk-btn');
    btn.onclick = listed ? async () => {
      const res = await Market.cancelMaterial(listed.listingId);
      if (res.error) showToast('取回失败', res.error);
      else { showToast('已取回', `${entry.name} ×${listed.goodQty || 0} 已回到背包`); UI.renderAll(); }
    } : () => openSellModal('material', entry);
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
