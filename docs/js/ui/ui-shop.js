/* ============================================================
 * ui/ui-shop.js —— 魔石充值 + 商店页
 * 职责：
 *  1. 显示魔石余额（顶栏 + 页头）
 *  2. 魔石来源：自测阶段由管理员 grant_gems 发放（或内部卡密兑换）。
 *     ⚠️ 2026-08-31 用户拍板：不做个人收款码/私下转账，界面上不得出现任何引导付款的内容；
 *        正式收款要接官方支付 SDK（需企业主体 + 版号等资质），到那时再回来做支付入口。
 *  3. 商店：用魔石买便利类权益（服务端定价，前端只展示）
 *     ⚠️ 2026-09-12 拍板：只卖便利，不卖数值。payload 两种——
 *        materials（材料，后续不再新增）/ perks（权益，如市场挂单额度加成）。
 * 安全边界：余额与价格都在服务端（wallets / products 表 + redeem_code / spend_gems 函数），
 *   前端改 JS 改不了价格和余额；这里只负责发请求和把结果讲清楚。
 * 依赖：config.js（文案与收款信息）、supabase.js（钱包/商品接口）、ui-common.js
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;
  const Config = window.Config;
  const Supabase = window.Supabase;
  const Materials = window.Materials;
  const Market = window.Market;

  // 高频 renderAll 只重绘界面，网络数据缓存在这里，避免每次刷新都打一次接口
  let wallet = { gems: 0, totalRecharged: 0, missing: false };
  let products = [];
  let orders = [];
  let shopMissing = false; // 表/函数没建 → 提示"未开通"而不是崩
  let goodsLoaded = false; // 商品是否已拉回来：区分「正在读」和「真的没货」（以前两者都写"暂无商品"）

  const cur = () => (Config.shop && Config.shop.currency) || '魔石';

  // 魔石系统总开关：Config.shop.enabled === false → 整条魔石线下线（界面隐藏 + 不打接口）
  const enabled = () => !(Config.shop && Config.shop.enabled === false);

  /* 权益缓存刷新：挂单额度 / 背包容量 / 育兽栏位 / 名牌都读同一份（Supabase.perksCache）。
   * 走 Market.refreshPerks 是因为历史上它是那个口；Supabase.refreshPerks 是同一份数据的另一入口。 */
  const refreshPerksCache = async () => {
    if (Market && Market.refreshPerks) { await Market.refreshPerks(); return; }
    if (Supabase && Supabase.refreshPerks) await Supabase.refreshPerks();
  };

  // 开关 → 界面可见性。renderShop 每次 renderAll 都会走，状态不会漂移；
  // 用 inline display（不是 hidden 属性）：.tab-page.active / .sb-btn 的 display 规则会盖掉 [hidden]。
  function applyVisibility() {
    const on = enabled();
    const set = (el, show) => { if (el) el.style.display = show ? '' : 'none'; };
    set($('gem-balance'), on && !shopMissing);
    document.querySelectorAll('[data-page="shop"]').forEach(b => set(b, on));
    set($('tab-shop'), on);
    // 关掉后若正停在商店页（hash 直达 / 旧收藏链接），退回主城，否则会整页空白
    if (!on && UI.switchPage) {
      const shopPage = $('tab-shop');
      if (shopPage && shopPage.classList.contains('active')) UI.switchPage('capital');
    }
  }

  /* ---------- 拉取（登录时、买完后各调一次） ---------- */
  async function refreshShop() {
    applyVisibility();
    if (!enabled()) return;
    await Promise.all([refreshWallet(), refreshProducts(), refreshOrders()]);
  }
  async function refreshWallet() {
    const w = await Supabase.getMyWallet();
    wallet = { gems: w.gems || 0, totalRecharged: w.totalRecharged || 0, missing: !!w.missing };
    shopMissing = shopMissing || !!w.missing;
    renderGemChip();
    renderShop();
  }
  async function refreshProducts() {
    const p = await Supabase.fetchProducts();
    products = (p.data || []).filter(x => x.kind !== 'recharge'); // 充值档位不进商店列表，走收款码
    shopMissing = shopMissing || !!p.missing;
    goodsLoaded = true;
    renderShop();
  }
  async function refreshOrders() {
    const o = await Supabase.fetchMyOrders();
    orders = o.data || [];
    renderShop();
  }
  /* ---------- 顶栏余额 ---------- */
  function renderGemChip() {
    const chip = $('gem-balance');
    if (chip) {
      chip.innerHTML = `<img class="top-ico" src="assets/ui/nav/ic_top_gem.png" alt=""> ${wallet.gems} ${cur()}`;
      chip.title = `魔石余额 ${wallet.gems} · 累计充值 ${wallet.totalRecharged}`;
    }
    applyVisibility();
  }

  /* ---------- 页面渲染 ---------- */
  function renderShop() {
    applyVisibility();
    const root = $('shop-root');
    if (!root) return;
    if (!enabled()) { root.innerHTML = ''; return; }
    if (shopMissing) {
      root.innerHTML = `<div class="shop-missing">
        <div class="shop-missing-title"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> 魔石商店尚未开通</div>
        <div>需要先在 Supabase 执行 <b>docs/supabase/migrate_shop.sql</b>（建钱包 / 商品 / 卡密表与四个函数），刷新页面后即可使用。</div>
      </div>`;
      return;
    }


    /* 限购状态：服务端才是权威（spend_gems 会挡），这里只是把「还剩几次」提前告诉玩家。
     * 以前 select 漏了 limit_per_user，前端对限购一无所知，玩家点下去才被弹「已达购买上限」。 */
    function boughtCount(sku) {
      return orders.filter(o => o.sku === sku && o.status === 'delivered').length;
    }
    const GEM_SVG = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg>';
    /* 单张商品卡。名牌卡不是「购买 / 已达上限」，而是三态：
     *   未解锁 → 购买；已解锁未戴 → 使用；正在戴 → 使用中（禁用）。
     * 为什么名牌单独一条按钮逻辑：它不限购（可以买到别的档、也能摘下来再戴回来），
     * 用「限购次数」那套表达不出来 —— 重复购买由服务端返回 owned 挡住。 */
    function cardHtml(p) {
      const bought = boughtCount(p.sku);
      const lim = p.limit_per_user || 0;
      const soldOut = lim > 0 && bought >= lim;
      const poor = wallet.gems < p.price_gems;
      const st = tagState(p);
      let btn;
      if (st && st.active) {
        btn = '<button class="btn-mini shop-tag-on" disabled>使用中</button>';
      } else if (st && st.unlocked) {
        btn = `<button class="btn-mini primary shop-use" data-tag="${escapeHtml(st.key)}">使用</button>`;
      } else {
        const btnText = soldOut ? '已达上限' : poor ? '魔石不足' : '购买';
        btn = `<button class="btn-mini primary shop-buy" data-sku="${escapeHtml(p.sku)}" ${(soldOut || poor) ? 'disabled' : ''}>${btnText}</button>`;
      }
      return `
        <div class="shop-card">
          <div class="shop-card-icon">${p.icon || GEM_SVG}</div>
          <div class="shop-card-title">${escapeHtml(p.title)}</div>
          <div class="shop-card-desc">${escapeHtml(goodsDesc(p))}</div>
          ${lim > 0 ? `<div class="shop-card-limit">限购 ${lim} 次 · 已买 ${bought}</div>` : ''}
          <div class="shop-card-price">${GEM_SVG} ${p.price_gems}${p.price_cents ? ` <span class="shop-card-rmb">≈ ${(p.price_cents / 100).toFixed(0)} 元</span>` : ''}</div>
          ${btn}
        </div>`;
    }

    /* 三排货架（空排不渲染，免得出现一个空标题）。
     * 商品全空时才显示「暂无商品」；还在读显示「正在读取商品…」——
     * 这两句以前是同一句，玩家分不清"没货"和"还没拉回来"。 */
    const goodsHtml = products.length
      ? SHELVES.map(s => {
        const list = products.filter(p => shelfOf(p) === s.id);
        if (!list.length) return '';
        return `
        <div class="shop-shelf">
          <div class="shop-shelf-head">${escapeHtml(s.title)}${s.note ? `<span class="hint">${escapeHtml(s.note)}</span>` : ''}</div>
          <div class="shop-grid">${list.map(cardHtml).join('')}</div>
        </div>`;
      }).join('')
      : (goodsLoaded
        ? '<div class="inv-empty">暂无商品</div>'
        : '<div class="inv-empty">正在读取商品…</div>');

    const ordersHtml = orders.length
      ? orders.slice(0, 8).map(o => `<div class="shop-order">${escapeHtml(orderTitle(o))} · ${escapeHtml(String(o.created_at || '').slice(0, 10))}</div>`).join('')
      : '<div class="hint">还没有交易记录</div>';

    root.innerHTML = `
      <div class="shop-head">
        <div class="shop-balance"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> <b>${wallet.gems}</b> ${cur()}</div>
        <div class="hint">累计获得 ${wallet.totalRecharged} ${cur()}（自测阶段由管理员发放）</div>
      </div>

      <div class="panel">
        <div class="panel-title"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> 魔石来源<span class="hint">自测阶段，不对外收费</span></div>
        <div class="shop-pay-note">${escapeHtml(Config.shop.selfTestNote || '')}</div>
        <div class="shop-redeem">
          <input id="shop-code" class="shop-code-input" placeholder="卡密（内部测试用）" autocomplete="off">
          <button class="btn-mini primary" id="btn-redeem">兑换</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 魔石商店<span class="hint">只卖便利，不影响战力</span></div>
        <div class="shop-shelves">${goodsHtml}</div>
      </div>

      <div class="panel">
        <div class="panel-title"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/></svg> 交易记录</div>
        ${ordersHtml}
      </div>`;

    bindShopActions();
  }

  /* 商品内容描述。三种 payload：
   *   materials  = { 材料名: 数量 } → 走 add_material 直发背包
   *   perks      = { 权益键: 数量 } → 走 user_perks（便利类，不进战力）：
   *                listing_slots 挂单额度 / inventory_slots 背包装备位 / pet_slots 育兽栏位
   *   cosmetics  = { unlock_tag: key } → 流光名牌（买下永久解锁 + 自动戴上，可随时切换）
   * ⚠️ 2026-09-12 拍板商店只卖便利不卖数值，所以 materials 类目后续不应再新增。
   * 2026-09-16：从"只认挂单额度"改成按权益键查表 —— 以后加便利权益只需动这张表。
   * 2026-09-20：加名牌。名牌的颜色与流光全在 game.css（这里只说一句效果，不写色值）。 */
  const PERK_LABEL = {
    listing_slots: '市场挂单上限',
    inventory_slots: '背包装备位',
    pet_slots: '育兽栏位'
  };
  const perks = () => (Supabase && Supabase.getPerksCache) ? Supabase.getPerksCache() : {};
  const tagDefs = () => (Config.shop && Config.shop.nameTags) || {};

  /* 货架分组：**由 payload 推导，不写 sku 名单**。
   * 写名单 = 第二份真源，以后加商品必然漏改一处（项目已因「两份名单」栽过）。
   *   名牌（cosmetics）  → 名牌排
   *   多项权益的打包      → 礼包排
   *   单项权益 / 材料     → 扩容排
   * 认不出的形态一律归扩容排：宁可排得朴素，也不能让新商品在商店里凭空消失。 */
  const SHELVES = [
    { id: 'capacity', title: '扩容', note: (Config.shop && Config.shop.shelves && Config.shop.shelves.capacity) || '' },
    { id: 'bundle', title: '礼包', note: (Config.shop && Config.shop.shelves && Config.shop.shelves.bundle) || '' },
    { id: 'tag', title: '名牌', note: (Config.shop && Config.shop.shelves && Config.shop.shelves.tag) || '' }
  ];
  function shelfOf(p) {
    const pl = (p && p.payload) || {};
    if (pl.cosmetics) return 'tag';
    return Object.keys(pl.perks || {}).length > 1 ? 'bundle' : 'capacity';
  }

  /* 名牌卡的三种状态：未解锁（购买）/ 已解锁未戴（使用）/ 正在戴（使用中）。
   * 真源是服务端 user_perks（name_tags 已解锁集合 + name_tag 当前佩戴），这里只读缓存。 */
  function tagState(p) {
    const key = p && p.payload && p.payload.cosmetics && p.payload.cosmetics.unlock_tag;
    if (!key) return null;
    const own = perks();
    return {
      key,
      unlocked: Array.isArray(own.name_tags) && own.name_tags.indexOf(key) >= 0,
      active: own.name_tag === key
    };
  }

  function goodsDesc(p) {
    const pl = (p && p.payload) || {};
    if (pl.cosmetics && pl.cosmetics.unlock_tag) {
      const def = tagDefs()[pl.cosmetics.unlock_tag] || {};
      return `名字永久解锁${def.effect ? '（' + def.effect + '）' : ''}，可随时切换`;
    }
    const m = pl.materials;
    if (m) return Object.keys(m).map(k => `${k} ×${m[k]}`).join('、');
    const pk = pl.perks;
    if (pk) {
      const cache = perks();
      const parts = Object.keys(PERK_LABEL)
        .filter(k => Number(pk[k]) > 0)
        .map(k => {
          const owned = Number(cache[k] || 0);
          return `${PERK_LABEL[k]}永久 +${pk[k]}${owned ? `（已拥有 +${owned}）` : ''}`;
        });
      if (parts.length) return parts.join('、');
    }
    return '';
  }
  function orderTitle(o) {
    if (o.provider === 'redeem') return `卡密充值 +${o.gems}`;
    const p = products.find(x => x.sku === o.sku);
    return (p && p.title) || o.sku;
  }

  /* ---------- 交互 ---------- */
  function bindShopActions() {
    const btn = $('btn-redeem');
    const input = $('shop-code');
    if (btn) btn.onclick = () => doRedeem((input && input.value) || '');
    if (input) input.onkeydown = e => { if (e.key === 'Enter') doRedeem(input.value); };
    document.querySelectorAll('.shop-buy').forEach(b => {
      b.onclick = () => doBuy(b.dataset.sku);
    });
    document.querySelectorAll('.shop-use').forEach(b => {
      b.onclick = () => doUseTag(b.dataset.tag);
    });
  }

  async function doRedeem(code) {
    if (!code || !code.trim()) { showToast('❌ 请输入卡密', '卡密不能为空'); return; }
    const r = await Supabase.redeemCode(code);
    const msg = (Config.shop && Config.shop.redeemMessages && Config.shop.redeemMessages[r.code]) || r.message || '兑换失败';
    if (!r.ok) { showToast('❌ 兑换失败', msg); return; }
    const input = $('shop-code');
    if (input) input.value = '';
    addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> 充值成功，到账 ${r.gained} ${cur()}`);
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> 充值成功！', `到账 ${r.gained} ${cur()}`);
    await refreshWallet();
    await refreshOrders();
    UI.renderAll();
  }

  let buying = false; // 购买闸门：spendGems 是一次云端往返，期间连点会重复扣魔石
  let usingTag = false; // 换名牌同理：一次云端往返，连点会打出多个请求

  /* 换名牌：只把 key 交给服务端，由服务端校验「这一档你有没有解锁」。
   * ⚠️ 这里**故意不做本地先行**：名牌是给别人看的，本地先戴上、云端没戴上的话，
   *    玩家会以为自己换了，而聊天/市集里别人看到的还是旧的 —— 这种「看起来成功」最难查。 */
  async function doUseTag(tag) {
    if (!tag || usingTag) return;
    usingTag = true;
    const r = await Supabase.setMyNameTag(tag).catch(() => ({ ok: false, code: 'error' }));
    usingTag = false;
    if (!r.ok) {
      const msg = r.code === 'notowned' ? '这一档还没有解锁'
        : r.code === 'nologin' ? '请先登录再切换'
        : '切换失败，稍后再试';
      showToast('❌ 名牌切换失败', msg);
      return;
    }
    await refreshPerksCache();
    UI.renderAll();
    // 聊天里**已经显示出来的**老消息也得换色：名字颜色是渲染那一刻写死的（见 ui-console 的 repaintConsole）
    if (UI.repaintConsole) UI.repaintConsole();
    showToast('名牌已更换', '聊天、市集、排行榜上都会显示');
  }
  /* 购买中的按钮反馈（2026-09-17）：闸门只挡住了重复扣款，但按钮既不变字也不禁用，
   * 云端往返这一秒里玩家看到的还是「购买」，会以为没点着然后狂点。 */
  function setBuyingVisual(sku, on) {
    document.querySelectorAll('.shop-buy').forEach(b => {
      if (sku && b.dataset.sku !== sku) return;
      b.disabled = on;
      if (on) { b.dataset.oldText = b.dataset.oldText || b.textContent; b.textContent = '购买中…'; }
      else if (b.dataset.oldText) { b.textContent = b.dataset.oldText; delete b.dataset.oldText; }
    });
  }
  async function doBuy(sku) {
    const p = products.find(x => x.sku === sku);
    if (!p || buying) return;
    if (wallet.gems < p.price_gems) { showToast('❌ 魔石不足', `还差 ${p.price_gems - wallet.gems} ${cur()}`); return; }
    /* 幂等键：同一人 + 同一商品 + 同一【秒】只成一单。
     * ⚠️ 原来写的是 `${sku}-${Date.now()}` —— Date.now() 是**毫秒**，每次点击都是新键，
     * 注释里那句「连点不会重复扣」根本不成立（连点 N 次 = N 单 = 扣 N 份魔石）。 */
    const ref = `${sku}-${Math.floor(Date.now() / 1000)}`;
    buying = true;
    setBuyingVisual(sku, true);
    const r = await Supabase.spendGems(sku, ref).catch(e => ({ ok: false, message: (e && e.message) || '购买失败' }));
    buying = false;
    /* 'owned' =「你已经拥有这件名牌」，服务端**一分钱都没扣**（判定在扣款之前）。
     * 它既不是成功购买也不是失败：按钮要放回来，提示要讲人话，
     * 否则玩家看到"购买失败"会以为钱丢了。 */
    if (r.code === 'owned') {
      setBuyingVisual(sku, false);
      showToast('已拥有这件名牌', '不用重复买，直接点「使用」即可');
      await refreshPerksCache();
      renderShop();
      return;
    }
    if (!r.ok) {
      const msg = r.code === 'insufficient' ? '魔石不足' : r.code === 'limit' ? '已达购买上限' : (r.message || '购买失败');
      showToast('❌ 购买失败', msg);
      setBuyingVisual(sku, false); // 失败要把按钮从「购买中…」放回来
      return;
    }
    /* 发货落地：服务端已经把东西发出去了，这里只是把本地缓存拉到最新。
     *   materials 类 → 服务端 add_material 直发云端，本地要重拉材料表才看得到；
     *   perks 类     → 写的是 user_perks，要重拉 Market 的额度缓存，
     *                  否则挂单上限还停在旧值，玩家会以为「买了没生效」。 */
    const isPerk = !!(p.payload && p.payload.perks);
    const isTag = !!(p.payload && p.payload.cosmetics);
    if (p.payload && p.payload.materials) {
      /* ⚠️ 必须带 bound_qty：少这一列，setCloudMaterials 会当成"这些材料全不绑定"，
       * 把本地绑定数整体清零 —— 玩家在商店买一次东西，背包里的「绑定」堆就集体消失。
       * （2026-09-16 查出来的连带 bug；materials.js 的 loadCloudMaterials 已经带上了。） */
      const { data } = await Supabase.getClient().from('materials').select('name,quantity,bound_qty');
      if (data) Materials.setCloudMaterials(data);
    }
    // 名牌也走这一口：买下后 name_tag 变了，商店卡片要在「使用中 / 使用」之间跟着变
    if ((isPerk || isTag) && Market && Market.refreshPerks) await Market.refreshPerks();
    addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 购买 ${p.title}，花费 ${p.price_gems} ${cur()}`);
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 购买成功！', isTag ? `${p.title} 已生效，名字已带上` : isPerk ? `${p.title} 已生效` : `${p.title} 已发到背包`);
    await Promise.all([refreshWallet(), refreshOrders()]);
    UI.renderAll();
    // 名牌是"买下即戴上" ⇒ 聊天里已显示的名字也要一起换色（同 doUseTag）
    if (isTag && UI.repaintConsole) UI.repaintConsole();
  }

  /* ---------- 对外 API ---------- */
  UI.renderShop = renderShop;
  UI.refreshShop = refreshShop;
  UI.getGems = () => wallet.gems;
})();
