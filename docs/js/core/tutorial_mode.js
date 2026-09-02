/* ============================================================
 * core/tutorial_mode.js —— 新手引导驱动（任务系统形态）
 * 2026-09-02 改版（用户拍板：引导 = 任务系统，不要弹窗/高亮/HUD）：
 *   - 引导载体 = 新手链任务（config.drop.quests 里 category='tutorial'）+ 顶部引导条
 *   - 引导段 = isGuide 标记的任务（t1~t10，到涅槃为止）；t13 魂铸已转主线（2026-09-02 拍板）
 *   - 引导段进行中：自动进入「加速模式」（经验×6 / 战斗提速 / 掉率提升 / 合成20·涅槃30）
 *   - 每进入一个新引导任务：自动发该任务的教学补给（grants，防卡手）
 *   - 引导段全部完成：退出加速 + 发新手礼包（绑定账号，仅一次）
 * 职责：
 *  1. enter()/exit()：临时覆盖/还原 Config 加速数值（只改配置，不动玩法逻辑）
 *  2. bindUser()：状态按账号隔离（换号/注册新号各自独立，防止旧号状态污染）
 *  3. hasClaimedPack()/markClaimedPack()：新手礼包已领标记（按账号，防重复领）
 *  4. checkGuide()：引导驱动核心 —— 检测当前引导任务 → 进加速 + 发补给；完成 → 退加速 + 发礼包
 *  5. grantStarterPack()：新手礼包发放（全部绑定，不可交易/上架/赠送）
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;

  let active = false;
  const saved = {};   // 被覆盖的正式值，exit 时还原

  /* ---------- 读取教程配置（容错：配置段缺失时用安全默认，不崩） ---------- */
  const TM = () => Config.tutorialMode || {};

  /* ---------- 账号隔离：state key 按邮箱区分 ----------
   * 早期用固定 key：主号点过"跳过"后，注册新小号 → 读到旧 asked=true → 新号没引导。
   * 现在 setAuthUser 调 bindUser(email) 切换 key，换号各自独立。 */
  let userKey = '';
  function bindUser(email) {
    userKey = email ? String(email).replace(/[^a-zA-Z0-9@._-]/g, '') : '';
  }
  const packKey = () => 'fos_pack_claimed'+ (userKey ? '_'+ userKey : '');
  const grantKey = () => 'fos_grants_done'+ (userKey ? '_'+ userKey : '');
  // 2026-09-02 Q6 修复：老账号白拿礼包 —— 只有真正走过引导的账号才发礼包。
  // started 标记在进入第一个引导任务时打（本地 + 云端双写，云端防换设备/清缓存丢失）。
  const startedKey = () => 'fos_tutorial_started'+ (userKey ? '_'+ userKey : '');
  function readStarted() {
    try {
      if (localStorage.getItem(startedKey()) === '1') return true;
      return !!(window.Quest && window.Quest.getExtra && window.Quest.getExtra('tutorialStarted'));
    } catch (e) { return false; }
  }
  function markStarted() {
    try { localStorage.setItem(startedKey(), '1'); } catch (e) { /* 忽略 */ }
    if (window.Quest && window.Quest.setExtra) window.Quest.setExtra('tutorialStarted', 1);
  }

  /* ---------- 进入 / 退出加速模式 ---------- */
  function enter() {
    if (active) return true;
    const t = TM();
    if (!t || t.enabled === false) return false;
    saved.expRate = Config.exp.rate;
    saved.speedScale = Config.battle.speedScale;
    saved.dropPool = Config.drop.pool;
    saved.synMin = Config.synthesize.minLevel;
    saved.nirMin = Config.nirvana.minLevel;

    Config.exp.rate = Number(t.expRate) || 1;
    Config.battle.speedScale = Math.max(1, (Config.battle.speedScale || 12) / (Number(t.fightSpeedMult) || 1));
    if (t.dropPool) Config.drop.pool = Object.assign({}, t.dropPool);
    if (t.levelGate) {
      if (t.levelGate.synthesize) Config.synthesize.minLevel = t.levelGate.synthesize;
      if (t.levelGate.nirvana) Config.nirvana.minLevel = t.levelGate.nirvana;
    }
    active = true;
    return true;
  }
  function exit() {
    if (saved.expRate != null) Config.exp.rate = saved.expRate;
    if (saved.speedScale != null) Config.battle.speedScale = saved.speedScale;
    if (saved.dropPool != null) Config.drop.pool = saved.dropPool;
    if (saved.synMin != null) Config.synthesize.minLevel = saved.synMin;
    if (saved.nirMin != null) Config.nirvana.minLevel = saved.nirMin;
    active = false;
    return true;
  }
  const isActive = () => active;

  /* ---------- 新手礼包已领标记（按账号） ---------- */
  function hasClaimedPack() {
    try {
      if (localStorage.getItem(packKey()) === '1') return true;
      // 云端标记：换设备/清缓存后仍能防重复领（2026-09-02 Q6 修复）
      return !!(window.Quest && window.Quest.getExtra && window.Quest.getExtra('packClaimed'));
    } catch (e) { return false; }
  }
  function markClaimedPack() {
    try { localStorage.setItem(packKey(), '1'); } catch (e) { /* 忽略 */ }
    if (window.Quest && window.Quest.setExtra) window.Quest.setExtra('packClaimed', 1);
  }

  /* ---------- 当前该做的引导任务 ----------
   * 新手链里第一个「未完成 && isGuide」的任务（引导段 t1~t10）。
   * t13 魂铸已转主线（2026-09-02 拍板：只教到涅槃），不参与加速引导。 */
  function currentGuideTask() {
    const quests = Config.drop && Config.drop.quests ? Config.drop.quests : [];
    for (const q of quests) {
      if (q.category !== 'tutorial'|| !q.isGuide) continue;
      if (window.Quest && window.Quest.isFinished ? window.Quest.isFinished(q) : false) continue;
      // 未完成且已解锁 → 当前引导任务
      if (window.Quest && window.Quest.isUnlocked ? window.Quest.isUnlocked(q) : true) return q;
    }
    return null;
  }
  function guideAllDone() {
    const quests = Config.drop && Config.drop.quests ? Config.drop.quests : [];
    return quests.every(q => q.category !== 'tutorial'|| !q.isGuide ||
      (window.Quest && window.Quest.isFinished ? window.Quest.isFinished(q) : true));
  }

  /* ---------- 加速道具「引导祝福」（2026-09-02 用户拍板：加速=绑定道具，用掉才生效） ----------
   * 规则：
   *  - 开局（选宠进入引导时）送 1 个（grantInitialBlessing，账号幂等）
   *  - 玩家使用（useBlessing）→ 扣 1 个 → 记录起始时间 → 进加速，持续 durationMin 分钟
   *  - 到期（buffExpired）自动 exit 恢复正式节奏
   *  - 绑定：不进 market.js 白名单 → 不可上架交易
   * 时长：主用 Config.tutorialMode.blessing.durationMin，兼容旧 buffDurationMin；0 = 不限时。 */
  const buffKey = () => 'fos_buff_start'+ (userKey ? '_'+ userKey : '');
  const blessingGivenKey = () => 'fos_blessing_given'+ (userKey ? '_'+ userKey : '');
  const blessingName = () => (TM().blessing && TM().blessing.name) || '引导祝福';
  const blessingDurationMin = () => {
    const b = TM().blessing;
    const d = Number(b && b.durationMin) || Number(TM().buffDurationMin) || 0;
    return d;
  };
  function readBuffStart() {
    try { return Number(localStorage.getItem(buffKey())) || 0; } catch (e) { return 0; }
  }
  function writeBuffStart() {
    try { localStorage.setItem(buffKey(), String(Date.now())); } catch (e) { /* 忽略 */ }
  }
  function buffExpired() {
    const min = blessingDurationMin();
    if (!min) return false; // 0 = 不限时
    const start = readBuffStart();
    if (!start) return false;
    return (Date.now() - start) >= min * 60 * 1000;
  }
  // buff 是否生效中（有起始时间且未超时）
  function blessingActive() {
    const start = readBuffStart();
    if (!start) return false;
    return !buffExpired();
  }
  // 剩余秒数（按钮显示"剩余约 N 分钟"用）；未激活返回 0
  function blessingRemainSec() {
    const min = blessingDurationMin();
    const start = readBuffStart();
    if (!min || !start) return 0;
    const remain = min * 60 - Math.floor((Date.now() - start) / 1000);
    return Math.max(0, remain);
  }
  // 手上是否还有引导祝福道具
  function hasBlessing() {
    const M = window.Materials;
    return !!(M && M.getQuantity && M.getQuantity(blessingName()) > 0);
  }
  // 使用引导祝福：扣道具 → 记录起始 → 进加速（30 分钟）
  async function useBlessing() {
    const M = window.Materials;
    if (!M || !M.spend) return { ok: false, error: '材料系统未就绪'};
    if (blessingActive()) return { ok: false, error: '加速已生效中，别浪费'};
    if (M.getQuantity(blessingName()) <= 0) return { ok: false, error: '没有引导祝福（开局会自动送 1 个）'};
    const spent = await M.spend(blessingName(), 1);
    if (!spent.ok) return { ok: false, error: spent.error || '使用失败'};
    writeBuffStart();
    enter();
    if (window.UI && window.UI.addLog) window.UI.addLog(`使用「${blessingName()}」：加速已生效（${blessingDurationMin()} 分钟，经验×${TM().expRate || 6}）`);
    return { ok: true };
  }
  // 开局发 1 个引导祝福（账号幂等）+ 明确提示用途与绑定属性
  async function grantInitialBlessing() {
    const M = window.Materials;
    if (!M || !M.gain) return;
    try {
      if (localStorage.getItem(blessingGivenKey()) === '1') return; // 已发过
      localStorage.setItem(blessingGivenKey(), '1');
    } catch (e) { /* 忽略 */ }
    await M.gain(blessingName(), 1);
    if (M.flushMaterials) await M.flushMaterials();
    if (window.UI && window.UI.addLog) {
      window.UI.addLog(`获得绑定道具「${blessingName()}」×1：使用后 ${blessingDurationMin()} 分钟加速（经验×${TM().expRate || 6}）。不可交易/上架。`);
    }
  }

  /* ---------- 教学补给（按任务发一次，防重复） ---------- */
  function readGrantsDone() {
    try { return JSON.parse(localStorage.getItem(grantKey()) || '[]'); } catch (e) { return []; }
  }
  function markGrantDone(taskId) {
    try {
      const done = readGrantsDone();
      if (done.indexOf(taskId) < 0) done.push(taskId);
      localStorage.setItem(grantKey(), JSON.stringify(done));
    } catch (e) { /* 忽略 */ }
  }
  function grantDone(taskId) { return readGrantsDone().indexOf(taskId) >= 0; }

  async function applyGrantsFor(taskId) {
    if (!taskId || grantDone(taskId)) return;
    const t = TM();
    const list = (t.grants || []).filter(g => g.taskId === taskId);
    if (!list.length) return;
    for (const g of list) {
      try {
        if (g.type === 'gear') {
          const E = window.Equipment, I = window.Items;
          if (!E || !E.generateEquipment) continue;
          for (let i = 0; i < (g.spec.count || 1); i++) {
            const rarity = (Config.equipment.rarities || []).find(r => r.id === (g.spec.rarity || 'blue')) || (Config.equipment.rarities || [])[0];
            const eq = E.generateEquipment(rarity, g.spec.areaTier || 1, g.spec.materialTier || 3);
            eq.identified = g.spec.identified === false ? false : true;
            E.addToInventory(eq);
            if (I && I.saveItem) { const r = await I.saveItem(eq); if (r && r.error) console.warn('[guide] 补给装备存档失败', r.error); }
          }
        } else if (g.type === 'mat') {
          await window.Materials.gain(g.name, g.qty || 1);
        } else if (g.type === 'mats') {
          for (const m of (g.list || [])) await window.Materials.gain(m.name, m.qty || 1);
        } else if (g.type === 'egg') {
          if (window.Drop && window.Drop.grantEgg) await window.Drop.grantEgg(g.baseName || '腐噜兽', g.qty || 1);
        } else if (g.type === 'pet') {
          await grantPet(g);
        }
      } catch (e) {
        console.warn('[guide] 教学补给失败', g, e);
      }
    }
    markGrantDone(taskId);
    window.Materials.flushMaterials && window.Materials.flushMaterials();
    if (window.UI && window.UI.addLog) window.UI.addLog(`教学补给已发放（${taskId}）`);
  }

  function rarityLabel(r) {
    const rr = (Config.equipment.rarities || []).find(x => x.id === r);
    return rr ? rr.label : (r || '');
  }

  // 教学副宠：创建 + 特质 + 存档（有 cloudId 才能被合成/涅槃/魂铸）
  async function grantPet(g) {
    const Pet = window.Pet;
    if (!Pet || !Pet.createPet) return;
    const base = (Config.pet.starters || []).find(s => s.name === g.baseName);
    const B = Config.pet.legacyBase || {};
    const pet = Pet.createPet(g.name || g.baseName, (base && base.icon) || '',
      g.growth || 5, (base && base.baseHp) || B.hp || 100, (base && base.baseAtk) || B.atk || 20,
      (base && base.baseDef) || B.def || 10, (Config.pet.speeds && Config.pet.speeds[g.baseName]) || B.spd || 40, g.baseName || '腐噜兽');
    pet.level = g.level || 1;
    if (g.traits && g.traits.length) {
      pet.traits = g.traits.map(id => ({ id, tier: 2 }));
    } else if (Pet.rollPetTraits) {
      Pet.rollPetTraits(pet, {});
    }
    Pet.addPet(pet);
    const supabase = window.Supabase;
    if (supabase && supabase.savePet) {
      const { data, error } = await supabase.savePet(pet);
      if (!error && data && data.id) pet.cloudId = data.id;
    }
  }

  /* ---------- 引导驱动核心：登录后 / 定时调用 ----------
   * 1) 有未完成的引导任务 → 只发教学补给（加速改由道具「引导祝福」触发，不再自动进）
   * 2) 已激活的 buff 超时 → 自动退出（兜底）
   * 3) 引导段全部完成 → 退加速 + 发新手礼包（仅一次） */
  async function checkGuide() {
    if (!TM().enabled) return;
    // 未登录不驱动（绑定账号状态 / 发礼包都要账号）
    const user = window.UI && window.UI.getAuthUser ? window.UI.getAuthUser() : null;
    if (!user) return;

    const task = currentGuideTask();
    if (task) {
      // 进入引导 → 打「引导已开始」标记（Q6：老账号链已完成、没真正走过引导 → 不发礼包）
      if (!readStarted()) markStarted();
      // buff 已激活且超时 → 自动关（玩家用完 30 分钟恢复正式节奏）
      if (active && buffExpired()) exit();
      // 教学补给照发（不随 buff 超时停止，保证零卡手）
      if (!grantDone(task.id)) await applyGrantsFor(task.id);
      return;
    }
    // 引导段全完成
    if (active) exit();
    // 只有"真正走过引导"的账号才发礼包（Q6 修复：老账号自动完成新手链 → 不再白拿）
    if (readStarted() && !hasClaimedPack()) {
      // 只对"完整走完引导"的账号发：跳过引导时 Quest.skipGuide 会把 t1~t10 全标完成，
      // 这里会误判成"完成"。所以跳过的账号要打标记（见 skipGuideForAccount）。
      const sk = readSkipped();
      if (!sk) {
        await grantStarterPack();
        markClaimedPack();
      }
    }
  }

  /* ---------- buff 超时自动关定时器（1s，仅引导任务存在时跑，防止常驻空转） ---------- */
  let expireTimer = null;
  function startExpireTimer() {
    if (expireTimer) return;
    expireTimer = setInterval(() => {
      try {
        // 无引导任务（引导完成/跳过）→ 停定时器
        if (!currentGuideTask()) { stopExpireTimer(); return; }
        if (active && buffExpired()) { exit(); if (window.UI && window.UI.addLog) window.UI.addLog('⏱ 引导祝福加速已到期，恢复正式节奏'); }
      } catch (e) { /* 忽略 */ }
    }, 1000);
  }
  function stopExpireTimer() {
    if (expireTimer) { clearInterval(expireTimer); expireTimer = null; }
  }
  // 供 main.js 登录后启动定时器（与 checkGuide 配套）
  function startGuideRoutine() {
    startExpireTimer();
    return checkGuide();
  }

  const skipKey = () => 'fos_guide_skipped'+ (userKey ? '_'+ userKey : '');
  function readSkipped() { try { return localStorage.getItem(skipKey()) === '1'; } catch (e) { return false; } }
  // 跳过引导：打账号标记（不发礼包）；由 ui-quest 的「跳过」按钮调用
  function markSkipped() { try { localStorage.setItem(skipKey(), '1'); } catch (e) { /* 忽略 */ } }

  /* ---------- 新手礼包（config.tutorialMode.starterPack，全部绑定） ---------- */
  async function grantStarterPack() {
    const t = TM();
    const pack = t.starterPack || {};
    const Pet = window.Pet, E = window.Equipment, I = window.Items, Materials = window.Materials;
    if (!Materials) return;
    // 经验包
    for (const ei of (pack.expItems || [])) await Materials.gain(ei.name, ei.qty || 1);
    // 装备三件套
    for (const g of (pack.gear || [])) {
      if (!E || !E.generateEquipment) continue;
      for (let i = 0; i < (g.count || 1); i++) {
        const rarity = (Config.equipment.rarities || []).find(r => r.id === (g.rarity || 'blue')) || (Config.equipment.rarities || [])[0];
        const eq = E.generateEquipment(rarity, g.areaTier || 1, g.materialTier || 3);
        eq.identified = true;
        E.addToInventory(eq);
        if (I && I.saveItem) await I.saveItem(eq);
      }
    }
    // 材料
    for (const m of (pack.mats || [])) await Materials.gain(m.name, m.qty || 1);
    // 高成长副宠（设为出战）
    if (pack.pet && Pet && Pet.createPet) {
      const base = (Config.pet.starters || []).find(s => s.name === pack.pet.baseName);
      const B = Config.pet.legacyBase || {};
      const pet = Pet.createPet(pack.pet.name, (base && base.icon) || '', pack.pet.growth || 8,
        (base && base.baseHp) || B.hp || 100, (base && base.baseAtk) || B.atk || 20,
        (base && base.baseDef) || B.def || 10, (Config.pet.speeds && Config.pet.speeds[pack.pet.baseName]) || B.spd || 40, pack.pet.baseName || '毒沼蛙');
      Pet.addPet(pet);
      if (Pet.setActive) Pet.setActive(pet.id);
      if (window.Supabase && window.Supabase.savePet) {
        const { data, error } = await window.Supabase.savePet(pet);
        if (!error && data && data.id) pet.cloudId = data.id;
      }
    }
    await Materials.flushMaterials && await Materials.flushMaterials();
    if (window.UI && window.UI.addLog) window.UI.addLog('新手礼包已发放！打开背包查看。');
    if (window.UI && window.UI.renderAll) window.UI.renderAll();
  }

  window.TutorialMode = {
    enter, exit, isActive, bindUser,
    hasClaimedPack, markClaimedPack, checkGuide, applyGrantsFor, grantStarterPack, markSkipped,
    hasBlessing, useBlessing, blessingActive, blessingRemainSec, grantInitialBlessing,
    startGuideRoutine
  };
})();
