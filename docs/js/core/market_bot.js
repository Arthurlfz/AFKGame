/* ============================================================
 * market_bot.js —— AI 玩家 persona 经济（20 个参数化 AI，替代单一"流浪商人"）
 * 职责：
 *  A. 生成 20 个 AI 玩家 persona（昵称不标 AI、等级档定产出图档、流派定需求/定价偏好）
 *  B. 假卖家挂单：每个 persona 按自己的图档范围产出真实掉落（dry），定价带
 *     流派口味 × 个人波动 ±jitter × 挂漏，卖家显示 persona 昵称 → 市场是一群"真人"
 *  C. 假买家购买玩家挂单：随机 persona 出手，按流派口味 + 合理价挑目标，
 *     小概率买贵（overpay）、部分耐心等低价（patient）；买入 80% 消耗离场（sink），
 *     20% 降价再挂 → 防刷材料漏洞 + 不堆库存
 * 纯前端策略层：假单只存前端内存（Market.botListings 等），不落库、不占玩家账号；
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
  const Drop = window.Drop;
  const EnemyData = window.EnemyData;
  const Util = window.Util;
  const { randInt, randFloat, pickWeighted } = window.Util;

  const MB = Config.marketBot || {};
  const B = MB.buyer || {};
  const P = MB.personas || {};
  const BH = P.behavior || {};
  let timer = null;
  let buyTimer = null;
  let botUid = 0;

  /* ============================================================
   * A. AI 玩家 persona 生成（20 个）
   * ============================================================ */
  let personas = [];
  let rr = 0; // 轮换取货游标（restock 摊派到不同 persona）

  function makeNickname() {
    const nk = (Config.auth && Config.auth.nickname) || {};
    const pre = nk.prefixes || ['灰烬', '腐叶', '白骨', '暗影', '血月'];
    const suf = nk.suffixes || ['行者', '术士', '游侠', '猎手'];
    return Util.pick(pre) + Util.pick(suf) + String(Math.floor(1000 + Math.random() * 9000));
  }

  // 生成 count 个 persona：昵称不重名；等级档（定图档范围）+ 流派（定需求/定价偏好）按分布抽
  function generatePersonas() {
    const count = P.count || 20;
    const tiers = P.levelTiers || [{ tier: '新手', pct: 100, areaMin: 1, areaMax: 4 }];
    const styles = P.playstyles || [];
    const init = (P.wallet && P.wallet.init) || {};
    const income = (P.wallet && P.wallet.incomePerTick) || {};
    const used = {};
    personas = [];
    for (let i = 0; i < count; i++) {
      let nick = makeNickname();
      while (used[nick]) nick = makeNickname();
      used[nick] = true;
      const tierObj = pickWeighted(tiers.map(t => ({ ...t, weight: t.pct || 0 })));
      const styleObj = styles.length
        ? pickWeighted(styles.map(s => ({ ...s, weight: s.pct || 0 })))
        : { id: 'dps', label: '输出', bloodlineBias: [], statPriorities: [] };
      const wallet = {};
      for (const k in init) wallet[k] = (init[k] || 0) + (i % 3); // 起始材料每人略有差异
      personas.push({
        id: 'p' + (i + 1),
        nickname: nick,
        tier: tierObj.tier,
        areaMin: tierObj.areaMin || 1,
        areaMax: tierObj.areaMax || 4,
        playstyle: styleObj,
        wallet,           // 阶段1 仅装饰性状态；阶段2 服务端接真实钱包（自平衡：卖入-买出）
        incomePerTick: income,
        leaks: Math.random() < (BH.leakChance || 0.05),     // 易挂漏（不识货）
        overpay: Math.random() < (BH.overpayChance || 0.03),// 易买贵（冲动）
        patient: Math.random() < (BH.patienceRate || 0.2),  // 耐心：只等低价
        listedCount: 0
      });
    }
  }
  // 轮换取货：下一个 persona（restock 摊派用，保证每个 AI 都挂单）
  function nextPersona() {
    if (!personas.length) generatePersonas();
    const p = personas[rr % personas.length];
    rr = (rr + 1) % Math.max(1, personas.length);
    return p;
  }
  // 随机取一个 persona（购买时用）
  function randomPersona() {
    if (!personas.length) generatePersonas();
    return personas.length ? Util.pick(personas) : null;
  }

  /* ---------- 流派对一件装备的"口味"：词缀命中 statPriorities → 越想要（定价更高/优先买） ---------- */
  function gearAffinity(eq, persona) {
    const prio = (persona && persona.playstyle && persona.playstyle.statPriorities) || [];
    if (!prio.length) return 1;
    let affs = [];
    if (eq && eq.affixes) affs = Equipment.flattenAffixes(eq.affixes);
    else if (Array.isArray(eq)) affs = eq; // 真实挂单只有 item_affixes 扁平数组
    let score = 0;
    for (const a of affs) {
      if (a && a.type && prio.indexOf(a.type) >= 0) score += Math.max(1, 5 - (Number(a.tier) || 3)); // T1=4分 … T4=1分
    }
    return 1 + 0.05 * score; // 最高 ~1.6（全 T1 命中优先级词缀）
  }

  /* ============================================================
   * B. 假卖家挂单（persona 驱动）
   * ============================================================ */
  /* ---------- 定价 ----------
   * 价 = 图档基数(basePerTier^(areaTier-1)) × 稀有度乘数 × 材料系数 × 流派口味 × 个人波动(1±jitter)。
   * 低价漏 = 下限再打折（容易挂漏的 persona 概率翻倍、稳妥 persona 减半）。 */
  function rollPrice(rarityId, areaTier, affinity, persona) {
    const weights = MB.materialWeights || { reforge: 30, strip: 20, holy: 15, augment: 15, phoenix: 15 };
    const matId = pickWeighted(Config.trade.materials.map(m => ({ id: m.id, weight: weights[m.id] || 0 }))).id;
    const mat = Config.trade.materials.find(m => m.id === matId);
    const PG = MB.priceGradient || {};
    const tier = Math.max(1, areaTier || 1);
    let mult = (affinity || 1);
    // 个人波动只在有 persona 时生效（无 persona 的直测/纯定价保持确定性）
    if (persona && (BH.priceJitter || 0)) mult *= (1 + (Math.random() * 2 - 1) * (BH.priceJitter || 0));
    const base = Math.pow(PG.basePerTier || 1.5, tier - 1)
      * ((PG.rarityMult && PG.rarityMult[rarityId]) || 1)
      * ((PG.materialMult && PG.materialMult[matId]) || 1)
      * mult;
    const lo = Math.max(1, Math.round(base * 0.8));
    const hi = Math.max(lo, Math.round(base * 1.2));
    const leakRate = persona
      ? (persona.leaks ? (MB.leakChance || 0.05) * 2 : (MB.leakChance || 0.05) * 0.5)
      : (MB.leakChance || 0);
    const isLeak = Math.random() < leakRate;
    const qty = isLeak ? Math.max(1, Math.floor(lo * (MB.leakDiscount || 0.5))) : randInt(lo, hi);
    return { material_type: mat ? mat.name : matId, material_qty: qty, isLeak };
  }

  /* ---------- persona 按自己的等级档抽挂机图（决定产出图档与掉落谱系） ---------- */
  function pickArea(persona) {
    const areas = Config.battle.areas || [];
    const lo = Math.max(1, (persona && persona.areaMin) || 1);
    const hi = Math.min(areas.length, (persona && persona.areaMax) || areas.length);
    const w = MB.areaWeight || {};
    const pool = [];
    for (let t = lo; t <= hi; t++) {
      const area = areas[t - 1];
      if (area) pool.push({ area, weight: (w && w[t]) || 1 });
    }
    return pool.length ? pickWeighted(pool).area : areas[0];
  }
  function pickEnemyFor(area) {
    const list = (EnemyData && EnemyData.list) || [];
    const ids = (area && area.enemyIds) || [];
    const pool = ids.map(id => list.find(e => e.id === id)).filter(Boolean);
    return pool.length ? Util.pick(pool) : null;
  }
  async function aiDrop(persona) {
    const area = pickArea(persona);
    const enemy = pickEnemyFor(area);
    const result = await Drop.rollReward(enemy, area, { dry: true });
    return { area, result };
  }

  /* ---------- 生成一件 AI 装备挂单（persona 身份 + 真实掉落 + 流派定价） ---------- */
  async function makeListing(persona) {
    const ps = persona || nextPersona();
    const { area, result } = await aiDrop(ps);
    if (!result || result.type !== 'equipment') return null; // 掉到材料/蛋/空车：不上架（restock 会重滚）
    const eq = result.eq;    // 真实掉落：图档定稀有度/底材T，带未鉴定态
    eq.identified = true;    // AI 已鉴定的货：市场直接显示词缀
    const areaList = Config.battle.areas || [];
    const areaTier = Math.max(1, areaList.findIndex(a => a.id === area.id) + 1);
    const aff = gearAffinity(eq, ps); // 流派口味：命中它要的词缀 → 定价更高
    const { material_type, material_qty, isLeak } = rollPrice(eq.rarity.id, areaTier, aff, ps);
    const id = 'bot-' + (++botUid);
    ps.listedCount++;
    return {
      id,                    // 假单 id（购买用）
      isBot: true,           // 假卖家标记：UI 走 buyBotItem 分支
      isLeak,                // 低价漏标记：UI 显示「💎 捡漏」
      seller: ps.nickname,   // 卖家显示 = persona 昵称（不标 AI）
      personaId: ps.id,
      item_id: id,           // 虚拟 item id（永不命中「我的挂单」）
      item_name: eq.name, item_slot: eq.slot,
      item_rarity: eq.rarity.id, item_tier: eq.tier,
      item_affixes: Equipment.flattenAffixes(eq.affixes),
      material_type, material_qty,
      eq                     // 完整装备对象：购买时直接入买家背包
    };
  }

  async function restock(n) {
    let made = 0, tries = 0;
    const cap = Math.max(n * 8, n * 150); // 单池装备率 1.5%，重滚上限按期望放大
    while (made < n && tries < cap) {
      tries++;
      const l = await makeListing();
      if (l) { Market.addBotListing(l); made++; }
    }
  }

  /* ---------- 生成一件 AI 宠物挂单（persona 身份） ---------- */
  function makePetListing(persona) {
    const ps = persona || nextPersona();
    const pet = Pet.createBaby();
    const matId = pickWeighted(Config.trade.materials.map(m => ({ id: m.id, weight: MB.materialWeights[m.id] || 0 }))).id;
    const mat = Config.trade.materials.find(m => m.id === matId);
    // 婴儿成长 3~8：高成长（≥7，约前 20%）才走高档价（旧 12 永不触发 → 宠物恒低价）
    const highGrowth = pet.growth >= (MB.petHighGrowth || 7);
    const range = highGrowth ? (MB.petHighPrice || [6, 12]) : (MB.petLowPrice || [2, 5]);
    const qty = randInt(range[0], range[1]);
    const id = 'botp-' + (++botUid);
    return {
      id, isBot: true, isLeak: false,
      seller: ps.nickname, personaId: ps.id,
      pet_id: id,
      pet_name: pet.name, pet_growth: pet.growth, pet_level: pet.level,
      material_type: mat ? mat.name : matId, material_qty: qty,
      created_at: Date.now(),
      pet
    };
  }
  function restockPets(n) {
    for (let i = 0; i < n; i++) Market.addBotPetListing(makePetListing());
  }

  /* ---------- AI 上架材料 + 宠物蛋（persona 身份） ---------- */
  function makeMaterialListing(persona) {
    const ps = persona || nextPersona();
    const G = MB.botGoods || {};
    const sellWeights = G.materialSellWeights || {};
    const entries = Object.keys(G.materials || {}).map(id => ({ id, weight: sellWeights[id] || 5 })).filter(e => {
      const c = (G.materials || {})[e.id];
      return c && c.pay;
    });
    if (!entries.length) return null;
    const soldId = pickWeighted(entries).id;
    const soldMat = Config.trade.materials.find(m => m.id === soldId);
    const cfg = G.materials[soldId];
    const payMat = Config.trade.materials.find(m => m.id === cfg.pay);
    if (!soldMat || !payMat) return null;
    const payQty = randInt(cfg.qty[0], cfg.qty[1]);
    const id = 'botm-' + (++botUid);
    return {
      id, isBot: true, isLeak: false, seller: ps.nickname, personaId: ps.id,
      kind: 'material', good_id: soldMat.id, good_name: soldMat.name, good_qty: 1, good_icon: soldMat.icon || '📦',
      material_type: payMat.name, material_qty: payQty
    };
  }
  function makeEggListing(persona) {
    const ps = persona || nextPersona();
    const G = MB.botGoods || {};
    const starters = (Config.pet && Config.pet.starters) || [];
    if (!starters.length) return null;
    const base = Util.pick(starters);
    const cfg = G.eggPrice || { pay: 'reforge', qty: [1, 4] };
    const payMat = Config.trade.materials.find(m => m.id === cfg.pay);
    if (!payMat) return null;
    const payQty = randInt(cfg.qty[0], cfg.qty[1]);
    const id = 'bote-' + (++botUid);
    return {
      id, isBot: true, isLeak: false, seller: ps.nickname, personaId: ps.id,
      kind: 'egg', egg_type: base.name, egg_icon: base.icon || '🥚',
      material_type: payMat.name, material_qty: payQty
    };
  }
  function restockMaterials(n) {
    for (let i = 0; i < n; i++) {
      const l = makeMaterialListing();
      if (l) Market.addBotMaterialListing(l);
    }
  }
  function restockEggs(n) {
    for (let i = 0; i < n; i++) {
      const l = makeEggListing();
      if (l) Market.addBotEggListing(l);
    }
  }

  /* ---------- 补货检查（每 intervalMs 执行一次） ---------- */
  async function tick() {
    if (!MB.enabled) return;
    const current = Market.getBotListings().length;
    const target = Math.max(MB.perTick || 5, (MB.minActive || 20) - current);
    if (target > 0) await restock(target);
    const currentPets = Market.getBotPetListings().length;
    const targetPets = Math.max(MB.petPerTick || 2, (MB.petMinActive || 10) - currentPets);
    if (targetPets > 0) restockPets(targetPets);
    const curMat = (Market.getBotMaterialListings ? Market.getBotMaterialListings() : []).length;
    const tarMat = Math.max(MB.perTick || 5, (MB.minMaterial || 8) - curMat);
    if (tarMat > 0) restockMaterials(tarMat);
    const curEgg = (Market.getBotEggListings ? Market.getBotEggListings() : []).length;
    const tarEgg = Math.max(MB.perTick || 5, (MB.minEgg || 5) - curEgg);
    if (tarEgg > 0) restockEggs(tarEgg);
    if (window.UI && UI.renderMarket) UI.renderMarket();
  }

  /* ============================================================
   * C. 假买家（persona 驱动）购买玩家挂单
   * ============================================================ */
  function refPrice(listing) {
    const mat = Config.trade.materials.find(m => m.name === listing.material_type);
    if (!mat) return 0;
    const range = (MB.prices && MB.prices[mat.id] && MB.prices[mat.id][listing.item_rarity]) || null;
    return range ? range[1] : 0;
  }
  const isCheap = l => l.material_qty <= refPrice(l);

  // 按"流派口味 / 价格"打分：想要（aff）且便宜（qty 小）→ 更优先
  function pickBuyTarget(listings, persona) {
    const items = listings.filter(l => l.kind === 'item' && isCheap(l));
    let best = null, bestScore = -Infinity;
    for (const l of items) {
      const aff = gearAffinity(l.item_affixes || l.eq, persona);
      const score = aff / (l.material_qty + 1);
      if (score > bestScore) { bestScore = score; best = l; }
    }
    return best;
  }
  function pickBuyCandidate(items, pets, persona) {
    const itemTarget = items.length ? pickBuyTarget(items.map(x => ({ ...x, kind: 'item' })), persona) : null;
    const petTarget = pets.length ? (pets.slice().sort((a, b) => Number(b.pet_growth || 0) - Number(a.pet_growth || 0))[0]) : null;
    if (itemTarget && petTarget) return itemTarget;
    return itemTarget || petTarget;
  }

  // 执行一次 persona 购买：随机出手一个 AI，按流派口味 + 合理价挑目标，买入后 80% 离场 / 20% 降价再挂
  async function tryBuyOnce() {
    if (!MB.enabled || B.enabled === false) return { bought: false };
    const realItems = Market.getRealItemListings ? Market.getRealItemListings() : [];
    if (!realItems.length) return { bought: false };
    const ps = randomPersona();
    if (!ps) return { bought: false };
    const items = realItems.map(x => ({ ...x, kind: 'item' }));
    const cheap = items.filter(isCheap); // 合理价判定：只收低于参考价的
    if (!cheap.length) return { bought: false }; // 不追高（patient 的 AI 尤其如此）
    let target = null;
    // 买贵（overpay）：小概率跳过价格判定，直接买口味最高的那件（哪怕高于参考价）
    if (ps.overpay && Math.random() < 0.5) {
      let fav = null, favAff = -Infinity;
      for (const l of items) {
        const aff = gearAffinity(l.item_affixes || l.eq, ps);
        if (aff > favAff) { favAff = aff; fav = l; }
      }
      target = fav;
    } else {
      target = ps.patient
        ? cheap.slice().sort((a, b) => a.material_qty - b.material_qty)[0]
        : pickBuyTarget(cheap, ps);
    }
    if (!target) return { bought: false };
    if (!target) return { bought: false };
    const res = await Market.buyAsBotAny(target);
    if (!res.ok) return { bought: false, error: res.error };
    await Market.refresh();
    const user = await Supabase.getCurrentUser();
    if (user) {
      const { data } = await Materials.loadCloudMaterials();
      if (data) Materials.setCloudMaterials(data);
    }
    // 购买通知 → 消息控制台：显示 persona 昵称（不标 AI）
    if (window.UI && UI.consoleLog) {
      const nm = target.item_name || '';
      const pay = (target.material_qty || 0) + ' ' + (target.material_type || '材料');
      if (user && target.seller_id === user.id) {
        UI.consoleLog('social', '🛒 你的 <b>' + nm + '</b> 被 ' + ps.nickname + ' 买走了（收到 ' + pay + '）');
      } else {
        UI.consoleLog('social', '🛒 ' + ps.nickname + ' 购买了 <b>' + nm + '</b>（' + pay + '）');
      }
    }
    // sink：买入 80% 直接消耗离场；20% 降价再挂（同一 persona 立刻补一件当"转卖"）
    if (res.ok && Math.random() >= (BH.consumeRate || 0.8)) {
      const l2 = await makeListing(ps);
      if (l2) {
        const disc = BH.relistDiscount || [0.1, 0.2];
        l2.material_qty = Math.max(1, Math.round(l2.material_qty * (1 - randFloat(disc[0], disc[1]))));
        l2.isLeak = false;
        Market.addBotListing(l2);
      }
    }
    if (window.UI && UI.renderAll) UI.renderAll();
    return { bought: true, itemName: target.item_name || '' };
  }

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
    generatePersonas(); // 先生成 20 个 AI 玩家，再补货
    tick();
    timer = setInterval(tick, MB.intervalMs || 30000);
    scheduleNextBuy();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (buyTimer) { clearTimeout(buyTimer); buyTimer = null; }
  }

  /* ---------- 对外 API ---------- */
  window.MarketBot = {
    start, stop, tick,
    getBotListings: () => (window.Market && window.Market.getBotListings ? window.Market.getBotListings() : []),
    getPersonas: () => personas,
    tryBuyOnce, pickBuyTarget, pickBuyCandidate,
    __test: {
      rollPrice, aiDrop, makeListing, pickArea, makeMaterialListing, makeEggListing,
      generatePersonas, gearAffinity, nextPersona, randomPersona, getPersonas: () => personas
    }
  };
})();
