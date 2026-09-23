/* ============================================================
 * ui/market/watch.js —— 市集「关注 / 收藏」+ 降价高亮
 * 职责（一件事）：把你盯上的**那一款**货记下来，出现更低价时把它标出来
 *
 * 关注的是「同款」而不是「这一单」：
 *   挂单会被买走、会下架，盯着某一条挂单毫无意义。所以键是"同款身份"：
 *     宠物 = 同进化线（血狐的各级形态算同一款）
 *     装备 = 部位 + 名称 + 底材T + 稀有度
 *     材料 = 材料名         宠物蛋 = 蛋品种
 *
 * 【血泪】降价只在**同收款材料**下才有意义：10 重铸石 ≠ 10 神圣石。
 *   关注的物品换了收款材料（卖家改价改成收别的），就不判降价，只显示已关注。
 *
 * 存哪：本地 localStorage（v2）。换设备 / 清缓存就没了 —— 这是与用户确认过的取舍
 *   （存云端要新建一张表 + 迁移脚本，为一个"锦上添花"的功能不值）。
 * v1 兼容：老键是 `pet_<宠物名>`，只在首次加载时搬一次，不丢玩家的老关注。
 * 依赖：MarketCalc（识别与同款分组）；无 DOM。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const Calc = window.MarketCalc;
  const KEY_V2 = 'market_watch_v2';
  const KEY_V1 = 'market_watch_v1';

  /* ---------- 读写 ---------- */
  function load() {
    let map = null;
    try { map = JSON.parse(localStorage.getItem(KEY_V2) || 'null'); } catch (e) { map = null; }
    if (map && typeof map === 'object') return map;
    map = {};
    // v1 → v2 单向搬家（键从 'pet_血狐' 变成 'pet:血狐'，并补上当时记的标价）
    try {
      const old = JSON.parse(localStorage.getItem(KEY_V1) || '{}') || {};
      Object.keys(old).forEach(k => {
        const name = k.indexOf('pet_') === 0 ? k.slice(4) : '';
        if (!name) return;
        const root = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(name) || name) : name;
        map['pet:' + root] = { kind: 'pet', label: name, price: Number(old[k]) || 0, material: '', at: Date.now() };
      });
    } catch (e) { /* 老存档坏了就算了：关注是锦上添花，不能因此报错 */ }
    return map;
  }
  function save(map) {
    try { localStorage.setItem(KEY_V2, JSON.stringify(map)); } catch (e) { /* 存不下就只在本次会话生效 */ }
  }

  let watches = load();

  /* ---------- 同款身份 ----------
   * 刻意不复用 MarketCalc.peerGroupKey：那个是**比价分组**（装备只按部位+稀有度，
   * 因为同部位同稀有度才算同类货），而"关注"盯着的是具体某一件东西，必须带名字。 */
  function watchKeyOf(l) {
    if (!l) return '';
    const kind = Calc.listingKind(l);
    if (kind === 'pet') {
      const nm = l.pet_name || '';
      const root = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(nm) || nm) : nm;
      return 'pet:' + root;
    }
    if (kind === 'item') {
      return 'item:' + [l.item_slot || '?', l.item_name || '?', l.item_tier || '?', l.item_rarity || '?'].join('|');
    }
    if (kind === 'material') return 'material:' + (l.good_name || '?');
    if (kind === 'egg') return 'egg:' + (l.egg_type || '?');
    return '';
  }

  function labelOf(l) {
    const kind = Calc.listingKind(l);
    if (kind === 'pet') return l.pet_name || '宠物';
    if (kind === 'item') return l.item_name || '装备';
    if (kind === 'material') return l.good_name || '材料';
    if (kind === 'egg') return window.Drop.makeEggName(l.egg_type);
    return '商品';
  }

  /* ---------- 查询 ---------- */
  function stateOf(l) {
    const k = watchKeyOf(l);
    if (!k || !watches[k]) return { watched: false, key: k, info: null };
    return { watched: true, key: k, info: watches[k] };
  }
  const isWatched = l => stateOf(l).watched;
  const count = () => Object.keys(watches).length;

  /* 降价判定：关注的同款、同收款材料、现在的标价比关注时更低。
   * 返回 null（没降价）或 { dropPct, was, now }。 */
  function hitOf(l) {
    const st = stateOf(l);
    if (!st.watched) return null;
    const info = st.info || {};
    const was = Number(info.price) || 0;
    const now = Number(l.material_qty) || 0;
    if (!was || !now) return null;
    // 换了收款材料就不可比（10 重铸石 ≠ 10 神圣石），不判降价
    if (info.material && l.material_type && info.material !== l.material_type) return null;
    if (now >= was) return null;
    return { dropPct: Math.round((was - now) / was * 100), was, now };
  }

  // 「降价」角标（卡片 / 列表行共用一套文案）
  function badgeHtml(l) {
    const hit = hitOf(l);
    if (!hit) return '';
    return '<span class="mk-watch-hit" title="关注时 ' + hit.was + '，现在 ' + hit.now + '">'
      + '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7 7 7-7"/></svg>'
      + '降价 ' + hit.dropPct + '%</span>';
  }

  // 星标按钮（四类都可用；以前只有宠物有，等于装备/材料/蛋的收藏需求被漏掉了）
  function starHtml(l) {
    const on = isWatched(l);
    return '<button type="button" class="mk-watch' + (on ? ' on' : '') + '" data-watch="1" '
      + 'title="' + (on ? '取消关注' : '关注这一款，出现更低价时高亮') + '" '
      + 'aria-pressed="' + on + '">' + (on ? '★' : '☆') + '</button>';
  }

  /* 切换关注。返回切换后的状态，供调用方决定提示文案。 */
  function toggle(l, flash) {
    const k = watchKeyOf(l);
    if (!k) return { ok: false, error: '这款商品不支持关注' };
    const on = !!watches[k];
    if (on) {
      delete watches[k];
      save(watches);
      if (flash) UI.showToast('已取消关注', labelOf(l));
      return { ok: true, watched: false };
    }
    watches[k] = {
      kind: Calc.listingKind(l),
      label: labelOf(l),
      price: Number(l.material_qty) || 0,   // 记下"关注时的价"，之后才有降价可比
      material: l.material_type || '',
      at: Date.now()
    };
    save(watches);
    const m = l.material_type ? ('，低于 ' + (Number(l.material_qty) || 0) + ' ' + l.material_type + ' 时高亮') : '';
    if (flash) UI.showToast('已关注', labelOf(l) + m);
    return { ok: true, watched: true };
  }

  /* 左侧筛选栏底部的一行说明（纯信息，**不是筛选条件** ——
   * 筛选维度必须和既有游戏一致，不因为做关注就多出一个筛选项）。 */
  function summaryHtml(pool) {
    const n = count();
    if (!n) return '';
    const drops = (pool || []).filter(l => hitOf(l)).length;
    return '<div class="mw-summary">已关注 <b>' + n + '</b> 款'
      + (drops ? '　·　其中 <b class="mw-summary-hit">' + drops + '</b> 款正在降价' : '')
      + '</div>';
  }

  /* 关注状态的紧凑指纹：给 index.js 的"没变就不重画"用（关注变了必须重画，
   * 否则点了☆星星不亮、降价角标不出现）。 */
  function signature() {
    return Object.keys(watches).sort()
      .map(k => k + '=' + (watches[k].price || 0) + '=' + (watches[k].material || ''))
      .join(',');
  }

  window.MarketWatch = {
    watchKeyOf, stateOf, isWatched, count, hitOf, badgeHtml, starHtml, toggle, summaryHtml, signature,
    clearAll: function () { watches = {}; save(watches); }
  };
})();
