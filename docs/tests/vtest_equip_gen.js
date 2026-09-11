/* ============================================================
 * vtest_equip_gen.js —— 前端装备生成 与 服务端抽取副本 的行为等价守护
 *
 * 背景（2026-09-11 甲）：挂机结算在服务端，掉落装备要由服务端生成。
 * 生成逻辑仍只在 docs/js/equipment/equipment.js 里维护，服务端那份由
 * supabase/gen_equip_gen.js 【构建期抽取】（不是手抄 —— 战核就是手抄才漂的）。
 * 这个测试守的就是"抽取出来的那份和前端行为一致"。
 *
 * 做法：同一套确定性随机序列喂两边，比对整件装备（除 id 外逐字段相等）。
 * 抽取的手法见 gen_equip_gen.js：常量取求值结果、函数取源码原文、Util 取源码原文、
 * 用 Object.create(Math) 遮蔽随机源。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/core/config.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/equipment/equipment.js'), 'utf8'), ctx);

const A = (ok, m) => { if (!ok) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };

// 确定性随机序列（LCG）：两边喂同一串
function seqRnd(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

(async () => {
  const { default: serverCfg } = await import('../../supabase/functions/_shared/config-server.mjs');
  const { makeEquipGen } = await import('../../supabase/functions/_shared/equip-gen-server.mjs');

  A(!!(serverCfg && serverCfg.equipment), 'config-server.mjs 带上了 equipment 段（gen_server_config.js 白名单已加）');

  // vm 的内建 Math 不在外层 ctx 对象上，必须进 context 里换随机源
  function runFront(seed, at, ilvl, cb) {
    ctx.__rnd = seqRnd(seed);
    vm.runInContext('globalThis.__origRandom = Math.random; Math.random = globalThis.__rnd;', ctx);
    try {
      return vm.runInContext(
        `window.Equipment.generateEquipment(null, ${at}, 0, ${ilvl == null ? 'null' : ilvl}, ${cb})`, ctx);
    } finally {
      vm.runInContext('Math.random = globalThis.__origRandom;', ctx);
    }
  }
  function runServer(seed, at, ilvl, cb) {
    const gen = makeEquipGen(serverCfg.equipment, seqRnd(seed));
    return gen.generateEquipment(null, at, 0, ilvl, cb);
  }
  const norm = eq => {
    const o = Object.assign({}, eq);
    delete o.id;          // 本地自增 id（两边各自计数），不参与比对
    delete o.fresh;
    return JSON.stringify(o);
  };

  // 边界覆盖：T 阶门槛 70/60/25/1、图档 1/5/10、词缀条数档位、countBonus
  const ILVLS = [1, 10, 24, 25, 30, 59, 60, 69, 70, 85, 100, null];
  const AREAS = [1, 5, 10];
  const BONUS = [0, 1];
  const SEEDS = [1, 7, 99, 12345, 777777];

  let n = 0, bad = [];
  for (const at of AREAS) for (const ilvl of ILVLS) for (const cb of BONUS) for (const seed of SEEDS) {
    const f = runFront(seed, at, ilvl, cb);
    const s = runServer(seed, at, ilvl, cb);
    n++;
    if (norm(f) !== norm(s)) {
      bad.push(`areaTier=${at} ilvl=${ilvl} countBonus=${cb} seed=${seed}\n      前端 ${norm(f).slice(0, 220)}\n      服务端 ${norm(s).slice(0, 220)}`);
    }
    if (bad.length >= 3) break;
  }
  A(bad.length === 0,
    bad.length === 0
      ? `A. 服务端抽取副本与前端生成完全等价（${n} 组输入 × 同随机序列，整件装备逐字段相等）`
      : '装备生成漂移（前端与服务端副本产出不同）→\n      ' + bad.join('\n      '));

  // B. 结构完整性：服务端产出必须能直接喂给 equip_items 的 insert（Items.saveItem 用的字段）
  const eq = runServer(20260911, 3, 45, 0);
  const need = ['name', 'slot', 'base', 'affixes', 'tier', 'rarity'];
  const miss = need.filter(k => eq[k] === undefined);
  A(miss.length === 0, `B. 服务端产出含入库所需字段（${need.join('/')}）${miss.length ? ' 缺：' + miss.join(',') : ''}`);
  A(Array.isArray(eq.affixes.prefix) && Array.isArray(eq.affixes.suffix), 'B2. affixes 是 {prefix:[],suffix:[]} 结构（可直接写入 jsonb 列）');
  A(typeof eq.rarity.id === 'string' && !!eq.rarity.color, 'B3. rarity 带 id/color（equip_items.rarity 列需要颜色 id）');

  /* ============ C. 掉落分布（2026-09-11 甲的行为证据）============
   * 修复前：服务端硬编码「18% 材料、永不掉装备/蛋」——
   *        线上 70742 场明细里 equipment / egg 各 0 次。
   * 现在：走 config.drop 的单池，四种结果都该出现，且比例贴近配置。 */
  const { rewardForFight } = await import('../../supabase/functions/_shared/settle-core.mjs');
  const { default: enemyList } = await import('../../supabase/functions/_shared/enemy-data-server.mjs');
  const enemy = enemyList.find(e => e.eggBaseName) || enemyList[0];
  A(!!(enemy && enemy.eggBaseName), `用真实怪做样本（${enemy && enemy.name} → 蛋品种 ${enemy && enemy.eggBaseName}）`);

  const gen = rnd => makeEquipGen(serverCfg.equipment, rnd);
  const areaId = serverCfg.battle.areas[0].id;   // 图1 → 阶段1 池
  const N = 20000;
  const cnt = { none: 0, material: 0, equipment: 0, egg: 0 };
  let firstEq = null;
  for (let i = 0; i < N; i++) {
    const r = rewardForFight({ win: true, enemyLevel: 30, enemy, isBoss: false }, areaId, 12345, i, serverCfg, gen);
    cnt[r.type] = (cnt[r.type] || 0) + 1;
    if (r.type === 'equipment' && !firstEq) firstEq = r.eq;
  }
  A(cnt.equipment > 0, `C1. 会掉装备了（${N} 场里 ${cnt.equipment} 件，修复前恒为 0）`);
  A(cnt.egg > 0, `C2. 会掉蛋了（${N} 场里 ${cnt.egg} 颗，修复前恒为 0）`);
  A(cnt.material > 0, `C3. 材料仍在掉（${cnt.material} 次）`);

  const pool = serverCfg.drop.poolByStage[1];
  const tot = pool.none + pool.material + pool.equipment + pool.egg;
  const pct = (k, c) => Math.round(c / N * 1000) / 10;
  const expPct = k => Math.round(pool[k] / tot * 1000) / 10;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.4, b * 0.35);   // 抽样容差
  A(near(pct('equipment', cnt.equipment), expPct('equipment')) && near(pct('egg', cnt.egg), expPct('egg')),
    `C4. 比例贴近 config.drop.poolByStage[1]（装备 ${pct('equipment', cnt.equipment)}% vs 期望 ${expPct('equipment')}% ；`
    + `蛋 ${pct('egg', cnt.egg)}% vs 期望 ${expPct('egg')}% ；材料 ${pct('material', cnt.material)}% vs 期望 ${expPct('material')}%）`);

  A(!!(firstEq && firstEq.identified === false), 'C5. 掉落的装备是【未鉴定】状态（与前端一致，背包里灰框待鉴定）');
  A(!!(firstEq && firstEq.rarity && firstEq.rarity.id), 'C6. 掉落的装备带 rarity.id（equip_items.rarity 列用）');
  /* ⚠️ 这条专治一个已经犯过的错：事件字段是 enemyLevel，映射后的战报才叫 lv。
   * 写成 fight.lv 会永远拿到 1 → 掉的装备全是最低档（T4/T5），等于没掉，
   * 而且因为测试也照抄了 lv，两边一起错、谁也没发现。这里直接锁死 ilvl == 怪等级。 */
  A(!!(firstEq && Number(firstEq.ilvl) === 30),
    `C6b. 装备 ilvl 必须等于击杀怪等级（实得 ${firstEq && firstEq.ilvl} / 期望 30）—— 读到 1 就是字段写成 lv 了`);

  // 确定性：同一个 (seed, areaId, index) 必须永远产出同一件
  const a1 = rewardForFight({ win: true, enemyLevel: 30, enemy, isBoss: false }, areaId, 42, 7, serverCfg, gen);
  const a2 = rewardForFight({ win: true, enemyLevel: 30, enemy, isBoss: false }, areaId, 42, 7, serverCfg, gen);
  A(JSON.stringify(a1) === JSON.stringify(a2), 'C7. 同游标可重放（确定性保持，服务器可对账）');

  /* ============ D. Boss 掉落（2026-09-11 对齐前端 drop.js）============
   * 前端：必掉一件未鉴定装备 + 本图区域材料×5 + 百变魔石 10% / 至尊神石 5%。
   * 服务端以前只给「材料×5」，Boss 打完不掉装备 —— 与前端不一致。 */
  const b = rewardForFight({ win: true, enemyLevel: 55, enemy, isBoss: true }, areaId, 999, 3, serverCfg, gen);
  A(b.type === 'boss', `D1. Boss 战走 boss 分支（实得 ${b.type}，修复前是 material）`);
  A(!!(b.eq && b.eq.identified === false), 'D2. Boss 必掉一件【未鉴定】装备');
  A(!!(b.material && Number(b.material.qty) === 5), 'D3. Boss 给本图区域材料 ×5');
  A(!!(b.eq && Number(b.eq.ilvl) === 55), `D4. Boss 装备 ilvl = Boss 等级（实得 ${b.eq && b.eq.ilvl} / 期望 55）`);
  const bAll = [];
  for (let i = 0; i < 2000; i++) bAll.push(rewardForFight({ win: true, enemyLevel: 55, enemy, isBoss: true }, areaId, 7, i, serverCfg, gen));
  const withShift = bAll.filter(r => (r.bossItems || []).some(x => x.name === '百变魔石')).length;
  const withSup = bAll.filter(r => (r.bossItems || []).some(x => x.name === '至尊神石')).length;
  A(Math.abs(withShift / 2000 - 0.10) < 0.03 && Math.abs(withSup / 2000 - 0.05) < 0.02,
    `D5. 稀有道具骰比例贴近前端（百变魔石 ${Math.round(withShift / 20)}% vs 10% ；至尊神石 ${Math.round(withSup / 20)}% vs 5%）`);

  console.log('ALL EQUIP GEN TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
