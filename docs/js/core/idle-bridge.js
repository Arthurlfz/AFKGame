/* ============================================================
 * idle-bridge.js —— 服务器权威挂机（治本版：一套账）
 *
 * 架构：服务器真打，本地放电影。
 *   - 点开始挂机 → 服务器建会话；本地进入「装饰演出循环」：只播攻击/受击动画，
 *     不掉血、不加经验、不 roll 掉落、不产生任何游戏数据。
 *   - 每 30 秒（切回前台立即）向服务器要一次「战报」：打了 N 场、现在血多少、
 *     经验等级多少。血量/等级/经验直接覆盖；场数交给上层（main.js）按战报
 *     roll 掉落 + 报任务——服务器说打了几场就是几场，本地从不算账。
 *
 * 为什么是"一套账"：此前版本本地跑真战斗 + 服务器对账（两套账），
 *   爆发狂跳 / 双写冲突 / 补场数相减全部源于此。本版本地没有账，
 *   这类 bug 从架构上不存在。
 *
 * 依赖：supabase.js（getSession）、pet.js、battle.js（getCurrentArea/pickScaledEnemy）、
 *       ui-battle.js（animateAttack/animateHit/resetBattle/updateBars/updateStatus）
 * 退路：URL 加 ?noidle=1 → 本模块整体禁用，退回纯本地挂机（battle.js 老流程）。
 * ============================================================ */
