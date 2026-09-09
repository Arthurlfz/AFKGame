/* ============================================================
 * trial/trial-engine.js —— 20 层爬塔推进状态机（单一职责）
 * 职责：
 *  1. 层数推进：开一层 → 层胜负回调 → 下一层 / 终局（死亡或通关）
 *  2. 层敌人生成：守关者按层等级/层难度曲线缩放（数值公式在此，参数全在 trial-config.js）
 *  3. 野图挂机的暂停与恢复（本地循环 / 服务器托管演出两种形态都处理）
 * 不负责：进入资格（trial-access.js）、奖励结算（trial-rewards.js）、任何 UI 渲染。
 * 依赖：config、trial-config/access/rewards、battle（beginTrialFloor hook）、pet、materials。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => window.Config && window.Config.resourceTrials || {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* ---------- 运行时状态 ---------- */
  const state = {
    running: false, route: null, floor: 0, maxFloor: 0,
    result: null, timer: null, access: null, wild: null
  };

  // 运行事件（UI 订阅：floor/floorClear/floorFail/settle/log）；node 测试可直接注入收集
  let eventSink = null;
  function emit(event) {
    if (typeof eventSink === 'function') { try { eventSink(event); } catch (e) { /* UI 渲染异常不中断战斗 */ } }
    if (window.UI && window.UI.onTrialEvent) { try { window.UI.onTrialEvent(event); } catch (e) { /* 同上 */ } }
  }
  function log(text) { emit({ type: 'log', text }); }

  /* ---------- 层难度曲线（数值参数全在 trial-config.js，公式只在这一处） ----------
   * 怪等级 = floorLevelStart ~ floorLevelEnd 线性插值；
   * 层难度 = floorDifficultyStart × (1+floorDifficultyPerFloor)^(N-1)
   *          × eliteMult^(已跨过的强档层数) × route.difficulty
   *          —— 复合递增 + 强档层阶梯永久保留：难度全程严格递增，绝不倒退。
   * 怪数值 = baseStats × (怪等级 / floorLevelEnd) × 层难度。
   * baseStats 锚点 = 第 20 层（Lv100·难度 ≈1.0）的怪，校准目标 = 满成长+主流装备可过。 */
  function floorLevelOf(floor) {
    const c = cfg();
    const total = Math.max(2, Number(c.floors) || 20);
    const lo = Number(c.floorLevelStart) || 10, hi = Number(c.floorLevelEnd) || 100;
    const t = (floor - 1) / (total - 1);
    return Math.max(1, Math.round(lo + (hi - lo) * t));
  }
  function floorDifficultyOf(route, floor) {
    const c = cfg();
    const start = (c.floorDifficultyStart != null) ? Number(c.floorDifficultyStart) : 0.3;
    const per = Number(c.floorDifficultyPerFloor) || 0.045;
    const eliteMult = Number(c.eliteMult) || 1;
    const every = Number(c.eliteEvery) || 0;
    const elites = every > 0 ? Math.floor(floor / every) : 0;
    return start * Math.pow(1 + per, floor - 1) * Math.pow(eliteMult, elites) * ((route && route.difficulty) || 1);
  }
  // 第 N 层的守关者（每层同一名守关者，血攻防随曲线递增；spd 固定，与野图 evolved 档一致）
  function floorEnemyStats(route, floor) {
    const c = cfg();
    const level = floorLevelOf(floor);
    const scale = level / (Number(c.floorLevelEnd) || 100);
    const diff = floorDifficultyOf(route, floor);
    const base = c.baseStats || { hp: 4400, atk: 720, def: 320 };
    const g = (route && route.guardian) || {};
    const hp = Math.round(base.hp * scale * diff);
    return {
      id: `trial-${(route && route.id) || 'x'}-${floor}`,
      name: g.name || '试炼之影',
      level,
      enemyType: 'evolved',
      spd: 80,
      hp, maxHp: hp,
      atk: Math.round(base.atk * scale * diff),
      def: Math.round(base.def * scale * diff),
      hit: Number(c.guardianHit) || 90, // 守关者命中（默认野怪 90 会被高闪避玩家砍半）
      growth: 0,
      _trialFloor: floor
    };
  }

  /* ---------- 野图挂机的暂停与恢复 ----------
   * 服务器托管（默认）：IdleBridge.stop(true) 只拆本地演出与定时器，
   *   服务器会话继续跑（与玩家去宠物页/市集页一样，野外收益后台照常）；
   *   结束后 resumeActive() 重连本地演出并补结算。
   * 纯本地挂机（?noidle=1 调试模式）：stopAutoBattle 停掉；结束后【不自动重启】
   *   （main.js 的结算回调拿不到），结算面板提示玩家手动继续。 */
  function pauseWildIdle() {
    const B = window.Battle, IB = window.IdleBridge;
    state.wild = {
      autoRunning: !!(B && B.isRunning && B.isRunning()),
      idleActive: !!(IB && IB.isActive && IB.isActive())
    };
    if (state.wild.autoRunning && B.stopAutoBattle) B.stopAutoBattle();
    if (state.wild.idleActive && IB.stop) IB.stop(true);
  }
  function resumeWildIdle() {
    const IB = window.IdleBridge;
    if (state.wild && state.wild.idleActive && IB && IB.resumeActive) {
      Promise.resolve(IB.resumeActive()).catch(() => { /* 重连失败不影响副本结算 */ });
    }
    state.wild = null;
  }

  /* ---------- 层推进 ---------- */
  function beginFloor() {
    const route = state.route;
    state.floor += 1;
    const enemy = floorEnemyStats(route, state.floor);
    const Pet = window.Pet;
    const pet = Pet && Pet.getActivePet ? Pet.getActivePet() : null;
    const petMaxHp = (pet && Pet.getStats) ? Pet.getStats(pet).hp : 1;
    const petHp = (pet && Pet.getCurHp) ? Pet.getCurHp(pet) : petMaxHp;
    emit({ type: 'floor', route, floor: state.floor, total: cfg().floors || 20, enemy, petHp, petMaxHp });
    log(`⚔ 第 ${state.floor}/${cfg().floors || 20} 层 · ${enemy.name} Lv.${enemy.level}（血 ${enemy.hp} 攻 ${enemy.atk} 防 ${enemy.def}）`);
    const ok = window.Battle && window.Battle.beginTrialFloor({
      enemy,
      onEnd: onFloorEnd
    });
    if (!ok) finish(false, '无法开始层战斗（野图战斗占用中）');
  }

  function onFloorEnd({ win, petHp, petMaxHp }) {
    if (!state.running) return;
    const total = cfg().floors || 20;
    if (win) {
      state.maxFloor = state.floor;
      emit({ type: 'floorClear', route: state.route, floor: state.floor, petHp, petMaxHp });
      log(`✓ 第 ${state.floor} 层通过（剩余血量 ${petMaxHp > 0 ? Math.max(0, Math.round(petHp / petMaxHp * 100)) : 0}%）`);
      if (state.floor >= total) { finish(true); return; }
      // 血量跨层累计：战斗引擎每层结束已把 HP 写回宠物（setCurHp），下一层快照自然带上
      state.timer = setTimeout(() => { state.timer = null; if (state.running) beginFloor(); }, cfg().floorDelayMs || 700);
    } else {
      emit({ type: 'floorFail', route: state.route, floor: state.floor, petHp: 0, petMaxHp });
      log(`💀 第 ${state.floor} 层倒下…… 爬塔结束`);
      finish(false);
    }
  }

  /* ---------- 终局结算 ---------- */
  async function finish(cleared, error) {
    const route = state.route;
    const info = window.TrialRewards
      ? window.TrialRewards.settle(route, { maxFloor: state.maxFloor, cleared })
      : { maxFloor: state.maxFloor, tierFloor: 0, cleared, reward: [] };
    state.result = Object.assign({}, info, {
      error: error || null,
      floors: cfg().floors || 20,
      consumed: state.access ? state.access.consumed : null,
      freeLeft: state.access ? state.access.freeLeft : null
    });
    state.running = false;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    resumeWildIdle();
    emit({ type: 'settle', route, result: state.result });
    return state.result;
  }

  /* ---------- 入口 ----------
   * start(routeId, { onEvent }) → Promise<result>：
   *   资格/等级守门不过 → { ok:false, error }；
   *   通过 → 消耗资格、暂停野图挂机、逐层推进，终局 resolve 结算明细。 */
  async function start(routeId, opts) {
    opts = opts || {};
    eventSink = typeof opts.onEvent === 'function' ? opts.onEvent : eventSink;
    const c = cfg();
    if (!c.enabled) return { ok: false, error: '资源副本尚未开放' };
    if (state.running) return { ok: false, error: '已有副本进行中' };
    const route = window.TrialAccess && window.TrialAccess.routeOf(routeId);
    if (!route) return { ok: false, error: '副本路线不存在' };
    const pet = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
    if (!pet) return { ok: false, error: '请先选择出战宠物' };
    if ((Number(pet.level) || 1) < (route.minLevel || 1)) return { ok: false, error: `需要宠物达到 Lv${route.minLevel}` };

    const access = await window.TrialAccess.consumeEntry(routeId);
    if (!access.ok) return { ok: false, error: access.error };

    state.running = true;
    state.route = route;
    state.floor = 0;
    state.maxFloor = 0;
    state.result = null;
    state.access = access;
    emit({ type: 'start', route, total: c.floors || 20 });
    pauseWildIdle();
    beginFloor();
    return await waitUntilDone();
  }
  // 层推进是异步链（setTimeout 驱动），这里轮询等待终局，保持旧 API「await 拿结算」的形态
  function waitUntilDone() {
    return new Promise(resolve => {
      const poll = () => {
        if (!state.running && state.result) { resolve({ ok: true, ...state.result }); return; }
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  function getState() {
    return {
      running: state.running, route: state.route, floor: state.floor,
      maxFloor: state.maxFloor, total: cfg().floors || 20, result: state.result
    };
  }

  window.TrialEngine = { start, getState, floorEnemyStats, floorLevelOf, floorDifficultyOf };

  /* 旧对外接口兼容（调用方零改动）：window.ResourceTrial 由新模块聚合挂载。
   * ui-worldmap 徽标读 getDailyInfo；引导 N6 与旧面板走 UI 层。 */
  window.ResourceTrial = {
    routes: () => window.TrialAccess.routes(),
    routeOf: id => window.TrialAccess.routeOf(id),
    getDailyInfo: () => window.TrialAccess.getDailyInfo(),
    entryInfo: id => window.TrialAccess.entryInfo(id),
    start,
    getState
  };
})();
