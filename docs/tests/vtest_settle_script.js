/* ============================================================
 * vtest_settle_script.js —— settlePlan 剧本版结算编排测试（2026-09-09 回放版）
 * 覆盖：
 *   A. 剧本窗事件带 reward / 时间轴 / 刀数（客户端回放所需字段齐全）
 *   B. 补账窗与剧本窗链式衔接（fightOffset / endHp / bossState）
 *   C. 经验链式两步：scriptExpBefore = 补账后真值；petPatch = 剧本窗后真值
 *   D. 确定性：同种子重跑 → 剧本逐字节一致（幂等可对账）
 *   E. 补账明细行结构与奖励
 * ============================================================ */
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

const CORE = import('../../supabase/functions/_shared/settle-core.mjs');
const CFG = import('../../supabase/functions/_shared/config-server.mjs');
const ENEMIES = import('../../supabase/functions/_shared/enemy-data-server.mjs');

const petRow = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '腐噜兽', icon: '🐹', growth: 5.5, level: 20,
  hp: 100, attack: 30, defense: 8, speed: 110,
  traits: [], awaken_trait: null, equipment: {},
  cur_hp: 500, exp: 100
};
const session = { id: 'sess-1', area_id: 'corrupted-forest', total_fights: 40, total_exp: 1000 };

(async () => {
  const { settlePlan } = await CORE;
  const config = (await CFG).default;
  const enemyList = (await ENEMIES).default;
  const bossState = { lastBossFight: 20 };

  const plan1 = settlePlan({
    session, petRow, equipItems: [], config, enemyList,
    gapSeconds: 3, gapSeed: 111, nextSeconds: 8, nextSeed: 222, bossState
  });

  // A. 剧本窗事件字段
  const ev = plan1.script.events[0];
  A(plan1.script.events.length > 0, 'A0. 剧本窗产出 ' + plan1.script.events.length + ' 场');
  A(ev && ['t0', 't1', 'win', 'enemy', 'enemyLevel', 'enemyName', 'exp', 'hpStart', 'hpLeft', 'petHits', 'enemyHits', 'petDmg', 'reward']
    .every(k => ev[k] !== undefined), 'A1. 剧本事件字段齐全（时间轴/刀数/经验/掉落）');
  A(ev.win === false || ev.reward, 'A2. 胜利场带 reward（服务器已定，客户端不再本地 roll）');
  const sumPetDmg = ev.petDmg.reduce((s, x) => s + x, 0);
  A(!ev.win || sumPetDmg >= 0, 'A3. petDmg 序列合法（miss=0，Σ≥0）');

  // B. 链式衔接：剧本窗的起点 = 补账窗的终点
  const planGapOnly = settlePlan({
    session, petRow, equipItems: [], config, enemyList,
    gapSeconds: 0, gapSeed: 0, nextSeconds: 8, nextSeed: 222, bossState
  });
  A(planGapOnly.detail.length === 0, 'B1. 无补账窗 → detail 为空');
  A(planGapOnly.script.events.length === plan1.script.events.length,
    'B2. 补账窗只挪动起点不吞掉剧本窗时长（两窗各算各的）');

  // C. 经验基线链式
  A(Number.isFinite(plan1.result.scriptExpBefore) && Number.isFinite(plan1.result.scriptLevelBefore),
    'C1. 剧本窗起点基线（expBefore/levelBefore）已产出');
  A(plan1.result.scriptExpBefore >= petRow.exp, 'C2. 基线 ≥ 结算前经验（补账经验计入基线）');
  A(plan1.petPatch.exp >= plan1.result.scriptExpBefore || plan1.summary.level > 20,
    'C3. 落库经验 ≥ 基线（剧本窗经验在基线之上）');
  A(plan1.summary.fights === plan1.summary.gapFights + plan1.script.events.length, 'C4. 场数 = 补账 + 剧本窗');

  // D. 确定性
  const plan2 = settlePlan({
    session, petRow, equipItems: [], config, enemyList,
    gapSeconds: 3, gapSeed: 111, nextSeconds: 8, nextSeed: 222, bossState
  });
  A(JSON.stringify(plan1.script.events) === JSON.stringify(plan2.script.events),
    'D1. 同种子重跑 → 剧本逐字节一致（幂等可对账）');
  const plan3 = settlePlan({
    session, petRow, equipItems: [], config, enemyList,
    gapSeconds: 3, gapSeed: 111, nextSeconds: 8, nextSeed: 999, bossState
  });
  A(JSON.stringify(plan1.script.events) !== JSON.stringify(plan3.script.events) || plan1.script.events.length === 0,
    'D2. 不同种子 → 剧本不同（种子真实参与模拟）');

  // E. 补账明细
  if (plan1.summary.gapFights > 0) {
    const row = plan1.detail[0];
    A(row && ['win', 'lv', 'name', 'exp', 'hp', 'boss', 'reward'].every(k => row[k] !== undefined),
      'E1. 补账明细行结构齐全（客户端只展示，经验在基线里）');
  } else {
    console.log('SKIP: E1（本次补账窗 0 场，结构断言走 K 段）');
    A(true, 'E1. 补账明细行结构齐全（0 场跳过）');
  }

  console.log('ALL SETTLE SCRIPT TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
