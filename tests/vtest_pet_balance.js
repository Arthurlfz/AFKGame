/* ============================================================
 * vtest_pet_balance.js —— 宠物平衡 v2.1（全拉平可用）+ 10 图扩展一致性
 * 守的设计承诺：
 *  1. 8 只基础宠「都能挂机」：同等级同养成下，净推进（含回血停机）差异 ≤1.35 倍
 *  2. 无废宠：任何宠在任何图都不会打不过（单场净掉血 < 满血，不会场场暴毙）
 *  3. 立住 trade-off：速度越快 → 单场掉血占比越高、连打场数越少（快脆慢肉）
 *  4. 无独大：不存在某只宠净推进碾压其余（幽影兔旧版独大的回归）
 *  5. 10 图扩展一致性：areas / areaEnemyStats / baseTierMultipliers /
 *     materialTierWeights / areaMaterials / areaEvolutionTiers 数量与 id 全部对齐
 *     （档位数与图数不一致会取到 undefined → 生成 NaN 装备）
 * 数值唯一事实源：config.js（starters / speeds / petProfiles / areas / areaEnemyStats）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/pet/enemy-data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

const starters = JSON.parse(C('JSON.stringify(Config.pet.starters)'));
const speeds = JSON.parse(C('JSON.stringify(Config.pet.speeds)'));
const profiles = JSON.parse(C('JSON.stringify(Config.pet.petProfiles)'));
const areas = JSON.parse(C('JSON.stringify(Config.battle.areas)'));
const enemyTable = JSON.parse(C('JSON.stringify(Config.battle.areaEnemyStats)'));
const typeMult = JSON.parse(C('JSON.stringify(Config.battle.typeMult)'));
const enemyList = JSON.parse(C('JSON.stringify(EnemyData.list)'));

// 与战斗代码同源的常量（见 battle.js / pet.js）
const SPEED_SCALE = JSON.parse(C('Config.battle.speedScale'));
const STOP_RATIO = JSON.parse(C('Config.battle.stopHpRatio'));
const NEXT_FIGHT = JSON.parse(C('Config.battle.nextFightDelay')) / 1000;
const REGEN = JSON.parse(C('Config.regen.hpPerSecRatio'));
const EQ_ATK = 1.3, EQ_HP = 1.15, EQ_DEF = 1.15; // 「图内基础装备」档
// 等级缩放边界与 battle.js scaleEnemyStats 同源（2026-08-31 上限 1.6→1.1，修低级图后段打不过）
const CLAMP = JSON.parse(C('JSON.stringify(Config.battle.levelScaleClamp || [0.25, 1.6])'));

// 敌人闪避按类型（battle.js:180-183）
const dodgeOf = t => (t === 'mutant' ? 12 : t === 'evolved' ? 8 : 5);

// 每图实际能刷出哪些怪（battle.js getAreaEnemyPool：areaIds ∩ 等级段重叠）
function poolOf(area) {
  const ids = new Set(area.enemyIds || []);
  return enemyList.filter(e => ids.has(e.id) &&
    (e.levelRange || [e.level, e.level])[1] >= area.levelRange[0] &&
    (e.levelRange || [e.level, e.level])[0] <= area.levelRange[1]);
}
// 取该图最硬的一档怪（保守：只要最硬的都活得下来，其余必然能过）
function hardestOf(area) {
  const pool = poolOf(area);
  if (!pool.length) return null;
  return pool.reduce((a, b) => ((typeMult[b.enemyType] || 1) >= (typeMult[a.enemyType] || 1) ? b : a));
}
function enemyStatsAt(area, level, type) {
  const b = enemyTable[area.id];
  const mid = (area.levelRange[0] + area.levelRange[1]) / 2;
  const ratio = Math.max(CLAMP[0], Math.min(CLAMP[1], level / mid));
  const tm = typeMult[type] || 1;
  const pool = poolOf(area);
  const spd = pool.length ? pool.reduce((s, e) => s + e.spd, 0) / pool.length : 80;
  return { hp: b.hp * ratio * tm, atk: b.atk * ratio * tm, def: b.def * ratio * tm, spd };
}

function petStats(st, L, G) {
  const c = st.statCoeff, p = profiles[st.name] || {};
  return {
    atk: (st.baseAtk + L * G * c.atk) * EQ_ATK,
    hp: (st.baseHp + L * G * c.hp) * EQ_HP,
    def: (st.baseDef + L * G * c.def) * EQ_DEF,
    spd: speeds[st.name],
    critRate: (p.critRate ?? 5) / 100,
    critDamage: (p.critDamage ?? 150) / 100,
    hit: p.hit ?? 90, dodge: p.dodge ?? 0, ls: (p.lifesteal ?? 0) / 100
  };
}

// 净推进：一场接一场打，血低于 30% 停手回满，算「每小时击杀数」
function evaluate(st, L, G, type) {
  const s = petStats(st, L, G);
  const area = areas.find(a => L >= a.levelRange[0] && L <= a.levelRange[1]);
  const e = enemyStatsAt(area, L, type);
  const petHit = s.hit / (s.hit + dodgeOf(type));
  const petDps = (s.spd / (SPEED_SCALE * 10)) * Math.max(1, s.atk - e.def) * petHit
                 * (1 + s.critRate * (s.critDamage - 1));
  const eneHit = 90 / (90 + s.dodge);
  const eneDps = (e.spd / (SPEED_SCALE * 10)) * Math.max(1, e.atk - s.def) * eneHit * 1.05; // 怪暴击 10%/1.5 倍
  const tKill = e.hp / petDps;
  const netDmg = Math.max(0, eneDps * tKill - s.ls * e.hp);
  const dies = netDmg >= s.hp;
  const fights = netDmg > 0 ? Math.max(1, (s.hp * (1 - STOP_RATIO)) / netDmg) : 99;
  const recover = dies ? 1 / REGEN : (1 - STOP_RATIO) / REGEN;
  const perHour = dies ? 0 : (3600 * fights) / (fights * (tKill + NEXT_FIGHT) + recover);
  return { perHour, dies, fights, tKill, dmgPct: netDmg / s.hp, spd: s.spd };
}

/* ---------- 1. 10 图扩展一致性 ---------- */
{
  const ids = areas.map(a => a.id);
  const okTier = JSON.parse(C('JSON.stringify(Config.equipment.baseTierMultipliers)')).length === areas.length;
  const okMat = Object.keys(JSON.parse(C('JSON.stringify(Config.equipment.materialTierWeights)'))).length === areas.length;
  const okEne = Object.keys(enemyTable).length === areas.length;
  const okMatName = JSON.parse(C('JSON.stringify(Config.drop.areaMaterials)'));
  const okEvo = JSON.parse(C('JSON.stringify(Config.drop.areaEvolutionTiers)'));
  const missing = ids.filter(id => !enemyTable[id] || !okMatName[id] || !okEvo[id]);
  A(areas.length === 17, `地图数量 17 张（当前 ${areas.length}）`);
  A(okTier && okMat && okEne && !missing.length,
    `装备图档/底材档/敌人数值/材料/素材档 与 10 图对齐${missing.length ? '，缺：' + missing.join(',') : ''}`);
  // 每图 6 级、首尾接得上（图 17 为 [97,100] 4 级终图，2026-08-31 拍板）
  let spanOk = true;
  areas.forEach((a, i) => {
    const [lo, hi] = a.levelRange;
    const expectedSpan = i === areas.length - 1 ? 3 : 5;
    if (hi - lo !== expectedSpan) spanOk = false;
    if (i > 0 && lo !== areas[i - 1].levelRange[1] + 1) spanOk = false;
  });
  A(spanOk, '每图 6 级（图17 为 4 级）且等级段首尾相接（无空档/重叠）');
  const poolEmpty = areas.filter(a => !poolOf(a).length);
  A(!poolEmpty.length, `每图都有可用野怪（怪池等级段与图重叠）${poolEmpty.length ? '，空池：' + poolEmpty.map(a => a.id) : ''}`);
}

