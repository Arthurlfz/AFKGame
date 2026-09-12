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
    const c = getClient();
    return c.auth.signInWithPassword({ email, password });
  }
  async function signUp(email, password) {
    const c = getClient();
    const res = await c.auth.signUp({ email, password });
    // 若项目开着邮箱验证，注册后不会自动建立会话 → 自动再登录一次兜底
    if (!res.error && !res.data.session) {
      const retry = await c.auth.signInWithPassword({ email, password });
      if (!retry.error) return retry;
    }
    return res;
  }
  async function signOut() {
    return getClient().auth.signOut();
  }
  async function getSession() {
    const { data } = await getClient().auth.getSession();
    return data.session;
  }
  // 当前登录用户（2026-08-30 性能优化）
  //
  // 实测 auth.getUser() 单次 550ms，而全项目 31 处调用它 —— 每次交互都要先付这半秒，
  // 打造一个动作串了 3 次，光"问服务器我是谁"就 1.65 秒，比真正干活的 rpc 还贵。
  //
  // 绝大多数调用点只是想知道「登没登录、用户 id 是多少」，这个信息本地 JWT 里就有：
  // 默认走 getSession() —— 本地读，0ms。且 getSession() 在 token 快过期时同样会
  // 自动用 refresh_token 续期，所以原先靠 getUser() 修的那个
  // 「页面打开时 token 过期 → 云宠物读不到、退回初始莱姆」的 bug 依然被覆盖。
  //
  // 只有需要服务端二次确认的路径（init 会话探测：判断老 token 是不是还有效）
  // 才传 force=true 走 getUser()。
  async function getCurrentUser(force) {
    if (!force) {
      const s = await getSession();
      return (s && s.user) || null;
    }
    const { data, error } = await client.auth.getUser();
    return error ? null : ((data && data.user) || null);
  }

  /* ---------- 宠物存档（pets 表） ---------- */
  // 基础列（各版本都有）；附加列（旧库可能缺失：缺哪列自动剔除哪列，宠物本体照常读写）
  const PET_BASE_COLS = 'id,name,icon,growth,level,hp,attack,defense,speed,cur_hp,is_active,evolve_times,reborn_count,created_at';
  // 附加列（旧库可能缺失）：2026-09-06 新增 evolve_stage / is_god_pet（神级宠 + 5 阶进化，
  // 需先跑 supabase/migrate_god_pet.sql；没跑迁移的库会自动剔除这两列，宠物本体照常读写）
  const PET_EXTRA_COLS = ['exp', 'traits', 'awaken_trait', 'source', 'evolve_stage', 'is_god_pet', 'cultivate_used'];
  const missingPetCols = new Set();
  const currentPetCols = () => PET_BASE_COLS + ',' + PET_EXTRA_COLS.filter(c => !missingPetCols.has(c)).join(',');
  // 判断错误是否为「缺列」（Postgres 42703 / PostgREST PGRST204）
  function isMissingPetColumn(error) {
    if (!error) return false;
    const code = String(error.code || '');
    return code === '42703' || code === 'PGRST204';
  }
  // pets 查询统一入口：按当前列集查，遇缺列记下并重试（降级对调用方透明）
  async function queryPets(build) {
    let res = await build(currentPetCols());
    if (res && res.error && isMissingPetColumn(res.error)) {
      const msg = String(res.error.message || '');
      const col = PET_EXTRA_COLS.find(c => msg.indexOf(c) >= 0);
      if (col) missingPetCols.add(col);
      else PET_EXTRA_COLS.forEach(c => missingPetCols.add(c)); // 无法定位 → 去掉全部附加列
      res = await build(currentPetCols());
    }
    return res;
  }
  async function loadPets() {
    return queryPets(cols => client.from('pets').select(cols).order('created_at', { ascending: true }));
  }
  // 单条查询（购买后精准拉取新宠物；RLS：宠物已转移给买家，买家可查）
  async function fetchPetById(id) {
    return queryPets(cols => client.from('pets').select(cols).eq('id', id).maybeSingle());
  }
  // 宠物对象 → 云端行；includeExp=false 时不带 exp（旧库缺列场景）
  function petToRow(pet, includeExp) {
    const row = {
      name: pet.name,
      // icon 列是 NOT NULL 且有默认 ''；2026-09-10 起客户端不再用 emoji（立绘走 PetSprites），
      // 新宠物 icon 为 null → 显式发 null 会撞 23502（PostgREST 400）→ 建档永远失败 →
      // 宠物拿不到 cloudId，30 秒补建档自愈又不停重试（控制台刷屏 400）。
      // 空 icon 就不带这一列，让 DB 走默认值。
      growth: pet.growth, level: pet.level,
      evolve_times: pet.evolveTimes || 0, reborn_count: pet.rebornCount || 0,
      hp: pet.baseHp, attack: pet.baseAtk, defense: pet.baseDef, speed: pet.baseSpd,
      cur_hp: Math.round(pet.curHp)
    };
    if (pet.icon) row.icon = pet.icon;
    if (includeExp) row.exp = Math.max(0, Math.round(pet.exp || 0));
    // 进化阶段 / 神级宠标记（缺列时由 savePet 剔除，迁移前的旧库不受影响）
    /* ⚠️ 上限必须跟着 Config.pet.evolution 走（2026-09-10：5 阶 → 6 阶，即 5 次进化）。
     * 这里原本硬写 Math.min(5,…) —— 加了第 6 阶却忘了改这里，第 6 阶永远存不进云端
     * （本地涨了、刷新后掉回 5 阶），是「改了 config 却看不见效果」的经典坑。 */
    const maxStage = ((Config.pet && Config.pet.evolution && Config.pet.evolution.maxEvolveTimes) || 4) + 1;
    row.evolve_stage = Math.min(maxStage, Math.max(1, Math.floor(pet.evolveStage || (pet.evolveTimes || 0) + 1 || 1)));
    row.is_god_pet = !!pet.isGodPet;
    row.cultivate_used = Math.max(0, Math.floor(pet.cultivateUsed || 0)); // 神宠培育已用次数（涅槃归零）
    // 血脉特质 / 永久觉醒标记 / 来源（缺列时由 savePet 剔除）
    if (Array.isArray(pet.traits) && pet.traits.length) row.traits = pet.traits;
    if (pet.awakened) row.awaken_trait = '1';   // 复用 awaken_trait 列（2026-09-10 v2：'1' = 永久觉醒）
    if (pet.source) row.source = pet.source;
    return row;
  }
  // 装备槽 → 云端 jsonb：{ 部位: 装备cloudId }（只存引用，装备本体在 equip_items）
  // eq 可能是装备对象（有 cloudId）或已存的 cloudId 字符串；无 cloudId 的本地装备记 ''（刷新后不恢复）
  function petEquipmentToCloud(pet) {
    const eq = pet.equipment || {};
    const out = {};
    for (const [slot, item] of Object.entries(eq)) {
      if (!item) { out[slot] = null; continue; }
      out[slot] = (typeof item === 'string') ? item : (item.cloudId || '');
    }
    return out;
  }
  // savePet(pet)：把宠物写入当前用户的存档；未登录返回 error
  // 成功后返回 data（含云端 id），调用方应回写到 pet.cloudId 供市场上架使用
  // ⚠️ 语义 = 无条件 INSERT 新行（建档），不看 pet.cloudId！
  //   「更新已有宠」一律用 updatePet(pet.cloudId, {...})——2026-09-08 血泪：经验包顶等级
  //   误用本函数，每用一次全宠各插一行副本，刷新后 loadPets 全量拉回 = 凭空多出一堆宠。
  //   市场买宠依赖 INSERT 语义（快照宠物在新主人名下建新行），故不改本函数行为。
  // 装备槽分两步：先存宠物本体（必成功，兼容旧库），再单独更新 equipment（列不存在则忽略，不影响宠物）
  async function savePet(pet) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('未登录') };
    let row = petToRow(pet, !missingPetCols.has('exp'));
    for (const c of PET_EXTRA_COLS) if (missingPetCols.has(c)) delete row[c];
    let res = await client.from('pets')
      .insert(Object.assign({ user_id: user.id }, row))
      .select(currentPetCols()).single();
    // 旧库缺列：定位缺的列去掉重试一次，宠物本体必须存成功
    if (res.error && isMissingPetColumn(res.error)) {
      const msg = String(res.error.message || '');
      const col = PET_EXTRA_COLS.find(c => msg.indexOf(c) >= 0);
      if (col) {
        missingPetCols.add(col); delete row[col];
        res = await client.from('pets')
          .insert(Object.assign({ user_id: user.id }, row))
          .select(currentPetCols()).single();
      }
    }
    if (!res.error && res.data && res.data.id) {
      try {
        await client.from('pets').update({ equipment: petEquipmentToCloud(pet) }).eq('id', res.data.id);
      } catch (e) { /* 旧库无 equipment 列：忽略，宠物本体已保存 */ }
    }
    return res;
  }
  // 单独读某只宠物的装备槽（兼容旧库无列 → 返回空）
  async function loadPetEquipment(cloudId) {
    try {
      const { data, error } = await client.from('pets').select('equipment').eq('id', cloudId).maybeSingle();
      if (error) return {};
      return (data && data.equipment) || {};
    } catch (e) { return {}; }
  }

  // 删除宠物（融合消耗副宠等用；RLS 保证只能删自己的）
  async function deletePet(cloudId) {
    return client.from('pets').delete().eq('id', cloudId);
  }
  // 更新宠物字段（融合后成长值/等级变化；RLS 保证只能改自己的）
  // patch 示例：{ growth: 10, level: 1 }
  /* opts.verify（2026-09-11 审计第 3 批）：给「先扣东西、后写云端」的不可逆链条用
   * （涅槃 / 进化 / 培育）。不带 .select() 时 PostgREST 不返回受影响行，
   * 「行不存在」和「更新成功」都是 {data:null,error:null} —— 于是上层以为落库了，
   * 继续往下走（涅槃会接着把副宠删掉），玩家丢资产。
   * 默认【不开】：全项目 14 个调用点里 11 个只是"同步一下，失败下次再来"，
   * 而测试里有 5 处用假 cloudId 造数据，全局开会让它们因"测试没建档"而变红。 */
  async function updatePet(cloudId, patch, opts) {
    const p = Object.assign({}, patch);
    for (const c of PET_EXTRA_COLS) if (missingPetCols.has(c)) delete p[c];
    const verify = !!(opts && opts.verify);
    const run = () => {
      const q = client.from('pets').update(p).eq('id', cloudId);
      return verify ? q.select('id') : q;
    };
    let res = await run();
    // 旧库缺列：定位缺的列去掉重试一次，保证其它字段照常写入
    if (res.error && isMissingPetColumn(res.error)) {
      const msg = String(res.error.message || '');
      const col = PET_EXTRA_COLS.find(c => msg.indexOf(c) >= 0 && c in p);
      if (col) {
        missingPetCols.add(col); delete p[col];
        res = await run();
      }
    }
    if (verify && !res.error && !(res.data && res.data.length)) {
      return { data: null, error: new Error('这只宠物已不在你的存档里（可能在别的标签页被出售或删除），本次改动未生效') };
    }
    return res;
  }

  /* ---------- 市场（pet_listings 表 + buy_pet RPC） ---------- */
  // 上架：快照宠物信息，pet_id 必须是云端 id（pet.cloudId）
  // 标价 = 材料类型 + 数量（materialType ∈ 强化石/祝福石/涅磐兽）
  async function listPet(pet, materialType, materialQty) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    if (!materialType) return { data: null, error: new Error('请选择收什么材料') };
    if (!Number.isInteger(materialQty) || materialQty < 1) return { data: null, error: new Error('材料数量需为正整数') };
    let payload = {
      pet_id: pet.cloudId, seller_id: user.id,
      material_type: materialType, material_qty: materialQty,
      pet_name: pet.name, pet_growth: pet.growth, pet_level: pet.level,
      pet_traits: Array.isArray(pet.traits) ? pet.traits : []
    };
    let res = await client.from('pet_listings').insert(payload).select().single();
    // 旧库缺 pet_traits 列 → 去掉重试（市场展示/筛选退化为无特质，不影响交易）
    if (res.error && isMissingPetColumn(res.error) && String(res.error.message || '').indexOf('pet_traits') >= 0) {
      delete payload.pet_traits;
      res = await client.from('pet_listings').insert(payload).select().single();
    }
    return res;
  }
  // 市场在售列表（所有人可见）
  async function fetchMarket() {
    return client.from('pet_listings')
      .select('id,pet_id,seller_id,price,material_type,material_qty,pet_name,pet_growth,pet_level,pet_traits,created_at')
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
    let payload = {
      item_id: eq.cloudId, seller_id: user.id,
      material_type: materialType, material_qty: materialQty,
      item_name: eq.name || '装备', item_slot: eq.slot || '武器',
      item_rarity: rarityId,
      // item_tier 在库中 not null 无默认值，必须显式写入，否则 insert 400（曾导致上架静默失败）
      item_tier: Number(eq.tier) || 4,
      // 市场快照：词缀拍平为扁平数组（展示用，与旧数据形态一致；装备本体仍存嵌套结构）
      item_affixes: Array.isArray(eq.affixes)
        ? eq.affixes
        : [...(eq.affixes.prefix || []), ...(eq.affixes.suffix || [])],
      // 魂铸词缀快照（市场展示；旧库无列则 400 → 兜底重试不带）
      item_soul: eq.soulAffix || null
    };
    let res = await client.from('equip_listings').insert(payload).select().single();
    if (res.error && isMissingPetColumn(res.error) && String(res.error.message || '').indexOf('item_soul') >= 0) {
      delete payload.item_soul;
      res = await client.from('equip_listings').insert(payload).select().single();
    }
    return res;
  }
  // 市场在售装备（所有人可见）
  async function fetchItemMarket() {
    return client.from('equip_listings')
      .select('id,item_id,seller_id,price,material_type,material_qty,item_name,item_slot,item_rarity,item_tier,item_affixes,item_soul,created_at')
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
  // 假买家（系统）购买玩家挂单：调 bot_buy_equip RPC（security definer，
  // 锁单→卖家材料到账（标价-税）→双写交易记录（买家= persona 昵称）→删除装备行）
  // buyerName = 交易记录里显示的买家身份，由调用方从当次会话的 persona 取（见 market.js botBuyerName）
  async function botBuyEquip(listingId, buyerName) {
    return client.rpc('bot_buy_equip', { p_listing_id: listingId, p_buyer_name: buyerName || null });
  }
  async function botBuyPet(listingId, buyerName) {
    return client.rpc('bot_buy_pet', { p_listing_id: listingId, p_buyer_name: buyerName || null });
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

  /* ---------- 材料交易（material_listings 表 + list_material / buy_material / cancel / bot_buy）
   * 万物皆可交易（2026-09-10）：玩家材料也能上架（此前只能买 AI 的货）。
   * 未跑 migrate_material_listings.sql 的库：这里会返回表不存在的错误，
   * UI 侧按「材料上架未开通」降级提示，不影响宠物/装备/蛋交易。 ---------- */
  async function listMaterial(goodName, goodQty, materialType, materialQty) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    return client.rpc('list_material', {
      p_good: goodName, p_good_qty: goodQty,
      p_material_type: materialType, p_material_qty: materialQty
    });
  }
  async function fetchMaterialMarket() {
    return client.from('material_listings')
      .select('id,seller_id,good_name,good_qty,material_type,material_qty,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
  }
  async function fetchMyListedMaterialIds() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('material_listings')
      .select('id,good_name,good_qty').eq('seller_id', user.id).eq('status', 'active');
  }
  async function buyMaterial(listingId) {
    return client.rpc('buy_material', { p_listing_id: listingId });
  }
  async function cancelMaterialListing(listingId) {
    return client.rpc('cancel_material_listing', { p_listing_id: listingId });
  }
  // 假买家（系统）收购玩家材料挂单
  async function botBuyMaterial(listingId, buyerName) {
    return client.rpc('bot_buy_material', { p_listing_id: listingId, p_buyer_name: buyerName || null });
  }

  /* ---------- 交易记录（trade_records 表） ---------- */
  // 当前登录玩家的全部交易记录（买入 + 卖出，按时间倒序）
  async function loadTradeRecords() {
    const user = await getCurrentUser();
    if (!user) return { data: [], error: null };
    return client.from('trade_records')
      .select('id,player_id,role,item_name,material_type,price_qty,tax_qty,net_qty,listing_id,counterparty,created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false });
  }

  // 孵化：消耗一颗指定品种的「未孵化」蛋，标记「已孵化」并关联新宠物。
  async function consumeEgg(baseName, petId) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    // 旧数据兼容：加 egg_type 列之前掉的蛋，egg_type 是 null。
    // loadEggCount 把它们归到通用品种「宠物蛋」显示，所以孵「宠物蛋」时
    // eq(egg_type,'宠物蛋') 必然查不到 → 必须退一步用 is(egg_type, null) 去找，
    // 否则这颗蛋永远孵不掉：本地扣了、云端没标记 → 刷新后蛋又"复活"。
    const wantLegacy = (baseName === '宠物蛋');
    let q = client.from('pet_egg').select('id').eq('owner_id', user.id).eq('status', '未孵化');
    q = wantLegacy ? q.is('egg_type', null) : q.eq('egg_type', baseName);
    const { data, error } = await q
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error('云端没有可孵化的该品种宠物蛋') };
    return client.from('pet_egg')
      .update({ status: '已孵化', pet_id: petId })
      .eq('id', data.id)
      .select().single();
  }
  // 云端未孵化蛋（登录时恢复；云端为权威）。返回 { eggMap, total }
  // eggMap = { '血狐': 2 }；无品种的旧数据归入「宠物蛋」（能正常孵化，见 consumeEgg 的回退查找）。
  async function loadEggCount() {
    const user = await getCurrentUser();
    if (!user) return { data: 0, error: null, eggMap: {} };
    // 这里【不能】加 .not('egg_type','is',null) 过滤掉无品种的蛋：
    // 加 egg_type 列之前掉的蛋是 null，过滤掉它就既不显示也孵不掉，
    // 会永远留在云端当垃圾行（本地刷新后反而像"复活"）。
    // 统一在下面归到通用品种「宠物蛋」（与 Drop.makeEggName(null) 的兜底一致），玩家能正常孵掉。
    const { data, error } = await client.from('pet_egg')
      .select('egg_type').eq('owner_id', user.id).eq('status', '未孵化');
    if (error) return { data: 0, error, eggMap: {} };
    const eggMap = {};
    for (const row of data || []) {
      const key = row.egg_type || '宠物蛋';
      eggMap[key] = (eggMap[key] || 0) + 1;
    }
    const total = Object.values(eggMap).reduce((a, b) => a + b, 0);
    return { data: total, error: null, eggMap };
  }

  // 掉落一颗蛋：写入 pet_egg（未孵化，带品种）。
  // 掉落不该打断战斗结算：这里【绝不抛异常】，失败静默，下次登录以云端为准。
  async function addEgg(baseName) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    try {
      return await client.from('pet_egg')
        .insert({ owner_id: user.id, egg_type: baseName || null, status: '未孵化' })
        .select().single();
    } catch (e) {
      return { data: null, error: e };
    }
  }

  /* ---------- 魔石钱包 / 商店（migrate_shop.sql） ----------
   * 余额与商品都是「前端只读」：加钱靠 redeem_code、扣钱靠 spend_gems，两个都是 security definer 函数。
   * 表还没建（42P01 undefined_table / PGRST205）时不抛异常，返回空结果由界面提示"商店未开通"。 */
  async function getMyWallet() {
    try {
      const { data, error } = await client.rpc('get_my_wallet');
      if (error) return { gems: 0, totalRecharged: 0, error: error.message, missing: isMissingTable(error) };
      const row = (data && data[0]) || null;
      return { gems: (row && row.gems) || 0, totalRecharged: (row && row.total_recharged) || 0, error: null };
    } catch (e) {
      return { gems: 0, totalRecharged: 0, error: e && e.message, missing: true };
    }
  }
  // 我的玩家权益（魔石买的便利类，如市场挂单额度加成）
  // 与钱包同款服务端权威：user_perks 表只有 SELECT 策略，写入只走 spend_gems。
  async function getMyPerks() {
    try {
      const { data, error } = await client.rpc('get_my_perks');
      if (error) return { listing_slots: 0, error: error.message };
      const row = (data && data[0]) || null;
      return { listing_slots: (row && row.listing_slots) || 0, error: null };
    } catch (e) {
      return { listing_slots: 0, error: e && e.message };
    }
  }
  // 卡密兑换：返回 'ok:数量' / 'notfound' / 'used' / 'expired' / 'nologin'
  async function redeemCode(code) {
    const { data, error } = await client.rpc('redeem_code', { p_code: String(code || '').trim() });
    if (error) return { ok: false, code: 'error', message: error.message };
    return { ok: String(data).startsWith('ok'), code: String(data).split(':')[0], gained: Number(String(data).split(':')[1]) || 0, raw: data };
  }
  // 用魔石买商品：clientRef 是幂等键（连点两次也只成一单）
  async function spendGems(sku, clientRef) {
    const { data, error } = await client.rpc('spend_gems', { p_sku: sku, p_client_ref: clientRef });
    if (error) return { ok: false, code: 'error', message: error.message };
    return { ok: data === 'ok', code: String(data) };
  }
  // 商店商品（服务端定价，前端只负责展示）
  async function fetchProducts() {
    try {
      /* ⚠️ select 漏列 = 静默失效（读回来恒 undefined，不报错）：
       * limit_per_user / limit_per_day 曾经没查，导致前端永远不知道商品限购，
       * 玩家只能点了才被服务端弹「已达购买上限」。改这里前先想清楚前端要显示什么。 */
      const { data, error } = await client.from('products')
        .select('sku,title,kind,price_cents,price_gems,gems,bonus_gems,payload,icon,sort,limit_per_user,limit_per_day')
        .eq('active', true)
        .order('sort', { ascending: true });
      if (error) return { data: [], error: error.message, missing: isMissingTable(error) };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e && e.message, missing: true };
    }
  }
  // 我的订单（购买记录）
  async function fetchMyOrders() {
    try {
      const { data, error } = await client.from('orders')
        .select('id,sku,gems,status,provider,created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return { data: [], error: error.message, missing: isMissingTable(error) };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e && e.message, missing: true };
    }
  }
  // 表不存在的错误码：Postgres 42P01 / PostgREST PGRST205
  function isMissingTable(error) {
    const c = error && (error.code || '');
    return c === '42P01' || c === 'PGRST205' || c === '42883'; // 42883 = 函数不存在
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
  // 领取记录在独立的 quest_claims 表（客户端零写权限），本表只存进度，可以整行覆盖。
  // ⚠️ 别再动「只给列级写权限」那套：PostgREST 只认表级 has_table_privilege，
  //    收掉表级 insert/update 会让这里的 upsert 全量 403（2026-09-12 事故，见
  //    migrate_quest_claims_table.sql 文件头）。
  async function saveQuestProgress(progress) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    return client.from('quest_progress')
      .upsert({ user_id: user.id, progress, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }

  /* 读服务端的任务领取记录（2026-09-12 补）：quest_claims 客户端只有 SELECT 权限
   * （写只走 complete_quest RPC），这里只读不改。
   * 为什么要读：领取记录（服务端）与完成状态（本地 quest_progress）不同源。
   *   本地那份一旦丢（写失败 / 换设备 / 清缓存），玩家看到任务「可提交」，
   *   点下去却被服务端以 ALREADY_CLAIMED 拒 —— 永远交不了还一直报错。
   *   所以拉进度时把服务端记录回灌进本地显示状态（见 quest.js applyServerClaims）。 */
  async function fetchQuestClaims() {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: null };
    try {
      // RLS 只放行 user_id = auth.uid() 的行，不必再带 eq
      const { data, error } = await client.from('quest_claims').select('claim_key');
      if (error) return { data: null, error };
      return { data: (data || []).map(r => r.claim_key).filter(Boolean), error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  /* 任务奖励的【服务端领取记录】（2026-09-12）：
   * 本地 quest_progress 的 completed / dailyDone / weeklyDone 客户端可改 ——
   * 清一下就能无限重领任务奖励（材料有 add_material 限流兜着，装备走 saveItem 没有）。
   * 现在由服务端持有「这条任务领过没有」这个判定事实（quest_claims 表，
   * 客户端对它连列都碰不到），本函数就是唯一写入口。
   * periodKey：一次性任务传 ''；日常传当天、周常传本周一（与 quest.js 的 markFinished 同口径）。
   * 返回 'OK' / 'ALREADY_CLAIMED' / 'ERR_NO_LOGIN' … */
  async function completeQuest(questId, periodKey) {
    const user = await getCurrentUser();
    /* 未登录 = 纯本地模式（数据只在本机，换设备就没了，玩家本来就能随便改）→
     * 服务端领取记录无从谈起，【跳过而不是报错】。
     * ⚠️ 这里如果返回 error，会把未登录也拦死 —— 而任务的云进度加载（cloudLoaded）
     *    另有守门，不该由本函数重复拦截。 */
    if (!user) return { data: null, error: null, offline: true };
    return client.rpc('complete_quest', { p_quest_id: questId, p_period_key: periodKey || '' });
  }

  /* ---------- 聊天（chat_messages 表 + Realtime 广播） ---------- */
  // 发送一条聊天消息：把消息写入 chat_messages 表，Realtime 会自动广播给订阅者
  // senderName 由前端传（当前登录用户显示名），message 必须是纯文本（前端已转义防 XSS）
  async function sendChatMessage(senderName, message) {
    const user = await getCurrentUser();
    if (!user) return { data: null, error: new Error('请先登录') };
    if (!message || !String(message).trim()) return { data: null, error: new Error('消息不能为空') };
    return client.from('chat_messages').insert({
      user_id: user.id,
      sender_name: String(senderName || '玩家').slice(0, 20),
      message: String(message).slice(0, 200)
    }).select().single();
  }
  // 读取最近聊天记录（进入游戏先加载历史，limit 默认 50 条）
  async function fetchRecentMessages(limit = 50) {
    return client.from('chat_messages')
      .select('id,user_id,sender_name,message,created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
  }
  /* ---------- 玩家资料 / 昵称 / 封禁（profiles 表） ----------
   * 昵称只在登录时拉一次存内存：auth.getUser() 实测 550ms，绝不能放在发言这种高频路径上。
   * 显示优先级：profiles.nickname > 邮箱前缀（老代码兜底）> '玩家'。
   * 封禁字段（banned / ban_reason）顺带读进缓存：main.js 登录后在进游戏前拦截（见 migrate_security_hardening.sql）。 */
  let profileCache = null; // { id, nickname, banned?, ban_reason? }

  function randomNickname() {
    const n = (window.Config && window.Config.auth && window.Config.auth.nickname) || {};
    const pre = n.prefixes || ['灰烬'];
    const suf = n.suffixes || ['行者'];
    return pre[Math.floor(Math.random() * pre.length)] + suf[Math.floor(Math.random() * suf.length)] +
      String(Math.floor(1000 + Math.random() * 9000));
  }

  // 读自己的昵称与封禁态；没有资料就自动建一个（老账号 / 邮箱验证后首次登录 / 注册时没填）
  async function loadMyProfile() {
    const user = await getCurrentUser();
    if (!user) { profileCache = null; return null; }
    const { data, error } = await client.from('profiles').select('id,nickname,banned,ban_reason').eq('id', user.id).maybeSingle();
    if (!error && data && data.nickname) { profileCache = data; return profileCache; }
    const nick = randomNickname();
    const { data: made, error: e2 } = await client.from('profiles')
      .upsert({ id: user.id, nickname: nick }, { onConflict: 'id' })
      .select('id,nickname,banned,ban_reason').maybeSingle();
    profileCache = (!e2 && made) ? made : { id: user.id, nickname: nick, banned: false, ban_reason: null };
    return profileCache;
  }

  // 设置 / 修改昵称（注册时玩家填的走这里）
  async function setMyNickname(name) {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: '未登录' };
    const n = (window.Config && window.Config.auth && window.Config.auth.nickname) || {};
    const nick = String(name || '').trim().slice(0, n.maxLen || 12);
    if (!nick) return { ok: false, error: '昵称为空' };
    const { data, error } = await client.from('profiles')
      .upsert({ id: user.id, nickname: nick }, { onConflict: 'id' })
      .select('id,nickname').maybeSingle();
    if (error) return { ok: false, error: error.message };
    profileCache = data || { id: user.id, nickname: nick };
    return { ok: true, nickname: profileCache.nickname };
  }

  // 同步读缓存昵称；没缓存返回 null（调用方自己回退到邮箱前缀）
  function getMyDisplayName() {
    return (profileCache && profileCache.nickname) || null;
  }

  // 同步读缓存档案（含封禁态）；未 loadMyProfile 过返回 null（main.js 登录拦截用）
  function getMyProfile() {
    return profileCache;
  }

  /* ---------- 对外 API ---------- */
  window.Supabase = {
    init, getClient, signIn, signUp, signOut, getSession, getCurrentUser,
    // RPC 透传（check_god_synth / check_nirvana 等服务端校验；migrate_god_pet.sql）
    rpc: (fn, args) => client.rpc(fn, args),
    loadPets, fetchPetById, savePet, deletePet, updatePet, petEquipmentToCloud, loadPetEquipment,
    listPet, fetchMarket, fetchMyListedIds, buyPet, cancelPetListing,
    listItem, fetchItemMarket, fetchMyListedItemIds, buyItem, cancelEquipListing, botBuyEquip, botBuyPet,
    fetchItemById, loadTradeRecords,
    consumeEgg, loadEggCount, addEgg,
    getMyWallet, getMyPerks, redeemCode, spendGems, fetchProducts, fetchMyOrders,
    listEgg, fetchEggMarket, fetchMyListedEggIds, buyEgg, cancelEggListing,
    listMaterial, fetchMaterialMarket, fetchMyListedMaterialIds, buyMaterial, cancelMaterialListing, botBuyMaterial,
    fetchQuestProgress, saveQuestProgress, completeQuest, fetchQuestClaims,
    sendChatMessage, fetchRecentMessages, getMyDisplayName,
    loadMyProfile, setMyNickname, getMyProfile
  };
})();
