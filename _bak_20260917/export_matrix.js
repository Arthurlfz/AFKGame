/* ============================================================
 * export_matrix.js —— 「产出归属总表」导出器（人读版 Excel 的生产线第一步）
 *
 * 干什么：把「永夜灵市里每件东西到底从哪来」从**代码现场**抓出来，交给写表器排成
 *   docs/产出归属总表.xlsx（多页签）。核心回答两个问题：
 *     · 哪些是【全域掉落】（好几张图都能掉）？
 *     · 哪些是【区域专属】（只有某一张图掉）？
 *
 * 怎么跑（唯一入口，一条命令跑完全流程）：
 *     cd docs && node tests/export_matrix.js
 *   跑完产物 = docs/产出归属总表.xlsx（中间 JSON 落在系统临时目录，跑完即删，不进仓库）
 *
 * 🔴 三条不许破的规矩（破了就等于造第二份事实源，本项目头号病因）：
 *   1. 【来源口径】一律复用 `MatWiki.sources()`（core/mat-wiki.js）。本脚本只做**呈现**，
 *      不做**判断** —— 不许在这里再写一套"谁从哪来"的推导。
 *   2. 【深浅口径】一律直读 `Config.drop.materialWeightsByTier` 原值。唯一允许的加工是
 *      **解析占位键**（'区域材料' → 该图专属材料名；'进化素材' → 该图允许的档位名），
 *      这与 drop.js 的 pickMaterial 同口径，不是新规则。
 *   3. 【只读】本脚本不写任何游戏文件、不改任何数值。改名可以，改名后别以 `vtest_` 开头
 *      （run_all.js 只收 /^vtest_.*\.js$/，否则会被当成回归测试纳入基线）。
 *
 * 为什么是 node + python 两个脚本：配置是 JS（只有 node 能可靠读），而成熟的 xlsx 写出库
 *   在 python 侧（openpyxl，本机已装）。中间 JSON 是两者唯一接口。
 * ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const JS_DIR = path.join(HERE, '..', 'js');
const XLSX = path.join(HERE, '..', '产出归属总表.xlsx');
const PY = path.join(HERE, 'export_matrix_xlsx.py');

/* ---------- 1. 按项目的加载顺序把配置读进来（顺序错会读到 undefined） ---------- */
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
load('core/config.js');            // Config 主体
load('trial/trial-config.js');     // 副本数值 + 往 Config.drop.quests 注入门票
load('tower/tower-config.js');     // Config.tower（材料池 / 档位）
load('core/mat-wiki.js');          // ⭐ 来源口径的唯一权威

const C = ctx.Config;
const MW = ctx.MatWiki;
const D = C.drop || {};

/* ---------- 2. 基础字典 ---------- */
const SKIP_PLACEHOLDER = ['区域材料', '进化素材'];   // 掉落表里的占位键，不是真物品名
const EVO_TIERS = ['进化素材', '精粹进化素材', '传说进化素材'];
const DAMAGED = ['装备', '宠物蛋'];                  // 不是材料，走掉落总盘，不进材料子池矩阵

const areas = ((C.battle && C.battle.areas) || []).map((a, i) => ({
  tier: i + 1, id: a.id, name: a.name, levelRange: a.levelRange || [], recGrowth: a.recGrowth
}));
const MWBT = D.materialWeightsByTier || {};
const areaMaterials = D.areaMaterials || {};
const areaEvoTiers = D.areaEvolutionTiers || {};
const groups = C.materialInfoGroups || [];
const matInfo = C.materialInfo || {};

const groupOf = n => (matInfo[n] || {}).group || 'misc';
const groupLabel = g => { const h = groups.find(x => x.id === g); return h ? h.label : '其他'; };
const kindOf = g => { const h = groups.find(x => x.id === g); return h ? h.kind : 'material'; };

// 每张图材料子池权重合计（用于算「占该图材料池百分比」，与 mat-wiki 同口径）
const tierTotal = t => Object.values(MWBT[t] || {}).reduce((s, v) => s + (Number(v) || 0), 0) || 1;

