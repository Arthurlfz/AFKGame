// 由 supabase/gen_equip_gen.js 自动生成（勿手改）—— 与 docs/js/equipment/equipment.js 同源
// 生成时间：2026-09-11T12:10:27.843Z
/* 服务端装备生成：与前端同一份逻辑，靠构建期抽取而非手抄。
 * 用法：const gen = makeEquipGen(config.equipment, rnd);   // rnd: () => [0,1)
 *       const eq = gen.generateEquipment(null, areaTier, 0, ilvl, countBonus);
 *       // 参数与前端 generateEquipment(rarity, areaTier, materialTier, ilvl, countBonus) 完全一致
 *       // （rarity / materialTier 已被内部忽略，仅为兼容旧调用签名） */
const SLOTS = ["武器","戒指","项链","头盔","护甲","盾牌","靴子","腰带","斗篷","饰品","护符","徽章"];
const SLOT_INFO = {"武器":{"names":["短剑","战斧","长弓","法杖"],"bases":[{"type":"atk","label":"攻击","value":30}]},"戒指":{"names":["铁戒","骨戒"],"bases":[{"type":"atk","label":"攻击","value":15},{"type":"crit","label":"暴击率","value":2}]},"项链":{"names":["狼牙项链","灵魂项链"],"bases":[{"type":"atk","label":"攻击","value":15},{"type":"critDamage","label":"暴击伤害","value":8}]},"头盔":{"names":["铁盔","骨盔"],"bases":[{"type":"def","label":"防御","value":15}]},"护甲":{"names":["锁甲","胸甲"],"bases":[{"type":"hp","label":"生命","value":80},{"type":"def","label":"防御","value":8}]},"盾牌":{"names":["圆盾","塔盾"],"bases":[{"type":"def","label":"防御","value":15},{"type":"dodge","label":"闪避","value":5}]},"靴子":{"names":["战靴","影靴"],"bases":[{"type":"spd","label":"速度","value":8}]},"腰带":{"names":["重腰带","猎手腰带"],"bases":[{"type":"hp","label":"生命","value":60},{"type":"spd","label":"速度","value":5}]},"斗篷":{"names":["黑斗篷","影纱"],"bases":[{"type":"dodge","label":"闪避","value":10},{"type":"hp","label":"生命","value":50}]},"饰品":{"names":["徽记坠饰","战斗饰品"],"bases":[{"type":"atk","label":"攻击","value":12},{"type":"hit","label":"命中","value":5}]},"护符":{"names":["生命护符","吸血护符"],"bases":[{"type":"lifesteal","label":"吸血","value":4}]},"徽章":{"names":["铁徽章","王者徽章"],"bases":[{"type":"crit","label":"暴击率","value":3},{"type":"critDamage","label":"暴击伤害","value":10}]}};
const LABELS = {"atk":"攻击","hp":"生命","def":"防御","spd":"速度","crit":"暴击率","critDamage":"暴击伤害","hit":"命中","dodge":"闪避","lifesteal":"吸血","pen":"穿透","dmgBonus":"伤害加成","dr":"受伤减免"};
const AFFIX_POOL = [{"type":"atk","label":"攻击","category":"prefix","weight":100},{"type":"hp","label":"生命","category":"prefix","weight":100},{"type":"def","label":"防御","category":"prefix","weight":100},{"type":"lifesteal","label":"吸血","category":"prefix","weight":60},{"type":"spd","label":"速度","category":"suffix","weight":60},{"type":"crit","label":"暴击率","category":"suffix","weight":55},{"type":"critDamage","label":"暴击伤害","category":"suffix","weight":45},{"type":"hit","label":"命中","category":"suffix","weight":50},{"type":"dodge","label":"闪避","category":"suffix","weight":40},{"type":"pen","label":"穿透","category":"suffix","weight":45},{"type":"dmgBonus","label":"伤害加成","category":"suffix","weight":45},{"type":"dr","label":"受伤减免","category":"suffix","weight":40},{"type":"dropQty","label":"掉落数量","category":"suffix","weight":15},{"type":"dropRare","label":"掉落稀有度","category":"suffix","weight":12},{"type":"matDrop","label":"材料掉率","category":"suffix","weight":10}];

