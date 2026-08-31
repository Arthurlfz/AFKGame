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
  const { getInventory, equipItem, describeItem, rarityOf, flattenAffixes, scoreOf } = window.Equipment;
  const { getEggCount, getEggs, hatchEgg } = window.Drop;
  const { getActivePet } = window.Pet;
  const Materials = window.Materials;
  const Craft = window.Craft || {};
  const Salvage = window.Salvage || {};
  // 未鉴定装备封印图标（纯 SVG 卷轴 + 问号），流放「???」封印感
  const SVG_SEALED = `<svg viewBox="0 0 48 56"><rect x="13" y="8" width="22" height="40" rx="2" fill="#26211a" stroke="#7a6a4a"/><rect x="9" y="5" width="30" height="6" rx="3" fill="#6b5a3a"/><rect x="9" y="45" width="30" height="6" rx="3" fill="#6b5a3a"/><text x="24" y="38" text-anchor="middle" font-size="22" font-family="Georgia,serif" fill="#c8a45b">?</text></svg>`;
  // 鉴定卷轴（拿在手上解封）：亮金卷轴 + 眼睛，区别于未鉴定封印卷轴
  const SVG_IDSTONE = `<svg viewBox="0 0 48 56"><rect x="13" y="8" width="22" height="40" rx="2" fill="#3a2f1c" stroke="#d9b25a"/><rect x="9" y="5" width="30" height="6" rx="3" fill="#caa64e"/><rect x="9" y="45" width="30" height="6" rx="3" fill="#caa64e"/><circle cx="24" cy="30" r="8" fill="none" stroke="#e7d39a" stroke-width="2"/><circle cx="24" cy="30" r="3" fill="#e7d39a"/></svg>`;
  // 素材名 → emoji 图标（按关键词粗分，流放格子里用）
  const matIcon = name => {
    if (/石|丹|核/.test(name)) return '💎';
    if (/兽|魂|晶|珠/.test(name)) return '🔮';
    return '🧪';
  };

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
  let identifyMode = false;  // 手持鉴定模式：开启后点未鉴定装备即连续鉴定

  // 通用格子 tooltip 浮层（悬停显示完整信息，body 层 fixed 不被裁）
  function showBagTip(card, html) {
    const tip = $('bag-tooltip');
    if (!tip) return;
    tip.innerHTML = html;
    const r = card.getBoundingClientRect();
    // 容器同时挂 .equip-tip 以复用打造页 tooltip 样式，但位置用 fixed 跟随格子
    tip.style.position = 'fixed';
    tip.style.left = (r.right + 10) + 'px';
    tip.style.top = Math.max(6, r.top) + 'px';
    tip.style.bottom = 'auto';
    tip.style.transform = 'none';
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
  // 装备 tooltip：复用打造页 .equip-tip 结构（前后缀分组 + T阶角标）
  function equipTipHtml(eq, unid) {
    const r = rarityOf(eq);
    if (unid) {
      return `<div class="tip-name">${escapeHtml(eq.name)}</div>
        <div class="tip-line"><span>未鉴定的 ${eq.slot}</span><b>T${eq.tier}</b></div>
        <div class="tip-line hint">开启手持鉴定后点此揭晓属性</div>`;
    }
    const aff = (eq.affixes && { prefix: eq.affixes.prefix || [], suffix: eq.affixes.suffix || [] }) || { prefix: [], suffix: [] };
    const line = (list, cls) => list.length
      ? list.map(a => window.Equipment.formatAffixHtml ? window.Equipment.formatAffixHtml(a, cls) : `<div class="${cls}">${escapeHtml(a.label)} +${a.value}%<span class="tip-tier">T${a.tier || 1}</span></div>`).join('')
      : '<div class="tip-empty">无</div>';
    return `<div class="tip-name" style="color:${r.color}">${escapeHtml(eq.name)}</div>
      <div class="tip-line"><span>${describeItem(eq)}</span><b>${scoreOf(eq)}</b></div>
      <div class="tip-section">词缀</div>
      ${line(aff.prefix, 'tip-prefix')}
      <hr class="tip-divider">
      ${line(aff.suffix, 'tip-suffix')}
      <div class="tip-line hint" style="border-bottom:none;margin-top:4px">Ctrl/Alt+点击 分解 · 点开看词缀</div>`;
  }

  function renderBag() {
    const root = $('bag-root');
    if (!root) return;
    root.innerHTML = '';

    const equipList = getInventory();
    const localMats = Materials.getLocal ? Materials.getLocal() : {};
    const matEntries = Object.entries(localMats).sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([name]) => !CONSUMABLES.some(c => c.name === name))
      .map(([name, qty]) => ({ name, qty }));
    const consEntries = CONSUMABLES.map(c => ({ ...c, qty: Materials.getQuantity(c.name) })).filter(x => x.qty > 0);
    const eggCount = getEggCount();
    const totalCount = equipList.length + matEntries.length + consEntries.length + eggCount;

    // 三连屏（参考宠物资料页「属性|装备栏|换装背包」）：左=筛选/统计/鉴定石 | 中=装备流放格子 | 右=素材/消耗品/蛋
    const wrap = document.createElement('div');
    wrap.className = 'bag-wrap bag-wrap--tri';
    root.appendChild(wrap);
    const mkCol = () => {
      const c = document.createElement('div');
      c.className = 'pcol';
      wrap.appendChild(c);
      return c;
    };
    // panel 外壳（与宠物资料页同款：.panel + .panel-title）
    const mkPanel = (col, title, hint) => {
      const p = document.createElement('div');
      p.className = 'panel';
      p.innerHTML = `<div class="panel-title">${title}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
      const body = document.createElement('div');
      body.className = 'bag-panel-body';
      p.appendChild(body);
      col.appendChild(p);
      return body;
    };
    const colFilter = mkCol();
    const colEquip = mkCol();
    const colMat = mkCol();

    // 左列：筛选
    const filterBody = mkPanel(colFilter, '筛选', '按名称 / 属性过滤');
    const toolbar = document.createElement('div');
    toolbar.className = 'bag-toolbar';
    const searchInput = document.createElement('input');
    searchInput.className = 'bag-search';
    searchInput.placeholder = '搜索名称…';
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
    // 词缀类型：打关键字联想词缀池
    toolbar.appendChild(mkSel('词缀类型', [
      ['all', '词缀：全部'],
      ...(window.Equipment.AFFIX_POOL || []).map(a => [a.type, `含「${a.label}」`])
    ], bagAffixType, v => { bagAffixType = v; renderBag(); }));
    filterBody.appendChild(toolbar);

    // 左列：统计
    const statBody = mkPanel(colFilter, '统计', '');
    const summary = document.createElement('div');
    summary.className = 'bag-summary';
    summary.innerHTML = `
      <span class="bag-stat">总物品 <b>${totalCount}</b></span>
      <span class="bag-stat">装备 <b>${equipList.length}</b></span>
      <span class="bag-stat">素材 <b>${matEntries.length}</b></span>
      <span class="bag-stat">消耗品 <b>${consEntries.length}</b></span>
      <span class="bag-stat">宠物蛋 <b>${eggCount}</b></span>`;
    statBody.appendChild(summary);

    // 中列：装备流放格子（主区）
    const equipBody = mkPanel(colEquip, '装备', '点开看词缀 · Ctrl/Alt+点击分解');
    const grid = document.createElement('div');
    grid.className = 'bag-grid poe-grid';
    equipBody.appendChild(grid);

    // 右列：素材 / 消耗品 / 宠物蛋，各自独立小网格
    const matBody = mkPanel(colMat, '素材', '合成/涅槃/进化/打造');
    const matGrid = document.createElement('div');
    matGrid.className = 'bag-grid poe-grid';
    matBody.appendChild(matGrid);
    const consBody = mkPanel(colMat, '消耗品', '装备改造');
    const consGrid = document.createElement('div');
    consGrid.className = 'bag-grid poe-grid';
    consBody.appendChild(consGrid);
    const eggBody = mkPanel(colMat, '宠物蛋', '点击孵化');
    const eggGrid = document.createElement('div');
    eggGrid.className = 'bag-grid poe-grid';
    eggBody.appendChild(eggGrid);

    // 装备（搜索 + 品质筛选 + 评分降序 + 悬停 tooltip），统一进大网格
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
    // 按评分降序。评分已把「稀有度 / 图档 / 底材T / 词缀类型×T阶×数值」全算进去，
    // 比原来的「品质 → 底材T」两级排序更贴近真实强弱，玩家也更好懂：分高的在前面。
    eqList = eqList.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    // 装备图标按部位映射（流放格子卡用 emoji 表示装备类型）
    const EQUIP_ICON = { 武器:'🗡', 单手剑:'🗡', 双手剑:'⚔️', 长剑:'🗡', 弓:'🏹', 法杖:'🪄', 杖:'🪄', 盾:'🛡', 胸甲:'🦺', 头盔:'⛑️', 帽:'⛑️', 手套:'🧤', 靴:'🥾', 鞋:'🥾', 戒指:'💍', 项链:'📿', 护符:'📿', 腰带:'🔗' };
    for (const eq of eqList) {
      const unid = eq.identified === false;
      const rar = (eq.rarity && eq.rarity.id) || 'white';
      const card = document.createElement('div');
      card.className = 'poe-item q-' + rar + (unid ? ' q-unid' : '') + (identifyMode && unid ? ' bc-idtarget' : '');
      card.draggable = true;
      // 拖拽鉴定：未鉴定装备卡作为 drop 目标，接收从顶部拖来的鉴定石
      if (unid) {
        card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('bc-drop'); });
        card.addEventListener('dragleave', () => card.classList.remove('bc-drop'));
        card.addEventListener('drop', e => {
          e.preventDefault(); card.classList.remove('bc-drop');
          if (e.dataTransfer.getData('text/plain') === 'identify') identifyEquip(eq, card);
        });
      }
      // 拖到分解台：携带装备 id，drop 区据此调用 Salvage
      card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: eq.id, act: 'salvage' })); e.dataTransfer.effectAllowed = 'move'; });
      const ico = unid ? SVG_SEALED : `<span class="emoji">${EQUIP_ICON[eq.slot] || '🛡'}</span>`;
      card.innerHTML = `
        <div class="ico">${ico}</div>
        <div class="nm">${escapeHtml(eq.name)}</div>
        ${unid ? '' : `<div class="corner">${scoreOf(eq)}</div>`}
        ${unid ? '<div class="qmark">?</div>' : ''}
        <div class="unseal-sweep"></div>`;
      // 手持鉴定：开启鉴定模式时点未鉴定装备即鉴定；Ctrl/Alt 点击=快分解；否则看词缀详情
      card.onclick = e => {
        if (identifyMode && unid) { identifyEquip(eq, card); return; }
        if (e.ctrlKey || e.altKey) { quickSalvage(eq); return; }
        showEquipDetail(eq);
      };
      // 悬停 tooltip：复用打造页 .equip-tip 结构（tip-name/line/section/prefix/suffix/tier）
      bindTip(card, equipTipHtml(eq, unid));
      grid.appendChild(card);
    }
    // 拖拽源 + 手持鉴定开关：点「鉴定石」进入鉴定模式（拿在手上连续鉴定），再点退出
    // 拖到「装备」视图里的未鉴定装备卡上同样可鉴定（流放味）；点装备卡的「鉴定」按钮也可
    const haveStoneN = Materials.getQuantity('鉴定石');
    if (haveStoneN > 0) {
      const src = document.createElement('div');
      src.className = 'bag-idstone' + (identifyMode ? ' active' : '');
      // 用户要求：只显示「鉴定石 ×N」，开关状态靠 .active 明暗表示
      src.innerHTML = `<span class="bs-ico">${SVG_IDSTONE}</span> 鉴定石 ×${haveStoneN}`;
      src.draggable = true;
      src.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'identify'); e.dataTransfer.effectAllowed = 'move'; });
      src.addEventListener('click', () => {
        identifyMode = !identifyMode;
        renderBag();
        showToast(identifyMode ? '🔍 鉴定模式开启' : '已退出鉴定模式', identifyMode ? '点未鉴定装备即可鉴定' : '');
      });
      statBody.appendChild(src); // 鉴定石开关放左列统计面板
    }

    // 回收区（分解台）：拖装备到此碎裂，等价于流放「拖到商店卖出 / 分解」
    const drop = document.createElement('div');
    drop.className = 'salvage-drop';
    drop.innerHTML = `<div class="sd-title">分解台 · 碎裂回收</div>
      <div class="sd-sub">拖装备到这里碎裂得材料（白装无产出）· 或 Ctrl/Alt+Enter 批量分解</div>`;
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('hot'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('hot');
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data && data.act === 'salvage') {
        const eq = getInventory().find(x => x.id === data.id);
        if (eq) quickSalvage(eq);
      }
    });
    equipBody.appendChild(drop); // 分解台放中列装备区下方

    // 素材（字母序，仅按名搜索；不受品质/部位等装备筛选影响）
    const matList = matEntries.filter(m => !bagSearch || m.name.toLowerCase().includes(bagSearch));
    for (const m of matList) {
      const card = document.createElement('div');
      card.className = 'poe-item q-mat';
      card.innerHTML = `
        <div class="ico">${matIcon(m.name)}</div>
        <div class="nm">${escapeHtml(m.name)}</div>
        <div class="corner">×${m.qty}</div>`;
      bindTip(card, `<div class="tip-name">${matIcon(m.name)} ${escapeHtml(m.name)}</div>
        <div class="tip-line"><span>素材</span><b>×${m.qty}</b></div>
        <div class="tip-line hint">用于合成/涅槃/进化/打造等消耗</div>`);
      matGrid.appendChild(card);
    }
    if (!matList.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = matEntries.length ? '没有符合条件的素材' : '暂无素材';
      matGrid.appendChild(empty);
    }

    // 消耗品（原序，仅按名搜索）
    const consList = consEntries.filter(c => !bagSearch || c.name.toLowerCase().includes(bagSearch));
    for (const c of consList) {
      const card = document.createElement('div');
      card.className = 'poe-item q-cons';
      card.innerHTML = `
        <div class="ico">${c.icon}</div>
        <div class="nm">${escapeHtml(c.name)}</div>
        <div class="corner">×${c.qty}</div>`;
      bindTip(card, `<div class="tip-name">${c.icon} ${escapeHtml(c.name)}</div>
        <div class="tip-line"><span>${c.desc}</span><b>×${c.qty}</b></div>
        <div class="tip-line hint">用于装备改造</div>`);
      consGrid.appendChild(card);
    }
    if (!consList.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = consEntries.length ? '没有符合条件的消耗品' : '暂无消耗品';
      consGrid.appendChild(empty);
    }

    // 宠物蛋（按品种，仅按名搜索；点击弹孵化）
    const eggEntries = Object.entries(getEggs()).filter(([, c]) => c > 0)
      .filter(([baseName]) => !bagSearch || baseName.toLowerCase().includes(bagSearch));
    for (const [baseName, count] of eggEntries) {
      const eggName = window.Drop.makeEggName ? window.Drop.makeEggName(baseName) : baseName + '蛋';
      const card = document.createElement('div');
      card.className = 'poe-item q-egg';
      card.innerHTML = `
        <div class="ico">🥚</div>
        <div class="nm">${escapeHtml(eggName)}</div>
        <div class="corner">×${count}</div>`;
      bindTip(card, `<div class="tip-name">🥚 ${escapeHtml(eggName)}</div>
        <div class="tip-line"><span>宠物蛋</span><b>×${count}</b></div>
        <div class="tip-line hint">点击查看 / 孵化 ${escapeHtml(baseName)}，也可在市场交易</div>`);
      card.onclick = () => showEggDetail(baseName, count, eggName);
      eggGrid.appendChild(card);
      }
      if (!eggEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '暂无宠物蛋，去战斗页刷基础怪掉落吧';
      eggGrid.appendChild(empty);
      }

      // 装备区空状态
      if (!eqList.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = equipList.length ? '没有符合条件的装备' : '没有装备，去战斗页刷掉落吧';
      grid.appendChild(empty);
      }
  }

  // 鉴定：消耗 1 鉴定石 → 揭晓未鉴定装备属性（扫光演出后重渲染）
  async function identifyEquip(eq, card) {
    const have = window.Materials && window.Materials.getQuantity ? window.Materials.getQuantity('鉴定石') : 0;
    if (!have || have <= 0) { addLog('没有鉴定石，无法鉴定（去挂机捡鉴定石）'); return; }
    const r = await window.Materials.spend('鉴定石', 1);
    if (!r || !r.ok) { addLog('鉴定失败：' + ((r && r.error) || '鉴定石不足')); return; }
    eq.identified = true;
    const s = document.createElement('div'); s.className = 'bc-scan'; card.appendChild(s);
    setTimeout(() => {
      renderBag();
      showEquipDetail(eq); // 鉴定完成弹出词缀详情（与装备打造同款 .craft-affix-group 样式）
      showToast('✨ 鉴定完成', eq.name);
    }, 600);
  }

  // 装备详情面板：词缀区复用装备打造页的 .craft-affix-group（前缀绿/后缀蓝，同款样式）
  function showEquipDetail(eq) {
    let modal = $('equip-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'equip-detail-modal';
      modal.className = 'equip-detail-modal';
      document.body.appendChild(modal);
    }
    const pfx = (eq.affixes && eq.affixes.prefix) || [];
    const sfx = (eq.affixes && eq.affixes.suffix) || [];
    const affix = (arr, cls) => arr.length
      ? arr.map(a => `<div class="grp-line ${cls}">${Craft.affixText ? Craft.affixText(a) : (Equipment.formatAffix ? Equipment.formatAffix(a) : a.label + '+' + a.value + '%')}</div>`).join('')
      : '<span class="hint">无</span>';
    modal.innerHTML = `
      <div class="ed-overlay" data-close="1"></div>
      <div class="ed-card" style="border-color:${rarityOf(eq).color}">
        <div class="ed-head" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}
          <span class="ed-sub">${rarityOf(eq).label}装 · T${eq.tier} · ${eq.slot}</span></div>
        <div class="ed-base">${describeItem(eq)}</div>
        <div class="craft-affix-group">
          <div class="grp-title">前缀（${pfx.length}/3）</div>
          ${affix(pfx, 'prefix')}
          <hr class="craft-affix-divider">
          <div class="grp-title">后缀（${sfx.length}/3）</div>
          ${affix(sfx, 'suffix')}
        </div>
        <div class="craft-affixcount">前缀 ${pfx.length}/3 · 后缀 ${sfx.length}/3</div>
        <div class="ed-actions">
          <button class="btn-mini alt" data-wear="1">穿上</button>
          <button class="btn-mini" data-lock="1">${eq.locked ? '🔓 解锁' : '🔒 锁定'}</button>
          <button class="btn-mini" data-close="1">关闭</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeEquipDetail);
    const wear = modal.querySelector('[data-wear]');
    if (wear) wear.onclick = () => {
      const pet = getActivePet();
      const res = equipItem(pet, eq.id);
      if (res) { addLog(`⚔️ ${pet.name} 装备了 ${res.equipped.name}`); UI.renderAll(); }
      closeEquipDetail();
    };
    const lockBtn = modal.querySelector('[data-lock]');
    if (lockBtn) lockBtn.onclick = async () => {
      await Salvage.toggleLock(eq);
      closeEquipDetail();
      UI.renderAll();
    };
    modal.classList.add('open');
  }
  function closeEquipDetail() {
    const m = $('equip-detail-modal'); if (m) m.classList.remove('open');
  }
  // 宠物蛋详情/孵化弹窗（复用装备详情 modal 样式）
  function closeEggDetail() {
    const m = $('egg-detail-modal'); if (m) m.classList.remove('open');
  }
  function showEggDetail(baseName, count, eggName) {
    let modal = $('egg-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'egg-detail-modal';
      modal.className = 'equip-detail-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="ed-overlay" data-close="1"></div>
      <div class="ed-card" style="border-color:var(--accent)">
        <div class="ed-head" style="color:var(--accent-hi)">🥚 ${escapeHtml(eggName)} <span class="ed-sub">×${count}</span></div>
        <div class="ed-base">挂机打基础怪掉落，孵出对应宠物；也可在市场交易</div>
        <div class="ed-actions">
          <button class="btn-mini alt" data-hatch="1">孵化</button>
          <button class="btn-mini" data-close="1">关闭</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeEggDetail);
    const hatchBtn = modal.querySelector('[data-hatch]');
    if (hatchBtn) {
      hatchBtn.disabled = !UI.isLoggedIn();
      hatchBtn.textContent = UI.isLoggedIn() ? '孵化' : '🔒 登录后孵化';
      hatchBtn.onclick = async () => {
        const res = await hatchEgg(baseName);
        if (!res) return;
        if (res.error) { showToast('❌ 无法孵化', res.error); return; }
        showToast('🐣 孵化成功！', `${res.baby.icon} ${res.baby.name}`);
        closeEggDetail();
        UI.renderAll();
      };
    }
    modal.classList.add('open');
  }
  // 拖到分解台 / Ctrl+Alt 点击：单件快分解（复用 Salvage，自动跳过锁定/在售）
  async function quickSalvage(eq) {
    if (!Salvage.isSalvageable(eq)) { showToast('不能分解', eq.locked ? '已锁定（详情里解锁）' : '装备在售中'); return; }
    const res = await Salvage.salvageList([eq]);
    if (res.error) { showToast('❌ 分解失败', res.error); return; }
    const parts = Object.entries(res.gains || {}).map(([k, n]) => `${Config.craft[k]?.name || k} ×${n}`);
    addLog(`🗑 分解：${eq.name}` + (parts.length ? '，得 ' + parts.join('、') : ''));
    showToast('🗑 分解完成', parts.join('<br>') || '白装无材料产出');
    UI.renderAll();
  }
  // 批量分解：当前背包全部可分解装备（Ctrl+Alt+Enter 或装备页「批量分解」）
  async function bulkSalvage() {
    const all = getInventory().filter(eq => Salvage.isSalvageable(eq));
    if (!all.length) { showToast('没有可分解装备', '好装备 / 锁定 / 在售都会保留'); return; }
    const res = await Salvage.salvageList(all);
    if (res.error) { showToast('❌ 分解失败', res.error); return; }
    const parts = Object.entries(res.gains || {}).map(([k, n]) => `${Config.craft[k]?.name || k} ×${n}`);
    addLog(`🗑 批量分解 ${res.count} 件` + (parts.length ? '，得 ' + parts.join('、') : ''));
    showToast('🗑 批量分解完成', `分解 ${res.count} 件<br>` + (parts.join('<br>') || '白装无材料产出'));
    UI.renderAll();
  }
  // 批量快捷键：Ctrl/Alt + Enter = 分解全部可分解装备
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.altKey) && e.key === 'Enter') { e.preventDefault(); bulkSalvage(); }
  });

  UI.renderBag = renderBag;
  UI.showEquipDetail = showEquipDetail;
})();
