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
  // ⚠️ describeItem 必须一起解构：showEquipDetail 里是裸标识符调用（漏了它 = 点装备详情直接 ReferenceError，2026-09-10 浏览器实测）
  const { getInventory, equipItem, rarityOf, flattenAffixes, describeItem } = window.Equipment;
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
    if (/石|丹|核/.test(name)) return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>';
    if (/兽|魂|晶|珠/.test(name)) return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
    return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>';
  };
  // 部位 → emoji 图标（背包格与装备 tooltip 共用；挂 UI 供 ui-equipment / ui-market 复用）
  const EQUIP_ICON = { 武器:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 19-6-6"/><path d="m5 21-2-2"/><path d="m8 16-4 4"/><path d="M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5"/></svg>', 单手剑:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 19-6-6"/><path d="m5 21-2-2"/><path d="m8 16-4 4"/><path d="M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5"/></svg>', 双手剑:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️', 长剑:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 19-6-6"/><path d="m5 21-2-2"/><path d="m8 16-4 4"/><path d="M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5"/></svg>', 弓:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="22" x2="18" y1="12" y2="12" /><line x1="6" x2="2" y1="12" y2="12" /><line x1="12" x2="12" y1="6" y2="2" /><line x1="12" x2="12" y1="22" y2="18" /></svg>', 法杖:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>', 杖:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>', 盾:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>', 胸甲:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>', 头盔:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>️', 帽:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>️', 手套:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>', 靴:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>', 鞋:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>', 戒指:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>', 项链:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>', 护符:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>', 腰带:'<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' };
  UI.EQUIP_ICON = EQUIP_ICON;

  const CONSUMABLES = [
    { name: Config.craft.reforge.name, icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/></svg>', desc: '重铸全部词缀' },
    { name: Config.craft.strip.name, icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><path d="M14.8 14.8 20 20"/></svg>️', desc: '移除一条词缀' },
    { name: Config.craft.holy.name, icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>', desc: '重 Roll 词缀数值' },
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
    tip.style.bottom = 'auto';
    tip.style.transform = 'none';
    // 优先显示在格子右侧；右侧放不下（详情面板/视口边界）时自动挪到左侧
    const pad = 10, tipW = 300;
    const rightRoom = window.innerWidth - (r.right + pad);
    if (rightRoom >= tipW || rightRoom >= (r.left - pad)) {
      tip.style.left = (r.right + pad) + 'px';
    } else {
      tip.style.left = Math.max(pad, r.left - tipW - pad) + 'px';
    }
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
  // 装备 tooltip：复用打造页 .equip-tip 结构（大图标 + 名称 + 底材/等级 + 前后缀 + 魂铸）
  function equipTipHtml(eq, unid) {
    const r = rarityOf(eq);
    const mt = eq.materialTier ?? eq.tier ?? 4;
    const ilvl = window.Equipment.ilvlOf ? window.Equipment.ilvlOf(eq) : (eq.ilvl != null ? eq.ilvl : '—');
    const matLines = `<div class="tip-line"><span>底材</span><b>T${mt}</b></div>
      <div class="tip-line"><span>物品等级</span><b>${ilvl}</b></div>`;
    // PoE 式顶部大图标：稀有度色描边底座；未鉴定显示封印卷轴
    const icon = unid
      ? SVG_SEALED
      : '<span class="emoji">' + (EQUIP_ICON[eq.slot] || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>') + '</span>';
    const iconHtml = '<div class="tip-icon"><span class="ico"' + (unid ? '' : ' style="border-color:' + r.color + '"') + '>' + icon + '</span></div>';
    if (unid) {
      return iconHtml + `<div class="tip-name">${escapeHtml(eq.name)}</div>
        <div class="tip-line"><span>未鉴定的 ${eq.slot}</span></div>
        ${matLines}
        <div class="tip-line hint">开启手持鉴定后点此揭晓属性</div>`;
    }
    const aff = (eq.affixes && { prefix: eq.affixes.prefix || [], suffix: eq.affixes.suffix || [] }) || { prefix: [], suffix: [] };
    const line = (list, cls) => list.length
      ? list.map(a => window.Equipment.formatAffixHtml ? window.Equipment.formatAffixHtml(a, cls) : `<div class="${cls}">${escapeHtml(a.label)} +${a.value}%<span class="tip-tier">T${a.tier || 1}</span></div>`).join('')
      : '<div class="tip-empty">无</div>';
    return iconHtml + `<div class="tip-name" style="color:${r.color}">${escapeHtml(eq.name)}</div>
      ${matLines}
      <div class="tip-section">词缀</div>
      ${line(aff.prefix, 'tip-prefix')}
      <hr class="tip-divider">
      ${line(aff.suffix, 'tip-suffix')}
      <div class="tip-section">魂铸</div>
      ${eq.soulAffix
        ? '<div class="tip-soul" style="color:#c9a86a">' + (eq.soulAffix.label || '') + (eq.soulAffix.tier ? ' T' + eq.soulAffix.tier : '') + (eq.soulAffix.value != null ? ' +' + eq.soulAffix.value + (['hit','dodge','spd'].includes(eq.soulAffix.type) ? '' : '%') : '') + '</div>'
        : '<div class="tip-empty">无</div>'}
      <div class="tip-line hint" style="border-bottom:none;margin-top:4px">Ctrl/Alt+点击 分解 · 点开看词缀</div>`;
  }

  /* ---------- 网格列数（流放式固定格，auto-fill） ----------
   * CSS 用 repeat(auto-fill, var(--bag-cell)) 排列，列数随容器宽度变；
   * 这里不能硬编码列数，否则空格槽数量会和实际排列错位。
   * 口径：--bag-cell 48px / --bag-gap 2px / padding 6px（game.css），这里只作估算与回退。 */
  const BAG_CELL = 48, BAG_GAP = 2, BAG_PAD = 6;
  const BAG_FALLBACK_COLS = 6;
  const BAG_MIN_ROWS = 5;          // 最少显示行数（物品少时也露出空格槽）
  let bagLastCols = 0;             // 最近一次实际采用的列数（ResizeObserver 用它判断要不要重排）
  let bagResizeObserver = null, bagResizeTimer = 0;
  // 读浏览器实际解析出的列数。display:none 下 auto-fill 不解析（返回原文），clientWidth<=0 一律不采信
  function readRealCols(grid) {
    try {
      if (typeof getComputedStyle !== 'function' || !grid || grid.clientWidth <= 0) return 0;
      const t = String(getComputedStyle(grid).gridTemplateColumns || '');
      const parts = t.split(/\s+/).filter(Boolean);
      return parts.length > 1 ? parts.length : 0;
    } catch (e) { return 0; }
  }
  // 容器宽度变化 → 列数变了才重渲染（防抖 100ms，拖动背包窗口时不高频重建 DOM）
  function watchBagGrid(gridArea) {
    if (typeof ResizeObserver !== 'function' || !gridArea) return;
    if (!bagResizeObserver) {
      bagResizeObserver = new ResizeObserver(() => {
        window.clearTimeout(bagResizeTimer);
        bagResizeTimer = window.setTimeout(() => {
          const grid = document.querySelector('.bag-window .bag-item-grid');
          if (!grid) return;
          const cols = readRealCols(grid);
          if (cols && cols !== bagLastCols) renderBag();
        }, 100);
      });
    }
    bagResizeObserver.disconnect();
    bagResizeObserver.observe(gridArea);
  }

  function renderBag() {
    const root = $('bag-root');
    if (!root) return;
    root.innerHTML = '';

    const equipList = getInventory();
    const localMats = Materials.getLocal ? Materials.getLocal() : {};
    // 引导经验包（2026-09-08）单独走"消耗品"栏，别在素材里重复出现
    const EXP_PACK_NAMES = ((Config.tutorialMode && Config.tutorialMode.expPacks) || []).map(p => p.name);
    const matEntries = Object.entries(localMats).sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([name]) => !CONSUMABLES.some(c => c.name === name) && !EXP_PACK_NAMES.includes(name))
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
    grid.className = 'bag-item-grid bag-grid-real';
    gridArea.appendChild(grid);
    left.appendChild(gridArea);
    const bagItems = [];   // 收集本页要展示的物品卡片（后续塞进真实格子槽）

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
        showToast(identifyMode ? '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/></svg> 鉴定模式开启' : '已退出鉴定模式', identifyMode ? '点未鉴定装备即可鉴定' : '');
      });
      footer.appendChild(src);
    }

    // 右侧详情面板已移除（2026-09-07）：物品信息统一走悬停 tooltip；蛋详情仍是独立弹窗

    // ===== 渲染物品卡片（统一进一个网格，按分类过滤） =====
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
      // 排序：稀有度（金>蓝>白）优先，再按底材T 高在前（评分已从展示层移除，不再按分排）
      const rarityRank = id => ({ gold: 0, blue: 1, white: 2 }[id] != null ? { gold: 0, blue: 1, white: 2 }[id] : 3);
      eqList = eqList.slice().sort((a, b) =>
        rarityRank((a.rarity && a.rarity.id) || 'white') - rarityRank((b.rarity && b.rarity.id) || 'white') ||
        (a.tier ?? 4) - (b.tier ?? 4));
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
        const ico = unid ? SVG_SEALED : '<span class="emoji">' + (EQUIP_ICON[eq.slot] || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>') + '</span>';
        card.innerHTML = '<div class="ico">' + ico + '</div><div class="nm">' + escapeHtml(eq.name) + '</div>' + (unid ? '<div class="qmark">?</div>' : '') + '<div class="unseal-sweep"></div>';
        card.onclick = e => {
          if (identifyMode && unid) { identifyEquip(eq, card); return; }
          if (e.ctrlKey || e.altKey) { quickSalvage(eq); return; }
          showEquipDetail(eq);
        };
        bindTip(card, equipTipHtml(eq, unid));
        bagItems.push(card);
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
        bindTip(card, tip);
        bagItems.push(card);
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
        bindTip(card, tip);
        bagItems.push(card);
      }
      // 引导经验包（2026-09-08）：分档锁死的真实道具，点卡片使用（直升到档位上限，不超）
      const packs = ((Config.tutorialMode && Config.tutorialMode.expPacks) || []);
      for (const p of packs) {
        const qty = Materials.getQuantity(p.name) || 0;
        if (qty <= 0) continue;
        if (bagSearch && !p.name.toLowerCase().includes(bagSearch)) continue;
        const card = document.createElement('div');
        card.className = 'poe-item q-cons';
        card.innerHTML = '<div class="ico">' + (p.icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>') + '</div><div class="nm">' + escapeHtml(p.name) + '</div><div class="corner">×' + qty + '</div>';
        const tip = '<div class="tip-name">' + (p.icon || '') + ' ' + escapeHtml(p.name) + '</div>'
          + '<div class="tip-line"><span>' + escapeHtml(p.desc || '使用后魂兽直升') + '</span><b>×' + qty + '</b></div>'
          + '<div class="tip-line hint">点击使用 · 绑定道具，不可交易</div>';
        bindTip(card, tip);
        card.style.cursor = 'pointer';
        card.onclick = async () => {
          const T = window.TutorialMode;
          if (!T || !T.useExpPack) return;
          if (card.__busy) return;
          card.__busy = true;
          let r;
          try { r = await T.useExpPack(p.name); }
          finally { card.__busy = false; }
          if (!r || !r.ok) { if (showToast) showToast('使用失败', (r && r.error) || '未知错误'); return; }
          if (showToast) showToast('经验包已使用', '魂兽直升 Lv' + r.level + '（教学期门槛，无需刷怪）');
        };
        bagItems.push(card);
      }
    }

    // 宠物蛋
    if (bagCat === 'all' || bagCat === 'egg') {
      const eggList = eggEntries.filter(([baseName]) => !bagSearch || baseName.toLowerCase().includes(bagSearch));
      for (const [baseName, count] of eggList) {
        const eggName = window.Drop.makeEggName ? window.Drop.makeEggName(baseName) : baseName + '蛋';
        const card = document.createElement('div');
        card.className = 'poe-item q-egg';
        card.innerHTML = '<div class="ico"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg></div><div class="nm">' + escapeHtml(eggName) + '</div><div class="corner">×' + count + '</div>';
        const tip = '<div class="tip-name"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> ' + escapeHtml(eggName) + '</div><div class="tip-line"><span>宠物蛋</span><b>×' + count + '</b></div><div class="tip-line hint">点击查看 / 孵化 ' + escapeHtml(baseName) + '，也可在市场交易</div>';
        card.onclick = () => { showEggDetail(baseName, count, eggName); };
        bindTip(card, tip);
        bagItems.push(card);
      }
    }

    // 空背包：仍渲染空格子，提示作为覆盖层
    if (!bagItems.length) {
      grid.classList.add('bag-grid-empty');
      grid.dataset.empty = totalCount ? '没有符合条件的物品' : '背包空空，去挂机捡装备吧';
    }

    // ===== 真实背包格子：先按估算列数铺槽位，渲染后按浏览器实际解析列数校正一次 =====
    const renderSlots = cols => {
      const n = bagItems.length;
      const rows = Math.max(BAG_MIN_ROWS, Math.ceil(n / cols));
      grid.innerHTML = '';
      const total = rows * cols;
      for (let i = 0; i < total; i++) {
        const slot = document.createElement('div');
        slot.className = 'bag-slot' + (i >= n ? ' empty' : '');
        if (i < n) slot.appendChild(bagItems[i]);
        grid.appendChild(slot);
      }
    };
    // 估算列数：容器内容宽 ÷（格 + 间隙）；容器尚不可见（背包窗未打开）时用回退值，打开后由监听校正
    const innerW = (gridArea.clientWidth || 0) - BAG_PAD * 2;
    const estCols = innerW > 0
      ? Math.max(1, Math.floor((innerW + BAG_GAP) / (BAG_CELL + BAG_GAP)))
      : BAG_FALLBACK_COLS;
    renderSlots(estCols);
    // 真实列数校正：auto-fill 由浏览器按容器宽解析，比估算准；最多重排一次，防抖动
    const realCols = readRealCols(grid);
    if (realCols && realCols !== estCols) renderSlots(realCols);
    bagLastCols = realCols || estCols;
    watchBagGrid(gridArea);
  }

  // 鉴定：消耗 1 鉴定石 → 揭晓未鉴定装备属性（扫光演出后重渲染）
  async function identifyEquip(eq, card) {
    const have = window.Materials && window.Materials.getQuantity ? window.Materials.getQuantity('鉴定石') : 0;
    if (!have || have <= 0) { addLog('没有鉴定石，无法鉴定（去挂机捡鉴定石）'); return; }
    const r = await window.Materials.spend('鉴定石', 1);
    if (!r || !r.ok) { addLog('鉴定失败：' + ((r && r.error) || '鉴定石不足')); return; }
    eq.identified = true;
    /* 鉴定状态同步云端（不同步 → 刷新后 fromCloud 读回 false，又变回未鉴定且白扣鉴定石）。
     * ⚠️ 原来是 fire-and-forget（失败只 addLog）：石头真扣了、状态没落库 = 玩家白亏一颗。
     * 改成 await + 失败回滚（与 ui-pet-awaken.js 觉醒失败退石头同口径）。 */
    if (eq.cloudId && window.Items) {
      let up = null;
      try { up = await window.Items.updateCloudItem(eq, { identified: true }); } catch (e) { up = { error: e }; }
      if (up && up.error) {
        eq.identified = false;
        if (window.Materials && window.Materials.gain) window.Materials.gain('鉴定石', 1);
        addLog('⚠️ 鉴定失败：云端同步失败，鉴定石已退还（' + ((up.error && up.error.message) || '未知错误') + '）');
        showToast('❌ 鉴定失败', '云端同步失败，鉴定石已退还');
        return;
      }
    }
    const s = document.createElement('div'); s.className = 'bc-scan'; card.appendChild(s);
    setTimeout(() => {
      renderBag();
      showEquipDetail(eq); // 鉴定完成弹出词缀详情（与装备打造同款 .craft-affix-group 样式）
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg> 鉴定完成', eq.name);
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
    const unid = eq.identified === false;
    const pfx = (eq.affixes && eq.affixes.prefix) || [];
    const sfx = (eq.affixes && eq.affixes.suffix) || [];
    const affix = (arr, cls) => arr.length
      ? arr.map(a => `<div class="grp-line ${cls}">${Craft.affixText ? Craft.affixText(a) : (Equipment.formatAffix ? Equipment.formatAffix(a) : a.label + '+' + a.value + '%')}</div>`).join('')
      : '<span class="hint">无</span>';
    modal.innerHTML = `
      <div class="ed-overlay" data-close="1"></div>
      <div class="ed-card" style="border-color:${rarityOf(eq).color}">
        <div class="ed-head" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}
          <span class="ed-sub">${rarityOf(eq).label}装 · T${eq.tier ?? 4} · ${eq.slot}</span></div>
        ${unid
          ? `<div class="ed-base">未鉴定的 ${escapeHtml(eq.slot)} · 词缀封印</div>
             <div class="craft-affix-group"><div class="tip-empty">词缀已封印，需鉴定石揭晓后查看与穿戴</div></div>`
          : `<div class="ed-base">${describeItem(eq)}</div>
             <div class="craft-affix-group">
               <div class="grp-title">前缀（${pfx.length}/3）</div>
               ${affix(pfx, 'prefix')}
               <hr class="craft-affix-divider">
               <div class="grp-title">后缀（${sfx.length}/3）</div>
               ${affix(sfx, 'suffix')}
             </div>
             <div class="craft-affixcount">前缀 ${pfx.length}/3 · 后缀 ${sfx.length}/3</div>`}
        <div class="ed-actions">
          <button class="btn-mini alt" data-wear="1" ${unid ? 'disabled title="未鉴定 · 先用鉴定石揭晓"' : ''}>穿上</button>
          <button class="btn-mini" data-lock="1" ${unid ? 'disabled' : ''}>${eq.locked ? '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> 解锁' : '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 锁定'}</button>
          <button class="btn-mini" data-close="1">关闭</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-close]').forEach(el => el.onclick = closeEquipDetail);
    const wear = modal.querySelector('[data-wear]');
    if (wear) wear.onclick = () => {
      const pet = getActivePet();
      const res = equipItem(pet, eq.id);
      if (res) { addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ ${pet.name} 装备了 ${res.equipped.name}`); UI.renderAll(); }
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
        <div class="ed-head" style="color:var(--accent-hi)"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> ${escapeHtml(eggName)} <span class="ed-sub">×${count}</span></div>
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
      hatchBtn.innerHTML = UI.isLoggedIn() ? '孵化' : '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 登录后孵化';
      hatchBtn.onclick = async () => {
        const res = await hatchEgg(baseName);
        if (!res) return;
        if (res.error) { showToast('❌ 无法孵化', res.error); return; }
        showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> 孵化成功！', escapeHtml(res.baby.name));
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
    addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 分解：${eq.name}` + (parts.length ? '，得 ' + parts.join('、') : ''));
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 分解完成', parts.join('<br>') || '白装无材料产出');
    UI.renderAll();
  }
  // 批量分解：当前背包全部可分解装备（Ctrl+Alt+Enter 或装备页「批量分解」）
  async function bulkSalvage() {
    const all = getInventory().filter(eq => Salvage.isSalvageable(eq));
    if (!all.length) { showToast('没有可分解装备', '好装备 / 锁定 / 在售都会保留'); return; }
    const res = await Salvage.salvageList(all);
    if (res.error) { showToast('❌ 分解失败', res.error); return; }
    const parts = Object.entries(res.gains || {}).map(([k, n]) => `${Config.craft[k]?.name || k} ×${n}`);
    addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 批量分解 ${res.count} 件` + (parts.length ? '，得 ' + parts.join('、') : ''));
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 批量分解完成', `分解 ${res.count} 件<br>` + (parts.join('<br>') || '白装无材料产出'));
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
    if (UI.renderInvFilter) UI.renderInvFilter();
    if (UI.renderInventory) UI.renderInventory();
    if (UI.renderInvToolbar) UI.renderInvToolbar();
    const host = document.getElementById('bag-window');
    if (!host) return;
    // 清掉上次拖拽残留的内联 left/top/transform，回到 CSS 居中模型（否则重开会飞左上角）
    const win = host.querySelector('.bag-window');
    if (win) { win.style.left = ''; win.style.top = ''; win.style.transform = ''; }
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
          if (UI.renderInvFilter) UI.renderInvFilter();
          if (UI.renderInventory) UI.renderInventory();
          if (UI.renderInvToolbar) UI.renderInvToolbar();
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
  /* ---------- 孵化唯一入口（2026-09-10 用户拍板）----------
   * 宠物页的「宠物蛋」pane 是墓碑已删；孵化统一走这里：打开背包浮窗 + 停在「素材蛋」分类。
   * 调用方：主城孵化所（ui-capital）、任务/引导跳转（ui-quest goGuide page:'bag'）。 */
  UI.openBagEggs = function () {
    bagCat = 'egg';
    openBagWindow();   // 内部先 renderBag()，egg 分类立即生效
    const sub = document.querySelector('.bag-subtab[data-bag-subtab="bag"]');
    if (sub && sub.click) sub.click();
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initBagWindow);
  }

  UI.renderBag = renderBag;
  UI.showEquipDetail = showEquipDetail;
  /* 2026-09-10：暴露背包悬停 tooltip 机制，供市集等页面直接复用（不重写） */
  UI.showBagTip = showBagTip;
  UI.hideBagTip = hideBagTip;
  UI.bindTip = bindTip;
  UI.equipTipHtml = equipTipHtml;
})();
