/* ============================================================
 * probe_tower_drops.js —— 通天塔产出读数探针（人工运行：cd docs/tests && node probe_tower_drops.js）
 * 不参与 run_all 基线（不是断言，是读数）；与 probe_quest_audit.js / probe_gear_panel.js 同一约定。
 *
 * 为什么需要它：**「表里有这个键」不等于「玩家拿得到」**。
 *   权重是相对值，写 0.1 和写 8 在配置里只差一个字符，在游戏里差 80 倍。
 *   而塔有【每天 1 局免费（+ 重置卡）】的硬闸门 —— 所以「每局期望 < 0.5 件」的东西
 *   等于「两天以上才见一次」，对玩家就是摆设，跟"根本没写进表"体感相同。
 *   （同一课在野图上已经交过学费：图 6~10 的普通进化素材配 2~3 的权重 ⇒ 表里"键在"、
 *     测试全绿，实测只有 0.42~0.65 个/小时，被用户当场指为「低了点点」。）
 *
 * 口径（全部读 Config.tower 现值，不手写任何数字）：
 *   一局 roll 次数 = floors × mobsPerFloor；其中每层前 (mobsPerFloor-1) 只用 mobPool、
 *                   第 mobsPerFloor 只是「守卫」用 guardianPool。
 *   材料件数 = 材料命中次数 × materialQty 的期望值（weightedPick 命中后随机取 qty）。
 *   每个 band 只统计**该段那 10 层**里的 roll。走完一段 = 走完那 10 层。
 *
 * ⚠️ 「几局才出 1 个」有两种读法，别看混（报给用户要用后者）：
 *    · **平均产出率** = 1 ÷ 每局期望件数（第 ② 节给的就是这个）
 *    · **第一次见到它要几局** = 1 ÷ (1 − (1 − w/段合计)^该段命中次数)
 *   差别来源：命中一次给 1~3 个（materialQty），所以"平均 46 局产 1 个"的东西，
 *   实际是"**约 90 局才第一次见着**"。用前者会显得比实际好一倍。
 *   （例：魂晶经验匣在 1~10 层 = 每次材料命中 0.1/99.1 ≈ 0.1%，
 *     该段 10.8 次命中 ⇒ **一局约 1%** 碰到它。塔一天一局 ⇒ 约 100 天。）
 * ⚠️ 本探针**只看产出**，不看难度；难度见 sim_tower_balance.js。
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = { console, window: null };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/tower/tower-config.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
}

const C = ctx.Config;
const T = C.tower;
const floors = Number(T.floors) || 30;
const per = Number(T.mobsPerFloor) || 5;
const drop = T.layerDrop || {};
const mobP = drop.mobPool || {}, guardP = drop.guardianPool || {};
const frac = p => { const t = (p.none || 0) + (p.material || 0) + (p.equipment || 0); return t > 0 ? (p.material || 0) / t : 0; };
const pMatMob = frac(mobP), pMatGuard = frac(guardP);
const q = T.materialQty || { min: 1, max: 3 };
const eQty = (Number(q.min) + Number(q.max)) / 2;          // qty 均匀分布 → 期望 (min+max)/2

/* ---------- 一段（band）里能拿到多少次材料 ---------- */
function bandRolls(from, to) {
  const n = Math.max(0, to - from + 1);
  const mobs = n * (per - 1);        // 每层前 4 只：杂兵池
  const guards = n;                  // 每层第 5 只：守卫池
  return mobs * pMatMob + guards * pMatGuard;
}
const f2 = (v, d = 2) => Number(v).toFixed(d);
const roundsTo1 = e => (e > 0 ? Math.round(1 / e) : Infinity);

console.log('=== ① 塔的结构（读 Config.tower） ===');
console.log(`总层数 ${floors} · 每层 ${per} 只（杂兵 ${per - 1} + 守卫 1）⇒ 一局 ${floors * per} 次掉落 roll`);
console.log(`杂兵池 none/material/equipment = ${mobP.none}/${mobP.material}/${mobP.equipment} ⇒ 材料命中率 ${(pMatMob * 100).toFixed(1)}%`);
console.log(`守卫池 none/material/equipment = ${guardP.none}/${guardP.material}/${guardP.equipment} ⇒ 材料命中率 ${(pMatGuard * 100).toFixed(1)}%`);
console.log(`materialQty = ${q.min}~${q.max} ⇒ 每次命中期望 ${eQty} 件`);
console.log(`⇒ 一局（打满 ${floors} 层）材料命中 ${f2(bandRolls(1, floors), 1)} 次 ≈ ${f2(bandRolls(1, floors) * eQty, 1)} 件`);
console.log(`⇒ 每段（10 层）走完 ≈ 材料命中 ${f2(bandRolls(1, 10), 1)} 次 ≈ ${f2(bandRolls(1, 10) * eQty, 1)} 件\n`);

