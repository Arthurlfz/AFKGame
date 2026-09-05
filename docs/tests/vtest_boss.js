/* ============================================================
 * vtest_boss.js —— 2026-09-05 地图系统·守关 Boss 验收
 * 验证：
 *   A. 服务器版 battle-sim：第 100 场出 Boss / 等级=图段上限 / 名字「霸主·」/ 跨段累计
 *   B. Boss 数值在案：血 ×5、攻 ×1.5（静态公式 + 行为：Boss 场耗时更长）
 *   C. drop.js：Boss 必掉金装 + 区域材料×5；底材 ilvl 门槛（低图出不了顶级底材）
 *   D. quest.js：Boss 击杀计数 → 首通任务完成 → isAreaCleared；首通只发一次
 * 跑法：node vtest_boss.js（服务器版 battle-sim 走 supabase/_shared）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

(async () => {
  /* ===== A/B. 服务器版 battle-sim Boss 模拟 ===== */
  const SIM = await import('../../supabase/functions/_shared/battle-sim.mjs');
  const CONFIG = await import('../../supabase/functions/_shared/config-server.mjs');
  const ENEMY = await import('../../supabase/functions/_shared/enemy-data-server.mjs');
  const config = CONFIG.default, enemyList = ENEMY.default;
  const pet = { name: '血狐', lineId: '血狐', level: 57, growth: 21, baseHp: 100, baseAtk: 26, baseDef: 10, baseSpd: 96, traits: [], equipment: {}, curHp: undefined };

  const r = SIM.simulateSession({ pet, areaId: 'blight-heart', seconds: 700, seed: 123, config, enemyList, curHp: undefined, fightOffset: 0 });
  A(r.fights.length >= 100, 'A1. 图10 700s 模拟 ≥100 场（实际 ' + r.fights.length + ' 场）');
  const boss = r.fights[99];
  A(!!boss && boss.isBoss, 'A2. 第 100 场是 Boss');
  A(boss.enemyName.indexOf('霸主·') === 0, 'A3. Boss 名字带「霸主·」前缀：' + boss.enemyName);
  A(boss.enemyLevel === 60, 'A4. Boss 等级=图段上限 60（实际 Lv.' + boss.enemyLevel + '）');

  const r2 = SIM.simulateSession({ pet, areaId: 'blight-heart', seconds: 60, seed: 999, config, enemyList, curHp: undefined, fightOffset: 90 });
  const b2 = r2.fights.find(f => f.isBoss);
  A(!!b2, 'A5. fightOffset=90 时本段内出 Boss（跨段累计锚点正确）');

  // 剧本版（前端专用 simulateSessionScript）：Boss 场耗时对比
  const FE = await import('../../docs/js/core/battle-sim.mjs');
  const sc = FE.simulateSessionScript({ pet, areaId: 'blight-heart', seconds: 700, seed: 123, config, enemyList, curHp: undefined, fightOffset: 0 });
  const eBoss = sc.events.find(e => e.isBoss);
  const eNorm = sc.events.find(e => !e.isBoss);
  A(!!eBoss && !!eNorm, 'B1. 剧本含 Boss 场与普通场');
  A(eBoss.durationMs > eNorm.durationMs, 'B2. Boss 场耗时更长（血×5 攻×1.5 行为验证）：Boss ' + eBoss.durationMs + 'ms vs 普通 ' + eNorm.durationMs + 'ms');
  const src = fs.readFileSync('../../supabase/functions/_shared/battle-sim.mjs', 'utf8');
  A(src.includes('(isBoss ? 5 : 1)'), 'B3. 静态：Boss 血 ×5 公式在案');
  A(src.includes('(isBoss ? 1.5 : 1)'), 'B4. 静态：Boss 攻 ×1.5 公式在案');

  /* ===== C. drop.js：Boss 掉落 + 底材门槛（沙箱） ===== */
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

  // C1. Boss 必掉金装 + 区域材料×5
  const foe = { name: '霸主·瘟熊·异变', level: 60, isBoss: true };
  const area10 = C('Config.battle.areas.find(a => a.id === "blight-heart")');
  const dropBoss = await C(`(async () => await Drop.rollReward(${JSON.stringify(foe)}, ${JSON.stringify(area10)}, { boss: true, enemyLevel: 60, dry: true }))()`);
  A(dropBoss.type === 'boss', 'C1. Boss 掉落 type=boss');
  A(dropBoss.eq && dropBoss.eq.rarity && dropBoss.eq.rarity.id === 'gold', 'C2. Boss 必掉金装');
  A(dropBoss.material && dropBoss.material.qty === 5, 'C3. Boss 附送区域材料×5：' + (dropBoss.material && dropBoss.material.material));

  // C4. 底材 ilvl 门槛：图1 Boss（等级 6）多次掉落，底材全被门槛压到 T4/T5（T1≥55/T2≥40/T3≥25）
  const area1 = C('Config.battle.areas.find(a => a.id === "corrupted-forest")');
  let tiers1 = [];
  for (let i = 0; i < 30; i++) {
    const d = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·腐噜兽', level: 6, isBoss: true })}, ${JSON.stringify(area1)}, { boss: true, enemyLevel: 6, dry: true }))()`);
    tiers1.push(d.eq.materialTier);
  }
  A(tiers1.every(t => t >= 4), 'C4. 图1 ilvl=6 底材全被门槛压到 T4/T5（实际：' + [...new Set(tiers1)].sort().join('/') + '）');
  const boss1 = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·腐噜兽', level: 6, isBoss: true })}, ${JSON.stringify(area1)}, { boss: true, enemyLevel: 6, dry: true }))()`);
  A(boss1.eq.materialTier >= 4, 'C6. 图1 Boss（等级 6）也出不了顶级底材：T' + boss1.eq.materialTier);
  // C7. 图10 ilvl=60 门槛放行 → 能出 T1 底材
  let sawT1 = false;
  for (let i = 0; i < 30; i++) {
    const d = await C(`(async () => await Drop.rollReward(${JSON.stringify({ name: '霸主·瘟熊·异变', level: 60, isBoss: true })}, ${JSON.stringify(area10)}, { boss: true, enemyLevel: 60, dry: true }))()`);
    if (d.type === 'boss' && d.eq.materialTier === 1) sawT1 = true;
  }
  A(sawT1, 'C7. 图10 ilvl=60 能出 T1 底材（门槛放行）');

  /* ===== D. quest.js：Boss 首通（沙箱） ===== */
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

  A(Q('Quest.isAreaCleared("corrupted-forest")') === false, 'D1. 初始未首通');
  // 等云端进度加载完成（cloudLoaded 闸门），否则 completeQuest 会拒绝
  await Q('(async () => { if (Quest.loadCloudProgress) await Quest.loadCloudProgress(); return true; })()');
  Q('Quest.reportType("boss", 1, { areaId: "corrupted-forest" })');
  const prog = Q('Quest.getQuests().find(q => q.id === "boss1").progress');
  A(prog === 1, 'D2. Boss 击杀计数 boss1=1');
  const res1 = await Q('(async () => await Quest.completeQuest("boss1"))()');
  A(!res1 || !res1.error, 'D3. 首通任务可完成');
  A(Q('Quest.isAreaCleared("corrupted-forest")') === true, 'D4. 完成后 isAreaCleared=true（首通标记）');
  A(gainCalls === 3, 'D5. 首通奖励发放 3 项材料（区域材料×20+重铸石×3+进化素材×3）：实际 ' + gainCalls + ' 次');
  // D6. 首通只发一次：再次击杀/再次交任务不再发奖励
  const before = gainCalls;
  Q('Quest.reportType("boss", 1, { areaId: "corrupted-forest" })');
  const res2 = await Q('(async () => await Quest.completeQuest("boss1"))()');
  A(gainCalls === before, 'D6. 重复击杀+重复交任务不再发奖励（completed 挡板生效）');
  console.log('ALL BOSS TESTS PASSED');
})().catch(e => { console.error('TEST CRASH: ' + (e && e.stack || e)); process.exit(1); });
