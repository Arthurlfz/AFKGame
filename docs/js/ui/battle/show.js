/* ============================================================
 * ui/battle/show.js —— 「照战报演一场战斗」的公共播放器（2026-09-23）
 *
 * 为什么要有它：
 *   服务端权威之后，客户端没有实时战斗引擎了 —— 玩家看到的战斗，全是把服务器给的
 *   **出手序列**演出来。这份能力以前只长在挂机内核里（`core/idle-bridge.js` 的
 *   script + gaugeTick + showPlan 一大坨闭包），副本要"跟挂机一模一样"就只能重写，
 *   而重写的永远追不上挂机（用户连续实测：伤害比动作先出、行动条根本不跑、没有前停后停）。
 *   ⇒ 抽成本模块：**副本用它；挂机下一步也改用它**（那时全项目只剩这一份）。
 *
 * 职责（只管一场）：
 *   1. 摆人：resetBattle（怪物/宠物进战斗区）—— 不做这步就是"看不到怪物"
 *   2. 出手节奏：调 `UI.animateAttack()`，**用它的返回值**当命中时刻
 *      （返回值 = 前摇 charge + 冲刺 dashMs，前摇就是"攻击前停"）
 *   3. 命中：到命中时刻才飘伤害 + 掉血（不是出手瞬间，也不是我另定的固定值）
 *   4. 后停 + 行动条冻结：出手期间**双方**行动条一起冻住（前摇+冲刺+后摇归位那么久）
 *      —— 挂机托管演出就是这么干的；不做这步就是"出手时进度条还在跑"
 * 不负责：会话/结算/掉落/回血等待（那些是挂机与副本各自的事）。
 *
 * 依赖：ui/battle（resetBattle / updateBars / updateAction）、ui/battle/act
 *      （animateAttack 返回命中时刻 / attackRecoverMs 后摇 / showDamage）
 *      —— 全部按"可选"调用：node 测试只加载桩也能跑通。
 * ⚠️ `HIT_DELAY_MS` 只是**兜底**（没有 act.js / 量不到距离时用），
 *    它必须与战核 `_shared/battle-sim.mjs` 的 hitAt 同值（`vtest_trial_core.js` 守着）。
 * ============================================================ */
