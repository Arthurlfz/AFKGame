/* ============================================================
 * drop.js —— 掉落系统
 * 职责：
 *  1. 战斗胜利概率掉落：装备 5% / 宠物蛋 5% / 无掉落（用户拍板有意调低，防装备/宠物通胀）
 *  2. 装备掉落的稀有度由「当前怪」的 rarityWeights 决定（野鼠偏白/毒蛇偏蓝/石魔偏金）
 *  3. 宠物蛋计数、累计获得装备数（仅本模块持有）
 *  4. 孵化：消耗一颗蛋 → 生成并出战新宠物（调 Pet）
 *  5. 涅磐兽：每场胜利独立概率掉落（config.drop.phoenixChance，调 Materials 累加）
 * 依赖：equipment.js（稀有度挑选 + 装备入库）、pet.js（孵化生成宠物）、materials.js（涅磐兽）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { pickRarity, generateEquipment, addToInventory } = window.Equipment;
  const { createBaby, addPet, setActive } = window.Pet;
  const Supabase = window.Supabase; // 孵化后写入云端存档
  const Items = window.Items;       // 装备掉落写入云端存档
  const Materials = window.Materials; // 涅磐兽材料掉落
  const { randInt } = window.Util;

  // 蛋品种 = 该怪对应的基础宠名（eggBaseName）。
  // 所有可捕捉怪都掉蛋：基础怪掉自己，进化/变异怪掉其根源基础宠的蛋（血牙狐→血狐蛋、血狐·异变→血狐蛋），
  // 孵化出的始终是基础宠（养成靠进化/合成，蛋不直接给高阶形态）。
  // 只有没配 eggBaseName 的杂兵怪（现已被移除）不掉蛋。
  function getEnemyEggBase(enemy) {
    if (!enemy) return null;
    return enemy.eggBaseName || null;
  }

  function makeEggName(baseName) {
    return baseName ? `${baseName}蛋` : '宠物蛋';
  }

  function getEnemyLootTier(enemy) {
    return (enemy && enemy.lootTier) || 'low';
  }

  function pickDropRarity(enemy) {
    const tier = getEnemyLootTier(enemy);
    if (tier === 'high') return 'gold';
    if (tier === 'mid') return Math.random() < 0.75 ? 'blue' : 'white';
    return Math.random() < 0.85 ? 'white' : 'blue';
  }

  // 底材T阶随机：图越高，越好底材（数字小）概率越高。
  // 权重 = (1-p)*T + p*(6-T)，p = (areaTier-1)/5 线性插值：
  //   图1 → 偏向 T5（烂底为主，好底稀有）；图6 → 偏向 T1（优底为主）。
  function rollMaterialTier(areaTier) {
    const tiers = [1, 2, 3, 4, 5];
    const a = (areaTier || 1) - 1;
    const p = Math.max(0, Math.min(1, a / 5));
    const weights = tiers.map(T => (1 - p) * T + p * (6 - T));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < tiers.length; i++) {
      r -= weights[i];
      if (r < 0) return tiers[i];
    }
    return 5;
  }

  // 宠物蛋按品种计数：{ '血狐': 2, '骨狼': 1 }（已登录以云端 pet_egg 为准，本地同步）
  let eggMap = {};
  let totalEquipDrops = 0;  // 累计获得装备数（跨挂机累计）

  const totalEggs = () => Object.values(eggMap).reduce((a, b) => a + b, 0);

  /* ---------- 掉落 ---------- */
  // rollReward(enemy)：enemy 为当前战斗的怪（含 rarityWeights）
  // 概率在 config.js；大部分战斗只给经验（无掉落），装备/蛋是偶尔的惊喜
  // 装备掉落时若已登录 → 自动写入 items 表（Items.saveItem），回写 cloudId
  // 宠物蛋掉落时若已登录 → 云端 pet_egg 插一行（刷新不丢）
  // 涅磐兽在分支之外独立 roll：掉到则 reward.phoenix = true（不改变主掉落）
  // 返回 { type: 'equipment'|'egg'|'none', eq?, saveError?, phoenix? }，供 UI 播报
  async function rollReward(enemy, area) {
    const D = Config.drop;
    const r = Math.random();
    let reward;
    if (r < D.equipmentChance) { // 装备：稀有度按当前怪的等级段倾向；基底=当前图档 × 随机底材T阶
      const rarity = pickDropRarity(enemy);
      // areaTier = 当前图在 config.battle.areas 里的序号+1（图1→1档 ... 图6→6档）
      const areaList = Config.battle.areas || [];
      const areaIdx = area && area.id ? areaList.findIndex(a => a.id === area.id) : -1;
      const areaTier = Math.max(1, Math.min(6, (areaIdx >= 0 ? areaIdx + 1 : 1)));
      // materialTier = 底材T阶，图越高越好底材概率越高：以 1/T 为权重偏向优底，高图偏移更明显
      const matTier = rollMaterialTier(areaTier);
      const eq = generateEquipment(rarity, areaTier, matTier);
      addToInventory(eq);
      totalEquipDrops++;
      const { error } = await Items.saveItem(eq); // 未登录时 saveItem 返回"未登录"，静默忽略
      reward = { type: 'equipment', eq, saveError: error || null };
    } else if (r < D.equipmentChance + D.eggChance) { // 宠物蛋（所有可捕捉怪都掉，蛋=根源基础宠）
      const baseName = getEnemyEggBase(enemy);
      if (baseName) {
        eggMap[baseName] = (eggMap[baseName] || 0) + 1;
        const eggName = makeEggName(baseName);
        await Supabase.addEgg(baseName); // 已登录则云端存一颗该品种的蛋（失败静默，下次登录以云端为准）
        reward = { type: 'egg', eggName, baseName };
      } else {
        reward = { type: 'none' }; // 没有配 eggBaseName 的怪不掉蛋，退化为无掉落
      }
    } else {
      reward = { type: 'none' }; // 无掉落
    }
    // 涅磐兽：独立概率，每场胜利都有机会掉（不挤占上述掉率；以后 Boss 可加掉率，现在不分怪）
    if (Math.random() < D.phoenixChance) {
      await Materials.gain(D.phoenixName, 1); // 未登录只本地累计
      reward.phoenix = true;
    }
    // 合成之石（合成材料）：独立概率掉落，不挤占其他掉率
    if (Math.random() < (D.synthesizeChance || 0)) {
      await Materials.gain(D.synthesizeName || '合成之石', 1);
      reward.synthesize = true;
    }
    // 打造材料：重铸石 / 剥离石，各自独立概率（config.drop），不挤占其他掉率
    if (Math.random() < D.reforgeStoneChance) {
      await Materials.gain(Config.craft.reforge.name, 1);
      reward.reforgeStone = true;
    }
    if (Math.random() < D.stripStoneChance) {
      await Materials.gain(Config.craft.strip.name, 1);
      reward.stripStone = true;
    }
    // 神圣石：独立概率（config.drop.holyStoneChance），不挤占其他掉率；
    // 仅重 Roll 词缀数值用，掉落概率最低（低于强化石/祝福石）
    if (Math.random() < D.holyStoneChance) {
      await Materials.gain(Config.craft.holy.name, 1);
      reward.holyStone = true;
    }
    // 增缀石：独立概率（config.drop.augmentStoneChance），不挤占其他掉率；
    // 用于给装备新增一条词缀，掉落概率与神圣石同为最低
    if (Math.random() < D.augmentStoneChance) {
      await Materials.gain(Config.craft.augment.name, 1);
      reward.augmentStone = true;
    }
    // 进化素材分 3 档：按当前图(area.id)的 areaEvolutionTiers 决定能掉哪些档，随机选一档掉（独立概率）。
    // 图1只掉普通、图2普通+精粹、图3起精粹+传说（防轻易接触）。没有 area/配置时退化为普通进化素材。
    const evoMats = [];
    const evoMap = Config.drop.evolutionMaterials || {};
    const evoMatName = (Config.pet.evolution && Config.pet.evolution.materialName) || '进化素材';
    let tiers = (area && area.id && D.areaEvolutionTiers && D.areaEvolutionTiers[area.id]);
    if (!tiers || !tiers.length) tiers = [evoMatName];
    const dropMat = tiers[Math.floor(Math.random() * tiers.length)];
    const c = evoMap[dropMat];
    if (typeof c === 'number' && c > 0 && Math.random() < c) {
      await Materials.gain(dropMat, 1);
      evoMats.push(dropMat);
    }
    if (evoMats.length) reward.evoMaterials = evoMats;
    // 每图专属材料：按当前图(area.id)查 Config.drop.areaMaterials，独立概率掉落，不挤占其他掉率。
    // 驱动"去对应图刷材料"（配合任务收集）。
    if (area && area.id) {
      const am = (D.areaMaterials || {})[area.id];
      if (am && typeof am.chance === 'number' && am.chance > 0 && Math.random() < am.chance) {
        await Materials.gain(am.name, 1);
        reward.areaMaterial = am.name;
      }
    }
    return reward;
  }

  /* ---------- 孵化 ---------- */
  // 未登录不能孵化：返回 { error }；成功返回 { baby, saveError }
  // 孵化出的宠物自动写入 Supabase pets 表（存档失败只提示，不阻塞本地游玩）
  // 云端同步：消耗一颗该品种的 pet_egg（标记已孵化并关联新宠物）
  // baseName：蛋品种 = 要孵出的基础宠名（如'血狐'）。不传或没有该品种蛋则返回 null。
  async function hatchEgg(baseName) {
    if (!baseName) {
      // 兼容旧调用：没有指定品种时，若有蛋，取第一个有数量的品种
      const first = Object.keys(eggMap).find(k => (eggMap[k] || 0) > 0);
      if (!first) return null;
      baseName = first;
    }
    if ((eggMap[baseName] || 0) <= 0) return null;
    const user = await Supabase.getCurrentUser();
    if (!user) return { error: '请先登录账号，才能孵化宠物' };
    eggMap[baseName]--;
    if (eggMap[baseName] <= 0) delete eggMap[baseName];
    const baby = createBaby(baseName); // 按品种定向生成对应基础宠
    addPet(baby);
    const { data, error } = await Supabase.savePet(baby);
    if (!error && data && data.id) {
      baby.cloudId = data.id; // 回写云端 id，供市场上架
      await Supabase.consumeEgg(baseName, data.id); // 云端消耗一颗该品种的蛋（失败仅提示，本地照常）
    }
    // 先存档拿到 cloudId，再设为出战 → is_active 才能同步到云端（刷新后仍为出战）
    setActive(baby.id);
    return { baby, saveError: error || null };
  }

  /* ---------- 查询 / 云端恢复 ---------- */
  const getEggCount = () => totalEggs();
  const getEggs = () => ({ ...eggMap });                 // 按品种明细 { '血狐': 2 }
  const getEggCountOf = (baseName) => eggMap[baseName] || 0;
  const getTotalEquipDrops = () => totalEquipDrops;
  // 登录后以云端 pet_egg 按品种为权威整体替换本地映射
  function setEggCount(n) {
    // 兼容旧数值：老数据只有总数时，摊成一个'通用'品种便于向后兼容（不丢失已有蛋）
    const total = Math.max(0, Math.floor(n || 0));
    if (total > 0 && !Object.keys(eggMap).length) eggMap = { 宠物蛋: total };
  }
  // 登录后以云端按品种明细替换（新数据走这个）
  function setEggs(map) {
    eggMap = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (v > 0) eggMap[k] = Math.floor(v);
    }
  }

  /* ---------- 对外 API ---------- */
  window.Drop = { rollReward, hatchEgg, getEggCount, getEggs, getEggCountOf, setEggCount, setEggs, getTotalEquipDrops };
})();
