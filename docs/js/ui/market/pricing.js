/* ============================================================
 * ui/market/pricing.js —— 市集挂单的「口径」与「比价」（不画界面）
 * 职责（一件事）：说清一条挂单**是什么**、**值多少钱**、**挂了多久**
 *   1. 识别：类型（宠物 / 装备 / 材料 / 宠物蛋）、上架时间、搜索文本
 *   2. 比价：同类 + 同收款材料的标价中位数 → 参考价 → 捡漏 / 高于市价标签
 *   3. 时效：挂单时长文案
 *
 * 为什么要单独一个文件：卡片、右侧详情栏、上架弹窗（查价）三处都要用**同一套口径**。
 *   以前这套算法和卡片渲染挤在同一个文件里，只想改比价却要动整个市集页。
 *
 * 【血泪】同组比价必须**同收款材料**：10 重铸石 ≠ 10 神圣石，跨材料不可比。
 * 【血泪】挂单只存 seller_id，没有卖家昵称 —— 昵称是服务端 join 出来的，
 *   本地拼不出来，所以这里绝不"造"一个卖家名（名牌由 cards.js 渲染后另补）。
 * 依赖：Config（稀有度 / 税率 / 参考价阈值）与 Pet（进化线归并）；**无 DOM**。
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;

  /* ---------- 挂单识别 ----------
   * 一张挂单只属于一类。之前只判 pet_id / item_id，材料与蛋在「全部」里能看见、
   * 却筛不出来也搜不到（2026-09-10 修）。 */
  function listingKind(l) {
    if (!l) return 'unknown';
    // 真实材料挂单没有 good_id / kind（那是 AI 假单的字段），靠 good_name 认；
    // 漏了这条会归到 unknown，结果就是「筛材料时真实单全被过滤掉」。
    if (l.good_name || l.good_id || l.kind === 'material') return 'material';
    if (l.egg_type || l.kind === 'egg') return 'egg';
    if (l.pet_id) return 'pet';
    if (l.item_id) return 'item';
    return 'unknown';
  }
  const KIND_LABEL = { pet: '宠物', item: '装备', material: '材料', egg: '宠物蛋' };

  /* 一条挂单在本次会话里的唯一标识（批量挑选 / 右侧详情沿用同一个 key）。
   * 只认 id：真实挂单是 uuid、AI 假单是内存 id，前面缀类型防跨类撞号。 */
  function listingKey(l) {
    return l && l.id != null ? listingKind(l) + ':' + l.id : '';
  }

  // 上架时间（不同来源字段名不一致，统一在这里兜）
  function getListingTime(listing) {
    return listing.created_at || listing.createdAt || listing.createdAtMs || listing.updated_at || 0;
  }

  // 搜索文本：名称 + 词缀 + 特质名（参考 POE 交易站的词缀搜索、火炬的条件组搜索）
  function listingHaystack(l) {
    const parts = [l.item_name, l.pet_name, l.good_name, l.egg_type,
      l.egg_type ? window.Drop.makeEggName(l.egg_type) : ''];
    for (const a of window.Equipment.flattenAffixes(l.item_affixes || l.affixes || [])) parts.push(a.label || a.type);
    if (l.item_soul) parts.push(l.item_soul.label);
    for (const t of (l.pet_traits || [])) {
      parts.push(t && t.id);
      const cfg = t && Config.petTraits && Config.petTraits[t.id];
      if (cfg && cfg.label) parts.push(cfg.label);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /* ---------- 比价分组 ----------
   * 「同类」= 同款宠（同进化线）/ 同部位同稀有度装备 / 同一种材料 / 同品种蛋。
   * ⚠️ 分组键**不含**收款材料，因为调用方还要再按 material_type 过滤一次（见 refQty）。 */
  function peerGroupKey(l) {
    const kind = listingKind(l);
    if (kind === 'item') return 'item:' + (l.item_slot || '?') + ':' + (l.item_rarity || '?');
    if (kind === 'pet') {
      const nm = l.pet_name || '';
      const root = (window.Pet && window.Pet.resolveLineId) ? (window.Pet.resolveLineId(nm) || nm) : nm;
      return 'pet:' + root;
    }
    if (kind === 'material') return 'material:' + (l.good_id || l.good_name || '?');
    if (kind === 'egg') return 'egg:' + (l.egg_type || '?');
    return 'other';
  }

  function medianQty(list, keyOf) {
    // keyOf 可选：传了就按它取值（成长中位复用同一份算法，不另写一份）
    const vals = list.map(l => Number((keyOf ? keyOf(l) : l.material_qty) || 0)).filter(v => v > 0).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  // 同组同收款材料的标价中位数（样本不足返回 null）
  function refQty(l, pool) {
    const T = Config.trade || {};
    const key = peerGroupKey(l);
    const peers = (pool || []).filter(x => x !== l && x.material_type === l.material_type && peerGroupKey(x) === key);
    if (peers.length < (T.refPriceMinSamples || 3)) return null;
    return medianQty(peers);
  }

  // 捡漏 / 比价标签（市场捡漏 = 三爽点之一，AI 的 isLeak 标记也在这里落地）
  function dealBadge(l, pool) {
    if (l.isLeak) return '<span class="mk-deal mk-deal--leak"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/></svg> 捡漏</span>';
    const ref = refQty(l, pool);
    const q = Number(l.material_qty || 0);
    if (!ref || !q) return '';
    const T = Config.trade || {};
    const diff = (ref - q) / ref;
    if (diff >= (T.dealDiscount || 0.2)) return `<span class="mk-deal">低于市价 ${Math.round(diff * 100)}%</span>`;
    if (diff <= -(T.overpriceMarkup || 0.25)) return `<span class="mk-deal mk-deal--high">高于市价 ${Math.round(-diff * 100)}%</span>`;
    return '';
  }

  // 挂单挂了多久（POE / 火炬都要看时效，我们只展示不强制下架）
  function ageLabel(l) {
    const t = new Date(getListingTime(l)).getTime();
    if (!t) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时前';
    return Math.floor(hours / 24) + ' 天前';
  }

  /* ---------- 查价（上架弹窗 / 右侧详情栏共用） ----------
   * 造一条"假挂单"去复用同一套比价口径：这样查价和卡片用的是同一份算法。 */
  function pseudoListing(kind, payload, matName) {
    if (kind === 'pet') return { pet_id: 'ref', pet_name: payload.name, material_type: matName, material_qty: 0 };
    if (kind === 'item') return { item_id: 'ref', item_slot: payload.slot, item_rarity: (payload.rarity && payload.rarity.id) || payload.rarity, material_type: matName, material_qty: 0 };
    if (kind === 'egg') return { egg_type: payload, material_type: matName, material_qty: 0 };
    return { good_id: payload, material_type: matName, material_qty: 0 };
  }
  function marketRefPrice(kind, payload, matName) {
    if (!matName) return null;
    const Market = window.Market;
    const pool = kind === 'pet' ? Market.getListings()
      : kind === 'item' ? Market.getItemListings()
        : kind === 'egg' ? (Market.getEggListings ? Market.getEggListings() : [])
          : (Market.getBotMaterialListings ? Market.getBotMaterialListings() : []);
    const pseudo = pseudoListing(kind, payload, matName);
    const key = peerGroupKey(pseudo);
    const peers = (pool || []).filter(x => x.material_type === matName && peerGroupKey(x) === key);
    const min = Number((Config.trade && Config.trade.refPriceMinSamples) || 3);
    if (peers.length < min) return { median: null, samples: peers.length };
    return { median: medianQty(peers), samples: peers.length };
  }

  window.MarketCalc = {
    listingKind, KIND_LABEL, listingKey, getListingTime, listingHaystack,
    peerGroupKey, medianQty, refQty, dealBadge, ageLabel, pseudoListing, marketRefPrice
  };

  /* ---------- 对外 API ---------- */
  const UI = window.UI;
  if (UI) {
    UI.ageLabel = ageLabel;              // 挂单时长：市集页与「我的上架」共用同一份口径，别各写各的
    UI.marketRefPrice = marketRefPrice;  // 上架弹窗查价
  }
})();
