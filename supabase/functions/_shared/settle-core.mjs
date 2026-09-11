/* ============================================================
 * settle-core.mjs —— 结算纯计算核心（无 Deno/DB 依赖，node 可测）
 * 职责：
 *   1. petFromRow：pets 行 + equip_items 行 → 模拟器宠物快照
 *   2. grantExp：经验发放（与 pet.js grantExp 同口径，升级扣 need、满级封顶）
 *   3. settlePlan：完整结算编排（快照 → 模拟 → 经验 → 落库 patch 计划）
 * 输入输出均为纯数据，DB 读写由调用方（Edge Function / 测试桩）负责。
 * ============================================================ */
import { simulateSessionScript, mulberry32 } from './battle-sim.mjs';
import { makeEquipGen } from './equip-gen-server.mjs';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

// resolveLineId：与 pet.js 同逻辑（形态名 → 根源基宠）
function resolveLineId(name, config) {
  if (!name) return null;
  if (name.endsWith('·异变')) return resolveLineId(name.slice(0, -3), config);
  const tree = (config.pet.evolution && config.pet.evolution.tree) || {};
  const starters = (config.pet.starters || []).map(s => s.name);
  if (starters.indexOf(name) >= 0) return name;
  const lineMap = {};
  const mark = (base) => {
    const stack = [base];
    while (stack.length) {
      const cur = stack.pop();
      for (const r of (tree[cur] || [])) {
        const n = r.to;
        if (lineMap[n] === undefined) { lineMap[n] = base; stack.push(n); }
      }
    }
  };
  for (const base of starters) mark(base);
  return lineMap[name] !== undefined ? lineMap[name] : null;
}

// pets 行 → 模拟器宠物快照（与 petFromRow 同构；equipItems 按 id 索引）
function petFromRow(row, equipItemsById, config) {
  const pet = {
    name: row.name,
    icon: row.icon,
    lineId: resolveLineId(row.name, config) || row.name,
    growth: num(row.growth),
    level: num(row.level) || 1,
    baseHp: num(row.hp),
    baseAtk: num(row.attack),
    baseDef: num(row.defense),
    baseSpd: num(row.speed) || 40,
    traits: Array.isArray(row.traits) ? row.traits : [],
    awakened: !!row.awaken_trait,   // 永久觉醒标记（awaken_trait='1'，与等级无关）
    equipment: {},
    curHp: num(row.cur_hp),
    exp: num(row.exp)
  };
  // 装备：pets.equipment = {部位: cloudId}（DB 里可能缺列 → 空）
  const equipRef = (row.equipment && typeof row.equipment === 'object') ? row.equipment : {};
  for (const [slot, id] of Object.entries(equipRef)) {
    if (!id) continue;
    const item = equipItemsById && equipItemsById.get(String(id));
    if (item) pet.equipment[slot] = itemRowToEquip(item);
  }
  return pet;
}

// equip_items 行 → 模拟器装备对象（getEquipBonuses 所需结构）
function itemRowToEquip(row) {
  return {
    id: row.id,
    slot: row.slot,
    name: row.name,
    baseStats: (row.base_stats && typeof row.base_stats === 'object') ? row.base_stats : null,
    base: row.base || null,
    affixes: row.affixes || {},
    soulAffix: row.soul_affix || null
  };
}

// 经验发放（pet.js grantExp 同口径）：返回 { exp, level, leveled, crystal, expLeft }
// 满级后溢出经验按 expPool.perCrystal 凝晶石（P2 落材料表，这里只算数量）
function grantExp(expIn, levelIn, totalExp, config) {
  const expNeed = lv => Math.round((config.exp.needBase || 22) * Math.pow(lv, config.exp.needExponent || 1.3));
  const maxLevel = config.pet.maxLevel || 60;
  const perCrystal = (config.pet.expPool && config.pet.expPool.perCrystal) || 12000;
  let exp = expIn + totalExp;
  let level = levelIn;
  let leveled = false;
  while (level < maxLevel && exp >= expNeed(level)) {
    exp -= expNeed(level);
    level++;
    leveled = true;
  }
  let crystal = 0;
  let expLeft = exp;
  if (level >= maxLevel) {
    crystal = Math.floor(exp / perCrystal);
    expLeft = expNeed(level); // 满级封顶显示为满条
  }
  return { exp: expLeft, level, leveled, crystal };
}

