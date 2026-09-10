// 战斗页占用权契约测试（core/battle-session.js）
// 为什么要有它：战斗页只有一套 DOM，野图挂机（本地/托管演出）、副本、通天塔都可能来抢。
// 占用权是唯一事实源，规则一旦被改坏（比如允许同级互相抢占、release 允许释放别人的），
// 表现就是"两套战斗抢同一个画面"这种只有玩家能看见的 bug —— 必须在测试里锁死。
// 覆盖：
//   ① 形态：三个 kind、优先级野图 < 爬塔玩法
//   ② 申请/幂等申请/释放/回到空闲
//   ③ 抢占：高优先级抢低优先级（广播里带 previous，被抢占方据此让位）；低优先级抢不到
//   ④ release 只认持有者（被抢占方释放是安全空操作）
//   ⑤ 订阅：载荷 {holder, previous}、退订、单个订阅者抛异常不影响其它订阅者
//   ⑥ 架构守卫：四个战斗模块都必须通过 BattleSession 申请/释放，不许再各自拼状态判断
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Date, Math };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/core/battle-session.js'), 'utf8'), ctx);

const S = ctx.BattleSession;
let pass = 0;
function A(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  pass++;
  console.log('PASS: ' + msg);
}

/* ---------- ① 形态 ---------- */
A(!!S && typeof S.claim === 'function', 'A1. window.BattleSession 已挂载且暴露 claim');
A(['wild', 'trial', 'tower'].every(k => S.KINDS[k]), 'A2. 三个占用者登记齐全（wild/trial/tower）');
A(S.KINDS.trial.priority > S.KINDS.wild.priority && S.KINDS.tower.priority > S.KINDS.wild.priority,
  'A3. 玩家主动玩法（副本/塔）优先级高于野图挂机');
A(S.isIdle() === true && S.holder() === null, 'A4. 初始空闲：isIdle=true / holder=null');
A(S.claim('not-a-kind').ok === false && S.claim('not-a-kind').reason === 'UNKNOWN_KIND',
  'A5. 未登记的占用者被拒绝（UNKNOWN_KIND，不会污染状态）');

/* ---------- ② 申请 / 幂等 / 释放 ---------- */
const events = [];
const off = S.onChange(info => events.push({ kind: info.holder && info.holder.kind, prev: info.previous && info.previous.kind }));

const r1 = S.claim('wild');
A(r1.ok === true && r1.holder.kind === 'wild', 'B1. 空闲时申请野图占用成功');
A(S.is('wild') && !S.isIdle(), 'B2. is()/isIdle() 反映当前占用者');
A(events.length === 1 && events[0].kind === 'wild' && events[0].prev === null, 'B3. 申请广播 {holder:wild, previous:null}');

const r2 = S.claim('wild');
A(r2.ok === true && r2.held === true, 'B4. 同一占用者重复申请幂等成功（held 标记）');
A(events.length === 1, 'B5. 幂等申请不重复广播（避免订阅者被无意义唤醒）');

A(S.release('trial') === false && S.is('wild'), 'B6. 非持有者 release 无效（被抢占方释放是安全空操作）');
A(S.release('wild') === true && S.isIdle(), 'B7. 持有者 release 成功并回到空闲');
A(events.length === 2 && events[1].kind === null && events[1].prev === 'wild', 'B8. 释放广播 {holder:null, previous:wild}');

/* ---------- ③ 抢占规则 ---------- */
events.length = 0;
S.claim('trial');
const r3 = S.claim('tower'); // 同级：不互相抢占（谁先谁得，后来者自己提示玩家）
A(r3.ok === false && r3.reason === 'BUSY' && r3.holder.kind === 'trial', 'C1. 同级不能抢占（BUSY + 当前持有者）');
const r4 = S.claim('wild');  // 低优先级：抢不到爬塔
A(r4.ok === false && S.is('trial'), 'C2. 野图抢不到正在打的副本（不打断玩家）');

S.release('trial');
S.claim('wild');
events.length = 0; // 只观察"抢占这一下"的广播
const r5 = S.claim('trial'); // 高优先级抢低优先级
A(r5.ok === true && S.is('trial'), 'C3. 副本可以抢占野图挂机（玩家主动行为优先）');
A(events.length === 1 && events[0].kind === 'trial' && events[0].prev === 'wild',
  'C4. 抢占广播带 previous=wild（被抢占的野图据此结算收尾）');
S.release('trial');

/* ---------- ④ 订阅健壮性 ---------- */
let good = 0;
const offThrow = S.onChange(() => { throw new Error('订阅者炸了'); });
const offGood = S.onChange(() => { good++; });
S.claim('wild');
A(good === 1 && S.is('wild'), 'D1. 某个订阅者抛异常不影响其它订阅者，也不影响占用状态');
offThrow(); offGood(); off(); // 全部退订
events.length = 0;
S.claim('tower');
A(events.length === 0, 'D2. 退订后不再收到广播');
S.release('tower');

/* ---------- ⑤ 架构守卫：四个战斗模块都必须走占用权 ---------- */
const modules = {
  '../js/core/battle.js': ["claim('wild')", "release('wild')"],
  '../js/core/idle-bridge.js': ["claim(SESSION_KIND)", 'releasePage()'],
  '../js/trial/trial-engine.js': ["claim('trial')", "release('trial')"],
  '../js/tower/tower-engine.js': ["claim('tower')", "release('tower')"]
};
for (const [file, needles] of Object.entries(modules)) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  A(needles.every(n => src.indexOf(n) >= 0), `E. ${file.split('/').pop()} 通过 BattleSession 申请/释放战斗页`);
}
// 反向守卫：不许再有第二套"现在谁在打"的判断散落在别处
const scanned = ['../js/core/battle.js', '../js/core/idle-bridge.js', '../js/trial/trial-engine.js',
  '../js/tower/tower-engine.js', '../js/main.js', '../js/ui/ui-battle.js'];
const offenders = scanned.filter(f => /isRunMode|isRunBusy|inDungeon/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
A(offenders.length === 0, 'E2. 没有第二套占用判定残留（isRunMode/isRunBusy/inDungeon 已全部收敛到占用权）' + (offenders.length ? '：' + offenders.join(',') : ''));

console.log('\nALL BATTLE SESSION TESTS PASSED (' + pass + ')');
process.exit(0);
