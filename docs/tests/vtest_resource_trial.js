// 资源试炼/资源副本 契约测试（配置与真实 config.js 同源，避免测试用假配置跑出假绿）
// 覆盖（2026-09-09 节点化后）：
//   ① 每日免费进入次数（freeEntriesPerDay，北京时间 12:00 换日）
//   ② 免费次数用尽后需门票，失败不回退次数/门票
//   ③ 被等级拦截不消耗免费次数
//   ④ 三条路线奖励/补偿仍正确（蜕变/涅槃/淬炼）
//   ⑤ 副本命名带「副本」前缀；大地图 trialPoints 与路线一一对应
const fs = require('fs');
const vm = require('vm');

const gained = [];
let ticket = 0;
// 强宠 / 弱宠两套属性：失败分支曾经是死代码（旧模型全等级 100% 通关）
const strong = { level: 10, stats: { atk: 500, def: 500, hp: 5000 } };
const weak = { level: 10, stats: { atk: 30, def: 5, hp: 200 } };
let pet = strong;

// localStorage 桩（内存实现，供每日次数持久化）
const memStore = {};
const localStorageStub = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; }
};

const ctx = { console, setTimeout, clearTimeout, localStorage: localStorageStub, Date };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/worldmap.js', 'utf8'), ctx);
ctx.Pet = { getActivePet: () => pet, getStats: p => p.stats };
ctx.Materials = {
  getQuantity: name => (name === '资源试炼门票' ? ticket : 0),
  spend: async (name, amount) => {
    if (name !== '资源试炼门票' || ticket < amount) return { ok: false, error: '门票不足' };
    ticket -= amount;
    return { ok: true };
  },
  gain: (name, qty) => gained.push([name, qty])
};
ctx.UI = { renderResourceTrial() {}, showToast() {} };
vm.runInContext(fs.readFileSync('../js/core/resource-trial.js', 'utf8'), ctx);
const T = ctx.ResourceTrial;
const C = code => vm.runInContext(code, ctx);
const ok = (condition, message) => {
  if (!condition) { console.error('FAIL: ' + message); process.exit(1); }
  console.log('PASS: ' + message);
};

