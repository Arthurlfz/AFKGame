// 资源副本（20 层爬塔）契约测试（配置与真实 trial/trial-config.js 同源，避免假配置跑出假绿）
// 覆盖（2026-09-10 爬塔化后）：
//   ① 配置形态：20 层、三条路线、层数档位 5/10/15/20、守关者
//   ② 层难度曲线：等级线性、数值随层递增、强档层上浮、路线难度乘算
//   ③ 每日免费进入次数（freeEntriesPerDay，北京时间 12:00 换日）+ 门票
//   ④ 被等级拦截不消耗免费次数/门票
//   ⑤ 通关拿最高档；死在第 4 层只给补偿；死在第 7 层拿第 5 层档（按最高到达层数）
//   ⑥ 奖励绝不给区域材料（资源归属矩阵红线）
//   ⑦ 血量跨层累计（层间写回、不回满）
//   ⑧ 大地图 trialPoints 与路线一一对应；window.ResourceTrial 旧接口兼容
const fs = require('fs');
const vm = require('vm');

const gained = [];
let ticket = 0;
// 强宠（一路赢到底）/ 弱宠（撑不了几层）
const strong = { id: 'p1', name: '小强', level: 80, growth: 60, stats: { atk: 5000, def: 2000, hp: 50000 }, curHp: 50000 };
const weak = { id: 'p2', name: '小弱', level: 12, growth: 3, stats: { atk: 90, def: 20, hp: 600 }, curHp: 600 };
let pet = strong;

// localStorage 桩（内存实现，供每日次数持久化）
const memStore = {};
const localStorageStub = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; }
};

// Battle 桩：记录 beginTrialFloor 注入的层上下文，胜负由测试脚本逐层驱动。
// 血量写回与真实 battle.js endFight 同口径（onEnd 前先 setCurHp）。
let floorCtx = null;
let winUntilFloor = 20;      // 前 N 层赢，之后输（默认全赢）
let hpLossPerFloor = 0;      // 每层固定掉血（测跨层累计用）
const battleStub = {
  beginTrialFloor(ctx2) { floorCtx = ctx2; return true; },
  isRunning: () => false,
  isTrialMode: () => false
};

const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: localStorageStub, Date };
ctx.window = ctx;
ctx.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/worldmap.js', 'utf8'), ctx);
// 2026-09-10 起副本数值在 trial/trial-config.js（一个文件一个职责）
vm.runInContext(fs.readFileSync('../js/trial/trial-config.js', 'utf8'), ctx);
vm.runInContext('Config.resourceTrials.floorDelayMs = 1;', ctx); // 测试加速：层间停顿压到 1ms
ctx.Pet = {
  getActivePet: () => pet,
  getStats: p => p.stats,
  getCurHp: p => (p.curHp != null ? p.curHp : p.stats.hp),
  setCurHp: (p, hp) => { p.curHp = hp; }
};
ctx.Materials = {
  getQuantity: name => (name === '资源试炼门票' ? ticket : 0),
  spend: async (name, amount) => {
    if (name !== '资源试炼门票' || ticket < amount) return { ok: false, error: '门票不足' };
    ticket -= amount;
    return { ok: true };
  },
  gain: (name, qty) => gained.push([name, qty])
};
ctx.Battle = battleStub;
// 战斗页占用权（副本 claim('trial') 依赖它）：与浏览器同序，在引擎之前加载
vm.runInContext(fs.readFileSync('../js/core/battle-session.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-access.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-rewards.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-engine.js', 'utf8'), ctx);

