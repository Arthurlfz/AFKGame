/* ============================================================
 * ui/ui-bag.js —— 独立背包页 UI
 * 职责：
 *  1. 按分类显示：装备 / 素材 / 消耗品 / 宠物蛋
 *  2. 装备可查看详情、穿上；素材/消耗品仅展示数量与名称；宠物蛋可孵化
 *  3. 数据全部复用现有 Equipment / Materials / Drop / Items，不改数据结构
 *  4. 不影响战斗页的「背包装备」区块（仍保留原样，只显示装备）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;
  const Config = window.Config;
  const { getInventory, equipItem, describeItem, rarityOf, flattenAffixes } = window.Equipment;
  const { getEggCount, hatchEgg } = window.Drop;
  const { getActivePet } = window.Pet;
  const Materials = window.Materials;

  const CONSUMABLES = [
    { name: Config.craft.reforge.name, icon: '🎲', desc: '重铸全部词缀' },
    { name: Config.craft.strip.name, icon: '✂️', desc: '移除一条词缀' },
    { name: Config.craft.holy.name, icon: '🔮', desc: '重 Roll 词缀数值' },
    { name: Config.craft.augment.name, icon: '➕', desc: '新增词缀' }
  ];
  // 背包搜索词 / 品质筛选 / 当前 tab（renderAll 高频重建，用 state 保存）
  const RARITY_ORDER = { gold: 0, blue: 1, white: 2 };
  const EQUIP_SLOTS = window.Equipment.SLOTS || [];
  const BAG_TIERS = [1, 2, 3, 4, 5];
  let bagSearch = '';
  let bagRarity = 'all'; // all / gold / blue / white
  let bagSlot = 'all';   // all / 12部位中文名
  let bagBaseTier = 'all'; // all / '1'~'5'（底材T阶）
  let bagAffixTier = 'all'; // all / '1'~'5'（最高词缀T阶）
  let bagAffixType = 'all'; // all / 词缀类型（atk/dropQty等）

  // 通用格子 tooltip 浮层（悬停显示完整信息，body 层 fixed 不被裁）
  function showBagTip(card, html) {
    const tip = $('bag-tooltip');
    if (!tip) return;
    tip.innerHTML = html;
    const r = card.getBoundingClientRect();
    tip.style.left = (r.right + 10) + 'px';
    tip.style.top = Math.max(6, r.top) + 'px';
    tip.classList.add('show');
  }
  function hideBagTip() {
    const tip = $('bag-tooltip');
    if (tip) tip.classList.remove('show');
  }
  function bindTip(card, html) {
    if (!card) return;
    card.addEventListener('mouseenter', () => showBagTip(card, html));
    card.addEventListener('mouseleave', hideBagTip);
  }

  function renderBag() {
    const root = $('bag-root');
    if (!root) return;
    root.innerHTML = '';

    const equipList = getInventory();
    const localMats = Materials.getLocal ? Materials.getLocal() : {};
    const matEntries = Object.entries(localMats)
      .filter(([name]) => !CONSUMABLES.some(c => c.name === name))
      .map(([name, qty]) => ({ name, qty }));
    const consEntries = CONSUMABLES.map(c => ({ ...c, qty: Materials.getQuantity(c.name) })).filter(x => x.qty > 0);
    const eggCount = getEggCount();
    const totalCount = equipList.length + matEntries.length + consEntries.length + eggCount;

    // 顶部工具条：搜索 + 筛选（部位/稀有度/底材T/词缀T/词缀类型，仅装备 tab 生效）
    const toolbar = document.createElement('div');
    toolbar.className = 'bag-toolbar';
    const searchInput = document.createElement('input');
    searchInput.className = 'bag-search';
    searchInput.placeholder = '🔍 搜索名称…';
    searchInput.value = bagSearch;
    searchInput.oninput = () => { bagSearch = searchInput.value.trim().toLowerCase(); renderBag(); };
    toolbar.appendChild(searchInput);
    const mkSel = (label, options, cur, onSet) => {
      const s = document.createElement('select');
      s.className = 'bag-filter-sel';
      s.setAttribute('aria-label', label);
      s.innerHTML = options.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
      s.onchange = () => onSet(s.value);
      return s;
    };
    toolbar.appendChild(mkSel('稀有度', [
      ['all', '品质：全部'], ['gold', '品质：金'], ['blue', '品质：蓝'], ['white', '品质：白']
    ], bagRarity, v => { bagRarity = v; renderBag(); }));
    toolbar.appendChild(mkSel('部位', [
      ['all', '部位：全部'], ...EQUIP_SLOTS.map(s => [s, `部位：${s}`])
    ], bagSlot, v => { bagSlot = v; renderBag(); }));
    toolbar.appendChild(mkSel('底材T阶', [
      ['all', '底材T：全部'], ...BAG_TIERS.map(t => [String(t), `底材 T${t}`])
    ], bagBaseTier, v => { bagBaseTier = v; renderBag(); }));
    toolbar.appendChild(mkSel('词缀T阶', [
      ['all', '词缀T：全部'], ...BAG_TIERS.map(t => [String(t), `含 T${t} 词缀`])
    ], bagAffixTier, v => { bagAffixTier = v; renderBag(); }));
    // 词缀类型 typeahead：打关键字联想词缀池
    const affixTypeSel = mkSel('词缀类型', [
      ['all', '词缀：全部'],
      ...(window.Equipment.AFFIX_POOL || []).map(a => [a.type, `含「${a.label}」`])
    ], bagAffixType, v => { bagAffixType = v; renderBag(); });
    toolbar.appendChild(affixTypeSel);
    root.appendChild(toolbar);

    const tabs = document.createElement('div');
    tabs.className = 'bag-tabs';
    const sections = [
      ['equip', `装备 (${equipList.length})`],
      ['mat', `素材 (${matEntries.length})`],
      ['cons', `消耗品 (${consEntries.length})`],
      ['egg', `宠物蛋 (${eggCount})`]
    ];
    const views = {};
    const lastKey = renderBag._lastKey || 'equip';
    const setActive = key => {
      renderBag._lastKey = key;
      Object.entries(views).forEach(([k, el]) => el.style.display = k === key ? 'block' : 'none');
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b._bagKey === key));
    };
    sections.forEach(([key, label], idx) => {
      const b = document.createElement('button');
      b.className = 'f-chip' + (idx === 0 ? ' active' : '');
      b._bagKey = key;
      b.textContent = label;
      b.onclick = () => setActive(key);
      tabs.appendChild(b);
    });
    root.appendChild(tabs);

    const summary = document.createElement('div');
    summary.className = 'bag-summary';
    summary.innerHTML = `
      <div class="bag-summary-card"><b>${totalCount}</b><span>总物品</span></div>
      <div class="bag-summary-card"><b>${equipList.length}</b><span>装备</span></div>
      <div class="bag-summary-card"><b>${matEntries.length}</b><span>素材</span></div>
      <div class="bag-summary-card"><b>${consEntries.length}</b><span>消耗品</span></div>
      <div class="bag-summary-card"><b>${eggCount}</b><span>宠物蛋</span></div>`;
    root.appendChild(summary);

    const mkPanel = (key, title, hint) => {
      const p = document.createElement('div');
      p.className = 'bag-panel';
      p.innerHTML = `<div class="bag-head"><span>${title}</span><span class="hint">${hint}</span></div>`;
      const body = document.createElement('div');
      body.className = 'bag-body';
      p.appendChild(body);
      views[key] = body;
      return p;
    };

    root.appendChild(mkPanel('equip', '装备', '查看详情 · 穿上'));
    root.appendChild(mkPanel('mat', '素材', '只看数量与名称'));
    root.appendChild(mkPanel('cons', '消耗品', '只看数量与名称'));
    root.appendChild(mkPanel('egg', '宠物蛋', '可孵化'));

    // 装备分类（支持搜索 + 品质筛选 + 排序 + 悬停 tooltip）
    const equipBody = views.equip;
    const eqGrid = document.createElement('div');
    eqGrid.className = 'bag-grid';
    const pet = getActivePet();
    // 搜索 + 品质 + 部位 + 底材T + 词缀T + 词缀类型过滤
    const highestAffixTier = eq => {
      let best = Infinity;
      for (const aff of flattenAffixes(eq.affixes)) best = Math.min(best, aff.tier || 5);
      return best === Infinity ? 5 : best;
    };
    const hasAffixType = (eq, type) => flattenAffixes(eq.affixes).some(a => a.type === type);
    let eqList = equipList.filter(eq => {
      if (bagSearch && !eq.name.toLowerCase().includes(bagSearch)) return false;
      if (bagRarity !== 'all' && (!eq.rarity || eq.rarity.id !== bagRarity)) return false;
      if (bagSlot !== 'all' && eq.slot !== bagSlot) return false;
      if (bagBaseTier !== 'all' && Number(eq.materialTier) !== Number(bagBaseTier)) return false;
      if (bagAffixTier !== 'all' && highestAffixTier(eq) > Number(bagAffixTier)) return false;
      if (bagAffixType !== 'all' && !hasAffixType(eq, bagAffixType)) return false;
      return true;
    });
    // 按品质排序：金 → 蓝 → 白；同品质按底材T阶（T1最优先）
    eqList = eqList.slice().sort((a, b) => {
      const r = (RARITY_ORDER[a.rarity && a.rarity.id || 'white'] - RARITY_ORDER[b.rarity && b.rarity.id || 'white']);
      if (r !== 0) return r;
      return (Number(a.materialTier) || 3) - (Number(b.materialTier) || 3);
    });
    for (const eq of eqList) {
      const card = document.createElement('div');
      card.className = 'bag-card bag-equip q-' + (eq.rarity && eq.rarity.id || 'white');
      card.innerHTML = `
        <div class="bag-icon" style="color:${rarityOf(eq).color}">${eq.fresh ? '🆕' : '🛡'}</div>
        <div class="bag-name" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}</div>
        <div class="bag-meta">${rarityOf(eq).label}装 · ${eq.slot}</div>
        <div class="bag-qty">×1</div>`;
      const actions = document.createElement('div');
      actions.className = 'bag-actions';
      const wear = document.createElement('button');
      wear.className = 'btn-sm alt';
      wear.textContent = '穿上';
      wear.onclick = e => {
        e.stopPropagation();
        const res = equipItem(pet, eq.id);
        if (res) { addLog(`⚔️ ${pet.name} 装备了 ${res.equipped.name}`); UI.renderAll(); }
      };
      actions.appendChild(wear);
      card.appendChild(actions);
      // 悬停 tooltip：完整属性面板
      const affixHtml = (eq.affixes && eq.affixes.length)
        ? `<div class="bt-affix">${eq.affixes.map(a => escapeHtml(Equipment.formatAffix ? Equipment.formatAffix(a) : `${a.label} +${a.value}%`)).join(' · ')}</div>` : '';
      bindTip(card, `<div class="bt-name" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}</div>
        <div class="bt-line">${rarityOf(eq).label}装 · T${eq.tier} · 槽位 ${eq.slot}</div>
        <div class="bt-line">${describeItem(eq)}</div>${affixHtml}
        <div class="bt-line hint">悬停查看 · 点「穿上」装备到出战宠物</div>`);
      eqGrid.appendChild(card);
    }
    if (!eqList.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = equipList.length ? '没有符合条件的装备' : '没有装备，去战斗页刷掉落吧';
      eqGrid.appendChild(empty);
    }
    equipBody.appendChild(eqGrid);

    // 素材分类（支持搜索 + tooltip）
    const matBody = views.mat;
    const matGrid = document.createElement('div');
    matGrid.className = 'bag-grid';
    const matList = matEntries.filter(m => !bagSearch || m.name.toLowerCase().includes(bagSearch));
    if (matList.length) {
      for (const m of matList) {
        const card = document.createElement('div');
        card.className = 'bag-card bag-mat';
        card.innerHTML = `
          <div class="bag-icon">🧪</div>
          <div class="bag-name">${escapeHtml(m.name)}</div>
          <div class="bag-meta">素材</div>
          <div class="bag-qty">×${m.qty}</div>`;
        bindTip(card, `<div class="bt-name">${escapeHtml(m.name)}</div>
          <div class="bt-line">素材 ×${m.qty}</div>
          <div class="bt-line hint">用于合成/涅槃/进化/打造等消耗</div>`);
        matGrid.appendChild(card);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = matEntries.length ? '没有符合条件的素材' : '暂无素材';
      matGrid.appendChild(empty);
    }
    matBody.appendChild(matGrid);

    // 消耗品分类（支持搜索 + tooltip）
    const consBody = views.cons;
    const consGrid = document.createElement('div');
    consGrid.className = 'bag-grid';
    const consList = consEntries.filter(c => !bagSearch || c.name.toLowerCase().includes(bagSearch));
    if (consList.length) {
      for (const c of consList) {
        const card = document.createElement('div');
        card.className = 'bag-card bag-cons';
        card.innerHTML = `
          <div class="bag-icon">${c.icon}</div>
          <div class="bag-name">${escapeHtml(c.name)}</div>
          <div class="bag-meta">${c.desc}</div>
          <div class="bag-qty">×${c.qty}</div>`;
        bindTip(card, `<div class="bt-name">${c.icon} ${escapeHtml(c.name)}</div>
          <div class="bt-line">${c.desc}</div>
          <div class="bt-line hint">×${c.qty} · 用于装备改造</div>`);
        consGrid.appendChild(card);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = consEntries.length ? '没有符合条件的消耗品' : '暂无消耗品';
      consGrid.appendChild(empty);
    }
    consBody.appendChild(consGrid);

    // 宠物蛋分类
    const eggBody = views.egg;
    const eggWrap = document.createElement('div');
    eggWrap.className = 'bag-egg-wrap';
    const eggInfo = document.createElement('div');
    eggInfo.className = 'bag-egg-info';
    eggInfo.innerHTML = eggCount > 0
      ? `<div class="bag-icon">🥚</div><div class="bag-name">宠物蛋</div><div class="bag-qty">×${eggCount}</div>`
      : `<div class="bag-icon">🥚</div><div class="bag-name">暂无宠物蛋</div><div class="bag-qty">×0</div>`;
    bindTip(eggInfo, `<div class="bt-name">🥚 宠物蛋 ×${eggCount}</div>
      <div class="bt-line">挂机打基础怪掉落，不同品种孵出不同宠物</div>
      <div class="bt-line hint">到「宠物 → 宠物蛋」页按品种孵化，也可在市场交易</div>`);
    eggWrap.appendChild(eggInfo);
    const eggBtn = document.createElement('button');
    eggBtn.className = 'btn-mini alt';
    eggBtn.textContent = UI.isLoggedIn() ? '孵化' : '🔒 登录后孵化';
    eggBtn.disabled = !UI.isLoggedIn() || eggCount <= 0;
    eggBtn.onclick = async () => {
      const res = await hatchEgg();
      if (!res) return;
      if (res.error) { showToast('❌ 无法孵化', res.error); return; }
      showToast('🐣 孵化成功！', `${res.baby.icon} ${res.baby.name}`);
      UI.renderAll();
    };
    eggWrap.appendChild(eggBtn);
    eggBody.appendChild(eggWrap);

    setActive(lastKey);
  }

  UI.renderBag = renderBag;
})();
