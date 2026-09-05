/* ============================================================
 * idle-bridge.js —— 服务器权威挂机（剧本驱动版）
 *
 * 架构：服务器真打并记账；前端用【同一套模拟器 + 同一种子】预演下一段
 * 战斗（simulateSessionScript），演出照剧本回放。
 *   - 剧本事件：每场 {t0 开始, t1 结束, 打谁, 胜负, 经验, 血量从 hpStart 到 hpLeft}
 *   - 血量轨迹 = 模拟轨迹本身（确定、与服务器真账一致），不再有"两条流"
 *   - 出手动画/伤害飘字 = 观感层（数字用同一套伤害公式，但不决定血量）
 *   - 击杀/战败/回血等待全部由剧本时点驱动
 *
 * 时间线：点开始挂机 → 立即结算一次拿真值锚点 → 生成 30 秒剧本 → 回放
 *         → 剧本播完 → 再结算（真账校准 + 生成下一段）→ 无缝循环
 *
 * 退路：URL 加 ?noidle=1 → 本模块整体禁用，退回纯本地挂机（battle.js 老流程）。
 * 依赖：supabase.js / pet.js / battle.js / battle-sim.mjs（同源副本）/ ui-battle.js
 * ============================================================ */
(function () {
  'use strict';

  const Supabase = window.Supabase;
  const Pet = window.Pet;

  const FN_URL = 'https://asklogeayzlqpeejuvjj.supabase.co/functions/v1/battle-settle';
  const SETTLE_MS = 30000;      // 剧本时长基准（首次/兜底估计值；有真值后用上次窗口的真实秒数）
  const SAFETY_SETTLE_MS = 120000; // 兜底结算：剧本生成失败/卡死时也要把真账要回来（= 服务器宽限窗口）
  const SCRIPT_RETRY_MS = 30000; // 剧本失败后的重试冷却 = 正常结算窗口。
  // 剧本失败（通常=当前在长时间回血，模拟打不出场）时不必高频打服务器：
  // 每 30 秒 settle 一次，服务器照常算账，差额由补发一次性补齐，不刷屏。

  const ENABLED = !/[?&]noidle=1\b/.test(location.search);

  let active = false;
  let timer = null;         // 兜底 settle 定时器
  let petId = null;         // 本次会话绑定的宠物 cloudId
  let totalFights = 0;      // 服务器战报累计场数（展示用）
  let onChange = null;      // 战报到账通知（上层刷新界面）

  // 演出剧本
  let script = null;        // {events:[{type,t0,t1,win,enemy,enemyLevel,enemyName,exp,hpStart,hpLeft}], endHp, petMaxHp}
  let scriptT0 = 0;         // 剧本时间轴起点（performance.now）
  let scriptIdx = -1;       // 当前事件下标（-1 = 尚未开始）
  let lastElapsedSec = 0;   // 上次结算窗口的真实秒数（下一段剧本时长估计：服务器按真实时间记账，演出就得按同样长度演）
  let nextScriptTryAt = 0;  // 剧本生成失败后的重试冷却时间戳
  let shownFights = 0;      // 本窗口内演出已结算的击杀数（与服务器 r.fights 对账，补发掉落）

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

  /* ---------- 确定性剧本：同种子预演下一段战斗 ---------- */
  function hashSeed(parts) {
    let h = 2166136261;
    for (const p of parts) {
      const s = String(p || '');
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    }
    return h >>> 0;
  }

  let simModPromise = null;
  function loadSim() {
    // 模拟器加载：优先用页面加载好的全局版 battle-sim.global.js（零运行时请求）；
    // 全局版缺失时才回退动态 import（本地服务器忙时可能超时——就是之前"模拟器加载失败"的原因）
    if (!simModPromise) {
      if (window.BattleSim && window.BattleSim.simulateSessionScript) {
        simModPromise = Promise.resolve(window.BattleSim);
      } else {
        simModPromise = import('./battle-sim.mjs');
      }
    }
    return simModPromise;
  }

  // 查自己的当前会话（RLS 只返回自己的行）
  function fetchMySession() {
    try {
      const c = Supabase.getClient();
      if (!c) return Promise.resolve(null);
      return c.from('idle_sessions')
        .select('id,last_settled_at')
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

  // 生成下一段演出剧本。⚠️ 必须在 settle 成功后调用：
  // 此时表里的 last_settled_at 刚更新为本次值，与服务器下一次 settle 所用的种子一致。
  // seconds = 这段剧本要演多久。⚠️ 必须与服务器下一次结算窗口的真实长度一致：
  // 服务器按「真实经过时间」记账，演出若固定演 30 秒而服务器算了 40 秒，
  // 多出来的 10 秒战斗没有任何演出与掉落，场数/经验/掉落就对不上了。
  async function buildNextScript(startHp, seconds) {
    const pet = Pet.getActivePet();
    if (!pet) { warn('剧本失败：无出战宠物'); return null; }
    const s = await Supabase.getSession();
    const uid = s && s.user && s.user.id;
    if (!uid) { warn('剧本失败：无登录态'); return null; }
    const session = await fetchMySession();
    if (!session || !session.id || !session.last_settled_at) {
      warn('剧本失败：会话查询为空（last_settled_at 拿不到）');
      return null;
    }
    const area = window.Battle.getCurrentArea();
    if (!area) { warn('剧本失败：无挂机地图'); return null; }
    const m = await loadSim();
    if (!m || !m.simulateSessionScript) { warn('剧本失败：模拟器加载失败'); return null; }
    try {
      const sc = m.simulateSessionScript({
        pet: pet,
        areaId: area.id,
        seconds: seconds || (SETTLE_MS / 1000),
        seed: hashSeed([uid, session.id, session.last_settled_at]),
        config: window.Config,
        enemyList: (window.EnemyData && window.EnemyData.list) || [],
        curHp: startHp
      });
      if (!sc || !sc.events || !sc.events.length) { warn('剧本失败：模拟产出 0 场'); return null; }
      return sc;
    } catch (e) {
      warn('剧本失败：模拟抛错 ' + ((e && e.message) || e));
      return null;
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
    // 立即结算一次：拿真值锚点 + 生成首段演出剧本（elapsed≈0，无收益，纯锚点）
    settleNow().catch(function () { /* 忽略 */ });
    schedule();
    return { ok: true };
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(timer); timer = null;
    stopShow();
    petId = null;
    callFn({ action: 'stop' }).catch(function () { /* 忽略 */ });
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
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 挂机结算失败（' + r.error + '），继续挂机中…');
      return r;
    }
    applyResult(r);
    // 掉落/任务对账：服务器这次窗口打了 r.fights 场，演出只结算了 shownFights 场。
    // 差额（剧本时长估计偏差、切后台节流、剧本生成失败等）也要给玩家东西，
    // 否则「服务器算进了经验和场数，玩家却没看到掉落」= 掉在空气里。
    compensateFights((r.fights || 0) - shownFights);
    shownFights = 0;   // 新剧本重新计数
    // 下一段剧本时长用这次窗口的真实秒数：服务器按真实时间记账，演出按同样长度演
    if (r.elapsedSec > 0) lastElapsedSec = r.elapsedSec;
    try {
      const sc = await buildNextScript(r.endHp, lastElapsedSec || (SETTLE_MS / 1000));
      if (sc && sc.events && sc.events.length) {
        script = sc;
        scriptT0 = performance.now();
        scriptIdx = -1; // gaugeTick 取第一个事件
        nextScriptTryAt = 0;
      } else {
        nextScriptTryAt = performance.now() + SCRIPT_RETRY_MS; // 冷却，防每帧重试打爆服务器
      }
    } catch (e) {
      nextScriptTryAt = performance.now() + SCRIPT_RETRY_MS;
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 剧本生成异常：' + ((e && e.message) || e));
    }
    notifyChange();
    return r;
  }

  /* ---------- 场次对账：服务器打了但演出没演到的场次，补发掉落与任务 ----------
   * 只补掉落与任务进度，**不补经验**——经验/等级由服务器写库（applyResult 已覆盖）。
   * 补发上限 20 场：切后台被节流很久回来时不会一口气刷几十条掉落把日志冲垮。
   */
  function compensateFights(missing) {
    const n = Math.max(0, Math.min(20, Number(missing) || 0));
    if (n <= 0) return;
    const area = window.Battle && window.Battle.getCurrentArea ? window.Battle.getCurrentArea() : null;
    const pet = Pet.getActivePet();
    for (let i = 0; i < n; i++) {
      if (window.Quest && window.Quest.reportType) {
        window.Quest.reportType('kill', 1, { areaId: area ? area.id : null, petName: pet ? pet.name : null });
      }
      const foe = (window.Battle && window.Battle.pickScaledEnemy) ? window.Battle.pickScaledEnemy() : null;
      if (area && foe && window.Drop && window.Drop.rollReward) {
        window.Drop.rollReward(foe, area).then(function (r2) {
          if (r2 && window.UI && window.UI.showLoot) window.UI.showLoot(r2);
        });
      }
    }
    if (window.UI && window.UI.addLog) window.UI.addLog(`⚡ 补发 ${n} 场未演出的掉落（服务器已结算）`);
    if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
  }

  /* ---------- 战报应用（经验/等级/真值血量锚点） ---------- */
  function applyResult(r) {
    const pet = Pet.getActivePet();
    if (!pet) return;
    if (petId && pet.cloudId && petId !== pet.cloudId) {
      stop();
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 换了出战宠物，挂机已停止，请重新点击开始。');
      return;
    }
    const maxLevel = (window.Config && window.Config.pet && window.Config.pet.maxLevel) || 60;
    if (r.endHp != null) { Pet.setCurHp(pet, r.endHp); showHp = Math.min(Pet.getCurHp(pet), Pet.getStats(pet).hp); }
    if (r.level != null && r.level >= (pet.level || 1)) {
      if (r.level < maxLevel && r.expLeft != null) pet.exp = r.expLeft;
      if (r.level > (pet.level || 1)) {
        pet.level = r.level;
        if (window.UI && window.UI.addLog) window.UI.addLog(`✨ ${pet.name} 升级 Lv.${r.level}！`);
      }
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
    const scaled = (B && B.scaleEnemyOf) ? B.scaleEnemyOf(enemyData, lv) : Object.assign({}, enemyData);
    if (!scaled) return;
    scaled.raw = enemyData;   // 自检重挂用未缩放的原始数据（否则会被二次缩放）
    scaled.level = lv;
    showEnemy = scaled;
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
  }

  function enterHealWait(UI) {
    waitingHeal = true;
    gauge.pet = 0; gauge.enemy = 0;
    if (UI && UI.updateAction) UI.updateAction(0, 0);
    if (UI && UI.addLog) UI.addLog('💔 血量不足 30%，回血后再战…');
    if (UI && UI.updateStatus) UI.updateStatus('recovering', totalFights);
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
    const skill = isPet ? getShowSkill(pet) : null;
    let useSkill = false;
    if (skill && skillCd <= 0 && Math.random() < (skill.triggerChance || 0.3)) {
      useSkill = true;
      skillCd = skill.cooldownTurns || 3;
    }
    const hitAt = UI.animateAttack(side) || 320;
    const backMs = UI.attackRecoverMs ? (UI.attackRecoverMs(side) || 0) : 0;
    freezeUntil[side] = now + hitAt + backMs;
    setTimeout(function () {
      if (!active || waitingHeal) return;
      if (isPet && skillCd > 0) skillCd--;
      const d = rollShowDamage(side);
      const target = isPet ? 'enemy' : 'pet';
      let dmg = d ? d.damage : 0;
      if (useSkill && d && !d.isMiss) dmg = Math.floor(dmg * (skill.damageMultiplier || 1.5));
      if (UI.animateHit) UI.animateHit(target, !!(d && d.isCrit));
      if (d && UI.showDamage) {
        UI.showDamage(target, dmg, d.isMiss ? 'miss' : useSkill ? 'skill' : d.isCrit ? 'crit' : 'normal',
          useSkill ? skill.name : null);
      }
      if (d && !d.isMiss && d.heal > 0 && UI.showDamage) {
        UI.showDamage(side, d.heal, 'lifesteal');
      }
      // 命中瞬间阶梯扣血：把本场总掉血按剧本进度分摊到当前这一刀（两刀之间血量静止）
      const f = script && script.events[scriptIdx];
      if (f && f.type === 'fight' && d && !d.isMiss) {
        const span = Math.max(1, f.t1 - f.t0);
        const prog = Math.min(1, Math.max(0, (performance.now() - scriptT0 - f.t0) / span));
        const maxHp = Pet.getStats(pet).hp;
        if (isPet && showEnemy) showEnemy.hp = showEnemy.maxHp * (1 - prog);
        else if (!isPet) showHp = f.hpStart + (f.hpLeft - f.hpStart) * prog;
        if (UI.updateBars && showEnemy) UI.updateBars(Math.round(showHp), maxHp, showEnemy.hp, showEnemy.maxHp || 100);
      }
    }, hitAt);
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
      // 用 raw（未缩放原始怪）+ 当前剧本等级重挂，避免拿已缩放对象二次缩放
      mountShowEnemy(showEnemy.raw || showEnemy, { enemyLevel: showEnemy.level });
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

    // 剧本播完/未就绪：结算续段（settling 锁防重入 + 冷却，剧本生成失败时不每帧打服务器）
    if (!script || scriptIdx >= script.events.length) {
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

    // 剧本时间到：本场结束（胜负 + 配额结算 + 场前判定）
    if (t >= f.t1) {
      if (f.win) {
        settleKill(f);
        if (UI.animateVictory) UI.animateVictory();
      } else {
        if (UI.addLog) UI.addLog('💀 战败…');
      }
      showEnemy = null;
      scriptIdx++;
      const stop2 = ((C.battle || {}).stopHpRatio) || 0.3;
      const needHeal = (!f.win || showHp <= maxHp * stop2);
      const ef = document.getElementById('enemy-fighter');
      if (ef) ef.style.display = 'none';
      if (needHeal) { enterHealWait(UI); return; }
      // 下一只怪的交棒由主循环按剧本时点（f.t0）挂上：击杀淡出刚好落在
      // 模拟器自带的场间 gap（600ms）里，不额外占用真实时间。
      // ⚠️ 千万不要在击杀后把时间轴后推 / 暂停来"加长空场"——
      //    那会让播放总时长 > 预演时长，而 settle 在剧本播完才触发，
      //    服务器按被拉长的真实时间算账 → 每段都比预演多几场 → 补发刷屏。
      return;
    }

    // 战斗中：场内进度（供命中时阶梯扣血；两刀之间血量静止，观感自然）
    const span = Math.max(1, f.t1 - f.t0);
    const prog = Math.min(1, Math.max(0, (t - f.t0) / span));

    // 行动条累积（出手节奏观感，速度差与原战斗同公式；出手冻结期间不涨）
    const ps = Pet.getStats(pet);
    const scale = (C.battle && C.battle.speedScale) || 12;
    if (now >= freezeUntil.pet) gauge.pet += dt * ps.spd / (scale * 100);
    if (now >= freezeUntil.enemy) gauge.enemy += dt * (showEnemy.spd || 40) / (scale * 100);

    // 出手演出（观感，互斥冻结；血量在命中瞬间阶梯更新）
    if (now >= freezeUntil.pet && gauge.pet >= 100) { gauge.pet = 0; showTurn('pet', now); }
    if (now >= freezeUntil.enemy && gauge.enemy >= 100) { gauge.enemy = 0; showTurn('enemy', now); }
    if (now - lastBarTs >= 100) {
      lastBarTs = now;
      UI.updateAction(Math.min(100, gauge.pet), Math.min(100, gauge.enemy));
      if (UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, showEnemy.hp, showEnemy.maxHp || 100);
      checkEnemySprite();
    }
  }

  /* ---------- 本场结算（剧本到点调用）：配额消费 + 经验 + 掉落 + 任务 ---------- */
  function settleKill(f) {
    const area = window.Battle.getCurrentArea();
    const pet = Pet.getActivePet();
    shownFights++; // 与服务器 r.fights 对账用（差额场次在 settle 时补发掉落）
    if (window.Quest && window.Quest.reportType) {
      window.Quest.reportType('kill', 1, { areaId: area ? area.id : null, petName: pet ? pet.name : null });
    }
    if (window.UI && window.UI.addLog) {
      window.UI.addLog(`⚔ 击败 ${f.enemyName} Lv.${f.enemyLevel}：经验 +${f.exp}`);
    }
    const foe = Object.assign({}, f.enemy, { level: f.enemyLevel });
    if (area && window.Drop && window.Drop.rollReward) {
      window.Drop.rollReward(foe, area).then(function (r) {
        if (r && window.UI && window.UI.showLoot) window.UI.showLoot(r);
        if (window.Game && window.Game.refreshStats) window.Game.refreshStats();
      });
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
    gauge.pet = 0; gauge.enemy = 0;
    freezeUntil.pet = 0; freezeUntil.enemy = 0;
    waitingHeal = false;
    lastElapsedSec = 0; nextScriptTryAt = 0; shownFights = 0;
    script = null; scriptIdx = -1;
    lastGaugeTs = performance.now();
    preloadShowEnemies();
    gaugeRaf = requestAnimationFrame(gaugeTick);
    // 首怪由剧本第一个事件驱动（settleNow 锚点返回后生成剧本）
  }
  function stopShow() {
    if (gaugeRaf) { cancelAnimationFrame(gaugeRaf); gaugeRaf = null; }
    showEnemy = null;
  }

  window.IdleBridge = {
    start, stop, settleNow,
    isActive: function () { return active; },
    enabled: ENABLED,
    getTotalFights: function () { return totalFights; },
    // 画面上正在打的怪（演出层唯一事实源）：UI 的敌方 tooltip 读它，
    // 不然托管模式下 Battle.state.enemy 恒 null，悬停看到的是空/旧怪
    getShowEnemy: function () { return showEnemy; },
    set onChange(fn) { onChange = fn; },
    get onChange() { return onChange; }
  };
})();