(function () {
  'use strict';

  const Supabase = window.Supabase;
  const Pet = window.Pet;

  const FN_URL = 'https://asklogeayzlqpeejuvjj.supabase.co/functions/v1/battle-settle';
  const SETTLE_MS = 30000;  // 30 秒：远小于服务器 120 秒宽限窗口，在线期全覆盖

  const ENABLED = !/[?&]noidle=1\b/.test(location.search);

  let active = false;
  let timer = null;         // settle 定时器
  let petId = null;         // 本次会话绑定的宠物 cloudId
  let showEnemy = null;     // 画面上的装饰怪（非真实战斗对象，只供演出）
  let showHp = 0;           // 我方演出血量：怪打我会掉、按秒回、战报来时对齐真值（真实 curHp 只听服务器的）
  // 双方行动条独立推进（与 battle.js 同公式：每 100ms 加 spd/speedScale，先满先出手）——速度差看得见
  const gauge = { pet: 0, enemy: 0 };
  const freezeUntil = { pet: 0, enemy: 0 }; // 出手后冻结到收招完毕（冲刺+后摇期间该方条不涨）
  let gaugeRaf = null;
  let lastGaugeTs = 0;
  let totalFights = 0;      // 服务器战报累计场数（展示用）
  let onChange = null;      // function(fights)：每次战报回调（上层按场数 roll 掉落 + 报任务）

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

  /* ---------- 装饰演出循环（纯画面：不产生任何游戏数据） ---------- */
  // 换一只画面怪：与真实战斗同一套挑怪/缩放逻辑，但只用于演出。
  // 只从「立绘已加载完成」的怪里挑（readyEnemies），杜绝宠物打空气。
  const readyEnemies = new Set();
  function newShowEnemy() {
    const B = window.Battle;
    if (!B || !B.pickScaledEnemy) return;
    let e = B.pickScaledEnemy();
    // 预热集合非空时，最多换挑 10 次，避开还没加载好立绘的怪
    for (let i = 0; i < 10 && e && readyEnemies.size > 0 && !readyEnemies.has(e.name); i++) {
      e = B.pickScaledEnemy();
    }
    showEnemy = e;
    renderShowStage();
  }

  // 画面上台：宠物+怪的名字/立绘/血条。我方血条用演出血量（起点=真值，挨打会掉）
  function renderShowStage() {
    const pet = Pet.getActivePet();
    const UI = window.UI;
    if (!pet || !UI || !showEnemy || !UI.resetBattle) return;
    const maxHp = Pet.getStats(pet).hp;
    showHp = Math.min(Pet.getCurHp(pet), maxHp); // 对齐服务器真值作为演出起点
    UI.resetBattle(
      pet.name + ' 等级：' + (pet.level || 1) + '级', pet.icon,
      showEnemy.name + ' 等级：' + (showEnemy.level || 1) + '级', showEnemy.icon,
      maxHp, showEnemy.maxHp || 100
    );
    // resetBattle 把双方血条画满——我方纠正为演出血量
    if (UI.updateBars) UI.updateBars(showHp, maxHp, showEnemy.hp, showEnemy.maxHp || 100);
  }

  // 演出伤害：用与服务器【同一套】伤害公式（battle.js calcDamage：命中/暴击/穿透/减免全在）
  // 算出一个"如果这场真打，这一击就是这个数"的数字。战斗结果（谁赢/几场/掉落）仍 100% 由战报决定，
  // 这里的数字只是画面演出——公式是真的，不是随手编的假数。
  function rollShowDamage(attackerSide) {
    const pet = Pet.getActivePet();
    const B = window.Battle;
    if (!pet || !showEnemy || !B || !B.calcDamage) return null;
    if (attackerSide === 'pet') {
      // 我方出手：真实宠物属性（含装备加成） vs 画面怪真实属性
      return B.calcDamage(Pet.getStats(pet), showEnemy);
    }
    // 敌方出手：补齐怪的机制属性（与 battle.js beginFight 同规则：命中 90、闪避按类型）
    const C = window.Config;
    return B.calcDamage({
      atk: showEnemy.atk, hit: 90,
      critRate: (C.battle && C.battle.critRate), critDamage: (C.battle && C.battle.critMultiplier),
      pen: 0, dmgBonus: 0
    }, { def: Pet.getStats(pet).def, dodge: Pet.getStats(pet).dodge, dr: Pet.getStats(pet).dr || 0 });
  }

  // 敌方立绘自检：img 已结束加载但宽高为 0 = 404/空图 → 重挂 + 写日志取证
  function checkEnemySprite() {
    const el = document.getElementById('enemy-icon');
    if (!el || !showEnemy) return;
    const img = el.querySelector('img');
    if (!img) return; // emoji 兜底形态，正常
    if (img.complete && img.naturalWidth === 0) {
      const src = img.getAttribute('src') || '(无 src)';
      if (window.UI && window.UI.addLog) {
        window.UI.addLog('⚠️ 敌方立绘加载失败：' + showEnemy.name + ' ← ' + src);
      }
      renderShowStage(); // 自动重挂一次
    }
  }

  // 一次出手演出：冲刺 → 命中结算（真公式伤害）→ 后摇；期间该方行动条冻结（与 battle.js 同款）
  function showTurn(side, now) {
    const UI = window.UI;
    const pet = Pet.getActivePet();
    if (!pet || !showEnemy || !UI || !UI.animateAttack) return;
    const isPet = side === 'pet';
    const hitAt = UI.animateAttack(side) || 320;
    const backMs = UI.attackRecoverMs ? (UI.attackRecoverMs(side) || 0) : 0;
    freezeUntil[side] = now + hitAt + backMs;
    setTimeout(function () {
      if (!active || recovering) return; // 本场已结束：飞行中的旧攻击不再结算
      const d = rollShowDamage(side);
      const target = isPet ? 'enemy' : 'pet';
      if (UI.animateHit) UI.animateHit(target, !!(d && d.isCrit));
      if (d && UI.showDamage) UI.showDamage(target, d.damage, d.isMiss ? 'miss' : d.isCrit ? 'crit' : 'normal');
      const maxHp = Pet.getStats(pet).hp;
      if (d && !d.isMiss) {
        if (isPet && showEnemy) showEnemy.hp = Math.max(0, showEnemy.hp - (d.damage || 0));
        else if (!isPet) showHp = Math.max(0, showHp - (d.damage || 0));
      }
      // 击杀：胜利淡出 → 换新怪（敌方条重新起跑）
      if (isPet && showEnemy && showEnemy.hp <= 0) {
        if (UI.animateVictory) UI.animateVictory();
        showEnemy = null;
        setTimeout(function () { if (active) { newShowEnemy(); gauge.enemy = 0; } }, 750);
        return;
      }
      if (showEnemy && UI.updateBars) UI.updateBars(Math.round(showHp), maxHp, showEnemy.hp, showEnemy.maxHp || 100);
      // 自愈+取证：怪被击中时检查立绘是否真的在显示。空了 → 自动重挂一次，
      // 并写日志（哪只怪、src 是什么、DOM 里长什么样）——随机的空图靠这个抓。
      checkEnemySprite();
    }, hitAt);
  }

  // 演出主循环：行动条按各自 spd 独立累积（先满先出手），速度差与原战斗一致。
  // 条的 DOM 刷新节流到 100ms 一次（与原 battle.js tick 同频，别每帧写样式）。
  let lastBarTs = 0;
  let recovering = false; // 演出休战：血量跌破停战线就停手回血（复刻 battle.js stopHpRatio 行为）
  function gaugeTick(now) {
    if (!active) return;
    gaugeRaf = requestAnimationFrame(gaugeTick);
    const pet = Pet.getActivePet();
    const UI = window.UI;
    if (!pet || !UI || !UI.updateAction) return;
    const dt = Math.max(0, Math.min(200, now - lastGaugeTs));
    lastGaugeTs = now;
    if (!showEnemy) return; // 击杀换怪间隙：双方条停住
    const C = window.Config;
    const scale = (C.battle && C.battle.speedScale) || 12;
    const ps = Pet.getStats(pet);
    const regen = (C.regen && C.regen.hpPerSecRatio) || 0;
    const maxHp = ps.hp;
    const stopRatio = (C.battle && C.battle.stopHpRatio) || 0.3;

    // 本场告负：血量跌破停战线 → 这一场结束（怪离场），回满后挑新怪再战（与原 battle.js 同规则）
    if (!recovering && showHp <= maxHp * stopRatio) {
      recovering = true;
      gauge.pet = 0; gauge.enemy = 0;
      UI.updateAction(0, 0);
      if (UI.addLog) UI.addLog('💔 血量过低，本场告负，退场恢复…');
      if (UI.updateStatus) UI.updateStatus('recovering', totalFights);
      showEnemy = null; // 怪离场
      const ef = document.getElementById('enemy-fighter');
      if (ef) ef.style.display = 'none';
    }
    if (recovering) {
      // 休战回血：回满 → 遭遇新怪，重新开打
      showHp = Math.min(maxHp, showHp + maxHp * regen * dt / 1000);
      if (showHp >= maxHp) {
        recovering = false;
        if (UI.addLog) UI.addLog('💚 恢复完毕，遭遇新的野怪！');
        if (UI.updateStatus) UI.updateStatus('fighting', totalFights);
        const ef = document.getElementById('enemy-fighter');
        if (ef) ef.style.display = '';
        newShowEnemy();
      }
      return; // 休战期间行动条不推进
    }

    if (now >= freezeUntil.pet) gauge.pet += dt * ps.spd / (scale * 100);
    if (now >= freezeUntil.enemy) gauge.enemy += dt * (showEnemy.spd || 40) / (scale * 100);
    // 演出回血（config.regen 每秒比例），战报来时对齐真值
    if (showHp < maxHp) showHp = Math.min(maxHp, showHp + maxHp * regen * dt / 1000);
    // 出手互斥：对方还在攻击动画中（冻结）→ 本方哪怕已满也等它收招，避免双方同时冲刺/打到已离场的目标
    if (gauge.pet >= 100 && now >= freezeUntil.enemy) { gauge.pet = 0; showTurn('pet', now); }
    if (gauge.enemy >= 100 && now >= freezeUntil.pet) { gauge.enemy = 0; showTurn('enemy', now); }
    if (now - lastBarTs >= 100) {
      lastBarTs = now;
      UI.updateAction(Math.min(100, gauge.pet), Math.min(100, gauge.enemy));
    }
  }

  // 预热本图怪立绘。⚠️ 就绪判定必须覆盖【实际显示用的资源】：
  // 怪上台走 mountAnimated（逐帧 sheet 大图），它没到货就是"隐形人打空气"——
  // 静态图 + 逐帧表都 onload 才算就绪；都没有的怪走 emoji 兜底，即刻可用。
  let preloading = null;
  function imgLoad(src) {
    return new Promise(function (res) {
      const im = new Image();
      im.onload = res; im.onerror = res;
      im.src = src;
    });
  }
  function preloadShowEnemies() {
    if (preloading) return preloading;
    const B = window.Battle;
    const PS = window.PetSprites;
    if (!B || !B.pickScaledEnemy || !PS) return Promise.resolve();
    const names = [];
    for (let i = 0; i < 12; i++) {
      const e = B.pickScaledEnemy();
      if (e && names.indexOf(e.name) < 0) names.push(e.name);
    }
    const loadOne = function (name) {
      if (readyEnemies.has(name)) return Promise.resolve();
      const jobs = [];
      try {
        const p = PS.pathOf && PS.pathOf(name);
        if (p) jobs.push(imgLoad(p));
        const a = PS.animOf && PS.animOf(name);
        if (a && a.idle && a.idle.sheet) jobs.push(imgLoad(a.idle.sheet));
      } catch (err) { /* 忽略 */ }
      if (!jobs.length) { readyEnemies.add(name); return Promise.resolve(); }
      // 加载失败也放行（回退 emoji/静态），不无限等
      return Promise.all(jobs).then(
        function () { readyEnemies.add(name); },
        function () { readyEnemies.add(name); }
      );
    };
    preloading = Promise.all(names.map(loadOne));
    return preloading;
  }

  async   function startShow() {
    gauge.pet = 0; gauge.enemy = 0;
    freezeUntil.pet = 0; freezeUntil.enemy = 0;
    recovering = false;
    preloading = null; // 换图后怪池变了，预热重来
    // 先等资源就绪再上第一只怪（最多 3 秒，超时强制开打，不无限等）
    try {
      await Promise.race([preloadShowEnemies(), new Promise(function (r) { setTimeout(r, 3000); })]);
    } catch (e) { /* 忽略 */ }
    if (!active) return; // 等待期间挂机被停了
    newShowEnemy();
    lastGaugeTs = performance.now();
    gaugeRaf = requestAnimationFrame(gaugeTick);
  }
  function stopShow() {
    if (gaugeRaf) { cancelAnimationFrame(gaugeRaf); gaugeRaf = null; }
    showEnemy = null;
  }

  /* ---------- settle 定时 ---------- */
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, SETTLE_MS); }
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
    schedule();
    return { ok: true };
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(timer); timer = null;
    stopShow();
    petId = null;
    // 停会话（fire-and-forget：失败也无所谓，会话停在宽限窗口外自然作废）
    callFn({ action: 'stop' }).catch(function () { /* 忽略 */ });
  }

  /* ---------- 结算一次（战报） ---------- */
  let settling = false; // 并发锁：切回前台的立即结算与 30 秒定时结算可能撞车，同一时刻只放一个出去
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
      // 会话没了（被别处停掉 / 数据清理）→ 安静退场，不再重试
      if (r.error === 'NO_ACTIVE_SESSION') {
        active = false; clearTimeout(timer); timer = null; stopShow();
        if (window.UI) window.UI.updateStatus('stopped', totalFights);
        return r;
      }
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 挂机结算失败（' + r.error + '），继续挂机中…');
      return r;
    }
    applyResult(r);
    return r;
  }

  /* ---------- 战报应用（服务器是唯一数据源） ---------- */
  function applyResult(r) {
    const pet = Pet.getActivePet();
    if (!pet) return;

    // 换宠：不自动重开，直接停掉让玩家手动再点
    if (petId && pet.cloudId && petId !== pet.cloudId) {
      stop();
      if (window.UI && window.UI.addLog) window.UI.addLog('⚠️ 换了出战宠物，挂机已停止，请重新点击开始。');
      return;
    }

    const maxLevel = (window.Config && window.Config.pet && window.Config.pet.maxLevel) || 60;

    // 血量：服务器权威；演出血量对齐真值（怪打掉的演出血被真值纠正）
    if (r.endHp != null) { Pet.setCurHp(pet, r.endHp); showHp = Pet.getCurHp(pet); }

    // 经验 / 等级：服务器权威。
    // ⚠️ 满级不覆盖 exp：满级溢出经验走本地经验池（pet.js expPool），
    //    服务器那套是"凝晶石"计数且目前会重复累加，两边不是一回事。
    if (r.level != null && r.level >= (pet.level || 1)) {
      if (r.level < maxLevel && r.expLeft != null) pet.exp = r.expLeft;
      if (r.level > (pet.level || 1)) {
        pet.level = r.level;
        if (window.UI && window.UI.addLog) window.UI.addLog(`✨ ${pet.name} 升级 Lv.${r.level}！`);
      }
    }

    totalFights = r.totalFights != null ? r.totalFights : (totalFights + (r.fights || 0));

    // 画面同步：我方血条纠正为真实值；状态徽章 = 挂机中
    const UI = window.UI;
    if (UI) {
      if (showEnemy && UI.updateBars) {
        UI.updateBars(showHp, Pet.getStats(pet).hp, showEnemy.hp, showEnemy.maxHp || 100);
      }
      if (UI.updateStatus) UI.updateStatus('fighting', totalFights);
    }
    if (window.Game && window.Game.refreshStats) window.Game.refreshStats();

    // 战报交给上层：roll 掉落 + 报任务（服务器说几场就是几场）
    notifyChange(r.fights || 0, r.exp || 0);
  }

  // 切回前台立即结算一次：玩家一回来就看到最新进度 + 战利品，不用干等 30 秒周期
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && active) settleNow();
  });

  function notifyChange(fights, exp) { if (onChange) { try { onChange(fights, exp); } catch (e) { /* 忽略 */ } } }

  window.IdleBridge = {
    start, stop, settleNow,
    isActive: function () { return active; },
    enabled: ENABLED,
    getTotalFights: function () { return totalFights; },
    set onChange(fn) { onChange = fn; },
    get onChange() { return onChange; }
  };
})();