/* ---------- ② 每段每个物品：每局期望件数 + 几局才出 1 个 ---------- */
const bands = T.materialBands || [];
const all = [];
bands.forEach(b => {
  const w = b.weights || {};
  const keys = Object.keys(w).filter(k => Number(w[k]) > 0);
  const sum = keys.reduce((s, k) => s + Number(w[k]), 0) || 1;
  const rolls = bandRolls(b.from, b.to);
  console.log(`=== ② 第 ${b.from}~${b.to} 层（权重合计 ${f2(sum, 1)} · 走完本段 ${f2(rolls, 1)} 次材料命中 ≈ ${f2(rolls * eQty, 1)} 件）===`);
  const rows = keys.map(k => {
    const share = Number(w[k]) / sum;                  // 单次材料命中抽到它的概率
    const exp = rolls * share * eQty;                  // 走完本段的期望件数
    const hitP = 1 - Math.pow(1 - share, rolls);       // ⭐ 一局「碰到它（至少一次）」的概率
    return { name: k, w: Number(w[k]), pct: share * 100, exp, hitP };
  }).sort((a, z) => z.exp - a.exp);
  console.log('物品\t权重\t本段占比\t本段期望件数\t几局才出 1 个\t一局碰到的概率');
  rows.forEach(r => console.log(`${r.name}\t${r.w}\t${f2(r.pct, 1)}%\t${f2(r.exp, 3)}\t${roundsTo1(r.exp) === Infinity ? '—' : roundsTo1(r.exp)}\t${(r.hitP * 100).toFixed(1)}%`));
  console.log('');
  rows.forEach(r => all.push({ band: `第${b.from}~${b.to}层`, ...r }));
});

/* ---------- ③ 摆设清单：一局碰不到的东西 ---------- */
/* 判据用**一局碰到的概率 < 10%**，不用"期望件数"。
 * 来源：用户 2026-09-17 晚看到旧表后明确「不是」（"三个月见一次"不是他要的稀有度）。
 * 塔每天免费只有 1 局 ⇒ 10% 就是**十天一遇**。 */
const RARE_BAR = 0.10;
console.log(`=== ③ 「名义全域、实际摆设」清单（判据 = 一局碰到的概率 < ${RARE_BAR * 100}% ≈ 十天以上才见一次）===`);
const token = all.filter(r => r.hitP < RARE_BAR).sort((a, z) => a.hitP - z.hitP);
if (!token.length) console.log('（无 —— 每样东西至少十天能碰上一次）');
else if (token.every(r => r.name === '至尊神石')) {
  console.log('（只剩「至尊神石」—— 这是**刻意的例外**：它是「必定出神级宠」，');
  console.log('  上一轮刚从守关 Boss 挪进塔就是为了收紧它，别再顺手抬。见 tower-config 的 materialBands 前说明。）');
}
token.forEach(r => console.log(`${r.band}\t${r.name}\t权重 ${r.w}\t一局碰到 ${(r.hitP * 100).toFixed(1)}%\t≈ ${r.hitP > 0 ? Math.round(1 / r.hitP) : '—'} 天一次`));
console.log('');

/* ---------- ④ 地图有、塔里一件都没有的基础物资 ---------- */
const mapKeys = new Set();
Object.values(C.drop.materialWeightsByTier || {}).forEach(w => Object.keys(w).forEach(k => { if (k !== '区域材料') mapKeys.add(k); }));
const towerKeys = new Set();
bands.forEach(b => Object.keys(b.weights || {}).forEach(k => { if (Number(b.weights[k]) > 0) towerKeys.add(k); }));
const mapOnly = [...mapKeys].filter(k => !towerKeys.has(k));
const towerOnly = [...towerKeys].filter(k => !mapKeys.has(k));
console.log('=== ④ 塔与地图的材料交集 ===');
console.log(`地图有、塔里【一件都不出】：${mapOnly.join(' / ') || '（无）'}`);
console.log(`塔有、地图【一件都不出】：${towerOnly.join(' / ') || '（无）'}`);
console.log(`两边都有：${[...towerKeys].filter(k => mapKeys.has(k)).join(' / ') || '（无）'}`);