/* ---------- 掉落（2026-09-11 甲：与前端 drop.js 同一套单池）----------
 * 之前这里硬编码「18% 材料、永不掉装备/蛋」，与 Config.drop 严重脱节
 * （配置写的是 material 8.5% / equipment 1.3% / egg 0.6%）。线上 70742 场战斗的
 * 明细里 equipment / egg 各 0 次，就是这段造成的。
 * 现在全部从 config.drop 读 —— 调掉率只改 config.drop.poolByStage 一处。
 * 确定性不变：同一个 settle 游标永远产出同一批掉落（种子 = seed + 场次序号）。 */
function areaMaterialOf(config, areaId) {
  const am = config && config.drop && config.drop.areaMaterials;
  const e = am && am[areaId];
  return (e && e.name) || null;
}
function poolForArea(config, areaId) {
  const D = (config && config.drop) || {};
  const areas = (config && config.battle && config.battle.areas) || [];
  const idx = areas.findIndex(a => a.id === areaId);
  const t0 = idx >= 0 ? idx + 1 : 1;
  const stage = t0 <= 3 ? 1 : (t0 <= 7 ? 2 : 3); // 与 drop.js 同口径：图1-3→1 / 4-7→2 / 8-10→3
  return (D.poolByStage && D.poolByStage[stage]) || D.pool || null;
}
function areaTierOf(config, areaId) {
  const areas = (config && config.battle && config.battle.areas) || [];
  const idx = areas.findIndex(a => a.id === areaId);
  const maxTier = ((config && config.equipment && config.equipment.baseTierMultipliers) || []).length || 6;
  return Math.max(1, Math.min(maxTier, idx >= 0 ? idx + 1 : 1));
}

function rewardForFight(fight, areaId, seed, index, config, equipGen) {
  if (!fight || !fight.win) return { type: 'none' };
  const material = areaMaterialOf(config, areaId);
  // 守关 Boss：保持原语义（必给区域材料 ×5），不走单池。
  // ⚠️ 与前端 drop.js 的 boss 分支（必掉金装 + 材料×5 + 魔石骰）尚未对齐，见审计报告。
  if (fight.isBoss) {
    return material ? { type: 'material', material, qty: 5, boss: true } : { type: 'none' };
  }
  const pool = poolForArea(config, areaId);
  if (!pool) return material ? { type: 'material', material, qty: 1 } : { type: 'none' };

  const entries = [['none', pool.none || 0], ['material', pool.material || 0],
    ['equipment', pool.equipment || 0], ['egg', pool.egg || 0]];
  const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
  if (!total) return { type: 'none' };
  let r = ((hashSeed(seed, areaId, index) % 1000000) / 1000000) * total;
  let tier = 'none';
  for (const [k, w] of entries) { if ((r -= Math.max(0, w)) < 0) { tier = k; break; } }

  if (tier === 'material') {
    return material ? { type: 'material', material, qty: 1 } : { type: 'none' };
  }
  if (tier === 'equipment') {
    if (!equipGen) return { type: 'none' };
    // 独立随机流（盐化种子）→ 不掉落装备时也不影响胜负/经验序列
    const rnd = mulberry32(hashSeed(seed, areaId, index, 'eq') >>> 0);
    const eq = equipGen(rnd).generateEquipment(null, areaTierOf(config, areaId), 0, Number(fight.lv) || 1, 0);
    eq.identified = false; // 与前端一致：掉落即未鉴定
    return { type: 'equipment', eq };
  }
  if (tier === 'egg') {
    const base = fight.enemy && fight.enemy.eggBaseName; // events 里带完整 enemy（battle-sim:721）
    return base ? { type: 'egg', baseName: base } : { type: 'none' };
  }
  return { type: 'none' };
}