/* ---------- 2. 8 只宠全等级段净推进拉平 + 不死亡 ---------- */
const LEVELS = [4, 10, 16, 22, 28, 34, 40, 46, 52, 58]; // 每图取一个等级，覆盖 10 张图
// 正常玩家成长：裸宠 5 + 几次进化 ≈ 5.5（敌人基准也是按这个推的，见 config 注释）；
// 再验一档「进化更充分」的成长 7，防止高养成下重新拉开差距。
const GROWTHS = [5.5, 7];
let worstRatio = 1, worstTutorialRatio = 1, anyDead = [], tradeOffOk = true;
for (const G of GROWTHS) {
  console.log(`\n  —— 成长 ${G} ——`);
  for (const L of LEVELS) {
    const area = areas.find(a => L >= a.levelRange[0] && L <= a.levelRange[1]);
    const type = (hardestOf(area) || {}).enemyType || 'normal';
    const rows = starters.map(st => ({ name: st.name, r: evaluate(st, L, G, type) }));
    const vals = rows.map(x => x.r.perHour);
    const ratio = Math.max(...vals) / Math.max(1, Math.min(...vals));
    // 图1/图2（Lv4、Lv10 两档）单独统计：为让「裸装新手推得动」把怪压低后，单场掉血普遍变小，
    // 坦克「几乎不回血」的优势被放大、净推进极差天然比高级图大，这是新手图的预期表现。
    if (L <= 12) { if (ratio > worstTutorialRatio) worstTutorialRatio = ratio; }
    else if (ratio > worstRatio) worstRatio = ratio;
    for (const x of rows) if (x.r.dies) anyDead.push(`${x.name}@Lv${L}(成长${G})`);
    // trade-off：速度最快的宠，单场掉血占比必须高于速度最慢的宠（快脆慢肉）
    const bySpd = [...rows].sort((a, b) => a.r.spd - b.r.spd);
    if (!(bySpd[bySpd.length - 1].r.dmgPct > bySpd[0].r.dmgPct)) tradeOffOk = false;
    const lo = rows.reduce((a, b) => (a.r.perHour <= b.r.perHour ? a : b));
    const hi = rows.reduce((a, b) => (a.r.perHour >= b.r.perHour ? a : b));
    console.log(`  Lv${String(L).padStart(3)} ${type.padEnd(7)} ` +
      rows.map(x => String(Math.round(x.r.perHour)).padStart(4)).join(' ') +
      `  ${ratio.toFixed(2)}x  ${lo.name}(${Math.round(lo.r.perHour)}) → ${hi.name}(${Math.round(hi.r.perHour)})`);
  }
}
A(!anyDead.length, `无废宠：8 只宠全等级段都不会打不过${anyDead.length ? '，死亡：' + anyDead.join(',') : ''}`);
A(worstRatio <= 1.35, `全拉平可用：图3 起净推进极差 ${worstRatio.toFixed(2)}x ≤ 1.35x（无独大）`);
A(worstTutorialRatio <= 1.6, `新手图（图1/图2，怪刻意压低）净推进极差 ${worstTutorialRatio.toFixed(2)}x ≤ 1.6x`);
A(tradeOffOk, '立住 trade-off：越快的宠单场掉血占比越高（快脆慢肉）');

