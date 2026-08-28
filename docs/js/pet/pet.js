/* ============================================================
 * pet.js —— 宠物系统
 * 职责：
 *  1. 宠物数据模型与列表/出战状态（pets、activePetId 仅本模块持有）
 *  2. 属性计算：生命/攻击/防御 = 基础（初始值+等级×成长值）+ 装备加成（调 Equipment）；
 *     速度 = 宠物独立基础速度（config.pet.speeds 表）+ 装备加成，成长值/等级不参与
 *  3. 经验与升级（成长值越高每级加得越多；受 config 等级上限约束）
 *  4. 持久血量与回血（挂机跨场延续，非战斗时自动恢复）
 *  5. 随机婴儿生成（供 drop.js 孵化宠物蛋用）
 *  6. 云端宠物：Supabase 行 ↔ 宠物对象、整体替换（存档恢复）
 * 依赖：equipment.js（算装备加成）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { getEquipBonuses } = window.Equipment;
  const { randInt, pick } = window.Util;

  /* ---------- 状态 ---------- */
  let uid = 1;
  const pets = [];
  let activePetId = null;

  const PET_POOL = [
    { name: '腐噜兽', icon: '🐹' }, { name: '疫毛兽', icon: '🐱' }, { name: '尸犬', icon: '🐶' },
    { name: '血狐', icon: '🦊' }, { name: '骨狼', icon: '🐺' }, { name: '幽影兔', icon: '🐰' },
    { name: '瘟熊', icon: '🐻' }, { name: '毒沼蛙', icon: '🐸' }
  ];

  /* ---------- 数据模型 ---------- */
  // baseSpd 仅存档/展示用（写入云端 pets.speed 列），战斗速度以 config.pet.speeds 表为准
  function createPet(name, icon, growth, baseHp, baseAtk, baseDef, baseSpd, lineId) {
    return {
      id: uid++, name, icon, level: 1, exp: 0, growth,
      evolveTimes: 0,
      rebornCount: 0,
      lineId: lineId || name, // 来源基宠名，决定成长系数（进化/变异/融合继承）
      baseHp, baseAtk, baseDef, baseSpd,
      curHp: baseHp, // 持久血量：跨场战斗延续，非战斗时自动恢复
      cloudId: null, // 云端 pets.id（存档/市场上架用；本地孵化后由 savePet 回写）
      // 12 部位装备槽；旧存档缺失部位会按空槽处理
      equipment: Object.fromEntries((window.Equipment && window.Equipment.SLOTS ||
        ['武器', '戒指', '项链', '头盔', '护甲', '盾牌', '靴子', '腰带', '斗篷', '饰品', '护符', '徽章'])
        .map(slot => [slot, null]))
    };
  }
  function addPet(pet) {
    // 新建宠物补满血：curHp 按当前等级的满血上限设置，避免“刚选/刚孵化就显示恢复中、点开始挂机没反应”
    if (typeof pet.curHp !== 'number' || pet.curHp <= 0 || pet.curHp < getStats(pet).hp) {
      pet.curHp = getStats(pet).hp;
    }
    pets.push(pet);
    return pet;
  }
  function getPets() { return pets; }
  // 清空本地宠物（换号/登录恢复前用，避免残留干扰选宠判断）
  function clearPets() { pets.length = 0; activePetId = null; }
  function getActivePet() { return pets.find(p => p.id === activePetId) || null; }
  // 设置出战宠物：本地立即生效；若该宠物已同步云端，则把 is_active 持久化到 DB
  // （原出战宠物置 false），确保刷新页面后仍能还原到正确的出战宠物
  function setActive(id) {
    if (!pets.some(p => p.id === id)) return;
    const next = pets.find(p => p.id === id);
    // 上架中的宠物不可设为出战（需先取回），避免挂单快照与实物不一致
    const M = window.Market;
    if (M && M.isListed && next.cloudId && M.isListed(next.cloudId)) {
      if (window.UI && window.UI.showToast) window.UI.showToast('⚠️ 已上架的宠物不能出战', '请先在市场取回');
      return;
    }
    const prev = activePetId != null ? pets.find(p => p.id === activePetId) : null;
    activePetId = id;
    const SB = window.Supabase;
    if (SB && next.cloudId) {
      const p1 = SB.updatePet(next.cloudId, { is_active: true });
      if (p1 && p1.then) p1.then(function () {}, function () {});
      if (prev && prev.cloudId && prev.id !== next.id) {
        const p2 = SB.updatePet(prev.cloudId, { is_active: false });
        if (p2 && p2.then) p2.then(function () {}, function () {});
      }
    }
  }
  // 从本地列表移除宠物（融合消耗副宠等用）；若移除的是出战宠物，自动切换出战第一只
  function removePet(id) {
    const i = pets.findIndex(p => p.id === id);
    if (i < 0) return null;
    const [removed] = pets.splice(i, 1);
    if (activePetId === id) {
      const next = pets.length ? pets[0] : null;
      activePetId = next ? next.id : null;
      // 出战宠物被移除 → 新的出战宠物同步 is_active 到云端
      if (next && next.cloudId) {
        next.isActive = true;
        const SB = window.Supabase;
        if (SB) { const p = SB.updatePet(next.cloudId, { is_active: true }); if (p && p.then) p.then(function () {}, function () {}); }
      }
    }
    return removed;
  }

  /* ---------- 持久血量与回血 ---------- */
  const getCurHp = pet => Math.max(0, pet.curHp);
  // 设置当前血量，clamp 到 [0, maxHp]
  function setCurHp(pet, hp) {
    pet.curHp = Math.max(0, Math.min(hp, getStats(pet).hp));
  }
  // 非战斗时调用：按 config 每秒 maxHp 的比例恢复；返回 true 表示血量有变化
  // 防御：maxHp 非法（0/NaN，如脏数据导致属性异常）时视为已满不恢复，避免 NaN 死循环卡死回血
  function regenTick(pet, dtSec) {
    const maxHp = getStats(pet).hp;
    if (!(maxHp > 0) || pet.curHp >= maxHp) return false;
    pet.curHp = Math.min(maxHp, pet.curHp + maxHp * Config.regen.hpPerSecRatio * dtSec);
    return true;
  }

  /* ---------- 属性计算 ---------- */
  // 基础速度（新速度规则）：成长值/等级不参与。
  // 优先按来源基宠（lineId）查 speeds 表——进化/变异/融合不改变速度定位，
  // 幽影兔线所有形态都应继承 110；查不到（老存档/未知）再按名字查，最后兜底 40。
  function getBaseSpeed(pet) {
    const lineId = (pet && pet.lineId) || pet.name;
    const raw = Config.pet.speeds[lineId];
    if (typeof raw === 'number' && raw > 0) return raw;
    const byName = Config.pet.speeds[pet.name];
    if (typeof byName === 'number' && byName > 0) return byName;
    // 进化形态名不在表里（如"腐烂之母"）：从形态名反查根源基宠，继承其速度档
    const root = resolveLineId(pet.name);
    if (root) {
      const rootSpd = Config.pet.speeds[root];
      if (typeof rootSpd === 'number' && rootSpd > 0) return rootSpd;
    }
    const base = pet.name.replace(/·异变$/, '');
    const fallback = Config.pet.speeds[base];
    return typeof fallback === 'number' && fallback > 0 ? fallback : 40;
  }
  // 属性公式（《游戏设计理念》5.2，系数在 config.pet.statCoeff）：
  //   生命/攻击/防御 = 基础值 + 等级 × 成长值 × 系数
  //   速度 = 宠物基础速度（config.pet.speeds）+ 装备加成（getStats 里加）——成长值不参与
  // 成长值提升（如融合）后，用当前等级自动重算全部属性
  // 系数按"来源基宠"（pet.lineId）差异化：进化体/变异宠/融合宠继承基宠的 statCoeff，保证一条线风格统一；
  // lineId 查不到（老存档/未知）时用全局 Config.pet.statCoeff 兜底。
  function getStatCoeff(pet) {
    const lineId = (pet && pet.lineId) || (pet && pet.name);
    const st = (Config.pet.starters || []).find(s => s.name === lineId);
    return (st && st.statCoeff) || Config.pet.statCoeff || { hp: 5, atk: 2, def: 1 };
  }
  function baseStats(pet) {
    const g = pet.growth, lv = pet.level, C = getStatCoeff(pet);
    return {
      hp:  pet.baseHp + Math.round(lv * g * C.hp),
      atk: pet.baseAtk + Math.round(lv * g * C.atk),
      def: pet.baseDef + Math.round(lv * g * C.def),
      spd: getBaseSpeed(pet)
    };
  }
  // 总属性 = 宠物本体 + 每件装备独立贡献。装备词缀只放大该件装备的放大后基底，绝不乘宠物成长。
  // 机制属性：宠物本体保留基础值（否则裸装打不中人），装备词缀在此基础上加成。
  //  - 命中/闪避：固定数值（命中基础90，闪避基础0，裸装命中率≈95%封顶）
  //  - 暴击/暴伤/吸血：小数/倍率，来自宠物 profile 基础 + 装备加成
  function getStats(pet) {
    const base = baseStats(pet);
    const { flat = {} } = getEquipBonuses(pet) || {};
    const prof = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile || {};
    const baseHit = prof.hit != null ? Number(prof.hit) : 90;     // 基础命中（固定数值）
    const baseDodge = prof.dodge != null ? Number(prof.dodge) : 0; // 基础闪避（固定数值）
    const baseCrit = (prof.critRate != null ? Number(prof.critRate) : 5) / 100;
    const baseCritDmg = (prof.critDamage != null ? Number(prof.critDamage) : 150) / 100; // 145% → 1.45 倍
    const baseLs = (prof.lifesteal != null ? Number(prof.lifesteal) : 0) / 100;
    return {
      atk: base.atk + (flat.atk || 0),
      hp: base.hp + (flat.hp || 0),
      def: base.def + (flat.def || 0),
      spd: base.spd + (flat.spd || 0),
      critRate: baseCrit + (flat.crit || 0) / 100,
      critDamage: baseCritDmg + (flat.critDamage || 0) / 100,
      hit: baseHit + (flat.hit || 0),
      dodge: baseDodge + (flat.dodge || 0),
      lifesteal: baseLs + (flat.lifesteal || 0) / 100
    };
  }
  // 面板"装备加成"文案，如 "攻击+7 生命+20"。
  // 基底经 materialTier 相乘后是小数（如 30.23），故加成统一取整显示，避免出现 118.88499999999999 这类长小数。
  function getBonusText(pet) {
    const base = baseStats(pet), s = getStats(pet);
    const parts = [];
    const diff = k => Math.round(s[k] - base[k]);
    if (diff('atk')) parts.push('攻击+' + diff('atk'));
    if (diff('hp')) parts.push('生命+' + diff('hp'));
    if (diff('def')) parts.push('防御+' + diff('def'));
    if (diff('spd')) parts.push('速度+' + diff('spd'));
    // 机制属性（命中/闪避为固定数值，暴击/暴伤/吸血为百分比）：对比 profile 基础值
    const prof = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile || {};
    const bHit = prof.hit != null ? Number(prof.hit) : 90;
    const bDodge = prof.dodge != null ? Number(prof.dodge) : 0;
    const bCrit = (prof.critRate != null ? Number(prof.critRate) : 5) / 100;
    const bLs = (prof.lifesteal != null ? Number(prof.lifesteal) : 0) / 100;
    const d = s.dodge - bDodge, h = s.hit - bHit;
    if (Math.round(d)) parts.push('闪避+' + Math.round(d));
    if (Math.round(h)) parts.push('命中+' + Math.round(h));
    if (Math.round((s.critRate - bCrit) * 100)) parts.push('暴击+' + Math.round((s.critRate - bCrit) * 100) + '%');
    if (Math.round((s.lifesteal - bLs) * 100)) parts.push('吸血+' + Math.round((s.lifesteal - bLs) * 100) + '%');
    return parts.length ? parts.join(' ') : '无';
  }

  /* ---------- 经验与升级 ---------- */
  // 每级所需经验 = needBase × 等级^needExponent（公式参数在 config.js）
  const expNeed = lv => Math.round(Config.exp.needBase * Math.pow(lv, Config.exp.needExponent));
  // 返回 { leveled, newLevel, maxed }，由调用方决定是否播报
  // maxed=true 表示本次调用时已达等级上限（经验条保持满）
  function grantExp(pet, amt) {
    if (pet.level >= Config.pet.maxLevel) {
      pet.exp = expNeed(pet.level);
      return { leveled: false, newLevel: pet.level, maxed: true };
    }
    pet.exp += amt;
    let leveled = false;
    while (pet.level < Config.pet.maxLevel && pet.exp >= expNeed(pet.level)) {
      pet.exp -= expNeed(pet.level);
      pet.level++;
      leveled = true;
    }
    if (pet.level >= Config.pet.maxLevel) pet.exp = expNeed(pet.level); // 满级封顶
    // 升级回满血：升级后按新等级/新成长的上限把血量补满（提升体验，避免升级后残血）
    if (leveled) pet.curHp = getStats(pet).hp;
    return { leveled, newLevel: pet.level, maxed: pet.level >= Config.pet.maxLevel };
  }

  /* ---------- 随机婴儿（孵化用） ---------- */
  // 以 config 初始宠物为基准，按成长值缩放生命/攻击/防御；成长值范围在 config.js
  // 速度例外：按宠物名取 config.pet.speeds 独立基础速度（新规则，成长值不参与速度）
  // baseName 可选：传了则定向生成该基础宠（蛋按品种孵化用）；不传从 PET_POOL 随机。
  function createBaby(baseName) {
    const g = randInt(Config.pet.babyGrowth.min, Config.pet.babyGrowth.max);
    const base = Config.pet.legacyBase;
    let tmpl = baseName ? PET_POOL.find(x => x.name === baseName) : null;
    if (!tmpl) tmpl = pick(PET_POOL); // 未知品种/未指定 → 随机基础宠（兼容旧调用）
    // 差异化基础值：优先用该基宠在 starters 里配的 baseHp/baseAtk/baseDef，没有则用 legacyBase 兜底
    const st = (Config.pet.starters || []).find(x => x.name === tmpl.name) || {};
    const baseHp = st.baseHp || base.hp, baseAtk = st.baseAtk || base.atk, baseDef = st.baseDef || base.def;
    const k = g / base.growth;
    return createPet(tmpl.name, tmpl.icon, g,
      Math.round(baseHp * k), Math.round(baseAtk * k), Math.round(baseDef * k),
      Config.pet.speeds[tmpl.name] || 40, tmpl.name);
  }

  /* ---------- 云端宠物（Supabase 行 ↔ 宠物对象） ---------- */
  // 数值兜底：null/undefined/空串/非数字 → 0（level 保底 1），杜绝脏数据把属性算成 NaN
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  // 从形态名反查它所属的根源基宠（lineId）：进化体/变异宠/融合宠都能回溯到基宠，以继承成长系数和速度档。
  // 实现：从每只基宠出发递归标记所有后代形态都归属该基宠（避免只返回直接父级导致终极形态反查错）。
  function resolveLineId(name) {
    if (!name) return null;
    // 变异宠名字带「·异变」后缀，进化树里没有该节点：先去后缀再反查根源基宠（继承速度/系数）
    if (name.endsWith('·异变')) return resolveLineId(name.slice(0, -3));
    const tree = (Config.pet.evolution && Config.pet.evolution.tree) || {};
    const starters = (Config.pet.starters || []).map(s => s.name);
    if (starters.indexOf(name) >= 0) return name;
    const lineMap = {}; // 形态名 → 根源基宠
    const seen = new Set();
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
  function petFromRow(row) {
    // 云端不存 lineId（避免加列），恢复时用名字反查根源基宠，以正确继承成长系数
    const lineId = resolveLineId(row.name) || row.name;
    const pet = createPet(row.name, row.icon, num(row.growth), num(row.hp), num(row.attack), num(row.defense), num(row.speed), lineId);
    pet.cloudId = row.id; // 云端 id，市场上架用
    pet.level = num(row.level) || 1;
    pet.exp = num(row.exp); // 云端经验（旧库缺 exp 列时为 0，等于刷新后重攒，不会算成 NaN）
    pet.evolveTimes = Math.max(0, Math.floor(num(row.evolve_times)));
    pet.rebornCount = Math.max(0, Math.floor(num(row.reborn_count)));
    pet.curHp = num(row.cur_hp);
    pet.isActive = !!row.is_active; // 出战标记（DB 权威，刷新后据此还原出战宠物）
    // 装备槽：云端存 {部位: 装备cloudId}，先保存引用，等背包加载后用 restoreEquipment 填回装备对象
    if (row.equipment && typeof row.equipment === 'object') {
      pet.equipment = {};
      for (const [slot, cid] of Object.entries(row.equipment)) pet.equipment[slot] = cid ? { cloudId: cid } : null;
    }
    return pet;
  }
  // 恢复装备：背包加载完后调用，按 cloudId 从背包匹配装备对象填回宠物各部位（无匹配则空）
  function restoreEquipment(pet, inventory) {
    if (!pet || !pet.equipment) return;
    const inv = inventory || [];
    const byCloud = {};
    for (const eq of inv) if (eq.cloudId) byCloud[eq.cloudId] = eq;
    for (const slot of Object.keys(pet.equipment)) {
      const ref = pet.equipment[slot];
      if (ref && ref.cloudId && byCloud[ref.cloudId]) {
        pet.equipment[slot] = byCloud[ref.cloudId]; // 穿上背包里的那件
        const idx = inv.indexOf(byCloud[ref.cloudId]);
        if (idx >= 0) inv.splice(idx, 1); // 从背包移除（已穿身上）
      } else {
        pet.equipment[slot] = null; // 装备没了（被分解/出售），空槽
      }
    }
  }
  // 用云端列表整体替换本地宠物（云端是权威）；优先选 is_active=true 的出战宠物，
  // 没有标记时回退到第一只（兼容旧数据 / 首次建档）
  function setCloudPets(rows) {
    pets.length = 0;
    for (const r of rows) pets.push(petFromRow(r));
    const active = pets.find(p => p.isActive);
    activePetId = active ? active.id : (pets.length ? pets[0].id : null);
    return pets;
  }

  /* ---------- 对外 API ---------- */
  window.Pet = {
    createPet, addPet, getPets, getActivePet, setActive, removePet, petFromRow, clearPets,
    baseStats, getStats, getBonusText, getStatCoeff, grantExp, expNeed, createBaby, setCloudPets,
    getCurHp, setCurHp, regenTick, getBaseSpeed, restoreEquipment
  };
})();
