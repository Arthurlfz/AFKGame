/* ============================================================
 * market.js —— 市场逻辑（宠物 + 装备交易）
 * 职责：
 *  1. 市场在售列表缓存与刷新（宠物挂单 + 装备挂单）
 *  2. 上架：宠物挂 pet_listings、装备挂 item_listings（需登录 + 云端 id）
 *  3. 购买：调 buy_pet / buy_item RPC（事务保证不双买），成功后刷新
 *  4. 我的上架状态（防止重复挂单）
 * 状态：listings / itemListings / myListed*Ids 仅本模块持有
 * 依赖：supabase.js（数据层）；DOM 渲染在 js/ui/（ui-market 等），流程编排在 main.js
 * ============================================================ */
(function () {
  'use strict';

  const Supabase = window.Supabase;
  const Config = window.Config;
  const Equipment = window.Equipment;
  const Items = window.Items;
  const Materials = window.Materials;
  const Pet = window.Pet;

  let listings = [];         // 宠物在售列表（真实玩家挂单）
  let itemListings = [];     // 装备在售列表（真实玩家挂单）
  let eggListings = [];      // 宠物蛋在售列表（真实玩家挂单）
  let botListings = [];      // 假卖家（流浪商人）装备挂单：纯前端内存，不落库、不占玩家账号
  let botPetListings = [];   // 假卖家（流浪商人）宠物挂单：纯前端内存，不落库、不占玩家账号
  let myListedPets = [];     // 我上架的宠物 [{listingId, petId}]
  let myListedItems = [];    // 我上架的装备 [{listingId, itemId}]
  let myListedEggs = [];     // 我上架的蛋 [{listingId, eggType}]
  let tradeRecords = [];     // 我的交易记录（买入+卖出，云端权威）

  /* ---------- 交易税 ----------
   * 每满 Config.trade.taxPer 个材料收 Config.trade.taxAmount 个税，不满不收。
   * 买家按标价支付，卖家实收 = 标价 - 税。与 Supabase RPC 内计算一致。 */
  function calcTax(qty) {
    const T = Config.trade;
    return Math.floor((qty || 0) / T.taxPer) * T.taxAmount;
  }
  // 卖家实收
  function calcNet(qty) {
    return (qty || 0) - calcTax(qty);
  }
  const LISTING_MATERIALS = new Set(['重铸石', '剥离石', '神圣石', '增缀石', '涅磐兽', '进化素材', '精粹进化素材', '传说进化素材', '宠物蛋', '凝魂晶石']);
  const PAYMENT_MATERIALS = new Set(['重铸石', '剥离石', '神圣石', '增缀石', '涅磐兽', '进化素材', '精粹进化素材', '传说进化素材', '宠物蛋', '凝魂晶石']);
  const isPaymentMaterial = name => PAYMENT_MATERIALS.has(name);
  // 材料名称 → 配置项（上架下拉 / 市场显示用）
  function findMaterial(name) {
    return Config.trade.materials.find(m => m.name === name) || { id: name, name, icon: '📦' };
  }

  /* ---------- 刷新（登录后 / 上架购买后 / 轮询调用） ---------- */
  async function refresh() {
    const [p, pi, it, ii, eg, ei, tr] = await Promise.all([
      Supabase.fetchMarket(), Supabase.fetchMyListedIds(),
      Supabase.fetchItemMarket(), Supabase.fetchMyListedItemIds(),
      Supabase.fetchEggMarket(), Supabase.fetchMyListedEggIds(),
      Supabase.loadTradeRecords()
    ]);
    if (!p.error) listings = p.data || [];
    if (!pi.error) myListedPets = (pi.data || []).map(r => ({ listingId: r.id, petId: r.pet_id }));
    if (!it.error) itemListings = it.data || [];
    if (!ii.error) myListedItems = (ii.data || []).map(r => ({ listingId: r.id, itemId: r.item_id }));
    if (!eg.error) eggListings = eg.data || [];
    if (!ei.error) myListedEggs = (ei.data || []).map(r => ({ listingId: r.id, eggType: r.egg_type }));
    if (!tr.error) tradeRecords = tr.data || [];
    return { listings, itemListings, eggListings, tradeRecords };
  }
  // 在售宠物 = 真实玩家挂单 + 假卖家（流浪商人）挂单（假单排前面，市场打开就有货）
  const getListings = () => [...botPetListings, ...listings];
  const getRealListings = () => listings;
  const getBotPetListings = () => botPetListings;
  function addBotPetListing(l) { botPetListings.unshift(l); }
  // 在售装备 = 真实玩家挂单 + 假卖家（流浪商人）挂单（假单排前面，市场打开就有货）
  const getItemListings = () => [...botListings, ...itemListings];
  // 仅真实玩家装备挂单（假买家 market_bot 只买玩家的货，不买假卖家的货）
  const getRealItemListings = () => itemListings;
  // 仅假卖家挂单（market_bot 补货检查用）
  const getBotListings = () => botListings;
  const getTradeRecords = () => tradeRecords;
  const isListed = petId => myListedPets.some(x => x.petId === petId);
  const isItemListed = itemId => myListedItems.some(x => x.itemId === itemId);
  const getPetListing = petId => myListedPets.find(x => x.petId === petId);
  const getItemListing = itemId => myListedItems.find(x => x.itemId === itemId);
  const getListedCount = () => myListedPets.length + myListedItems.length;

  /* ---------- 假卖家（流浪商人）挂单 ----------
   * 由 market_bot.js 定时生成/补货；假单只存前端内存，不落库、不占玩家账号。
   * 购买时：扣买家材料（走云端原子扣）→ 装备直接入买家背包 → 按正常流程写买家存档。 */
  function addBotListing(l) {
    botListings.unshift(l);
  }
  function buyBotItem(id) {
    const idx = botListings.findIndex(x => x.id === id);
    if (idx < 0) return Promise.resolve({ error: '购买失败：该商品已售出' });
    const l = botListings[idx];
    return (async () => {
      // 校验登录（假单购买需登录：材料云端扣减 + 装备写买家存档）
      const user = await Supabase.getCurrentUser();
      if (!user) return { error: '请先登录' };
      // 扣材料：与真实购买一致走云端原子扣（Materials.spend 校验余额→RPC→成功才改本地）
      const spent = await Materials.spend(l.material_type, l.material_qty);
      if (!spent.ok) return { error: spent.error };
      // 装备入包（假单已持有完整装备对象；保存失败只提示，不阻塞——与掉落逻辑一致）
      Equipment.addToInventory(l.eq);
      const saved = await Items.saveItem(l.eq);
      if (saved.error) return { ok: true, eq: l.eq, saveFailed: true, error: '装备已入包，但云端存档失败：' + saved.error.message };
      botListings.splice(idx, 1); // 仅购买成功才移除假单
      return { ok: true, itemId: l.eq.cloudId, eq: l.eq };
    })();
  }
  // 购买流浪商人宠物（仿 buyBotItem：扣材料 → 宠物入列 → 云端建档 → 移除假单）
  function buyBotPet(id) {
    const idx = botPetListings.findIndex(x => x.id === id);
    if (idx < 0) return Promise.resolve({ error: '购买失败：该商品已售出' });
    const l = botPetListings[idx];
    return (async () => {
      const user = await Supabase.getCurrentUser();
      if (!user) return { error: '请先登录' };
      const spent = await Materials.spend(l.material_type, l.material_qty);
      if (!spent.ok) return { error: spent.error };
      const pet = l.pet;
      Pet.addPet(pet); // 本地宠物入列（立即可见）
      const saved = await Supabase.savePet(pet); // 云端建档
      if (!saved.error && saved.data && saved.data.id) pet.cloudId = saved.data.id; // 回写云端 id（与 main.js 建档逻辑一致）
      if (saved.error) {
        return { ok: true, petId: pet.cloudId || null, pet, saveFailed: true, error: '宠物已入列，但云端存档失败：' + (saved.error.message || '未知错误') };
      }
      botPetListings.splice(idx, 1); // 仅购买成功才移除假单
      return { ok: true, petId: pet.cloudId, pet };
    })();
  }

  /* ---------- 宠物上架 / 购买 / 取回 ---------- */
  async function listPet(pet, materialType, materialQty) {
    if (!pet.cloudId) return { error: '这只宠物还没有云端存档，刷新一下再上架' };
    const { data, error } = await Supabase.listPet(pet, materialType, materialQty);
    if (error) return { error: error.message };
    // 立即本地标记已上架（不依赖 refresh 异步拉回，避免锁定判定空窗）
    if (data && data.id) myListedPets.push({ listingId: data.id, petId: data.pet_id || pet.cloudId, materialType, materialQty });
    await refresh();
    // 任务进度上报：所有 type=list 的任务 +1（上架宠物/装备都算）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('list', 1);
    return { ok: true, data };
  }
  // 购买：调 buy_pet RPC（事务内 校验→扣材料→转移归属→标记 sold）。
  // 性能优化：成功后仅本地移除该挂单（不整表重拉），返回新宠物云端 id 供单条拉取
  async function buy(listingId) {
    const l = listings.find(x => x.id === listingId);
    const { data, error } = await Supabase.buyPet(listingId);
    if (error) return { error: error.message };
    const err = buyResultError(data);
    if (err) return { error: err };
    listings = listings.filter(x => x.id !== listingId); // 本地移除，等轮询兜底
    // 任务进度上报：所有 type=trade 的任务 +1（买入成交）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('trade', 1);
    return { ok: true, petId: l && l.pet_id };
  }
  async function cancelPet(listingId) {
    const { data, error } = await Supabase.cancelPetListing(listingId);
    if (error) return { error: error.message };
    if (data === false) return { error: '取回失败：挂单不存在或已售出' };
    await refresh();
    return { ok: true };
  }

  /* ---------- 装备上架 / 购买 / 取回 ---------- */
  async function listItem(eq, materialType, materialQty) {
    if (!eq.cloudId) return { error: '这件装备还没有云端存档，刷新一下再上架' };
    const { data, error } = await Supabase.listItem(eq, materialType, materialQty);
    if (error) return { error: error.message };
    if (data && data.id) myListedItems.push({ listingId: data.id, itemId: data.item_id || eq.cloudId, materialType, materialQty });
    await refresh();
    // 任务进度上报：所有 type=list 的任务 +1（上架宠物/装备都算）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('list', 1);
    return { ok: true, data };
  }
  async function buyItem(listingId) {
    const l = itemListings.find(x => x.id === listingId);
    const { data, error } = await Supabase.buyItem(listingId);
    if (error) return { error: error.message };
    const err = buyResultError(data);
    if (err) return { error: err };
    itemListings = itemListings.filter(x => x.id !== listingId); // 本地移除，等轮询兜底
    // 任务进度上报：所有 type=trade 的任务 +1（买入成交）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('trade', 1);
    return { ok: true, itemId: l && l.item_id };
  }
  async function cancelItem(listingId) {
    const { data, error } = await Supabase.cancelEquipListing(listingId);
    if (error) return { error: error.message };
    if (data === false) return { error: '取回失败：挂单不存在或已售出' };
    await refresh();
    return { ok: true };
  }
  // 假买家（流浪商人）购买玩家挂单：调 bot_buy_equip RPC（云端锁单→卖家收材料→删装备行→写记录）
  // 与真实购买 buyItem 完全分离，不改变现有交易逻辑；成功后本地移除该挂单
  async function buyAsBot(listingId) {
    const { data, error } = await Supabase.botBuyEquip(listingId);
    if (error) return { error: error.message };
    if (data !== 'ok') return { error: '流浪商人未购买成功（' + data + '）' };
    itemListings = itemListings.filter(x => x.id !== listingId); // 本地移除，等轮询兜底
    return { ok: true };
  }

  /* ---------- 宠物蛋上架 / 购买 / 取回 ---------- */
  const getEggListings = () => eggListings;
  const getMyListedEggs = () => myListedEggs;
  const isMyEggListed = (eggType) => myListedEggs.some(l => l.eggType === eggType);
  async function listEgg(eggType, materialType, materialQty) {
    const { data, error } = await Supabase.listEgg(eggType, materialType, materialQty);
    if (error) return { error: error.message };
    if (data && data.id) myListedEggs.push({ listingId: data.id, eggType });
    await refresh();
    return { ok: true, data };
  }
  async function buyEgg(listingId) {
    const { data, error } = await Supabase.buyEgg(listingId);
    if (error) return { error: error.message };
    const err = buyResultError(data);
    if (err) return { error: err };
    eggListings = eggListings.filter(x => x.id !== listingId); // 本地移除，等轮询兜底
    return { ok: true };
  }
  async function cancelEgg(listingId) {
    const { data, error } = await Supabase.cancelEggListing(listingId);
    if (error) return { error: error.message };
    if (data !== 'ok') return { error: '取回失败：挂单不存在或已售出' };
    await refresh();
    return { ok: true };
  }

  /* ---------- 购买 RPC 返回值转错误文案 ---------- */
  // buy_pet / buy_equip 返回 'ok' | 'nologin' | 'notfound' | 'self' | 'insufficient'
  function buyResultError(data) {
    if (data === true || data === 'ok') return null;
    const map = {
      nologin: '请先登录',
      notfound: '购买失败：该挂单已售出或不存在',
      self: '不能买自己挂的单',
      insufficient: '材料或宠物蛋不足：你的收款物数量不够支付标价',
      invalid_price: '该商品的收款物配置无效'
    };
    return map[data] || '购买失败：可能已售出，或不能买自己的物品';
  }

  /* ---------- 假买家统一购买入口 ---------- */
  async function buyAsBotAny(listing) {
    return listing.item_id ? buyAsBot(listing.id) : (async () => {
      const { data, error } = await Supabase.botBuyPet(listing.id);
      if (error) return { error: error.message };
      if (data !== 'ok') return { error: '流浪商人未购买成功（' + data + '）' };
      listings = listings.filter(x => x.id !== listing.id);
      return { ok: true };
    })();
  }

  /* ---------- 对外 API ---------- */
  window.Market = {
    refresh, getListings, getItemListings, getRealItemListings, getBotListings, getBotPetListings, getTradeRecords,
    isListed, isItemListed, getPetListing, getItemListing, getListedCount,
    calcTax, calcNet, findMaterial, isPaymentMaterial,
    listPet, buy, cancelPet, listItem, buyItem, cancelItem,
    getEggListings, getMyListedEggs, isMyEggListed, listEgg, buyEgg, cancelEgg,
    addBotListing, buyBotItem, addBotPetListing, buyBotPet, buyAsBot, buyAsBotAny
  };
})();
