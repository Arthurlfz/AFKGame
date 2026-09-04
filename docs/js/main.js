/* ============================================================
 * main.js —— 入口与流程控制（最后加载）
 * 职责：
 *  1. 初始化：新玩家选择 8 只基宠之一后创建，绑定「开始/停止自动战斗」按钮
 *  2. 账号流程编排：登录/注册/登出（调用 supabase.js），会话恢复
 *  3. 云端宠物：登录后拉取 pets 表 → 整体替换本地宠物；云端为空则建档
 *  4. 按钮状态机：挂机中（含等待回血）→「停止挂机」；回血中→禁用「恢复中 x%」；空闲满血→「开始自动战斗」
 *  5. 每场结算编排：胜利 → 加经验(可连升) → 掉落 → 刷新 UI（battle 循环在 battle.js）
 *  6. 非战斗回血时钟：每秒驱动 Pet.regenTick
 * 依赖：equipment / pet / drop / battle / ui / supabase（全部）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { createPet, addPet, getActivePet, getPets, getStats, getCurHp, grantExp, expNeed, expFromBattle, regenTick, setActive, setCloudPets, clearPets, petFromRow } = window.Pet;
  const { rollReward, getTotalEquipDrops, clearEggs } = window.Drop;
  const { startAutoBattle, stopAutoBattle, isRunning, isWaitingRecover, getTotalFights } = window.Battle;
  const { renderAll, renderMarket, renderBattleButton, updateStatus, addLog, showLoot, renderStats, setAuthUser } = window.UI;
  const Supabase = window.Supabase;
  const Market = window.Market;
  const Items = window.Items;
  const Materials = window.Materials;
  const Equipment = window.Equipment;
  const MarketBot = window.MarketBot; // 市场冷启动（流浪商人假卖家），可能未加载 → 判空调用

  /* ---------- 累计统计（战斗场数/获得装备数） ---------- */
  function refreshStats() {
    renderStats(getTotalFights(), getTotalEquipDrops());
  }

  /* ---------- 经验 / 等级云端同步 ----------
   * 等级和经验条都要存云端（不然刷新后等级在、经验条清零）。
   * 但每场战斗都写一次太频繁（1~3 秒一场），所以做节流：
   *   平时 15 秒最多写一次；升级 / 停止挂机 / 登出 / 切后台 时立即补写一次。
   */
  const EXP_SYNC_MS = 15000;
  let expSyncTimer = null;
  let expSyncPet = null;
  // immediate=true 立即写云端（升级、停手、登出、切后台）
  function syncPetProgress(pet, immediate) {
    if (!pet || !pet.cloudId) return;
    expSyncPet = pet; // 存引用：节流期间宠物继续升级，写的时候取到的是最新值
    if (immediate) { flushPetProgress(); return; }
    if (expSyncTimer) return; // 已有待触发的定时器，等它即可
    expSyncTimer = setTimeout(flushPetProgress, EXP_SYNC_MS);
  }
  async function flushPetProgress() {
    if (expSyncTimer) { clearTimeout(expSyncTimer); expSyncTimer = null; }
    const pet = expSyncPet;
    if (!pet || !pet.cloudId) return;
    const { error } = await Supabase.updatePet(pet.cloudId, {
      level: pet.level, exp: Math.max(0, Math.round(pet.exp || 0))
    });
    if (error) addLog('⚠️ 进度云端同步失败：' + (error.message || '未知错误'));
  }

  /* ---------- 每场结算（由 battle.js 每场结束调用） ---------- */
  async function handleFightEnd({ win, enemy }) {
    if (win) {
      const pet = getActivePet();
      if (!pet) { renderAll(); refreshStats(); syncButton(); return; } // 出战宠物缺失：不结算，避免写坏经验
      const area = window.Battle.getCurrentArea();
      const xp = expFromBattle(enemy, area); // 经验唯一来源（与怪物 tooltip 预览同源）
      const info = grantExp(pet, xp);
      if (info.leveled) {
        addLog(`✨ ${pet.name} 升级 Lv.${info.newLevel}！经验 +${xp}，属性大幅提升！`);
        if (info.maxed) addLog(`👑 ${pet.name} 已满级（等级上限 Lv.${Config.pet.maxLevel}）`);
        // 升级是大事：等级 + 经验立即写云端，刷新页面都不丢
        syncPetProgress(pet, true);
      } else {
        // 没升级也要存经验，走节流（15 秒一次），避免每场都打一次数据库
        syncPetProgress(pet);
        if (info.maxed) {
          const EP = Config.pet.expPool;
          addLog(info.crystal
            ? `💠 ${pet.name} 满级经验凝成 ${EP.material} ×${info.crystal}（持有 ${Materials.getQuantity(EP.material)}）`
            : `✦ ${pet.name} 已满级，经验 +${xp} 转入经验池（${Math.round(pet.expPool || 0)}/${EP.perCrystal}）`);
        } else {
          addLog(`✦ ${pet.name} 经验 +${xp}（${Math.round(pet.exp)}/${expNeed(pet.level)}）`);
        }
      }
      showLoot(await rollReward(enemy, area)); // 掉率与怪的稀有度倾向都在 config.js；装备登录则写库；area 用于按图掉专属材料
      // 任务进度上报：type=kill 的任务 +1（任务配了 area 的只算该图，没配的任意图都算；
      // petName 供宠物专属任务区分「哪只宠打的」——配了 petName 的任务只认对应宠）
      if (window.Quest && window.Quest.reportType) window.Quest.reportType('kill', 1, { areaId: area ? area.id : null, petName: pet ? pet.name : null });
    }
    renderAll();
    refreshStats();
    syncButton();
  }

  /* ---------- 开局选宠 ---------- */
  let starterPending = false;
  let runtimeStarted = false; // 游戏运行时（市场/挂机/轮询）是否已启动：离线为 false，登录后才 true
  function showStarterPicker() {
    if (getPets().length || starterPending) return;
    starterPending = true;
    const screen = document.getElementById('starter-screen');
    const list = document.getElementById('starter-list');
    const app = document.getElementById('app');
    if (!screen || !list) return;
    if (app) app.style.display = 'none';
    const B = Config.pet.legacyBase || { hp: 100, atk: 20, def: 10, spd: 40 };
    // 立绘优先（与图鉴/战斗同一套 PetSprites），拉不到才退回 emoji
    const artHtml = (name, icon) => {
      const p = window.PetSprites && PetSprites.pathOf ? PetSprites.pathOf(name) : null;
      return p ? `<span class="starter-art"><img src="${p}" alt="${name}" onerror="this.parentNode.innerHTML='&lt;span class=\\'starter-icon\\'&gt;${icon}&lt;/span&gt;'"></span>`
               : `<span class="starter-icon">${icon}</span>`;
    };
    // 开局宠物是"还没建档"的预览对象，属性/定位照样走真实公式与 config，避免展示与实际不符
    const previewOf = (s) => createPet(s.name, s.icon, s.growth,
      s.baseHp || B.hp, s.baseAtk || B.atk, s.baseDef || B.def,
      Config.pet.speeds[s.name] || B.spd || 40, s.name);
    list.innerHTML = `<div class="starter-tip">这是你冒险的第一只伙伴，挑一只顺眼的就行。<b>成长</b>越高后期越强；<b>速度</b>快能先出手；肉（生命/防御高）更耐打。<span class="hint">鼠标悬停看完整属性</span></div>` +
      (Config.pet.starters || []).map((s, i) => {
      // 定位标签直接读 config.petProfiles（每只基宠都写了 role/description），
      // 不要用规则现猜——曾导致 8 只里 6 只都显示「先手刺客 · 速度快」，选宠标签毫无信息量
      const profile = (Config.pet.petProfiles && Config.pet.petProfiles[s.name]) || Config.pet.defaultPetProfile;
      return `<button class="starter-card" data-index="${i}">${artHtml(s.name, s.icon)}<b>${s.name}</b>
        <small>成长 ${Number(s.growth).toFixed(1)}</small>
        <small class="starter-role">${profile.role || '均衡型'}</small></button>`;
    }).join('');
    screen.style.display = 'flex';
    list.querySelectorAll('.starter-card').forEach(btn => {
      // 属性浮窗（与装备 tooltip 同款）：卡片上悬停即显示，不占卡片空间
      const s = Config.pet.starters[Number(btn.dataset.index)];
      if (UI.bindPetTip && s) UI.bindPetTip(btn, previewOf(s));
    });
    list.querySelectorAll('.starter-card').forEach(btn => {
      btn.onclick = async () => {
        if (btn.disabled) return;
        list.querySelectorAll('.starter-card').forEach(b => { b.disabled = true; });
        const S = Config.pet.starters[Number(btn.dataset.index)];
        const B = Config.pet.legacyBase || { hp: 100, atk: 20, def: 10 };
        const pet = addPet(createPet(S.name, S.icon, S.growth, S.baseHp || B.hp, S.baseAtk || B.atk, S.baseDef || B.def, Config.pet.speeds[S.name] || B.spd || 40, S.name));
        setActive(pet.id);
        const user = await Supabase.getCurrentUser();
        if (user) {
          const { data: saved, error } = await Supabase.savePet(pet);
          if (error) addLog('⚠️ 开局宠物云端建档失败：' + (error.message || '未知错误'));
          else if (saved && saved.id) {
            pet.cloudId = saved.id;
            await Supabase.updatePet(pet.cloudId, { is_active: true });
          }
        }
        screen.style.display = 'none';
        starterPending = false;
        // 新号选宠建档完成：直接进入游戏（不重跑 init，避免重复会话探测）
        if (UI.onAuthChange) UI.onAuthChange(true);
        startGameRuntime();
        renderAll();
        refreshStats();
        syncButton();
        startGuideOnboarding(true);   // 新号：选宠完成 → 开场总览 tour → 引导启动
      };
    });
  }

  /* ---------- 新手引导进场（2026-09-03 目标驱动主线） ----------
   * 新号选宠完成 → 开场总览 tour（spotlight 压暗聚光 + 引路人字幕）→ 引导启动：
   *   ① 发引导祝福（手动提速道具，玩家用掉才生效） ② 引导驱动：按任务 boostLevel 发经验包顶等级 / 走完发毕业礼包
   * 老号 / 会话恢复：不弹 tour，只跑引导驱动（补顶等级、走完发礼包）。
   * 全程 try 保护：引导出问题绝不能把人挡在游戏外面。 */
  /* 开场总览看过标记（按账号，只播一次）—— 老号登录也补播一次，否则永远看不到这段引导 */
  function tourSeenKey() {
    const u = (window.UI && window.UI.getAuthUser ? window.UI.getAuthUser() : null) || null;
    const k = (u && (u.email || u.id)) || 'anon';
    return 'fos_tour_seen_' + String(k).replace(/[^a-zA-Z0-9@._-]/g, '');
  }
  function hasSeenTour() {
    try {
      if (localStorage.getItem(tourSeenKey()) === '1') return true;
      // 云端唯一真相：清缓存/换设备后不再打扰（与引导其他标记同规则）
      const Q = window.Quest;
      if (Q && Q.getExtra) return Q.getExtra('tourSeen') === '1';
    } catch (e) { /* 忽略 */ }
    return false;
  }
  function markTourSeen() {
    try { localStorage.setItem(tourSeenKey(), '1'); } catch (e) { /* 忽略 */ }
    try { if (window.Quest && window.Quest.setExtra) window.Quest.setExtra('tourSeen', '1'); } catch (e) { /* 忽略 */ }
  }

  function startGuideOnboarding(withTour) {
    try {
      const TM = window.TutorialMode;
      const t = (window.Config && window.Config.tutorialMode) || {};
      if (!TM || t.enabled === false) return;
      // 引导例行【立刻跑，不等开场总览播完】：
      //   经验包顶等级 / 教学补给（钥匙：白装、蛋、副宠）/ 毕业礼包判断都在这里。
      //   血泪：以前要等 tour 播完才跑 —— 玩家卡在 G5/G6 重登时，tour 没点完就永远拿不到白装/蛋。
      try {
        if (TM.grantInitialBlessing) TM.grantInitialBlessing();
        if (TM.startGuideRoutine) TM.startGuideRoutine();
      } catch (e) { console.warn('[引导] 例行启动失败', e); }
      const steps = t.openingTour || [];
      // 开场总览只是纯展示：没看过就播一次，播完/跳过只记 seen，不再重复触发例行
      if (withTour && steps.length && !hasSeenTour() && window.Onboarding && window.Onboarding.startTour) {
        const seen = function () { try { markTourSeen(); } catch (e) { /* 忽略 */ } };
        // 等主界面排版稳定再播：选宠屏刚关/页面刚切换时，目标元素量到 0 尺寸，聚光框就没了
        window.setTimeout(function () {
          try { window.Onboarding.startTour(steps, { onDone: seen, onSkip: seen }); }
          catch (e) { console.warn('[引导] 开场总览异常', e); seen(); }
        }, 700);
      }
    } catch (e) { console.warn('[引导] 进场异常', e); }
  }

  // 重播开场总览（开发者面板 / 控制台 UI.replayOpeningTour() 可调）
  // 重播是纯预览：播完/点跳过只记「已看过」，绝不触发引导例行（礼包/祝福/补给）——防测试循环
  function replayOpeningTour() {
    const t = (window.Config && window.Config.tutorialMode) || {};
    if (!window.Onboarding || !window.Onboarding.startTour || !t.openingTour) return;
    try { localStorage.removeItem(tourSeenKey()); } catch (e) { /* 忽略 */ }
    const seen = function () { try { markTourSeen(); } catch (e) { /* 忽略 */ } };
    window.Onboarding.startTour(t.openingTour, { onDone: seen, onSkip: seen });
  }
  if (window.UI) window.UI.replayOpeningTour = replayOpeningTour;

  async function clearAccountState() {
    stopAutoBattle();
    flushPetProgress();                                // 登出/切账号前把经验补写云端
    if (MarketBot && MarketBot.stop) MarketBot.stop(); // 离线：停掉流浪商人补货与收购
    runtimeStarted = false;                            // 允许下次登录重新启动运行时
    clearPets();
    Items.setCloudItems([]);
    // 材料要先补报再清空：gain 现在只入队不上传，直接清会把当前号刚掉的收益丢掉。
    // clearAll 内部会先 flush（把队列报给当前号），再清空本地与队列，换号不会串。
    await Materials.clearAll();
    clearEggs();
    starterPending = false;
    if (window.Quest && window.Quest.reset) window.Quest.reset(); // 清空旧号任务进度
    const starterScreen = document.getElementById('starter-screen');
    if (starterScreen) starterScreen.style.display = 'none';
  }

  /* ---------- 云端宠物恢复 ---------- */
  // 拉取当前玩家宠物列表：云端权威。登录成功后先清空本地残留（避免换号时旧宠物干扰选宠判断），
  // 再以云端为准：云端有宠→恢复；云端无宠→新号，弹开局选宠。
  async function restoreCloudPets() {
    const user = await Supabase.getCurrentUser();
    setAuthUser(user);
    if (!user) {
      // 未登录：不弹选宠（还没建账号，选了也存不了）；由登录/注册成功后重新走 restoreCloudPets 判定
      return;
    }
    // 已登录：以云端为准，清空本地残留宠物
    clearPets();
    // 任务进度和宠物一样是登录后必拉的状态，且必须 await 完再往下走：
    // 进度没到手就允许交任务，等于拿「空历史」整行覆盖云端，把以前交过的任务全抹成未完成。
    if (window.Quest && window.Quest.loadCloudProgress) await window.Quest.loadCloudProgress();
    const { data, error } = await Supabase.loadPets();
    if (error) {
      addLog('⚠️ 读取云端宠物失败：' + (error.message || '未知错误'));
      // 云端读取失败：为避免卡死，给一个进入游戏的机会（无宠物时走选宠）
      if (!getPets().length) showStarterPicker();
      return;
    }
    if (data && data.length) {
      setCloudPets(data);
      const active = getActivePet();
      if (active) addLog(`☁️ 已从云端读取 ${data.length} 只宠物，出战 ${active.name}`);
    } else {
      // 云端无宠物 = 新号：弹开局选宠（选完建档），不再走"本地残留宠物建档"逻辑
      showStarterPicker();
      return;
    }
    // 已登录且有宠物：会话恢复（init）路径在此启动游戏运行时
    if (UI.onAuthChange) UI.onAuthChange(true);
    startGameRuntime();
    renderAll();
    refreshStats();
    syncButton();
    // 注意：startGuideOnboarding 不在这里调——要等 restoreAllCloudData 把云装备/蛋/材料
    // 全拉完再跑引导例行（补给按库存差量补齐，背包/蛋还没 load 完会误判成空而乱补发）。
  }

  /* ---------- 重新拉取云端宠物（购买后调用，新宠物进列表） ---------- */
  async function refreshPets() {
    const { data, error } = await Supabase.loadPets();
    if (error) { addLog('⚠️ 刷新宠物失败：' + error.message); return; }
    if (data) setCloudPets(data);
    renderAll();
    refreshStats();
    syncButton();
  }

  /* ---------- 购买后单条追加宠物（性能优化：只拉新宠物那一条，不全量重读） ---------- */
  // 若单条查询失败（极端情况）则回退全量刷新兜底
  async function afterBuyPet(petId) {
    if (!petId) { await refreshPets(); return; }
    const { data, error } = await Supabase.fetchPetById(petId);
    if (error || !data) { addLog('⚠️ 读取新宠物失败，已刷新列表'); await refreshPets(); return; }
    // 防重复：cloudId 已存在则不重复添加
    if (!getPets().some(p => p.cloudId === data.id)) {
      addPet(Pet.petFromRow(data));
      addLog(`🐾 买到的宠物已入列：${data.name}（成长 ${data.growth}）`);
    }
    renderAll();
    refreshStats();
    syncButton();
  }

  /* ---------- 重新拉取云端装备（购买装备后调用） ---------- */
  async function refreshItems() {
    const { data, error } = await Items.loadCloudItems();
    if (error) { addLog('⚠️ 刷新装备失败：' + error.message); return; }
    if (data) Items.setCloudItems(data);
    renderAll();
  }

  /* ---------- 购买后单条追加装备（性能优化：只拉新装备那一条，不全量重读） ---------- */
  async function afterBuyItem(itemId) {
    if (!itemId) { await refreshItems(); return; }
    const { data, error } = await Supabase.fetchItemById(itemId);
    if (error || !data) { addLog('⚠️ 读取新装备失败，已刷新背包'); await refreshItems(); return; }
    if (!Equipment.getInventory().some(eq => eq.cloudId === data.id)) {
      Equipment.addToInventory(Items.fromCloud(data));
      addLog(`🎒 买到的装备已入包：${data.name}`);
    }
    renderAll();
  }

  /* ---------- 云端装备恢复（登录后） ---------- */
  // 云端存档是账号边界：登录时仅恢复当前账号的装备，绝不把前一个账号的内存装备写入当前账号。
  async function restoreCloudItems() {
    const user = await Supabase.getCurrentUser();
    if (!user) return;
    const { data, error } = await Items.loadCloudItems();
    if (error) { addLog('⚠️ 读取云端装备失败：' + (error.message || '未知错误')); return; }
    Items.setCloudItems(data || []);
    await restorePetEquipment(); // 背包就绪后，把各宠物身上的装备按 cloudId 挂回去
    renderAll();
  }

  /* ---------- 宠物装备槽恢复（背包加载完后调用，F5 后装备不脱落） ----------
   * 云端只存 { 部位: 装备cloudId } 引用，装备本体在 equip_items（背包）。
   * 装备槽单独读（loadPetEquipment），兼容旧库缺列时退化为空槽，不影响宠物本体。
   */
  async function restorePetEquipment() {
    if (!window.Pet || !window.Pet.restoreEquipment || !Supabase.loadPetEquipment) return;
    const inv = window.Equipment.getInventory();
    const slots = (window.Equipment && window.Equipment.SLOTS) || [];
    // 并发拉：原来逐个 await，N 只宠物 = N × 340ms 串行等待（10 只宠就是 3.4 秒）。
    // 各宠物的装备槽互不依赖，并发后只花一次往返的时间。
    const pets = getPets().filter(p => p.cloudId);
    const maps = await Promise.all(pets.map(p => Supabase.loadPetEquipment(p.cloudId)));
    pets.forEach((pet, i) => {
      const eqMap = maps[i];
      // 按 12 个部位整体重建（而不是整体替换成云端那份）：云端没存过时也保留完整槽位结构
      pet.equipment = Object.fromEntries(slots.map(s => [s, null]));
      for (const [slot, cid] of Object.entries(eqMap || {})) {
        if (cid && slot in pet.equipment) pet.equipment[slot] = { cloudId: cid };
      }
      window.Pet.restoreEquipment(pet, inv);
    });
  }

  /* ---------- 云端材料恢复（登录后：拉取替换本地计数） ---------- */
  async function restoreCloudMaterials() {
    const user = await Supabase.getCurrentUser();
    if (!user) return;
    const { data, error } = await Materials.loadCloudMaterials();
    if (error) { addLog('⚠️ 读取云端材料失败：' + (error.message || '未知错误')); return; }
    Materials.setCloudMaterials(data || []);
    renderAll();
  }

  /* ---------- 云端宠物蛋恢复（登录后：以云端 pet_egg 按品种为权威） ---------- */
  async function restoreCloudEggs() {
    const user = await Supabase.getCurrentUser();
    if (!user) return;
    const { error, eggMap } = await Supabase.loadEggCount();
    if (error) { addLog('⚠️ 读取云端宠物蛋失败：' + (error.message || '未知错误')); return; }
    // 必须按品种整体恢复：只恢复总数的话，所有蛋会被摊成一个通用品种，
    // 刷新后品种（血狐/骨狼…）丢失，界面会显示成"宠物蛋蛋"。
    Drop.setEggs(eggMap || {});
  }
  /* ---------- 账号流程（供 UI 按钮回调） ---------- */
  // 登录 / 会话恢复的公共收尾：先拉云端宠物，再并发拉装备 / 材料 / 蛋 / 市场。
  // restoreCloudPets 必须单独先走，两个原因：
  //   ① 它决定是不是新号（云端无宠 → 弹选宠，不能往下走）
  //   ② 装备槽恢复要按宠物 cloudId 逐只查，依赖宠物列表已就位
  // 其余四者互不依赖：串行 = 付 4 次 340ms，并发只付一次。
  // 四个 restore 内部都是「失败只 addLog 不抛」，所以 Promise.all 安全。
  // 返回 false = 新号还没宠物，调用方不要启动运行时。
  async function restoreAllCloudData() {
    await restoreCloudPets();
    if (!getPets().length) return false;
    await Promise.all([
      restoreCloudItems(), restoreCloudMaterials(), restoreCloudEggs(), Market.refresh()
    ]);
    // 魔石钱包 / 商店商品：失败只提示（表没建时界面自己显示"未开通"），不能挡住进游戏
    if (UI.refreshShop) { try { await UI.refreshShop(); } catch (e) { console.warn('商店数据加载失败：', e && e.message); } }
    // 云装备/蛋/材料/宠物已全部就位 → 现在跑引导例行（经验包+钥匙补给，reconcile 不会误判）
    startGuideOnboarding(true);
    return true;
  }

  // 封禁拦截（profiles.banned，见 migrate_security_hardening.sql）：封禁号不启动游戏运行时，
  // 登出并留在登录页。返回 true = 已拦截，调用方应立即 return。
  async function blockBannedAccount() {
    const profile = (Supabase.getMyProfile && Supabase.getMyProfile()) || null;
    if (!profile || !profile.banned) return false;
    const reason = profile.ban_reason ? `（${profile.ban_reason}）` : '';
    addLog(`⛔ 账号已被封禁${reason}，如有疑问请联系管理员`);
    setAuthUser(null);
    await Supabase.signOut().catch(() => {});
    await clearAccountState();
    if (UI.onAuthChange) UI.onAuthChange(false);
    return true;
  }

  // 登录/注册成功后的统一收尾
  async function onAuthenticated() {
    // 昵称+封禁态：登录/注册成功后拉一次存内存（后面聊天显示全部读缓存，不再打接口）
    if (Supabase.loadMyProfile) { try { await Supabase.loadMyProfile(); } catch (e) { /* 昵称失败不挡进游戏 */ } }
    // 封禁号在恢复云端数据前就拦下（不读数据、不启动运行时）
    if (await blockBannedAccount()) return;
    // 落地注册时填的昵称：开了邮箱验证的号，注册后没 session 写不进库，登录成功后再补
    if (Supabase.setMyNickname) {
      try {
        const pending = localStorage.getItem('fos_pending_nickname');
        if (pending) { await Supabase.setMyNickname(pending); localStorage.removeItem('fos_pending_nickname'); }
      } catch (e) { /* 暂存昵称写不进也不挡进游戏 */ }
    }
    const ready = await restoreAllCloudData();
    if (!ready) return; // 新号：等 showStarterPicker 选完宠再启动运行时
    startGameRuntime();
    renderAll();
  }
  async function onLogin(email, password) {
    if (!email || !password) {
      const error = { message: '请输入邮箱和密码' };
      addLog('❌ 登录失败：' + error.message);
      return { error };
    }
    const { error } = await Supabase.signIn(email, password);
    if (error) { addLog('❌ 登录失败：' + (error.message || '未知错误')); return { error }; }
    await clearAccountState();
    addLog('☁️ 登录成功');
    await onAuthenticated();
    return { error: null };
  }
  async function onSignup(email, password, nickname) {
    if (!email || !password) {
      const error = { message: '请输入邮箱和密码' };
      addLog('❌ 注册失败：' + error.message);
      return { error };
    }
    const a = (window.Config && window.Config.auth) || {};
    if (password.length < (a.pwdMinLen || 6)) {
      const error = { message: '密码至少 ' + (a.pwdMinLen || 6) + ' 位' };
      addLog('❌ 注册失败：' + error.message);
      return { error };
    }
    if (a.pwdRequireLetter && !/[A-Za-z]/.test(password)) {
      const error = { message: '密码需包含字母' };
      addLog('❌ 注册失败：' + error.message);
      return { error };
    }
    if (a.pwdRequireDigit && !/[0-9]/.test(password)) {
      const error = { message: '密码需包含数字' };
      addLog('❌ 注册失败：' + error.message);
      return { error };
    }
    const { data, error } = await Supabase.signUp(email, password);
    if (error) { addLog('❌ 注册失败：' + (error.message || '未知错误')); return { error }; }
    // 暂存昵称：无论邮箱验证是否开启，验证后登录都会经 onAuthenticated 落地（clearAccountState 不清 localStorage）
    if (nickname) { try { localStorage.setItem('fos_pending_nickname', nickname); } catch (e) {} }
    if (!data.session) { // 项目开了邮箱验证 → 没有自动登录
      addLog('⚠️ 注册成功：若需邮箱验证，请先去邮箱确认，再回来登录');
      return { error: null, needsEmailConfirm: true };
    }
    await clearAccountState();
    addLog('☁️ 注册成功并已登录');
    // 玩家填了昵称就写库；没填由 loadMyProfile 自动生成
    if (nickname && Supabase.setMyNickname) {
      const r = await Supabase.setMyNickname(nickname);
      if (!r.ok) addLog('⚠️ 昵称保存失败：' + (r.error || '未知错误'));
    }
    await onAuthenticated();
    return { error: null };
  }
  async function onLogout() {
    const { error } = await Supabase.signOut();
    await clearAccountState();
    setAuthUser(null);
    if (error) addLog('⚠️ 登出失败：' + (error.message || '未知错误'));
    else addLog('👋 已登出');
    renderAll();
    syncButton();
  }

  /* ---------- 按钮状态机 ---------- */
  // 挂机中（含等待回血）→「停止挂机」；血量不满→禁用「恢复中 x%」；空闲满血→「开始自动战斗」
  function syncButton() {
    if (isRunning()) {
      renderBattleButton('停止挂机', false);
      return;
    }
    const pet = getActivePet();
    if (!pet) { renderBattleButton('开始自动战斗', true); return; } // 登出/换号后没有出战宠：按钮禁用，别让 getStats(null) 抛错中断登出流程
    const maxHp = getStats(pet).hp, cur = getCurHp(pet);
    if (cur >= maxHp) {
      renderBattleButton('开始自动战斗', false);
    } else {
      renderBattleButton(`恢复中 ${Math.round(cur / maxHp * 100)}%`, true);
    }
  }

  /* ---------- 游戏运行时（仅登录后启动，离线不运行） ---------- */
  function startGameRuntime() {
    if (runtimeStarted) return;          // 防重入：会话恢复与 onAuthenticated 都可能会调
    runtimeStarted = true;
    if (MarketBot) MarketBot.start();    // 市场冷启动：流浪商人自动挂单 + 定时补货
    if (window.UI && window.UI.initChat) window.UI.initChat();  // 登录后加载聊天历史 + 订阅实时消息

    const battleBtn = document.getElementById('btn-battle');
    if (battleBtn) battleBtn.addEventListener('click', () => {
      if (isRunning()) {
        stopAutoBattle();                // 挂机中 → 手动停止
        flushPetProgress();              // 停手时把攒的经验补写云端（否则要等下一次节流）
      } else if (getCurHp(getActivePet()) >= getStats(getActivePet()).hp) {
        if (!window.Battle.getCurrentArea()) {
          addLog('⚠️ 请先选择挂机地图。');
          return;
        }
        startAutoBattle(handleFightEnd); // 满血才允许开始
      }
      syncButton();
    });

    // 切后台 / 关标签页前补写一次经验
    // （beforeunload 里的异步请求常被浏览器掐掉，visibilitychange 更可靠）
    // （beforeunload 里的异步请求常被浏览器掐掉，visibilitychange 更可靠）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      flushPetProgress();
      // 掉落攒着还没上报的材料：切后台/关标签页前补一次，否则这批收益会丢
      if (Materials.flushMaterials) Materials.flushMaterials();
    });

    // 非战斗回血时钟（每秒驱动一次；挂机中「等待回血」状态也回血，回满后 battle 自动继续）
    // 2026-09-03：改成按真实流逝秒数补血（dtSec）——浏览器切后台节流到 1 次/分钟时，
    // 后台一秒一秒回血会慢 60 倍，回血时钟也跟着停摆；用 dt 补偿后回血速度与前台一致。
    let lastRegenTs = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dtSec = Math.min(Math.max(0.1, (now - lastRegenTs) / 1000), 60); // 封顶 60 秒/次
      lastRegenTs = now;
      if (isRunning() && !isWaitingRecover()) return;
      const pet = getActivePet();
      if (!pet) return;
      if (regenTick(pet, dtSec)) renderAll();
      const maxHp = getStats(pet).hp;
      updateStatus(getCurHp(pet) < maxHp ? 'healing' : 'idle', 0);
      syncButton();
    }, 1000);

    // 市场轮询：每 5 秒刷新一次在售列表与交易记录
    setInterval(async () => {
      const before = Market.getListings().length + Market.getItemListings().length;
      const beforeRec = Market.getTradeRecords().length;
      await Market.refresh();
      const after = Market.getListings().length + Market.getItemListings().length;
      if (after !== before || Market.getTradeRecords().length !== beforeRec) renderAll();
    }, 5000);

    updateStatus('idle', 0);
    renderAll();
    refreshStats();
    syncButton();
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    // 仅做 Supabase 会话探测与登录页绑定；游戏运行时（市场/挂机/轮询）一律登录后才启动。
    // 离线（无有效会话）时除登录页外不运行任何游戏逻辑，避免“离线游玩”。
    Supabase.init();
    try {
      // 会话探测是唯一必须问服务器的路径：页面可能开了很久，本地 JWT 看着还在，
      // 实际已被服务端判为失效。这里必须走 getUser() 二次确认（force=true），
      // 否则会拿着过期 token 去读云端宠物 → 读不到 → 退回初始莱姆（历史 bug）。
      // 其余所有 getCurrentUser() 调用都走本地 session（0ms），不再付这 550ms。
      const user = await Supabase.getCurrentUser(true);
      setAuthUser(user);
      if (!user) {
        // 未登录：仅展示登录页，不启动任何游戏循环
        if (UI.onAuthChange) UI.onAuthChange(false);
        return;
      }
      // 已有会话（刷新/自动恢复）：先拉档案确认没被封禁，再走正常恢复并启动运行时
      if (Supabase.loadMyProfile) { try { await Supabase.loadMyProfile(); } catch (e) { /* 忽略 */ } }
      if (await blockBannedAccount()) return;
      const ready = await restoreAllCloudData();
      if (!ready) return;     // 新号需先选宠，选完在 showStarterPicker 里启动运行时
      startGameRuntime();
    } catch (err) {
      if (window.console && console.warn) console.warn('[初始化] 云端恢复失败，停留在登录页：', err);
      if (UI.onAuthChange) UI.onAuthChange(false);
    }
  }

  window.Game = { init, onLogin, onSignup, onLogout, refreshPets, refreshItems, restorePetEquipment, afterBuyPet, afterBuyItem, startGameRuntime };
  init();
})();
