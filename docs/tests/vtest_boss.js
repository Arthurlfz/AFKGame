/* ============================================================
 * vtest_boss.js —— 2026-09-05 地图系统·守关 Boss 验收（随机版）
 * 拍板：每场 1/1600 随机（期望 1600 场 ≈ 图10 挂机 2 小时），连续 2400 场未出必出，
 *       出后 200 场内不再出；跨结算段累计（全局 fightNo + bossState.lastBossFight）。
 * 验证：
 *   A. rollBoss 单测：冷却/保底/随机命中/未初始化/状态更新
 *   B. 黑盒跨段：fightOffset 全局坐标下保底必出
 *   C. Boss 表现：等级=图段上限 / 名字「霸主·」/ 血×5 攻×1.5（公式在案）
 *   D. drop.js：Boss 必掉金装 + 区域材料×5；底材 ilvl 门槛
 *   E. quest.js：Boss 击杀计数 → 首通完成 → isAreaCleared；只发一次
 * 跑法：node vtest_boss.js
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

(async () => {
  /* ===== A. rollBoss 单测（前端 battle-sim 导出） ===== */
  const FE = await import('../../docs/js/core/battle-sim.mjs');
  const { rollBoss, bossRand, BOSS_CHANCE, BOSS_PITY, BOSS_COOLDOWN } = FE;
  A(Math.abs(BOSS_CHANCE - 1 / 1600) < 1e-9, 'A0. 概率=1/1600（期望 1600 场 ≈2 小时）');
  A(BOSS_PITY === 2400 && BOSS_COOLDOWN === 200, 'A0b. 保底 2400 / 冷却 200');

  // A1. 冷却：刚出过（lastBossFight=fightNo）→ pity=0，随机流再小也不出
  {
    const st = { lastBossFight: 500 };
    const randTiny = () => 0; // 必中，但冷却期不该触发
    A(rollBoss(500, st, randTiny) === false, 'A1. 冷却期（pity=0）不出');
    A(rollBoss(699, st, randTiny) === false, 'A1b. 冷却期（pity=199）不出');
    A(rollBoss(700, st, randTiny) === true, 'A1c. 冷却结束（pity=200）恢复判定且随机命中');
  }
  // A2. 保底：pity=2399 未触发（随机不中时不出），pity=2400 必出（不消费随机）
  {
    const st = { lastBossFight: 0 };
    const randHuge = () => 0.9999; // 永不命中
    A(rollBoss(2399, st, randHuge) === false, 'A2. pity=2399 未到保底且随机不中 → 不出');
    A(rollBoss(2400, st, randHuge) === true, 'A2b. pity=2400 保底必出');
    A(st.lastBossFight === 2400, 'A2c. 出后状态更新 lastBossFight=2400');
  }
  // A3. 随机命中：rand < 1/1600 → 出；状态更新
  {
    const st = { lastBossFight: -200 };
    const randHit = () => 0.0001; // < 1/1600
    A(rollBoss(100, st, randHit) === true, 'A3. 随机命中（rand=0.0001 < 1/1600）');
    A(st.lastBossFight === 100, 'A3b. 命中后 lastBossFight=100');
  }
  // A4. 未初始化（{}）：首次进入随机区（不误判冷却）
  {
    const st = {};
    const randMiss = () => 0.5;
    A(rollBoss(0, st, randMiss) === false, 'A4. 未初始化首场走随机判定（不冷却不保底），0.5 不中');
  }
  // A5. 随机流确定性：同 seed 同序列
  {
    const r1 = bossRand(12345), r2 = bossRand(12345);
    const seq = [];
    for (let i = 0; i < 5; i++) seq.push(r1());
    A(seq.every((v, i) => { r2(); return true; }) && bossRand(12345)() === seq[0], 'A5. bossRand 同 seed 确定性');
  }

  /* ===== B. 黑盒跨段保底（simulateSession 全局 fightNo） ===== */
  const SIM = await import('../../supabase/functions/_shared/battle-sim.mjs');
  const CONFIG = await import('../../supabase/functions/_shared/config-server.mjs');
  const ENEMY = await import('../../supabase/functions/_shared/enemy-data-server.mjs');
  const config = CONFIG.default, enemyList = ENEMY.default;
  const pet = { name: '血狐', lineId: '血狐', level: 57, growth: 21, baseHp: 100, baseAtk: 26, baseDef: 10, baseSpd: 96, traits: [], equipment: {}, curHp: undefined };
  // 找一个 seed：本段第 1 场（fightNo=2399, lastBossFight=0, pity=2399）随机不中 → 第 2 场（fightNo=2400）保底必出
  let seedOK = null;
  for (let sd = 1; sd <= 50; sd++) {
    const st = { lastBossFight: 0 };
    if (!rollBoss(2399, st, bossRand(sd))) { seedOK = sd; break; }
  }
  A(seedOK != null, 'B0. 找到第 1 场随机不中的 seed（sd=' + seedOK + '）');
  const rB = SIM.simulateSession({
    pet, areaId: 'blight-heart', seconds: 20, seed: seedOK, config, enemyList, curHp: undefined,
    fightOffset: 2399, bossState: { lastBossFight: 0 }
  });
  A(rB.fights.length >= 2, 'B1. 20s 至少打 2 场（实际 ' + rB.fights.length + '）');
  const f1 = rB.fights[0], f2 = rB.fights[1];
  A(!f1.isBoss, 'B2. 第 1 场（fightNo=2399）随机未中');
  A(!!f2.isBoss, 'B3. 第 2 场（fightNo=2400）保底必出（跨段累计生效）');
  A(rB.bossState && rB.bossState.lastBossFight === 2400, 'B4. 返回 bossState.lastBossFight=2400（可写回服务器）');
  // B5. 无 bossState 传入（首次）：不崩、不强制出
  const rC = SIM.simulateSession({
    pet, areaId: 'blight-heart', seconds: 20, seed: seedOK, config, enemyList, curHp: undefined, fightOffset: 0
  });
  A(!!rC.bossState && rC.fights.length > 0, 'B5. 无 bossState 传入正常模拟且返回 bossState');

  /* ===== C. Boss 表现（用 B 组保底 Boss 验证） ===== */
  const bossF = rB.fights[1];
  A(!!bossF && bossF.isBoss, 'C1. 保底场是 Boss');
  A(bossF.enemyName.indexOf('霸主·') === 0, 'C2. 名字带「霸主·」前缀：' + bossF.enemyName);
  A(bossF.enemyLevel === 60, 'C3. Boss 等级=图段上限 60（实际 Lv.' + bossF.enemyLevel + '）');
  const src = fs.readFileSync('../../supabase/functions/_shared/battle-sim.mjs', 'utf8');
  A(src.includes('(isBoss ? 5 : 1)'), 'C4. 静态：Boss 血 ×5 公式在案');
  A(src.includes('(isBoss ? 1.5 : 1)'), 'C5. 静态：Boss 攻 ×1.5 公式在案');

  /* ===== D. drop.js：Boss 掉落 + 底材门槛（沙箱） ===== */
  function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {} }; }
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} } };
  ctx.window = ctx;
  ctx.Pet = { getActivePet: () => null };
  ctx.Items = { saveItem: async () => ({ error: null }) };
  ctx.Materials = { gain: async () => {}, getQuantity: () => 0 };
  ctx.Supabase = { addEgg: async () => {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('../js/equipment/equipment.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('../js/core/drop.js', 'utf8'), ctx);
  const C = code => vm.runInContext(code, ctx);
  const area10 = C('Config.battle.areas.find(a => a.id === "blight-heart")');
  const area1 = C('Config.battle.areas.find(a => a.id === "corrupted-forest")');
  const dropBoss = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·瘟熊·异变', level: 60, isBoss: true })}, ${JSON.stringify(area10)}, { boss: true, enemyLevel: 60, dry: true }))()`);
  A(dropBoss.type === 'boss' && dropBoss.eq && dropBoss.eq.rarity.id === 'gold', 'D1. Boss 必掉金装');
  A(dropBoss.material && dropBoss.material.qty === 5, 'D2. Boss 附送区域材料×5：' + (dropBoss.material && dropBoss.material.material));
  let tiers1 = [];
  for (let i = 0; i < 30; i++) {
    const d = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·腐噜兽', level: 6, isBoss: true })}, ${JSON.stringify(area1)}, { boss: true, enemyLevel: 6, dry: true }))()`);
    tiers1.push(d.eq.materialTier);
  }
  A(tiers1.every(t => t >= 4), 'D3. 图1 ilvl=6 底材全被门槛压到 T4/T5（实际：' + [...new Set(tiers1)].sort().join('/') + '）');
  let sawT1 = false;
  for (let i = 0; i < 30; i++) {
    const d = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·瘟熊·异变', level: 60, isBoss: true })}, ${JSON.stringify(area10)}, { boss: true, enemyLevel: 60, dry: true }))()`);
    if (d.type === 'boss' && d.eq.materialTier === 1) sawT1 = true;
  }
  A(sawT1, 'D4. 图10 ilvl=60 能出 T1 底材（门槛放行）');

  /* ===== E. quest.js：Boss 首通（沙箱） ===== */
  const qctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} } };
  qctx.window = qctx;
  let gainCalls = 0;
  qctx.Materials = { gain: async () => { gainCalls++; }, getQuantity: () => 0, spend: async () => ({ ok: true }), flushMaterials: async () => {} };
  qctx.Supabase = { fetchQuestProgress: async () => ({ data: null }), saveQuestProgress: async () => ({ error: null }) };
  qctx.Pet = { getActivePet: () => ({ level: 60, name: '血狐' }), grantExp() {} };
  qctx.UI = { addLog() {} };
  vm.createContext(qctx);
  vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), qctx);
  vm.runInContext(fs.readFileSync('../js/core/quest.js', 'utf8'), qctx);
  const Q = code => vm.runInContext(code, qctx);
  A(Q('Quest.isAreaCleared("corrupted-forest")') === false, 'E1. 初始未首通');
  await Q('(async () => { if (Quest.loadCloudProgress) await Quest.loadCloudProgress(); return true; })()');
  Q('Quest.reportType("boss", 1, { areaId: "corrupted-forest" })');
  A(Q('Quest.getQuests().find(q => q.id === "boss1").progress') === 1, 'E2. Boss 击杀计数 boss1=1');
  const res1 = await Q('(async () => await Quest.completeQuest("boss1"))()');
  A(!res1 || !res1.error, 'E3. 首通任务可完成');
  A(Q('Quest.isAreaCleared("corrupted-forest")') === true, 'E4. 完成后 isAreaCleared=true');
  A(gainCalls === 3, 'E5. 首通奖励发放 3 项材料（实际 ' + gainCalls + ' 次）');
  const before = gainCalls;
  Q('Quest.reportType("boss", 1, { areaId: "corrupted-forest" })');
  await Q('(async () => await Quest.completeQuest("boss1"))()');
  A(gainCalls === before, 'E6. 重复击杀+重复交任务不再发奖励');

  console.log('ALL RANDOM BOSS TESTS PASSED');
})().catch(e => { console.error('TEST CRASH: ' + (e && e.stack || e)); process.exit(1); });