/* ---------- 3. 物品 × 图 权重（唯一允许的加工 = 解析占位键） ---------- */
// 进化素材三档共用「进化素材」这一个权重槽，槽内再按 evoMaterialWeights 分档。
// 这里按 drop.js pickMaterial 的同一算法把槽拆开（不是新规则，是同一个公式的另一种摆法）：
//   某档实际权重 = 槽权重 × (该档权重 / 本图可用档位权重之和)
function evoSplitOf(areaId) {
  const allowed = areaEvoTiers[areaId] || [];
  const ew = D.evoMaterialWeights || {};
  const sum = allowed.reduce((s, t) => s + (Number(ew[t]) || 10), 0) || 1;
  const out = {};
  allowed.forEach(t => { out[t] = (Number(ew[t]) || 10) / sum; });
  return { allowed, share: out, sum: sum };
}

function mapWeightsOf(name) {
  const out = {};
  areas.forEach(a => {
    const w = MWBT[a.tier] || {};
    /* ⚠️ 进化素材这一档的名字与占位键**同名**，必须先走占位键逻辑再判断直接命中，
     * 否则「进化素材」这一行会把 10 张图的槽权重（40/44/50/…）原样抄下来，
     * 看起来像「10 张图都掉普通进化素材」—— 实际上图 6~10 只出精粹/传说。 */
    if (EVO_TIERS.indexOf(name) >= 0) {
      if ((areaEvoTiers[a.id] || []).indexOf(name) >= 0) {
        const slot = Number(w['进化素材']) || 0;
        if (slot > 0) out[a.tier] = +(slot * evoSplitOf(a.id).share[name]).toFixed(4);
      }
      return;
    }
    // ① 表里直接有这个名字
    if (Object.prototype.hasOwnProperty.call(w, name)) {
      const v = Number(w[name]) || 0;
      if (v > 0) out[a.tier] = v;
      return;
    }
    // ② 占位键「区域材料」→ 该图专属材料名
    const am = areaMaterials[a.id];
    if (am && am.name === name) {
      const v = Number(w['区域材料']) || 0;
      if (v > 0) out[a.tier] = v;
    }
  });
  return out;
}

/* ---------- 4. 各来源的「有没有」标记 ---------- */
const tower = C.tower || {};
const towerBands = tower.materialBands || [];
const towerTiers = tower.floorTiers || [];
const towerConsol = tower.consolation || [];
const trials = (C.resourceTrials && C.resourceTrials.routes) || [];

const towerHas = n =>
  towerBands.some(b => (b.weights || {})[n] > 0) ||
  towerTiers.some(t => (t.items || []).some(i => i.name === n)) ||
  towerConsol.some(i => i.name === n);
const trialHas = n => trials.some(r =>
  (r.floorTiers || []).some(t => (t.items || []).some(i => i.name === n)) ||
  (r.consolation || []).some(i => i.name === n));

const quests = D.quests || [];
const questRows = quests.filter(q => q.reward && Object.keys(q.reward).length).map(q => ({
  id: q.id, name: q.name || q.id,
  kind: q.kind || q.category || 'series',
  category: q.category || '',
  type: q.type || '',
  reset: q.reset || '',
  unlockLevel: (q.unlockLevel === undefined || q.unlockLevel === null) ? null : q.unlockLevel,
  need: (q.need === undefined || q.need === null) ? null : q.need,
  cost: q.matName || (q.matList ? q.matList.join(' / ') : ''),
  expReward: q.expReward || 0,
  reward: q.reward
}));
const questHas = n => questRows.some(q => q.reward[n] > 0);
const exchangeHas = n => questRows.some(q => q.kind === 'exchange' && q.reward[n] > 0);

// 分解产出：Config.salvage 的 value 是 Config.craft 的键（id），要翻成名字
const salvageOut = {};
Object.keys(C.salvage || {}).forEach(rarity => {
  const o = C.salvage[rarity] || {};
  const names = Object.keys(o).map(id => {
    const c = (C.craft || {})[id] || {};
    return { name: c.name || id, qty: o[id] };
  });
  salvageOut[rarity] = names;
});
const salvageHas = n => Object.values(salvageOut).some(list => list.some(x => x.name === n));

// 守关 Boss：常量写在 drop.js 里（配置查不到）→ 从源码抠出来，抠不到就留空并标注
const bossDrops = [];
try {
  const src = fs.readFileSync(path.join(JS_DIR, 'core', 'drop.js'), 'utf8');
  const re = /Math\.random\(\)\s*<\s*([\d.]+)\)\s*\{\s*await Materials\.gain\('([^']+)'\s*,\s*(\d+)/g;
  let m;
  while ((m = re.exec(src))) bossDrops.push({ name: m[2], pct: Number(m[1]) * 100, qty: Number(m[3]) });
} catch (e) { /* drop.js 缺了也不影响主表 */ }
const bossHas = n => bossDrops.some(b => b.name === n);

