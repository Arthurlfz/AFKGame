/* ============================================================
 * quest.js —— 任务系统（配置驱动，54 条任务见 docs/任务表 v1.md）
 * 提交幂等（防重复领奖）：内存是唯一同步真相，云端只做持久化。
 *   ① 闸门：submitting 集合挡住连点重入（completeQuest 内有 await，空隙里能被重入）
 *   ② 记账先行：「已交」在发奖前写进内存；发货失败也绝不回滚（回滚 = 还能再领一份）
 *   ③ 写串行：quest_progress 是整行覆盖写，并发写互相覆盖，所有写排同一条队列
 *   ④ 落盘才返回：交任务 await 云端写完，否则一刷新读到旧进度，同一个任务又能交
 * 四类任务：
 *   - tutorial 新手成长：线性引导，requires 前置依赖（做完一条出下一条），自动接取
 *   - main     主线：按 unlockLevel 等级解锁，一次性
 *   - daily    日常：每日 00:00 刷新（repeat: true），当天交完不再出现
 *   - achieve  成就：长期累计，一次性
 * 12 种目标类型（config.drop.quests 的 type）：
 *   collect 收集材料（进度=背包材料数，实时） / kill 击败怪 / evolve 进化 / nirvana 涅槃
 *   synth 合成 / soulcast 魂铸 / hatch 孵化 / craft 打造 / salvage 分解 / equipDrop 获得装备
 *   equip 穿装备 / list 上架 / trade 市场成交
 * 加任务 = 在 config.drop.quests 加一行，不用改本文件逻辑。
 * 依赖：materials.js、pet.js(等级)、supabase.js(账号级进度，存 quest_progress 的 JSON，不加表字段)
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;
  const Materials = window.Materials;

  const accepted = new Set();   // 已接任务（新手任务自动接取，其余需接取）
  const TRACK_MAX = 3;          // 追踪栏最多同时钉几条
  let tracked = [];             // 追踪的任务 id（有序，最多 TRACK_MAX 条）
  let progress = {};            // 进度累计 { questId: count }
  let completed = {};           // 一次性任务完成记录 { questId: true }
  let dailyDone = {};           // 当天已交的日常 { questId: true }
  let dailyDate = '';           // 日常上次重置日期（YYYY-M-D）
  // 账号级一次性标记（云端随 progress 一起存）：新手礼包已领 / 引导补给已发 / 引导祝福已送等。
  // 规则：云端是唯一真相，本地 localStorage 只做读加速与降级兜底（详见 tutorial_mode 的读写封装）。
  let extra = {};

  // 提交闸门：completeQuest 内部有多次 await（扣材料、逐个发奖），两帧之间的空隙里
  // 连点会重入同一段逻辑。奖励是云端 RPC 累加（add_material），重入一次就多给一份材料。
  const submitting = new Set();
  // 云端进度是否已拉取完。没拉完就允许交任务，会用「空历史」整行覆盖云端记录，
  // 把玩家以前交过的任务全部抹成未完成。
  let cloudLoaded = false;

  /* ---------- 云端进度（账号级，存 quest_progress 表的 JSON 内容，不新增表字段） ---------- */
  async function loadCloudProgress() {
    try {
      const Supabase = window.Supabase;
      if (!Supabase || !Supabase.fetchQuestProgress) return;
      const { data, error } = await Supabase.fetchQuestProgress();
      if (error || !data || typeof data !== 'object') return;
      // 兼容旧存档：旧格式是纯 {questId: count}，新格式是 {progress, completed, dailyDone, dailyDate}
      if (data.progress || data.completed || data.dailyDone || data.dailyDate) {
        progress = data.progress || {};
        completed = data.completed || {};
        dailyDone = data.dailyDone || {};
        dailyDate = data.dailyDate || '';
        tracked = Array.isArray(data.tracked) ? data.tracked.slice(0, TRACK_MAX) : [];
        extra = (data.extra && typeof data.extra === 'object') ? data.extra : {};
      } else {
        progress = data;
      }
      // 历史已到手，之后的写入才可信：紧接着的 ensureDailyReset() 若触发保存，
      // 写的必须是刚恢复的这份状态，而不是空内存。
      cloudLoaded = true;
      if (migrateLegacyGuide()) saveProgress();
      ensureDailyReset();
    } catch (e) {
      // 读云端失败不能阻断登录：任务进度拉不到，最坏是玩家看到进度为空，
      // 不该把人挡在游戏外面。内存仍是本次会话的真相，照常能玩。
      console.warn('[quest] 读取云端任务进度失败，本次以本地为准', e);
    } finally {
      cloudLoaded = true;
    }
  }
  // Old G1-G10 accounts must never be forced through the replacement chain.
  function migrateLegacyGuide() {
    const old = ['g1','g2','g3','g4','g5','g6','g7','g8','g9','g10'];
    if (!old.some(id => completed[id]) && !old.every(id => completed[id])) return false;
    const hasLegacyCompletion = !!completed.g10 || old.every(id => completed[id]);
    if (!hasLegacyCompletion) return false;
    let changed = false;
    (Config.drop.quests || []).forEach(q => {
      if (q.category === 'tutorial' && q.isGuide && !completed[q.id]) { completed[q.id] = true; changed = true; }
    });
    return changed;
  }
  /* ---------- 写云端：串行队列 + 内存快照 ----------
   * quest_progress 是整行 JSON 覆盖写（upsert），两条写并发飞就会互相覆盖：
   * 挂机每场胜利都走 reportType → saveProgress，若和交任务那次写入撞在一起，
   * 谁后到谁生效，先写的那份新状态就被抹掉了 —— 这就是「交过的任务刷新后又能交」。
   * 两条规矩：
   *   ① 所有写入排进同一条队列，一次只飞一个请求；
   *   ② 快照从内存取（内存是唯一同步真相），绝不读云端再改写。
   * 返回 Promise，交任务时 await 它 —— 不等落盘就返回，玩家一刷新读到的还是旧进度。 */
  const SAVE_THROTTLE_MS = 4000;   // 击杀上报的最小写入间隔
  let saveQueue = Promise.resolve();
  let throttleTimer = null;
  let lastSaveAt = 0;
  function progressSnapshot() {
    return {
      progress: Object.assign({}, progress),
      completed: Object.assign({}, completed),
      dailyDone: Object.assign({}, dailyDone),
      dailyDate: dailyDate,
      tracked: tracked.slice(),
      extra: Object.assign({}, extra)
    };
  }
  function saveProgress() {
    const Supabase = window.Supabase;
    if (!Supabase || !Supabase.saveQuestProgress) return Promise.resolve();
    // 进度没拉回来之前一律不写。页面刚加载、玩家还没登录时，getQuests() 就会触发一次
    // ensureDailyReset() → saveProgress()，此时内存是空的，这一写等于拿「空历史」整行覆盖云端，
    // 把玩家以前交过的任务全抹成未完成——「刷新后任务又能交一次」就是这么来的。
    if (!cloudLoaded) return Promise.resolve();
    clearPendingSave();   // 本次就写最新快照，挂着的延迟写已无意义，别让它堵在队列里
    lastSaveAt = Date.now();
    const data = progressSnapshot();
    saveQueue = saveQueue
      .then(() => Supabase.saveQuestProgress(data))
      .then(res => { if (res && res.error) console.warn('[quest] 进度保存失败', res.error); })
      .catch(err => console.warn('[quest] 进度保存异常', err));
    return saveQueue;
  }
  function clearPendingSave() {
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
  }
  /* 严格写：专供「发放路径」（tutorial_mode 的账本/礼包/补给）。
   * 与 saveProgress 唯一区别：失败要 reject 出去，调用方据此决定「不发货」——
   * 账没记上就发货，等于白送。普通路径继续用 saveProgress（吞错保流畅）。
   * 公共队列不能被 strict 的失败污染（否则后续所有保存连锁失败），所以
   * 对外抛的是 write，塞回队列的是吞错后的链。 */
  function saveProgressStrict() {
    const Supabase = window.Supabase;
    if (!Supabase || !Supabase.saveQuestProgress) return Promise.reject(new Error('云端进度通道不可用'));
    if (!cloudLoaded) return Promise.reject(new Error('云端进度尚未加载，不能记账'));
    clearPendingSave();
    lastSaveAt = Date.now();
    const data = progressSnapshot();
    const write = saveQueue
      .then(() => Supabase.saveQuestProgress(data))
      .then(res => {
        if (res && res.error) {
          const e = new Error((res.error.message) || String(res.error));
          e.cloudError = res.error;
          throw e;
        }
        return res;
      });
    saveQueue = write.catch(err => { console.warn('[quest] 严格保存失败', err); });
    return write;
  }
  // 门闩：云端历史是否已拉取。引导驱动在放行任何发放前必须先过这一关，
  // 否则拿空状态判定「没发过」→ 发货 → 云端随后覆盖内存，发放记录凭空丢失。
  function isCloudLoaded() { return cloudLoaded; }
  /* 节流写：给击杀上报用。
   * 挂机一场一写会把队列撑爆，交任务这种关键写入只能排在后面干等——实测等过 7 秒多。
   * 任务进度晚几秒落盘玩家无感（最坏丢几场进度），交任务必须立刻生效，所以两者分开走：
   * 窗口内第一次立即写，之后的改动挂一个延迟写收尾，最多延迟 SAVE_THROTTLE_MS。 */
  function saveProgressThrottled() {
    if (!cloudLoaded) return;                       // 历史都没拉回来，别挂定时器
    const wait = SAVE_THROTTLE_MS - (Date.now() - lastSaveAt);
    if (wait <= 0) { saveProgress(); return; }
    if (throttleTimer) return;                      // 已经挂了收尾的，等它触发即可
    throttleTimer = setTimeout(() => { throttleTimer = null; saveProgress(); }, wait);
  }

  /* ---------- 日常刷新 ---------- */
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  };
  // 换日则清空日常的累计进度与当天完成记录（成就不清零，见 completeQuest）
  function ensureDailyReset() {
    const today = todayStr();
    if (dailyDate === today) return;
    dailyDate = today;
    dailyDone = {};
    (Config.drop.quests || []).forEach(q => { if (q.repeat) progress[q.id] = 0; });
    saveProgress();
  }

  /* ---------- 解锁与进度 ---------- */
  function isUnlocked(q) {
    // 新手链：前置任务完成才解锁（第一条无前置）
    if (q.category === 'tutorial') return q.requires ? !!completed[q.requires] : true;
    if (q.type === 'collect_loop') return isAreaCleared(q.area);
    const active = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    const lv = active ? active.level : 0;
    return lv >= (q.unlockLevel || 1);
  }

  function currentProgress(q) {
    // level：进度 = 出战宠等级（引导经验包顶上去即达标，玩家不靠刷怪升级。
    // 2026-09-03 新增，供 G1「引路人的馈赠」这类"等级即目标"的引导任务用）
    if (q.type === 'level') {
      const p = (window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null);
      return p ? Math.max(1, Number(p.level) || 1) : 0;
    }
    if (q.type === 'collect' || q.type === 'collect_loop') {
      // matList（2026-09-10 觉醒之路）：多种材料**每种都要够 need**，取最短板做进度
      if (q.type === 'collect' && Array.isArray(q.matList)) {
        return q.matList.reduce((min, name) => Math.min(min, Materials.getQuantity(name)), Infinity) || 0;
      }
      return Materials.getQuantity(q.matName);
    }
    // 宠物养成链的「孵化」任务：玩家已经拥有该宠（含开局选择）→ 视为 1/1 已完成，
    // 否则开局选的那只宠的孵化任务永远做不了（开局选择不算 hatch）。
    if (q.type === 'hatch' && q.petName) {
      const own = (window.Pet && window.Pet.getPets ? window.Pet.getPets() : [])
        .some(p => p && p.name === q.petName);
      return own ? Math.max(1, progress[q.id] || 0) : (progress[q.id] || 0);
    }
    /* 组合任务（2026-09-09）：处置 + 第二个条件。
     * secondType 默认由 type 推导：disposeKill → kill，disposeBoss → boss。
     * 两个条件各自累计、各自有 need（secondNeed 缺省 = need），取「短板」作为总进度。 */
    if (isComboQuest(q)) {
      const disposed = Number(progress[q.id]) || 0;
      const second = Number(progress[secondKey(q)]) || 0;
      // 两个条件按各自 need 取完成度，短板决定总进度（不能直接 min(两者)：
      // need=1 / secondNeed=5 时，处置 1 次 + 击杀 1 只就会算出 1 → 误判达标）
      const ratio = Math.min(disposed / Math.max(1, Number(q.need) || 1), second / secondNeedOf(q));
      return Math.floor(ratio * Math.max(1, Number(q.need) || 1));
    }
    return progress[q.id] || 0;
  }

  /* ---------- 组合任务（处置 + 第二个条件）----------
   * 背景：N5 原为「处置装备 + 击败 Boss」，Boss 是 200 场冷却的服务器权威稀有事件，
   * 新手根本见不到 → 引导卡死。改造成通用组合类型后，第二个条件可以是 kill 也可以是 boss，
   * 换条件只改配置（secondType / secondNeed），不用再动本文件。 */
  function isComboQuest(q) { return !!q && (q.type === 'disposeBoss' || q.type === 'disposeKill'); }
  function secondTypeOf(q) { return q.secondType || (q.type === 'disposeKill' ? 'kill' : 'boss'); }
  function secondKey(q) { return q.id + ':' + secondTypeOf(q); }
  function secondNeedOf(q) { return Math.max(1, Number(q.secondNeed) || Number(q.need) || 1); }

  function progressParts(q) {
    if (!isComboQuest(q)) return null;
    return {
      disposed: Math.min(Number(progress[q.id]) || 0, q.need),
      second: Math.min(Number(progress[secondKey(q)]) || 0, secondNeedOf(q)),
      secondNeed: secondNeedOf(q),
      secondLabel: secondTypeOf(q) === 'kill' ? '击杀' : 'Boss'
    };
  }

  // 一次性任务看 completed，日常看当天是否交过
  function isFinished(q) {
    if (q.repeatable) return false;
    return q.repeat ? !!dailyDone[q.id] : !!completed[q.id];
  }

  function getQuests() {
    ensureDailyReset();
    return (Config.drop.quests || []).map(q => {
      const have = currentProgress(q);
      return {
        id: q.id, category: q.category || 'main', type: q.type || 'collect',
        area: q.area, matName: q.matName, matList: q.matList || null, petName: q.petName, name: q.name, need: q.need,
        reward: q.reward, rewardGear: q.rewardGear || null, unlockLevel: q.unlockLevel, requires: q.requires,
        repeat: !!q.repeat, repeatable: !!q.repeatable, expReward: q.expReward, guide: q.guide,
        options: q.options || null, action: q.action || null, minLevel: q.minLevel || 0, disposeTypes: q.disposeTypes || null,
        have, progress: Math.min(have, q.need), done: have >= q.need,
        parts: progressParts(q),
        unlocked: isUnlocked(q), finished: isFinished(q),
        accepted: q.category === 'tutorial' || accepted.has(q.id)
      };
    });
  }

  function getReadyLoop(areaId) {
    const q = (Config.drop.quests || []).find(x => x.type === 'collect_loop' && x.area === areaId);
    if (!q || !isUnlocked(q)) return null;
    return currentProgress(q) >= q.need ? {
      id: q.id, name: q.name, area: q.area, material: q.matName,
      need: q.need, reward: q.reward, expReward: q.expReward || 0
    } : null;
  }

  // 引导条用：新手链里第一条「已解锁但未交」的任务（线性，走完返回 null）
  function getGuideQuest() {
    ensureDailyReset();
    // 只认引导段（isGuide）：毕业后任务（G10 魂铸）不进引导条，走普通任务面板
    const list = (Config.drop.quests || []).filter(q => q.category === 'tutorial' && q.isGuide);
    for (const q of list) {
      if (completed[q.id] || !isUnlocked(q)) continue;
      const have = currentProgress(q);
      return {
        id: q.id, name: q.name, type: q.type, need: q.need,
        area: q.area || null,   // 目标地图：引导条跳转时用来自动选图
        have, progress: Math.min(have, q.need), done: have >= q.need,
        parts: progressParts(q),
        guide: q.guide || null, reward: q.reward, rewardGear: q.rewardGear || null,
        // 叙事层：引路人台词（为什么做）/ hotspot 锚点 / 引导经验包等级（透给 tutorial_mode 顶等级）
        npc: q.npc || '', hint: q.hint || '', target: q.target || '', options: q.options || null, action: q.action || null, minLevel: q.minLevel || 0,
        disposeTypes: q.disposeTypes || null,
        guideStep: list.indexOf(q) + 1, guideTotal: list.length, boostLevel: q.boostLevel || 0,
        isGuide: true
      };
    }
    return null; // 引导段已走完（毕业）
  }

  function acceptQuest(id) { accepted.add(id); return true; }

  /* ---------- 任务追踪（追踪栏钉住的任务，最多 TRACK_MAX 条） ---------- */
  function getTracked() { return tracked.slice(); }
  // 钉住/取消钉住；超过上限时挤掉最早钉的那条
  function toggleTrack(id) {
    const i = tracked.indexOf(id);
    if (i >= 0) tracked.splice(i, 1);
    else {
      tracked.push(id);
      while (tracked.length > TRACK_MAX) tracked.shift();
    }
    saveProgress();
    return { tracked: tracked.slice(), on: tracked.indexOf(id) >= 0 };
  }

  // 动作模块只负责上报一次；任务 UI 在同一帧合并刷新，避免挂机批量结算时反复重绘。
  let questUiRefreshQueued = false;
  function refreshQuestUi() {
    const ui = window.UI;
    if (!ui || (typeof ui.renderQuestTracker !== 'function' && typeof ui.renderQuestPanel !== 'function')) return;
    if (questUiRefreshQueued) return;
    questUiRefreshQueued = true;
    const flush = function () {
      questUiRefreshQueued = false;
      try {
        if (typeof ui.renderQuestTracker === 'function') ui.renderQuestTracker();
        const panel = typeof document !== 'undefined' && document.getElementById
          ? document.getElementById('quest-panel') : null;
        const open = panel && panel.style && panel.style.display !== 'none' &&
          (!panel.classList || panel.classList.contains('is-open'));
        if (open && typeof ui.renderQuestPanel === 'function') ui.renderQuestPanel();
      } catch (e) { /* 任务检测不能阻断战斗/装备动作 */ }
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(flush);
    else if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else Promise.resolve().then(flush);
  }

  // 按类型上报：自动匹配所有该类型的未完成任务（各动作模块统一调用这个）
  // ctx.areaId 用于 kill 类限定地图（任务没配 area 的表示任意图都算）
  // ctx.petName 用于宠物专属任务：只算「指定宠物」出战时的上报（没配 petName 的任务不受影响）
  function reportType(type, amount, ctx) {
    if (!type || type === 'collect') return; // collect 用背包材料数，不需要上报
    ctx = ctx || {};
    if (type === 'kill' && !(window.Pet && window.Pet.getActivePet && window.Pet.getActivePet())) return;
    let changed = false;
    for (const q of (Config.drop.quests || [])) {
      if (q.category === 'tutorial' && !isUnlocked(q)) continue;
      if (isComboQuest(q)) {
        if (q.disposeTypes && q.disposeTypes.indexOf(type) >= 0 && !completed[q.id]) {
          progress[q.id] = (progress[q.id] || 0) + (amount || 1);
          changed = true;
        } else if (type === secondTypeOf(q) && !completed[q.id] &&
                   (!q.area || !ctx.areaId || q.area === ctx.areaId)) {
          const key = secondKey(q);
          progress[key] = (progress[key] || 0) + (amount || 1);
          changed = true;
        }
        continue;
      }
      if (q.type !== type || completed[q.id]) continue;
      if (q.action && ctx.action !== q.action) continue;
      if (q.minLevel) {
        const pet = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
        if (!pet || Number(pet.level) < Number(q.minLevel)) continue;
      }
      if ((type === 'kill' || type === 'boss') && q.area && ctx.areaId && q.area !== ctx.areaId) continue;
      if (q.petName && ctx.petName !== q.petName) continue;
      progress[q.id] = (progress[q.id] || 0) + (amount || 1);
      changed = true;
    }
    if (changed) {
      saveProgressThrottled();
      refreshQuestUi();
    }
    return changed;
  }

  function chooseGuideDirection(direction) {
    const q = getGuideQuest();
    if (!q || q.type !== 'direction') return { error: '当前没有方向选择' };
    const cfg = (Config.drop.quests || []).find(x => x.id === q.id);
    const option = (cfg.options || []).find(x => x.id === direction);
    if (!option) return { error: '无效的引导方向' };
    progress[q.id] = 1;
    extra.n6Direction = option.id;
    saveProgress();
    return { ok: true, direction: option.id, label: option.label };
  }

  /* ---------- 任务送装备（新手链专用） ----------
   * 配置：任务上写 rewardGear: { count, areaTier, rarity, materialTier }。
   * 为什么要有这条路：t3「披上残甲」要求穿 1 件装备，而装备只能靠 5% 掉落，
   * 新手做完前置的 10 场击杀时背包很可能还是空的 —— 引导会卡死在「去穿装备」。
   * 与掉落同一条链路（drop.js）：本地入背包 → 写云端 equip_items（失败只提示，不回滚任务，
   * 理由同材料：回滚 = 玩家能再领一件，经济能刷就废了）。
   * 顺带上报 equipDrop：装备确实到手了，「获得装备」类的主线任务进度跟着走。 */
  async function grantGear(spec) {
    const E = window.Equipment, I = window.Items;
    if (!E || !E.generateEquipment) return [];
    const cfg = typeof spec === 'number' ? { count: spec } : (spec || {});
    const count = Math.max(0, Number(cfg.count) || 0);
    if (!count) return [];
    const rarity = (Config.equipment.rarities || []).find(r => r.id === (cfg.rarity || 'blue'))
      || (Config.equipment.rarities || [])[0];
    const made = [];
    for (let i = 0; i < count; i++) {
      const eq = E.generateEquipment(rarity, cfg.areaTier || 1, cfg.materialTier || 3);
      E.addToInventory(eq);
      if (I && I.saveItem) {
        // 未登录时 saveItem 返回「未登录」，静默忽略（本地照玩，登录后以云端为准）
        const res = await I.saveItem(eq);
        if (res && res.error && res.error.message !== '未登录' && window.UI && window.UI.addLog) {
          window.UI.addLog(`⚠️ 任务装备云端存档失败：${res.error.message || '未知错误'}（刷新后可能丢失）`);
        }
      }
      made.push(eq);
    }
    reportType('equipDrop', made.length);
    return made;
  }

  /* ---------- 提交任务：先记账、后发货 ----------
   * 顺序：
   *   ① 校验 + 进闸门（同步，放在任何 await 之前，连点重入在这里就被挡掉）
   *   ② 立刻把「已交」记进内存
   *   ③ 才去扣材料、发奖励（这两步是云端 RPC 累加型，重复调用 = 重复给材料）
   *   ④ 等云端落盘再返回（不等就返回，玩家一刷新读到旧进度，同一个任务又能交一次）
   * 出错分两种，处理相反：
   *   - 扣材料失败：一份奖励都还没发出去，回滚成未完成让玩家重来 —— 安全。
   *   - 发奖失败：绝不回滚。回滚等于撤销「已交」，玩家能再点一次再领一份；
   *     宁可让玩家少拿一次，也不能让奖励可重复领（经济能刷就废了）。 */
  // 2026-09-05 地图系统：某图是否已首通 = 该图 Boss 首通任务已完成（completed 云端同步，天然持久化）
  function isAreaCleared(areaId) {
    const q = (Config.drop.quests || []).find(x => x.type === 'boss' && x.area === areaId);
    return !!q && isFinished(q);
  }
  function markFinished(q) { if (q.repeatable) return; if (q.repeat) dailyDone[q.id] = true; else completed[q.id] = true; }
  function unmarkFinished(q) { if (q.repeatable) return; if (q.repeat) delete dailyDone[q.id]; else delete completed[q.id]; }

  /* ---------- 任务经验奖励（2026-08-31 用户拍板「固定值 · 大方档」：经验是奖励主体，材料是辅助） ----------
   * 完成一次任务 = 给当前出战宠物【固定】经验（与等级无关）：
   *   新手 300 / 主线 1000 / 日常 100 / 成就 3000 / 宠物 600
   * 固定值的代价（用户已知晓并接受）：低级时交一次跳好几级、高级时只算零头。
   * 挂机仍是升级主力，任务经验是「爽快补给」。
   */
  const QUEST_EXP_FIXED = { tutorial: 300, main: 1000, daily: 100, achieve: 3000, pet: 600 };
  function questExpOf(q) {
    if (q && q.expReward != null) return Number(q.expReward) || 0;
    return QUEST_EXP_FIXED[q && q.category] || 0;
  }

  async function completeQuest(id) {
    ensureDailyReset();
    const q = (Config.drop.quests || []).find(x => x.id === id);
    if (!q) return { error: '任务不存在' };
    if (!cloudLoaded) return { error: '任务进度还在加载，请稍候' };
    if (submitting.has(id)) return { error: '正在提交中，请稍候' };
    if (isFinished(q)) return { error: '这个任务已经交过了' };
    if (!isUnlocked(q)) return { error: '任务尚未解锁' };
    if (currentProgress(q) < q.need) {
      const left = q.need - currentProgress(q);
      const matLabel = (q.type === 'collect' && Array.isArray(q.matList)) ? '图 1~10 区域材料' : q.matName;
      return { error: `还差 ${left} ${q.type === 'collect' ? matLabel : ''}` };
    }

    submitting.add(id);
    markFinished(q);
    try {
      // 收集类先扣材料：扣失败说明没货，此时奖励一份未发，回滚是安全的
      if (q.type === 'collect' || q.type === 'collect_loop') {
        // matList：每种都要扣 need 个；中途失败把已扣的补回来（宁多还不少扣）
        if (q.type === 'collect' && Array.isArray(q.matList)) {
          const spentList = [];
          for (const name of q.matList) {
            const sp = await Materials.spend(name, q.need);
            if (!sp.ok) {
              for (const [n, amt] of spentList) Materials.gain(n, amt);
              unmarkFinished(q);
              return { error: sp.error || '材料不足' };
            }
            spentList.push([name, q.need]);
          }
        } else {
          const spent = await Materials.spend(q.matName, q.need);
          if (!spent.ok) {
            unmarkFinished(q);
            return { error: spent.error || '材料扣减失败' };
          }
        }
      }
      const pairs = Object.entries(q.reward || {});
      // 经验奖励（任务奖励的主体）：当前出战宠物，本地即时生效（升级播报由调用方 renderAll 覆盖）
      const exp = questExpOf(q);
      const expTask = exp > 0 ? (async () => {
        const pet = (window.Pet && window.Pet.getActivePet && window.Pet.getActivePet()) || null;
        if (pet && window.Pet.grantExp) window.Pet.grantExp(pet, exp);
      })() : null;
      // 成就要保留累计战绩，其余类型交完清零（成就已 completed，不再显示，清零无影响）
      if (q.category !== 'achieve') progress[q.id] = 0;
      if (!q.repeatable) accepted.delete(id);
      // 装备奖励：背包里没有装备时，下一条「穿装备」任务无从下手（见 grantGear 注释）
      const gearTask = q.rewardGear ? grantGear(q.rewardGear) : null;
      // 状态到这儿已经全部落定，发奖和落盘互不依赖，并行跑：
      // 串行等两次云端往返要 1 秒多，各材料之间也无依赖，一起并行。
      await Promise.all([
        Promise.all(pairs.map(([name, amt]) => Materials.gain(name, amt))),
        expTask,
        gearTask,
        saveProgress()
      ]);
      // 奖励必须真正落盘：Materials.gain 现在只改本地并入队（不上传），
      // 不 flush 的话玩家一刷新，刚领的奖励就没了。
      await Materials.flushMaterials();
      // 引导推进：交完一条引导任务 → 驱动 tutorial_mode（顶下一条的等级门槛 / 走完则发毕业礼包）。
      // 不 await：它是发礼包/改等级这种附加动作，失败不该拖住玩家的提交反馈。
      if (q.category === 'tutorial' && window.TutorialMode && window.TutorialMode.checkGuide) {
        Promise.resolve().then(function () {
          try { window.TutorialMode.checkGuide(); }
          catch (e) { console.warn('[quest] tutorial checkGuide 失败', e); }
        });
      }
      const rewards = pairs.map(([name, amt]) => `${name} ×${amt}`);
      // 装备名放进奖励列表：玩家领到的是哪一件必须看得见，否则"送了装备"等于没送
      const gear = (await gearTask) || [];
      for (const eq of gear) rewards.unshift(`${(eq.rarity && eq.rarity.label) || ''}装备「${eq.name}」`);
      if (exp > 0) rewards.unshift(`经验 +${exp}`);
      return { ok: true, rewards, exp, gear, id: q.id, name: q.name };
    } catch (e) {
      // 发货没走完：保持「已交」并尽力落盘，绝不回滚
      await saveProgress().catch(() => {});
      return { error: (e && e.message) || '提交失败' };
    } finally {
      submitting.delete(id);
    }
  }

  // 放弃任务：取消接取 + 清零进度 + 从追踪栏撤下
  // 新手任务不能放弃（它是线性引导链的一环），只能整条「跳过引导」
  function abandonQuest(id) {
    const q = (Config.drop.quests || []).find(x => x.id === id);
    if (!q) return { error: '任务不存在' };
    if (q.category === 'tutorial') return { error: '新手任务不能放弃，可以点「跳过引导」' };
    if (!accepted.has(id) && progress[id] === undefined) return { error: '还没接取这个任务' };
    accepted.delete(id);
    progress[id] = 0;                                  // 进度清零，重新接取从 0 开始
    const ti = tracked.indexOf(id);
    if (ti >= 0) tracked.splice(ti, 1);                // 顺手从追踪栏撤下
    saveProgress();
    return { ok: true, id, name: q.name };
  }

  // 跳过新手引导：把整条新手链标记为已完成（引导条消失，任务面板显示已完成）
  function skipGuide() {
    (Config.drop.quests || []).forEach(q => { if (q.category === 'tutorial') completed[q.id] = true; });
    // 打「跳过」账号标记：毕业礼包只发给真正走过引导的账号（tutorial_mode.readSkipped）
    if (window.TutorialMode && window.TutorialMode.markSkipped) {
      try { window.TutorialMode.markSkipped(); } catch (e) { console.warn('[quest] markSkipped 失败', e); }
    }
    saveProgress();
    return true;
  }

  // 重置引导链（开发者「清除引导标记」配套）：把 tutorial 段全部标回未完成/零进度，
  // 云端一并落盘 —— 否则只清本地标记，云端 completed 还在，引导永远走不回 G1。
  // ⚠️ 鉴权（2026-09-08）：这是纯客户端函数，控制台就能调；不设门槛等于公开的重刷开关。
  // 只放行 Config.dev.adminEmails（与 grant_gems 同一套管理员名单）。
  // 已发的任务奖励不会回收，等于可以重复体验引导但不重复给奖励。
  function resetGuideChain() {
    const admins = (Config.dev && Config.dev.adminEmails) || [];
    const user = window.UI && window.UI.getAuthUser ? window.UI.getAuthUser() : null;
    const email = user ? String(user.email || '') : '';
    if (!email || admins.indexOf(email) < 0) {
      console.warn('[quest] 重置引导链被拒绝：仅开发者账号可用');
      return { error: '重置引导链仅开发者账号可用' };
    }
    (Config.drop.quests || []).forEach(q => {
      if (q.category !== 'tutorial') return;
      delete completed[q.id];
      delete progress[q.id];
      delete progress[q.id + ':boss'];
      delete progress[q.id + ':kill'];
      delete dailyDone[q.id];
    });
    saveProgress();
    return true;
  }

  // 切换账号/登出时清空内存，避免残留旧号数据
  function reset() {
    progress = {}; completed = {}; dailyDone = {}; dailyDate = '';
    tracked = [];
    extra = {};
    accepted.clear();
    submitting.clear();
    clearPendingSave();
    lastSaveAt = 0;
    cloudLoaded = false;   // 换号必须重拉：新号的历史不能拿上一个号的内存当真相
  }

  /* ---------- 账号级一次性标记（云端是唯一真相，随 progress 落盘） ---------- */
  function getExtra(key) { return key in extra ? extra[key] : undefined; }
  function setExtra(key, val) {
    extra[key] = val;
    return saveProgress(); // 走同一串行队列，不并发覆盖
  }

  /* ---------- 对外 API ---------- */
  window.Quest = {
    getQuests, getReadyLoop, getGuideQuest, acceptQuest, completeQuest,
    reportType, skipGuide, abandonQuest, toggleTrack, getTracked, loadCloudProgress, reset,
    getExtra, setExtra, resetGuideChain,
    saveProgressStrict, isCloudLoaded,
    isFinished, isUnlocked, isAreaCleared,
    questExpOf, QUEST_EXP_FIXED, chooseGuideDirection
  };
})();
