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
      // 血脉特质 [{id, tier}]（T1~T3，T1 最强最稀有）；觉醒特质 Lv60 终形态解锁；source 预留氪金来源
      traits: [],
      awaken_trait: null,
      source: 'normal',
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
  // 总属性 = 宠物成长后裸属性 × 装备 atk/hp/def 百分比 + 装备固定基底与机制属性。
  // 装备底材/地图档次只在生成时放大装备基底，不参与宠物成长公式。
  //  - 命中/闪避：固定数值（命中基础90，闪避基础0，裸装命中率≈95%封顶）
  //  - 暴击/暴伤/吸血：小数/倍率，来自宠物 profile 基础 + 装备加成

  // 血统被动：根据宠物根源基宠名查 Config.bloodlinePassive
  // 支持·异变后缀剥离、进化体通过 lineId 回溯根源基宠
  function getBloodline(pet) {
    if (!pet || !Config.bloodlinePassive) return null;
    const baseName = pet.lineId || resolveLineId(pet.name) || pet.name;
    return Config.bloodlinePassive[baseName] || null;
  }

  /* ---------- 血脉特质 + 觉醒（2026-09-01 设计 v1） ---------- */
  // 觉醒状态：Lv60 终形态（名字在 evolution.activeSkills 表里）→ 觉醒特质 = 对应主动技能伤害 +20% + 血统定位加成
  function getAwakenState(pet) {
    if (!pet || Number(pet.level) < 60) return null;
    const skills = (Config.pet && Config.pet.evolution && Config.pet.evolution.activeSkills) || {};
    // 变异宠（名字带 ·异变）继承本体主动技能：剥离后缀查找
    const baseName = String(pet.name || '').replace(/·异变$/, '');
    const skill = skills[baseName];
    if (!skill) return null;
    const line = pet.lineId || pet.name;
    const raw = (Config.awakenBonus && Config.awakenBonus[line]) || {};
    const rawKey = Object.keys(raw)[0];
    return {
      id: '觉醒·' + pet.name,
      skillId: skill.id,
      skillName: skill.name,
      damage: Config.awakenSkillDamage != null ? Config.awakenSkillDamage : 0.2,
      skillDamageMult: 1 + (Config.awakenSkillDamage != null ? Config.awakenSkillDamage : 0.2),
      // 扁平化：{stat, value}（9/1 契约：血狐 → {stat:'critDamage', value:10}）
      bonus: rawKey ? { stat: rawKey, value: raw[rawKey] } : null,
    };
  }
  // 单条 T 阶 roll：T1 10 / T2 30 / T3 60（变异抬升：T1 10→20、保底不低于 T2）
  function rollTier(mutant, H) {
    const tr = (H && H.tierRoll) || [0, 10, 30, 60];
    const m = (mutant && H && H.mutant) || {};
    const t1 = m.t1Boost != null ? m.t1Boost : (tr[1] != null ? tr[1] : 10);
    const t2 = tr[2] != null ? tr[2] : 30;
    const r = Math.random() * 100;
    if (r < t1) return 1;
    if (r < t1 + t2) return 2;
    return (mutant && m.minTier) ? Math.max(m.minTier, 3) : 3;
  }
  // 按孵化概率 roll 宠物特质（条数 + T 阶）；mutant=true 变异宠（保底 1 条、3 条概率抬升、T 阶抬升）
  function rollPetTraits(pet, opts) {
    const H = Config.traitHatch || {};
    const defs = Config.petTraits || {};
    const keys = Object.keys(defs);
    if (!keys.length) return pet;
    const counts = H.counts || [40, 45, 13, 2];
    const mutant = !!(opts && opts.mutant);
    // roll 条数（counts 索引 = 条数）
    let r = Math.random() * 100, acc = 0, count = 0;
    for (let i = 0; i < counts.length; i++) { acc += counts[i]; if (r < acc) { count = i; break; } }
    if (mutant) {
      const m = H.mutant || {};
      if (count < (m.minCount || 1)) count = m.minCount;
      if (Math.random() * 100 < (m.count3 || 8)) count = Math.max(count, 3);
    }
    const cap = (Config.traitInherit && Config.traitInherit.cap) || 3;
    count = Math.min(count, cap);
    const traits = [];
    const used = {};
    for (let i = 0; i < count; i++) {
      let id = pick(keys);
      let guard = 0;
      while (used[id] && guard++ < 20) id = pick(keys);
      used[id] = true;
      traits.push({ id: id, tier: rollTier(mutant, H) });
    }
    pet.traits = traits;
    return pet;
  }
  // 天赋结算：hp/def → pct（÷100）；critRate/critDamage/lifesteal → flat 点数（getStats ÷100）；hit/dodge/spd → flat 点数
  function addTraitStat(pet, flat, pct) {
    const defs = Config.petTraits || {};
    const list = (pet && pet.traits) || [];
    for (const t of list) {
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
    // 觉醒特质（Lv60 终形态）：主动技能伤害 +20%（battle.js 施放时乘）+ 血统定位加成
    const aw = getAwakenState(pet);
    if (aw && aw.bonus && aw.bonus.stat) {
      const k = aw.bonus.stat, v = aw.bonus.value;
      if (k === 'hp') pct.hp = (pct.hp || 0) + v / 100;
      else if (k === 'def') pct.def = (pct.def || 0) + v / 100;
      else if (k === 'spd') flat.spd = (flat.spd || 0) + v;
      else if (k === 'critDamage') flat.critDamage = (flat.critDamage || 0) + v;
      else if (k === 'lifesteal') flat.lifesteal = (flat.lifesteal || 0) + v;
    }
  }
  // statParts：把裸属性拆成「底座 core（基础值+等级系数）」+「成长增量 growth」两段，
  // pct（装备/特质百分比）只作用于 core，成长增量不放大（2026-09-01 拍板口径）
  function statParts(pet) {
    const g = pet.growth, lv = pet.level, C = getStatCoeff(pet);
    const coreHp = pet.baseHp + Math.round(lv * C.hp);
    const coreAtk = pet.baseAtk + Math.round(lv * C.atk);
    const coreDef = pet.baseDef + Math.round(lv * C.def);
    const totalHp = pet.baseHp + Math.round(lv * g * C.hp);
    const totalAtk = pet.baseAtk + Math.round(lv * g * C.atk);
    const totalDef = pet.baseDef + Math.round(lv * g * C.def);
    return {
      core: { hp: coreHp, atk: coreAtk, def: coreDef, spd: getBaseSpeed(pet) },
      growth: { hp: totalHp - coreHp, atk: totalAtk - coreAtk, def: totalDef - coreDef },
      total: { hp: totalHp, atk: totalAtk, def: totalDef, spd: getBaseSpeed(pet) }
    };
  }
  function getStats(pet) {
    const base = baseStats(pet);
    const eq = getEquipBonuses(pet) || {};
    const flat = Object.assign({}, eq.flat);   // 本地拷贝，避免污染装备加成对象
    const pct = Object.assign({}, eq.pct);
    addTraitStat(pet, flat, pct);              // 血脉特质 + 觉醒特质结算
    const prof = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile || {};
    const baseHit = prof.hit != null ? Number(prof.hit) : 90;     // 基础命中（固定数值）
    const baseDodge = prof.dodge != null ? Number(prof.dodge) : 0; // 基础闪避（固定数值）
    const baseCrit = (prof.critRate != null ? Number(prof.critRate) : 5) / 100;
    const baseCritDmg = (prof.critDamage != null ? Number(prof.critDamage) : 150) / 100; // 145% → 1.45 倍
    const baseLs = (prof.lifesteal != null ? Number(prof.lifesteal) : 0) / 100;
    // 血统被动：allStatBonus 类型直接加成 critRate/hit/dodge
    const bl = getBloodline(pet);
    let blCrit = 0, blHit = 0, blDodge = 0;
    if (bl && bl.type === 'allStatBonus' && bl.params) {
      blCrit = bl.params.critRate || 0;
      blHit = (bl.params.hit || 0) * 100;
      blDodge = (bl.params.dodge || 0) * 100;
    }
    // 装备/特质 % 只作用于"底座"（基础值 + 等级系数），成长增量不放大（2026-09-01 口径）
    const sp = statParts(pet);
    return {
      atk: Math.round(sp.core.atk * (1 + (pct.atk || 0)) + sp.growth.atk + (flat.atk || 0)),
      hp: Math.round(sp.core.hp * (1 + (pct.hp || 0)) + sp.growth.hp + (flat.hp || 0)),
      def: Math.round(sp.core.def * (1 + (pct.def || 0)) + sp.growth.def + (flat.def || 0)),
      spd: base.spd + (flat.spd || 0),
      critRate: baseCrit + (flat.crit || 0) / 100 + blCrit,
      critDamage: baseCritDmg + (flat.critDamage || 0) / 100,
      hit: baseHit + (flat.hit || 0) + blHit,
      dodge: baseDodge + (flat.dodge || 0) + blDodge,
      lifesteal: baseLs + (flat.lifesteal || 0) / 100,
      growth: pet.growth || 0
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

  /* ---------- 经验与升级 ----------
   * 经验规则全部收在这里，是唯一事实源：实发（main.js）与预览（怪物 tooltip）都调同一套函数，
   * 结构上杜绝"tooltip 写一套公式、发放写另一套"导致显示与实发对不上。
   * 曲线设计见 config.exp 的注释（产出与需求同量纲）。
   */
  // 每级所需经验 = needBase × 等级^needExponent（公式参数在 config.js）
  const expNeed = lv => Math.round(Config.exp.needBase * Math.pow(lv, Config.exp.needExponent));
  // 单场胜利的经验基准：coef × 怪物等级^指数 × 区域难度 × 全局倍率
  function expBase(enemy, area) {
    const E = Config.exp;
    const lv = Math.max(1, Number(enemy && enemy.level) || 1);
    const diff = Number(area && area.difficulty) || 1;
    const rate = Number(E.rate) || 1;
    return E.perWinCoef * Math.pow(lv, E.perWinExponent) * diff * rate;
  }
  // 实发经验：基准 ± jitter 随机，保底 perWinMin
  function expFromBattle(enemy, area) {
    const base = expBase(enemy, area);
    const j = Number(Config.exp.perWinJitter) || 0;
    const factor = 1 + (Math.random() * 2 - 1) * j;
    return Math.max(Config.exp.perWinMin || 1, Math.round(base * factor));
  }
  // 预览区间（怪物 tooltip）：与实发同源，保证玩家"看到的 = 拿到的"
  function expRange(enemy, area) {
    const base = expBase(enemy, area);
    const j = Number(Config.exp.perWinJitter) || 0;
    const min = Number(Config.exp.perWinMin) || 1;
    return {
      min: Math.max(min, Math.round(base * (1 - j))),
      max: Math.max(min, Math.round(base * (1 + j)))
    };
  }
  /* ---------- 满级经验池 ----------
   * 溢出经验（满级后的、以及升到满级时多出来的）攒进 pet.expPool，
   * 每满 perCrystal 凝 1 颗晶石（走 Materials，账号级、云端同步）；返回本次凝出的数量。 */
  function addExpPool(pet, amt) {
    const EP = Config.pet.expPool;
    if (!EP || amt <= 0) return 0;
    pet.expPool = (pet.expPool || 0) + amt;
    const n = Math.floor(pet.expPool / EP.perCrystal);
    if (n <= 0) return 0;
    pet.expPool -= n * EP.perCrystal;
    if (window.Materials) window.Materials.gain(EP.material, n);
    return n;
  }
  // 返回 { leveled, newLevel, maxed, crystal }，由调用方决定是否播报
  // maxed=true 表示本次调用时已达等级上限（经验条保持满，经验转入经验池）
  function grantExp(pet, amt) {
    if (pet.level >= Config.pet.maxLevel) {
      pet.exp = expNeed(pet.level);
      return { leveled: false, newLevel: pet.level, maxed: true, crystal: addExpPool(pet, amt) };
    }
    pet.exp += amt;
    let leveled = false;
    while (pet.level < Config.pet.maxLevel && pet.exp >= expNeed(pet.level)) {
      pet.exp -= expNeed(pet.level);
      pet.level++;
      leveled = true;
    }
    let crystal = 0;
    if (pet.level >= Config.pet.maxLevel) {
      crystal = addExpPool(pet, pet.exp - expNeed(pet.level)); // 升到满级多出来的经验不蒸发
      pet.exp = expNeed(pet.level); // 满级封顶
    }
    // 升级回满血：升级后按新等级/新成长的上限把血量补满（提升体验，避免升级后残血）
    if (leveled) pet.curHp = getStats(pet).hp;
    return { leveled, newLevel: pet.level, maxed: pet.level >= Config.pet.maxLevel, crystal };
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
    const baby = createPet(tmpl.name, tmpl.icon, g,
      Math.round(baseHp * k), Math.round(baseAtk * k), Math.round(baseDef * k),
      Config.pet.speeds[tmpl.name] || 40, tmpl.name);
    rollPetTraits(baby, {});   // 孵化 roll 血脉特质
    return baby;
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
    // 血脉特质（旧库无列/无数据 → 空数组兜底）；觉醒特质；来源标记
    pet.traits = Array.isArray(row.traits) ? row.traits : [];
    pet.awaken_trait = row.awaken_trait || null;
    pet.source = row.source || 'normal';
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
    for (const r of rows) {
      const pet = petFromRow(r);
      // 旧变异宠补特质（一次性修复上线前合成的旧宠）：名字带「·异变」且无特质 → 按变异规则 roll 保底 1 条 + 异步写回云端
      if (pet.name && String(pet.name).endsWith('·异变') && (!pet.traits || !pet.traits.length)) {
        rollPetTraits(pet, { mutant: true });
        if (pet.cloudId && window.Supabase && window.Supabase.updatePet) {
          window.Supabase.updatePet(pet.cloudId, { traits: pet.traits }).catch(e => {
            if (window.console) console.warn('[补特质] 写回云端失败：', e && e.message);
          });
        }
      }
      pets.push(pet);
    }
    const active = pets.find(p => p.isActive);
    activePetId = active ? active.id : (pets.length ? pets[0].id : null);
    return pets;
  }

  /* ---------- 对外 API ---------- */
  window.Pet = {
    createPet, addPet, getPets, getActivePet, setActive, removePet, petFromRow, clearPets,
    baseStats, getStats, getBonusText, getStatCoeff, grantExp, expNeed, expFromBattle, expRange, createBaby, setCloudPets,
    getCurHp, setCurHp, regenTick, getBaseSpeed, restoreEquipment, addExpPool, getBloodline,
    rollPetTraits, getAwakenState, statParts
  };
})();
