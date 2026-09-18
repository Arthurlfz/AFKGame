/* ============================================================
 * probe_quest_audit.js —— 任务比例审计探针（人工运行：node probe_quest_audit.js）
 * 不参与 run_all 基线（不是断言，是读数）；与 probe_gear_panel.js 同一约定。
 * 目的：把「任务要多少工作量」与「任务给多少东西」都折算成【挂机小时】，找出比例失衡的条目。
 * 判据：可重复任务（每日/每周/循环）的「奖励小时 ÷ 需求耗时」必须 < 1；
 *      一次性里程碑允许 2~3 倍溢价。结论与改动记录见 docs/资源归属矩阵现状.md 的
 *      「2026-09-16 任务比例审计」一节。
 *
 * 口径（全部来自 config.js 里的掉落配置，不是拍脑袋）：
 *   场/小时 = 700（项目基准，见 drop.pool 注释）
 *   每场产出 = poolByStage（按图序号选阶段）× materialWeightsByTier（按图档子权重）
 *   进化素材 = 三档各自是独立键（2026-09-17 起），直接按 `materialWeightsByTier` 折算
 *   不可挂机获得的资源（神圣石/传说以外的塔货/涅槃丹/凝魂晶石…）→ 标 [受控]，不折算小时
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');

const ctx = { console, window: null };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/trial/trial-config.js', 'utf8'), ctx);

const C = ctx.Config;
const FLOORS = 700;                       // 场/小时
const areas = C.battle.areas;

const areaIdx = id => { const i = areas.findIndex(a => a.id === id); return i < 0 ? 10 : i + 1; };
const stageOf = i => (i <= 3 ? 1 : (i <= 7 ? 2 : 3));

/* ---------- 每张图每小时产什么、产多少 ---------- */
function ratesAt(tier) {
  const pool = C.drop.poolByStage[stageOf(tier)];
  const total = pool.none + pool.material + pool.equipment + pool.egg;
  const pMat = pool.material / total;
  const w = C.drop.materialWeightsByTier[tier] || {};
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const k in w) out[k] = pMat * (w[k] / sum) * FLOORS;
  out['装备'] = pool.equipment / total * FLOORS;
  out['宠物蛋'] = pool.egg / total * FLOORS;

  // 区域材料 → 换成该图专属材料名
  const am = C.drop.areaMaterials[areas[tier - 1].id];
  if (am && out['区域材料'] != null) { out[am.name] = out['区域材料']; delete out['区域材料']; }

  // 🔴 2026-09-17：进化素材三档已是**独立键**（`areaEvolutionTiers` + `evoMaterialWeights` 那套占位键机制已删），
  //   上面第 39 行那个通用循环已经把它们各自折算好了，这里**不再需要任何拆分**。
  return out;
}

const RATES = {};
for (let i = 1; i <= areas.length; i++) RATES[i] = ratesAt(i);

/* 某材料在全游戏里的最好产量（用来给它定「值多少挂机小时」） */
function bestRate(name) {
  let best = 0, at = 0;
  for (let i = 1; i <= areas.length; i++) {
    const v = RATES[i][name] || 0;
    if (v > best) { best = v; at = i; }
  }
  return { rate: best, tier: at };
}

/* 不可挂机获得（受控资源）：不折算小时，只标注主来源 */
const CONTROLLED = {
  '神圣石': '淬炼试炼 15/20 档 + 地图委托',
  '锁定石': '淬炼试炼 20 档',
  '越龙之石': '通天塔 11~30 层 / 20+ 档',
  '天仙玉露': '通天塔 21~30 层 / 25+ 档',
  '强化丹B': '通天塔 11~30 层 / 10+ 档',
  '涅槃丹': '涅槃试炼（20 层 = 4 个）',
  '凝魂晶石': '满级经验池凝出（账号绑定）',
  '资源试炼门票': '地图委托每轮 1 张（每轮需该图材料 200 个）',
  '通天塔重置卡': '每周兑换「塔券铸成」限 1 张（2026-09-17 晚加回；付费商店仍未上架）',
  '至尊神石': '合成 / 首通 Boss',
  '觉醒石': '觉醒之路（图 1~10 材料各 888）',
  '百变魔石': '图 10 掉落'
};

/* ---------- 需求 → 小时 ---------- */
function needHours(q) {
  const tier = q.area ? areaIdx(q.area) : 10;
  const r = RATES[tier];
  switch (q.type) {
    case 'kill': return { h: q.need / FLOORS, how: `${q.need} 杀 @${q.area ? areas[tier - 1].name : '任意图'}` };
    case 'collect':
    case 'collect_loop': {
      const names = Array.isArray(q.matList) ? q.matList : [q.matName];
      // matList = 每种都要 need 个
      let worst = 0, who = '';
      names.forEach(n => {
        const b = bestRate(n);
        const hh = b.rate > 0 ? q.need / b.rate : Infinity;
        if (hh > worst) { worst = hh; who = n; }
      });
      return { h: worst * names.length, how: `${names.length} 种 × ${q.need}（瓶颈 ${who}）` };
    }
    case 'equipDrop': return { h: q.need / r['装备'], how: `${q.need} 件装备掉落` };
    case 'salvage': return { h: q.need / RATES[10]['装备'], how: `${q.need} 次分解` };
    case 'craft':
    case 'soulcast': return { h: q.need / (RATES[1]['重铸石'] || 1), how: `${q.need} 次打造（吃通货）` };
    case 'hatch': return { h: q.need / RATES[10]['宠物蛋'], how: `${q.need} 次孵化（蛋是掉落副产）` };
    case 'list':
    case 'trade': return { h: q.need / 30, how: `${q.need} 次上架/成交` };
    default: return { h: null, how: q.type };
  }
}