export function makeEquipGen(cfg, rnd) {
  // 遮蔽 Math：抽取来的源码写的是 Math.random()，原型链挂真 Math 保证 round/floor 等照常可用，
  // 只把 random 换成注入的 rnd → 随机源可注入、源码零改写。（Math 的方法不可枚举，
  // 所以不能用 Object.assign({}, Math)，必须走原型链。）
  const Math = Object.create(globalThis.Math);
  Math.random = rnd;
  const Config = { equipment: cfg };
  const Util = {
    randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
    randFloat(a, b) { return a + Math.random() * (b - a); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    pickWeighted(items) { // items: [{weight,...}]，按权重随机
          let total = items.reduce((s, i) => s + i.weight, 0), r = Math.random() * total;
          for (const it of items) { if ((r -= it.weight) < 0) return it; }
          return items[0];
        }
  };
  let uid = 1;
  const AFFIX_TIER_TABLES = {
    spd: () => Config.equipment.speedAffixTiers,
    lifesteal: () => Config.equipment.lifestealAffixTiers,
    crit: () => Config.equipment.critAffixTiers,
    critDamage: () => Config.equipment.critDamageAffixTiers,
    pen: () => Config.equipment.penAffixTiers,
    dmgBonus: () => Config.equipment.dmgBonusAffixTiers,
    dr: () => Config.equipment.drAffixTiers
  };

  function affixCategory(type) {
      const a = AFFIX_POOL.find(x => x.type === type);
      return a ? a.category : 'prefix';
    }
  
  function affixCount(eq) {
      const a = eq.affixes || {};
      return (a.prefix ? a.prefix.length : 0) + (a.suffix ? a.suffix.length : 0);
    }
  
  function pickRarity(weights) {
      const items = Config.equipment.rarities.map(r => ({ ...r, weight: (weights && weights[r.id]) || 0 }));
      return Util.pickWeighted(items);
    }
  
  function rollAffixTier(ilvl) {
      const lv = ilvl == null ? 100 : Number(ilvl);
      const gates = (Config.equipment.affixIlvlGates || {});
      const weights = (Config.equipment.affixTierWeights) || { 4: 60, 5: 40 };
      // 池子 = 门槛已达标的 tier（ilvl 10 → 只有 T4/T5；ilvl 80 → T1~T5 全在池里）
      const entries = Object.entries(gates)
        .filter(([, g]) => lv >= Number(g))
        .map(([t]) => ({ tier: Number(t), weight: Number(weights[t]) || 0 }));
      if (!entries.length) return 5;
      return Util.pickWeighted(entries).tier;
    }
  
  function rollAffixCount(ilvl) {
      const lv = ilvl == null ? 100 : Number(ilvl);
      const table = Config.equipment.affixCountByIlvl || [];
      // 取「满足 lv 且门槛最高」的段（表按 minIlvl 降序写，但这里不依赖顺序，防手滑改序）
      let seg = null;
      for (const s of table) {
        if (lv >= (Number(s.minIlvl) || 0) && (!seg || (Number(s.minIlvl) || 0) > (Number(seg.minIlvl) || 0))) seg = s;
      }
      if (!seg) seg = table[table.length - 1] || { min: 1, max: 2 };
      return Util.randInt(Number(seg.min) || 1, Math.max(Number(seg.min) || 1, Number(seg.max) || 1));
    }
  
  function affixTiersFor(type) {
      const get = AFFIX_TIER_TABLES[type];
      const t = get ? get() : Config.equipment.affixTiers;
      return t || Config.equipment.affixTiers;
    }
  
  function rollBaseHit(ilvl) {
      const table = Config.equipment.baseHitByIlvl || [];
      let seg = table[0] || { min: 3, max: 5 };
      for (const s of table) if (Number(ilvl || 100) >= s.minIlvl) seg = s;
      return Util.randInt(seg.min, seg.max);
    }
  
  function levelOfAreaTier(t) {
      const arr = (Config.equipment.areaLevels) || [];
      const v = Number(arr[Number(t) - 1]);
      return isFinite(v) && v > 0 ? v : 1;
    }
  
  function rarityIdFromCount(count) {
      return count >= 3 ? 'gold' : count >= 2 ? 'blue' : 'white';
    }
  
  function syncRarity(eq) {
      const id = rarityIdFromCount(affixCount(eq));
      const r = (Config.equipment.rarities || []).find(x => x.id === id) || Config.equipment.rarities[0];
      eq.rarity = { id: r.id, label: r.label, color: r.color };
      return eq.rarity;
    }
  
  function generateEquipment(rarity, areaTier, materialTier, ilvl, countBonus) {
      // 图档上限与 baseTierMultipliers 档数一致（地图 10 图后这里还钳 6 → 图7~10 掉落和图6 一样强，已修）
      const maxTier = (Config.equipment.baseTierMultipliers || []).length || 6;
      areaTier = Math.max(1, Math.min(maxTier, areaTier || 1));
      if (ilvl == null) ilvl = levelOfAreaTier(areaTier);
      // 底材 T 阶：同一套 ilvl 门槛 + 权重池（传入的 materialTier 参数忽略 —— 旧调用方还在传，签名兼容）
      materialTier = rollAffixTier(ilvl);
      const slot = Util.pick(SLOTS);
      const info = SLOT_INFO[slot];
      const multiplier = (Config.equipment.baseTierMultipliers[areaTier - 1] || 1) *
        (Config.equipment.materialTierMultipliers[materialTier] || 1);
      const baseStats = {};
      for (const b of info.bases) baseStats[b.type] = Math.round(b.value * multiplier * 100) / 100;
      const firstBase = info.bases[0];
      const base = { type: firstBase.type, label: firstBase.label, value: baseStats[firstBase.type] };
      // countBonus：「掉落稀有度」词缀的加成落点 —— 多 1 条词缀（颜色自然升一档），替代旧的按图 roll 颜色
      const count = rollAffixCount(ilvl) + (Number(countBonus) || 0);
      const affixes = { prefix: [], suffix: [] };
      // 底材命中：随 ilvl 成长的区间值（取代固定 +5 死数），作为基础词缀（base:true 无 T 阶区间）
      const baselineType = baseStats.hit !== undefined ? 'hit' : 'crit';
      const baseline = { type: baselineType, label: LABELS[baselineType], tier: 5,
        value: baselineType === 'hit' ? rollBaseHit(ilvl) : 2, base: true };
      affixes.suffix.push(baseline);
      const pool = AFFIX_POOL.filter(a => a.type !== baselineType);
      // 补词缀：targetCount 为词缀总条数上限（含基础词缀）。每次只选「目标桶未满(≤3)」的类型，
      // 避免前缀/后缀超过单桶上限 3 条（金装 4~5 条时若全堆一个桶会爆结构）。
      const targetCount = Math.min(count, 7); // 结构上限：基础1 + 前缀3 + 后缀3 = 7
      const slotW = (Config.equipment.slotAffixWeights || {})[slot] || {};
      while (affixCount({ affixes }) < targetCount && pool.length) {
        const available = pool.filter(a => (affixes[a.category] || []).length < 3);
        if (!available.length) break;
        // 按词缀权重加权抽取：基础战斗词缀常出、资源/极品词缀稀出（POE 式）；
        // 再乘部位偏好（slotAffixWeights）：武器偏进攻、靴子偏速度、护甲偏坦克
        const aff = Util.pickWeighted(available.map(a => ({
          ...a, weight: (a.weight || 50) * (slotW[a.type] != null ? slotW[a.type] : 1)
        })).filter(a => a.weight > 0));
        if (!aff) break;
        pool.splice(pool.indexOf(aff), 1);
        // 每条词缀独立 roll T 阶：门槛达标的 tier 进池按权重抽（ilvl 70+ 才可能有 T1，且只占 5%）
        const tier = rollAffixTier(ilvl);
        const tiers = affixTiersFor(aff.type);
        const T = tiers.find(t => t.tier === tier) || tiers[tiers.length - 1];
        const fixed = ['hit', 'dodge', 'spd', 'pen'].includes(aff.type);
        affixes[aff.category].push({ type: aff.type, label: aff.label, tier, value: Util.randInt(T.min, T.max), fixed });
      }
      const eq = {
        id: uid++, name: Util.pick(info.names), slot, areaTier, materialTier, ilvl,
        tier: materialTier, base, baseStats, affixes, cloudId: null, locked: false, fresh: true
      };
      syncRarity(eq); // 颜色 = 词缀条数的结果（1白/2蓝/3+金）；打造加减词缀后也调这里实时同步
      return eq;
    }

  return { generateEquipment, rollAffixTier, rollAffixCount, syncRarity, affixCount };
}
