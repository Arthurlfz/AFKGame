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
  const SVG_SEALED = '<img class="mat-img" src="assets/ui/ic_sealed.png" alt="">';
  // 鉴定卷轴（拿在手上解封）：亮金卷轴 + 眼睛，区别于未鉴定封印卷轴
  const SVG_IDSTONE = '<img class="mat-img" src="assets/ui/ic_mat_identify.png" alt="">';
  // 素材名 → emoji 图标（按关键词粗分，流放格子里用）
  /* 材料专属图标（2026-09-16 暗黑水墨国风全套 ic_mat_*.png）——优先命中，旧 SVG 只作回退 */
  const MAT_ICONS = {
    '枯荣种荚': '<img class="mat-img" src="assets/ui/ic_mat_seedpod.png" alt="">',
    '泣腐之泪': '<img class="mat-img" src="assets/ui/ic_mat_tear.png" alt="">',
    '白骨残片': '<img class="mat-img" src="assets/ui/ic_mat_bone.png" alt="">',
    '幽影魂丝': '<img class="mat-img" src="assets/ui/ic_mat_soulthread.png" alt="">',
    '血潮凝晶': '<img class="mat-img" src="assets/ui/ic_mat_bloodcrystal.png" alt="">',
    '腐变之心': '<img class="mat-img" src="assets/ui/ic_mat_heart.png" alt="">',
    '回响之羽': '<img class="mat-img" src="assets/ui/ic_mat_feather.png" alt="">',
    '腐沼黏液': '<img class="mat-img" src="assets/ui/ic_mat_slime.png" alt="">',
    '余烬残灰': '<img class="mat-img" src="assets/ui/ic_mat_ash.png" alt="">',
    '魂渊之尘': '<img class="mat-img" src="assets/ui/ic_mat_dust.png" alt="">',
    '腐印·暴怒': '<img class="mat-img" src="assets/ui/ic_mat_seal_rage.png" alt="">',
    '腐印·荆棘': '<img class="mat-img" src="assets/ui/ic_mat_seal_thorn.png" alt="">',
    '腐印·疾影': '<img class="mat-img" src="assets/ui/ic_mat_seal_swift.png" alt="">',
    '腐印·蚀甲': '<img class="mat-img" src="assets/ui/ic_mat_seal_corrode.png" alt="">',
    '腐印·狂乱': '<img class="mat-img" src="assets/ui/ic_mat_seal_frenzy.png" alt="">',
    '腐印·增殖': '<img class="mat-img" src="assets/ui/ic_mat_seal_proliferate.png" alt="">',
    '腐印·屠戮': '<img class="mat-img" src="assets/ui/ic_mat_seal_slaughter.png" alt="">',
    '腐印·渴血': '<img class="mat-img" src="assets/ui/ic_mat_seal_thirst.png" alt="">',
    '腐印·破阵': '<img class="mat-img" src="assets/ui/ic_mat_seal_break.png" alt="">',
    '腐印·枯竭': '<img class="mat-img" src="assets/ui/ic_mat_seal_wither.png" alt="">',
    '腐印·禁疗': '<img class="mat-img" src="assets/ui/ic_mat_seal_noheal.png" alt="">',
    '腐印·天罚': '<img class="mat-img" src="assets/ui/ic_mat_seal_heavenbolt.png" alt="">',
    '重铸石': '<img class="mat-img" src="assets/ui/ic_mat_reforge.png" alt="">',
    '剥离石': '<img class="mat-img" src="assets/ui/ic_mat_strip.png" alt="">',
    '神圣石': '<img class="mat-img" src="assets/ui/ic_mat_holy.png" alt="">',
    '增缀石': '<img class="mat-img" src="assets/ui/ic_mat_augment.png" alt="">',
    '锁定石': '<img class="mat-img" src="assets/ui/ic_mat_lock.png" alt="">',
    '鉴定石': '<img class="mat-img" src="assets/ui/ic_mat_identify.png" alt="">',
    '进化素材': '<img class="mat-img" src="assets/ui/ic_mat_evolve.png" alt="">',
    '精粹进化素材': '<img class="mat-img" src="assets/ui/ic_mat_essence.png" alt="">',
    '传说进化素材': '<img class="mat-img" src="assets/ui/ic_mat_crown.png" alt="">',
    '强化丹A': '<img class="mat-img" src="assets/ui/ic_mat_pill_a.png" alt="">',
    '强化丹B': '<img class="mat-img" src="assets/ui/ic_mat_pill_b.png" alt="">',
    '天仙玉露': '<img class="mat-img" src="assets/ui/ic_mat_dew.png" alt="">',
    '琼浆玉露': '<img class="mat-img" src="assets/ui/ic_mat_kettle.png" alt="">',
    '合成之石': '<img class="mat-img" src="assets/ui/ic_mat_fuse.png" alt="">',
    '越龙之石': '<img class="mat-img" src="assets/ui/ic_mat_dragon.png" alt="">',
    '百变魔石': '<img class="mat-img" src="assets/ui/ic_mat_mask.png" alt="">',
    '至尊神石': '<img class="mat-img" src="assets/ui/ic_mat_supreme.png" alt="">',
    '涅槃丹': '<img class="mat-img" src="assets/ui/ic_mat_phoenix.png" alt="">',
    '锁魂玉': '<img class="mat-img" src="assets/ui/ic_mat_souljade.png" alt="">',
    '觉醒石': '<img class="mat-img" src="assets/ui/ic_mat_awaken.png" alt="">',
    '通天塔重置卡': '<img class="mat-img" src="assets/ui/ic_mat_tower_ticket.png" alt="">',
    /* 补漏 5（2026-09-16）：经验屑 / 经验包 / 试炼门票 / 退役凝魂晶石 / 超稀有涅磐兽 */
    '微光经验屑': '<img class="mat-img" src="assets/ui/ic_extra_expdust.png" alt="">',
    '终阶经验包': '<img class="mat-img" src="assets/ui/ic_extra_expbox.png" alt="">',
    '资源试炼门票': '<img class="mat-img" src="assets/ui/ic_extra_trial_ticket.png" alt="">',
    '凝魂晶石': '<img class="mat-img" src="assets/ui/ic_extra_soulcrystal.png" alt="">',
    '涅磐兽': '<img class="mat-img" src="assets/ui/ic_extra_phoenix.png" alt="">',
    /* 宠物蛋 6 种（统一通用蛋图） */
    '幽影兔蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">',
    '瘟熊蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">',
    '血狐蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">',
    '腐噜兽蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">',
    '毒沼蛙蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">',
    '骨狼蛋': '<img class="mat-img" src="assets/ui/ic_egg.png" alt="">'
  };
  UI.MAT_ICONS = MAT_ICONS; // 材料词条页复用（mat-wiki / ui-mat-entry）
  const matIcon = name => {
    if (MAT_ICONS[name]) return MAT_ICONS[name];
    if (/石|丹|核/.test(name)) return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg>';
    if (/兽|魂|晶|珠/.test(name)) return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>';
    return '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>';
  };
  // 部位 → emoji 图标（背包格与装备 tooltip 共用；挂 UI 供 ui-equipment / js/ui/market 复用）
  const EQUIP_ICON = {
    武器: '<img class="mat-img" src="assets/ui/ic_equip_weapon.png" alt="">',
    单手剑: '<img class="mat-img" src="assets/ui/ic_equip_1hsword.png" alt="">',
    双手剑: '<img class="mat-img" src="assets/ui/ic_equip_2hsword.png" alt="">',
    长剑: '<img class="mat-img" src="assets/ui/ic_equip_longsword.png" alt="">',
    弓: '<img class="mat-img" src="assets/ui/ic_equip_bow.png" alt="">',
    法杖: '<img class="mat-img" src="assets/ui/ic_equip_staff.png" alt="">',
    杖: '<img class="mat-img" src="assets/ui/ic_equip_rod.png" alt="">',
    盾: '<img class="mat-img" src="assets/ui/ic_equip_shield.png" alt="">',
    胸甲: '<img class="mat-img" src="assets/ui/ic_equip_chest.png" alt="">',
    头盔: '<img class="mat-img" src="assets/ui/ic_equip_helm.png" alt="">',
    帽: '<img class="mat-img" src="assets/ui/ic_equip_hat.png" alt="">',
    手套: '<img class="mat-img" src="assets/ui/ic_equip_gloves.png" alt="">',
    靴: '<img class="mat-img" src="assets/ui/ic_equip_boots.png" alt="">',
    鞋: '<img class="mat-img" src="assets/ui/ic_equip_shoes.png" alt="">',
    戒指: '<img class="mat-img" src="assets/ui/ic_equip_ring.png" alt="">',
    项链: '<img class="mat-img" src="assets/ui/ic_equip_necklace.png" alt="">',
    护符: '<img class="mat-img" src="assets/ui/ic_equip_amulet.png" alt="">',
    腰带: '<img class="mat-img" src="assets/ui/ic_equip_belt.png" alt="">'
  };
  UI.EQUIP_ICON = EQUIP_ICON;

  /* 【背包分类口径 · 2026-09-16 定稿】
   * 一级是 5 个页签：全部 / 装备 / 素材 / 消耗品 / 宠物蛋。
   * 素材与消耗品都走**同一套二级分区真源** `Config.materialInfoGroups`，靠 `kind` 分家：
   *   kind:'material'（默认）→ 「素材」页签：**攒着按数量扣**的资源（几十几百个：打造石、区域材料、进化素材…）
   *   kind:'consume'         → 「消耗品」页签：**用一次少一颗**的道具（经验包、涅槃丹、门票…）
   * 一件东西该去哪边，看玩家怎么用它 —— 想换区只改 materialInfo 里那一行的 group，UI 不用动。
   * 分区真源仍然只有一份（Config.materialInfo），UI 不许另写名单。
   * 历史：打造通货（重铸/剥离/神圣/增缀/锁定/鉴定）2026-09-14 从消耗品挪进「素材·打造与鉴定」——
   * 它们是打造成本、数量大，属于"货币"；那次是用户报「背包分类笼统」的第一轮修正。 */
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
  let bagGroup = 'all';         // 素材二级分区：all / materialInfoGroups 里 kind!=='consume' 的 id
  let bagConsumeGroup = 'all';  // 消耗品二级分区：all / materialInfoGroups 里 kind==='consume' 的 id（2026-09-16）
  let identifyMode = false;  // 手持鉴定模式：开启后点未鉴定装备即连续鉴定
