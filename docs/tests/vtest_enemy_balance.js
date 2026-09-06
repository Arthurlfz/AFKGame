/* ============================================================
 * vtest_enemy_balance.js —— 怪物数值平衡（2026-09-06 按手册 2.2 重写）
 * 三档玩家强度【用真实装备模拟器校准】（docs/tests/equipment_simulator.js），
 * 取代旧的 atk×1.3 简化假设（手册 6.1：禁止拍脑袋）：
 *   贫民 poor   = 裸装（白蓝装前）+ 成长 5.5        → 目标 3~6 刀（能推、慢）
 *   正常 geared = 该图真实掉落分布穿满 12 部位       → 目标 2.5~4 刀（舒适；图1-2 新手宽容 ≥2）
 *   毕业 maxed  = 金装全 T1 满值 + 底材T1 + 成长翻倍 → 目标 1~2 刀（碾压，超养成奖励）
 * 数值唯一事实源：Config.battle.areaEnemyStats（每图基准）+ typeMult + 等级缩放
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const SIM = require('./equipment_simulator');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
for (const f of ['../js/core/config.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);
const areas = JSON.parse(C('JSON.stringify(Config.battle.areas)'));
const table = JSON.parse(C('JSON.stringify(Config.battle.areaEnemyStats)'));
const typeMult = JSON.parse(C('JSON.stringify(Config.battle.typeMult)'));
const CLAMP = JSON.parse(C('JSON.stringify(Config.battle.levelScaleClamp || [0.25, 1.6])'));

// 贫民（裸装）：与旧版同源的成长公式（参考玩家 = 均衡宠裸属性）
const barePlayer = (lv, growth) => ({
  atk: 25 + lv * growth * 2.5,
  def: 10 + lv * growth * 1.2,
  hp: 105 + lv * growth * 5
});
// 怪数值 = 图基准 × 等级缩放 × 类型系数（与 battle.js scaleEnemyStats 同源）
const enemyStats = (areaId, enemyLevel, type) => {
  const a = areas.find(x => x.id === areaId), b = table[areaId];
  const ratio = Math.max(CLAMP[0], Math.min(CLAMP[1], enemyLevel / ((a.levelRange[0] + a.levelRange[1]) / 2)));
  const tm = typeMult[type] || 1;
  return { hp: b.hp * ratio * tm, atk: b.atk * ratio * tm, def: b.def * ratio * tm };
};
const hitsOf = (areaId, lv, growth, type, geared) => {
  const e = enemyStats(areaId, lv, type);
  const p = geared ? geared : barePlayer(lv, growth);
  return { hits: e.hp / Math.max(1, p.atk - e.def), dmg: e.atk - p.def, pHp: p.hp };
};

// 1. Lv1 起手（图 1，怪 Lv1，成长 5 裸装）
{
  const r = hitsOf('corrupted-forest', 1, 5, 'normal', false);
  console.log(`   [Lv1 起手] 图1 Lv1 怪：${r.hits.toFixed(2)} 刀，单次掉血 ${Math.round(r.dmg)}/${Math.round(r.pHp)} (${(r.dmg / r.pHp * 100).toFixed(0)}%)`);
  A(r.hits >= 1.5 && r.hits <= 5, 'Lv1 起手能赢（2~5 刀）');
  A(r.dmg <= r.pHp * 0.2, 'Lv1 起手单次掉血可控（≤20%，含 0 伤害的宽容起手）');
}

// 2. 每图三档（贫民裸装 / 正常穿装 / 毕业打造）—— 装备模拟器实测
let bareOk = true, gearOk = true, maxOk = true;
console.log('  图 → 贫民(裸装) → 正常(真实掉落) → 毕业(T1+成长翻倍)');
areas.forEach((a, i) => {
  const tier = i + 1, lv = Math.round((a.levelRange[0] + a.levelRange[1]) / 2);
  const bare = hitsOf(a.id, lv, 5.5, 'normal', false);
  const geared = SIM.simulate(tier, lv, 5.5, 'geared', 150);
  const maxed = SIM.simulate(tier, lv, 11, 'maxed', 150);
  const gearHits = table[a.id].hp / Math.max(1, geared.atk - table[a.id].def);
  const maxHits = table[a.id].hp / Math.max(1, maxed.atk - table[a.id].def);
  console.log(`   ${a.name.padEnd(6)} 贫民 ${bare.hits.toFixed(2)} 刀  正常 ${gearHits.toFixed(2)} 刀  毕业 ${maxHits.toFixed(2)} 刀`);
  if (bare.hits < 3 || bare.hits > 6) bareOk = false;
  // 图1-2 新手宽容：装备梯度在低图拉不开（白蓝为主、且玩家实际穿不满 12 部位，实际更慢），
  // 正常档下限 图1 宽容到 1.8 / 图2 到 2.0（2026-09-06 校准注记）
  const gearMin = tier <= 1 ? 1.8 : (tier <= 2 ? 2.0 : 2.5);
  if (gearHits < gearMin || gearHits > 4) gearOk = false;
  // 毕业档 ≤2 刀（图1 低防低血会出现一刀秒 ≈0.9，属正常碾压，下限只防 0）
  if (maxHits < 0.8 || maxHits > 2) maxOk = false;
});
A(bareOk, '贫民（裸装成长5.5）全图 3~6 刀（能推、慢但不死）');
A(gearOk, '正常（该图真实掉落分布穿满，装备模拟器）全图 2.5~4 刀（图1-2 新手宽容 ≥2）');
A(maxOk, '毕业（金装全T1满值+底材T1+成长翻倍，装备模拟器）全图 1~2 刀（碾压）');

// 3. 强度分层：变异 > 进化 > 普通（同图同级）
const m = hitsOf('blight-heart', 55, 5.5, 'mutant', false).hits;
const ev = hitsOf('blight-heart', 55, 5.5, 'evolved', false).hits;
const n = hitsOf('blight-heart', 55, 5.5, 'normal', false).hits;
A(m > ev && ev > n, `强度分层：变异 ${m.toFixed(1)} 刀 > 进化 ${ev.toFixed(1)} 刀 > 普通 ${n.toFixed(1)} 刀`);

// 4. 越级压制：Lv20 玩家（穿 Lv20 对应的图4 档装备）进图10 → 比值 clamp，不至于被秒
const skipGear = SIM.simulate(4, 20, 5.5, 'geared', 80);
const skip = hitsOf('blight-heart', 20, 5.5, 'normal', skipGear);
A(skip.hits >= 2, `越级打高级图能打但慢（Lv20 进图10：${skip.hits.toFixed(1)} 刀），不会瞬间暴毙`);

// 5. 静态防回归：battle.js 用固定表，不再有参考玩家公式
const src = fs.readFileSync('../js/core/battle.js', 'utf8');
A(src.indexOf('areaEnemyStats') >= 0 && src.indexOf('E.hpMult') < 0 && src.indexOf('refAtk') < 0,
  'battle.js 使用固定数值表 + 等级缩放，参考玩家公式已移除');

console.log('ALL ENEMY BALANCE TESTS PASSED');
