/* ============================================================
 * ui/market/batch.js —— 市集「多件一起买」
 * 职责（一件事）：把勾中的几条挂单一次结掉
 *
 * ⚠️ 为什么不做「只买一部分」（他挂 50 个、我买 10 个）：
 *   服务端 buy_material / buy_egg 只收「挂单号」，没有"买几个"这个参数 ——
 *   要支持部分购买就得改表（挂单记剩余量）+ 价格与税按比例算 + 新迁移脚本。
 *   与用户确认过：**不碰数据库**，改成"多件一起结账"（勾中几条一起买）。
 *
 * 两条硬规矩：
 *   ① **按最便宜的先行**：材料是有限资源，中途不足时"先买到的是最划算的"。
 *   ② **如实报告，绝不假装成功**：逐笔调接口，第一笔失败就停下，
 *      已成交的那几笔**不退**（钱货两清，服务端已经落库），必须明确告诉玩家
 *      "买到 N 件、第 N+1 件失败、原因是什么"。绝不吞掉失败当成全成功。
 *
 * 依赖：MarketPage（下单分发）/ MarketCalc（识别与合计口径）；无直接数据层调用。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $, showToast, escapeHtml } = UI;
  const Calc = window.MarketCalc;

  let active = false;                 // 批量挑选模式开着没有
  let picked = [];                    // 选中的挂单 key（数组而非 Set：要保序，便于按价重排）
  let pool = [];                      // 当前在售全集，用来把 key 还原成挂单
  let running = false;                // 结账进行中（防连点重复下单）

  const setPool = p => { if (p) pool = p; };
  const isActive = () => active;
  const size = () => picked.length;
  const has = key => picked.indexOf(key) >= 0;
  const list = () => picked.slice();

  /* quiet = true 时只改状态不重渲染 —— 给 setMarketView 在"切页时顺手退出批量"用，
   * 否则会多触发一次整页渲染（那一帧的中间态还会闪一下）。 */
  function setActive(on, quiet) {
    active = !!on;
    if (!active) picked = [];
    if (!quiet) UI.renderMarket();
  }

  function toggle(key) {
    if (!key) return;
    const i = picked.indexOf(key);
    if (i >= 0) picked.splice(i, 1); else picked.push(key);
    renderBar();
  }
  function clear() { picked = []; renderBar(); }

  // key → 挂单（挂单被买走/下架后自然解析不出来，自动从选中里剔除）
  function items() {
    return picked.map(k => pool.find(x => Calc.listingKey(x) === k)).filter(Boolean);
  }

  /* 合计：**按收款材料分别合计**，不做跨材料折价。
   * 10 重铸石和 10 剥离石不是一回事，加在一起报一个数字就是骗玩家。 */
  function summary() {
    const its = items();
    const by = {};
    its.forEach(l => {
      const name = l.material_type || '未知';
      by[name] = (by[name] || 0) + (Number(l.material_qty) || 0);
    });
    return {
      count: its.length,
      items: its,
      byMaterial: Object.keys(by).map(name => ({ name, qty: by[name], mat: window.Market.findMaterial(name) }))
    };
  }

  function matsHtml(s) {
    return s.byMaterial.map(g => '<b>' + g.qty + '</b> ' + escapeHtml(g.name)).join(' · ');
  }

  /* ---------- 结账条（结果区底部吸底；不在批量模式时整条不出现） ---------- */
  function renderBar() {
    const bar = $('mk-batch-bar');
    if (!bar) return;
    if (!active) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    const s = summary();
    if (!s.count) {
      bar.innerHTML = '<div class="mk-batch-inner"><span class="mk-batch-hint">'
        + '勾选左侧商品，可跨类型多件一起结账（按最便宜的先行）</span>'
        + '<button type="button" class="fs-btn fs-btn--ghost" data-batch-exit="1">退出批量</button></div>';
    } else {
      bar.innerHTML = '<div class="mk-batch-inner">'
        + '<span class="mk-batch-cnt">已选 <b>' + s.count + '</b> 件</span>'
        + '<span class="mk-batch-mats">合计 ' + matsHtml(s) + '</span>'
        + '<button type="button" class="fs-btn fs-btn--ghost" data-batch-clear="1"' + (running ? ' disabled' : '') + '>清空</button>'
        + '<button type="button" class="fs-btn fs-btn--primary" data-batch-go="1"' + (running ? ' disabled' : '') + '>'
        + (running ? '结账中…' : '一起结账') + '</button>'
        + '</div>';
    }
    const exit = bar.querySelector('[data-batch-exit]');
    if (exit) exit.onclick = () => setActive(false);
    const clr = bar.querySelector('[data-batch-clear]');
    if (clr) clr.onclick = clear;
    const go = bar.querySelector('[data-batch-go]');
    if (go) go.onclick = confirmThenCheckout;
  }

  /* ---------- 结账 ---------- */
  function confirmThenCheckout() {
    if (running) return;
    const s = summary();
    if (!s.count) { showToast('还没选东西', '先勾选要买的商品'); return; }
    if (!UI.isLoggedIn()) { showToast('需要登录', '登录后才能购买'); return; }
    if (s.count === 1) {   // 只有一件：走单品那条路（宠物/装备会弹原有的确认框）
      window.MarketPage.onBuyClick(s.items[0]);
      return;
    }
    const lines = s.items
      .slice()
      .sort((a, b) => Number(a.material_qty || 0) - Number(b.material_qty || 0))
      .map(l => {
        const kind = Calc.listingKind(l);
        const nm = kind === 'pet' ? l.pet_name : kind === 'item' ? l.item_name
          : kind === 'egg' ? window.Drop.makeEggName(l.egg_type) : (l.good_name + ' ×' + Number(l.good_qty || 1));
        return '· ' + escapeHtml(nm || '商品') + '　<b>' + Number(l.material_qty || 0) + '</b> ' + escapeHtml(l.material_type || '');
      }).join('<br>');
    const text = '将买下 <b>' + s.count + '</b> 件：<br>' + lines
      + '<br><br>合计需付　' + matsHtml(s)
      + '<br><span class="hint">按最便宜的先行逐笔成交。中途某笔失败会立刻停下，'
      + '<b>已成交的那几笔不会退回</b>（钱货已两清）。</span>';
    if (!UI.showDialog) { doCheckout(); return; }
    UI.showDialog({
      speaker: '市集',
      text: text,
      buttons: [
        { label: '再想想' },
        { label: '确认一起买', onClick: doCheckout }
      ]
    });
  }

  async function doCheckout() {
    if (running) return;
    const s = summary();
    if (!s.count) return;
    // 便宜的先行：材料有限时，先买到的最划算
    const queue = s.items.slice().sort((a, b) => Number(a.material_qty || 0) - Number(b.material_qty || 0));
    running = true;
    renderBar();

    let done = 0;
    let failed = null;
    for (const l of queue) {
      // 逐笔 await：不并发。并发下服务端扣材料的顺序不可控，一旦中途不足，
      // 玩家看到的是"随机哪几笔成了"，而串行至少保证"总是先买到便宜的"。
      const res = await window.MarketPage.buyListing(l);
      if (res && res.error) { failed = { listing: l, error: res.error }; break; }
      done++;
    }

    running = false;
    // 成交的从选中里摘掉；失败的留着，玩家可以直接重试
    const okKeys = queue.slice(0, done).map(l => Calc.listingKey(l));
    picked = picked.filter(k => okKeys.indexOf(k) < 0);
    UI.renderMarket();

    if (!failed) {
      showToast('一起买成功', '共买到 ' + done + ' 件，已送入你的背包 / 宠物栏');
      return;
    }
    const failedName = (function () {
      const l = failed.listing;
      const kind = Calc.listingKind(l);
      return kind === 'pet' ? l.pet_name : kind === 'item' ? l.item_name
        : kind === 'egg' ? window.Drop.makeEggName(l.egg_type) : l.good_name;
    })();
    const msg = done > 0
      ? '已买到 ' + done + ' 件；第 ' + (done + 1) + ' 件「' + failedName + '」失败：' + failed.error
      : '第 1 件「' + failedName + '」失败：' + failed.error;
    if (UI.showDialog) UI.showDialog({ speaker: '市集', type: 'error', text: escapeHtml(msg) + '<br><span class="hint">失败的这件仍留在选中里，可以再试；已成交的不退。</span>' });
    else showToast('部分失败', msg);
  }

  /* 批量状态的紧凑指纹：给 index.js 的"没变就不重画"用
   * （开/关、勾了哪几件都会改变画面，必须进签名）。 */
  const signature = () => (active ? '1:' : '0:') + picked.join(',');

  window.MarketBatch = {
    isActive, setActive, toggle, has, list, size, setPool, items, summary, renderBar, clear, signature,
    _checkout: doCheckout   // 守值测试入口（跳过确认弹窗）
  };
})();