// 完整结算编排（纯计算）—— 2026-09-09 架构改版：「服务器唯一模拟器 + 先记账后放片」
//   1) 补账窗（gapSeconds > 0）：把上次游标到现在的真实时间补算掉（客户端没看到/没演到的场次）
//   2) 剧本窗（nextSeconds）：预结算接下来一段挂机，生成【已入账的演出录像】下发给客户端纯回放
// 两窗链式衔接：补账窗的 endHp / 累计场数 / Boss 状态 = 剧本窗的起点。
// 经验只发一次账：grantExp 分两步链式（补账后真值 = 剧本窗起点基线 → 剧本窗后真值），
// 客户端从基线开始重演，演完正好落在服务器 expLeft（漂移为零，applyResult 只做兜底校准）。
function settlePlan({ session, petRow, equipItems, config, enemyList,
  gapSeconds = 0, gapSeed = 0, nextSeconds, nextSeed, bossState }) {
  const byId = new Map((equipItems || []).map(it => [String(it.id), it]));
  const pet = petFromRow(petRow, byId, config);
  const areaId = session.area_id;
  const offset0 = session.total_fights || 0; // 跨段累计场数（全局 fightNo 锚点）
  const bsIn = { lastBossFight: (bossState && bossState.lastBossFight != null) ? Number(bossState.lastBossFight) : null };

  // 1) 补账窗（真实经过但没演到的时间）
  let gap = null;
  if (gapSeconds > 0) {
    gap = simulateSessionScript({
      pet, areaId, seconds: gapSeconds, seed: gapSeed, config, enemyList,
      curHp: pet.curHp, fightOffset: offset0, bossState: bsIn
    });
  }
  const gapEvents = gap ? gap.events : [];
  const gapExp = gap ? gap.totalExp : 0;

  // 2) 剧本窗（接下来一段，先入账后回放）
  const scriptRaw = simulateSessionScript({
    pet, areaId, seconds: nextSeconds, seed: nextSeed, config, enemyList,
    curHp: gap ? gap.endHp : pet.curHp,
    fightOffset: offset0 + gapEvents.length,
    bossState: gap ? gap.bossState : bsIn
  });

  // 掉落归属：补账窗按 gapSeed、剧本窗按 nextSeed 派生（同游标重放结果一致，可对账）
  // 装备生成器工厂：只在真的掉到装备时才会被调用（约 1.3% 的场次），不是每场都建闭包
  const equipGen = (config && config.equipment)
    ? (rnd) => makeEquipGen(config.equipment, rnd)
    : null;
  const withReward = (e, seed, i) => Object.assign({}, e, { reward: rewardForFight(e, areaId, seed, offset0 + i, config, equipGen) });
  const gapDetail = gapEvents.map((e, i) => {
    const row = withReward(e, gapSeed, i);
    return { win: row.win, lv: row.enemyLevel, name: row.enemyName, exp: row.exp, hp: row.hpLeft, boss: !!row.isBoss, reward: row.reward };
  });
  const scriptEvents = scriptRaw.events.map((e, i) => withReward(e, nextSeed, gapEvents.length + i));
  const scriptDetail = scriptEvents.map(e => ({
    win: e.win, lv: e.enemyLevel, name: e.enemyName, exp: e.exp, hp: e.hpLeft, boss: !!e.isBoss, reward: e.reward
  }));

  // 经验链式两步：gGap = 补账后真值（剧本窗起点基线）；g = 剧本窗后真值（落库）
  const gGap = grantExp(pet.exp, pet.level, gapExp, config);
  const scriptExp = scriptRaw.totalExp;
  const g = grantExp(gGap.exp, gGap.level, scriptExp, config);

  const totalFights = gapEvents.length + scriptEvents.length;
  const totalExp = gapExp + scriptExp;
  return {
    // 演出录像（客户端纯回放；EF 再装饰 id/until/expLeft/level/expBefore/levelBefore）
    script: {
      events: scriptEvents,
      endHp: scriptRaw.endHp,
      petMaxHp: scriptRaw.petMaxHp,
      totalExp: scriptExp
    },
    // 补账明细（客户端只负责展示掉落，经验已在基线里，不再重复给）
    detail: gapDetail.slice(-50),
    // 审计日志明细（补账 + 剧本窗全部场次）
    logDetail: gapDetail.concat(scriptDetail).slice(-100),
    exp: g,
    petPatch: {
      cur_hp: Math.round(scriptRaw.endHp),
      exp: Math.max(0, g.exp),
      level: g.level
    },
    summary: {
      fights: totalFights,
      exp: totalExp,
      gapFights: gapEvents.length,
      gapExp,
      endHp: Math.round(scriptRaw.endHp),
      petMaxHp: scriptRaw.petMaxHp,
      level: g.level,
      leveled: g.leveled,
      crystal: g.crystal
    },
    result: {
      totalFights, totalExp,
      endHp: Math.round(scriptRaw.endHp),
      petMaxHp: scriptRaw.petMaxHp,
      bossState: scriptRaw.bossState,
      scriptExpBefore: gGap.exp,
      scriptLevelBefore: gGap.level
    }
  };
}

// 稳定种子：uid + session + 游标 → 32bit 哈希（同批次重复 settle 结果一致，可对账）
function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

export { petFromRow, itemRowToEquip, grantExp, settlePlan, hashSeed, resolveLineId, num, rewardForFight };
