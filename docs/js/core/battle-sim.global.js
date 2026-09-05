// ⚠️ 自动生成：由 battle-sim.mjs 转换（node build-sim-global.js）。改逻辑请改 battle-sim.mjs 后重跑本脚本。
/* ============================================================
 * battle-sim.mjs —— 服务器权威战斗模拟（纯函数，无 DOM 依赖，ESM）
 * 从 docs/js/core/battle.js + docs/js/pet/pet.js + docs/js/equipment/equipment.js
 * 移植数值逻辑，**与前端同种子逐随机数一致**：
 *   1. 行动条自动回合制（速度决定行动条填充，先满先动，满值 100）
 *   2. 出手冻结演出窗口（hitAt+backMs 内行动条不动，对手不受牵连）
 *   3. **延迟伤害结算**：出手后 hitAt(320ms) 才结算（前端 setTimeout 语义），
 *      前摇期间被打死的对手其 pending 伤害作废 —— random 消耗顺序与前端完全一致
 *   4. 伤害 = 攻防减法(含穿透) → 暴击 → 伤害加成% → 受伤减免% → 吸血
 *   5. 主动技能（skillOf 档位缩放：tree 深度 → skillTierScale）+ 觉醒伤害加成
 *   6. 血统被动全套（骨狼/毒沼蛙/血狐/尸犬/瘟熊/幽影兔/疫毛兽/腐噜兽）
 *   7. 怪等级 = clamp(宠物等级, 图段)；怪数值 = 图中点基准 × 等级缩放 × typeMult
 *   8. 经验 = coef × 怪等级^exp × 难度 × rate，±jitter（expFromBattle 同源）
 *   9. 跨场循环：血量延续 + 场间 nextFightDelay + 低血/战败回血（每秒整跳 + 500ms 检查）
 * 随机源可注入（mulberry32，同种子 diff 测试）；时间单位毫秒。
 * ============================================================ */

// ---------- 纯函数工具 ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function pickWeighted(items, weightFn, rnd) {
  if (!items.length) return null;
  let total = items.reduce((s, x) => s + Math.max(0, Number(weightFn ? weightFn(x) : x.weight) || 0), 0);
  let r = rnd() * total;
  for (const it of items) {
    const w = Math.max(0, Number(weightFn ? weightFn(it) : it.weight) || 0);
    if ((r -= w) < 0) return it;
  }
  return items[0];
}
// mulberry32：确定性种子随机（服务器每次结算同种子 → 结果可复现/对账）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* ---------- 守关 Boss（2026-09-05 地图系统） ----------
 * 每累计 100 场出现 1 次（跨结算段累计：fightOffset = 本段开始前的会话总场数）。
 * Boss = 该图怪池 level 最高的怪，等级=图段上限，血×5、攻×1.5，名字前缀「霸主·」。
 * 是模拟逻辑不是新数据 → 服务器无需新增 enemy 数据，config-server 零改动。 */
const BOSS_INTERVAL = 100;
function pickBossEnemy(pool) {
  let best = pool[0];
  for (const e of pool) { if ((e.level || 0) > (best.level || 0)) best = e; }
  return best;
}

