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
  let bagCat = 'all';
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
      ${eq.soulAffix ? '<div class="tip-section">魂铸</div><div class="tip-soul" style="color:#c9a86a">' + (eq.soulAffix.label || '') + (eq.soulAffix.tier ? ' T' + eq.soulAffix.tier : '') + (eq.soulAffix.value != null ? ' +' + eq.soulAffix.value + (['hit','dodge','spd'].includes(eq.soulAffix.type) ? '' : '%') : '') + '</div>' : ''}
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
    const eggEntries = Object.entries(getEggs()).filter(([, c]) => c > 0);
    const totalCount = equipList.length + matEntries.length + consEntries.length + eggCount;

    // 当前分类 tab（全部/装备/素材/消耗品/宠物蛋）
    if (typeof bagCat === 'undefined') bagCat = 'all';

    // ===== 主布局：左侧（筛选+网格+底部） + 右侧详情面板 =====
    const layout = document.createElement('div');
    layout.className = 'bag-main-layout';
    root.appendChild(layout);

    // --- 左侧 ---
    const left = document.createElement('div');
    left.className = 'bag-main-left';
    layout.appendChild(left);

    // 顶部筛选栏：分类 tab + 搜索
    const filterBar = document.createElement('div');
    filterBar.className = 'bag-filter-bar';
    const catTabs = document.createElement('div');
    catTabs.className = 'bag-cat-tabs';
    const cats = [
      ['all', '全部'], ['equip', '装备'], ['material', '素材'],
      ['consume', '消耗品'], ['egg', '宠物蛋']
    ];
    for (const [val, label] of cats) {
      const btn = document.createElement('button');
      btn.className = 'bag-cat' + (bagCat === val ? ' active' : '');
      btn.textContent = label;
      btn.onclick = () => { bagCat = val; renderBag(); };
      catTabs.appendChild(btn);
    }
    filterBar.appendChild(catTabs);
    const searchInput = document.createElement('input');
    searchInput.className = 'bag-search-input';
    searchInput.placeholder = '搜索物品名称…';
    searchInput.value = bagSearch;
    searchInput.oninput = () => { bagSearch = searchInput.value.trim().toLowerCase(); renderBag(); };
    filterBar.appendChild(searchInput);
    left.appendChild(filterBar);

    // 物品网格区域
    const gridArea = document.createElement('div');
    gridArea.className = 'bag-grid-area';
    const grid = document.createElement('div');
    grid.className = 'bag-item-grid';
    gridArea.appendChild(grid);
    left.appendChild(gridArea);

    // 底部：统计 + 鉴定石 + 分解台
    const footer = document.createElement('div');
    footer.className = 'bag-footer';
    footer.innerHTML = '<span>物品：<b>' + totalCount + '</b>（装备' + equipList.length + ' · 素材' + matEntries.length + ' · 消耗' + consEntries.length + ' · 蛋' + eggCount + '）</span>';
    left.appendChild(footer);

    // 鉴定石开关
    const haveStoneN = Materials.getQuantity('鉴定石');
    if (haveStoneN > 0) {
      const src = document.createElement('div');
      src.className = 'bag-idstone' + (identifyMode ? ' active' : '');
      src.innerHTML = '<span class="bs-ico">' + SVG_IDSTONE + '</span> 鉴定石 ×' + haveStoneN;
      src.draggable = true;
      src.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'identify'); e.dataTransfer.effectAllowed = 'move'; });
      src.addEventListener('click', () => {
        identifyMode = !identifyMode;
        renderBag();
        showToast(identifyMode ? '🔍 鉴定模式开启' : '已退出鉴定模式', identifyMode ? '点未鉴定装备即可鉴定' : '');
      });
      footer.appendChild(src);
    }

    // --- 右侧详情面板 ---
    const detail = document.createElement('div');
    detail.className = 'bag-detail-panel';
    detail.id = 'bag-detail-panel';
    detail.innerHTML = '<div class="bag-detail-empty">选择物品<br>查看详情</div>';
    layout.appendChild(detail);

    // 显示详情到右侧面板
    function showDetail(html) {
      detail.innerHTML = html;
    }

    // ===== 渲染物品卡片（统一进一个网格，按分类过滤） =====
    const EQUIP_ICON = { 武器:'🗡', 单手剑:'🗡', 双手剑:'⚔️', 长剑:'🗡', 弓:'🏹', 法杖:'🪄', 杖:'🪄', 盾:'🛡', 胸甲:'🦺', 头盔:'⛑️', 帽:'⛑️', 手套:'🧤', 靴:'🥾', 鞋:'🥾', 戒指:'💍', 项链:'📿', 护符:'📿', 腰带:'🔗' };
    const highestAffixTier = eq => {
      let best = Infinity;
      for (const aff of flattenAffixes(eq.affixes)) best = Math.min(best, aff.tier || 5);
      return best === Infinity ? 5 : best;
    };
    const hasAffixType = (eq, type) => flattenAffixes(eq.affixes).some(a => a.type === type);

    // 装备
    if (bagCat === 'all' || bagCat === 'equip') {
      let eqList = equipList.filter(eq => {
        if (bagSearch && !eq.name.toLowerCase().includes(bagSearch)) return false;
        if (bagRarity !== 'all' && (!eq.rarity || eq.rarity.id !== bagRarity)) return false;
        if (bagSlot !== 'all' && eq.slot !== bagSlot) return false;
        if (bagBaseTier !== 'all' && Number(eq.materialTier) !== Number(bagBaseTier)) return false;
        if (bagAffixTier !== 'all' && highestAffixTier(eq) > Number(bagAffixTier)) return false;
        if (bagAffixType !== 'all' && !hasAffixType(eq, bagAffixType)) return false;
        return true;
      });
      eqList = eqList.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
      for (const eq of eqList) {
        const unid = eq.identified === false;
        const rar = (eq.rarity && eq.rarity.id) || 'white';
        const card = document.createElement('div');
        card.className = 'poe-item q-' + rar + (unid ? ' q-unid' : '') + (identifyMode && unid ? ' bc-idtarget' : '');
        card.draggable = true;
        if (unid) {
          card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('bc-drop'); });
          card.addEventListener('dragleave', () => card.classList.remove('bc-drop'));
          card.addEventListener('drop', e => {
            e.preventDefault(); card.classList.remove('bc-drop');
            if (e.dataTransfer.getData('text/plain') === 'identify') identifyEquip(eq, card);
          });
        }
        card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: eq.id, act: 'salvage' })); e.dataTransfer.effectAllowed = 'move'; });
        const ico = unid ? SVG_SEALED : '<span class="emoji">' + (EQUIP_ICON[eq.slot] || '🛡') + '</span>';
        card.innerHTML = '<div class="ico">' + ico + '</div><div class="nm">' + escapeHtml(eq.name) + '</div>' + (unid ? '' : '<div class="corner">' + scoreOf(eq) + '</div>') + (unid ? '<div class="qmark">?</div>' : '') + '<div class="unseal-sweep"></div>';
        card.onclick = e => {
          if (identifyMode && unid) { identifyEquip(eq, card); return; }
          if (e.ctrlKey || e.altKey) { quickSalvage(eq); return; }
          showDetail(equipTipHtml(eq, unid) + '<div style="margin-top:8px"><button class="btn-mini" onclick="document.querySelectorAll(\'.bag-subtab\').forEach(t=>{if(t.dataset.bagSubtab===\'equip\')t.click()})">去装备页穿上</button></div>');
        };
        bindTip(card, equipTipHtml(eq, unid));
        grid.appendChild(card);
      }
    }

    // 素材
    if (bagCat === 'all' || bagCat === 'material') {
      const matList = matEntries.filter(m => !bagSearch || m.name.toLowerCase().includes(bagSearch));
      for (const m of matList) {
        const card = document.createElement('div');
        card.className = 'poe-item q-mat';
        card.innerHTML = '<div class="ico">' + matIcon(m.name) + '</div><div class="nm">' + escapeHtml(m.name) + '</div><div class="corner">×' + m.qty + '</div>';
        const tip = '<div class="tip-name">' + matIcon(m.name) + ' ' + escapeHtml(m.name) + '</div><div class="tip-line"><span>素材</span><b>×' + m.qty + '</b></div><div class="tip-line hint">用于合成/涅槃/进化/打造等消耗</div>';
        card.onclick = () => showDetail(tip);
        bindTip(card, tip);
        grid.appendChild(card);
      }
    }

    // 消耗品
    if (bagCat === 'all' || bagCat === 'consume') {
      const consList = consEntries.filter(c => !bagSearch || c.name.toLowerCase().includes(bagSearch));
      for (const c of consList) {
        const card = document.createElement('div');
        card.className = 'poe-item q-cons';
        card.innerHTML = '<div class="ico">' + c.icon + '</div><div class="nm">' + escapeHtml(c.name) + '</div><div class="corner">×' + c.qty + '</div>';
        const tip = '<div class="tip-name">' + c.icon + ' ' + escapeHtml(c.name) + '</div><div class="tip-line"><span>' + c.desc + '</span><b>×' + c.qty + '</b></div><div class="tip-line hint">用于装备改造</div>';
        card.onclick = () => showDetail(tip);
        bindTip(card, tip);
        grid.appendChild(card);
      }
    }

    // 宠物蛋
    if (bagCat === 'all' || bagCat === 'egg') {
      const eggList = eggEntries.filter(([baseName]) => !bagSearch || baseName.toLowerCase().includes(bagSearch));
      for (const [baseName, count] of eggList) {
        const eggName = window.Drop.makeEggName ? window.Drop.makeEggName(baseName) : baseName + '蛋';
        const card = document.createElement('div');
        card.className = 'poe-item q-egg';
        card.innerHTML = '<div class="ico">🥚</div><div class="nm">' + escapeHtml(eggName) + '</div><div class="corner">×' + count + '</div>';
        const tip = '<div class="tip-name">🥚 ' + escapeHtml(eggName) + '</div><div class="tip-line"><span>宠物蛋</span><b>×' + count + '</b></div><div class="tip-line hint">点击查看 / 孵化 ' + escapeHtml(baseName) + '，也可在市场交易</div>';
        card.onclick = () => { showDetail(tip); showEggDetail(baseName, count, eggName); };
        bindTip(card, tip);
        grid.appendChild(card);
      }
    }

    // 空状态
    if (!grid.children.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = totalCount ? '没有符合条件的物品' : '背包空空，去挂机捡装备吧';
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


  /* ---------- 背包窗口：打开/关闭/拖动 ---------- */
  function openBagWindow() {
    renderBag();
    // 装备子面板也要刷新（12槽 + 换装背包 + 出战宠物属性）
    if (UI.renderEquipSlots) UI.renderEquipSlots();
    if (UI.renderPetEquipInv) UI.renderPetEquipInv();
    const host = document.getElementById('bag-window');
    if (!host) return;
    host.style.display = 'block';
    requestAnimationFrame(() => host.classList.add('is-open'));
  }
  function closeBagWindow() {
    const host = document.getElementById('bag-window');
    if (!host) return;
    host.classList.remove('is-open');
    window.setTimeout(() => { if (!host.classList.contains('is-open')) host.style.display = 'none'; }, 300);
  }
  function initBagWindow() {
    const cancel = document.getElementById('bag-cancel');
    if (cancel) cancel.onclick = closeBagWindow;
    const scrim = document.getElementById('bag-scrim');
    if (scrim) scrim.onclick = closeBagWindow;
    // 背包窗口拖动
    const bagWin = document.querySelector('.bag-window');
    const bagHeader = document.querySelector('.bag-window-header');
    if (bagWin && bagHeader && UI.makeDraggable) UI.makeDraggable(bagWin, bagHeader);
    // 子tab切换（背包 / 装备）
    const subTabs = document.querySelector('.bag-window-tabs');
    if (subTabs && !subTabs.__bound) {
      subTabs.__bound = true;
      subTabs.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('.bag-subtab');
        if (!btn) return;
        const name = btn.dataset.bagSubtab;
        subTabs.querySelectorAll('.bag-subtab').forEach(t => t.classList.toggle('active', t === btn));
        document.querySelectorAll('.bag-subpane').forEach(p => {
          const match = p.dataset.bagSubpane === name;
          p.classList.toggle('active', match);
          p.style.display = match ? '' : 'none';
        });
        // 切到装备tab时刷新装备面板
        if (name === 'equip') {
          if (UI.renderEquipSlots) UI.renderEquipSlots();
          if (UI.renderPetEquipInv) UI.renderPetEquipInv();
        }
      });
    }
    // 快捷键 B 打开/关闭背包
    document.addEventListener('keydown', e => {
      if (e.key === 'b' || e.key === 'B') {
        const host = document.getElementById('bag-window');
        if (host && host.classList.contains('is-open')) closeBagWindow();
        else openBagWindow();
      }
    });
  }

  UI.openBagWindow = openBagWindow;
  UI.closeBagWindow = closeBagWindow;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initBagWindow);
  }

  UI.renderBag = renderBag;
  UI.showEquipDetail = showEquipDetail;
})();
