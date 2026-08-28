/* ============================================================
 * market_bot.js —— 市场冷启动（流浪商人：假卖家补货 + 假买家收购）
 * 职责：
 *  A. 假卖家挂单：
 *    1. 每 Config.marketBot.intervalMs（默认 30 秒）自动上架 perTick（默认 5）件随机装备
 *    2. 当在售假货少于 minActive（默认 20）件时，自动补货到该数量
 *    3. 装备沿用现有词缀 / T 阶 / 稀有度规则（Equipment.generateEquipment + pickRarity）
 *    4. 价格按材料随机，小概率（leakChance）出现明显偏低的漏
 *  B. 假买家购买玩家挂单：
 *    1. 每 Config.marketBot.buyer.intervalMin~intervalMax（默认 40~90 秒）随机购买 1 件玩家挂单的装备
 *    2. 优先购买价格低于市场参考价（prices 对应档位上限）的挂单；无低价则买最便宜的
 *    3. 通过 bot_buy_equip RPC 完成（卖家收材料、写交易记录、装备行删除），买家记「流浪商人」
 *    4. 市场上没有玩家挂单则不购买
 * 纯前端策略层：假单只存前端内存（Market.botListings），不落库、不占玩家账号；
 * 假买家购买走云端 bot_buy_equip RPC（system RPC，非玩家账号操作）。
 * 依赖：equipment.js（Util / generateEquipment）、market.js、materials.js、supabase.js
 * 加载顺序：必须在 market.js 之后、ui 之前。
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const Market = window.Market;
  const Equipment = window.Equipment;
  const Materials = window.Materials;
  const Supabase = window.Supabase;
  const Pet = window.Pet;
  const { randInt, pickWeighted } = window.Util;

  const MB = Config.marketBot || {};
  const B = MB.buyer || {};
  let timer = null;
  let buyTimer = null;
  let botUid = 0;

  /* ---------- 定价：材料类型随机 + 数量范围随机；低价漏 = 该档最低价 × 折扣 ---------- */
  function rollPrice(rarityId) {
    const weights = MB.materialWeights || { reforge: 30, strip: 20, holy: 15, augment: 15, phoenix: 15 };
    const matId = pickWeighted(Config.trade.materials.map(m => ({ id: m.id, weight: weights[m.id] || 0 }))).id;
    const mat = Config.trade.materials.find(m => m.id === matId);
    const range = (MB.prices && MB.prices[matId] && MB.prices[matId][rarityId]) || [1, 3];
    const isLeak = Math.random() < (MB.leakChance || 0);
    // 漏：价格 = 该档最低价再打 leakDiscount 折（明显偏低的好货）
    const qty = isLeak
      ? Math.max(1, Math.floor(range[0] * (MB.leakDiscount || 0.5)))
      : randInt(range[0], range[1]);
    return { material_type: mat ? mat.name : matId, material_qty: qty, isLeak };
  }

  /* ---------- 生成一件假卖家装备挂单 ----------
   * 展示字段与真实挂单行（equip_listings）对齐，市场 UI 无需区分；额外带 isBot / seller / eq */
  function makeListing() {
    const rarity = Equipment.pickRarity(MB.rarityWeights || { white: 45, blue: 35, gold: 20 });
    const eq = Equipment.generateEquipment(rarity);
    const { material_type, material_qty, isLeak } = rollPrice(rarity.id);
    const id = 'bot-' + (++botUid);
    return {
      id,                    // 假单 id（购买用）
      isBot: true,           // 假卖家标记：UI 走 buyBotItem 分支
      isLeak,                // 低价漏标记：UI 显示「💎 捡漏」
      seller: MB.sellerName || '流浪商人',
      item_id: id,           // 虚拟 item id（永远不会命中「我的挂单」，isItemListed=false）
      item_name: eq.name, item_slot: eq.slot,
      item_rarity: rarity.id, item_tier: eq.tier,
      item_affixes: Equipment.flattenAffixes(eq.affixes),
      material_type, material_qty,
      eq                     // 完整装备对象：购买时直接入买家背包
    };
  }

  function restock(n) {
    for (let i = 0; i < n; i++) Market.addBotListing(makeListing());
  }

  /* ---------- 生成一件假卖家宠物挂单 ----------
   * 用 Pet.createBaby() 随机生成宠物（成长值、宠物池随机），标价按成长档位；
   * 展示字段与真实宠物挂单行对齐，购买时直接入买家宠物列表。 */
  function makePetListing() {
    const pet = Pet.createBaby();
    const matId = pickWeighted(Config.trade.materials.map(m => ({ id: m.id, weight: MB.materialWeights[m.id] || 0 }))).id;
    const mat = Config.trade.materials.find(m => m.id === matId);
    const highGrowth = pet.growth >= (MB.petHighGrowth || 12);
    const range = highGrowth ? (MB.petHighPrice || [6, 12]) : (MB.petLowPrice || [2, 5]);
    const qty = randInt(range[0], range[1]);
    const id = 'botp-' + (++botUid);
    return {
      id,                    // 假单 id（购买用）
      isBot: true,           // 假卖家标记：UI 走 buyBotPet 分支
      isLeak: false,
      seller: MB.sellerName || '流浪商人',
      pet_id: id,            // 虚拟 pet id（永远不会命中「我的挂单」，isListed=false）
      pet_name: pet.name, pet_growth: pet.growth, pet_level: pet.level,
      material_type: mat ? mat.name : matId, material_qty: qty,
      created_at: Date.now(),
      pet                    // 完整宠物对象：购买时直接入玩家列表
    };
  }
  function restockPets(n) {
    for (let i = 0; i < n; i++) Market.addBotPetListing(makePetListing());
  }

  /* ---------- 补货检查（每 intervalMs 执行一次） ----------
   * 规则1：每轮固定上架 perTick 件装备；
   * 规则5：在售假货少于 minActive 时，额外补货到该数量。
   * 宠物：每轮 petPerTick 只 + 少于 petMinActive 时补货（市场打开就有宠物可买）。 */
  function tick() {
    if (!MB.enabled) return;
    const current = Market.getBotListings().length;
    const target = Math.max(MB.perTick || 5, (MB.minActive || 20) - current);
    if (target > 0) restock(target);
    const currentPets = Market.getBotPetListings().length;
    const targetPets = Math.max(MB.petPerTick || 2, (MB.petMinActive || 10) - currentPets);
    if (targetPets > 0) restockPets(targetPets);
    // 只刷新市场区（不动我的上架/交易记录，避免打断正在展开的上架表单）
    if (window.UI && UI.renderMarket) UI.renderMarket();
  }

  /* ============================================================
   * 假买家（流浪商人）购买玩家挂单
   * ============================================================ */
  // 市场参考价（该档合理价上限）：config.marketBot.prices[材料id][稀有度][1]；查不到视为不设限
  function refPrice(listing) {
    const mat = Config.trade.materials.find(m => m.name === listing.material_type);
    if (!mat) return Infinity;
    const range = (MB.prices && MB.prices[mat.id] && MB.prices[mat.id][listing.item_rarity]) || null;
    return range ? range[1] : Infinity;
  }
  // 是否低于市场参考价（规则2：优先购买）
  const isCheap = l => l.material_qty <= refPrice(l);
  const isGoodPet = p => {
    const threshold = MB.petMinGrowth || 0;
    return Number(p.pet_growth || 0) >= threshold;
  };

  // 选择购买目标：优先低于参考价的装备；宠物则优先高成长
  function pickBuyTarget(listings) {
    const pets = listings.filter(l => l.kind === 'pet');
    const items = listings.filter(l => l.kind === 'item');
    if (pets.length) {
      const goodPets = pets.filter(isGoodPet);
      const pool = goodPets.length ? goodPets : pets;
      return pool.slice().sort((a, b) => b.pet_growth - a.pet_growth || a.material_qty - b.material_qty)[0];
    }
    const cheap = items.filter(isCheap);
    const pool = cheap.length ? cheap : items;
    return pool.slice().sort((a, b) => a.material_qty - b.material_qty)[0];
  }

  // 选择购买类型：先在装备/宠物中各取一个目标，再按优先级决定买谁
  function pickBuyCandidate(items, pets) {
    const itemTarget = items.length ? pickBuyTarget(items.map(x => ({ ...x, kind: 'item' }))) : null;
    const petTarget = pets.length ? pickBuyTarget(pets.map(x => ({ ...x, kind: 'pet' }))) : null;
    if (itemTarget && petTarget) {
      const itemCheap = isCheap(itemTarget);
      const petGood = isGoodPet(petTarget);
      if (itemCheap && !petGood) return itemTarget;
      if (!itemCheap && petGood) return petTarget;
      // 都满足 / 都不满足时，优先装备（与原规则“优先购买低于参考价的装备”一致）
      return itemCheap ? itemTarget : petTarget;
    }
    return itemTarget || petTarget;
  }

  // 执行一次假买家购买（规则1：随机买 1 件；规则5：无玩家挂单则不购买）
  // 只收购装备挂单（bot_buy_equip RPC 只支持装备；宠物挂单不收购）
  async function tryBuyOnce() {
    if (!MB.enabled || B.enabled === false) return { bought: false };
    const realItems = Market.getRealItemListings ? Market.getRealItemListings() : [];
    if (!realItems.length) return { bought: false };
    const target = pickBuyCandidate(realItems, []);
    if (!target) return { bought: false };
    const res = await Market.buyAsBotAny(target);
    if (!res.ok) return { bought: false, error: res.error };
    // 购买成功：刷新市场与交易记录（被买走的挂单消失、卖出记录出现）
    await Market.refresh();
    // 本机若是卖家（已登录）：同步云端材料，可即时看到材料到账
    const user = await Supabase.getCurrentUser();
    if (user) {
      const { data } = await Materials.loadCloudMaterials();
      if (data) Materials.setCloudMaterials(data);
    }
    // 购买通知 → 消息控制台（社交分类）：自己的挂单被买走高亮提示，别人的挂单只报市场动态
    if (window.UI && UI.consoleLog) {
      const nm = target.item_name || target.pet_name || '';
      const pay = (target.material_qty || 0) + ' ' + (target.material_type || '材料');
      if (user && target.seller_id === user.id) {
        UI.consoleLog('social', '🛒 你的 <b>' + nm + '</b> 被流浪商人买走了（收到 ' + pay + '）');
      } else {
        UI.consoleLog('social', '🛒 流浪商人购买了 <b>' + nm + '</b>（' + pay + '）');
      }
    }
    if (window.UI && UI.renderAll) UI.renderAll();
    return { bought: true, itemName: target.item_name || target.pet_name };
  }

  // 40~90 秒随机间隔调度（递归 setTimeout，每轮后重新抽间隔）
  function scheduleNextBuy() {
    if (buyTimer || !MB.enabled || B.enabled === false) return;
    const min = B.intervalMin || 40000, max = B.intervalMax || 90000;
    buyTimer = setTimeout(async () => {
      buyTimer = null;
      await tryBuyOnce();
      scheduleNextBuy();
    }, randInt(min, max));
  }

  /* ---------- 启停（main.js 初始化后调用） ---------- */
  function start() {
    if (timer || !MB.enabled) return;
    tick(); // 启动立即补货一次 → 市场打开不是空的
    timer = setInterval(tick, MB.intervalMs || 30000);
    scheduleNextBuy(); // 启动假买家收购（40~90 秒后第一单）
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (buyTimer) { clearTimeout(buyTimer); buyTimer = null; }
  }

  /* ---------- 对外 API ---------- */
  window.MarketBot = { start, stop, tick, getBotListings: () => (window.Market && window.Market.getBotListings ? window.Market.getBotListings() : []), tryBuyOnce, pickBuyTarget, pickBuyCandidate };
})();