const shopHas = n =>
  !!(C.shop && C.shop.enabled && (C.shop.catalog || []).some(p =>
    p.payload && p.payload.materials && p.payload.materials[n]));

const tradeNames = ((C.trade && C.trade.materials) || []).map(m => m.name);

/* ---------- 5. 逐个物品成行 ---------- */
function pctTxt(x) { return x >= 1 ? x.toFixed(1) + '%' : (x >= 0.1 ? x.toFixed(2) + '%' : '不到 0.1%'); }

function buildItem(name, special) {
  const grp = special ? (special.group || 'misc') : groupOf(name);
  const mapW = special ? {} : mapWeightsOf(name);
  const mapPct = {};
  Object.keys(mapW).forEach(t => { mapPct[t] = mapW[t] / tierTotal(t) * 100; });
  const tiers = Object.keys(mapW).map(Number).sort((a, b) => a - b);
  const coverage = tiers.length;

  let qualification;
  if (coverage === 10) qualification = '全域（10 图都有）';
  else if (coverage > 1) qualification = '多图（' + coverage + ' 图）';
  else if (coverage === 1) qualification = '单图专属';
  else qualification = '非地图来源';

  const sources = special ? (special.sources || []) : MW.sources(name);
  if (!special && coverage === 0 && sources.length === 0) qualification = '⚠ 无来源（断供）';

  // 主要来源一句话
  let mainSource = '';
  if (coverage > 0) {
    const best = tiers.reduce((a, b) => (mapPct[b] > mapPct[a] ? b : a));
    mainSource = '图' + best + ' ' + (areas[best - 1] ? areas[best - 1].name : '') +
      '（占该图材料池 ' + pctTxt(mapPct[best]) + '）';
  } else if (sources.length) {
    mainSource = sources[0].where || '';
  } else {
    mainSource = '—';
  }

  return {
    name,
    group: grp,
    groupLabel: special ? (special.groupLabel || '其他') : groupLabel(grp),
    kind: special ? (special.kind || 'material') : kindOf(grp),
    tradable: tradeNames.indexOf(name) >= 0,
    lootTier: (D.lootTiers || {})[name] || 1,
    mapWeights: mapW,
    mapPct,
    mapCoverage: coverage,
    mapTierList: tiers,
    qualification,
    mainSource,
    tower: special ? false : towerHas(name),
    trial: special ? false : trialHas(name),
    quest: special ? false : questHas(name),
    exchange: special ? false : exchangeHas(name),
    salvage: special ? false : salvageHas(name),
    boss: special ? false : bossHas(name),
    shop: special ? false : shopHas(name),
    sources
  };
}

const itemNames = Object.keys(matInfo);
const items = itemNames.map(n => buildItem(n));

/* 装备 / 宠物蛋：走掉落总盘（与材料子池不是同一把尺），单独成行 */
const poolByStage = D.poolByStage || {};
const equipRow = {
  name: '装备（未鉴定）', group: 'gear', groupLabel: '装备与蛋', kind: 'gear', tradable: true,
  lootTier: 3, mapWeights: {}, mapPct: {}, mapCoverage: 0, mapTierList: [],
  qualification: '掉落总盘（全图都有）',
  mainSource: '掉落总盘：阶段1 权重 ' + ((poolByStage[1] || {}).equipment || 0) + ' / 阶段2 ' +
    ((poolByStage[2] || {}).equipment || 0) + ' / 阶段3 ' + ((poolByStage[3] || {}).equipment || 0),
  tower: true, trial: false, quest: false, exchange: false, salvage: true, boss: true, shop: false,
  sources: [{ where: '地图挂机（掉落总盘 equipment 档）', what: '颜色/底材T/词缀T 全由 ilvl 派生', qty: null },
            { where: '通天塔', what: '杂兵与守卫都能掉，档位奖励另给金装', qty: null },
            { where: '守关 Boss', what: '必掉 1 件金装', qty: 1 }]
};
const eggRow = {
  name: '宠物蛋', group: 'egg', groupLabel: '装备与蛋', kind: 'egg', tradable: true,
  lootTier: 3, mapWeights: {}, mapPct: {}, mapCoverage: 0, mapTierList: [],
  qualification: '掉落总盘（全图都有）',
  mainSource: '掉落总盘：阶段1 ' + ((poolByStage[1] || {}).egg || 0) + ' / 阶段2 ' +
    ((poolByStage[2] || {}).egg || 0) + ' / 阶段3 ' + ((poolByStage[3] || {}).egg || 0) +
    '（品种 = 该怪对应的基础宠）',
  tower: false, trial: false, quest: true, exchange: false, salvage: false, boss: false, shop: false,
  sources: [{ where: '地图挂机（掉落总盘 egg 档）', what: '品种 = 该怪对应的基础宠蛋', qty: null },
            { where: '任务奖励', what: '主线 m15 / m27 与部分成就发蛋', qty: null }]
};
const allItems = items.concat([equipRow, eggRow]);