const Engine = ctx.TrialEngine;
const Access = ctx.TrialAccess;
const C = code => vm.runInContext(code, ctx);
const ok = (condition, message) => {
  if (!condition) { console.error('FAIL: ' + message); process.exit(1); }
  console.log('PASS: ' + message);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 逐层驱动：等引擎开层 → 按 winUntilFloor/hpLossPerFloor 决定该层胜负 → 回调
async function runTrial(routeId) {
  gained.length = 0;
  const done = Engine.start(routeId, {});
  let guard = 0;
  while (guard++ < 500) {
    await sleep(1);
    if (floorCtx) {
      const fc = floorCtx; floorCtx = null;
      const state = Engine.getState();
      const win = state.floor <= winUntilFloor;
      const petHp = win ? Math.max(1, ctx.Pet.getCurHp(pet) - hpLossPerFloor) : 0;
      ctx.Pet.setCurHp(pet, petHp);
      fc.onEnd({ win, petHp, petMaxHp: pet.stats.hp });
    } else if (!Engine.getState().running) {
      break;
    }
  }
  return done;
}

(async () => {
  const cfg = C('Config.resourceTrials');

  /* ============ 0. 配置形态 ============ */
  ok(cfg.floors === 20, '副本固定 20 层');
  ok(cfg.routes.every(r => r.name.indexOf('副本') === 0), '三个路线名都以「副本」开头（' + cfg.routes.map(r => r.name).join(' / ') + '）');
  ok(cfg.freeEntriesPerDay >= 1, 'freeEntriesPerDay 已配置（' + cfg.freeEntriesPerDay + '）');
  ok(cfg.routes.every(r => JSON.stringify((r.floorTiers || []).map(t => t.floor)) === '[5,10,15,20]'),
    '每条路线的层数档位都是 5/10/15/20（按最高到达层数给）');
  ok(cfg.routes.every(r => r.guardian && r.guardian.name && r.guardian.title),
    '每条路线配置了守关者（整页战斗立绘）：' + cfg.routes.map(r => (r.guardian || {}).name || '无').join(' / '));
  ok(cfg.routes.every(r => ['影蚀魔君', '幽火魔狐', '骸骨君主'].indexOf(r.guardian.name) >= 0),
    '守关者名字都存在于宠物立绘库（有真实立绘可显示）');
  ok(cfg.floorLevelStart < cfg.floorLevelEnd && cfg.baseStats.hp > 0 && cfg.baseStats.atk > 0 && cfg.baseStats.def > 0,
    '层等级区间与数值锚点（baseStats）已配置');

  /* ============ 1. 层难度曲线（数值体系与大地图同源，参数全在 config） ============ */
  const route1 = cfg.routes[0];
  ok(Engine.floorLevelOf(1) === cfg.floorLevelStart && Engine.floorLevelOf(20) === cfg.floorLevelEnd,
    `怪等级从第 1 层 ${Engine.floorLevelOf(1)} 级线性爬到第 20 层 ${Engine.floorLevelOf(20)} 级`);
  const hpSeq = [];
  for (let f = 1; f <= 20; f++) hpSeq.push(Engine.floorEnemyStats(route1, f).hp);
  ok(hpSeq.every((v, i) => i === 0 || v > hpSeq[i - 1]), '守关者血量逐层严格递增（难度只跟层数走）');
  ok(Engine.floorEnemyStats(route1, 20).hp > Engine.floorEnemyStats(route1, 6).hp * 5,
    '顶层守关者强度远超前期（满成长+装备才有得上）');
  const elite5 = Engine.floorDifficultyOf(route1, 5), floor4 = Engine.floorDifficultyOf(route1, 4);
  ok(elite5 > floor4 * 1.1, '强档层（5/10/15/20）难度跳档（eliteMult 阶梯）');
  const diffs = [];
  for (let f = 1; f <= 20; f++) diffs.push(Engine.floorDifficultyOf(route1, f));
  ok(diffs.every((v, i) => i === 0 || v > diffs[i - 1]), '层难度全程严格递增（强档层阶梯永久保留，绝不倒退）');
  ok(Engine.floorDifficultyOf(cfg.routes[1], 10) > Engine.floorDifficultyOf(route1, 10),
    '路线难度乘算（涅槃 1.35 > 蜕变 1.0）');
  const e20 = Engine.floorEnemyStats(route1, 20);
  ok(e20.name === route1.guardian.name && e20.level === cfg.floorLevelEnd && e20.maxHp === e20.hp,
    '层敌人=守关者本体（名字/等级/血量口径一致，可直接喂 battle.js）');

  /* ============ 2. 每日免费进入：免费次数内不需要门票 ============ */
  const freePerDay = cfg.freeEntriesPerDay;
  ticket = 0;
  hpLossPerFloor = 0;
  winUntilFloor = 20;
  let r = await runTrial('metamorph');
  ok(r.ok && r.cleared && r.consumed === 'free', '免费次数内进入，不消耗门票（第 1 次，free）');
  ok(ticket === 0, '免费进入后门票数量不变');
  for (let i = 1; i < freePerDay; i++) {
    r = await runTrial('metamorph');
    ok(r.ok && r.consumed === 'free', `免费次数内进入（第 ${i + 1}/${freePerDay} 次）`);
  }
  ok(Access.getDailyInfo().find(i => i.routeId === 'metamorph').freeLeft === 0, '免费次数用尽后 freeLeft = 0');
  ok(Access.entryInfo('metamorph').freeLeft === 0, 'entryInfo 反映免费次数已用尽');

  /* ============ 3. 免费次数用尽后：必须门票，且失败不回退 ============ */
  ticket = 0;
  r = await runTrial('metamorph');
  ok(r.ok === false && (r.error || '').indexOf('门票') >= 0, '免费次数用尽且无门票时无法进入');
  ticket = 1;
  r = await runTrial('metamorph');
  ok(r.ok && r.consumed === 'ticket', '有门票时消耗门票进入');
  ok(ticket === 0, '门票进入成功消耗 1 张门票');

  /* ============ 4. 通关：拿最高档（第 20 层档），奖励入包 ============ */
  gained.length = 0;
  ticket = 1;
  r = await runTrial('nirvana');
  ok(r.ok && r.cleared && r.maxFloor === 20, '强宠 20 层全通（maxFloor=20）');
  ok(r.tierFloor === 20, '通关拿第 20 层档位');
  ok(gained.some(x => x[0] === '涅槃丹' && x[1] === 4), '涅槃路线第 20 层档 = 涅槃丹×4');
  ok(!gained.some(x => x[0] === '区域材料'), '副本绝不给区域材料（区域材料只能是地图产出）');

  /* ============ 5. 失败：按最高到达层数取档；不足第一层档只给补偿 ============ */
  // 死在第 4 层（赢 3 输 1）→ 不足 5 层档 → 只给基础补偿
  ticket = 1; winUntilFloor = 3; pet = weak;
  r = await runTrial('metamorph');
  ok(r.ok && r.cleared === false && r.maxFloor === 3, '弱宠止步第 3 层（爬塔有真实死亡风险）');
  ok(r.tierFloor === 0 && gained.some(x => x[0] === '进化素材' && x[1] === 1),
    '不足第 5 层档只给基础补偿（进化素材×1）');
  ok(ticket === 0, '失败不退还门票');
  // 死在第 7 层（赢 7 输 1）→ 达到第 5 层档 → 拿第 5 层档（不是补偿）
  ticket = 1; winUntilFloor = 7; pet = strong;
  r = await runTrial('metamorph');
  ok(r.ok && !r.cleared && r.maxFloor === 7, '死在第 7 层，最高到达层数=7');
  ok(r.tierFloor === 5 && gained.some(x => x[0] === '进化素材' && x[1] === 3),
    '死在第 7 层仍拿第 5 层档（按最高到达层数给，越深越好）');
  pet = strong; winUntilFloor = 20;

  /* ============ 6. 等级拦截：不消耗免费次数也不消耗门票 ============ */
  ticket = 1;
  pet = weak;
  const beforeNirvana = Access.entryInfo('nirvana').freeLeft;
  r = await runTrial('nirvana');
  ok(r.ok === false && r.error === '需要宠物达到 Lv25', '低等级不能进入涅槃路线');
  ok(ticket === 1, '被等级拦截不消耗门票');
  ok(Access.entryInfo('nirvana').freeLeft === beforeNirvana, '被等级拦截不消耗免费次数');
  pet = strong;

  /* ============ 7. 血量跨层累计：层间写回、不回满 ============ */
  ticket = 1; hpLossPerFloor = 500;
  r = await runTrial('temper');
  // 引擎每层 emit floor 事件时带的 petHp 来自 Pet.getCurHp（层间由战斗引擎写回）
  ok(hpLossPerFloor > 0 && r.ok, '带掉血跑通全层（跨层累计前提）');
  ok(strong.curHp < strong.stats.hp, '通关后宠物血量没有回满（跨层累计，不白给）');
  strong.curHp = strong.stats.hp; hpLossPerFloor = 0;

  /* ============ 8. 每日刷新：北京时间 12:00 换日 ============ */
  ok(Access.dayKeyOf(new Date('2026-09-10T03:59:00Z')) === '2026-9-9', '北京时间 11:59 仍算上一试炼日（key=2026-9-9）');
  ok(Access.dayKeyOf(new Date('2026-09-10T04:00:00Z')) === '2026-9-10', '北京时间 12:00 进入新试炼日（key=2026-9-10）');
  ok(Access.dayKeyOf(new Date('2026-09-10T15:00:00Z')) === '2026-9-10', '北京时间 23:00 仍是当天试炼日');
  ok(Access.dayKeyOf(new Date('2026-09-10T16:00:00Z')) === '2026-9-10', '北京时间次日 00:00 仍是上一试炼日');
  // 换日清零：用「旧试炼日存档」的独立上下文加载模块 → 首次 getDailyInfo 必须触发重置
  {
    const staleStore = { 'fos_trial_usage': JSON.stringify({ dayKey: '2000-1-1', used: { metamorph: 99 } }) };
    const ctx2 = {
      console, setTimeout, clearTimeout, Date,
      localStorage: {
        getItem: k => (k in staleStore ? staleStore[k] : null),
        setItem: (k, v) => { staleStore[k] = String(v); },
        removeItem: k => { delete staleStore[k]; }
      }
    };
    ctx2.window = ctx2;
    vm.createContext(ctx2);
    vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx2);
    vm.runInContext(fs.readFileSync('../js/trial/trial-config.js', 'utf8'), ctx2);
    vm.runInContext(fs.readFileSync('../js/trial/trial-access.js', 'utf8'), ctx2);
    const info2 = ctx2.TrialAccess.getDailyInfo().find(i => i.routeId === 'metamorph');
    ok(info2.freeLeft === freePerDay && info2.used === 0,
      '跨试炼日自动重置免费次数（旧存档 used=99 → 重置为 0, freeLeft=' + freePerDay + '）');
  }

  /* ============ 9. 大地图节点一致性：trialPoints ↔ routes ============ */
  const points = C('window.WorldMap.trialPoints');
  ok(Array.isArray(points) && points.length === cfg.routes.length,
    `副本节点数量与路线一致（节点 ${points.length} / 路线 ${cfg.routes.length}）`);
  const routeIds = cfg.routes.map(x => x.id);
  ok(points.every(p => p.type === 'trial' && routeIds.includes(p.routeId)),
    '每个副本节点 type=trial 且 routeId 存在于 Config.resourceTrials.routes');
  ok(points.every(p => p.name.indexOf('副本') === 0), '副本节点名都带「副本」前缀');
  ok(points.every(p => typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100),
    '副本节点坐标都是有效百分比（0~100）');
  ok(C('window.WorldMap.points.length') === C('Config.battle.areas.length'),
    '野图点位数量与 Config.battle.areas 仍一致（副本节点独立于野图点位）');

  /* ============ 10. window.ResourceTrial 旧接口兼容（调用方零改动） ============ */
  const T = ctx.ResourceTrial;
  ok(typeof T.getDailyInfo === 'function' && typeof T.entryInfo === 'function' && typeof T.start === 'function',
    'window.ResourceTrial 聚合挂载旧接口（ui-worldmap 等调用方零改动）');
  ok(T.getDailyInfo().length === 3 && T.routeOf('temper').id === 'temper', '旧接口行为正常（getDailyInfo/routeOf）');

  console.log('ALL RESOURCE TRIAL TESTS PASSED');
})().catch(error => { console.error(error); process.exit(1); });
