/* ============================================================
 * battle.js —— 连续挂机战斗系统
 * 职责：
 *  1. 自动战斗循环：一场接一场打怪，无需玩家操作
 *  2. 行动条自动回合制（速度决定行动条填充速度，先满先动）
 *  3. 伤害计算：攻击-防御（最低1），暴击率10%、暴击伤害1.5倍
 *  4. 血量跨场延续：每场结束时写回宠物持久血量（Pet.curHp）
 *  5. 停止规则：血量低于 30% 自动停止；玩家可随时手动停止
 *  6. 每场结算（经验/掉落）通过回调交给 main.js 编排
 * 状态：autoRunning / fightCount / state 仅本模块持有
 * 依赖：pet.js（出战宠物与持久血量）、ui/ui-battle.js（战斗视觉/日志/状态徽章）
 * ============================================================ */
(function () {
  'use strict';

  const Config = window.Config;
  const { pickWeighted } = window.Util;
  const { getActivePet, getStats, getCurHp, setCurHp } = window.Pet;

  let autoRunning = false; // 挂机中（含等待回血：autoRunning 保持 true，仅 waitingRecover 区分）
  let waitingRecover = false; // 血量见底/战败后等待回血，回满自动继续
  let recoverTimer = null;    // 回血检测时钟
  let fightCount = 0;      // 本次挂机已打场数（停止后清零）
  let totalFights = 0;     // 累计战斗场数（跨挂机累计，只增不减）
  let interval = null;     // 当前场的行动条时钟
  let nextFightTimer = null;
  /* 行动条冻结：一次出手 = 前摇(蓄力) → 冲刺(扑到对方脸上) → 命中结算 → 后摇(收招归位)。
   * 老逻辑是 tick 恒温 100ms 一直累加，于是"人还在半路，下一次已在蓄力"——
   * 演出和数值各走各的，看起来是连招乱放而不是回合制。
   * 现在谁出手谁冻结，时长 = hitAt（前摇+冲刺，到命中）+ backMs（后摇归位），归位才解冻。
   * ⚠️ 只冻结出手那一方，对手照常蓄力：试过全场冻结，双方轮流播演出等于每回合串行等，
   *   实测 60 秒从 9 场掉到 7 场（8.6s/场），节奏砍半 —— 挂机游戏拖不起这个。 */
  const freeze = { pet: false, enemy: false };
  const unfreezeTimer = { pet: null, enemy: null };
  let fightEnded = false;   // 本场是否已结算（tick 与伤害结算都可能触发，防重复）
  let onFightEnd = null;   // main.js 注入的每场结算回调
  let lastTickTs = 0;      // 战斗计时基准（tick 按真实流逝时间补步，后台节流不减速）
  let selectedAreaId = null;
  const state = { pet: null, petRef: null, enemy: null, petAction: 0, enemyAction: 0, activeSkill: null, skillCooldown: 0, skillQueued: false };
  // 血统被动：跨场状态
  let pendingKillBuff = false;  // 骨狼：击杀后下次攻击+伤害（跨场传递）
  let bloodline = null;          // 当前出战宠物的血统被动配置
  let killBuffActive = false;    // 本场是否激活击杀增益
  let corruptionStacks = 0;      // 毒沼蛙：敌人腐蚀层数

  /* ---------- 开始 / 停止 ---------- */
  // startAutoBattle(callback)：callback({win, fightCount}) 每场结束调用
  function startAutoBattle(callback) {
    if (autoRunning) return;
    autoRunning = true;
    waitingRecover = false;
    fightCount = 0;
    onFightEnd = callback;
    window.UI.updateStatus('fighting', fightCount);
    window.UI.addLog('🕹 开始自动战斗！');
    beginFight();
  }
  // 手动停止：立即停下，当前血量写回宠物
  function stopAutoBattle() {
    if (!autoRunning) return;
    autoRunning = false;
    waitingRecover = false;
    clearFreeze('pet'); clearFreeze('enemy');
    clearInterval(interval);   interval = null;
    clearTimeout(nextFightTimer); nextFightTimer = null;
    clearInterval(recoverTimer); recoverTimer = null;
    // 等 250ms 让本回合 pending 的伤害演出（150ms）结算完，再写回准确血量
    setTimeout(() => {
      if (state.pet) setCurHp(state.petRef || getActivePet(), state.pet.hp);
    }, 250);
    window.UI.addLog('🛑 停止自动战斗');
    window.UI.updateStatus('stopped', fightCount);
  }
  const isRunning = () => autoRunning;
  const isWaitingRecover = () => waitingRecover;

  /* ---------- 等待回血（血量见底 / 战败 → 回满自动接下一场） ---------- */
  // 回血由 main.js 的每秒时钟驱动（regenTick），本处只检测血量是否回满
  function enterRecover(reason) {
    waitingRecover = true;
    window.UI.updateStatus('recovering', fightCount);
    window.UI.addLog(reason);
    clearInterval(recoverTimer);
    recoverTimer = setInterval(() => {
      const pet = getActivePet();
      if (!pet) return;
      if (getCurHp(pet) >= getStats(pet).hp) {
        clearInterval(recoverTimer);
        recoverTimer = null;
        waitingRecover = false;
        window.UI.addLog('💚 恢复完毕，自动继续挂机！');
        beginFight();
      }
    }, 500);
  }

  /* ---------- 单场战斗 ---------- */
  function getPlayerLevel() {
    const pet = getActivePet();
    return pet ? (pet.level || 1) : 1;
  }
  function getEnemyPool() {
    return window.EnemyData?.list || Config.battle.enemies || [];
  }
  function getCurrentArea() {
    const areas = Config.battle.areas || [];
    return areas.find(area => area.id === selectedAreaId) || null;
  }
  function selectArea(areaId) {
    const area = (Config.battle.areas || []).find(item => item.id === areaId);
    if (!area || autoRunning) return false;
    selectedAreaId = area.id;
    return true;
  }
  function getAreas() {
    return (Config.battle.areas || []).slice();
  }
  /* 怪物等级 = 宠物等级【钳进】地图等级段（2026-08-30 用户拍板：匹配地图的等级，而不是宠物等级）。
   * 公式：怪等级 = clamp(宠物等级, 图下限, 图上限)。
   *   图决定「范围」，宠物等级决定「范围内的具体值」，走到边界就停住。
   * 为什么要钳：老逻辑「怪等级 = 玩家等级」不设边界，Lv60 打图 1 也出 Lv60 的怪 ——
   *   图的等级段形同虚设，图与图没有区别，玩家赖在低级图也能拿满经验
   *   （经验 = coef × 怪等级，见 pet.js expBase）。钳住之后图1 封顶 6 级、图10 是 55~60，
   *   想拿高级经验就必须去高级图，图的推进感回来了。
   * 为什么不改成「图段内纯随机」（曾实现过，实测后被推翻）：
   *   低级图的等级段相对中点跨度极大 —— 图1 是 [1,6]、中点 3.5，强度按 怪等级/图中点 缩放后
   *   段内跨度达 5.6 倍（1级=0.29 倍 ↔ 6级=1.6 倍）。实测新手 Lv1 在图1 遇 Lv3 怪就 5/8 只打不过、
   *   遇 Lv4~6 全灭，只有 2/6 ≈ 33% 的场次能赢，Lv1→Lv2 要打约 30 场。能推进但前期是煎熬。
   *   （高级图不受影响：图10 [55,60] 中点 57.5，段内跨度仅 1.04 倍。）
   * ⚠️ 越级进高级图（如 Lv1 进 55-60 的魂渊）：怪取图下限 55，必输 —— 这是图的门槛，
   *   选图时给确认提示（ui-worldmap.js），玩家仍可硬闯。
   */
  function rollEnemyLevel(area, playerLevel) {
    const range = (area && area.levelRange) || [1, 6];
    const a = Math.max(1, Number(range[0]) || 1), b = Math.max(1, Number(range[1]) || 1);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const lv = Math.max(1, Number(playerLevel) || 1);
    return Math.min(hi, Math.max(lo, lv));
  }
  // 怪池 = 该图 enemyIds ∩ 怪自身等级段与图等级段重叠。
  // 不再按玩家等级取 band：怪等级已由地图定，整池对这张图都合适。
  function getAreaEnemyPool(area) {
    const enemies = getEnemyPool();
    const [areaMin, areaMax] = (area && area.levelRange) || [1, 60];
    const areaIds = new Set((area && area.enemyIds) || []);
    if (!areaIds.size) return [];
    const inArea = enemy => {
      const [enemyMin, enemyMax] = enemy.levelRange || [enemy.level || 1, enemy.level || 1];
      return enemyMax >= areaMin && enemyMin <= areaMax;
    };
    return enemies.filter(enemy => areaIds.has(enemy.id) && inArea(enemy));
  }
  function setEncounterLevel(enemy, playerLevel, area) {
    return { ...enemy, level: rollEnemyLevel(area, playerLevel) };
  }
  // 怪物数值（2026-08-30 用户拍板：直接定死，不随成长算）。
  // 每图一套基准数值（config.battle.areaEnemyStats，按图中点等级校准），
  // 实际值 = 基准 × 玩家等级/图中点等级 —— 图强度带固定（图1永远最弱、图6最强），
  // 玩家在带内随等级成长：Lv1 打图1 = 1级强度，Lv5 打图1 = 5级强度。
  //   裸装正常玩家 ≈ 5 刀（能推、慢但不死）→ 穿装备 ≈ 3.5 刀 → 融合/涅槃叠成长 → 一刀秒。
  // 怪类型强度（普通/进化/变异）由 config.battle.typeMult 乘算。
  function scaleEnemyStats(enemy, area) {
    const diff = (area && area.difficulty) || 1.0;
    const base = (Config.battle.areaEnemyStats || {})[area && area.id] || { hp: 320, atk: 72, def: 30 };
    const tm = ((area && area.enemyMult) || (Config.battle.typeMult || {})[enemy.enemyType]) || 1.0;
    const [lo, hi] = (area && area.levelRange) || [1, 10];
    const mid = (lo + hi) / 2;
    const level = enemy.level || 1;
    // 玩家等级低于图中点 → 按比例降强度（保底 25%，Lv1 也能打），高于中点 → 上限压制（越级碾压有限）
    // clamp 边界在 config.battle.levelScaleClamp（2026-08-31 上限 1.6→1.25，修图1 后段新手打不过）
    const clampCfg = Config.battle.levelScaleClamp || [0.25, 1.6];
    const ratio = Math.max(clampCfg[0], Math.min(clampCfg[1], level / mid));
    const hp  = Math.round(base.hp * ratio * tm * diff);
    const def = Math.round(base.def * ratio * tm * diff);
    const atk = Math.round(base.atk * ratio * tm * diff);
    const spd = enemy.spd;
    return { ...enemy, growth: (area && area.recGrowth) || 3, hp, maxHp: hp, atk, def, spd, _diff: diff };
  }
  // 怪等级 = 宠物等级钳进图等级段（rollEnemyLevel），故保留 playerLevel 入参
  function pickEnemy() {
    const area = getCurrentArea();
    if (!area) return null;
    const level = getPlayerLevel();
    const enemies = getAreaEnemyPool(area);
    const picked = enemies.length ? pickWeighted(enemies, item => item.weight || 1) : null;
    return picked ? { enemy: setEncounterLevel(picked, level, area), area, enemies } : null;
  }
  function beginFight() {
    const pet = getActivePet();
    const stats = getStats(pet);
    const picked = pickEnemy();
    if (!picked) {
      window.UI.addLog(getCurrentArea() ? '⚠️ 当前地图没有可用野怪，请检查怪物池配置。' : '⚠️ 请先选择挂机地图。');
      return;
    }
    const { enemy: ENEMY, area } = picked;
    const enemyStats = scaleEnemyStats(ENEMY, area);
    state.petRef = pet; // 本场战斗的宠物对象：血量写回/属性快照以此为准（切换出战不串宠）
    state.pet = { name: pet.name, icon: pet.icon, level: pet.level || 1, hp: getCurHp(pet), maxHp: stats.hp, atk: stats.atk, def: stats.def, spd: stats.spd, critRate: stats.critRate, critDamage: stats.critDamage, hit: stats.hit, dodge: stats.dodge, lifesteal: stats.lifesteal, pen: stats.pen || 0, dmgBonus: stats.dmgBonus || 0, dr: stats.dr || 0 };
    state.enemy = enemyStats;
    // 敌人机制属性：命中/闪避均为固定数值（命中率 = 命中 ÷ (命中 + 闪避)）。
    // 闪避按怪物类型给基础值（normal 5 / evolved 8 / mutant 12），让战斗有闪避博弈；命中保持 90。
    if (state.enemy.critRate == null) state.enemy.critRate = Config.battle.critRate;
    if (state.enemy.critDamage == null) state.enemy.critDamage = Config.battle.critMultiplier;
    if (state.enemy.hit == null) state.enemy.hit = 90;
    if (state.enemy.dodge == null) {
      const et = state.enemy.enemyType || 'normal';
      state.enemy.dodge = et === 'mutant' ? 12 : et === 'evolved' ? 8 : 5;
    }
    if (state.enemy.lifesteal == null) state.enemy.lifesteal = 0;
    // 敌人侧三新词缀兜底：怪物没配就是 0，calcDamage 行为与旧版一致
    if (state.enemy.pen == null) state.enemy.pen = 0;
    if (state.enemy.dmgBonus == null) state.enemy.dmgBonus = 0;
    if (state.enemy.dr == null) state.enemy.dr = 0;
    state.petAction = 0;
    state.enemyAction = 0;
    // 变异宠名字带「·异变」后缀，用 skillOf 剥离后缀继承本体主动技能
    const skill = (Config.pet.evolution && Config.pet.evolution.skillOf)
      ? Config.pet.evolution.skillOf(pet.name)
      : Config.pet.evolution.activeSkills?.[pet.name];
    state.activeSkill = skill && state.pet.level >= skill.minLevel ? skill : null;
    state.skillCooldown = 0;
    state.skillQueued = false;
    // 血统被动初始化
    bloodline = window.Pet && window.Pet.getBloodline ? window.Pet.getBloodline(pet) : null;
    killBuffActive = pendingKillBuff;
    pendingKillBuff = false;
    corruptionStacks = 0;
    clearFreeze('pet'); clearFreeze('enemy');
    fightEnded = false;
    const petLabel = `${state.pet.name} 等级：${state.pet.level || getPlayerLevel()}级`;
    const enemyLabel = `${state.enemy.name} 等级：${state.enemy.level || 1}级`;
    window.UI.resetBattle(petLabel, state.pet.icon, enemyLabel, state.enemy.icon, state.pet.maxHp, state.enemy.maxHp);
    window.UI.updateBattleArea(area);
    window.UI.updateStatus('fighting', fightCount);
    window.UI.updateBars(state.pet.hp, state.pet.maxHp, state.enemy.hp, state.enemy.maxHp);
    window.UI.renderActiveSkill?.(state.activeSkill, state.skillCooldown, state.skillQueued);

    lastTickTs = Date.now(); // 开场基准：防上一场遗留的 lastTickTs 造成首 tick 跳步
    interval = setInterval(tick, 100);
  }
  // 血统被动：疫毛兽 疾风步 — 速度超阈值后每N点+攻速，上限cap
  function getBloodlineAspdMult() {
    if (!bloodline || bloodline.type !== 'speedAspd' || !bloodline.params) return 1;
    const p = bloodline.params;
    const spd = state.pet ? state.pet.spd : 0;
    if (spd <= p.threshold) return 1;
    const bonus = Math.min(p.cap, Math.floor((spd - p.threshold) / p.perPoint) * p.bonusPer);
    return 1 + bonus;
  }
  // 战斗计时按【真实流逝时间】推进（2026-09-03）：浏览器切后台会把 setInterval 节流到 1 次/秒甚至更低，
  // 旧逻辑固定 100ms 步进 → 后台行动条慢 10 倍+，经验/掉落跟着几乎停摆（挂机游戏致命）。
  // 现在每 tick 用 Date.now() 算真实毫秒差 → 换算成 100ms 步数一次性补足 → 挂机速度与前台一致。
  function tick() {
    const now = Date.now();
    const steps = Math.min(Math.max(1, Math.floor((now - lastTickTs) / 100)), 600); // 封顶 60 秒/次，防极端堆积
    lastTickTs = now;
    for (let i = 0; i < steps && !fightEnded; i++) step();
  }
  function step() {
    // 进度条满值固定 100，累加 = 速度 / speedScale（config 校正攻速量级，改这一个数即调整体快慢）
    // 谁在演出谁就冻在当前位置（立绘还在对方脸上/收招回位的路上），对手不受牵连
    const scale = Config.battle.speedScale || 1;
    if (!freeze.pet)   state.petAction += state.pet.spd * getBloodlineAspdMult() / scale;
    if (!freeze.enemy) state.enemyAction += state.enemy.spd / scale;
    window.UI.updateAction(state.petAction, state.enemyAction);
    if (!freeze.pet && state.petAction >= 100)     { state.petAction = 0;   doTurn('pet'); }
    if (!freeze.enemy && state.enemyAction >= 100) { state.enemyAction = 0; doTurn('enemy'); }
    if (!fightEnded && (state.pet.hp <= 0 || state.enemy.hp <= 0)) endFight();
  }
  // 冻结某一方的行动条 ms 毫秒（= 它这一次出手的完整演出时长），到点自动解冻
  function freezeAction(side, ms) {
    clearTimeout(unfreezeTimer[side]);
    if (!(ms > 0)) return;
    freeze[side] = true;
    unfreezeTimer[side] = setTimeout(() => { freeze[side] = false; unfreezeTimer[side] = null; }, ms);
  }
  function clearFreeze(side) {
    clearTimeout(unfreezeTimer[side]);
    unfreezeTimer[side] = null;
    freeze[side] = false;
  }
  function doTurn(attacker) {
    if (state.pet.hp <= 0 || state.enemy.hp <= 0) return;
    const isPet = attacker === 'pet';
    const atkData = isPet ? state.pet : state.enemy;
    const defData = isPet ? state.enemy : state.pet;
    // 主动技能概率触发：宠物本回合行动时判定（默认 30%），触发后本回合施放技能
    if (isPet && state.activeSkill && state.skillCooldown <= 0 && !state.skillQueued && Math.random() < (state.activeSkill.triggerChance || 0.30)) {
      state.skillQueued = true;
    }
    const skill = isPet && state.skillQueued ? state.activeSkill : null;
    // 觉醒：Lv60 终形态宠物施放主动技能时伤害 ×(1+awaken.damage)（默认 +20%）
    const awakenMult = (isPet && skill && window.Pet.getAwakenState)
      ? ((window.Pet.getAwakenState(state.pet) || {}).damage || 0) : 0;
    if (skill) {
      state.skillQueued = false;
      state.skillCooldown = skill.cooldownTurns;
      window.UI.renderActiveSkill?.(state.activeSkill, state.skillCooldown, state.skillQueued);
    }
    // 伤害结算对齐"扑到对方脸上"那一刻。时刻由表现层给出：冲刺时长随两只宠的间距自适应，
    // 这里写死一个数字的话，宽屏上血条和飘字会在立绘还没冲到时就跳出来。
    const hitAt = window.UI.animateAttack(attacker) || 320;
    // 命中之后立绘还要收招回位（后摇），这段时间也算演出 —— 归位才算打完这一下
    const backMs = window.UI.attackRecoverMs ? (window.UI.attackRecoverMs(attacker) || 0) : 0;
    freezeAction(isPet ? 'pet' : 'enemy', hitAt + backMs);
    setTimeout(() => {
      const result = calcDamage(atkData, defData);
      // 血统被动：伤害乘算（骨狼击杀增益 / 毒沼蛙腐蚀易伤）
      let dmgMult = 1;
      if (isPet && bloodline) {
        if (bloodline.type === 'killDamageBuff' && killBuffActive && bloodline.params) {
          dmgMult *= bloodline.params.damageMult || 1.5;
          killBuffActive = false;  // 消耗增益
        }
        if (bloodline.type === 'corruptionStack' && corruptionStacks > 0 && bloodline.params) {
          dmgMult *= 1 + (bloodline.params.perStack || 0.05) * corruptionStacks;
        }
      }
      const bonus = skill && !result.isMiss
        ? Math.floor(result.damage * (skill.damageMultiplier * (1 + awakenMult) - 1)) + Math.floor(defData.maxHp * (skill.maxHpDamageRate || 0))
        : 0;
      const damage = Math.floor(result.damage * dmgMult) + bonus;
      defData.hp -= damage;
      if (result.heal > 0) {
        atkData.hp = Math.min(atkData.maxHp, atkData.hp + result.heal);
        window.UI.showDamage(isPet ? 'pet' : 'enemy', result.heal, 'lifesteal');
      }
      const target = isPet ? 'enemy' : 'pet';
      window.UI.animateHit(target, result.isCrit);
      window.UI.showDamage(target, damage, result.isMiss ? 'miss' : skill ? 'skill' : result.isCrit ? 'crit' : 'normal');
      window.UI.updateBars(state.pet.hp, state.pet.maxHp, state.enemy.hp, state.enemy.maxHp);

      // ===== 血统被动触发 =====
      const bl = bloodline;
      if (bl && isPet && !result.isMiss) {
        // 血狐：暴击追加普攻
        if (bl.type === 'onCritExtraHit' && result.isCrit && bl.params && Math.random() < bl.params.chance) {
          const extraDmg = Math.max(1, Math.floor((atkData.atk - defData.def) * (bl.params.damageMult || 1)));
          defData.hp -= extraDmg;
          window.UI.showDamage('enemy', extraDmg, 'normal');
        }
        // 毒沼蛙：腐蚀叠层
        if (bl.type === 'corruptionStack' && bl.params) {
          corruptionStacks = Math.min(bl.params.maxStacks || 5, corruptionStacks + 1);
        }
        // 尸犬：吸血附加真实伤害
        if (bl.type === 'lifestealTrueDamage' && result.heal > 0 && bl.params) {
          const trueDmg = Math.floor(result.heal * (bl.params.ratio || 1));
          defData.hp -= trueDmg;
          window.UI.showDamage('enemy', trueDmg, 'normal');
        }
      }
      // 瘟熊：受击反伤（敌人攻击宠物时）
      if (bl && !isPet && !result.isMiss && bl.type === 'onHitReflect' && bl.params) {
        const reflectDmg = Math.floor(state.pet.def * (bl.params.defRatio || 0.3));
        atkData.hp -= reflectDmg;
        window.UI.showDamage('enemy', reflectDmg, 'normal');
      }
      // 幽影兔：闪避反击
      if (bl && !isPet && result.isMiss && bl.type === 'onDodgeCounter' && bl.params) {
        const counterDmg = Math.max(1, Math.floor((state.pet.atk - atkData.def) * (bl.params.damageMult || 0.8)));
        atkData.hp -= counterDmg;
        window.UI.showDamage('enemy', counterDmg, 'normal');
      }
      // 被动造成额外伤害后重新更新血条
      if (bl) window.UI.updateBars(state.pet.hp, state.pet.maxHp, state.enemy.hp, state.enemy.maxHp);    }, hitAt);
    if (isPet && state.skillCooldown > 0 && !skill) {
      state.skillCooldown--;
      window.UI.renderActiveSkill?.(state.activeSkill, state.skillCooldown, state.skillQueued);
    }
  }
  function useActiveSkill() {
    if (!autoRunning || !state.pet || !state.enemy || state.enemy.hp <= 0) return false;
    if (!state.activeSkill || state.skillCooldown > 0 || state.skillQueued) return false;
    state.skillQueued = true;
    window.UI.renderActiveSkill?.(state.activeSkill, state.skillCooldown, state.skillQueued);
    return true;
  }
  // 完整伤害结算：命中判定 → 攻防减法(含穿透) → 暴击 → 伤害加成% → 受伤减免%(clamp) → 吸血
  // 命中和闪避均为固定值，命中率 = 命中 ÷ (命中 + 闪避)，并保留 5%~95% 边界。
  // 2026-09-04 新增三个纯数值词缀结算（怪物侧字段缺省=0，行为不变）：
  //   穿透 pen：减法伤害里无视 pen 点防御；伤害加成 dmgBonus/100：结果乘 (1+x)；受伤减免 dr/100：受击侧乘 (1-x)，最低承伤 clamp 10%。
  function calcDamage(att, defStats) {
    const atk = att.atk, def = defStats.def;
    const hit = Math.max(0, att.hit || 0);
    const dodge = Math.max(0, defStats.dodge || 0);
    const hitChance = hit + dodge > 0
      ? Math.max(0.05, Math.min(0.95, hit / (hit + dodge)))
      : 0.05;
    if (Math.random() >= hitChance) {
      return { damage: 0, isCrit: false, isMiss: true, heal: 0 };
    }
    const rate = (att.critRate == null) ? Config.battle.critRate : att.critRate;
    const mult = (att.critDamage == null) ? Config.battle.critMultiplier : att.critDamage;
    const isCrit = Math.random() < rate;
    // 穿透：只削防御，不把防御削成负数（负防御会放大伤害，穿透不该有这个收益）
    const effDef = Math.max(0, def - Math.max(0, att.pen || 0));
    let dmg = Math.max(1, atk - effDef);
    if (isCrit) dmg = Math.floor(dmg * mult);
    // 伤害加成%：进攻侧最终乘区
    if (att.dmgBonus) dmg = Math.floor(dmg * (1 + att.dmgBonus / 100));
    // 受伤减免%：受击侧乘区，最低承伤 10%（防坦克无限叠成免伤）
    const dr = Math.min(90, Math.max(0, defStats.dr || 0));
    if (dr > 0) dmg = Math.max(1, Math.floor(dmg * (100 - dr) / 100)); // 整数运算避免 70*0.1=6.999… 的浮点陷阱
    // 吸血：命中且造成伤害时，按伤害 × 攻击者吸血率回血
    const lifesteal = att.lifesteal == null ? 0 : att.lifesteal;
    const heal = lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;
    return { damage: dmg, isCrit, isMiss: false, heal };
  }

  /* ---------- 单场结束：结算 → 判定继续/回血/停止 ---------- */
  function endFight() {
    clearInterval(interval);
    interval = null;
    const win = state.pet.hp > 0;
    // 血统被动：骨狼击杀增益跨场传递
    if (win && bloodline && bloodline.type === 'killDamageBuff') {
      pendingKillBuff = true;
    }
    // 血量写回「本场」宠物（petRef），避免中途切换出战后把血量写到别的宠物身上
    setCurHp(state.petRef || getActivePet(), state.pet.hp);
    fightCount++;
    totalFights++; // 累计战斗场数（跨挂机累计）
    // 胜利不单独播报：每场的「经验 +N」已经代表打赢了；战败是异常事件，必须让玩家看见。
    if (!win) window.UI.addLog('💀 战斗失败……');
    window.UI.updateStatus('fighting', fightCount);
    if (win && window.UI.animateVictory) window.UI.animateVictory(); // 胜利演出：敌人淡出（表现层）

    if (onFightEnd) onFightEnd({ win, fightCount, enemy: state.enemy }); // main：结算经验/掉落/刷新UI
    // 经验/掉落归属「当前出战」宠物（main.js handleFightEnd 用 getActivePet），切换后即给新宠物

    // 战败（宠物死亡）→ 自动等待回血，回满继续挂机，无需手动操作
    if (!win) {
      enterRecover('💀 战败，等待恢复后自动再战…');
      return;
    }
    // 血量低于阈值 → 自动回血后再战（阈值在 config.js）
    const pet = state.petRef || getActivePet();
    if (getCurHp(pet) <= getStats(pet).hp * Config.battle.stopHpRatio) {
      enterRecover(`💤 血量低于 ${Math.round(Config.battle.stopHpRatio * 100)}%，等待恢复后自动再战…`);
      return;
    }
    // 血量健康 → 接下一场（场间隔在 config.js；下一场自动用当前出战的宠物）
    nextFightTimer = setTimeout(beginFight, Config.battle.nextFightDelay);
  }

  /* ---------- 对外 API ---------- */
  window.Battle = { startAutoBattle, stopAutoBattle, isRunning, isWaitingRecover, getTotalFights: () => totalFights, selectArea, getAreas, getCurrentArea, useActiveSkill, state, calcDamage };
})();
