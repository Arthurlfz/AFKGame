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
  let onFightEnd = null;   // main.js 注入的每场结算回调
  let selectedAreaId = null;
  const state = { pet: null, petRef: null, enemy: null, petAction: 0, enemyAction: 0 };

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
    window.UI.addLog(reason, false, true);
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
  function getLevelBand(level, area) {
    const [areaMin, areaMax] = area?.levelRange || [1, 60];
    const effectiveLevel = Math.min(areaMax, Math.max(areaMin, level || areaMin));
    const bandMin = Math.max(areaMin, Math.floor((effectiveLevel - 1) / 5) * 5 + 1);
    return [bandMin, Math.min(areaMax, bandMin + 4)];
  }
  function getAreaEnemyPool(area, playerLevel) {
    const enemies = getEnemyPool();
    const [areaMin, areaMax] = area?.levelRange || [1, 60];
    const [bandMin, bandMax] = getLevelBand(playerLevel || areaMin, area);
    const areaIds = new Set(area?.enemyIds || []);
    const inArea = enemy => {
      const [enemyMin, enemyMax] = enemy.levelRange || [enemy.level || 1, enemy.level || 1];
      return enemyMax >= areaMin && enemyMin <= areaMax;
    };
    const inBand = enemy => {
      const [enemyMin, enemyMax] = enemy.levelRange || [enemy.level || 1, enemy.level || 1];
      return enemyMax >= bandMin && enemyMin <= bandMax;
    };
    const areaPool = areaIds.size ? enemies.filter(enemy => areaIds.has(enemy.id) && inArea(enemy)) : [];
    const bandPool = areaPool.filter(inBand);
    return bandPool.length ? bandPool : areaPool;
  }
  function setEncounterLevel(enemy, playerLevel, area) {
    const [bandMin, bandMax] = getLevelBand(playerLevel, area);
    const level = bandMin + Math.floor(Math.random() * (bandMax - bandMin + 1));
    return { ...enemy, level };
  }
  // 怪的成长值按区域 growthRange 取（config.battle.areas 每图配），没有则回退随机 3~6。
  // 怪的攻击成长系数独立用 ENEMY_ATK_COEFF=3（高于玩家 def 成长），保证怪攻能稳定破玩家防御，
  // 避免"怪物破不了玩家防御"（伤害压到 1）的失衡。生命/防御沿用全局系数。
  const ENEMY_ATK_COEFF = 3;
  function scaleEnemyStats(enemy, area) {
    const level = enemy.level || 1;
    const diff = (area && area.difficulty) || 1.0;
    const gr = (area && area.growthRange) || [3, 6];
    const growth = enemy.growth ?? (gr[0] + Math.floor(Math.random() * (gr[1] - gr[0] + 1)));
    const C = Config.pet.statCoeff;
    const hp = Math.round((enemy.hp + level * growth * C.hp) * diff);
    const atk = Math.round((enemy.atk + level * growth * ENEMY_ATK_COEFF) * diff);
    const def = Math.round((enemy.def + level * growth * C.def) * diff);
    const spd = enemy.spd;
    return { ...enemy, growth, hp, maxHp: hp, atk, def, spd, _diff: diff };
  }
  function pickEnemyByLevel() {
    const level = getPlayerLevel();
    const area = getCurrentArea();
    if (!area) return null;
    const enemies = getAreaEnemyPool(area, level);
    const picked = enemies.length ? pickWeighted(enemies, item => item.weight || 1) : null;
    return picked ? { enemy: setEncounterLevel(picked, level, area), area, enemies } : null;
  }
  function beginFight() {
    const pet = getActivePet();
    const stats = getStats(pet);
    const picked = pickEnemyByLevel();
    if (!picked) {
      window.UI.addLog(getCurrentArea() ? '⚠️ 当前地图没有可用野怪，请检查怪物池配置。' : '⚠️ 请先选择挂机地图。', false, true);
      return;
    }
    const { enemy: ENEMY, area } = picked;
    const enemyStats = scaleEnemyStats(ENEMY, area);
    state.petRef = pet; // 本场战斗的宠物对象：血量写回/属性快照以此为准（切换出战不串宠）
    state.pet = { name: pet.name, icon: pet.icon, level: pet.level || 1, hp: getCurHp(pet), maxHp: stats.hp, atk: stats.atk, def: stats.def, spd: stats.spd, critRate: stats.critRate, critDamage: stats.critDamage, hit: stats.hit, dodge: stats.dodge, lifesteal: stats.lifesteal };
    state.enemy = enemyStats;
    // 敌人暴击/命中/闪避/吸血：无预设时用全局默认（敌我一致体验），有预设则按其值
    if (state.enemy.critRate == null) state.enemy.critRate = Config.battle.critRate;
    if (state.enemy.critDamage == null) state.enemy.critDamage = Config.battle.critMultiplier;
    if (state.enemy.hit == null) state.enemy.hit = 0.9;
    if (state.enemy.dodge == null) state.enemy.dodge = 0.05;
    if (state.enemy.lifesteal == null) state.enemy.lifesteal = 0;
    state.petAction = 0;
    state.enemyAction = 0;
    const petLabel = `${state.pet.name} 等级：${state.pet.level || getPlayerLevel()}级`;
    const enemyLabel = `${state.enemy.name} 等级：${state.enemy.level || 1}级`;
    window.UI.resetBattle(petLabel, state.pet.icon, enemyLabel, state.enemy.icon, state.pet.maxHp, state.enemy.maxHp);
    window.UI.updateBattleArea(area);
    window.UI.updateStatus('fighting', fightCount);
    window.UI.addLog(`⚔️ 第${fightCount + 1}场：${state.pet.name} 遭遇${state.enemy.name}！`);
    window.UI.updateBars(state.pet.hp, state.pet.maxHp, state.enemy.hp, state.enemy.maxHp);

    interval = setInterval(tick, 100);
  }
  function tick() {
    // 进度条满值固定 100，累加 = 速度 / speedScale（config 校正攻速量级，改这一个数即调整体快慢）
    const scale = Config.battle.speedScale || 1;
    state.petAction += state.pet.spd / scale;
    state.enemyAction += state.enemy.spd / scale;
    window.UI.updateAction(state.petAction, state.enemyAction);
    if (state.petAction >= 100)   { state.petAction = 0;   doTurn('pet'); }
    if (state.enemyAction >= 100) { state.enemyAction = 0; doTurn('enemy'); }
    if (state.pet.hp <= 0 || state.enemy.hp <= 0) endFight();
  }
  function doTurn(attacker) {
    if (state.pet.hp <= 0 || state.enemy.hp <= 0) return;
    const isPet = attacker === 'pet';
    const atkData = isPet ? state.pet : state.enemy;
    const defData = isPet ? state.enemy : state.pet;
    window.UI.animateAttack(attacker);
    setTimeout(() => { // 攻击动画演出后结算普通攻击伤害
      const { damage, isCrit, isMiss, heal } = calcDamage(atkData, defData);
      defData.hp -= damage;
      // 吸血：攻击者按伤害回血（不超上限）
      if (heal > 0) {
        atkData.hp = Math.min(atkData.maxHp, atkData.hp + heal);
      }
      const target = isPet ? 'enemy' : 'pet';
      window.UI.animateHit(target);
      if (isMiss) {
        window.UI.showDamage(target, 0, 'miss');
        window.UI.addLog(`💨 ${defData.name} 闪避了 ${atkData.name} 的攻击！`);
      } else {
        window.UI.showDamage(target, damage, isCrit ? 'crit' : 'normal');
        // 战斗记录精简：普通攻击一行短记录，暴击高亮；掉落/死亡另有展示
        window.UI.addLog(isCrit
          ? `⚡ ${defData.name} 暴击 -${damage}`
          : `⚔️ ${defData.name} -${damage}`, isCrit);
      }
      window.UI.updateBars(state.pet.hp, state.pet.maxHp, state.enemy.hp, state.enemy.maxHp);
    }, 150);
  }
  // 完整伤害结算：命中判定 → 攻防减法 → 暴击 → 吸血
  // att/defStats 需带 hit/dodge/lifesteal（小数）；缺失则回退默认，保持兼容
  function calcDamage(att, defStats) {
    const atk = att.atk, def = defStats.def;
    // 命中判定：命中率 = 攻击者命中 - 防御者闪避（封顶 95%，保底 20%）
    const hit = att.hit == null ? 0.9 : att.hit;
    const dodge = defStats.dodge == null ? 0.05 : defStats.dodge;
    const hitChance = Math.max(0.2, Math.min(0.95, hit - dodge));
    if (Math.random() >= hitChance) {
      return { damage: 0, isCrit: false, isMiss: true, heal: 0 };
    }
    const rate = (att.critRate == null) ? Config.battle.critRate : att.critRate;
    const mult = (att.critDamage == null) ? Config.battle.critMultiplier : att.critDamage;
    const isCrit = Math.random() < rate;
    let dmg = Math.max(1, atk - def);
    if (isCrit) dmg = Math.floor(dmg * mult);
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
    // 血量写回「本场」宠物（petRef），避免中途切换出战后把血量写到别的宠物身上
    setCurHp(state.petRef || getActivePet(), state.pet.hp);
    fightCount++;
    totalFights++; // 累计战斗场数（跨挂机累计）
    window.UI.addLog(win ? `🏆 第${fightCount}场胜利！` : '💀 战斗失败……', false, true, !win);
    window.UI.updateStatus('fighting', fightCount);

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
  window.Battle = { startAutoBattle, stopAutoBattle, isRunning, isWaitingRecover, getTotalFights: () => totalFights, selectArea, getAreas, getCurrentArea, state };
})();