(function () {
  'use strict';

  /* 出手到命中要多久（毫秒）。**唯一事实源 = 战核** `battle-sim.mjs` 的 `SIM_HIT_AT`
   * （由 `build-sim-global.js` 暴露成 `window.BattleSim.SIM_HIT_AT`）。
   * 2026-09-23 之前这里是手抄的 320 —— 战核改了这边不知道，伤害比动作先出来。
   * 最后的 320 只是"战核没加载时"的兜底，测试会断言它与战核同值。 */
  const HIT_DELAY_MS = (window.BattleSim && window.BattleSim.SIM_HIT_AT) || 320;
  const MIN_TARGET_MS = 1200;     // 空战报时的最短占用（正常走战报真实时间轴，不压缩）
  const MAX_TARGET_MS = 4000;

  const cfg = () => (window.Config && window.Config.resourceTrials) || {};
  const targetLo = () => Number(cfg().replayMinMs) > 0 ? Number(cfg().replayMinMs) : MIN_TARGET_MS;
  const targetHi = () => Number(cfg().replayMaxMs) > 0 ? Number(cfg().replayMaxMs) : MAX_TARGET_MS;
  const has = fn => !!(window.UI && typeof window.UI[fn] === 'function');
  const raf = cb => (window.requestAnimationFrame ? window.requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16));
  const caf = id => (window.cancelAnimationFrame ? window.cancelAnimationFrame(id) : clearTimeout(id));

  /* 演一场。返回 Promise（演完 resolve；没有 UI 时立即 resolve）。
   * opts = { petName, enemyName, petMaxHp, petStartHp, petEndHp, enemyMaxHp, events[], win }
   * ⚠️ 最终血量一律用服务器给的 petEndHp 收尾 —— 演出只负责"看起来对"，不改账。 */
  function play(opts) {
    opts = opts || {};
    const events = (Array.isArray(opts.events) ? opts.events.slice() : []).sort((a, b) => (a.t || 0) - (b.t || 0));
    if (!has('resetBattle') || !has('updateBars')) return Promise.resolve();

    const petMaxHp = Math.max(1, Number(opts.petMaxHp) || 1);
    const enemyMaxHp = Math.max(1, Number(opts.enemyMaxHp) || 1);
    const petStartHp = Math.max(0, Math.min(petMaxHp, Number(opts.petStartHp) || petMaxHp));
    const petEndHp = Math.max(0, Math.min(petMaxHp, Number(opts.petEndHp) || 0));

    // ① 摆人（不做 = 战斗区空白 = "看不到怪物"）
    try { window.UI.resetBattle(opts.petName || '出战宠物', opts.enemyName || '试炼之影', petMaxHp, enemyMaxHp); } catch (e) { /* ignore */ }
    window.UI.updateBars(petStartHp, petMaxHp, enemyMaxHp, enemyMaxHp);

    /* ② 时间轴 = **战报原样**（不压缩、不拉平）。
     *    战报的 t 就是战核按「行动条 + 双方速度」跑出来的时刻（战核里也用 speedScale 加速），
     *    所以它就是真实演出时间轴；再压一次只会让节奏失真（2026-09-23 用户："出手速度完全乱了"）。
     * ③ 行动条按**真实速度**填充（与战核同公式：每 100ms 加 spd/speedScale 点，满 100 出手）。 */
    const speedScale = Math.max(1, Number((((window.Config || {}).battle || {}).speedScale)) || 18);
    const petSpd = Math.max(1, Number(opts.petSpd) || 40);
    const enemySpd = Math.max(1, Number(opts.enemySpd) || 80);
    // 每毫秒推进点数 = (spd / speedScale) / 100
    const rate = { pet: petSpd / speedScale / 100, enemy: enemySpd / speedScale / 100 };

    let petHp = petStartHp, enemyHp = enemyMaxHp;
    let idx = 0, rafId = null, done = false;
    let lastTickAt = Date.now();
    const t0 = lastTickAt;
    const gauge = { pet: 0, enemy: 0 };
    const frozenUntil = { pet: 0, enemy: 0 };   // 出手方行动条冻到何时（后停）
    let lastFireAt = 0;                          // 最近一次出手的时刻（收场判定用）

    return new Promise(resolve => {
      const finishUp = () => {
        if (done) return;
        done = true;
        if (rafId != null) caf(rafId);
        try {
          window.UI.updateBars(petEndHp, petMaxHp, Math.max(0, Math.round(enemyHp)), enemyMaxHp);
          if (has('updateAction')) window.UI.updateAction(0, 0);
        } catch (e) { /* ignore */ }
        resolve();
      };

      /* 🔴 战报里的 t 是**命中时刻**（战核把事件 push 在"出手 + hitAt"那一刻）。
       *    所以出手要提前 HIT_DELAY_MS 开始 —— 否则等于每次少蓄力 320ms，
       *    进度条还没跑满就被判出手（2026-09-23 用户："进度条没有跑满就直接攻击了"）。 */
      const hitAtOf = (i) => Math.round(Number(events[i].t) || 0);
      const swingAtOf = (i) => Math.max(0, hitAtOf(i) - HIT_DELAY_MS);

      /* 真正打这一刀：出手（含前摇） → 命中时刻飘字掉血 → 记后停 */
      const fire = (ev) => {
        const side = ev.by === 'pet' ? 'pet' : 'enemy';
        const target = side === 'pet' ? 'enemy' : 'pet';
        let contact = HIT_DELAY_MS, back = 0;
        try {
          if (has('animateAttack')) {
            const r = window.UI.animateAttack(side, 0);
            if (Number(r) > 0) contact = Number(r);            // 前摇 + 冲刺（演出真实时长）
          }
          if (has('attackRecoverMs')) back = Math.max(0, Number(window.UI.attackRecoverMs()) || 0); // 后摇
        } catch (e) { /* 表现层异常不影响结算 */ }
        /* 条必须"满才出手"：战报判的就是"条满那一刻出手"，
         * 客户端速度与服务器面板若有微小差异（装备加成等），这里补到 100 再归零，
         * 避免出现"条才 90 就打了"的观感。 */
        gauge[side] = 100;
        /* 出手期间**双方**行动条一起冻住整段演出（前摇+冲刺到命中+后摇归位）。
         * 与挂机托管演出同口径（`idle-bridge.js` 的 perfUntil：pet/enemy 都取 max）。
         * 用户 2026-09-21 的原话：宠物-过去-挺住-播放出手动画-（同时进度条怪物宠物的都停止）
         * -出手清晰可见-宠物回到自己的战斗位置，再继续下一轮。
         * ⚠️ 这是**观感层**：出刀时刻由战报决定，冻条不会改出刀数（战核也别改，见 battle.js:374 的告示）。 */
        gauge[side] = 0;
        // 冻结整段演出：命中时刻按 hitAt 对齐战报（不是按演出动画的实际时长，否则会与战报错位）
        const perfUntil = Date.now() + HIT_DELAY_MS + back;
        frozenUntil.pet = Math.max(frozenUntil.pet, perfUntil);
        frozenUntil.enemy = Math.max(frozenUntil.enemy, perfUntil);
        setTimeout(() => {
          try {
            if (ev.miss) {
              if (has('showDamage')) window.UI.showDamage(target, 0, 'miss');
            } else {
              if (has('showDamage')) window.UI.showDamage(target, Math.max(0, Number(ev.dmg) || 0), ev.crit ? 'crit' : 'normal');
              if (target === 'enemy') enemyHp = Math.max(0, enemyHp - (Number(ev.dmg) || 0));
              else petHp = Math.max(petEndHp, petHp - (Number(ev.dmg) || 0));
              window.UI.updateBars(Math.round(petHp), petMaxHp, Math.round(enemyHp), enemyMaxHp);
            }
          } catch (e) { /* 单帧异常不影响后续 */ }
        }, HIT_DELAY_MS);   // 命中按 hitAt 落在战报那个时刻（演出动画只用来看"冲过去"的过程）
      };

      /* ④ 心跳：按**真实速度**推行动条（冻结期间不推）+ 到战报时刻出手 */
      const tick = () => {
        if (done) return;
        const now = Date.now();
        const dt = Math.max(0, now - lastTickAt);
        lastTickAt = now;
        const elapsed = now - t0;

        // 行动条：真实速度 × 时间；被冻结（前摇+冲刺+后摇）的一方不推
        ['pet', 'enemy'].forEach(side => {
          if (now < frozenUntil[side]) return;
          gauge[side] = Math.min(100, gauge[side] + rate[side] * dt);
        });

        // 到"出手时刻"就出手（= 命中时刻 - hitAt；出手方归零并冻结双方）
        while (idx < events.length && elapsed >= swingAtOf(idx)) {
          lastFireAt = elapsed;
          fire(events[idx]);
          idx += 1;
        }

        if (has('updateAction')) {
          try { window.UI.updateAction(gauge.pet, gauge.enemy); } catch (e) { /* ignore */ }
        }

        // 全部打完 + 命中与后停都收干净 → 收场
        const settled = idx >= events.length
          && now >= lastFireAt + HIT_DELAY_MS
          && now >= frozenUntil.pet && now >= frozenUntil.enemy;
        if (settled) { finishUp(); return; }
        rafId = raf(tick);
      };
      if (!events.length) { setTimeout(finishUp, Math.min(targetLo(), 400)); return; }
      rafId = raf(tick);
    });
  }

  window.BattleShow = { play, HIT_DELAY_MS };
})();