/* ---------- 奖励 → 小时 ---------- */
function rewardHours(reward) {
  let h = 0; const controlled = []; const detail = [];
  for (const name in (reward || {})) {
    const qty = reward[name];
    if (CONTROLLED[name]) { controlled.push(`${name}×${qty}`); continue; }
    const b = bestRate(name);
    if (b.rate > 0) { h += qty / b.rate; detail.push(`${name}×${qty}`); }
    else { controlled.push(`${name}×${qty}(?)`); }
  }
  return { h, controlled, detail };
}

/* ---------- 跑一遍 ---------- */
const quests = C.drop.quests || [];
const rows = [];
quests.forEach(q => {
  const n = needHours(q);
  const rw = rewardHours(q.reward);
  const cycle = q.repeat || q.reset === 'daily' ? '每日'
    : (q.reset === 'weekly' ? '每周' : (q.repeatable ? '循环' : '一次性'));
  rows.push({
    id: q.id, name: q.name, kind: q.kind || q.category, type: q.type, cycle,
    need: q.need, howText: n.how, needH: n.h,
    rewardText: Object.keys(q.reward || {}).map(k => k + '×' + q.reward[k]).join(' ') || '—',
    rewardH: rw.h, controlled: rw.controlled.join(' '),
    ratio: (n.h != null && rw.h > 0) ? rw.h / n.h : null
  });
});

/* ---------- 输出 ---------- */
const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

console.log('=== ① 各图每小时产量（关键材料）===');
const keyMats = ['枯荣种荚', '腐变之心', '进化素材', '精粹进化素材', '传说进化素材',
  '重铸石', '增缀石', '剥离石', '合成之石', '鉴定石', '强化丹A', '腐印·暴怒', '装备', '宠物蛋'];
console.log('图\ttier\t' + keyMats.join('\t'));
for (let i = 1; i <= areas.length; i++) {
  console.log(`${i}\t${areas[i - 1].name}\t` + keyMats.map(m => f(RATES[i][m], 2)).join('\t'));
}

console.log('\n=== ② 全部任务：需求 vs 奖励（小时口径）===');
console.log('id\t周期\t类型\t需求做法\t需求h\t奖励\t奖励h\t受控\t比值');
rows.sort((a, b) => (b.ratio == null ? -1 : b.ratio) - (a.ratio == null ? -1 : a.ratio));
rows.forEach(r => {
  console.log([r.id, r.cycle, r.type, r.howText, f(r.needH), r.rewardText, f(r.rewardH), r.controlled || '', r.ratio == null ? '—' : f(r.ratio)].join('\t'));
});

console.log('\n=== ③ 口径说明 ===');
console.log('场/小时 = ' + FLOORS + '；奖励小时 = 该材料在全游戏最高产量图的产量折算');
console.log('受控资源（地图不产）= ' + Object.keys(CONTROLLED).join(' / '));

/* ---------- ④ 受控资源发放总账：按「周期」看白送量 ---------- */
const byId = {};
quests.forEach(q => { byId[q.id] = q; });

console.log('\n=== ④ 受控资源发放总账（任务侧） ===');
console.log('（一次性 = 全游戏总共只能领一次的合计；每日/每周/循环 = 每周期白拿的量）');
const cycles = ['每日', '每周', '循环', '一次性'];
const acc = {}; cycles.forEach(c => { acc[c] = {}; });
rows.forEach(r => {
  const q = byId[r.id];
  Object.entries((q && q.reward) || {}).forEach(([n, v]) => {
    if (!CONTROLLED[n]) return;
    acc[r.cycle][n] = (acc[r.cycle][n] || 0) + v;
  });
});
cycles.forEach(c => {
  const e = Object.entries(acc[c]).sort((a, b) => b[1] - a[1]);
  console.log(`${c}\t` + (e.length ? e.map(([n, v]) => `${n}×${v}`).join('  ') : '（无）'));
});

/* ---------- ⑤ 每周期「净白拿」= 奖励 − 成本（只列正的）---------- */
/* 口径：collect 类的成本 = 需求材料的挂机产出时间；动作类的成本 = 动作耗时（很小）。
 * 含受控资源的条目跳过（它们不折算小时，在 ④ 单列）—— 两条账要分开看，别混。 */
console.log('\n=== ⑤ 每周期「净白拿」（奖励折算 − 成本折算；只列净赚的） ===');
cycles.slice(0, 2).forEach(c => {
  let net = 0; const pos = [];
  rows.filter(r => r.cycle === c).forEach(r => {
    const q = byId[r.id];
    const rw = rewardHours((q && q.reward) || {});
    if (rw.controlled.length) return;
    const n = rw.h - (r.needH == null ? 0 : r.needH);
    if (n > 0) { pos.push(`${r.id} +${n.toFixed(2)}h`); net += n; }
  });
  console.log(`${c}：净白拿 ≈ ${net.toFixed(2)} 小时挂机量`);
  console.log('\t' + (pos.length ? pos.join('  ') : '（无）'));
});

/* ---------- ⑥ 每条「给受控资源」的任务（逐条看是否与难度相称） ---------- */
console.log('\n=== ⑥ 给受控资源的任务（按 id 排） ===');
rows.filter(r => r.controlled).forEach(r => {
  console.log([r.id, r.cycle, r.howText, f(r.needH), r.controlled].join('\t'));
});
