/* ============================================================
 * drop.js —— 掉落系统
 * 职责：
 *  1. 战斗胜利掉落（改法一·单池·一场一抽）：每场只摇 1 次，从合并权重总池抽 1 件
 *     （无掉落 / 普通材料 / 装备 / 宠物蛋），一场最多 1 件；装备/蛋为低概率惊喜档
 *  2. 装备掉落的稀有度由「当前图档」决定：读 Config.equipment.rarityWeightsByTier 的平滑梯度（越深金装越常见），
 *     取代旧版按怪 lootTier 的 3 档枚举（图3~17 全锁 'high'→必出金）。
 *  3. 宠物蛋计数、累计获得装备数（仅本模块持有）
 *  4. 孵化：消耗一颗蛋 → 生成并出战新宠物（调 Pet）
 *  5. 涅磐兽等全部材料：整合进单池的 material 档（按区域/图子权重选一），调 Materials 累加
 * 依赖：equipment.js（稀有度挑选 + 装备入库）、pet.js（孵化生成宠物）、materials.js（涅磐兽）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { pickRarity, generateEquipment, addToInventory, getEquipBonuses } = window.Equipment;
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

  // 蛋显示名 = 品种名 + '蛋'。品种本身已带'蛋'字（旧数据统一归类的'宠物蛋'）时不再重复拼接，
  // 否则会显示成"宠物蛋蛋"。
  function makeEggName(baseName) {
    if (!baseName) return '宠物蛋';
    return baseName.endsWith('蛋') ? baseName : `${baseName}蛋`;
  }

  // 稀有度（颜色）随「图档」平滑爬升：读 config.equipment.rarityWeightsByTier[图档] 的
  // 白/蓝/金 概率表（17 张图各一组，越深金装越常见）。取代旧版按怪 lootTier 的 3 档枚举
  // （旧版图3~17 全锁 'high'→必出金，15 张图颜色无差异）。返回稀有度对象——
  // generateEquipment 需要读 rarity.affixMin/affixMax，字符串会让词缀数量算出 NaN。
  function pickDropRarity(areaTier) {
    const table = (Config.equipment.rarityWeightsByTier || {})[areaTier]
      || { white: 80, blue: 18, gold: 2 };
    const r = Math.random() * 100;
    let acc = 0;
    for (const id of ['white', 'blue', 'gold']) {
      acc += table[id] || 0;
      if (r < acc) return Config.equipment.rarities.find(x => x.id === id) || Config.equipment.rarities[0];
    }
    return Config.equipment.rarities.find(x => x.id === 'gold') || Config.equipment.rarities[0];
  }

  // 底材 T 阶随机：直接读 config.equipment.materialTierWeights（每图一套显式权重）。
  // 以前是这里线性插值算权重（图6 → T1 占 33%，顶级底材太常见）；
  // 改配置表后策划能一眼调，且 T1 在图6 也只有 20%。
  function rollMaterialTier(areaTier, ilvl) {
    const table = (Config.equipment.materialTierWeights || {})[areaTier] || { 5: 50, 4: 30, 3: 15, 2: 4, 1: 1 };
    const entries = Object.entries(table);
    const total = entries.reduce((s, [, v]) => s + (Number(v) || 0), 0);
    let r = Math.random() * total;
    let picked = 5;
    for (const [t, v] of entries) {
      r -= (Number(v) || 0);
      if (r < 0) { picked = Number(t); break; }
    }
    // 底材 ilvl 门槛（与词缀共用 affixIlvlGates：T1≥55/T2≥40/T3≥25）：低于门槛抽到高档底材 → 降到允许最高 T。
    // 挂钩「实际击杀怪等级」：低图普通怪出不了顶级底材，越级杀高等级怪有奖励。
    const lv = ilvl == null ? 100 : Number(ilvl);
    const gates = (Config.equipment.affixIlvlGates) || {};
    let best = 5;
    for (const [t, g] of Object.entries(gates)) { if (lv >= Number(g) && Number(t) < best) best = Number(t); }
    if (picked < best) picked = best;
    return picked;
  }

  // 宠物蛋按品种计数：{ '血狐': 2, '骨狼': 1 }（已登录以云端 pet_egg 为准，本地同步）
  let eggMap = {};
  let totalEquipDrops = 0;  // 累计获得装备数（跨挂机累计）

  const totalEggs = () => Object.values(eggMap).reduce((a, b) => a + b, 0);

  /* ---------- 掉落（改法一：单池·一场一抽） ---------- */
  // rollReward(enemy, area)：每场胜利只做一次加权随机，从合并总池抽 1 件（none/material/equipment/egg）。
  // 概率/权重在 config.js：drop.pool 总权重 + drop.materialWeightsByTier[图档] 子权重（按图档从低到高，且含出现时机门槛）；一场最多 1 件。
  // 装备掉落时若已登录 → 自动写入 items 表（Items.saveItem），回写 cloudId
  // 宠物蛋掉落时若已登录 → 云端 pet_egg 插一行（刷新不丢）
  // 全部材料整合进 material 档（按区域/图子权重选一），返回 { type:'material', material, qty }
  // 返回 type ∈ none/material/equipment/egg，供 UI 播报
  /* ---------- 单池加权抽取（改法一） ---------- */
  // 从 [ [key, weight], ... ] 中按权重随机返回一个 key
  function weightedPick(entries) {
    let total = 0;
    for (const [, w] of entries) total += (Number(w) || 0);
    if (total <= 0) return entries.length ? entries[0][0] : null;
    let r = Math.random() * total;
    for (const [k, w] of entries) {
      r -= (Number(w) || 0);
      if (r < 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  // 抽到 material 时：按"本图档"的 materialWeightsByTier 选具体材料（缺省键=该图还不出）。
  // 进化素材用占位键'进化素材'承载权重，具体掉 普通/精粹/传说 由 areaEvolutionTiers + evoMaterialWeights 决定。
  // 词缀：dropQty≥2 时 qty=2；matDrop 已作用在 pool.material 总权重上。
  function pickMaterial(enemy, area, res) {
    const D = Config.drop;
    const areaList = Config.battle.areas || [];
    const areaIdx = area && area.id ? areaList.findIndex(a => a.id === area.id) : -1;
    const maxTier = (D.materialWeightsByTier && Object.keys(D.materialWeightsByTier).length) || 17;
    const tier = Math.max(1, Math.min(maxTier, areaIdx >= 0 ? areaIdx + 1 : 1));
    const mw = (D.materialWeightsByTier && D.materialWeightsByTier[tier]) || {};
    const sub = [];
    let evoSlot = 0;
    for (const [name, w] of Object.entries(mw)) {
      if (!w || w <= 0) continue;
      if (name === '进化素材') { evoSlot = w; continue; } // 占位，下面按本图档位解析具体名字
      sub.push([name, w]);
    }
    // 进化素材：按本图可用档（areaEvolutionTiers）+ 档位权重（evoMaterialWeights）选具体名字
    const evoTiers = (area && area.id && D.areaEvolutionTiers && D.areaEvolutionTiers[area.id]) || null;
    if (evoSlot > 0 && evoTiers && evoTiers.length) {
      const ew = D.evoMaterialWeights || {};
      const evoSub = evoTiers.map(t => [t, ew[t] || 10]);
      sub.push([weightedPick(evoSub), evoSlot]);
    }
    // 区域材料：权重条目里 '区域材料' 是占位符，实际名字取 areaMaterials[area.id].name
    // （如 corrupted-forest → 枯荣种荚）；其余材料名直接用
    let name = weightedPick(sub);
    if (name === '区域材料') {
      const am = (D.areaMaterials && D.areaMaterials[area && area.id]) || null;
      name = (am && am.name) || null;
    }
    if (!name) return null;
    return { name, qty: 1 }; // dropQty 不再给数量（原 ≥2 才生效等于永无效），改在 rollReward 乘掉落池权重
  }

  /* ---------- 掉落（改法一：单池·一场一抽） ---------- */
  // rollReward(enemy, area)：每场胜利只做一次加权随机，从合并总池抽 1 件结果：
  //   none(无掉落) / material(普通材料·单件) / equipment(装备) / egg(宠物蛋)
  // 一场最多给 1 件；材料与装备/蛋互斥。装备/蛋为低概率"惊喜档"，不抬高通胀。
  // 装备掉落时若已登录 → 自动写入 items 表；宠物蛋掉落时若已登录 → 云端 pet_egg 插一行。
  // 返回 { type: 'equipment'|'egg'|'material'|'none', ... } 供 UI 播报（一场一件，不再有多个 bool 标记）。
  async function rollReward(enemy, area, opts) {
    const D = Config.drop;
    const dry = !!(opts && opts.dry); // 开发者模拟器用：只抽样、不落库、不污染背包/蛋/材料
    // 出战宠物装备的掉落类词缀加成（掉落数量/掉落稀有度/材料掉率），无装备则默认 1 倍
    const activePet = window.Pet.getActivePet();
    const res = (activePet && getEquipBonuses(activePet).resources) || { dropQty: 1, dropRare: 1, matDrop: 1 };

    // 守关 Boss 掉落（2026-09-05 地图系统）：必掉金装 + 本图区域材料×5，不参与单池概率。
    // ilvl = 实际 Boss 等级（图段上限）→ 底材/词缀门槛自然吃满，低图 Boss 也出不了顶级底材。
    if (opts && opts.boss) {
      const areaList = Config.battle.areas || [];
      const areaIdx = area && area.id ? areaList.findIndex(a => a.id === area.id) : -1;
      const maxTier = (Config.equipment.baseTierMultipliers || []).length || 17;
      const areaTier = Math.max(1, Math.min(maxTier, areaIdx >= 0 ? areaIdx + 1 : 1));
      const ilvl = (opts && opts.enemyLevel) || (area && area.levelRange && area.levelRange[1]) || 1;
      const gold = Config.equipment.rarities.find(x => x.id === 'gold') || Config.equipment.rarities[0];
      const matTier = rollMaterialTier(areaTier, ilvl);
      const eq = generateEquipment(gold, areaTier, matTier, ilvl);
      eq.identified = false;
      const am = (D.areaMaterials && D.areaMaterials[area && area.id]) || null;
      let mat = null;
      if (am && am.name) {
        mat = { material: am.name, qty: 5 };
        if (!dry) await Materials.gain(am.name, 5); // dry 只抽样，不落库
      }
      if (!dry) {
        addToInventory(eq);
        totalEquipDrops++;
        if (window.Quest && window.Quest.reportType) window.Quest.reportType('equipDrop', 1);
        const { error } = await Items.saveItem(eq);
        return { type: 'boss', eq, material: mat, saveError: error || null };
      }
      return { type: 'boss', eq, material: mat, dry: true };
    }

    // 单池一次抽取：总权重归一化；"材料率"词缀拉高 material 档权重；
    // "掉落数量"词缀（2026-09-04 改法）拉高 material/equipment 档权重（+8% → 权重×1.08），
    // 语义 = "更容易掉东西"而不是"一次掉两个"，还原词缀本意且不抬通胀。
    const pool = D.pool || {};
    const qtyMul = 1 + ((res.dropQty || 1) - 1);
    const entries = [
      ['none', pool.none || 0],
      ['material', (pool.material || 0) * (res.matDrop || 1) * qtyMul],
      ['equipment', (pool.equipment || 0) * qtyMul],
      ['egg', pool.egg || 0]
    ];
    const tier = weightedPick(entries);

    if (tier === 'equipment') {
      const areaList = Config.battle.areas || [];
      const areaIdx = area && area.id ? areaList.findIndex(a => a.id === area.id) : -1;
      const maxTier = (Config.equipment.baseTierMultipliers || []).length || 17;
      const areaTier = Math.max(1, Math.min(maxTier, areaIdx >= 0 ? areaIdx + 1 : 1));
      let rarity = pickDropRarity(areaTier);
      // 「掉落稀有度」词缀：按 (dropRare-1) 概率把稀有度提升一档（白→蓝→金，金封顶）
      if (Math.random() < (res.dropRare - 1)) {
        const upR = rarity.id === 'white' ? 'blue' : (rarity.id === 'blue' ? 'gold' : null);
        if (upR) rarity = Config.equipment.rarities.find(x => x.id === upR) || rarity;
      }
      // ilvl 挂钩「实际击杀怪等级」（2026-09-05 拍板：与怪物等级挂钩，不再按图档下限）
      const ilvl = (opts && opts.enemyLevel) || (area && area.levelRange && area.levelRange[0]) || 1;
      const matTier = rollMaterialTier(areaTier, ilvl);
      const eq = generateEquipment(rarity, areaTier, matTier, ilvl);
      eq.identified = false;          // 掉落即未鉴定，背包里灰框，鉴定后揭晓
      if (!dry) {
        addToInventory(eq);
        totalEquipDrops++;
        // 任务进度上报：所有 type=equipDrop 的任务 +1（捡到装备）
        if (window.Quest && window.Quest.reportType) window.Quest.reportType('equipDrop', 1);
        const { error } = await Items.saveItem(eq); // 未登录时 saveItem 返回"未登录"，静默忽略
        return { type: 'equipment', eq, saveError: error || null };
      }
      return { type: 'equipment', eq, dry: true };
    }

    if (tier === 'egg') {
      const baseName = getEnemyEggBase(enemy);
      if (!baseName) return { type: 'none' }; // 没有配 eggBaseName 的怪不掉蛋 → 退化为无掉落
      if (!dry) {
        eggMap[baseName] = (eggMap[baseName] || 0) + 1;
        await Supabase.addEgg(baseName); // 已登录则云端存一颗该品种的蛋（失败静默，下次登录以云端为准）
      }
      const eggName = makeEggName(baseName);
      return { type: 'egg', eggName, baseName };
    }

    if (tier === 'material') {
      const mat = pickMaterial(enemy, area, res);
      if (!mat) return { type: 'none' };
      if (!dry) await Materials.gain(mat.name, mat.qty); // 未登录只本地累计
      return { type: 'material', material: mat.name, qty: mat.qty };
    }

    return { type: 'none' }; // 无掉落
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
    // 任务进度上报：所有 type=hatch 的任务 +1（petName = 孵出的品种，供宠物专属任务区分）
    if (window.Quest && window.Quest.reportType) window.Quest.reportType('hatch', 1, { petName: baby ? baby.name : null });
    return { baby, saveError: error || null };
  }

  /* ---------- 查询 / 云端恢复 ---------- */
  const getEggCount = () => totalEggs();
  const getEggs = () => ({ ...eggMap });                 // 按品种明细 { '血狐': 2 }
  const getEggCountOf = (baseName) => eggMap[baseName] || 0;
  const getTotalEquipDrops = () => totalEquipDrops;
  // 登出/切号：清空本地蛋映射。云端是唯一权威，登录后由 setEggs 按品种整体重建。
  function clearEggs() {
    eggMap = {};
  }
  // 登录后以云端 pet_egg 的按品种明细整体替换本地映射（唯一恢复入口）
  function setEggs(map) {
    eggMap = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (v > 0) eggMap[k] = Math.floor(v);
    }
  }

  /* ---------- 开发者面板：补发蛋（本地计数 + 云端存档，逐颗落库） ---------- */
  async function grantEgg(baseName, amount) {
    amount = Math.max(1, Math.floor(amount || 1));
    if (!baseName) return { ok: false, error: '请选择蛋品种' };
    for (let i = 0; i < amount; i++) {
      eggMap[baseName] = (eggMap[baseName] || 0) + 1;
      await Supabase.addEgg(baseName); // 未登录时 addEgg 静默忽略，仅本地累计
    }
    return { ok: true, amount };
  }

  /* ---------- 对外 API ---------- */
  window.Drop = { rollReward, hatchEgg, grantEgg, getEggCount, getEggs, getEggCountOf, clearEggs, setEggs, makeEggName, getTotalEquipDrops };
})();