/* ============================================================
 * 属性计算（从 pet.js 移植：baseStats / statParts / getEquipBonuses /
 * addTraitStat / getAwakenState / getBloodline / getBaseSpeed）
 * 输入 pet 快照（与前端宠物对象同构）：
 *   name, lineId, level, growth, baseHp, baseAtk, baseDef, baseSpd,
 *   traits:[{id,tier}], equipment:{部位: 装备对象}, curHp
 * 输出：与前端 Pet.getStats 完全一致的 stats 对象。
 * ============================================================ */
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
function getBaseSpeed(pet, config) {
  const lineId = (pet && pet.lineId) || pet.name;
  const raw = config.pet.speeds[lineId];
  if (typeof raw === 'number' && raw > 0) return raw;
  const byName = config.pet.speeds[pet.name];
  if (typeof byName === 'number' && byName > 0) return byName;
  const root = resolveLineId(pet.name, config);
  if (root) {
    const rootSpd = config.pet.speeds[root];
    if (typeof rootSpd === 'number' && rootSpd > 0) return rootSpd;
  }
  const base = String(pet.name || '').replace(/·异变$/, '');
  const fallback = config.pet.speeds[base];
  return typeof fallback === 'number' && fallback > 0 ? fallback : 40;
}
function getStatCoeff(pet, config) {
  const lineId = (pet && pet.lineId) || (pet && pet.name);
  const st = (config.pet.starters || []).find(s => s.name === lineId);
  return (st && st.statCoeff) || config.pet.statCoeff || { hp: 5, atk: 2, def: 1 };
}
// 装备加成（从 equipment.js getEquipBonuses 移植）：pet.equipment = {部位: eq}
function getEquipBonuses(pet, config) {
  const SLOTS = ['武器', '戒指', '项链', '头盔', '护甲', '盾牌', '靴子', '腰带', '斗篷', '饰品', '护符', '徽章'];
  const flat = { atk: 0, hp: 0, def: 0, spd: 0, crit: 0, critDamage: 0, hit: 0, dodge: 0, lifesteal: 0 };
  const pct = { atk: 0, hp: 0, def: 0, spd: 0 };
  const resources = { dropQty: 1, dropRare: 1, matDrop: 1 };
  for (const slot of SLOTS) {
    const eq = pet.equipment && pet.equipment[slot];
    if (!eq) continue;
    const stats = eq.baseStats || (eq.base ? { [eq.base.type]: eq.base.value || 0 } : {});
    const affixes = flattenAffixes(eq.affixes || {});
    const own = {};
    for (const [type, value] of Object.entries(stats)) own[type] = value;
    for (const aff of affixes) {
      if (['dropQty', 'dropRare', 'matDrop'].includes(aff.type)) resources[aff.type] *= 1 + (aff.value || 0) / 100;
      else if (['atk', 'hp', 'def'].includes(aff.type)) pct[aff.type] += (aff.value || 0) / 100;
      else if (['crit', 'critDamage', 'lifesteal'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      else if (['hit', 'dodge', 'spd', 'pen'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      else if (['dmgBonus', 'dr'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      else own[aff.type] = (own[aff.type] || 0) + (stats[aff.type] || 0) * (aff.value || 0) / 100;
    }
    if (eq.soulAffix) {
      const aff = eq.soulAffix;
      if (['atk', 'hp', 'def'].includes(aff.type)) pct[aff.type] += (aff.value || 0) / 100;
      else if (['crit', 'critDamage', 'lifesteal'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      else if (['hit', 'dodge', 'spd'].includes(aff.type)) own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
      else own[aff.type] = (own[aff.type] || 0) + (aff.value || 0);
    }
    for (const [type, value] of Object.entries(own)) flat[type] = (flat[type] || 0) + value;
  }
  return { flat, pct, resources };
}
// 词缀展平（equipment.js flattenAffixes 结构：affixes = {前缀: [], 后缀: []} 或数组）
function flattenAffixes(affixes) {
  if (Array.isArray(affixes)) return affixes;
  const out = [];
  for (const k of Object.keys(affixes || {})) {
    const list = affixes[k];
    if (Array.isArray(list)) out.push(...list);
    else if (list) out.push(list);
  }
  return out;
}
function getAwakenState(pet, config) {
  if (!pet || Number(pet.level) < 60) return null;
  const skills = (config.pet && config.pet.evolution && config.pet.evolution.activeSkills) || {};
  const baseName = String(pet.name || '').replace(/·异变$/, '');
  const skill = skills[baseName];
  if (!skill) return null;
  const line = pet.lineId || pet.name;
  const raw = (config.awakenBonus && config.awakenBonus[line]) || {};
  const rawKey = Object.keys(raw)[0];
  return {
    skillId: skill.id, skillName: skill.name,
    damage: config.awakenSkillDamage != null ? config.awakenSkillDamage : 0.2,
    bonus: rawKey ? { stat: rawKey, value: raw[rawKey] } : null,
  };
}
function getBloodline(pet, config) {
  if (!pet || !config.bloodlinePassive) return null;
  const baseName = pet.lineId || resolveLineId(pet.name, config) || pet.name;
  return config.bloodlinePassive[baseName] || null;
}
// 主动技能档位（从 config.js skillOf/formInfoOf 移植，JSON 化后函数丢失需重建）
function skillOf(pet, config) {
  const evo = config.pet && config.pet.evolution;
  if (!evo) return null;
  const name = String(pet.name || '').replace(/·异变$/, '');
  const tree = evo.tree || {};
  let cur = name, steps = 0;
  let routes = tree[cur];
  while (routes && routes.length) { steps++; cur = routes[0].to; routes = tree[cur]; }
  const info = { final: cur, depth: 3 - steps };
  const skill = (evo.activeSkills || {})[info.final];
  if (!skill) return null;
  if (info.depth <= 0) return null;
  const tierIdx = Math.max(0, Math.min(2, info.depth - 1));
  const scale = (evo.skillTierScale && evo.skillTierScale[tierIdx]) || { chance: 1, damage: 1 };
  const chance = Math.round(((skill.triggerChance || 0) * scale.chance) * 100) / 100;
  const mult = Math.round((1 + ((skill.damageMultiplier || 1) - 1) * scale.damage) * 100) / 100;
  return Object.assign({}, skill, { triggerChance: chance, damageMultiplier: mult, tier: tierIdx + 1, tierName: ['I', 'II', 'III'][tierIdx] });
}
function addTraitStat(pet, flat, pct, config) {
  const defs = config.petTraits || {};
  for (const t of (pet && pet.traits) || []) {
    const d = defs[t.id]; if (!d) continue;
    const v = (d.values && d.values[t.tier]) || 0;
    if (d.type === 'hp') pct.hp = (pct.hp || 0) + v / 100;
    else if (d.type === 'def') pct.def = (pct.def || 0) + v / 100;
    else if (d.type === 'critRate') flat.crit = (flat.crit || 0) + v;
    else if (d.type === 'critDamage') flat.critDamage = (flat.critDamage || 0) + v;
    else if (d.type === 'lifesteal') flat.lifesteal = (flat.lifesteal || 0) + v;
    else if (d.type === 'hit') flat.hit = (flat.hit || 0) + v;
    else if (d.type === 'dodge') flat.dodge = (flat.dodge || 0) + v;
    else if (d.type === 'spd') flat.spd = (flat.spd || 0) + v;
  }
  const aw = getAwakenState(pet, config);
  if (aw && aw.bonus && aw.bonus.stat) {
    const k = aw.bonus.stat, v = aw.bonus.value;
    if (k === 'hp') pct.hp = (pct.hp || 0) + v / 100;
    else if (k === 'def') pct.def = (pct.def || 0) + v / 100;
    else if (k === 'spd') flat.spd = (flat.spd || 0) + v;
    else if (k === 'critDamage') flat.critDamage = (flat.critDamage || 0) + v;
    else if (k === 'lifesteal') flat.lifesteal = (flat.lifesteal || 0) + v;
  }
}
function petStats(pet, config) {
  const eq = getEquipBonuses(pet, config) || {};
  const flat = Object.assign({}, eq.flat);
  const pct = Object.assign({}, eq.pct);
  addTraitStat(pet, flat, pct, config);
  const prof = (config.pet.petProfiles && config.pet.petProfiles[pet.lineId || pet.name]) || config.pet.defaultPetProfile || {};
  const baseHit = prof.hit != null ? Number(prof.hit) : 90;
  const baseDodge = prof.dodge != null ? Number(prof.dodge) : 0;
  const baseCrit = (prof.critRate != null ? Number(prof.critRate) : 5) / 100;
  const baseCritDmg = (prof.critDamage != null ? Number(prof.critDamage) : 150) / 100;
  const baseLs = (prof.lifesteal != null ? Number(prof.lifesteal) : 0) / 100;
  const bl = getBloodline(pet, config);
  let blCrit = 0, blHit = 0, blDodge = 0;
  if (bl && bl.type === 'allStatBonus' && bl.params) {
    blCrit = bl.params.critRate || 0;
    blHit = (bl.params.hit || 0) * 100;
    blDodge = (bl.params.dodge || 0) * 100;
  }
  const g = Number(pet.growth) || 0, lv = Number(pet.level) || 1, C = getStatCoeff(pet, config);
  const coreHp = pet.baseHp + Math.round(lv * C.hp);
  const coreAtk = pet.baseAtk + Math.round(lv * C.atk);
  const coreDef = pet.baseDef + Math.round(lv * C.def);
  const totalHp = pet.baseHp + Math.round(lv * g * C.hp);
  const totalAtk = pet.baseAtk + Math.round(lv * g * C.atk);
  const totalDef = pet.baseDef + Math.round(lv * g * C.def);
  const baseSpd = pet.baseSpd != null ? pet.baseSpd : getBaseSpeed(pet, config);
  return {
    atk: Math.round(coreAtk * (1 + (pct.atk || 0)) + (totalAtk - coreAtk) + (flat.atk || 0)),
    hp: Math.round(coreHp * (1 + (pct.hp || 0)) + (totalHp - coreHp) + (flat.hp || 0)),
    def: Math.round(coreDef * (1 + (pct.def || 0)) + (totalDef - coreDef) + (flat.def || 0)),
    spd: baseSpd + (flat.spd || 0),
    critRate: baseCrit + (flat.crit || 0) / 100 + blCrit,
    critDamage: baseCritDmg + (flat.critDamage || 0) / 100,
    hit: baseHit + (flat.hit || 0) + blHit,
    dodge: baseDodge + (flat.dodge || 0) + blDodge,
    lifesteal: baseLs + (flat.lifesteal || 0) / 100,
    pen: (flat.pen || 0),
    dmgBonus: (flat.dmgBonus || 0),
    dr: (flat.dr || 0),
    growth: Number(pet.growth) || 0
  };
}

/* ============================================================
 * 单场伤害结算（从 battle.js calcDamage 移植）
 * ============================================================ */
function calcDamage(att, defStats, config, rnd) {
  const hit = Math.max(0, att.hit || 0);
  const dodge = Math.max(0, defStats.dodge || 0);
  const hitChance = hit + dodge > 0
    ? Math.max(0.05, Math.min(0.95, hit / (hit + dodge)))
    : 0.05;
  if (rnd() >= hitChance) {
    return { damage: 0, isCrit: false, isMiss: true, heal: 0 };
  }
  const rate = (att.critRate == null) ? config.battle.critRate : att.critRate;
  const mult = (att.critDamage == null) ? config.battle.critMultiplier : att.critDamage;
  const isCrit = rnd() < rate;
  const effDef = Math.max(0, defStats.def - Math.max(0, att.pen || 0));
  let dmg = Math.max(1, att.atk - effDef);
  if (isCrit) dmg = Math.floor(dmg * mult);
  if (att.dmgBonus) dmg = Math.floor(dmg * (1 + att.dmgBonus / 100));
  const dr = Math.min(90, Math.max(0, defStats.dr || 0));
  if (dr > 0) dmg = Math.max(1, Math.floor(dmg * (100 - dr) / 100));
  const lifesteal = att.lifesteal == null ? 0 : att.lifesteal;
  const heal = lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;
  return { damage: dmg, isCrit, isMiss: false, heal };
}

/* ============================================================
 * 单场战斗（与 battle.js tick/step/doTurn 逐随机数一致）
 * 核心：伤害延迟 hitAt(320ms) 结算 —— 出手只消耗「技能判定」random，
 * hitAt 后才消耗「命中/暴击/血统」random；前摇期间死亡的对手其 pending 作废。
 * ============================================================ */
function simulateFight(input) {
  const { pet, stats, area, enemyData, config, rnd } = input;
  const B = config.battle;
  const lv = Number(pet.level) || 1;
  const range = (area && area.levelRange) || [1, 6];
  const lo = Math.min(range[0], range[1]), hi = Math.max(range[0], range[1]);
  // 守关 Boss（2026-09-05）：等级=图段上限（不受宠物等级钳制），血×5、攻×1.5
  const isBoss = !!(enemyData && enemyData.isBoss);
  const enemyLevel = isBoss ? hi : Math.min(hi, Math.max(lo, Math.max(1, lv)));
  const enemy = { ...enemyData, level: enemyLevel };
  // 怪数值 = 图中点基准 × clamp(怪等级/图中点) × typeMult × diff（battle.js scaleEnemyStats）
  const diff = (area && area.difficulty) || 1.0;
  const base = (B.areaEnemyStats || {})[area && area.id] || { hp: 320, atk: 72, def: 30 };
  const tm = ((area && area.enemyMult) || (B.typeMult || {})[enemy.enemyType]) || 1.0;
  const [arLo, arHi] = (area && area.levelRange) || [1, 10];
  const mid = (arLo + arHi) / 2;
  const clampCfg = B.levelScaleClamp || [0.25, 1.6];
  const ratio = Math.max(clampCfg[0], Math.min(clampCfg[1], (enemy.level || 1) / mid));
  const hp = Math.round(base.hp * ratio * tm * diff * (isBoss ? 5 : 1));
  const def = Math.round(base.def * ratio * tm * diff);
  const atk = Math.round(base.atk * ratio * tm * diff * (isBoss ? 1.5 : 1));
  const E = {
    name: (isBoss ? '霸主·' : '') + enemy.name, icon: enemy.icon, level: enemyLevel,
    hp, maxHp: hp, atk, def,
    spd: enemy.spd, // 与前端一致：enemy-data 必配 spd；缺省则 NaN（前端同样行为）
    critRate: enemy.critRate != null ? enemy.critRate : B.critRate,
    critDamage: enemy.critDamage != null ? enemy.critDamage : B.critMultiplier,
    hit: enemy.hit != null ? enemy.hit : 90,
    dodge: enemy.dodge != null ? enemy.dodge : (enemy.enemyType === 'mutant' ? 12 : enemy.enemyType === 'evolved' ? 8 : 5),
    lifesteal: enemy.lifesteal != null ? enemy.lifesteal : 0,
    pen: enemy.pen != null ? enemy.pen : 0,
    dmgBonus: enemy.dmgBonus != null ? enemy.dmgBonus : 0,
    dr: enemy.dr != null ? enemy.dr : 0
  };
  const P = {
    name: pet.name, icon: pet.icon, level: lv,
    hp: Number(input.curHp) || stats.hp, maxHp: stats.hp,
    atk: stats.atk, def: stats.def, spd: stats.spd,
    critRate: stats.critRate, critDamage: stats.critDamage, hit: stats.hit, dodge: stats.dodge,
    lifesteal: stats.lifesteal, pen: stats.pen || 0, dmgBonus: stats.dmgBonus || 0, dr: stats.dr || 0
  };
  // 主动技能（skillOf 档位缩放）
  const skillDef = skillOf(pet, config);
  const activeSkill = skillDef && P.level >= skillDef.minLevel ? skillDef : null;
  const awakenMult = (getAwakenState(pet, config) || {}).damage || 0;
  let skillCooldown = 0, skillQueued = false;
  // 血统
  const bl = getBloodline(pet, config);
  let killBuffActive = !!input.pendingKillBuff;
  let corruptionStacks = 0;
  const scale = B.speedScale || 1;
  const hitAt = 320, backMs = 300;
  const freeze = { pet: false, enemy: false };
  const freezeUntil = { pet: 0, enemy: 0 };
  let pendingKillBuffOut = input.pendingKillBuff === true;
  let t = 0;
  const MAX_MS = 300000;
  const pending = []; // { at, fn } 延迟伤害（按注册顺序 = 前端 setTimeout 顺序）
  let fightEnded = false;
  const events = [];

  const aspdMult = () => {
    if (!bl || bl.type !== 'speedAspd' || !bl.params) return 1;
    const p = bl.params;
    const spd = P.spd;
    if (spd <= p.threshold) return 1;
    const bonus = Math.min(p.cap, Math.floor((spd - p.threshold) / p.perPoint) * p.bonusPer);
    return 1 + bonus;
  };
  const doTurn = (attacker) => {
    if (P.hp <= 0 || E.hp <= 0) return;
    const isPet = attacker === 'pet';
    const atkData = isPet ? P : E;
    const defData = isPet ? E : P;
    // 主动技能概率触发（只消耗一次 random；伤害 random 在 hitAt 后才消耗）
    if (isPet && activeSkill && skillCooldown <= 0 && !skillQueued && rnd() < (activeSkill.triggerChance || 0.30)) {
      skillQueued = true;
    }
    const skill = isPet && skillQueued ? activeSkill : null;
    if (skill) {
      skillQueued = false;
      skillCooldown = skill.cooldownTurns;
    }
    // 冻结出手方（hitAt+backMs）
    freeze[attacker] = true;
    freezeUntil[attacker] = t + hitAt + backMs;
    // 延迟伤害结算（前端 setTimeout 语义）
    const atkRef = atkData, defRef = defData;
    pending.push({
      at: t + hitAt,
      fn: () => {
        const result = calcDamage(atkRef, defRef, config, rnd);
        let dmgMult = 1;
        if (isPet && bl) {
          if (bl.type === 'killDamageBuff' && killBuffActive && bl.params) {
            dmgMult *= bl.params.damageMult || 1.5;
            killBuffActive = false;
          }
          if (bl.type === 'corruptionStack' && corruptionStacks > 0 && bl.params) {
            dmgMult *= 1 + (bl.params.perStack || 0.05) * corruptionStacks;
          }
        }
        const bonus = skill && !result.isMiss
          ? Math.floor(result.damage * (skill.damageMultiplier * (1 + awakenMult) - 1)) + Math.floor(defRef.maxHp * (skill.maxHpDamageRate || 0))
          : 0;
        const damage = Math.floor(result.damage * dmgMult) + bonus;
        defRef.hp -= damage;
        if (result.heal > 0) atkRef.hp = Math.min(atkRef.maxHp, atkRef.hp + result.heal);
        events.push({ t, by: attacker, dmg: damage, crit: result.isCrit, miss: result.isMiss, skill: !!skill });
        // 血统触发（与前端同序：伤害结算后）
        if (bl && isPet && !result.isMiss) {
          if (bl.type === 'onCritExtraHit' && result.isCrit && bl.params && rnd() < bl.params.chance) {
            const extraDmg = Math.max(1, Math.floor((atkRef.atk - defRef.def) * (bl.params.damageMult || 1)));
            defRef.hp -= extraDmg;
            events.push({ t, by: attacker, dmg: extraDmg, crit: false, miss: false, skill: false, note: 'extra' });
          }
          if (bl.type === 'corruptionStack' && bl.params) {
            corruptionStacks = Math.min(bl.params.maxStacks || 5, corruptionStacks + 1);
          }
          if (bl.type === 'lifestealTrueDamage' && result.heal > 0 && bl.params) {
            const trueDmg = Math.floor(result.heal * (bl.params.ratio || 1));
            defRef.hp -= trueDmg;
            events.push({ t, by: attacker, dmg: trueDmg, crit: false, miss: false, skill: false, note: 'true' });
          }
        }
        if (bl && !isPet && !result.isMiss && bl.type === 'onHitReflect' && bl.params) {
          const reflectDmg = Math.floor(P.def * (bl.params.defRatio || 0.3));
          atkRef.hp -= reflectDmg;
          events.push({ t, by: attacker, dmg: reflectDmg, crit: false, miss: false, skill: false, note: 'reflect' });
        }
        if (bl && !isPet && result.isMiss && bl.type === 'onDodgeCounter' && bl.params) {
          const counterDmg = Math.max(1, Math.floor((P.atk - atkRef.def) * (bl.params.damageMult || 0.8)));
          atkRef.hp -= counterDmg;
          events.push({ t, by: attacker, dmg: counterDmg, crit: false, miss: false, skill: false, note: 'counter' });
        }
      }
    });
    // 冷却递减（前端同序：doTurn 末尾，仅未放技能回合）
    if (isPet && skillCooldown > 0 && !skill) skillCooldown--;
  };
  const step = () => {
    t += 100;
    // 结算所有到期延迟伤害（按注册顺序 = 前端 setTimeout 顺序）
    let i = 0;
    while (i < pending.length) {
      if (pending[i].at <= t) { const h = pending.splice(i, 1)[0]; h.fn(); }
      else i++;
    }
    // 解冻（freezeUntil 时刻到）
    if (t >= freezeUntil.pet) freeze.pet = false;
    if (t >= freezeUntil.enemy) freeze.enemy = false;
    if (!freeze.pet) P.hp !== undefined && (P._action = (P._action || 0) + P.spd * aspdMult() / scale);
    if (!freeze.enemy) E._action = (E._action || 0) + E.spd / scale;
    if (!freeze.pet && P._action >= 100) { P._action = 0; doTurn('pet'); }
    if (!freeze.enemy && E._action >= 100) { E._action = 0; doTurn('enemy'); }
    if (!fightEnded && (P.hp <= 0 || E.hp <= 0)) fightEnded = true;
  };

  while (!fightEnded && t < MAX_MS) step();
  const win = P.hp > 0;
  return {
    win,
    petHpLeft: Math.max(0, Math.round(P.hp)),
    enemyHpLeft: Math.round(E.hp), // 怪血保留打穿后的负值（与前端 endFight 后 state.enemy.hp 一致）
    petMaxHp: P.maxHp, enemyLevel: E.level, enemyName: E.name, enemyType: enemy.enemyType, isBoss,
    durationMs: t, // 战斗耗时（前端 tick 每 100ms 一步，到 endFight 为止）
    events, killBuffActive, corruptionStacks
  };
}

/* ============================================================
 * 经验（从 pet.js expFromBattle 移植）
 * ============================================================ */
function expFromBattle(enemyLevel, area, config, rnd) {
  const E = config.exp;
  const lv = Math.max(1, Number(enemyLevel) || 1);
  const diff = Number(area && area.difficulty) || 1;
  const rate = Number(E.rate) || 1;
  const base = E.perWinCoef * Math.pow(lv, E.perWinExponent) * diff * rate;
  const j = Number(E.perWinJitter) || 0;
  const factor = 1 + (rnd() * 2 - 1) * j;
  return Math.max(E.perWinMin || 1, Math.round(base * factor));
}

/* ============================================================
 * 挂机会话模拟（跨场循环，与前端 battle.js endFight 流程一致）
 * 时间模型：100ms 片；回血 = 每秒整跳 maxHp×0.2；recover 检查 = 每 500ms
 * 输入：{ pet, areaId, seconds, seed, config, enemyList, curHp }
 * ============================================================ */
function simulateSession(input) {
  const { pet, areaId, seconds, seed, config, enemyList, curHp, fightOffset } = input;
  const rnd = mulberry32(seed || 1);
  const B = config.battle;
  const area = (B.areas || []).find(a => a.id === areaId);
  if (!area) throw new Error('AREA_NOT_FOUND: ' + areaId);
  const stats = petStats(pet, config);
  let hp = clamp(Number(curHp) || stats.hp, 0, stats.hp);
  let pendingKillBuff = false;
  let totalFights = 0, totalExp = 0;
  const fights = [];
  let msLeft = Math.max(0, Number(seconds) || 0) * 1000;
  let regenAccum = 0;   // 回血毫秒累计（满 1000 跳一次 = 前端 regenTick 每秒）
  let checkAccum = 0;   // recover 检查毫秒累计（满 500 查一次 = 前端 recoverTimer）
  let waitingRecover = false;

  const regenTick = (dtMs) => {
    // 与 pet.js regenTick 同口径：每秒 +maxHp×ratio（按 dtMs 折算，浮点累加）
    if (!(stats.hp > 0) || hp >= stats.hp) return;
    hp = Math.min(stats.hp, hp + stats.hp * (config.regen.hpPerSecRatio || 0.2) * dtMs / 1000);
  };
  // 场间 / 回血等待的时间片（不推进战斗）
  const idleSlice = (dtMs) => {
    regenAccum += dtMs;
    if (regenAccum >= 1000) { regenTick(regenAccum); regenAccum = 0; }
    if (waitingRecover) {
      checkAccum += dtMs;
      if (checkAccum >= 500) {
        checkAccum = 0;
        if (hp >= stats.hp) waitingRecover = false; // 回满自动接下一场
      }
    }
  };

  // 图怪池（battle.js getAreaEnemyPool）
  const [areaMin, areaMax] = (area && area.levelRange) || [1, 60];
  const areaIds = new Set((area && area.enemyIds) || []);
  const pool = (enemyList || []).filter(enemy => {
    if (!areaIds.has(enemy.id)) return false;
    const [eMin, eMax] = enemy.levelRange || [enemy.level || 1, enemy.level || 1];
    return eMax >= areaMin && eMin <= areaMax;
  });

  while (msLeft > 0 && totalFights < 100000) {
    // 非战斗推进：场间等待 / 回血
    if (waitingRecover || hp < stats.hp) {
      const slice = Math.min(100, msLeft);
      idleSlice(slice);
      msLeft -= slice;
      continue;
    }
    // 满血且不在 recover：打一场
    if (!pool.length) break;
    // 守关 Boss：跨段累计场数（fightOffset + 本段场数）到整百出 Boss
    const fightNo = totalFights + (Number(fightOffset) || 0);
    const isBossTurn = (fightNo + 1) % BOSS_INTERVAL === 0;
    const picked = isBossTurn ? { ...pickBossEnemy(pool), isBoss: true } : pickWeighted(pool, x => x.weight || 1, rnd);
    const fight = simulateFight({
      pet, stats, area, enemyData: picked, config, rnd,
      curHp: hp, pendingKillBuff
    });
    hp = fight.petHpLeft;
    pendingKillBuff = fight.win && fight.killBuffActive;
    totalFights++;
    const xp = fight.win ? expFromBattle(fight.enemyLevel, area, config, rnd) : 0;
    if (fight.win) totalExp += xp;
    fights.push({ win: fight.win, enemyLevel: fight.enemyLevel, enemyName: fight.enemyName, exp: xp, hpLeft: hp, isBoss: !!fight.isBoss });
    // 扣除战斗耗时（前端 tick 每 100ms 一步推进到 endFight，真实挂机同样消耗这些时间）
    msLeft -= fight.durationMs;
    // 战败 → 等待回血；血量低 → 等待回血；健康 → 场间隔（nextFightDelay）
    const stopRatio = B.stopHpRatio || 0.3;
    if (msLeft <= 0) break;
    if (!fight.win) { waitingRecover = true; }
    else if (hp <= stats.hp * stopRatio) { waitingRecover = true; }
    else {
      // 场间隔：回血照跑（前端 nextFightTimer 期间 main.js regenTick 依然每秒执行）
      let gapLeft = B.nextFightDelay || 600;
      while (gapLeft > 0 && msLeft > 0) {
        const slice = Math.min(100, Math.min(gapLeft, msLeft));
        idleSlice(slice);
        gapLeft -= slice; msLeft -= slice;
      }
      if (gapLeft > 0) break; // 时间片耗尽，本次结算到此为止
    }
  }
  return { fights, totalFights, totalExp, endHp: Math.max(0, Math.round(hp)), petMaxHp: stats.hp };
}

/* ============================================================
 * simulateSessionScript —— 带时间轴的会话模拟（前端演出专用）
 * 与 simulateSession 完全同结构同 rng 消耗序（同 seed → 同结果），
 * 但输出的是"演出剧本"：每场的开始/结束时刻、起止血量、胜负、经验、完整敌人数据。
 * 演出循环按剧本回放，血量轨迹 = 服务器模拟轨迹本身（宏观确定性，微观每刀为演出近似）。
 * ⚠️ 本函数只存在于前端副本；改 simulateSession 循环结构时必须同步这里。
 * ============================================================ */
function simulateSessionScript(input) {
  const { pet, areaId, seconds, seed, config, enemyList, curHp, fightOffset } = input;
  const rnd = mulberry32(seed || 1);
  const B = config.battle;
  const area = (B.areas || []).find(a => a.id === areaId);
  if (!area) throw new Error('AREA_NOT_FOUND: ' + areaId);
  const stats = petStats(pet, config);
  let hp = clamp(Number(curHp) || stats.hp, 0, stats.hp);
  let pendingKillBuff = false;
  let msLeft = Math.max(0, Number(seconds) || 0) * 1000;
  let regenAccum = 0, checkAccum = 0, waitingRecover = false;
  let tMs = 0;
  const events = [];
  const regenTick2 = (dtMs) => {
    if (!(stats.hp > 0) || hp >= stats.hp) return;
    hp = Math.min(stats.hp, hp + stats.hp * (config.regen.hpPerSecRatio || 0.2) * dtMs / 1000);
  };
  const idleSlice2 = (dtMs) => {
    regenAccum += dtMs;
    if (regenAccum >= 1000) { regenTick2(regenAccum); regenAccum = 0; }
    if (waitingRecover) {
      checkAccum += dtMs;
      if (checkAccum >= 500) { checkAccum = 0; if (hp >= stats.hp) waitingRecover = false; }
    }
  };
  const [aMin, aMax] = (area.levelRange) || [1, 60];
  const ids = new Set(area.enemyIds || []);
  const pool = (enemyList || []).filter(e => {
    if (!ids.has(e.id)) return false;
    const [m1, m2] = e.levelRange || [e.level || 1, e.level || 1];
    return m2 >= aMin && m1 <= aMax;
  });
  while (msLeft > 0 && events.length < 200) {
    if (waitingRecover || hp < stats.hp) {
      const s = Math.min(100, msLeft);
      idleSlice2(s); msLeft -= s; tMs += s;
      continue;
    }
    if (!pool.length) break;
    const fightNo = events.length + (Number(fightOffset) || 0);
    const isBossTurn = (fightNo + 1) % BOSS_INTERVAL === 0;
    const picked = isBossTurn ? { ...pickBossEnemy(pool), isBoss: true } : pickWeighted(pool, x => x.weight || 1, rnd);
    const hpStart = hp, t0 = tMs;
    const fight = simulateFight({ pet, stats, area, enemyData: picked, config, rnd, curHp: hp, pendingKillBuff });
    hp = fight.petHpLeft;
    pendingKillBuff = fight.win && fight.killBuffActive;
    const xp = fight.win ? expFromBattle(fight.enemyLevel, area, config, rnd) : 0;
    events.push({
      type: 'fight', t0, t1: tMs + fight.durationMs,
      win: fight.win, enemy: picked, enemyLevel: fight.enemyLevel, enemyName: fight.enemyName,
      exp: xp, hpStart, hpLeft: hp, durationMs: fight.durationMs, isBoss: !!fight.isBoss
    });
    tMs += fight.durationMs; msLeft -= fight.durationMs;
    const stopRatio = B.stopHpRatio || 0.3;
    if (msLeft <= 0) break;
    if (!fight.win || hp <= stats.hp * stopRatio) waitingRecover = true;
    else {
      let gapLeft = B.nextFightDelay || 600;
      while (gapLeft > 0 && msLeft > 0) {
        const s = Math.min(100, Math.min(gapLeft, msLeft));
        idleSlice2(s); gapLeft -= s; msLeft -= s; tMs += s;
      }
      if (gapLeft > 0) break;
    }
  }
  return { events, endHp: Math.max(0, Math.round(hp)), petMaxHp: stats.hp, totalExp: events.reduce((s, e) => s + (e.exp || 0), 0) };
}

window.BattleSim = { simulateSession, simulateSessionScript, simulateFight, petStats, calcDamage, expFromBattle, mulberry32, pickWeighted, skillOf, getEquipBonuses, getBloodline, getAwakenState };
