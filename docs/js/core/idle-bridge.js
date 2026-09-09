/* ============================================================
 * idle-bridge.js —— 服务器权威挂机（回放版，2026-09-09 架构改版）
 *
 * 架构：**服务器是唯一模拟器 + 先记账后放片**。
 * 每次 settle 服务器把「接下来 30 秒」的战斗一次性算好并当场写库
 * （经验/场数/掉落/Boss 保底），把这份【已入账的录像】下发；
 * 客户端不做任何战斗模拟，只照录像回放：
 *   - 剧本事件：每场 {t0 开始, t1 结束, 打谁, 胜负, 经验, 血量从 hpStart 到 hpLeft}
 *   - 玩家看到的每个数字 = 服务器已入账的数字（实时结算，无校准/无补发/无漂移）
 *   - 回放基线：装剧本时把本地经验/等级重置到「窗前真值」（script.expBefore/levelBefore），
 *     演完正好落在服务器 expLeft/level（applyResult 只做兜底校准）
 *   - 客户端刷新/重连 → 服务器幂等重发同一段未播完的录像（script.id 判重）
 *
 * 时间线：点开始挂机 → 一次 settle（补账 + 预结算 30 秒并入账）→ 回放
 *         → 剧本播完 → 再 settle（补空窗 + 下一段）→ 无缝循环
 *
 * 退路：URL 加 ?noidle=1 → 本模块整体禁用，退回纯本地挂机（battle.js 老流程）。
 * 依赖：supabase.js / pet.js / battle.js / ui-battle.js
 * ============================================================ */
