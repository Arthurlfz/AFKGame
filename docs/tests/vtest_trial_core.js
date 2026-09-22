/* ============================================================
 * vtest_trial_core.js —— 副本服务端核心守值（2026-09-23 立）
 *
 * 为什么要有这份测试：
 *   服务端 `_shared/trial-core.mjs` 曾经严重漂移 —— 它是 2026-09-09 的「5 轮 + 简化伤害 + 老奖励」模型，
 *   而客户端早已是 20 层。两份各算各的 ⇒ 一旦接线，服务端判出的层数与奖励全是错的。
 *   本测试把「服务端核心 == 客户端 trial-engine / trial-rewards 的口径」钉死：
 *     ① 层等级 / 层难度 / 怪数值 逐层同源
 *     ② 奖励档位与补偿同源
 *     ③ 整局是 20 层、血量跨层累计只减不增、倒下即结算
 *     ④ 走的是 simulateFight 的「显式敌人数值」入口（不按图表缩放）
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');

const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

/* ---------- 客户端一侧（vm 加载真实前端代码，不另写一份） ---------- */
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date };
ctx.window = ctx;
ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
ctx.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-rewards.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../js/trial/trial-engine.js', 'utf8'), ctx);

const CFG = ctx.Config.resourceTrials;
const CE = ctx.TrialEngine;          // 客户端层曲线（唯一事实源）
const CR = ctx.TrialRewards;         // 客户端奖励口径
const config = ctx.Config;           // 完整配置（喂给服务端战核）