let lastIdStoneN = null;   // 上次渲染时手上的鉴定石数量（底部整块重建，滚动要靠它当起点，2026-09-20）
  let revealQueue = [];      // 金装揭晓队列：modal已开时新金装排队，关一个自动弹下一个

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
      <div class="tip-line hint" style="border-bottom:none;margin-top:4px">Ctrl/Alt+点击 分解（会先问你一次） · 点开看词缀</div>`;
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
    if (window.Tips) Tips.show('bag_shortcuts', '⌨️ 快捷键', '空格开始/停止挂机 · W世界地图 · E宠物 · R市集');
    const root = $('bag-root');
    if (!root) return;
    root.innerHTML = '';

    const equipList = getInventory();
    const localMats = Materials.getLocal ? Materials.getLocal() : {};
    /* 分区真源（唯一一份：Config.materialInfo / materialInfoGroups），UI 不另写名单。
     * 2026-09-16：这张表分成两半 —— kind==='material' 的进「素材」页签、kind==='consume' 的进「消耗品」页签。
     * 分界线：**攒着按数量扣**（几十几百）算素材；**用一次少一颗**（手里就几颗）算消耗品。
     * 两边共用同一个 group 字段 ⇒ 以后想把某件东西换个区，只改它那一行的 group。 */
    const matInfo = Config.materialInfo || {};
    const allGroups = Config.materialInfoGroups || [];
    const matGroups = allGroups.filter(g => g.kind !== 'consume');   // 素材页签的分区按钮
    const useGroups = allGroups.filter(g => g.kind === 'consume');   // 消耗品页签的分区按钮
    const useGroupIds = useGroups.map(g => g.id);                    // 归消耗品的组（这几组不进素材区）
    const groupLabel = id => { const g = allGroups.find(x => x.id === id); return g ? g.label : '其他'; };
    /* 经验包一律走「消耗品」栏，不在素材里重复出现。两套来源都要登记，漏一套就会在素材区多显示一份：
     *   ① 引导经验包（tutorialMode.expPacks）：按关卡把魂兽顶到指定等级
     *   ② 通用经验包四档（Config.exp.expPacks，2026-09-16）：攒着用，吃了换成经验
     * 名字登记是唯一判据（它们存在 materials 表里，跟普通材料同表）。 */
    const EXP_PACK_NAMES = [].concat(
      ((Config.tutorialMode && Config.tutorialMode.expPacks) || []).map(p => p.name),
      (Config.expPacks || []).map(p => p.name)   // ⚠️ 顶层 Config.expPacks，不是 Config.exp.expPacks
    );
    /* 素材：绑定的和能卖的**拆成两格分开放**（2026-09-16 用户要求）。
     * 原来一格装总数、靠角标提示，玩家看到「×282」根本不知道自己只能卖 246 个 ——
     * 分开摆之后「哪堆能卖」一眼就知道，也不用去数角标。
     * 顺序：同名的先放可交易那格、再放绑定那格（相邻，好对比）。 */
    const matEntries = [];
    for (const [name, qty] of Object.entries(localMats).sort((a, b) => a[0].localeCompare(b[0]))) {
      // ① 经验包（含老号背包里残留的引导包，它们没登记进 materialInfo）② 登记为消耗品的都走下面那一栏
      if (EXP_PACK_NAMES.includes(name)) continue;
      const group0 = (matInfo[name] || {}).group || 'misc';
      if (useGroupIds.includes(group0)) continue;
      const group = group0;
      const bq = Materials.getBoundQuantity ? Math.min(Materials.getBoundQuantity(name) || 0, qty) : 0;
      const freeQty = qty - bq;
      if (freeQty > 0) matEntries.push({ name, qty: freeQty, group, bound: false });
      if (bq > 0) matEntries.push({ name, qty: bq, group, bound: true });
    }
    /* 消耗品位 = ① 经验包（两套来源的名字）② materialInfo 里归 consume 组的道具（门票 / 涅槃丹 / 觉醒石…）。
     * 每条带 action：
     *   'use'  = 背包里点一下当场生效（经验包 → 喂当前出战宠）
     *   'wiki' = 用法在别的页面（涅槃丹要在涅槃页勾选、门票要在试炼入口花）⇒ 背包只负责告诉玩家
     *            "这东西干嘛用、去哪用"，点一下打开词条页，**不做假按钮**（点了没反应最伤）。 */
    const consNames = Array.from(new Set(
      EXP_PACK_NAMES.concat(Object.keys(matInfo).filter(k => useGroupIds.includes((matInfo[k] || {}).group)))
    ));
    const consEntries = consNames.map(n => {
      const cfg = (Config.expPacks || []).find(x => x.name === n) || null;
      return {
        name: n,
        qty: Materials.getQuantity(n) || 0,
        group: (matInfo[n] || {}).group || 'use-exp',   // 老号残留的引导包没登记 → 兜到经验组
        action: cfg ? 'use' : 'wiki',
        amount: cfg ? (Number(cfg.amount) || 0) : 0,
        bound: (Materials.getBoundQuantity ? (Materials.getBoundQuantity(n) || 0) : 0) > 0
      };
    }).filter(e => e.qty > 0);
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

    // 整理按钮：按稀有度→部位→名称重新排序（实际排序逻辑在装备渲染处）
    const sortBtn = document.createElement('button');
    sortBtn.className = 'bag-action-btn';
    sortBtn.textContent = '整理';
    sortBtn.title = '按品质从高到低重新排列';
    sortBtn.onclick = () => {
      // 触发重新渲染（排序已在 renderBag 内完成）
      renderBag();
      showToast('已整理', '按品质从高到低排列');
    };
    filterBar.appendChild(sortBtn);

    left.appendChild(filterBar);

    // 素材二级分区（2026-09-14）：只在「素材」页签里出现，选项来自唯一真源 Config.materialInfoGroups
    if (bagCat === 'material') {
      const subBar = document.createElement('div');
      subBar.className = 'bag-sub-cats';
      const subCats = [{ id: 'all', label: '全部素材' }].concat(matGroups.map(g => ({ id: g.id, label: g.label })));
      for (const g of subCats) {
        const btn = document.createElement('button');
        btn.className = 'bag-cat' + (bagGroup === g.id ? ' active' : '');
        btn.textContent = g.label;
        btn.onclick = () => { bagGroup = g.id; renderBag(); };
        subBar.appendChild(btn);
      }
      left.appendChild(subBar);
    }

    // 消耗品二级分区（2026-09-16 用户报「消耗品没有分类」）：与素材同一套真源，只取 kind==='consume' 的那几组
    if (bagCat === 'consume') {
      const subBar = document.createElement('div');
      subBar.className = 'bag-sub-cats';
      const subCats = [{ id: 'all', label: '全部消耗品' }].concat(useGroups.map(g => ({ id: g.id, label: g.label })));
      for (const g of subCats) {
        const btn = document.createElement('button');
        btn.className = 'bag-cat' + (bagConsumeGroup === g.id ? ' active' : '');
        btn.textContent = g.label;
        btn.onclick = () => { bagConsumeGroup = g.id; renderBag(); };
        subBar.appendChild(btn);
      }
      left.appendChild(subBar);
    }

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
    /* 容量（2026-09-16 用户拍板）：装备位有上限了，底部直接给"用了几格 / 共几格"，
     * 满了标红 + 一句话告诉玩家去哪解决（商店的扩建道具）。素材/消耗品/蛋暂时不限。 */
    const bagUse = (window.Supabase && window.Supabase.usageOf) ? window.Supabase.usageOf('bag') : null;
    const capHtml = bagUse
      ? '　装备位 <b' + (bagUse.full ? ' style="color:var(--danger-hi)"' : '') + '>' + bagUse.used + '/' + bagUse.cap + '</b>'
        + (bagUse.full ? '（已满 · 去商店扩建或分解腾位）' : '')
      : '';
    footer.innerHTML = '<span>物品：<b>' + totalCount + '</b>（装备' + equipList.length + ' · 素材' + matEntries.length + ' · 消耗' + consEntries.length + ' · 蛋' + eggCount + '）' + capHtml + '</span>';
    left.appendChild(footer);

    // 鉴定石开关
    const haveStoneN = Materials.getQuantity('鉴定石');
    if (haveStoneN > 0) {
      const src = document.createElement('div');
      src.className = 'bag-idstone' + (identifyMode ? ' active' : '');
      src.innerHTML = '<span class="bs-ico">' + SVG_IDSTONE + '</span> 鉴定石 <b class="bs-num"></b>';
      /* 数字滚动（2026-09-20）：背包底部每次 renderBag 都整块重建 ⇒ 元素是新的、没有 __num，
       * 所以显式把「上次的数量」当起点传进去 —— 鉴定时能看到它一颗颗往下掉。 */
      const bsNum = src.querySelector('.bs-num');
      if (bsNum) UI.setNum(bsNum, haveStoneN, {
        from: (lastIdStoneN == null) ? haveStoneN : lastIdStoneN,
        fmt: v => '×' + Math.round(v)
      });
      lastIdStoneN = haveStoneN;
      src.draggable = true;
      src.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'identify'); e.dataTransfer.effectAllowed = 'move'; });
      src.addEventListener('click', () => {
        identifyMode = !identifyMode;
        renderBag();
        showToast(identifyMode ? '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/></svg> 鉴定模式开启' : '已退出鉴定模式', identifyMode ? '点未鉴定装备即可鉴定' : '');
      });
      footer.appendChild(src);
    }

    // 批量分解按钮：当前背包全部可分解装备（白/蓝装，自动跳过锁定/在售/穿着的）
    const bulkBtn = document.createElement('button');
    bulkBtn.className = 'bag-action-btn bag-bulk-salvage';
    bulkBtn.textContent = '批量分解白/蓝装';
    bulkBtn.title = '分解所有未锁定、未在售、未穿着的白装和蓝装（金装保留）';
    bulkBtn.onclick = () => {
      const all = getInventory().filter(eq => {
        if (!Salvage.isSalvageable(eq)) return false;
        const rar = (eq.rarity && eq.rarity.id) || 'white';
        return rar === 'white' || rar === 'blue'; // 只批量拆白蓝，金装不动
      });
      if (!all.length) { showToast('没有可分解的白/蓝装', '金装 / 锁定 / 在售 / 穿着的都会保留'); return; }
      askThenSalvage(all, '批量分解白蓝装');
    };
    footer.appendChild(bulkBtn);


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
        card.className = 'poe-item q-' + rar + (eq.bound ? ' q-bound' : '') + (unid ? ' q-unid' : '') + (identifyMode && unid ? ' bc-idtarget' : '');
        // 2026-09-17：原来 card.draggable = true 并带 act:'salvage' 的 dragstart ——
        // 但全项目【没有任何 .salvage-drop 落点】（分解台只有 CSS，JS 从不创建它），
        // 拖起来没有任何地方能放，纯属误导。装备卡现在只作为「鉴定石的落点」。
        if (unid) {
          card.draggable = false;
          card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('bc-drop'); });
          card.addEventListener('dragleave', () => card.classList.remove('bc-drop'));
          card.addEventListener('drop', e => {
            e.preventDefault(); card.classList.remove('bc-drop');
            if (e.dataTransfer.getData('text/plain') === 'identify') identifyEquip(eq, card);
          });
        }
        const ico = unid ? SVG_SEALED : '<span class="emoji">' + (EQUIP_ICON[eq.slot] || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>') + '</span>';
        card.innerHTML = '<div class="ico">' + ico + '</div><div class="nm">' + escapeHtml(eq.name) + '</div>'
          + (eq.bound ? '<div class="bind-mark" title="绑定装备：任务获得，能穿能分解，不能上架">绑</div>' : '')
          + (unid ? '<div class="qmark">?</div>' : '') + '<div class="unseal-sweep"></div>';
        card.onclick = e => {
          if (identifyMode && unid) { identifyEquip(eq, card); return; }
          if (e.ctrlKey || e.altKey) { quickSalvage(eq); return; }
          showEquipDetail(eq);
        };
        bindTip(card, equipTipHtml(eq, unid));
        bagItems.push(card);
      }
    }

    // 素材（二级分区按 Config.materialInfo.group；「全部」页签下不受分区筛选影响）
    if (bagCat === 'all' || bagCat === 'material') {
      const matList = matEntries.filter(m => (bagCat !== 'material' || bagGroup === 'all' || m.group === bagGroup)
        && (!bagSearch || m.name.toLowerCase().includes(bagSearch)));
      for (const m of matList) {
        // 悬停短版：一句"怎么用" + 来源前 2 处 + 点开看全（长词条走 MatWiki 的模态，见 ui-mat-entry.js）
        const e = (window.MatWiki && window.MatWiki.entry) ? window.MatWiki.entry(m.name) : null;
        const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
        const useLine = e && e.uses.length ? (e.handUse || (e.uses[0].where + '：' + e.uses[0].what)) : '';
        const srcLine = e && e.sources.length
          ? e.sources.slice(0, 2).map(s => s.where).join(' / ') + (e.sources.length > 2 ? ' 等 ' + e.sources.length + ' 处' : '')
          : '';
        const card = document.createElement('div');
        // 这一格是"绑定堆"还是"能卖堆"：绑定的描金边 + 左上角「绑」字
        card.className = 'poe-item q-mat' + (m.bound ? ' q-bound' : '');
        card.innerHTML = '<div class="ico">' + matIcon(m.name) + '</div><div class="nm">' + escapeHtml(m.name) + '</div>'
          + (m.bound ? '<div class="bind-mark" title="绑定：任务获得，能自用、能上交，不能交易">绑</div>' : '')
          + '<div class="corner">×' + m.qty + '</div>';
        const tip = '<div class="tip-name">' + matIcon(m.name) + ' ' + escapeHtml(m.name)
          + (m.bound ? '<span class="bind-tag">绑定</span>' : '') + '</div>'
          + '<div class="tip-line"><span>' + (m.bound ? '任务获得 · 不能卖' : escapeHtml(groupLabel(m.group)) + ' · 可交易') + '</span><b>×' + m.qty + '</b></div>'
          + (useLine ? '<div class="tip-line hint">怎么用：' + escapeHtml(clip(useLine, 72)) + '</div>' : '')
          + (srcLine ? '<div class="tip-line hint">来源：' + escapeHtml(srcLine) + '</div>' : '')
          + '<div class="tip-line hint">点一下看完整词条（用途 ' + (e ? e.uses.length : 0) + ' · 来源 ' + (e ? e.sources.length : 0) + '）</div>';
        bindTip(card, tip);
        card.style.cursor = 'pointer';
        card.onclick = () => { if (UI.openMatEntry) UI.openMatEntry(m.name); else hideBagTip(); };
        bagItems.push(card);
      }
    }

    // 消耗品（2026-09-16 分类）：经验包 + 门票 / 涅槃丹 / 觉醒石 这类一次性道具
    if (bagCat === 'all' || bagCat === 'consume') {
      const packs = consEntries.filter(p => (bagCat !== 'consume' || bagConsumeGroup === 'all' || p.group === bagConsumeGroup)
        && (!bagSearch || p.name.toLowerCase().includes(bagSearch)));
      for (const p of packs) {
        const qty = p.qty;
        const card = document.createElement('div');
        card.className = 'poe-item q-cons' + (p.bound ? ' q-bound' : '');
        card.innerHTML = '<div class="ico">' + (MAT_ICONS[p.name] || p.icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>') + '</div><div class="nm">' + escapeHtml(p.name) + '</div>'
          + (p.bound ? '<div class="bind-mark" title="绑定道具，不可交易">绑</div>' : '')
          + '<div class="corner">×' + qty + '</div>';
        /* 说明分两种（效果不一样，不能共用一句）：
         *   经验包 → 「使用后 +N 经验」（点了当场生效）
         *   其他 → materialInfo.use（一句用途）；没写 use 的退到分区名（如"合成与涅槃"），
         *          玩家至少知道该去哪个页面找它。 */
        const useDesc = p.action === 'use'
          ? ('使用后 +' + (p.amount || 0).toLocaleString() + ' 经验')
          : ((matInfo[p.name] || {}).use || groupLabel(p.group) || '点开看用途');
        const tip = '<div class="tip-name">' + (MAT_ICONS[p.name] || p.icon || '') + ' ' + escapeHtml(p.name) + '</div>'
          + '<div class="tip-line"><span>' + escapeHtml(useDesc) + '</span><b>×' + qty + '</b></div>'
          + '<div class="tip-line hint">' + (p.action === 'use' ? '点击使用 · ' : '点击看词条 · ') + (p.bound ? '绑定道具，不可交易' : '可交易') + '</div>';
        bindTip(card, tip);
        card.style.cursor = 'pointer';
        card.onclick = async () => {
          // 用法不在背包里的（涅槃丹 / 门票 / 觉醒石…）→ 打开词条页，别做假按钮
          if (p.action === 'wiki') { if (UI.openMatEntry) UI.openMatEntry(p.name); else hideBagTip(); return; }
          const T = window.TutorialMode;
          if (!T || !T.useExpPack) return;
          if (card.__busy) return;
          card.__busy = true;
          let r;
          try { r = await T.useExpPack(p.name); }
          finally { card.__busy = false; }
          if (!r || !r.ok) { if (showToast) showToast('使用失败', (r && r.error) || '未知错误'); return; }
          if (!showToast) return;
          /* 🔴 包已经在**服务端**扣掉了，等级却没写进云端 ⇒ 刷新就回退、包也没了。
           * 这种"看着成功其实会丢"的结果必须就地弹出来（消息中心那条 log 玩家未必看得到），
           * 规则见 topics/UI与玩法约定：关键操作的成败反馈要在玩家正看着的地方显示。 */
          if (r.saved === false) {
            showToast('⚠️ 等级没存上云端', '经验已生效，但服务器写入失败 —— 刷新后可能回退（重新登录可再试）');
            return;
          }
          if (r.exp > 0) showToast('经验已入账', `${r.petName || '出战魂兽'} +${Number(r.exp).toLocaleString()} 经验` + (r.levelUp ? ` · 升到 Lv.${r.level}` : ''));
          else showToast('经验包已使用', '魂兽直升 Lv' + r.level + '（教学期门槛，无需刷怪）');
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
        card.innerHTML = '<div class="ico"><img class="mat-img" src="assets/ui/ic_egg.png" alt=""></div><div class="nm">' + escapeHtml(eggName) + '</div><div class="corner">×' + count + '</div>';
        const tip = '<div class="tip-name"><img class="mat-img" src="assets/ui/ic_egg.png" alt=""> ' + escapeHtml(eggName) + '</div><div class="tip-line"><span>宠物蛋</span><b>×' + count + '</b></div><div class="tip-line hint">点击查看 / 孵化 ' + escapeHtml(baseName) + '，也可在市场交易</div>';
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
    /* 扫光演出必须在【点下去那一刻】就开始（2026-09-15 修）：
     * 原先它写在两次 await（扣鉴定石 + 同步云端）之后 —— 这 ~0.7 秒里屏幕完全空白，
     * 玩家以为没点上就会反复点（重复扣石头）。提到前面后，等待过程本身就是演出。 */
    const s = document.createElement('div'); s.className = 'bc-scan'; card.appendChild(s);
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
    // 揭晓演出（2026-09-14）：只有金装走完整那套（卡片流光 + 词缀逐条亮起）。
    // 白/蓝装鉴定太频繁，每次都演一遍会烦 —— 它们只保留背包格上的扫光。
    const rar = rarityOf(eq);
    const isGold = !!(rar && rar.id === 'gold');
    if (isGold) addLog('<span class="hi3">鉴定揭晓 · ' + escapeHtml(eq.name) + '（金装）</span>');
    setTimeout(() => {
      renderBag();
      showEquipDetail(eq, isGold); // 鉴定完成弹出词缀详情（与装备打造同款 .craft-affix-group 样式）
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg> 鉴定完成', eq.name);
    }, 600);
  }

  // 装备详情面板：词缀区复用装备打造页的 .craft-affix-group（前缀绿/后缀蓝，同款样式）
  // reveal=true → 走「鉴定揭晓」演出：卡片一道光扫过 + 词缀从???逐条揭开（只给金装用）
  function showEquipDetail(eq, reveal) {
    // 队列：modal已开着（上一个金装还在看）→ 排队，不覆盖
    let modal = $('equip-detail-modal');
    if (reveal && modal && modal.classList.contains('open')) {
      revealQueue.push({ eq, reveal });
      return;
    }
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'equip-detail-modal';
      modal.className = 'equip-detail-modal';
      document.body.appendChild(modal);
    }
    const unid = eq.identified === false;
    const pfx = (eq.affixes && eq.affixes.prefix) || [];
    const sfx = (eq.affixes && eq.affixes.suffix) || [];
    // 揭晓模式：词缀先显示"???"，再逐条揭开。收集待揭开的条目用于setTimeout。
    const pendingReveals = [];
    let revealIdx = 0;
    const affix = (arr, cls) => arr.length
      ? arr.map(a => {
          const realHtml = Craft.affixText ? Craft.affixText(a) : (Equipment.formatAffix ? Equipment.formatAffix(a) : a.label + '+' + a.value + '%');
          const tier = a.tier || 5;
          if (reveal) {
            const delay = 0.35 + revealIdx++ * 0.16;
            pendingReveals.push({ delay, realHtml, tier });
            const tCls = tier <= 2 ? ' t' + tier : '';
            return `<div class="grp-line ${cls} affix-swap${tCls}"><span class="sealed-q">???</span></div>`;
          }
          return `<div class="grp-line ${cls}">${realHtml}</div>`;
        }).join('')
      : '<span class="hint">无</span>';
    modal.innerHTML = `
      <div class="ed-overlay" data-close="1"></div>
      <div class="ed-card${reveal ? ' ed-reveal' : ''}" style="border-color:${rarityOf(eq).color}">
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
      const oldEq = pet.equipment[eq.slot];
      const oldScore = (window.Equipment && Equipment.scoreOf) ? Equipment.scoreOf(oldEq) : 0;
      const res = equipItem(pet, eq.id);
      if (res) {
        const newScore = (window.Equipment && Equipment.scoreOf) ? Equipment.scoreOf(res.equipped) : 0;
        const diff = newScore - oldScore;
        const sign = diff >= 0 ? '+' : '';
        const diffColor = diff >= 0 ? 'var(--hp-hi,#7dd87d)' : 'var(--danger-hi,#d98080)';
        showToast('装备已穿戴', '评分 ' + oldScore + ' → ' + newScore + ' (' + sign + diff + ')');
        addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ ${pet.name} 装备了 ${res.equipped.name}`); UI.renderAll(); }
      closeEquipDetail();
    };
    const lockBtn = modal.querySelector('[data-lock]');
    // 同装备页：锁定要等一次云端同步，期间给即时反馈（否则点了解锁看不出有没有生效）
    if (lockBtn) lockBtn.onclick = () => UI.runWithLoading(lockBtn, '…', async () => {
      await Salvage.toggleLock(eq);
      closeEquipDetail();
      UI.renderAll();
    });
    modal.classList.add('open');
    // 揭晓演出：词缀从???逐条揭开（setTimeout按延迟换内容，T1/T2有跳变高亮）
    if (reveal && pendingReveals) {
      const lines = modal.querySelectorAll('.affix-swap');
      pendingReveals.forEach((item, i) => {
        setTimeout(() => {
          const el = lines[i];
          if (!el || !el.parentNode) return;
          el.classList.add('revealed');
          el.innerHTML = item.realHtml;
        }, item.delay * 1000);
      });
    }
  }
  function closeEquipDetail() {
    const m = $('equip-detail-modal'); if (m) m.classList.remove('open');
    // 队列：关了当前金装，自动弹下一个排队的
    if (revealQueue.length) {
      const next = revealQueue.shift();
      setTimeout(() => showEquipDetail(next.eq, next.reveal), 200);
    }
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
      /* ⚠️ 孵化要串 4 次服务器往返（建新宠 = insert + 装备槽更新，再扣蛋 = 先读后写），约 1.3 秒。
       * 以前只有成功时才弹 toast，等待期间按钮完全没变化 = 玩家以为没点着，反复点会建出多只宠。 */
      hatchBtn.onclick = async () => {
        const res = await UI.runWithLoading(hatchBtn, '孵化中…', () => hatchEgg(baseName));
        if (!res) return;
        if (res.error) { showToast('❌ 无法孵化', res.error); return; }
        showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> 孵化成功！', escapeHtml(res.baby.name));
        closeEggDetail();
        UI.renderAll();
      };
    }
    modal.classList.add('open');
  }
  /* 分解统一出口：先弹确认（看清拆几件、得什么），确认后才真的拆。
   * 分解是不可逆的，任何入口都不许跳过这一步 —— 2026-09-17 立。 */
  function askThenSalvage(list, label) {
    const ICON = '<img class="eic-img" src="assets/ui/ic_shred.png" alt="">';
    const preview = (Salvage.previewEquips ? Salvage.previewEquips(list) : null) || {};
    const count = preview.count != null ? preview.count : list.length;
    const gain = Object.entries(preview.gains || {})
      .map(([k, n]) => `<div>${(Config.craft[k] && Config.craft[k].name) || k} ×<b>${n}</b></div>`).join('');
    const r = preview.byRarity || {};
    const body = `<div class="salvage-count">将分解 <b>${count}</b> 件装备</div>`
      + `<div class="salvage-detail">白 ${r.white || 0} ｜ 蓝 ${r.blue || 0} ｜ 金 ${r.gold || 0}</div>`
      + (list.length === 1 ? `<div class="salvage-detail">${escapeHtml(list[0].name)}</div>` : '')
      + '<div class="salvage-gain">预计获得：</div><div class="salvage-detail">'
      + (gain || '<span class="hint">无材料产出（白装分解无产出）</span>') + '</div>'
      + '<div class="salvage-warn">⚠️ 分解不可撤销</div>';
    const fire = async () => {
      const res = await Salvage.salvageList(list);
      if (res.error) { showToast('❌ 分解失败', res.error); return; }
      const parts = Object.entries(res.gains || {}).map(([k, n]) => `${Config.craft[k]?.name || k} ×${n}`);
      addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ${label} ${res.count} 件` + (parts.length ? '，得 ' + parts.join('、') : ''));
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 分解完成', `分解 ${res.count} 件<br>` + (parts.join('<br>') || '白装无材料产出'));
      UI.renderAll();
    };
    if (UI.salvageConfirm) {
      UI.salvageConfirm({
        title: ICON + ' ' + label,
        bodyHtml: body,
        okLabel: '确认分解',
        fallbackText: `确认${label} ${count} 件装备？此操作不可撤销。`,
        onOk: fire
      });
    } else fire(); // 面板模块没加载（测试桩）：直接执行，不阻塞
  }
  // Ctrl/Alt + 点击：单件快分解（复用 Salvage，自动跳过锁定/在售）
  function quickSalvage(eq) {
    if (!Salvage.isSalvageable(eq)) { showToast('不能分解', eq.locked ? '已锁定（详情里解锁）' : '装备在售中'); return; }
    askThenSalvage([eq], '分解');
  }
  // 批量分解：当前背包全部可分解装备（Ctrl/Alt+Enter）
  function bulkSalvage() {
    const all = getInventory().filter(eq => Salvage.isSalvageable(eq));
    if (!all.length) { showToast('没有可分解装备', '好装备 / 锁定 / 在售都会保留'); return; }
    askThenSalvage(all, '批量分解');
  }
  /* 批量快捷键：Ctrl/Alt + Enter = 分解全部可分解装备
   * 🔴 2026-09-17 加两道闸（原来是无条件响应，出过两次事）：
   *   ① 焦点在输入框里时不响应 —— Ctrl+Enter 是聊天/输入框的「发送」，
   *      以前按一下会同时"发出消息 + 拆光背包"；
   *   ② 只有背包窗口开着才响应 —— 在市集、商店页面按到不该有事发生。
   *   执行前还会走装备页那个分解确认面板（见 askThenSalvage）。 */
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.altKey) || e.key !== 'Enter') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const host = document.getElementById('bag-window');
    if (!host || !host.classList.contains('is-open')) return;
    e.preventDefault();
    bulkSalvage();
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
    /* 🔴 关窗前必须清掉悬停提示（2026-09-22 用户实测：主城画面上飘着「徽记坠饰」）。
     * 根因：tooltip 挂在 body 层（不随浮窗消失），靠 card 的 mouseleave 隐藏 ——
     *   而玩家是**鼠标停在装备格上**把背包关掉的，那个 mouseleave 永远等不到
     *   ⇒ 提示带 .show 留在屏幕上，切到任何一个页面都跟着飘。
     * 只修这一处即可：所有关闭入口（取消按钮 / 遮罩 / B 键）都走这个函数。 */
    hideBagTip();
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