(function () {
  'use strict';

  const Supabase = window.Supabase;
  const Pet = window.Pet;

  const FN_URL = 'https://asklogeayzlqpeejuvjj.supabase.co/functions/v1/battle-settle';
  const SAFETY_SETTLE_MS = 120000; // 兜底结算：剧本一直拿不到/演出卡死时也要把真账要回来（= 服务器宽限窗口）
  const SCRIPT_RETRY_MS = 30000; // 剧本失败后的重试冷却。
  // 服务器没返回剧本（网络失败/会话异常）时不必高频打服务器：30 秒后再试。

  const ENABLED = !/[?&]noidle=1\b/.test(location.search);

  // 战斗日志收集器（2026-09-09）：console 之外再存一份到 window.__battleLog，
  // 方便玩家在控制台敲 copy(__battleLog.join('\n')) 一次性捞出全部战斗日志发回来。
  function blog() {
    try {
      var msg = Array.prototype.map.call(arguments, function (x) { return typeof x === 'object' ? JSON.stringify(x) : String(x); }).join(' ');
      (window.__battleLog = window.__battleLog || []).push(new Date().toISOString().slice(11, 23) + ' ' + msg);
      if (window.__battleLog.length > 500) window.__battleLog.shift();
      console.log(msg);
    } catch (e) { /* 忽略 */ }
  }

  let active = false;
  let timer = null;         // 兜底 settle 定时器
  let petId = null;         // 本次会话绑定的宠物 cloudId
  let totalFights = 0;      // 服务器战报累计场数（展示用）
  let onChange = null;      // 战报到账通知（上层刷新界面）

  // 演出剧本
  let script = null;        // {events:[{type,t0,t1,win,enemy,enemyLevel,enemyName,exp,hpStart,hpLeft}], endHp, petMaxHp}
  // 已生成但还没上场的下一段剧本（2026-09-09）：兜底结算 / 切回前台的 settle 会在
  // 当前这段【播到一半】时返回，直接替换 script 会把画面上正在打的怪抹掉 ——
  // 玩家看到的就是"服务器一说打完了，怪没了，直接下一场"。改成演完再交棒。
  let pendingScript = null;
  let scriptT0 = 0;         // 剧本时间轴起点（performance.now）
  let scriptIdx = -1;       // 当前事件下标（-1 = 尚未开始）
  let currentScriptId = null; // 当前/已在播的剧本身份（服务器幂等重发同一段时用来判重，不重播不重复给经验）
  let nextScriptTryAt = 0;  // 剧本获取失败后的重试冷却时间戳

  // 演出状态
  let showHp = 0;           // 我方演出血量（剧本插值）
  let showEnemy = null;     // 画面上的怪（演出用）
  const gauge = { pet: 0, enemy: 0 };       // 行动条（出手节奏观感，速度差与原战斗同公式）
  const freezeUntil = { pet: 0, enemy: 0 }; // 出手冻结到收招完毕
  let gaugeRaf = null;
  let lastGaugeTs = 0;
  let lastBarTs = 0;
  let skillCd = 0;          // 技能演出冷却（回合）
  let waitingHeal = false;  // 场前回血等待：血 <30% → 回满 100% 才开打
  // 本场演出配额（2026-09-09）：剧本给了双方出手刀数，血量按刀均摊（最后一刀兜底归零）。
  // 有了它，行动条、出刀、掉血三者同源 —— 不再是"时间决定血、刀只是好看的数字"。
  let showPlan = null;
  // 最近一次出手的演出时长（前摇飞行 hitAt / 后摇 backMs）。行动条定速要用它算冻结开销：
  // 出手期间条是冻住的，不扣这笔账就会"刀还没出手，本场时间已经用完"。
  let lastHitAt = 320, lastBackMs = 0;
  let showEnemyMountedAt = 0; // 本只怪的上台时刻（切后台回来时间轴会快进，别刚露脸就被清掉）
  // 在飞的出手演出（2026-09-09）：伤害飘字是 setTimeout(hitAt) 延迟播的，
  // 而血量按剧本时间轴线性掉 —— 两条时钟各自走，剧本 t1 一到就清场，
  // 于是"最后一刀还没飘出来怪就没了"。切场前把在飞的这一刀就地结算掉。
  const pendingHits = [];

  /* ---------- 请求 ---------- */
  async function callFn(body) {
    let s = null;
    try { s = await Supabase.getSession(); } catch (e) { /* 忽略 */ }
    const token = s && s.access_token;
    if (!token) return { error: 'NO_LOGIN' };
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      if (!res.ok) return { error: 'HTTP_' + res.status };
      const j = await res.json();
      return j && j.ok ? j : { error: (j && j.error) || 'EF_ERROR' };
    } catch (e) {
      return { error: 'NETWORK' };
    }
  }

  /* ---------- 确定性剧本：已由服务器生成并下发 ----------
   * 2026-09-09 架构改版：客户端不再本地模拟。旧实现（hashSeed 同种子 + loadSim
   * 加载 battle-sim + buildNextScript 预演下一段）整体删除 —— 双份战核必然漂移，
   * 这就是"经验对不上/场数对不上/怪死于时间"修了多少次都修不完的根因。
   * 现在剧本 = 服务器 settle 响应里的 r.script（已入账的录像），见 doSettle。 */

  // 查自己的当前会话（RLS 只返回自己的行；resumeActive 恢复挂机用）
  function fetchMySession() {
    try {
      const c = Supabase.getClient();
      if (!c) return Promise.resolve(null);
      return c.from('idle_sessions')
        .select('id,last_settled_at,pet_id,area_id')
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(function (res) { return (res && res.data) || null; })
        .catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  function warn(msg) {
    try { console.warn('[剧本]', msg); } catch (e) { /* 忽略 */ }
    if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ ' + msg);
  }

  /* ---------- settle 定时 ---------- */
  // 兜底定时：正常结算由「剧本演完」驱动（gaugeTick），这个只是保险——
  // 剧本生成一直失败、或演出卡住时，至少还能把服务器的真账要回来（窗口上限 120 秒）。
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, SAFETY_SETTLE_MS); }
  async function tick() {
    if (!active) return;
    await settleNow();
    if (active) schedule();
  }

  /* ---------- 开始 / 停止 ---------- */
  async function start(area, pet) {
    if (!ENABLED) return { error: 'DISABLED' };
    if (active) return { ok: true };
    if (!area || !pet || !pet.cloudId) return { error: 'NO_AREA_OR_PET' };

    const r = await callFn({ action: 'start', areaId: area.id, petId: pet.cloudId });
    if (r.error) return r;

    petId = pet.cloudId;
    totalFights = 0;
    active = true;
    if (window.UI) window.UI.updateStatus('fighting', 0);
    startShow();
    // 首段剧本 = 一次 settle：服务器预结算接下来 30 秒并当场入账，客户端拿到的是
    // 已入账的录像（回放即真账）。点击 → 开打的等待 = 一次 Edge Function 往返。
    settleNow().catch(function () { /* 忽略 */ });
    schedule();
    return { ok: true };
  }

  // Reconnect to a server-owned session after refresh/login. The server remains
  // authoritative; this only restores the local display and triggers catch-up.
  async function resumeActive() {
    if (!ENABLED || active) return { ok: !!active };
    const session = await fetchMySession();
    if (!session || !session.id || !session.pet_id) return { ok: false, error: 'NO_ACTIVE_SESSION' };
    const pet = Pet.getPets && Pet.getPets().find(function (p) { return p.cloudId === session.pet_id; });
    if (!pet) return { ok: false, error: 'PET_NOT_FOUND' };
    const B = window.Battle;
    if (B && B.selectArea && session.area_id) B.selectArea(session.area_id);
    const area = B && B.getCurrentArea ? B.getCurrentArea() : null;
    if (!area || area.id !== session.area_id) return { ok: false, error: 'AREA_NOT_FOUND' };
    petId = session.pet_id;
    totalFights = 0;
    active = true;
    if (window.UI) window.UI.updateStatus('fighting', 0);
    startShow();
    await settleNow();
    schedule();
    return { ok: true, resumed: true };
  }

  // skipServer=true：只拆本地演出/定时器，不给服务器发 stop ——
  // 换图重开挂机时用：battle_session('start') 在服务器侧本来就是「停旧建新」一条事务，
  // 若这里再发 stop，两个请求乱序到达时 stop 会把【刚建好的新会话】停掉（按 started_at 倒序取最新）。
  function stop(skipServer) {
    if (!active) return;
    active = false;
    clearTimeout(timer); timer = null;
    stopShow();
    petId = null;
    if (!skipServer) callFn({ action: 'stop' }).catch(function () { /* 忽略 */ });
  }

  /* ---------- 结算一次（战报 = 真账校准 + 剧本续段） ---------- */
  let settling = false; // 并发锁：切回前台的立即结算与定时结算可能撞车
  async function settleNow() {
    if (!active || settling) return { error: 'NOT_ACTIVE' };
    settling = true;
    try {
      return await doSettle();
    } finally {
      settling = false;
    }
  }
  async function doSettle() {
    const r = await callFn({ action: 'settle' });
    if (r.error) {
      if (r.error === 'NO_ACTIVE_SESSION') {
        active = false; clearTimeout(timer); timer = null; stopShow();
        if (window.UI) window.UI.updateStatus('stopped', totalFights);
        return r;
      }
      /* 失败也要设冷却（2026-09-08 血泪）：gaugeTick 每帧都在等剧本，
       * 剧本空 + settle 失败 + 无冷却 = 每秒轰炸一次服务器（控制台 500 刷屏就是它）。
       * 冷却 30s = 正常结算节奏：真账由服务器惰性记账，晚结算不亏。 */
      nextScriptTryAt = Date.now() + SCRIPT_RETRY_MS;
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 挂机暂时没有更新，正在继续运行…');
      return r;
    }
    blog('[战斗·结算] 补账场数=' + (r.fights || 0) + ' | 窗口秒=' + (r.elapsedSec || 0) + ' | endHp=' + r.endHp);
    // 服务器权威剧本（已入账的录像）：
    //   同一段重发（刷新/切回前台幂等返回）→ 判重忽略，不重播不重复给经验；
    //   当前这段还在演 → 攒着等演完再装（不抹掉正在打的怪）；
    //   空场 → 直接装。
    const sc = r.script;
    const sameScript = !!(sc && sc.id && sc.id === currentScriptId);
    // 同一段录像重发时跳过经验/等级覆盖：本地显示正在按回放基线重演，
    // 先被窗后真值覆盖再继续逐场加 = 经验重复入账（第二次跳变）。血量/场数照常同步。
    applyResult(r, { skipExpLevel: sameScript });
    // 补账场（客户端没演到的：切后台/刷新空窗）：只补掉落与任务展示。
    // 经验不在这里给——它已含在剧本回放基线（expBefore）里，重复给就是第二次"经验跳变"。
    compensateFights(r.detail || []);
    if (sc && sc.events && sc.events.length) {
      if (sameScript) {
        blog('[战斗·剧本] 同一段录像重发，忽略（id=' + sc.id + '）');
      } else if (script && scriptIdx < script.events.length && showEnemy) {
        pendingScript = sc;
      } else {
        installScript(sc);
      }
      nextScriptTryAt = 0;
    } else {
      nextScriptTryAt = performance.now() + SCRIPT_RETRY_MS; // 冷却，防每帧重试打爆服务器
      blog('[战斗·剧本] 服务器未返回剧本，' + SCRIPT_RETRY_MS / 1000 + 's 后重试');
    }
    notifyChange();
    return r;
  }

  // 装上新剧本（settle 拿到录像且当前没怪在演时 / 上一段演完时经 pendingScript 交棒）
  function installScript(sc) {
    blog('[战斗·换剧本] 打断?', showEnemy ? ('是！正在打 ' + showEnemy.name + ' 血' + Math.round(showEnemy.hp)) : '否(空场)',
      '| 旧进度=' + scriptIdx + '/' + (script ? script.events.length : 0),
      '| 新场数=' + sc.events.length);
    dropPendingHits();
    showPlan = null;
    showEnemy = null;
    gauge.pet = 0; gauge.enemy = 0;
    freezeUntil.pet = 0; freezeUntil.enemy = 0;
    script = sc;
    currentScriptId = sc.id || null;
    // 回放基线：这段录像在服务器已入账。把本地经验/等级重置到「窗前真值」再逐场重演，
    // 演完正好落在服务器 expLeft/level —— 显示 = 真账，零漂移。
    // （刷新后页面从 DB 拿到的是窗后真值，重演时会先回到窗前、随演出涨回去，因果可见。）
    const p = Pet.getActivePet();
    if (p && sc.levelBefore != null) p.level = sc.levelBefore;
    if (p && sc.expBefore != null) p.exp = Math.max(0, Number(sc.expBefore) || 0);
    if (Number.isFinite(Number(sc.events[0].hpStart))) showHp = Number(sc.events[0].hpStart);
    scriptT0 = performance.now();
    scriptIdx = -1; // gaugeTick 取第一个事件
    nextScriptTryAt = 0;
  }

  /* ---------- 补账场：服务器打了但客户端没演到的场次（切后台/刷新空窗） ----------
   * 只补掉落展示与任务进度，**不补经验**——补账经验已含在剧本回放基线
   * （installScript 的 expBefore）里，这里再给一次就是凭空跳变。
   * 展示上限 20 场：切后台被节流很久回来时不会一口气刷几十条掉落把日志冲垮，
   * 剩余场次只提示"已入账"。
   */
  function compensateFights(detail) {
    const list = Array.isArray(detail) ? detail : [];
    const n = Math.min(20, list.length);
    if (list.length <= 0) return;
    const area = window.Battle && window.Battle.getCurrentArea ? window.Battle.getCurrentArea() : null;
    const pet = Pet.getActivePet();
    for (let i = 0; i < n; i++) {
      const row = list[i];
      if (window.Quest && window.Quest.reportType) {
        window.Quest.reportType('kill', 1, { areaId: area ? area.id : null, petName: pet ? pet.name : null });
        if (row && row.boss) window.Quest.reportType('boss', 1, { areaId: area ? area.id : null });
      }
      const foe = row && row.name
        ? { name: row.name, level: Number(row.lv) || 1 }
        : ((window.Battle && window.Battle.pickScaledEnemy) ? window.Battle.pickScaledEnemy() : null);
      if (window.UI && window.UI.addLog && foe) {
        const xpText = row && row.exp != null ? `：经验 +${row.exp}` : '';
        window.UI.addLog(`⚔️ 击败 ${foe.name} Lv.${foe.level || 1}${xpText}`);
      }
      const serverReward = row && Object.prototype.hasOwnProperty.call(row, 'reward') ? row.reward : null;
      if (serverReward) {
        Promise.resolve().then(async function () {
          if (serverReward.type === 'material' && serverReward.material && window.Materials && window.Materials.gain) {
            if (window.Materials.gainLocal) window.Materials.gainLocal(serverReward.material, Number(serverReward.qty) || 1);
          }
          if (serverReward.type !== 'none' && window.UI && window.UI.showLoot) window.UI.showLoot(serverReward);
        });
      } else if (area && foe && window.Drop && window.Drop.rollReward) {
        window.Drop.rollReward(foe, area, { boss: !!(row && row.boss), enemyLevel: Number((row && row.lv) || 1) || 1 }).then(function (r2) {
          if (r2 && window.UI && window.UI.showLoot) window.UI.showLoot(r2);
        });
      }
    }
    if (list.length > n && window.UI && window.UI.addLog) {
      window.UI.addLog(`⏸ 后台期间还有 ${list.length - n} 场收益已入账（不逐条展示）`);
    }
    if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
  }

  /* ---------- 战报应用（经验/等级/真值血量锚点） ---------- */
  function applyResult(r, opts) {
    const pet = Pet.getActivePet();
    if (!pet) return;
    if (petId && pet.cloudId && petId !== pet.cloudId) {
      stop();
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 换了出战宠物，挂机已停止，请重新点击开始。');
      return;
    }
    const maxLevel = (window.Config && window.Config.pet && window.Config.pet.maxLevel) || 60;
    if (r.endHp != null) { Pet.setCurHp(pet, r.endHp); showHp = Math.min(Pet.getCurHp(pet), Pet.getStats(pet).hp); }
    /* 经验/等级以服务器为唯一权威（2026-09-09）：
     * 旧逻辑 `r.level >= pet.level` 才覆盖是单向保护 —— 本地预演提前升级后，
     * 服务器永远追不回来，漂移固化。演出只是预演，等级该涨该降都听真账。
     * 回放版例外：同一段录像幂等重发时（opts.skipExpLevel）本地显示正在按
     * 回放基线重演，先被窗后真值覆盖再逐场加 = 重复入账，此时跳过经验/等级覆盖。 */
    if (r.level != null && !(opts && opts.skipExpLevel)) {
      const wasLevel = pet.level || 1;
      if (r.level > wasLevel) {
        if (window.UI && window.UI.addLog) window.UI.addLog(`✨ ${pet.name} 升级 Lv.${r.level}！`);
      } else if (r.level < wasLevel) {
        if (window.UI && window.UI.addLog) window.UI.addLog(`⚖️ 经验校准 Lv.${wasLevel} → Lv.${r.level}（以服务器真账为准）`);
      }
      pet.level = r.level;
      if (r.level < maxLevel && r.expLeft != null) pet.exp = r.expLeft;
    }
    totalFights = r.totalFights != null ? r.totalFights : (totalFights + (r.fights || 0));
    const UI = window.UI;
    if (UI) {
      if (showEnemy && UI.updateBars) UI.updateBars(Math.round(showHp), Pet.getStats(pet).hp, showEnemy.hp, showEnemy.maxHp || 100);
      if (UI.updateStatus) UI.updateStatus('fighting', totalFights);
    }
    if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
    notifyChange();
  }

  // 切回前台立即结算：真账校准 + 重生成剧本（旧剧本作废，无缝衔接）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && active) settleNow();
  });

  function notifyChange() { if (onChange) { try { onChange(); } catch (e) { /* 忽略 */ } } }

  /* ---------- 演出：怪上台 ---------- */
  function mountShowEnemy(enemyData, fightEvt) {
    const B = window.Battle;
    if (!enemyData) return;
    const area = B && B.getCurrentArea();
    // 怪等级只能来自剧本（f.enemyLevel）：不传就会退回怪的静态 level，画面与真账错位
    const lv = (fightEvt && fightEvt.enemyLevel) || enemyData.level || 1;
    // Align the displayed player HP with the authoritative script at each fight boundary.
    if (fightEvt && Number.isFinite(Number(fightEvt.hpStart))) showHp = Number(fightEvt.hpStart);
    const scaled = (B && B.scaleEnemyOf) ? B.scaleEnemyOf(enemyData, lv) : Object.assign({}, enemyData);
    if (!scaled) return;
    scaled.raw = enemyData;   // 自检重挂用未缩放的原始数据（否则会被二次缩放）
    scaled.level = lv;
    dropPendingHits();        // 换怪：上一只在飞的刀一律作废
    showEnemy = scaled;
    showEnemyMountedAt = performance.now();
    // 本场演出配额（刀数来自剧本，模拟器统计的真实出手次数）。
    // 老剧本 / 测试桩没有 petHits → showPlan = null，演出退回旧的「速度公式 + 时间插值」。
    const ph = Number(fightEvt && fightEvt.petHits) || 0;
    const eh = Number(fightEvt && fightEvt.enemyHits) || 0;
    showPlan = (ph > 0 || eh > 0) ? {
      petHits: ph, enemyHits: eh,
      petLeft: ph, enemyLeft: eh,
      petLoss: Math.max(0, (Number(fightEvt.hpStart) || 0) - (Number(fightEvt.hpLeft) || 0)),
      // 宠每刀真实伤害序列（2026-09-09，模拟器剧本自带）：有它就用真实值飘字扣血，
      // 等级压制看得见（低级宠每刀 1 点就是飘 1）；老剧本没有则退回血量均摊。
      petDmg: Array.isArray(fightEvt.petDmg) ? fightEvt.petDmg : null
    } : null;
    const UI = window.UI;
    const pet = Pet.getActivePet();
    if (!pet || !UI || !UI.resetBattle) return;
    const maxHp = Pet.getStats(pet).hp;
    UI.resetBattle(
      pet.name + ' 等级：' + (pet.level || 1) + '级', pet.icon,
      showEnemy.name + ' 等级：' + (showEnemy.level || 1) + '级', showEnemy.icon,
      maxHp, showEnemy.maxHp || 100
    );
    if (UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, showEnemy.maxHp, showEnemy.maxHp || 100);
    blog('[战斗·上怪]', showEnemy.name, 'Lv' + showEnemy.level,
      '| 血=' + showEnemy.maxHp,
      '| 刀数(我/敌)=' + (showPlan ? (showPlan.petHits + '/' + showPlan.enemyHits) : '(无计划→时间插值)'),
      '| 本场时长=' + (showPlan ? '-' : '-'));
  }

  function enterHealWait(UI) {
    waitingHeal = true;
    gauge.pet = 0; gauge.enemy = 0;
    if (UI && UI.updateAction) UI.updateAction(0, 0);
    if (UI && UI.addLog) UI.addLog('💔 血量不足 30%，回血后再战…');
    if (UI && UI.updateStatus) UI.updateStatus('recovering', totalFights);
    dropPendingHits();
    showEnemy = null;
    const ef = document.getElementById('enemy-fighter');
    if (ef) ef.style.display = 'none';
  }

  // 宠物可演出的主动技能（终形态名 + 等级达标）；变异剥后缀继承本体
  function getShowSkill(pet) {
    const C = window.Config;
    const skills = (C.pet && C.pet.evolution && C.pet.evolution.activeSkills) || {};
    const base = String(pet.name || '').replace(/·异变$/, '');
    const s = skills[base];
    if (!s || (pet.level || 1) < (s.minLevel || 60)) return null;
    return s;
  }

  // 演出伤害：与服务器【同一套】伤害公式（battle.js calcDamage：命中/暴击/穿透/减免全在）。
  // 公式真，用途是演出——战斗胜负/收益仍由剧本（服务器模拟）决定。
  function rollShowDamage(attackerSide) {
    const pet = Pet.getActivePet();
    const B = window.Battle;
    if (!pet || !showEnemy || !B || !B.calcDamage) return null;
    if (attackerSide === 'pet') {
      return B.calcDamage(Pet.getStats(pet), showEnemy);
    }
    const C = window.Config;
    return B.calcDamage({
      atk: showEnemy.atk, hit: 90,
      critRate: (C.battle && C.battle.critRate), critDamage: (C.battle && C.battle.critMultiplier),
      pen: 0, dmgBonus: 0
    }, { def: Pet.getStats(pet).def, dodge: Pet.getStats(pet).dodge, dr: Pet.getStats(pet).dr || 0 });
  }

  // 一次出手演出（观感层）：冲刺 + 受击 + 飘字。血量全部由剧本插值决定，这里不碰数值。
  function showTurn(side, now) {
    const UI = window.UI;
    const pet = Pet.getActivePet();
    if (!pet || !showEnemy || !UI || !UI.animateAttack) return;
    const isPet = side === 'pet';
    // 本场刀数打完就不再出手：剧本只打了 N 刀，多打会把血提前扣穿、然后怪站着等 t1
    if (showPlan && ((isPet && showPlan.petLeft <= 0) || (!isPet && showPlan.enemyLeft <= 0))) return;
    const skill = isPet ? getShowSkill(pet) : null;
    let useSkill = false;
    if (skill && skillCd <= 0 && Math.random() < (skill.triggerChance || 0.3)) {
      useSkill = true;
      skillCd = skill.cooldownTurns || 3;
    }
    const hitAt = UI.animateAttack(side) || 320;
    const backMs = UI.attackRecoverMs ? (UI.attackRecoverMs(side) || 0) : 0;
    lastHitAt = hitAt; lastBackMs = backMs;
    freezeUntil[side] = now + hitAt + backMs;
    // Pause both visible gauges only until the hit lands. The attacker's own
    // recovery remains frozen separately, so the other side does not inherit
    // the extra recovery delay. This is presentation-only.
    const freezeBothUntil = now + hitAt;
    freezeUntil.pet = Math.max(freezeUntil.pet, freezeBothUntil);
    freezeUntil.enemy = Math.max(freezeUntil.enemy, freezeBothUntil);
    const run = function () {
      if (!active || waitingHeal) return;
      // 怪已下场（本场已切走/换怪/停演）→ 这刀作废。
      // 没有这道闸的话，清场后才触发的飘字会打到下一只怪身上。
      if (!showEnemy) return;
      if (isPet && skillCd > 0) skillCd--;
      const d = rollShowDamage(side);
      const target = isPet ? 'enemy' : 'pet';
      const isCrit = !!(d && d.isCrit);
      const isMiss = !!(d && d.isMiss);
      if (UI.animateHit) UI.animateHit(target, isCrit);
      if (d && !isMiss && d.heal > 0 && UI.showDamage) {
        UI.showDamage(side, d.heal, 'lifesteal');
      }
      const plan = showPlan;
      if (plan) {
        /* 刀驱动（2026-09-09 修订）：优先用剧本自带的宠每刀【真实伤害】petDmg——
         * 飘字 = 血条实际扣掉的数字 = 模拟器真账，等级压制看得见
         *（低级宠打高级图每刀 1 点就如实飘 1，不再演出成"飘几百砍得动"）；
         * 老剧本没有 petDmg 时退回血量均摊（总量守恒，终点仍是剧本权威 hpLeft）。 */
        const maxHp = Pet.getStats(pet).hp;
        if (isMiss) {
          // 真实伤害模式下 miss 刀也占配额（模拟器 petHits 计数含 miss 刀），否则刀序错位
          if (plan.petDmg) plan.petLeft = Math.max(0, plan.petLeft - 1);
          if (UI.showDamage) UI.showDamage(target, 0, 'miss', null);
        } else if (isPet && showEnemy) {
          let drop;
          if (plan.petDmg) {
            // 真实伤害序列（空数组=一刀都没砍出来就被杀，也走这里 → 每刀如实飘 0）
            const idx = plan.petHits - plan.petLeft;
            drop = idx < plan.petDmg.length
              ? Math.min(showEnemy.hp, Math.max(0, Math.round(Number(plan.petDmg[idx]) || 0)))
              : 0;
          } else {
            const mult = isCrit ? 1.6 : 0.85;
            drop = plan.petLeft <= 1
              ? showEnemy.hp
              : Math.min(showEnemy.hp, Math.max(1, Math.round(showEnemy.hp / Math.max(1, plan.petLeft) * mult)));
          }
          showEnemy.hp = Math.max(0, showEnemy.hp - drop);
          plan.petLeft = Math.max(0, plan.petLeft - 1);
          if (UI.showDamage) UI.showDamage('enemy', drop, useSkill ? 'skill' : isCrit ? 'crit' : 'normal', useSkill ? skill.name : null);
          if (UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, Math.max(0, showEnemy.hp), showEnemy.maxHp || 100);
          // 本场刀数打完 → 怪就死在这一刀上（不等剧本时间，怪不再凭空消失）
          const fEnd = script && script.events[scriptIdx];
          if (fEnd && fEnd.win && plan.petLeft <= 0) { finishShowFight(fEnd, performance.now(), 'lasthit'); return; }
        } else if (!isPet) {
          const f = script && script.events[scriptIdx];
          const floorHp = f && Number.isFinite(Number(f.hpLeft)) ? Number(f.hpLeft) : 0;
          const remain = Math.max(0, showHp - floorHp);
          const mult = isCrit ? 1.6 : 0.85;
          const drop = plan.enemyLeft <= 1
            ? remain
            : Math.min(remain, Math.max(1, Math.round(plan.petLoss / Math.max(1, plan.enemyLeft) * mult)));
          showHp = Math.max(floorHp, showHp - drop);
          plan.enemyLeft = Math.max(0, plan.enemyLeft - 1);
          if (UI.showDamage) UI.showDamage('pet', drop, useSkill ? 'skill' : isCrit ? 'crit' : 'normal', useSkill ? skill.name : null);
          if (UI.updateBars && showEnemy) UI.updateBars(Math.round(showHp), maxHp, Math.max(0, showEnemy.hp), showEnemy.maxHp || 100);
        }
      } else {
        // 无刀数（老剧本 / 测试桩）：退回旧行为「真实伤害飘字 + 按剧本时间插值扣血」
        let dmg = d ? d.damage : 0;
        if (useSkill && d && !isMiss) dmg = Math.floor(dmg * (skill.damageMultiplier || 1.5));
        if (d && UI.showDamage) {
          UI.showDamage(target, dmg, isMiss ? 'miss' : useSkill ? 'skill' : isCrit ? 'crit' : 'normal',
            useSkill ? skill.name : null);
        }
        const f = script && script.events[scriptIdx];
        if (f && f.type === 'fight' && d && !isMiss) {
          const span = Math.max(1, f.t1 - f.t0);
          const prog = Math.min(1, Math.max(0, (performance.now() - scriptT0 - f.t0) / span));
          const maxHp = Pet.getStats(pet).hp;
          if (isPet && showEnemy) showEnemy.hp = Math.max(0, showEnemy.maxHp * (1 - prog));
          else if (!isPet) showHp = f.hpStart + (f.hpLeft - f.hpStart) * prog;
          if (UI.updateBars && showEnemy) UI.updateBars(Math.round(showHp), maxHp, Math.max(0, showEnemy.hp), showEnemy.maxHp || 100);
        }
      }
    };
    const entry = {
      run: run,
      timer: setTimeout(function () {
        const i = pendingHits.indexOf(entry);
        if (i >= 0) pendingHits.splice(i, 1);
        run();
      }, hitAt)
    };
    pendingHits.push(entry);
  }

  // 本场时间到：把还在飞的那一刀就地结算完再清场（同一帧完成，不推长剧本时间轴 ——
  // 推长会让播放总时长 > 预演时长，服务器按被拉长的真实时间算账 → 每段多打几场 → 补发刷屏）
  function flushPendingHits() {
    while (pendingHits.length) {
      const h = pendingHits.shift();
      clearTimeout(h.timer);
      h.run();
    }
  }
  // 丢掉所有在飞的演出刀（停演 / 换怪 / 进回血等待）
  function dropPendingHits() {
    while (pendingHits.length) clearTimeout(pendingHits.shift().timer);
  }

  /* ---------- 本场收尾：胜负演出 + 结算 + 交棒下一只 ----------
   * 2026-09-09 关键修正：怪必须死于【最后一刀命中】，而不是死于"剧本时间到了"。
   * 之前只有 t1 一个出口，于是刀还在半空、血还剩一截，怪就被时间凭空清掉 →
   * 玩家看到"攻击没落到怪身上，怪就死了，直接下一场"。
   * 现在两个入口共用这段：刀打完（正常，见 showTurn）/ t1 超时（兜底）。 */
  function finishShowFight(f, now, reason) {
    const UI = window.UI;
    const pet = Pet.getActivePet();
    if (!pet || !f) return;
    const maxHp = Pet.getStats(pet).hp;
    showPlan = null;          // 先清计划，避免 flush 内部再次触发本场结束
    flushPendingHits();        // 在飞的刀结算掉：怪还在场，最后一刀的飘字才看得见
    // 诊断埋点放在 flush 之后：timeout 场的最后半空刀会在这里就地结算，
    // 日志反映的是最终真相（补刀后怪血=0），不再是"补刀前还剩 1663 血"的中间态。
    blog('[战斗·收尾] 原因=' + (reason || '?'),
      '| 场序=' + scriptIdx,
      '| 怪=' + (showEnemy ? (showEnemy.name + ' Lv' + showEnemy.level) : '(无怪)'),
      '| 怪血=' + (showEnemy ? (Math.max(0, Math.round(showEnemy.hp)) + '/' + (showEnemy.maxHp || 0)) : '-'),
      '| 剩余刀=' + '(已补)',
      '| t/t1=' + Math.round(now - scriptT0) + '/' + Math.round(f.t1));
    if (Number.isFinite(Number(f.hpLeft))) showHp = Number(f.hpLeft);
    if (showEnemy && f.win) showEnemy.hp = 0;
    if (f.win && showEnemy && UI && UI.updateBars) {
      UI.updateBars(Math.round(showHp), maxHp, 0, showEnemy.maxHp || 100);
    }
    if (f.win) {
      settleKill(f);
      if (UI && UI.animateVictory) UI.animateVictory();
    } else if (UI && UI.addLog) {
      UI.addLog('💀 战败…');
    }
    showEnemy = null;
    scriptIdx++;
    // 每场都重置行动条：别把上一只怪的残条带进下一场
    gauge.pet = 0;
    gauge.enemy = 0;
    freezeUntil.pet = now;
    freezeUntil.enemy = now;
    const stop2 = ((window.Config.battle || {}).stopHpRatio) || 0.3;
    const needHeal = (!f.win || showHp <= maxHp * stop2);
    const ef = document.getElementById('enemy-fighter');
    if (ef) ef.style.display = 'none';
    if (needHeal) enterHealWait(UI);
  }

  // 敌方立绘自检：空图自动重挂 + 日志取证
  function checkEnemySprite() {
    const el = document.getElementById('enemy-icon');
    if (!el || !showEnemy) return;
    const img = el.querySelector('img');
    if (!img) return;
    if (img.complete && img.naturalWidth === 0) {
      const src = img.getAttribute('src') || '(无 src)';
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 敌方立绘加载失败：' + showEnemy.name + ' ← ' + src);
      // 用 raw（未缩放原始怪）+ 当前剧本事件重挂，避免拿已缩放对象二次缩放。
      // 必须传完整事件（含 petHits）才能重建演出配额；血要保住，不能被退回本场起点。
      const keepHp = showHp;
      mountShowEnemy(showEnemy.raw || showEnemy, script ? script.events[scriptIdx] : { enemyLevel: showEnemy.level });
      if (Number.isFinite(Number(keepHp))) showHp = keepHp;
    }
  }

  /* ---------- 演出主循环：照剧本回放 ---------- */
  function gaugeTick(now) {
    if (!active) return;
    gaugeRaf = requestAnimationFrame(gaugeTick);
    const pet = Pet.getActivePet();
    const UI = window.UI;
    if (!pet || !UI || !UI.updateAction) return;
    const dt = Math.max(0, Math.min(200, now - lastGaugeTs));
    lastGaugeTs = now;
    const C = window.Config;
    const maxHp = Pet.getStats(pet).hp;

    // 剧本播完/未就绪：结算续段（settling 锁防重入 + 冷却，剧本拿不到时不每帧打服务器）
    if (!script || scriptIdx >= script.events.length) {
      // 有攒着的剧本（播放中途 settle 回来的）→ 装上继续演，不必再打服务器
      if (pendingScript) { installScript(pendingScript); pendingScript = null; return; }
      if (!settling && now >= nextScriptTryAt) settleNow().catch(function () { /* 忽略 */ });
      return;
    }
    const t = now - scriptT0;

    // 场前回血等待：回满 → 遭遇下一事件的新怪
    if (waitingHeal) {
      showHp = Math.min(maxHp, showHp + maxHp * ((C.regen || {}).hpPerSecRatio || 0.2) * dt / 1000);
      if (showHp >= maxHp) {
        waitingHeal = false;
        if (UI.addLog) UI.addLog('💚 恢复完毕，遭遇新的野怪！');
        if (UI.updateStatus) UI.updateStatus('fighting', totalFights);
        const ef = document.getElementById('enemy-fighter');
        if (ef) ef.style.display = '';
        const nxt = script.events[scriptIdx];
        if (nxt && nxt.type === 'fight') mountShowEnemy(nxt.enemy, nxt);
      }
      if (now - lastBarTs >= 100) { lastBarTs = now; UI.updateBars(Math.round(showHp), maxHp, 0, 1); }
      return;
    }

    const f = script.events[scriptIdx];
    if (!f || f.type !== 'fight') { scriptIdx++; return; }

    // 上场衔接优先：怪没上台绝不判这场结束。
    // ⚠️ 顺序铁律：必须先 mount 再判 kill——rAF 卡顿 / 切后台回来时 t 会快进，
    //    若 kill 判定跑在 mount 前面，几场战斗会在怪从未出现过的情况下被
    //    「空气击杀」（击杀日志连发 + 画面没怪），这就是用户看到的"打空气"。
    if (!showEnemy) {
      if (t < f.t0) {
        // 场间 gap（模拟器自带 600ms）：空场，不进战斗推进
        if (now - lastBarTs >= 100) {
          lastBarTs = now;
          UI.updateAction(0, 0);
          if (UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, 0, 1);
        }
        return;
      }
      mountShowEnemy(f.enemy, f);
    }

    /* 剧本时间到 —— 这只是【兜底】。正常流程里怪会先被最后一刀打死（见 showTurn），
     * 走到这里说明演出落后于剧本（切后台/卡顿），此时才按时间强制收尾。
     * ⚠️ 下一只怪的交棒仍由主循环按剧本时点 f.t0 挂上，击杀淡出落在模拟器自带的
     *    场间 gap 里，不额外占用真实时间 —— 千万不要把时间轴后推/暂停来"加长空场"，
     *    那会让播放总时长 > 预演时长，服务器按被拉长的真实时间算账 → 补发刷屏。 */
    if (t >= f.t1) {
      // 刚上台就超时（切后台回来 / 长卡顿，t 被快进）：把时间轴挪回本场开头让它完整演一遍，
      // 否则会出现"怪刚露脸就被时间清掉"—— 跟凭空死是一回事。
      if (showEnemy && now - showEnemyMountedAt < 300) { scriptT0 = now - f.t0; return; }
      finishShowFight(f, now, 'timeout');
      return;
    }

    // 战斗中：场内进度（供命中时阶梯扣血；两刀之间血量静止，观感自然）
    const span = Math.max(1, f.t1 - f.t0);
    const prog = Math.min(1, Math.max(0, (t - f.t0) / span));

    /* 收尾兜底：万一刀数没打完时间就见底（本场太短 / 冻结太重），
     * 最后 tailMs 内把剩余血平滑抹到 0 —— 绝不让怪"还有一截血、刀还在半空"凭空消失。
     * 正常打完时 tailHp 已经是 0，这段不产生任何影响。
     * ⚠️ tail 窗口提前到 ≥700ms（2026-09-09）：日志实证 timeout 场剩余刀=1/4 ——
     *    定速公式（costOf 用 stale 的 lastHitAt 估算冻结成本）漂移，刀打不完被 t1 强杀。
     *    现在 tail 一到先把剩余刀全部放出去（拉满行动条），血条交还刀驱动；刀全打完
     *    （petLeft=0）后才走原来的平滑抹零 —— 怪死在最后一刀上，而不是死在计时器上。 */
    if (showPlan && showEnemy && f.win) {
      const tailMs = Math.max(700, Math.min(900, span * 0.2));
      const left = (scriptT0 + f.t1) - now;
      if (left <= tailMs) {
        if (showPlan.petLeft > 0 || showPlan.enemyLeft > 0) {
          // 剩余刀还没出完：立即解锁行动条，把刀放出去（showTurn 里 petLeft<=0 会挡重复出手）
          if (showPlan.petLeft > 0 && now >= freezeUntil.pet) gauge.pet = 100;
          if (showPlan.enemyLeft > 0 && now >= freezeUntil.enemy) gauge.enemy = 100;
        } else {
          if (showPlan.tailHp == null) showPlan.tailHp = showEnemy.hp;
          showEnemy.hp = Math.min(showEnemy.hp, Math.round(showPlan.tailHp * Math.max(0, left / tailMs)));
        }
      }
    }

    // 行动条累积（出手节奏观感，速度差与原战斗同公式；出手冻结期间不涨）
    const ps = Pet.getStats(pet);
    const scale = (C.battle && C.battle.speedScale) || 12;
    /* 行动条定速（2026-09-09）：按「剩余时间 / 剩余刀数」自适应，让每一刀都正好铺在
     * 本场剧本时间轴上 —— 条满 → 出刀 → 掉血，不再出现「行动条还没跑满怪就死了」。
     * 老剧本没有刀数时退回速度公式。 */
    const remainMs = Math.max(1, (scriptT0 + f.t1) - now);
    /* ⚠️ 定速必须扣掉冻结开销：出手期间行动条是冻住的（己方 hitAt+backMs，
     * 对方出手还要再冻 hitAt）。用「本场总时长」当预算会算出过慢的速度，
     * 结果刀还没出完时间就耗尽 → 怪还剩一截血、刀在半空，被 t1 强杀。
     * 这里按「剩余刀数各自的冻结成本」倒推真正能涨条的时间。
     * ×0.85 安全余量（2026-09-09 日志实证）：冻结成本用 stale 的 lastHitAt 估算，
     * 实际 hitAt 随屏宽浮动，估满不减就会"永远差最后一刀"被 t1 兜底 ——
     * 预算打 85 折让每刀略早出，宁可打完站着等 0.x 秒，也不让刀被计时器掐掉。 */
    const costOf = (mine, other) => mine * (lastHitAt + lastBackMs) + other * lastHitAt;
    if (now >= freezeUntil.pet) {
      gauge.pet += (showPlan && showPlan.petHits > 0)
        ? dt * 100 * Math.max(1, showPlan.petLeft) /
          Math.max(120, (remainMs - costOf(showPlan.petLeft, showPlan.enemyLeft)) * 0.85)
        : dt * ps.spd / (scale * 100);
    }
    if (now >= freezeUntil.enemy) {
      gauge.enemy += (showPlan && showPlan.enemyHits > 0)
        ? dt * 100 * Math.max(1, showPlan.enemyLeft) /
          Math.max(120, (remainMs - costOf(showPlan.enemyLeft, showPlan.petLeft)) * 0.85)
        : dt * (showEnemy.spd || 40) / (scale * 100);
    }

    // 出手演出（观感，互斥冻结；血量在命中瞬间阶梯更新）
    if (now >= freezeUntil.pet && gauge.pet >= 100) { gauge.pet = 0; showTurn('pet', now); }
    if (now >= freezeUntil.enemy && gauge.enemy >= 100) { gauge.enemy = 0; showTurn('enemy', now); }
    if (now - lastBarTs >= 100) {
      lastBarTs = now;
      UI.updateAction(Math.min(100, gauge.pet), Math.min(100, gauge.enemy));
      if (UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, Math.max(0, showEnemy.hp), showEnemy.maxHp || 100);
      checkEnemySprite();
    }
  }

  /* ---------- 本场结算（剧本到点调用）：配额消费 + 经验 + 掉落 + 任务 ---------- */
  function settleKill(f) {
    const area = window.Battle.getCurrentArea();
    const pet = Pet.getActivePet();
    // Update the visible experience bar immediately for this displayed kill.
    // The next server settle overwrites it with the authoritative level/exp.
    if (pet && Number(f.exp) > 0 && window.Pet && window.Pet.grantExp) {
      window.Pet.grantExp(pet, Number(f.exp));
    }
    // 经验条/等级要跟着每场击杀即时刷新：renderAll 只在 applyResult（服务器真账回来）
    // 时经 notifyChange 触发，托管期间画面就冻结到结算前 —— 观感 = 经验没有实时结算。
    // 与本地模式 handleFightEnd 每场 renderAll 同一节奏，开销同级。
    notifyChange();
    if (window.Quest && window.Quest.reportType) {
      window.Quest.reportType('kill', 1, { areaId: area ? area.id : null, petName: pet ? pet.name : null });
    }
    if (area && window.Quest && window.Quest.getReadyLoop) {
      const ready = window.Quest.getReadyLoop(area.id);
      if (ready && !settleKill._loopNotice) settleKill._loopNotice = {};
      const noticeKey = 'loop_' + area.id;
      if (ready && !settleKill._loopNotice[noticeKey]) {
        settleKill._loopNotice[noticeKey] = true;
        if (window.UI && window.UI.consoleLog) window.UI.consoleLog('system', `<b>📜 地图委托完成</b> ${ready.name} 已收集 ${ready.need} 个材料`, { action: 'openQuest' });
        if (window.UI && window.UI.addLog) window.UI.addLog(`📜 ${ready.name} 已完成，可领取奖励`);
      }
      if (!ready && settleKill._loopNotice) settleKill._loopNotice['loop_' + area.id] = false;
    }
    // 守关 Boss：上报 boss 类型任务（首通判定：击杀数 ≥1 且未完成 → 任务完成可领一次性奖励）
    if (f.isBoss && f.win && window.Quest && window.Quest.reportType) {
      window.Quest.reportType('boss', 1, { areaId: area ? area.id : null });
    }
    if (window.UI && window.UI.addLog) {
      window.UI.addLog(`⚔ 击败 ${f.enemyName} Lv.${f.enemyLevel}：经验 +${f.exp}`);
    }
    // 新战报的 reward 已由服务器决定；页面只负责入包和展示。
    // 兼容旧版战报（没有 reward 字段）时才走旧掉落逻辑。
    const serverReward = f && Object.prototype.hasOwnProperty.call(f, 'reward') ? f.reward : null;
    if (serverReward) {
      Promise.resolve().then(async function () {
        let shown = serverReward;
        if (serverReward.type === 'material' && serverReward.material && window.Materials && window.Materials.gain) {
          if (window.Materials.gainLocal) window.Materials.gainLocal(serverReward.material, Number(serverReward.qty) || 1);
        }
        if (shown && shown.type !== 'none' && window.UI && window.UI.showLoot) window.UI.showLoot(shown);
        if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
      });
    } else {
      const foe = Object.assign({}, f.enemy, { level: f.enemyLevel });
      if (area && window.Drop && window.Drop.rollReward) {
        window.Drop.rollReward(foe, area, { boss: !!f.isBoss, enemyLevel: Number(f.enemyLevel) || 1 }).then(function (r) {
          if (r && window.UI && window.UI.showLoot) window.UI.showLoot(r);
          if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
        });
      }
    }
  }

  /* ---------- 预热 + 开场 ---------- */
  const readyEnemies = new Set();
  function imgLoad(src) {
    return new Promise(function (res) {
      const im = new Image();
      im.onload = res; im.onerror = res;
      im.src = src;
    });
  }
  function preloadShowEnemies() {
    const B = window.Battle;
    const PS = window.PetSprites;
    if (!B || !B.pickScaledEnemy || !PS) return Promise.resolve();
    const names = [];
    for (let i = 0; i < 12; i++) {
      const e = B.pickScaledEnemy();
      if (e && names.indexOf(e.name) < 0) names.push(e.name);
    }
    return Promise.all(names.map(function (name) {
      if (readyEnemies.has(name)) return Promise.resolve();
      try {
        const p = PS.pathOf && PS.pathOf(name);
        if (!p) { readyEnemies.add(name); return Promise.resolve(); }
        const a = PS.animOf && PS.animOf(name);
        const list = [imgLoad(p)];
        if (a && a.idle && a.idle.sheet) list.push(imgLoad(a.idle.sheet));
        return Promise.all(list).then(
          function () { readyEnemies.add(name); },
          function () { readyEnemies.add(name); }
        );
      } catch (err) { readyEnemies.add(name); return Promise.resolve(); }
    }));
  }

  function startShow() {
    blog('[战斗·模式] 服务器托管演出启动（IdleBridge）');
    gauge.pet = 0; gauge.enemy = 0;
    freezeUntil.pet = 0; freezeUntil.enemy = 0;
    waitingHeal = false;
    nextScriptTryAt = 0;
    script = null; scriptIdx = -1; pendingScript = null; currentScriptId = null;
    lastGaugeTs = performance.now();
    preloadShowEnemies();
    gaugeRaf = requestAnimationFrame(gaugeTick);
    // 首怪由剧本第一个事件驱动（settleNow 锚点返回后生成剧本）
  }
  function stopShow() {
    if (gaugeRaf) { cancelAnimationFrame(gaugeRaf); gaugeRaf = null; }
    dropPendingHits();
    showPlan = null;
    pendingScript = null;
    currentScriptId = null;
    showEnemy = null;
  }

  window.IdleBridge = {
    start, resumeActive, stop, settleNow,
    isActive: function () { return active; },
    enabled: ENABLED,
    getTotalFights: function () { return totalFights; },
    // 当前剧本身份（测试/取证用）：服务器幂等重发同一段录像时客户端靠它判重
    getScriptId: function () { return currentScriptId; },
    // 画面上正在打的怪（演出层唯一事实源）：UI 的敌方 tooltip 读它，
    // 不然托管模式下 Battle.state.enemy 恒 null，悬停看到的是空/旧怪
    getShowEnemy: function () { return showEnemy; },
    set onChange(fn) { onChange = fn; },
    get onChange() { return onChange; }
  };
})();