(async () => {
  /* ---------- 服务端一侧 ---------- */
  const S = await import('../../supabase/functions/_shared/trial-core.mjs');
  const BS = await import('../../supabase/functions/_shared/battle-sim.mjs');

  /* ============ 1. 层曲线同源（20 层逐层比对，三条路线全覆盖） ============ */
  const routes = CFG.routes || [];
  A(routes.length === 3, `三条副本路线（${routes.map(r => r.id).join('/')}）`);
  let diffLevel = 0, diffStat = 0;
  for (const route of routes) {
    for (let f = 1; f <= (CFG.floors || 20); f++) {
      if (CE.floorLevelOf(f) !== S.floorLevelOf(f, CFG)) diffLevel++;
      const c = CE.floorEnemyStats(route, f);
      const s = S.floorEnemyStats(route, f, CFG);
      if (c.level !== s.level || c.hp !== s.hp || c.atk !== s.atk || c.def !== s.def ||
          c.hit !== s.hit || c.dodge !== s.dodge) diffStat++;
    }
  }
  A(diffLevel === 0, '层等级曲线与客户端 trial-engine 完全一致（20 层 × 3 路线）');
  A(diffStat === 0, '每层怪数值（等级/血/攻/防/命中/闪避）与客户端完全一致');
  A(S.floorLevelOf(1, CFG) === 10 && S.floorLevelOf(20, CFG) === 100,
    `层等级锚点正确（第 1 层 ${S.floorLevelOf(1, CFG)} → 第 20 层 ${S.floorLevelOf(20, CFG)}）`);

  /* ============ 2. 奖励档位同源 ============ */
  let diffReward = 0;
  for (const route of routes) {
    for (const maxFloor of [0, 3, 5, 7, 10, 15, 20]) {
      const s = S.rewardFor(route, maxFloor);
      const cTier = CR.tierFor(route, maxFloor);
      const cItems = cTier && cTier.items ? cTier.items : CR.consolationFor(route);
      if (JSON.stringify(s.reward) !== JSON.stringify(cItems.map(i => ({ name: i.name, qty: i.qty })))) diffReward++;
      if (s.tierFloor !== (cTier ? Number(cTier.floor) || 0 : 0)) diffReward++;
    }
  }
  A(diffReward === 0, '奖励档位与补偿和客户端 trial-rewards 完全一致（7 个层数 × 3 路线）');

  /* ============ 3. 整局：20 层 / 血量只减不增 / 倒下即结算 ============ */
  const strong = {
    name: '毕业档测试宠', level: 60,
    // 与 trial-config 校准口径同量级（攻 1.45 万 / 血 3 万 / 防 6184 那一档）
    _stats: { hp: 30000, atk: 14500, def: 6200, spd: 127, critRate: 0.478, critDamage: 2.03, hit: 134, dodge: 50, lifesteal: 0.168, pen: 38, dr: 0 }
  };
  const weak = {
    name: '弱宠', level: 12,
    _stats: { hp: 3000, atk: 900, def: 300, spd: 80, critRate: 0.08, critDamage: 1.5, hit: 90, dodge: 5, lifesteal: 0, pen: 0, dr: 0 }
  };
  const run = (pet) => S.planTrial({
    pet, stats: pet._stats, route: routes[0], petLevel: pet.level,
    cfg: CFG, config, rnd: BS.mulberry32(20260923)
  });

  const p1 = run(strong);
  A(p1.floors.length > 0 && p1.floors.length <= (CFG.floors || 20), `整局最多 ${CFG.floors || 20} 层（实跑 ${p1.floors.length} 层）`);
  A(p1.floors.every(f => f.floor >= 1), '层号从 1 开始');

  const p2 = run(weak);
  A(p2.maxFloor < (CFG.floors || 20) && !p2.cleared, `弱宠爬不到底（止步第 ${p2.maxFloor} 层，未通关）`);
  A(p2.floors[p2.floors.length - 1].win === false, '倒下那一层记为失败并立即结算（不再往下打）');

  // 血量跨层累计：只减不增（层间不回血）
  const seq = p2.floors.map(f => f.petHpLeft);
  A(seq.every((hp, i) => i === 0 || hp <= seq[i - 1]), `血量跨层累计只减不增（${seq.join(' → ')}）`);
  A(p2.hpPercent === Math.max(0, Math.round((seq[seq.length - 1] / weak._stats.hp) * 100)), '结算剩余血百分比与最后一层的血量一致');

  /* ============ 4. 走的是「显式敌人数值」入口（不按图表缩放） ============ */
  const one = BS.simulateFight({
    pet: strong, stats: strong._stats,
    area: undefined,                                  // 不给图 —— 显式敌人不该依赖图
    enemyData: { name: '试炼之影', enemyType: 'evolved', explicit: S.floorEnemyStats(routes[0], 20, CFG) },
    config, rnd: BS.mulberry32(7), curHp: strong._stats.hp
  });
  A(one.enemyLevel === 100, `显式敌人数值生效：第 20 层怪等级 = ${one.enemyLevel}（不按图表 levelRange 钳到 6）`);
  /* 演出数据（2026-09-23 翻车后补）：服务器必须把每层"怎么打的"发回来，
   * 否则客户端只剩一行行字 —— 用户原话「怪物看不到，20层几秒钟就打完了」。 */
  A(p1.floors.every(f => Array.isArray(f.events) && f.events.length > 0),
    '每层都带演出用的出手序列（events 非空，客户端才演得出来）');
  A(p1.floors[0].events.every(e => e.by === 'pet' || e.by === 'enemy'),
    '出手序列的出手方只有 pet / enemy（播放器按它决定往哪边飘字）');
  A(typeof one.win === 'boolean' && typeof one.petHpLeft === 'number', '显式敌人也能正常跑完一场战斗（win / petHpLeft）');

  /* ============ 5. 命中延迟不许出现第二份（2026-09-23：宠物还没冲过去伤害就飘出来了） ============
   * 战核里 `hitAt`（出手后多久结算伤害）是权威；副本播放器 trial-replay.js 手抄了一份 HIT_DELAY_MS。
   * 手抄 = 第二份事实源 ⇒ 战核改了这边不红。这里用源码比对把它钉死。 */
  const fs2 = require('fs');
  const rpSrc = fs2.readFileSync(__dirname + '/../js/ui/battle/show.js', 'utf8');
  A(Number(BS.SIM_HIT_AT) > 0, `战核导出命中延迟常量 SIM_HIT_AT = ${BS.SIM_HIT_AT}（唯一事实源）`);
  A(!/HIT_DELAY_MS\s*=\s*320\s*;/.test(rpSrc),
    '播放器不再手抄 320（改为读 window.BattleSim.SIM_HIT_AT，兜底值也与战核同源）');
  A(rpSrc.indexOf('BattleSim.SIM_HIT_AT') > 0, '播放器的命中延迟确实取自战核常量');

  console.log('ALL TRIAL CORE TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