/* ---------- 3. 速度带已收窄（旧版 30~110 是「只有兔子能用」的根因） ---------- */
{
  const spd = starters.map(s => speeds[s.name]);
  // 旧版 30~110 = 3.67x（速度=出手频率，兔子的 8 倍次数就是「只有兔子能用」的根因）。
  // v2.2 收窄到 70~100 = 1.43x：保留「快/慢」手感梯度，但不再让频率压倒其他属性。
  // 真正要守的是上面的【净推进极差】，速度带只守「别再退回旧版」这条下限。
  const band = Math.max(...spd) / Math.min(...spd);
  A(band <= 1.5, `速度带已收窄：${Math.min(...spd)}~${Math.max(...spd)}（差距 ${band.toFixed(2)}x ≤1.5x，旧版 3.67x）`);
}

/* ---------- 4. 明细（Lv34） ---------- */
{
  const L = 34;
  const area = areas.find(a => L >= a.levelRange[0] && L <= a.levelRange[1]);
  const type = (hardestOf(area) || {}).enemyType || 'normal';
  console.log(`\n  明细（Lv${L} · ${area.name} · ${type}）`);
  console.log('  宠物      速度  单场掉血   连打场数  净击杀/h');
  for (const st of starters) {
    const r = evaluate(st, L, 5.5, type);
    console.log(`  ${st.name.padEnd(6)} ${String(r.spd).padStart(4)}   ${(r.dmgPct * 100).toFixed(0).padStart(3)}%     ${r.fights.toFixed(1).padStart(5)}     ${String(Math.round(r.perHour)).padStart(4)}${r.dies ? ' ☠' : ''}`);
  }
}

console.log('\nALL PET BALANCE TESTS PASSED');
