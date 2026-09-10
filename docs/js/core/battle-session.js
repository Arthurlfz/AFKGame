/* ============================================================
 * core/battle-session.js —— 战斗页占用权（单一职责，2026-09-10）
 *
 * 为什么需要它：战斗页只有一套 DOM、一个战斗实例，但会用到它的玩法有
 * 野图挂机（本地循环 / 服务器托管演出）、资源副本、通天塔。以前每个系统
 * 各自读 Battle.state.mode / isRunning() / IdleBridge.isActive() 拼条件判断
 * "现在谁在打"，只要有一条路径漏判就出事 —— 表现就是两套战斗抢同一个画面、
 * 定时刷新把台上正在打的怪抹掉。
 *
 * 本模块只做一件事：登记「当前谁占用战斗页」并把变更广播出去。
 *   - 不含任何战斗逻辑、UI 渲染、业务模块依赖（谁被抢占谁自己负责收尾）
 *   - 抢占规则（正常游戏逻辑）：玩家主动进入的玩法 > 自动挂机。
 *     被抢占的一方订阅 onChange 自我让位，抢占方不需要知道它存在
 *   - 扩展新玩法：KINDS 加一条 kind + priority，入口 claim 一下，其余系统自动让位
 *
 * 用法：
 *   const r = BattleSession.claim('trial');
 *   if (!r.ok) return { ok: false, error: '战斗页被占用：' + r.holder.label };
 *   ...
 *   BattleSession.release('trial');
 *   BattleSession.onChange(info => ...);   // info = { holder, previous }
 *
 * 依赖：无（必须在所有战斗模块之前加载）
 * ============================================================ */
(function () {
  'use strict';

  /* 占用者登记表：priority 大者可以抢占小者（同级不互相抢占，由调用方自己守门）。
   * 野图挂机是"自动行为"，副本/塔是"玩家主动行为的独立玩法" → 后者优先。 */
  const KINDS = {
    wild:  { label: '挂机',   priority: 10 },
    trial: { label: '副本',   priority: 20 },
    tower: { label: '通天塔', priority: 20 }
  };

  let current = null;      // { kind, label, priority, since }
  const listeners = [];

  function holder() {
    return current ? { kind: current.kind, label: current.label, since: current.since } : null;
  }
  function isIdle() { return !current; }
  function is(kind) { return !!current && current.kind === kind; }

  // 广播：订阅者异常不影响占用状态与其它订阅者（一个 UI 报错不该让占用权卡住）
  function notify(previous) {
    const info = { holder: holder(), previous: previous };
    for (const fn of listeners.slice()) {
      try { fn(info); } catch (e) { /* 忽略单个订阅者的异常 */ }
    }
  }

  /* 申请占用：
   *   空闲 → 直接占用；已占用者是自己 → 幂等成功（不重复广播）；
   *   占用者优先级更低 → 抢占（被抢占方经 onChange 自行收尾）；
   *   占用者优先级相同或更高 → 拒绝（BUSY，调用方据此提示玩家）。 */
  function claim(kind) {
    const meta = KINDS[kind];
    if (!meta) return { ok: false, reason: 'UNKNOWN_KIND' };
    if (current && current.kind === kind) return { ok: true, held: true, holder: holder() };
    if (current && current.priority >= meta.priority) {
      return { ok: false, reason: 'BUSY', holder: holder() };
    }
    const previous = holder();
    current = { kind, label: meta.label, priority: meta.priority, since: Date.now() };
    notify(previous);
    return { ok: true, holder: holder() };
  }

  // 交出占用：只有当前占用者能释放（被抢占者调用它是安全空操作）
  function release(kind) {
    if (!current) return false;
    if (kind && current.kind !== kind) return false;
    const previous = holder();
    current = null;
    notify(previous);
    return true;
  }

  // 订阅变更，返回退订函数
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function off() {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  window.BattleSession = { KINDS, claim, release, holder, is, isIdle, onChange };
})();