/* 排序：分组顺序 → 组内按「能掉的图数」降序 → 名字（重跑顺序稳定，方便逐次 diff） */
const groupOrder = groups.map(g => g.id).concat(['gear']);
const gi = g => { const i = groupOrder.indexOf(g); return i < 0 ? 999 : i; };
allItems.sort((a, b) =>
  gi(a.group) - gi(b.group) ||
  (b.mapCoverage - a.mapCoverage) ||
  a.name.localeCompare(b.name, 'zh'));

/* ---------- 6. 异常清单 ---------- */
// ① 登记在册但查不到任何来源
const noSource = items.filter(it => {
  if (it.mapCoverage > 0) return false;
  return it.tower === false && it.trial === false && it.quest === false &&
    it.exchange === false && it.salvage === false && it.boss === false && it.shop === false &&
    it.sources.length === 0;
}).map(it => ({ name: it.name, groupLabel: it.groupLabel }));

// ② 出现在产出表里、却没在 materialInfo 登记（背包里会"找不到"）
const seen = {};
Object.keys(MWBT).forEach(t => Object.keys(MWBT[t]).forEach(n => { seen[n] = '地图掉落表（图' + t + '）'; }));
towerBands.forEach(b => Object.keys(b.weights || {}).forEach(n => { seen[n] = '通天塔 ' + b.from + '~' + b.to + ' 层材料池'; }));
towerTiers.forEach(t => (t.items || []).forEach(i => { seen[i.name] = '通天塔第 ' + t.floor + ' 层档位'; }));
trials.forEach(r => (r.floorTiers || []).forEach(t => (t.items || []).forEach(i => { seen[i.name] = r.name + ' 第 ' + t.floor + ' 层档位'; })));
questRows.forEach(q => Object.keys(q.reward).forEach(n => { seen[n] = '任务奖励（' + q.id + '）'; }));
((C.expPacks) || []).forEach(p => { seen[p.name] = '经验包配置 Config.expPacks'; });
Object.keys(salvageOut).forEach(r => salvageOut[r].forEach(x => { seen[x.name] = '分解（' + r + '）'; }));
bossDrops.forEach(b => { seen[b.name] = '守关 Boss'; });
tradeNames.forEach(n => { seen[n] = '交易可作价白名单'; });

const unregistered = Object.keys(seen)
  .filter(n => n && SKIP_PLACEHOLDER.indexOf(n) < 0 && !matInfo[n] && DAMAGED.indexOf(n) < 0)
  .map(n => ({ name: n, where: seen[n] }));

// ③ 「名义上有来源、实际上是空的」——文案里自己写着"暂未开放 / 暂无获取 / 已绝版"
const pendingSource = items
  .map(it => {
    const hit = (it.sources || []).find(s => /暂未开放|尚未开放|暂无获取|没有获取途径|已绝版/.test((s.where || '') + (s.what || '')));
    return hit ? { name: it.name, groupLabel: it.groupLabel, text: ((hit.where || '') + '：' + (hit.what || '')) } : null;
  })
  .filter(Boolean);

// ④ 「文案写的图号跟实际对不上」——拿游戏内词条里的「图N」跟 battle.areas 的真实序号对账
//    典型来源：mat-wiki.js 用 areaMaterials 的**对象键序号**当图号，而它的键顺序与 battle.areas 不一致。
const textMismatch = [];
Object.keys(areaMaterials).forEach(id => {
  const name = areaMaterials[id].name;
  const realTier = areas.findIndex(a => a.id === id) + 1;
  (MW.sources(name) || []).forEach(s => {
    const m = /^图(\d+)/.exec(String(s.where || ''));
    if (m && Number(m[1]) !== realTier) {
      textMismatch.push({
        name: name, claimed: Number(m[1]), real: realTier,
        where: s.where, id: id, realAreaName: (areas[realTier - 1] || {}).name || ''
      });
    }
  });
});

