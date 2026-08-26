/* ============================================================
 * supabase.js —— Supabase 数据层
 * 职责：
 *  1. 初始化 Supabase 客户端（URL / anon key 配在本文件顶部）
 *  2. 认证：邮箱+密码 注册 / 登录 / 登出 / 获取当前会话
 *  3. 宠物存档：读玩家宠物列表、写入新宠物（pets 表）
 * 依赖：js/vendor/supabase.min.js（UMD SDK，挂 window.supabase）
 * ============================================================ */
(function () {
  'use strict';

  /* ================= Supabase 项目配置 =================
   * 改这里即可（Supabase Dashboard → Project Settings → API）
   * ==================================================== */
  const SUPABASE_URL = 'https://asklogeayzlqpeejuvjj.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_8Ru_uu-6_tUrWlch-Y2bjA_k-DUKe52';

  const { createClient } = window.supabase;
  let client = null;

  function init() {
    if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }
  // 供其他模块直接访问客户端（如 items.js 的查询）
  const getClient = () => client || init();

  /* ---------- 认证 ---------- */
  async function signIn(email, password) {
    return client.auth.signInWithPassword({ email, password });
  }
  async function signUp(email, password) {
    const res = await client.auth.signUp({ email, password });
    // 若项目开着邮箱验证，注册后不会自动建立会话 → 自动再登录一次兜底
    if (!res.error && !res.data.session) {
      const retry = await client.auth.signInWithPassword({ email, password });
      if (!retry.error) return retry;
    }
    return res;
  }
  async function signOut() {
    return client.auth.signOut();
  }
  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }
  // 当前登录用户：用 getUser() 而非 getSession()——
  // getUser() 会校验并自动刷新过期的 access token，否则页面打开时 token 过期会导致
  // 云宠物/材料读不到，界面退回初始莱姆（Bug 修复点）
  async function getCurrentUser() {
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user;
  }

  /* ---------- 宠物存档（pets 表） ---------- */
  const PET_COLUMNS = 'id,name,icon,growth,level,hp,attack,defense,speed,cur_hp,is_active,evolve_times,reborn_count,created_at';
  async function loadPets() {
    return client.from('pets').select(PET_COLUMNS).order('created_at', { ascending: true });
  }
  // 单条查询（购买后精准拉取新宠物；RLS：宠物已转移给买家，买家可查）
  async function fetchPetById(id) {
    return client.from('pets').select(PET_COLUMNS).eq('id', id).maybeSingle();
  }
  // savePet(pet)：把宠物写入当前用户的存档；未登录返回 error
  // 成功后返回 data（含云端 id），调用方应回写到 pet.cloudId 供市场上架使用
  async function savePet(pet) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('未登录') };
    return client.from('pets').insert({
      user_id: user.id,
      name: pet.name, icon: pet.icon,
      growth: pet.growth, level: pet.level,
      evolve_times: pet.evolveTimes || 0, reborn_count: pet.rebornCount || 0,
      hp: pet.baseHp, attack: pet.baseAtk, defense: pet.baseDef, speed: pet.baseSpd,
      cur_hp: Math.round(pet.curHp)
    }).select(PET_COLUMNS).single();
  }

  // 删除宠物（融合消耗副宠等用；RLS 保证只能删自己的）
  async function deletePet(cloudId) {
    return client.from('pets').delete().eq('id', cloudId);
  }
  // 更新宠物字段（融合后成长值/等级变化；RLS 保证只能改自己的）
  // patch 示例：{ growth: 10, level: 1 }
  async function updatePet(cloudId, patch) {
    return client.from('pets').update(patch).eq('id', cloudId);
  }

  /* ---------- 市场（pet_listings 表 + buy_pet RPC） ---------- */
  // 上架：快照宠物信息，pet_id 必须是云端 id（pet.cloudId）
  // 标价 = 材料类型 + 数量（materialType ∈ 强化石/祝福石/涅磐兽）
  async function listPet(pet, materialType, materialQty) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    if (!materialType) return { data: null, error: new Error('请选择收什么材料') };
    if (!Number.isInteger(materialQty) || materialQty < 1) return { data: null, error: new Error('材料数量需为正整数') };
    return client.from('pet_listings').insert({
      pet_id: pet.cloudId, seller_id: user.id,
      material_type: materialType, material_qty: materialQty,
      pet_name: pet.name, pet_growth: pet.growth, pet_level: pet.level
    }).select().single();
  }
  // 市场在售列表（所有人可见）
  async function fetchMarket() {
    return client.from('pet_listings')
      .select('id,pet_id,seller_id,price,material_type,material_qty,pet_name,pet_growth,pet_level,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
  }
  // 我当前上架的宠物（带挂单 id 供取回）
  async function fetchMyListedIds() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('pet_listings').select('id,pet_id').eq('seller_id', user.id).eq('status', 'active');
  }
  // 购买：调 buy_pet RPC（事务内 校验→转移归属→标记 sold），返回 { data: boolean, error }
  async function buyPet(listingId) {
    return client.rpc('buy_pet', { p_listing_id: listingId });
  }
  // 取回：撤销自己的在售宠物挂单（RPC 只允许删自己的 active 挂单）
  async function cancelPetListing(listingId) {
    return client.rpc('cancel_pet_listing', { p_listing_id: listingId });
  }

  /* ---------- 装备交易（item_listings 表 + buy_item RPC） ---------- */
  // 上架装备：快照展示信息，item_id 必须是云端 id（eq.cloudId）
  // 标价 = 材料类型 + 数量
  async function listItem(eq, materialType, materialQty) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    if (!materialType) return { data: null, error: new Error('请选择收什么材料') };
    if (!Number.isInteger(materialQty) || materialQty < 1) return { data: null, error: new Error('材料数量需为正整数') };
    // 稀有度兼容：对象（id/label/color）或字符串 id（旧数据）；都缺失时兜底 white，避免 not-null 报错
    const rarityId = typeof eq.rarity === 'string'
      ? eq.rarity
      : ((eq.rarity && eq.rarity.id) || 'white');
    return client.from('equip_listings').insert({
      item_id: eq.cloudId, seller_id: user.id,
      material_type: materialType, material_qty: materialQty,
      item_name: eq.name || '装备', item_slot: eq.slot || '武器',
      item_rarity: rarityId,
      // item_tier 在库中 not null 无默认值，必须显式写入，否则 insert 400（曾导致上架静默失败）
      item_tier: Number(eq.tier) || 4,
      // 市场快照：词缀拍平为扁平数组（展示用，与旧数据形态一致；装备本体仍存嵌套结构）
      item_affixes: Array.isArray(eq.affixes)
        ? eq.affixes
        : [...(eq.affixes.prefix || []), ...(eq.affixes.suffix || [])]
    }).select().single();
  }
  // 市场在售装备（所有人可见）
  async function fetchItemMarket() {
    return client.from('equip_listings')
      .select('id,item_id,seller_id,price,material_type,material_qty,item_name,item_slot,item_rarity,item_tier,item_affixes,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
  }
  // 我上架的装备（带挂单 id 供取回）
  async function fetchMyListedItemIds() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('equip_listings').select('id,item_id').eq('seller_id', user.id).eq('status', 'active');
  }
  // 购买装备：调 buy_equip RPC
  async function buyItem(listingId) {
    return client.rpc('buy_equip', { p_listing_id: listingId });
  }
  // 流浪商人（系统假买家）购买玩家挂单：调 bot_buy_equip RPC（security definer，
  // 锁单→卖家材料到账（标价-税）→双写交易记录（买家=「流浪商人」）→删除装备行）
  async function botBuyEquip(listingId) {
    return client.rpc('bot_buy_equip', { p_listing_id: listingId });
  }
  async function botBuyPet(listingId) {
    return client.rpc('bot_buy_pet', { p_listing_id: listingId });
  }
  // 取回装备：撤销自己的在售装备挂单
  async function cancelEquipListing(listingId) {
    return client.rpc('cancel_equip_listing', { p_listing_id: listingId });
  }

  /* ---------- 宠物蛋交易（egg_listings 表 + list_egg / buy_egg / cancel_egg_listing RPC） ---------- */
  // 上架蛋：扣卖家一颗该品种蛋 + 建挂单；返回挂单行或错误
  async function listEgg(eggType, materialType, materialQty) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    return client.rpc('list_egg', {
      p_egg_type: eggType,
      p_material_type: materialType,
      p_material_qty: materialQty
    });
  }
  // 市场在售蛋列表
  async function fetchEggMarket() {
    return client.from('egg_listings')
      .select('id,seller_id,egg_type,material_type,material_qty,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
  }
  // 我当前上架的蛋（带挂单 id 供取回）
  async function fetchMyListedEggIds() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('egg_listings').select('id').eq('seller_id', user.id).eq('status', 'active');
  }
  // 购买蛋：调 buy_egg RPC（交易+税+给买家蛋+双写记录）
  async function buyEgg(listingId) {
    return client.rpc('buy_egg', { p_listing_id: listingId });
  }
  // 取回蛋挂单：撤销自己的 active 挂单，蛋退回
  async function cancelEggListing(listingId) {
    return client.rpc('cancel_egg_listing', { p_listing_id: listingId });
  }

  /* ---------- 交易记录（trade_records 表） ---------- */
  // 当前登录玩家的全部交易记录（买入 + 卖出，按时间倒序）
  async function loadTradeRecords() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('trade_records')
      .select('id,player_id,role,item_name,material_type,price_qty,tax_qty,net_qty,created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false });
  }

  /* ---------- 宠物蛋（pet_egg 表：每颗蛋一行，含 egg_type 品种列，掉蛋 insert / 孵化标记已孵化） ---------- */
  // 掉蛋：云端插一行「未孵化」带品种；未登录仅本地计数
  // 注意：insert/update 后必须 .select()/.then() 触发请求，否则 PostgrestBuilder 不执行
  async function addEgg(baseName) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    return client.from('pet_egg').insert({ owner_id: user.id, egg_type: baseName || null }).select().single();
  }
  // 孵化：消耗一颗指定品种的「未孵化」蛋，标记「已孵化」并关联新宠物。
  // baseName 为空时取最早一颗任意品种的蛋（兼容旧数据/未加品种列的场景）。
  async function consumeEgg(baseName, petId) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    let q = client.from('pet_egg')
      .select('id').eq('owner_id', user.id).eq('status', '未孵化');
    if (baseName) q = q.eq('egg_type', baseName); // 指定品种
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) return { data: null, error };
    if (!data || !data.length) return { data: null, error: new Error('云端没有可孵化的蛋') };
    return client.from('pet_egg')
      .update({ status: '已孵化', pet_id: petId })
      .eq('id', data[0].id)
      .select().single();
  }
  // 云端未孵化蛋（登录时恢复；云端为权威）。返回 { eggMap, total }
  // eggMap = { '血狐': 2 }；旧数据 egg_type 为 null 的统一归为 '宠物蛋' 品种。
  async function loadEggCount() {
    const user = await getCurrentUser();
    if (!user) return { data: 0, error: null, eggMap: {} };
    const { data, error } = await client.from('pet_egg')
      .select('egg_type').eq('owner_id', user.id).eq('status', '未孵化');
    if (error) return { data: 0, error, eggMap: {} };
    const eggMap = {};
    for (const row of data || []) {
      const k = row.egg_type || '宠物蛋';
      eggMap[k] = (eggMap[k] || 0) + 1;
    }
    const total = Object.values(eggMap).reduce((a, b) => a + b, 0);
    return { data: total, error: null, eggMap };
  }

  /* ---------- 装备打造（equip_items 表词缀更新） ---------- */
  // 更新装备字段（打造后词缀变化；RLS 保证只能改自己的）
  // patch 示例：{ affixes: [...] }
  async function updateEquipItem(cloudId, patch) {
    return client.from('equip_items').update(patch).eq('id', cloudId);
  }
  // 单条查询（购买后精准拉取新装备）
  async function fetchItemById(id) {
    return client.from('equip_items').select('*').eq('id', id).maybeSingle();
  }

  /* ---------- 任务进度（账号级，存 quest_progress 表，user_id 主键） ---------- */
  // 读当前账号任务进度 JSON（未登录返回 null）
  async function fetchQuestProgress() {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    const { data, error } = await client.from('quest_progress')
      .select('progress').eq('user_id', user.id).maybeSingle();
    if (error) return { data: null, error };
    return { data: (data && data.progress) || {}, error: null };
  }
  // 写任务进度到当前账号（未登录静默忽略；upsert 保证首次也写入）
  async function saveQuestProgress(progress) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    return client.from('quest_progress')
      .upsert({ user_id: user.id, progress, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }

  /* ---------- 对外 API ---------- */
  window.Supabase = {
    init, getClient, signIn, signUp, signOut, getSession, getCurrentUser,
    loadPets, fetchPetById, savePet, deletePet, updatePet,
    listPet, fetchMarket, fetchMyListedIds, buyPet, cancelPetListing,
    listItem, fetchItemMarket, fetchMyListedItemIds, buyItem, cancelEquipListing, botBuyEquip, botBuyPet,
    updateEquipItem, fetchItemById, loadTradeRecords,
    addEgg, consumeEgg, loadEggCount,
    listEgg, fetchEggMarket, fetchMyListedEggIds, buyEgg, cancelEggListing,
    fetchQuestProgress, saveQuestProgress
  };
})();