(async () => {
  const cfg = C('Config.resourceTrials');

  /* ============ 0. 副本命名：带「副本」前缀 ============ */
  ok(cfg.routes.every(r => r.name.indexOf('副本') === 0), '三个路线名都以「副本」开头（' + cfg.routes.map(r => r.name).join(' / ') + '）');
  ok(cfg.freeEntriesPerDay >= 1, 'freeEntriesPerDay 已配置（' + cfg.freeEntriesPerDay + '）');

  /* ============ 1. 每日免费进入：免费次数内不需要门票 ============ */
  const freePerDay = cfg.freeEntriesPerDay;
  ticket = 0;
  let r = await T.start('metamorph', { instant: true });
  ok(r.ok && r.cleared && r.consumed === 'free', '免费次数内进入，不消耗门票（第 1 次，free）');
  ok(ticket === 0, '免费进入后门票数量不变');
  for (let i = 1; i < freePerDay; i++) {
    r = await T.start('metamorph', { instant: true });
    ok(r.ok && r.consumed === 'free', `免费次数内进入（第 ${i + 1}/${freePerDay} 次）`);
  }
  ok(T.getDailyInfo().find(i => i.routeId === 'metamorph').freeLeft === 0, '免费次数用尽后 freeLeft = 0');
  ok(T.entryInfo('metamorph').freeLeft === 0, 'entryInfo 反映免费次数已用尽');

  /* ============ 2. 免费次数用尽后：必须门票，且失败不回退 ============ */
  ticket = 0;
  r = await T.start('metamorph', { instant: true });
  ok(r.ok === false && (r.error || '').indexOf('门票') >= 0, '免费次数用尽且无门票时无法进入');
  ticket = 1;
  r = await T.start('metamorph', { instant: true });
  ok(r.ok && r.consumed === 'ticket', '有门票时消耗门票进入（第 ' + freePerDay + '+1 次）');
  ok(ticket === 0, '门票进入成功消耗 1 张门票');

  /* ============ 3. 失败：消耗次数/门票，给本路线基础补偿，绝不给区域材料 ============ */
  gained.length = 0;
  ticket = 1;
  pet = weak;
  r = await T.start('metamorph', { instant: true });
  ok(r.ok && r.cleared === false && r.rounds < 5, '强度不足会在中途倒下');
  ok(ticket === 0, '失败不退还门票');
  ok(gained.some(x => x[0] === '进化素材' && x[1] === 1), '失败给本路线的基础补偿（进化素材×1，而非区域材料）');
  ok(!gained.some(x => x[0] === '区域材料'), '失败绝不给区域材料（区域材料只能是地图产出）');
  pet = strong;

  /* ============ 4. 等级拦截：不消耗免费次数也不消耗门票 ============ */
  ticket = 1;
  const beforeNirvana = T.entryInfo('nirvana').freeLeft;
  r = await T.start('nirvana', { instant: true });
  ok(r.ok === false && r.error === '需要宠物达到 Lv25', '低等级不能进入涅槃路线');
  ok(ticket === 1, '被等级拦截不消耗门票');
  ok(T.entryInfo('nirvana').freeLeft === beforeNirvana, '被等级拦截不消耗免费次数');

  /* ============ 5. 三条路线奖励正确（原有契约回归） ============ */
  // 涅槃：Lv25 可进，发涅槃丹
  gained.length = 0;
  ticket = 1;
  const lv25 = { level: 25, stats: { atk: 900, def: 300, hp: 9000 } };
  pet = lv25;
  r = await T.start('nirvana', { instant: true });
  ok(r.ok && r.cleared, 'Lv25 可以通过涅槃路线');
  ok(gained.some(x => x[0] === '涅槃丹' && x[1] === 1), '涅槃路线发放涅槃丹');
  // 淬炼：低等级给重铸石，Lv25+ 给增缀/剥离
  gained.length = 0;
  ticket = 1;
  pet = strong;
  await T.start('temper', { instant: true });
  ok(gained.some(x => x[0] === '重铸石' && x[1] === 2), '淬炼路线低等级给重铸石');
  gained.length = 0;
  ticket = 1;
  pet = lv25;
  await T.start('temper', { instant: true });
  ok(gained.some(x => x[0] === '增缀石') && gained.some(x => x[0] === '剥离石'), '淬炼路线 Lv25+ 给增缀石与剥离石');
  pet = strong;

  /* ============ 6. 难度参数必须存在且合理 ============ */
  ok(cfg.hitRatio > 0 && cfg.roundRatio > 0, '试炼有掉血比例与轮次递增参数');
  ok(cfg.roundDelayMs >= 200, '试炼每场之间有演出间隔');

  /* ============ 7. 每日刷新：北京时间 12:00 换日 ============ */
  // 11:59 北京（03:59 UTC）仍属于 09-08 起的试炼日；12:00 北京（04:00 UTC）进入 09-09 试炼日
  ok(T.dayKeyOf(new Date('2026-09-09T03:59:00Z')) === '2026-9-8', '北京时间 11:59 仍算上一试炼日（key=2026-9-8）');
  ok(T.dayKeyOf(new Date('2026-09-09T04:00:00Z')) === '2026-9-9', '北京时间 12:00 进入新试炼日（key=2026-9-9）');
  ok(T.dayKeyOf(new Date('2026-09-09T15:00:00Z')) === '2026-9-9', '北京时间 23:00 仍是当天试炼日（key=2026-9-9）');
  ok(T.dayKeyOf(new Date('2026-09-09T16:00:00Z')) === '2026-9-9', '北京时间次日 00:00 仍是上一试炼日（key=2026-9-9）');
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
    vm.runInContext(fs.readFileSync('../js/core/resource-trial.js', 'utf8'), ctx2);
    const info2 = ctx2.ResourceTrial.getDailyInfo().find(i => i.routeId === 'metamorph');
    ok(info2.freeLeft === freePerDay && info2.used === 0,
      '跨试炼日自动重置免费次数（旧存档 used=99 → 重置为 0, freeLeft=' + freePerDay + '）');
  }

  /* ============ 8. 大地图节点一致性：trialPoints ↔ routes ============ */
  const points = C('window.WorldMap.trialPoints');
  ok(Array.isArray(points) && points.length === cfg.routes.length,
    `副本节点数量与路线一致（节点 ${points.length} / 路线 ${cfg.routes.length}）`);
  const routeIds = cfg.routes.map(x => x.id);
  ok(points.every(p => p.type === 'trial' && routeIds.includes(p.routeId)),
    '每个副本节点 type=trial 且 routeId 存在于 Config.resourceTrials.routes');
  ok(points.every(p => p.name.indexOf('副本') === 0), '副本节点名都带「副本」前缀');
  ok(points.every(p => typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100),
    '副本节点坐标都是有效百分比（0~100）');
  // 野图点位数量不受影响（原有一致性）
  ok(C('window.WorldMap.points.length') === C('Config.battle.areas.length'),
    '野图点位数量与 Config.battle.areas 仍一致（副本节点独立于野图点位）');

  /* ============ 9. 守护者形象（战斗画面立绘用） ============ */
  ok(cfg.routes.every(r => r.guardian && r.guardian.name && r.guardian.title),
    '每条路线配置了守护者（战斗画面立绘）：' + cfg.routes.map(r => (r.guardian || {}).name || '无').join(' / '));
  ok(cfg.routes.every(r => ['影蚀魔君', '幽火魔狐', '骸骨君主'].indexOf(r.guardian.name) >= 0),
    '守护者名字都存在于宠物立绘库（有真实立绘可显示）');

  /* ============ 10. 逐场回调 onRound（战斗画面演出数据） ============ */
  ticket = 1;
  const roundsSeen = [];
  r = await T.start('metamorph', {
    instant: true,
    onRound: result => { roundsSeen.push(result); }
  });
  ok(roundsSeen.length === r.rounds, `onRound 每场触发一次（触发 ${roundsSeen.length} / 场次 ${r.rounds}）`);
  ok(roundsSeen.every(x => x.round >= 1 && x.turns >= 1 && x.damage >= 1 && x.enemyHp >= 1 && x.maxHp >= 1),
    '每场回调携带完整演出数据（round/turns/damage/enemyHp/maxHp）');
  ok(roundsSeen.every((x, i) => i === 0 || x.hpLeft <= roundsSeen[i - 1].hpLeft), '血量跨场累计、不回满');

  console.log('ALL RESOURCE TRIAL TESTS PASSED');
})().catch(error => { console.error(error); process.exit(1); });
