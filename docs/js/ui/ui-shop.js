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

  const cur = () => (Config.shop && Config.shop.currency) || '魔石';

  // 魔石系统总开关：Config.shop.enabled === false → 整条魔石线下线（界面隐藏 + 不打接口）
  const enabled = () => !(Config.shop && Config.shop.enabled === false);

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
      chip.innerHTML = `<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> ${wallet.gems} ${cur()}`;
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


    const goodsHtml = products.length
      ? products.map(p => `
        <div class="shop-card">
          <div class="shop-card-icon">${p.icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg>'}</div>
          <div class="shop-card-title">${escapeHtml(p.title)}</div>
          <div class="shop-card-desc">${escapeHtml(goodsDesc(p.payload))}</div>
          <div class="shop-card-price"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/></svg> ${p.price_gems}${p.price_cents ? ` <span class="shop-card-rmb">≈ ${(p.price_cents / 100).toFixed(0)} 元</span>` : ''}</div>
          <button class="btn-mini primary shop-buy" data-sku="${escapeHtml(p.sku)}" ${wallet.gems < p.price_gems ? 'disabled' : ''}>${wallet.gems < p.price_gems ? '魔石不足' : '购买'}</button>
        </div>`).join('')
      : '<div class="inv-empty">暂无商品</div>';

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
        <div class="shop-grid">${goodsHtml}</div>
      </div>

      <div class="panel">
        <div class="panel-title"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/></svg> 交易记录</div>
        ${ordersHtml}
      </div>`;

    bindShopActions();
  }

  /* 商品内容描述。两种 payload：
   *   materials = { 材料名: 数量 }  → 走 add_material 直发背包
   *   perks     = { listing_slots: N } → 走 user_perks，改的是市场挂单上限（便利类，不进战力）
   * ⚠️ 2026-09-12 拍板商店只卖便利不卖数值，所以 materials 类目后续不应再新增。 */
  function goodsDesc(payload) {
    const m = payload && payload.materials;
    if (m) return Object.keys(m).map(k => `${k} ×${m[k]}`).join('、');
    const pk = payload && payload.perks;
    if (pk && pk.listing_slots) {
      const owned = (Market && Market.getPerks && Market.getPerks().listingSlots) || 0;
      return `市场挂单上限永久 +${pk.listing_slots}${owned ? `（已拥有 +${owned}）` : ''}`;
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
  async function doBuy(sku) {
    const p = products.find(x => x.sku === sku);
    if (!p || buying) return;
    if (wallet.gems < p.price_gems) { showToast('❌ 魔石不足', `还差 ${p.price_gems - wallet.gems} ${cur()}`); return; }
    /* 幂等键：同一人 + 同一商品 + 同一【秒】只成一单。
     * ⚠️ 原来写的是 `${sku}-${Date.now()}` —— Date.now() 是**毫秒**，每次点击都是新键，
     * 注释里那句「连点不会重复扣」根本不成立（连点 N 次 = N 单 = 扣 N 份魔石）。 */
    const ref = `${sku}-${Math.floor(Date.now() / 1000)}`;
    buying = true;
    const r = await Supabase.spendGems(sku, ref).catch(e => ({ ok: false, message: (e && e.message) || '购买失败' }));
    buying = false;
    if (!r.ok) {
      const msg = r.code === 'insufficient' ? '魔石不足' : r.code === 'limit' ? '已达购买上限' : (r.message || '购买失败');
      showToast('❌ 购买失败', msg);
      return;
    }
    /* 发货落地：服务端已经把东西发出去了，这里只是把本地缓存拉到最新。
     *   materials 类 → 服务端 add_material 直发云端，本地要重拉材料表才看得到；
     *   perks 类     → 写的是 user_perks，要重拉 Market 的额度缓存，
     *                  否则挂单上限还停在旧值，玩家会以为「买了没生效」。 */
    const isPerk = !!(p.payload && p.payload.perks);
    if (p.payload && p.payload.materials) {
      const { data } = await Supabase.getClient().from('materials').select('name,quantity');
      if (data) Materials.setCloudMaterials(data);
    }
    if (isPerk && Market && Market.refreshPerks) await Market.refreshPerks();
    addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 购买 ${p.title}，花费 ${p.price_gems} ${cur()}`);
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg> 购买成功！', isPerk ? `${p.title} 已生效` : `${p.title} 已发到背包`);
    await Promise.all([refreshWallet(), refreshOrders()]);
    UI.renderAll();
  }

  /* ---------- 对外 API ---------- */
  UI.renderShop = renderShop;
  UI.refreshShop = refreshShop;
  UI.getGems = () => wallet.gems;
})();
