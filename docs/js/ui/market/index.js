/* ============================================================
 * ui/market/index.js —— 市集页（编排层）
 * 职责（一件事）：把这一页的**零件接起来**，自己不做细节
 *   左栏 = facets.js（级联筛选）  中栏 = cards.js（结果区）  右栏 = detail.js（详情）
 *   另：视图切换（全部在售 / 我的上架）、下单分发、工具条（列表/网格、批量购买）
 *
 * 页面结构（三栏）：筛选 | 结果 | 详情　—— 参考稿子的排版，
 *   但**全部逻辑按本游戏真实逻辑**：材料计价（不是魔石）、每满8收1的税、
 *   宠物/装备走确认弹窗、蛋/材料按既有习惯直接成交、旧版挂单不可购买。
 *
 * 零件清单（改这一页前先读对应文件，别在这一层塞细节）：
 *   facets.js  左侧级联筛选栏       cards.js   四类卡片 + 列表/网格 + 分页
 *   detail.js  右侧常驻详情栏       watch.js   关注 / 降价高亮
 *   batch.js   多件一起买           pricing.js 挂单口径与比价
 *
 * 依赖：market / pet / equipment（只读查询与流程接口）；工具来自 ui-common。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $, showToast, escapeHtml } = UI;
  const Config = window.Config;
  const Market = window.Market;
  const Materials = window.Materials;
  const Calc = window.MarketCalc;

  let marketView = 'all'; // 'all' 全部在售 | 'mine' 我的上架（并入市集）

  function setMarketView(v) {
    marketView = (v === 'mine') ? 'mine' : 'all';
    // 批量挑选只服务"全部在售"：切到我的上架时安静地退出（不触发二次渲染）
    if (marketView === 'mine' && window.MarketBatch && window.MarketBatch.isActive()) {
      window.MarketBatch.setActive(false, true);
    }
    MarketCards.resetPaging();
    UI.renderMarket();
  }

  /* ============================================================
   * 工具条：视图切换（全部/我的）+ 版式（列表/网格）+ 批量购买
   * ============================================================ */
  function renderToolbar() {
    const vtBox = $('viewToggle');
    if (vtBox) {
      Array.prototype.forEach.call(vtBox.querySelectorAll('.vt'), b => {
        const on = marketView === b.dataset.view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.onclick = () => setMarketView(b.dataset.view);
      });
    }
    const vmBox = $('viewMode');
    if (vmBox) {
      const mine = marketView === 'mine';
      vmBox.style.display = mine ? 'none' : '';   // 我的上架是"上架工作台"，版式切换对它没意义
      Array.prototype.forEach.call(vmBox.querySelectorAll('.vm'), b => {
        const on = MarketCards.getViewMode() === b.dataset.mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        b.onclick = () => { MarketCards.setViewMode(b.dataset.mode); MarketCards.resetPaging(); UI.renderMarket(); };
      });
    }
    const bt = $('batchToggle');
    if (bt) {
      const mine = marketView === 'mine';
      bt.style.display = mine ? 'none' : '';
      const on = window.MarketBatch.isActive();
      bt.classList.toggle('active', on);
      bt.setAttribute('aria-pressed', String(on));
      bt.textContent = on ? '退出批量' : '批量购买';
      bt.onclick = () => window.MarketBatch.setActive(!window.MarketBatch.isActive());
    }
  }

  /* ============================================================
   * 页面渲染
   * ============================================================ */
  let lastRenderSig = null;

  /* ---------- 「这一页看得见的东西没变，就别重画」 ----------
   * 🔴 为什么必须有：`main.js:810` 的**回血时钟每 1 秒**调一次 `renderAll()`，
   *   而 `renderAll` 里就有 `UI.renderMarket()`（ui-common.js:387）。
   *   以前这里每次都把结果区 + 右栏详情 + 结账条整块重建 ⇒ 每秒白重建几百个节点，
   *   悬浮详情 / 输入焦点被反复掐掉，左栏的入场动画也跟着每秒重播（看起来就是「一直在闪」）。
   * 签名必须覆盖**所有会影响显示的输入**：
   *   挂单池（id + 标价 + 卖家 + 数量）、视图（全部/我的）、版式、筛选、分页进度、
   *   批量勾选、关注状态、右栏选中项。
   * ⚠️ 以后往这一页加"会变的状态"，**必须同步加进这里**，否则界面会停在旧样子不刷新。 */
  function visibleSignature(pools) {
    const poolSig = arr => arr
      .map(l => Calc.listingKey(l) + '/' + (l.material_qty || 0) + '/' + (l.seller || '') + '/' + (l.good_qty || ''))
      .join(',');
    const me = (UI.getAuthUser && UI.getAuthUser()) || {};
    return [
      marketView,
      MarketCards.getViewMode(),
      String(me.id || ''),                  // 登录/登出会改变「我的」标记（材料挂单按 seller_id 判），必须进签名
      String(Market.getListedCount()),      // 我的挂单数（上架额度条）
      JSON.stringify(window.MarketFacets.filters()),
      MarketCards.pagingSignature(),
      window.MarketBatch.signature(),
      window.MarketWatch.signature(),
      window.MarketDetail.selectedKey() || '',
      /* ⛔「玩家自己的东西」（背包材料、宠物等级/成长）**不能**进签名：
       *    它们挂机时一直在变，一进签名就变成"每秒重画整页" = 把闪烁问题原样搬回来。
       *    右栏那个"我持有多少材料"改走 MarketDetail.refreshNumbers() 就地刷；
       *    「我的上架」视图则干脆不跳过（见下面的 skippable）。 */
      pools.map(poolSig).join('|')
    ].join('§');
  }

  function renderMarket(force) {
    if (window.Tips) window.Tips.show('market_watch', '★ 关注与批量买', '点卡片上的☆关注这一款（降价会高亮）；点「批量购买」可勾选多件一起结账');

    const box = $('market-list');
    if (!box) return;

    const facets = window.MarketFacets;
    const petPool = Market.getListings();
    const itemPool = Market.getItemListings();
    const eggPool = Market.getEggListings ? Market.getEggListings() : [];
    const matPool = Market.getMaterialListings ? Market.getMaterialListings() : [];
    const allPool = [...petPool, ...itemPool, ...matPool, ...eggPool];

    /* 签名没变且容器里还有东西 → 不重建 DOM。
     * `!children.length` 是兜底：万一 DOM 被外部清空，签名没变也得补回来。
     * ⚠️「不重建」不等于「什么都不做」：下面两件便宜的事仍要跑（就地改，不动结构）。
     * 🔴 只有「全部在售」可以跳过：「我的上架」是上架工作台，列的是玩家自己的宠物/装备/材料
     *    （等级、成长、可交易数量都在实时变），把它漏掉的代价是"界面停在旧数字"；
     *    而它没有任何入场动画、本来就不会闪，所以那个视图保持改版前每秒刷新的节奏。 */
    const skippable = (marketView === 'all');
    const sig = visibleSignature([petPool, itemPool, matPool, eggPool]);
    if (skippable && !force && sig === lastRenderSig && box.children && box.children.length) {
      window.MarketCards.paintSellerTags(false);   // 补画还没上色的卖家名牌（吃缓存，不打接口）
      window.MarketDetail.refreshNumbers();        // 右栏"我持有多少材料"要跟上挂机掉落
      return;
    }
    lastRenderSig = sig;

    // 筛选栏先画：左栏是筛选项，它要先于结果出现（玩家改筛选时的心理顺序）
    facets.render(allPool);
    renderToolbar();

    if (marketView === 'mine') {
      const cnt = $('rpCount');
      if (cnt) cnt.textContent = '';
      box.innerHTML = '';
      if (UI.renderSellArea) UI.renderSellArea(box);
      else box.innerHTML = '<div class="mk-empty">上架功能未加载</div>';
      const barMine = $('mk-batch-bar');
      if (barMine) { barMine.innerHTML = ''; barMine.style.display = 'none'; }
      window.MarketDetail.render([]);
      return;
    }

    /* 全部在售：宠物 / 装备 / 材料 / 宠物蛋。
     * 四类挂单都过**同一套筛选**（材料与蛋以前完全不筛：关键词、价格区间对它们无效）。
     * pool = 未筛选的原池，用来算「同类在售中位价」——样本不该被当前筛选砍掉。 */
    const pets = facets.sort(petPool.filter(facets.match)).filter(l => l.pet_id);
    const items = facets.sort(itemPool.filter(facets.match));
    const mats = facets.sort(matPool.filter(facets.match));
    const eggs = facets.sort(eggPool.filter(facets.match));

    window.MarketBatch.setPool(allPool);
    const total = window.MarketCards.renderResults(box, [
      { key: 'pet', title: PET_ICON + ' 宠物', list: pets, pool: petPool },
      { key: 'item', title: ITEM_ICON + ' 装备', list: items, pool: itemPool },
      { key: 'material', title: MAT_ICON + ' 材料', list: mats, pool: matPool },
      { key: 'egg', title: EGG_ICON + ' 宠物蛋', list: eggs, pool: eggPool },
    ]);

    const cnt = $('rpCount');
    if (cnt) cnt.textContent = '共 ' + total + ' 件';
    window.MarketBatch.renderBar();
    // 没选中时右栏默认摊开"屏幕上第一条"（筛选后不会讲屏幕上没有的东西）
    const firstShown = pets[0] || items[0] || mats[0] || eggs[0] || null;
    window.MarketDetail.render(allPool, firstShown);
    window.MarketCards.paintSellerTags(true);   // 名片渲染完再补卖家名牌（见 cards.js 注释；true = 取一份新的）
  }

  /* ============================================================
   * 下单分发
   * ============================================================ */
  /* 「购买/取回」按钮的统一下游。卡片、右侧详情栏、批量结账三处都走这里，
   * 保证三条入口的语义永远一致（以前只有卡片一条路，加个入口就容易漏掉某个分支）。 */
  async function onBuyClick(listing, btn) {
    const kind = Calc.listingKind(listing);
    if (MarketCards.isMine(kind, listing)) return recall(listing, btn);
    if (!listing.material_type) { showToast('无法购买', '这是旧版价格挂单，请联系卖家重新上架'); return; }
    if (!UI.isLoggedIn()) { showToast('需要登录', '登录后才能购买'); return; }
    if (kind === 'pet' || kind === 'item') { openBuyConfirm(kind, listing); return; }
    // 蛋 / 材料：沿用既有习惯（点了就成交），改成弹窗会改变玩家的老手感
    return directBuy(listing, btn);
  }

  async function recall(listing, btn) {
    const kind = Calc.listingKind(listing);
    const name = MarketCards.modelOf(listing, []).name;
    const doIt = async () => {
      const res = await (kind === 'pet' ? Market.cancelPet(listing.id)
        : kind === 'item' ? Market.cancelItem(listing.id)
          : kind === 'egg' ? Market.cancelEgg(listing.id)
            : Market.cancelMaterial(listing.id)) || { error: '请稍候再试' };
      if (res.error) { showToast('取回失败', res.error); return { error: res.error }; }
      showToast('已取回', name + ' 已下架，回到你的背包 / 宠物栏');
      UI.renderAll();
      return { ok: true };
    };
    // 取回也要给按钮上锁：连点会发两次撤单，第二次必然失败并弹一个看不懂的错
    return btn ? UI.runWithLoading(btn, '取回中…', doIt) : doIt();
  }

  /* 真正成交一笔（批量结账也复用它）。
   * 返回 { ok:true } 或 { error }；本地材料同步在这里做，调用方不用记。 */
  async function buyListing(listing) {
    const kind = Calc.listingKind(listing);
    let res;
    if (kind === 'pet') res = listing.isBot ? await Market.buyBotPet(listing.id) : await Market.buy(listing.id);
    else if (kind === 'item') res = listing.isBot ? await Market.buyBotItem(listing.id) : await Market.buyItem(listing.id);
    else if (kind === 'egg') res = listing.isBot ? await Market.buyBotEgg(listing.id) : await Market.buyEgg(listing.id);
    else res = listing.isBot ? await Market.buyBotMaterial(listing.id) : await Market.buyMaterial(listing.id);
    if (res && res.error) return { error: res.error };

    /* 本地材料同步：真实单云端已扣/已发，本地跟着改；AI 假单在自己内部已处理。
     * ⚠️ 只改本地数字，绝不在这里"发奖" —— 服务器是唯一的模拟器。 */
    if (!listing.isBot) {
      if (listing.material_type) Materials.spendLocal(listing.material_type, listing.material_qty || 0);
      if (kind === 'material') Materials.gainLocal(listing.good_name, Number(listing.good_qty || 1));
    }
    // 宠物 / 装备买下后要从云端单条拉回来补齐本地（假单已直接入列，不用拉）
    const Game = window.Game;
    if (!listing.isBot && Game) {
      if (kind === 'pet' && Game.afterBuyPet) await Game.afterBuyPet(res.petId);
      else if (kind === 'item' && Game.afterBuyItem) await Game.afterBuyItem(res.itemId);
    }
    return res || { ok: true };
  }

  function kindName(listing) {
    const kind = Calc.listingKind(listing);
    if (kind === 'pet') return listing.pet_name;
    if (kind === 'item') return listing.item_name;
    if (kind === 'egg') return window.Drop.makeEggName(listing.egg_type);
    return listing.good_name + ' ×' + Number(listing.good_qty || 1);
  }

  /* 蛋 / 材料：点了就成交（沿用既有习惯）。
   * btn 传了就给按钮上锁 + 载入态，防止连点下两次单。 */
  async function directBuy(listing, btn) {
    const run = async () => {
      const res = await buyListing(listing);
      if (res.error) { showToast('购买失败', res.error); return; }
      showToast('购买成功', kindName(listing) + ' 已送入你的背包');
      UI.renderAll();
    };
    const res = btn ? await UI.runWithLoading(btn, '购买中…', run) : await run();
    return res;
  }

  /* ---------- 购买确认框（宠物 / 装备）----------
   * 显示：商品价格 / 交易税 / 买家需支付 / 卖家将收到。
   * 蛋和材料不走这里（见 onBuyClick 的取舍说明）。 */
  function openBuyConfirm(kind, l) {
    const mat = Market.findMaterial(l.material_type);
    const qty = l.material_qty || 0;
    const tax = Market.calcTax(qty);
    const net = Market.calcNet(qty);
    const isPet = kind === 'pet';
    const itemTitle = isPet ? (l.pet_name + '（成长' + l.pet_growth + ' · Lv.' + l.pet_level + '）') : l.item_name;
    const body = $('trade-body');
    body.innerHTML =
      '<div class="buy-confirm-item">商品：<b>' + escapeHtml(itemTitle) + '</b></div>'
      + '<div class="buy-confirm-row">商品价格：<b>' + qty + ' ' + mat.icon + ' ' + mat.name + '</b></div>'
      + '<div class="buy-confirm-row">交易税：<b>' + tax + ' ' + mat.name + '</b>'
      + '<span class="hint">每满 ' + Config.trade.taxPer + ' 收 ' + Config.trade.taxAmount + '，不满不收</span></div>'
      + '<div class="buy-confirm-row">买家需支付：<b>' + qty + ' ' + mat.name + '</b></div>'
      + '<div class="buy-confirm-row">卖家将收到：<b>' + net + ' ' + mat.name + '</b></div>'
      + (tax > 0 ? '<div class="hint">税由卖家承担，从标价中扣除</div>' : '')
      + '<div class="buy-confirm-mine">我的 ' + mat.name + '：<b>' + Materials.getQuantity(mat.name) + '</b></div>';
    $('trade-modal').style.display = 'flex';
    // 等待期间弹窗保留在屏幕上（按钮变「购买中…」），比关掉弹窗干等好得多：
    // 关掉后玩家只能盯着市集页发呆，1~2 秒里完全不知道进行到哪一步。
    $('trade-ok').onclick = () => UI.runWithLoading($('trade-ok'), '购买中…', async () => {
      const res = await buyListing(l);
      if (res.error) {
        showToast('购买失败', res.error);
        /* 🔴 就地反馈（2026-09-21 内测清单「购买失败没反应」的真因）：showToast 只写进
         * 消息中心（底部聊天弹窗 / 内嵌 console），而市集页**没有**内嵌 console ——
         * 玩家正盯着购买弹窗，错误却记在别处 = 感知上就是"没反应"。
         * 失败原因必须直接写在弹窗里（弹窗本来就开着、失败保留不关）；消息中心那份保留，供事后回看。
         * textContent 而非 innerHTML：res.error 可能含服务端原文，不当 HTML 拼。 */
        const line = document.createElement('div');
        line.className = 'warn buy-confirm-error';
        line.textContent = '购买失败：' + (typeof res.error === 'string' ? res.error : '未知错误，请稍后再试');
        const old = body.querySelector('.buy-confirm-error');
        if (old) old.replaceWith(line); else body.appendChild(line);
        return;   // 失败保留弹窗：让玩家看清商品再重试
      }
      showToast('购买成功！', isPet ? (l.pet_name + ' 已加入你的宠物列表') : (l.item_name + ' 已加入你的背包'));
      UI.renderAll();
      $('trade-modal').style.display = 'none'; // 成功才关
    });
    $('trade-cancel').onclick = () => { $('trade-modal').style.display = 'none'; };
  }
  function closeBuyPanel() { $('trade-modal').style.display = 'none'; }

  /* ---------- 兼容旧接口 ----------
   * 装备页等处以前会调 UI.renderItemMarket(容器)；市集已改成一屏四类混排，
   * 这里保留成"只画装备"的薄壳，避免旧调用方直接报错。 */
  function renderItemMarket(container) {
    const box = container || $('market-items');
    if (!box) return;
    const facets = window.MarketFacets;
    const list = facets.sort(Market.getItemListings().filter(facets.match));
    if (!list.length) { box.innerHTML = '<div class="mk-empty">没有符合条件的装备</div>'; return; }
    window.MarketCards.renderResults(box, [{ key: 'item', title: ITEM_ICON + ' 装备', list: list, pool: Market.getItemListings() }]);
  }

  /* ============================================================
   * 分区小图标（原来是内联在标题里的 svg，抽成常量免得在拼接里读不清）
   * ============================================================ */
  const PET_ICON = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 8.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"/><path d="M18.8 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 13.2c-3 0-4.8 1.7-4.8 3.9 0 2.4 1.8 4.4 4.8 4.4s4.8-2 4.8-4.4c0-2.2-1.8-3.9-4.8-3.9z"/></svg>';
  const ITEM_ICON = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>';
  const MAT_ICON = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>';
  const EGG_ICON = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg>';

  /* ---------- 对外 API ---------- */
  UI.renderMarket = renderMarket;
  UI.setMarketView = setMarketView;
  UI.getMarketView = function () { return marketView; };
  UI.renderItemMarket = renderItemMarket;
  UI.openBuyConfirm = openBuyConfirm;
  UI.closeBuyPanel = closeBuyPanel;

  /* 跨模块用的那一份（卡片 / 详情 / 批量都从这里下单，别各自调数据层） */
  window.MarketPage = { renderMarket, setMarketView, onBuyClick, buyListing, openBuyConfirm, closeBuyPanel };
  // 注：renderSellArea / renderTradeRecords / openSellForItem 由 sell.js 与 records.js 各自导出。
})();