// ⑤ 名册重复：白名单 / 登记表里同一个名字被登记了两次（数组才能重复，对象键不会）
const dupRegistry = [];
{
  const cnt = {};
  tradeNames.forEach(n => { cnt[n] = (cnt[n] || 0) + 1; });
  Object.keys(cnt).forEach(n => {
    if (cnt[n] > 1) dupRegistry.push({ name: n, count: cnt[n], where: 'Config.trade.materials（可交易白名单）' });
  });
}

/* ---------- 7. 组装中间 JSON ---------- */
const data = {
  meta: {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    areas,
    note: '权重是相对值，不是百分比；同一张图（或同一层段）内归一化后才等于概率。'
  },
  dropPool: { pool: D.pool || {}, poolByStage },
  evoWeights: D.evoMaterialWeights || {},
  areaEvoTiers: areaEvoTiers,
  areaMaterials: Object.keys(areaMaterials).map(id => ({ id, name: areaMaterials[id].name, tier: areas.findIndex(a => a.id === id) + 1 })),
  itemGroups: groups,
  items: allItems,
  tower: {
    enabled: !!(C.towerDrops && C.towerDrops.enabled),
    resetCard: tower.resetCard || null,
    layerDrop: tower.layerDrop || {},
    materialQty: tower.materialQty || {},
    bands: towerBands.map(b => ({ from: b.from, to: b.to, weights: b.weights })),
    floorTiers: towerTiers,
    consolation: towerConsol,
    ledger: (C.towerDrops && C.towerDrops.items) || []
  },
  trials: {
    freeEntriesPerDay: (C.resourceTrials && C.resourceTrials.freeEntriesPerDay) || 0,
    ticketName: (C.resourceTrials && C.resourceTrials.ticketName) || '',
    ticketSources: (C.resourceTrials && C.resourceTrials.ticketSources) || '',
    routes: trials.map(r => ({
      id: r.id, name: r.name, desc: r.desc, minLevel: r.minLevel,
      tiers: r.floorTiers || [], consolation: r.consolation || []
    }))
  },
  quests: { rows: questRows, exchanges: questRows.filter(q => q.kind === 'exchange') },
  salvage: salvageOut,
  boss: bossDrops,
  shop: { enabled: !!(C.shop && C.shop.enabled), hasMaterialGoods: !!(C.shop && (C.shop.catalog || []).length) },
  expPacks: (C.expPacks || []).map(p => ({ name: p.name, amount: p.amount })),
  anomalies: { noSource, unregistered, pendingSource, textMismatch, dupRegistry },
  // 每张图的进化素材槽拆分说明（矩阵页要讲清"三档为什么会在同一张图里同时出现数字"）
  evoSlots: areas.map(a => {
    const s = evoSplitOf(a.id);
    return {
      tier: a.tier, slot: Number((MWBT[a.tier] || {})['进化素材']) || 0,
      allowed: s.allowed, share: s.share
    };
  }),
  counts: { items: allItems.length, registered: items.length }
};

/* ---------- 8. 交给写表器 ---------- */
const tmp = path.join(os.tmpdir(), 'eb_matrix_' + Date.now() + '.json');
fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');

function runPy(exe) {
  return spawnSync(exe, [PY, tmp], { stdio: 'inherit' });
}
let r = runPy('python');
if (r.error && r.error.code === 'ENOENT') r = runPy('py');
if (r.error) {
  console.error('❌ 起不来 python（本机需要 python3 + openpyxl）：' + r.error.message);
  process.exit(1);
}
fs.unlinkSync(tmp);
if (r.status !== 0) { console.error('❌ 写表失败，退出码 ' + r.status); process.exit(r.status || 1); }

console.log('');
console.log('✅ 已生成：' + XLSX);
console.log('   物品 ' + allItems.length + ' 行（其中登记在册 ' + items.length + ' 项）｜' +
  '地图 ' + areas.length + ' 张｜塔 ' + towerBands.length + ' 层段 / ' + towerTiers.length + ' 档｜副本 ' + trials.length + ' 条路线');
console.log('   ⚠ 无来源 ' + noSource.length + ' 项｜未登记 ' + unregistered.length +
  ' 项｜名义来源为空 ' + pendingSource.length + ' 项｜文案图号对不上 ' + textMismatch.length +
  ' 项｜名册重复 ' + dupRegistry.length + ' 项（详见「异常与待定」页签）');
