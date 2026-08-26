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
  const { randInt } = window.Util;
  const { createPet, addPet, getActivePet, getPets, getStats, getCurHp, grantExp, regenTick, setActive, setCloudPets, clearPets, petFromRow } = window.Pet;
  const { rollReward, getTotalEquipDrops, setEggCount } = window.Drop;
  const { startAutoBattle, stopAutoBattle, isRunning, isWaitingRecover, getTotalFights } = window.Battle;
  const { renderAll, renderMarket, renderBattleButton, updateStatus, addLog, showLoot, renderStats, showToast, setAuthUser } = window.UI;
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

  /* ---------- 每场结算（由 battle.js 每场结束调用） ---------- */
  async function handleFightEnd({ win, enemy }) {
    if (win) {
      const pet = getActivePet();
      const P = Config.exp.perWin;
      const xp = Math.round(randInt(P.min, P.max) * Config.exp.rate); // 每胜经验 × 全局倍率
      const info = grantExp(pet, xp);
      if (info.leveled) {
        addLog(`✨ ${pet.name} 升级到 Lv.${info.newLevel}！属性大幅提升！`);
        if (info.maxed) addLog(`👑 ${pet.name} 已达到等级上限 Lv.${Config.pet.maxLevel}！`);
        // 等级持久化：升级后同步云端 level，刷新页面等级不丢
        // （config 经验倍率只影响攒经验速度，不影响已保存的等级）
        if (pet.cloudId) {
          const { error } = await Supabase.updatePet(pet.cloudId, { level: pet.level });
          if (error) addLog('⚠️ 等级云端同步失败：' + (error.message || '未知错误'));
        }
      }
      showLoot(await rollReward(enemy, window.Battle.getCurrentArea())); // 掉率与怪的稀有度倾向都在 config.js；装备登录则写库；area 用于按图掉专属材料
      // 任务进度上报：当前图的 type=kill 任务进度 +1（打怪类任务）
      const curArea = window.Battle.getCurrentArea();
      if (curArea) {
        (Config.drop.quests || []).forEach(q => {
          if (q.type === 'kill' && q.area === curArea.id && window.Quest) window.Quest.report(q.id, 1);
        });
      }
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
    list.innerHTML = `<div class="starter-tip">这是你冒险的第一只伙伴，挑一只顺眼的就行。<b>成长</b>越高后期越强；<b>速度</b>快能先出手；肉（生命/防御高）更耐打。</div>` +
      (Config.pet.starters || []).map((s, i) => {
      const spd = Config.pet.speeds[s.name] || B.spd || 40;
      // 用 Lv.1 真实属性展示（每只基宠差异化 baseHp/baseAtk/baseDef），让新玩家看清定位
      const st = getStats(createPet(s.name, s.icon, s.growth, s.baseHp || B.hp, s.baseAtk || B.atk, s.baseDef || B.def, spd));
      // 大白话定位：按成长/速度/肉度给一句标签，帮新手做选择
      const role = s.growth >= 5.5 ? '后期猛将 · 成长超高' : (spd >= 55 ? '先手刺客 · 速度快' : (st.hp >= 120 ? '肉盾前排 · 很耐打' : '均衡好上手'));
      return `<button class="starter-card" data-index="${i}"><span class="starter-icon">${s.icon}</span><b>${s.name}</b>
        <small>成长 ${Number(s.growth).toFixed(1)}</small>
        <small class="starter-role">${role}</small>
        <small class="starter-stats">生命 ${Math.round(st.hp)} · 攻击 ${Math.round(st.atk)}<br>防御 ${Math.round(st.def)} · 速度 ${Math.round(st.spd)}</small></button>`;
    }).join('');
    screen.style.display = 'flex';
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
      };
    });
  }

  function clearAccountState() {
    stopAutoBattle();
    if (MarketBot && MarketBot.stop) MarketBot.stop(); // 离线：停掉流浪商人补货与收购
    runtimeStarted = false;                            // 允许下次登录重新启动运行时
    clearPets();
    Items.setCloudItems([]);
    Materials.setCloudMaterials([]);
    setEggCount(0);
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
      // 登录后拉云端任务进度（evolve/kill 类）
      if (window.Quest && window.Quest.loadCloudProgress) window.Quest.loadCloudProgress();
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
    renderAll();
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

  /* ---------- 云端宠物蛋恢复（登录后：以云端 pet_egg 数量为权威） ---------- */
  async function restoreCloudEggs() {
    const user = await Supabase.getCurrentUser();
    if (!user) return;
    const { data, error } = await Supabase.loadEggCount();
    if (error) { addLog('⚠️ 读取云端宠物蛋失败：' + (error.message || '未知错误')); return; }
    Drop.setEggCount(data || 0);
  }
  /* ---------- 账号流程（供 UI 按钮回调） ---------- */
  // 登录/注册成功后的统一收尾：恢复云端宠物 + 云端装备 + 云端材料 + 云端宠物蛋
  async function onAuthenticated() {
    await restoreCloudPets();
    if (!getPets().length) return;
    await restoreCloudItems();
    await restoreCloudMaterials();
    await restoreCloudEggs();
    await Market.refresh();
    startGameRuntime();
    renderAll();
  }
  async function onLogin(email, password) {
    if (!email || !password) {
      const error = { message: '请输入邮箱和密码' };
      showToast('❌ 登录失败', error.message);
      return { error };
    }
    const { error } = await Supabase.signIn(email, password);
    if (error) { showToast('❌ 登录失败', error.message); return { error }; }
    clearAccountState();
    addLog('☁️ 登录成功');
    await onAuthenticated();
    return { error: null };
  }
  async function onSignup(email, password) {
    if (!email || !password) {
      const error = { message: '请输入邮箱和密码' };
      showToast('❌ 注册失败', error.message);
      return { error };
    }
    if (password.length < 6) {
      const error = { message: '密码至少 6 位' };
      showToast('❌ 注册失败', error.message);
      return { error };
    }
    const { data, error } = await Supabase.signUp(email, password);
    if (error) { showToast('❌ 注册失败', error.message); return { error }; }
    if (!data.session) { // 项目开了邮箱验证 → 没有自动登录
      showToast('⚠️ 注册成功', '若需邮箱验证，请先去邮箱确认，再回来登录');
      return { error: null, needsEmailConfirm: true };
    }
    clearAccountState();
    addLog('☁️ 注册成功并已登录');
    await onAuthenticated();
    return { error: null };
  }
  async function onLogout() {
    const { error } = await Supabase.signOut();
    clearAccountState();
    setAuthUser(null);
    if (error) showToast('⚠️ 登出失败', error.message);
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

    const battleBtn = document.getElementById('btn-battle');
    if (battleBtn) battleBtn.addEventListener('click', () => {
      if (isRunning()) {
        stopAutoBattle();                // 挂机中 → 手动停止
      } else if (getCurHp(getActivePet()) >= getStats(getActivePet()).hp) {
        if (!window.Battle.getCurrentArea()) {
          addLog('⚠️ 请先选择挂机地图。', false, true);
          return;
        }
        startAutoBattle(handleFightEnd); // 满血才允许开始
      }
      syncButton();
    });

    // 非战斗回血时钟（每秒驱动一次；挂机中「等待回血」状态也回血，回满后 battle 自动继续）
    setInterval(() => {
      if (isRunning() && !isWaitingRecover()) return;
      const pet = getActivePet();
      if (!pet) return;
      if (regenTick(pet, 1)) renderAll();
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
      const user = await Supabase.getCurrentUser();
      setAuthUser(user);
      if (!user) {
        // 未登录：仅展示登录页，不启动任何游戏循环
        if (UI.onAuthChange) UI.onAuthChange(false);
        return;
      }
      // 已有会话（刷新/自动恢复）：走正常恢复并启动运行时
      await restoreCloudPets();
      if (!getPets().length) return;     // 新号需先选宠，选完在 showStarterPicker 里启动运行时
      await restoreCloudItems();
      await restoreCloudMaterials();
      await restoreCloudEggs();
      await Market.refresh();
      startGameRuntime();
    } catch (err) {
      if (window.console && console.warn) console.warn('[初始化] 云端恢复失败，停留在登录页：', err);
      if (UI.onAuthChange) UI.onAuthChange(false);
    }
  }

  window.Game = { init, onLogin, onSignup, onLogout, refreshPets, refreshItems, afterBuyPet, afterBuyItem, startGameRuntime };
  init();
})();
