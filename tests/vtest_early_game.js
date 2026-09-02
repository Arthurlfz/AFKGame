/* ============================================================
 * vtest_early_game.js —— 新手期必须「推得动」
 * 背景（2026-08-31）：等级缩放 ratio = 怪等级 / 图中点，图1 是 [1,6]、中点 3.5，
 *   段内跨度达 5.6 倍（Lv1=0.29 倍 ↔ Lv6=1.6 倍），而玩家 1→6 级属性只涨约 1.9~2.7 倍
 *   （属性公式有 base 常数，低级时 base 占比大，涨得比等级慢）。
 *   结果：图1 后半段（Lv4~6）怪比玩家涨得快，裸装新手场场残血甚至战败 —— 观感就是「打不过」。
 *   高级图不受影响（图10 [55,60] 段内跨度仅 1.09 倍），所以这是【低级图专属】问题。
 * 守的承诺（图1、图2 两张新手图，覆盖 Lv1~12）：
 *  1. 8 只宠裸装单场不会稳定打不过（胜率 ≥99.5%）
 *  2. 单场剩余血量 ≥25%（打完不至于场场回血，"推得动"而不是"磨过去"）
 *  3. 单场耗时 ≤20 秒（挂机节奏不拖沓）
 * 养成假设（保守，比真实玩家更弱）：图1 裸装成长 5（开局），图2 裸装成长 5.2（进化一次）。
 * 数值唯一事实源：config.js（starters / areaEnemyStats / levelScaleClamp）
 * 战斗循环与 battle.js tick 同源（100ms 一跳、速度/12、减法伤害、命中/暴击/吸血）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
function el() {
  return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {},
    querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0 };
}
const ctx = { console, Math, Date, setTimeout, clearTimeout, setInterval, clearInterval, JSON, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/pet/enemy-data.js', '../js/equipment/equipment.js', '../js/pet/pet.js'])
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

const RUNS = 400; // 每宠 × 每级 × 每怪的模拟场数（含命中/暴击随机）
// 新手期两张图的养成假设：[图1 = 开局成长 5，图2 = 进化一次后 5.2]
const GROWTH = [5, 5.2];

const result = C(`(function () {
  const CLAMP = Config.battle.levelScaleClamp || [0.25, 1.6];
  const dodgeOf = t => (t === 'mutant' ? 12 : t === 'evolved' ? 8 : 5);

  // 与 battle.js calcDamage 同源：命中 → 减法 → 暴击 → 吸血
  function hitOf(att, defStats) {
    const hit = Math.max(0, att.hit || 0), dodge = Math.max(0, defStats.dodge || 0);
    const chance = hit + dodge > 0 ? Math.max(0.05, Math.min(0.95, hit / (hit + dodge))) : 0.05;
    if (Math.random() >= chance) return 0;
    let d = Math.max(1, att.atk - defStats.def);
    if (Math.random() < (att.critRate == null ? 0.1 : att.critRate)) d = Math.floor(d * (att.critDamage == null ? 1.5 : att.critDamage));
    return d;
  }
  // 与 battle.js tick 同源：每跳 100ms 累加 速度/speedScale，满 100 出手
  function fight(p, e) {
    const scale = Config.battle.speedScale || 12;
    let petHp = p.hp, eHp = e.hp, pa = 0, ea = 0, t = 0;
    while (petHp > 0 && eHp > 0 && t < 10000) { // 10000 跳 = 1000 秒，兜底防死循环
      t++;
      pa += p.spd / scale; ea += e.spd / scale;
      if (pa >= 100) { pa -= 100; const d = hitOf(p, e); eHp -= d; if (p.lifesteal > 0) petHp = Math.min(p.hp, petHp + Math.floor(d * p.lifesteal)); }
      if (eHp <= 0) break;
      if (ea >= 100) { ea -= 100; const d = hitOf(e, p); petHp -= d; if (e.lifesteal > 0) eHp = Math.min(e.hp, eHp + Math.floor(d * e.lifesteal)); }
    }
    return { win: petHp > 0 && eHp <= 0, left: Math.max(0, petHp) / p.hp, sec: t / 10 };
  }

  const rows = [];
  ${JSON.stringify(GROWTH)}.forEach(function (growth, ai) {
    const area = Config.battle.areas[ai];
    const base = Config.battle.areaEnemyStats[area.id];
    const mid = (area.levelRange[0] + area.levelRange[1]) / 2;
    const pool = EnemyData.list.filter(e => (area.enemyIds || []).indexOf(e.id) >= 0 &&
      (e.levelRange || [e.level, e.level])[1] >= area.levelRange[0] &&
      (e.levelRange || [e.level, e.level])[0] <= area.levelRange[1]);
    // 与 battle.js scaleEnemyStats 同源（clamp 与 typeMult 都从 config 读）
    function enemyAt(e, lv) {
      const ratio = Math.max(CLAMP[0], Math.min(CLAMP[1], lv / mid));
      const tm = (Config.battle.typeMult || {})[e.enemyType] || 1;
      return {
        name: e.name,
        hp: Math.round(base.hp * ratio * tm), atk: Math.round(base.atk * ratio * tm), def: Math.round(base.def * ratio * tm),
        spd: e.spd, hit: 90, dodge: dodgeOf(e.enemyType),
        critRate: Config.battle.critRate, critDamage: Config.battle.critMultiplier, lifesteal: 0
      };
    }
    function petAt(st, lv) {
      const p = { name: st.name, lineId: st.name, level: lv, growth: growth, baseHp: st.baseHp, baseAtk: st.baseAtk, baseDef: st.baseDef, baseSpd: 0, curHp: 0, equipment: {} };
      const s = Pet.getStats(p);
      const prof = Config.pet.petProfiles[st.name] || Config.pet.defaultPetProfile;
      return { name: st.name, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, hit: s.hit, dodge: s.dodge,
        critRate: s.critRate, critDamage: s.critDamage, lifesteal: (prof.lifesteal || 0) / 100 };
    }
    for (const st of Config.pet.starters) {
      for (let lv = area.levelRange[0]; lv <= area.levelRange[1]; lv++) {
        const p = petAt(st, lv);
        for (const e0 of pool) {
          const e = enemyAt(e0, lv);
          let wins = 0, leftSum = 0, secSum = 0;
          for (let i = 0; i < ${RUNS}; i++) {
            const r = fight(p, e);
            if (r.win) wins++;
            leftSum += r.left; secSum += r.sec;
          }
          rows.push({ areaIdx: ai, pet: st.name, lv, enemy: e.name,
            winRate: wins / ${RUNS}, left: leftSum / ${RUNS}, sec: secSum / ${RUNS} });
        }
      }
    }
  });
  return JSON.stringify(rows);
})()`);

const rows = JSON.parse(result);
const areas = JSON.parse(C('JSON.stringify(Config.battle.areas.slice(0,2).map(a=>({name:a.name,range:a.levelRange})))'));
const starters = JSON.parse(C('JSON.stringify(Config.pet.starters.map(s=>s.name))'));

let worstWin = 1, worstLeft = 1, slowest = 0;
for (const ai of [0, 1]) {
  const area = areas[ai], [lo, hi] = area.range;
  // 每宠每级取「最难的那只怪」作为该级结论（保守：最难的都赢，其余必然赢）
  const byKey = new Map();
  for (const r of rows.filter(r => r.areaIdx === ai)) {
    const k = r.pet + '|' + r.lv;
    const cur = byKey.get(k);
    if (!cur || r.winRate < cur.winRate || (r.winRate === cur.winRate && r.left < cur.left)) byKey.set(k, r);
  }
  const best = [...byKey.values()];
  const wWin = Math.min(...best.map(r => r.winRate));
  const wLeft = Math.min(...best.map(r => r.left));
  const slow = Math.max(...best.map(r => r.sec));
  worstWin = Math.min(worstWin, wWin);
  worstLeft = Math.min(worstLeft, wLeft);
  slowest = Math.max(slowest, slow);

  console.log(`  ${area.name}（Lv${lo}~${hi}，裸装成长 ${GROWTH[ai]}）· 每级最难的一只怪`);
  console.log('  宠物      ' + Array.from({ length: hi - lo + 1 }, (_, i) => ('Lv' + (lo + i)).padEnd(11)).join(''));
  for (const name of starters) {
    const cells = [];
    for (let lv = lo; lv <= hi; lv++) {
      const r = byKey.get(name + '|' + lv);
      cells.push((r ? (r.left * 100).toFixed(0).padStart(3) + '%/' + r.sec.toFixed(1) + 's' : '  -  ').padEnd(11));
    }
    console.log('  ' + name.padEnd(8) + cells.join(''));
  }
  console.log(`  最低胜率 ${(wWin * 100).toFixed(1)}%｜最低剩余血 ${(wLeft * 100).toFixed(0)}%｜最慢 ${slow.toFixed(1)}s\n`);
}

// 不是死板的 100%：模拟里最脆的宠在连续未命中的极端情况下仍有 <0.5% 翻车概率，
// 真实挂机有回血兜底，不构成卡关。守的目标是「不会稳定打不过」，不是「永不失手」。
A(worstWin >= 0.995, `新手期两张图全程不会稳定打不过（最低胜率 ${(worstWin * 100).toFixed(1)}%）`);
A(worstLeft >= 0.25, `新手期单场剩余血 ≥25%（最低 ${(worstLeft * 100).toFixed(0)}%，推得动不磨）`);
A(slowest <= 20, `单场耗时 ≤20 秒（最慢 ${slowest.toFixed(1)}s，挂机节奏不拖沓）`);

console.log('ALL EARLY GAME TESTS PASSED');
