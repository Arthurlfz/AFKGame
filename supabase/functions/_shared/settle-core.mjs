/* ============================================================
 * settle-core.mjs —— 结算纯计算核心（无 Deno/DB 依赖，node 可测）
 * 职责：
 *   1. petFromRow：pets 行 + equip_items 行 → 模拟器宠物快照
 *   2. grantExp：经验发放（与 pet.js grantExp 同口径，升级扣 need、满级封顶）
 *   3. settlePlan：完整结算编排（快照 → 模拟 → 经验 → 落库 patch 计划）
 * 输入输出均为纯数据，DB 读写由调用方（Edge Function / 测试桩）负责。
 * ============================================================ */
import { simulateSession } from './battle-sim.mjs';

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
    awaken_trait: row.awaken_trait || null,
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

// Server-authoritative material reward.  Keep this deliberately small and
// deterministic: the same settle cursor always produces the same drops.
const AREA_MATERIALS = {
  'corrupted-forest': '枯荣种荚', 'plague-swamp': '泣腐之泪',
  'shadow-mountains': '白骨残片', 'bone-wastes': '幽影魂丝',
  'blood-rift': '血潮凝晶', 'echo-cliffs': '回响之羽',
  'rotfen-bog': '腐沼黏液', 'ember-hollow': '余烬残灰',
  'soul-abyss': '魂渊之尘', 'blight-heart': '腐变之心',
  'rift-fissure': '裂隙碎片', 'black-blood-moor': '黑血凝块',
  'bone-abyss': '深渊骸片', 'plague-heart': '疫潮胞核',
  'soul-nest': '噬魂丝茧', 'annihilation-hall': '湮灭残响',
  'blight-origin': '本源腐核'
};

function rewardForFight(fight, areaId, seed, index) {
  if (!fight || !fight.win) return { type: 'none' };
  const material = AREA_MATERIALS[areaId];
  if (!material) return { type: 'none' };
  if (fight.isBoss) return { type: 'material', material, qty: 5, boss: true };
  const roll = (hashSeed(seed, areaId, index) % 10000) / 10000;
  return roll < 0.18 ? { type: 'material', material, qty: 1 } : { type: 'none' };
}

// 完整结算计划（纯计算）：输入会话/宠物/装备/时长 → 输出模拟结果 + 落库 patch
function settlePlan({ session, petRow, equipItems, seconds, seed, config, enemyList, bossState }) {
  const byId = new Map((equipItems || []).map(it => [String(it.id), it]));
  const pet = petFromRow(petRow, byId, config);
  const result = simulateSession({
    pet,
    areaId: session.area_id,
    seconds,
    seed,
    config,
    enemyList,
    curHp: pet.curHp,
    fightOffset: session.total_fights || 0, // 跨段累计场数（全局 fightNo 锚点）
    bossState // 守关 Boss 保底/冷却跨段状态（{ lastBossFight }，全局坐标）
  });
  const g = grantExp(pet.exp, pet.level, result.totalExp, config);
  const offset = Math.max(0, result.fights.length - 50);
  const detail = result.fights.slice(-50).map((f, i) => ({
    win: f.win, lv: f.enemyLevel, name: f.enemyName, exp: f.exp, hp: f.hpLeft,
    boss: !!f.isBoss, reward: rewardForFight(f, session.area_id, seed, offset + i)
  }));
  return {
    result, // simulateSession 完整输出（含 bossState）
    exp: g,
    detail,
    petPatch: {
      cur_hp: Math.round(result.endHp),
      exp: Math.max(0, g.exp),
      level: g.level
    },
    summary: {
      fights: result.totalFights,
      exp: result.totalExp,
      endHp: Math.round(result.endHp),
      petMaxHp: result.petMaxHp,
      level: g.level,
      leveled: g.leveled,
      crystal: g.crystal
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
