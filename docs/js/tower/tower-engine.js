/* ============================================================
 * tower/tower-engine.js —— 通天塔推进状态机（单一职责）
 * 职责：
 *  1. 层推进 + 楼内推进：每层 mobsPerFloor 只怪（前 4 杂兵 + 第 5 只守卫），
 *     5 只全清才算过层；层与层、楼内怪与怪之间血量都不回满。
 *  2. 层敌人生成：按层等级/层难度曲线缩放 + 腐印（腐蚀度）修正。
 *  3. 过层掉落即时入账（材料）+ 装备入包（走 TowerRewards.rollLayer）。
 *  4. 战斗页占用权：进塔前 claim（抢占野图挂机），终局释放。
 * 不负责：进入资格（tower-access.js）、档位奖励规则（tower-rewards.js）、任何 UI 渲染。
 * 依赖：tower-config/access/rewards/affix、battle（beginTrialFloor hook，mode='tower'）、pet、materials。
 *
 * ⚠️ 血量累计：整局只吃一管血，回血只该发生在战斗之外。野图的非战斗回血时钟
 * （main.js 每秒 regenTick）已按战斗页占用权在爬塔期间整体让位，hpCarry 保留为兜底
 * —— 防任何漏网的回血路径把「整局一管血」的张力抹平。切服务端权威后由服务端账本保证。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => (window.Config && window.Config.tower) || {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  const state = {
    running: false, floor: 0, mob: 0, maxFloor: 0, affixIds: [], combo: null,
    result: null, timer: null, access: null, hpCarry: null,
    layerLoot: [], cleared: false,
    // 诊断用：逐怪剩余血百分比 + 终局血量（结算面板的「死在第几层、差多少」靠它）
    hpTrace: [], endHpPct: null
  };

  // 运行事件（UI 订阅：floor/floorClear/floorFail/clear/loot/settle/log）；node 测试可注入收集
  let eventSink = null;
  function emit(event) {
    if (typeof eventSink === 'function') { try { eventSink(event); } catch (e) { /* UI 异常不中断战斗 */ } }
    if (window.UI && window.UI.onTowerEvent) { try { window.UI.onTowerEvent(event); } catch (e) { /* 同上 */ } }
  }
  function log(text) { emit({ type: 'log', text }); }

  function mobsPerFloor() {
    const n = Number(cfg().mobsPerFloor);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 1;
  }

  /* ---------- 层难度曲线（与副本同形态，参数全在 tower-config.js） ---------- */
  function floorLevelOf(floor) {
    const c = cfg();
    const shape = c.curve || {};
    const total = Math.max(2, Number(c.floors) || 30);
    const lo = Number(shape.levelStart) || 10, hi = Number(shape.levelEnd) || 100;
    const t = (floor - 1) / (total - 1);
    return Math.max(1, Math.round(lo + (hi - lo) * t));
  }
  function floorDifficultyOf(floor) {
    const shape = cfg().curve || {};
    const start = (shape.difficultyStart != null) ? Number(shape.difficultyStart) : 0.3;
    const per = Number(shape.difficultyPerFloor) || 0.105;
    const em = Number(shape.eliteMult) || 1;
    const every = Number(shape.eliteEvery) || 0;
    const elites = every > 0 ? Math.floor(floor / every) : 0;
    return start * Math.pow(1 + per, floor - 1) * Math.pow(em, elites);
  }
  function guardianNameOf(floor) {
    const g = (cfg().guardians || []).find(x => floor >= x.from && floor <= x.to);
    return (g && g.name) || '塔灵';
  }
  function mobNameOf(floor, mobIndex) {
    const per = mobsPerFloor();
    if (mobIndex >= per) return guardianNameOf(floor);
    const pool = cfg().mobNames || [];
    if (!pool.length) return guardianNameOf(floor);
    return pool[(floor + mobIndex) % pool.length];
  }

  /* 第 floor 层第 mobIndex 只怪（1-based）。
   * 楼内第 mobsPerFloor 只 = 守卫（guardianMult，更硬）；其余 = 杂兵（mobMult，更脆）。
   * ⚠️ 每层 5 只后单只必须更脆（否则一层 = 5 倍伤害），baseStats.hp 已按 ~1/5 重校。 */
  function mobEnemyStats(floor, mobIndex, combo) {
    const c = cfg();
    const shape = c.curve || {};
    const level = floorLevelOf(floor);
    const scale = level / (Number(shape.levelEnd) || 100);
    const diff = floorDifficultyOf(floor);
    const base = c.baseStats || { hp: 13600, atk: 6210, def: 3060 };
    const isGuardian = mobIndex >= mobsPerFloor();
    const m = isGuardian
      ? (c.guardianMult || { hp: 3.0, atk: 1.35, def: 1.05 })
      : (c.mobMult || { hp: 0.8, atk: 1.0, def: 0.9 });
    const hp = Math.max(1, Math.round(base.hp * (m.hp || 1) * scale * diff));
    /* 塔怪技能（2026-09-10）：守卫用 guardianSkills、杂兵用 mobSkills；
     * 按 (层 + 第几只) 取模分配 → 同一层每次进都一样（可复现，便于校准/对账/回放）。
     * 野图怪没有 skill 字段，battle.js 里「没 skill 就不摇随机数」→ 野图行为零变化。 */
    const skills = isGuardian ? (c.guardianSkills || []) : (c.mobSkills || []);
    const skill = skills.length ? skills[(floor + mobIndex) % skills.length] : null;
    const enemy = {
      id: `tower-${floor}-${mobIndex}`,
      name: mobNameOf(floor, mobIndex),
      level,
      enemyType: isGuardian ? 'evolved' : 'normal',
      spd: 80,
      hp, maxHp: hp,
      atk: Math.max(1, Math.round(base.atk * (m.atk || 1) * scale * diff)),
      def: Math.max(0, Math.round(base.def * (m.def || 1) * scale * diff)),
      hit: Number(c.guardianHit) || 160,
      growth: 0,
      skill: skill || undefined,
      _towerFloor: floor,
      _towerMob: mobIndex,
      _towerIsGuardian: isGuardian,
      _towerSkillName: skill ? skill.name : null
    };
    return window.TowerAffix ? window.TowerAffix.applyToEnemy(enemy, combo) : enemy;
  }
  /* 兼容/预览用：第 floor 层的守卫（第 mobsPerFloor 只）数值 */
  function floorEnemyStats(floor, combo) {
    return mobEnemyStats(floor, mobsPerFloor(), combo);
  }
  // 一层怪的总血量（预估器/测试用）
  function floorTotalHp(floor, combo) {
    let sum = 0;
    for (let i = 1; i <= mobsPerFloor(); i++) sum += mobEnemyStats(floor, i, combo).hp;
    return sum;
  }

  /* ---------- 战斗页占用权（core/battle-session.js） ----------
   * 与 trial-engine 同口径（不互相调用，避免塔耦合副本模块）：
   * 塔是玩家主动进入的玩法 → claim 抢占野图挂机，野图自己结算收尾并停会话；
   * 拿不到占用（另一个爬塔玩法在跑）就不进，且【不消耗免费次数/重置卡/腐印】。 */
  function claimPage() {
    const S = window.BattleSession;
    if (!S) return { ok: false, error: '战斗页占用权模块未加载（缺 core/battle-session.js）' };
    const r = S.claim('tower');
    if (r.ok) return { ok: true };
    return { ok: false, error: '战斗页被占用：' + ((r.holder && r.holder.label) || '其它玩法') + '进行中' };
  }
  function releasePage() {
    if (window.BattleSession) window.BattleSession.release('tower');
  }

  /* ---------- 推进：一只怪 ---------- */
  function beginMob() {
    const floor = state.floor;
    const mob = state.mob;
    const per = mobsPerFloor();
    const enemy = mobEnemyStats(floor, mob, state.combo);
    const Pet = window.Pet;
    const pet = Pet && Pet.getActivePet ? Pet.getActivePet() : null;
    if (!pet) { finish(false, '没有出战宠物'); return; }
    // 用上一只的战绩值覆盖间隙里偷偷回的血（见文件头注释）
    if (state.hpCarry != null && Pet.setCurHp) Pet.setCurHp(pet, state.hpCarry);
    state.hpCarry = null;

    const petMaxHp = (pet && Pet.getStats) ? Pet.getStats(pet).hp : 1;
    const petHp = (pet && Pet.getCurHp) ? Pet.getCurHp(pet) : petMaxHp;
    emit({
      type: 'floor', floor, total: cfg().floors || 30,
      mob, mobsPerFloor: per, isGuardian: mob >= per,
      enemy, petHp, petMaxHp, corrosion: state.combo ? state.combo.corrosion : 0
    });
    log(`⚔ 第 ${floor}/${cfg().floors || 30} 层 · 第 ${mob}/${per} 只 · ${enemy.name} Lv.${enemy.level}`
      + `（血 ${enemy.hp} 攻 ${enemy.atk} 防 ${enemy.def}）`
      + (enemy._towerSkillName ? ` · 会放「${enemy._towerSkillName}」` : ''));

    const ok = window.Battle && window.Battle.beginTrialFloor({
      enemy,
      onEnd: onMobEnd,
      mode: 'tower',
      healBlock: !!(state.combo && state.combo.flags && state.combo.flags.healBlock)
    });
    if (!ok) finish(false, '无法开始层战斗（野图战斗占用中）');
  }

  function onMobEnd({ win, petHp, petMaxHp }) {
    if (!state.running) return;
    const per = mobsPerFloor();
    const total = cfg().floors || 30;
    const hpPct = petMaxHp > 0 ? Math.max(0, Math.round(petHp / petMaxHp * 100)) : 0;
    state.endHpPct = hpPct;
    state.hpTrace.push({ floor: state.floor, mob: state.mob, pct: win ? hpPct : 0 });

    if (!win) {
      emit({ type: 'floorFail', floor: state.floor, mob: state.mob, mobsPerFloor: per, petHp: 0, petMaxHp });
      log(`💀 第 ${state.floor} 层第 ${state.mob} 只守住…… 塔行结束`);
      finish(false);
      return;
    }

    state.hpCarry = Math.max(0, Math.round(petHp));
    state.maxFloor = state.floor;
    emit({ type: 'mobClear', floor: state.floor, mob: state.mob, mobsPerFloor: per, petHp, petMaxHp });
    // 每只怪都掉（用户 2026-09-10 定）：杂兵走碎屑池、第 5 只守卫走肥池。
    // 掉落即时入账（材料直接进包 / 装备入包），结算时只做账目汇总，不重复发。
    rollMobLoot(state.mob >= per);

    // 楼内还有怪 → 稍作停顿继续打（血量继续累计）
    if (state.mob < per) {
      state.mob += 1;
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.running) beginMob();
      }, Number(cfg().mobGapMs) || 420);
      return;
    }

    // 一层打完：进下一层（掉落已在每只怪结束时逐只结算）
    log(`✓ 第 ${state.floor} 层清完 ${per} 只（剩余血量 ${hpPct}%）`);
    emit({ type: 'floorClear', floor: state.floor, petHp, petMaxHp });

    if (state.floor >= total) {
      state.cleared = true;
      emit({ type: 'clear', floor: state.floor, total });
      log(`🏆 通天塔 ${total} 层全部通过！`);
      finish(true);
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      if (!state.running) return;
      state.floor += 1;
      state.mob = 1;
      beginMob();
    }, Number(cfg().floorDelayMs) || 700);
  }

  // 单只怪的掉落：杂兵 / 守卫（守卫池更肥）→ 即时入账 + 日志 + 事件
  function rollMobLoot(isGuardian) {
    if (!window.TowerRewards) return;
    const loot = window.TowerRewards.rollLayer({
      floor: state.floor, ilvl: floorLevelOf(state.floor), combo: state.combo,
      kind: isGuardian ? 'guardian' : 'mob'
    });
    state.layerLoot.push(loot);
    if (loot.kind === 'material' && loot.name && window.Materials && window.Materials.gain) {
      window.Materials.gain(loot.name, loot.qty);
      log(`🎁 掉落 ${loot.name} ×${loot.qty}${isGuardian ? '（守卫掉落）' : ''}`);
      emit({ type: 'loot', loot, isGuardian: !!isGuardian });
    } else if (loot.kind === 'equipment' && loot.eq) {
      log(`🎁 掉落装备：${(loot.eq.rarity && loot.eq.rarity.label) || ''}${loot.eq.slot || ''}（未鉴定）${isGuardian ? '（守卫掉落）' : ''}`);
      emit({ type: 'loot', loot, isGuardian: !!isGuardian });
    }
  }

  /* ---------- 终局结算 ---------- */
  async function finish(cleared, error) {
    const fallback = { maxFloor: state.maxFloor, cleared, tierFloor: 0, corrosion: state.combo ? state.combo.corrosion : 0, items: [], gear: [], layerLoot: [], title: null };
    /* 发奖异常也必须走到「弹结算面板」这一步 —— 否则玩家打完一局什么都没有，
     * 而且异常被静默吞掉、浏览器里连报错都查不到（2026-09-10 实测踩到）。 */
    let info = fallback;
    try {
      if (window.TowerRewards) {
        info = await window.TowerRewards.settle({
          maxFloor: state.maxFloor, cleared,
          corrosion: state.combo ? state.combo.corrosion : 0,
          combo: state.combo,
          ilvl: floorLevelOf(Math.max(1, state.maxFloor || 1)),
          layerLoot: state.layerLoot
        });
      }
    } catch (e) {
      log(`⚠️ 结算异常：${(e && e.message) || '未知'}（奖励可能未发放，已按基础结果结算）`);
      try { console.warn('[tower] settle 异常:', e && (e.stack || e.message)); } catch (e2) { /* ignore */ }
    }

    state.result = Object.assign({}, info, {
      error: error || null,
      floors: cfg().floors || 30,
      mobsPerFloor: mobsPerFloor(),
      affixIds: state.affixIds.slice(),
      consumed: state.access ? state.access.consumed : null,
      freeLeft: state.access ? state.access.freeLeft : null,
      endHpPct: state.endHpPct,
      hpTrace: state.hpTrace.slice()
    });
    state.running = false;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    // 成绩记档（最高层 / 最高腐蚀度）
    if (window.TowerAccess && window.TowerAccess.recordResult) {
      window.TowerAccess.recordResult(state.result.maxFloor, state.result.corrosion);
    }
    releasePage(); // 终局即交出战斗页（结算面板显示时玩家应能重新开始挂机/再打一次）
    emit({ type: 'settle', result: state.result });
    return state.result;
  }

  /* ---------- 入口 ----------
   * start(affixIds, { onEvent, rnd }) → Promise<result>
   *   腐印非法 / 资格不足 → { ok:false, error }；
   *   通过 → 消耗资格（免费次数或重置卡）、暂停野图挂机、逐怪推进，终局 resolve 结算明细。 */
  async function start(affixIds, opts) {
    opts = opts || {};
    eventSink = typeof opts.onEvent === 'function' ? opts.onEvent : eventSink;
    const c = cfg();
    if (!c.enabled) return { ok: false, error: '通天塔尚未开放' };
    if (state.running) return { ok: false, error: '已有一局通天塔进行中' };

    const ids = Array.isArray(affixIds) ? affixIds.filter(Boolean) : [];
    const check = window.TowerAffix ? window.TowerAffix.validate(ids) : { ok: true, errors: [] };
    if (!check.ok) return { ok: false, error: check.errors.join('；') };

    const pet = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
    if (!pet) return { ok: false, error: '请先选择出战宠物' };
    if (!window.TowerAccess) return { ok: false, error: '塔模块未加载（缺 tower-access.js）' };

    const page = claimPage();
    if (!page.ok) return { ok: false, error: page.error };
    try {
      const access = await window.TowerAccess.consumeEntry();
      if (!access.ok) return { ok: false, error: access.error };

      // 腐印是一次性消耗品：进入时扣掉（校验已过，这里按条扣）
      if (ids.length && window.Materials && window.Materials.spend) {
        for (const id of ids) {
          const it = window.TowerAffix && window.TowerAffix.itemOf(id);
          const name = (it && it.name) || id;
          const spent = await window.Materials.spend(name, 1);
          if (spent && spent.ok === false) {
            log(`⚠️ ${name} 扣除失败：${spent.error || '数量不足'}`);
          }
        }
      }

      state.running = true;
      state.floor = 1;
      state.mob = 1;
      state.maxFloor = 0;
      state.cleared = false;
      state.result = null;
      state.hpCarry = null;
      state.layerLoot = [];
      state.hpTrace = [];
      state.endHpPct = null;
      state.affixIds = ids;
      state.combo = window.TowerAffix ? window.TowerAffix.combine(ids) : null;
      state.access = access;
      if (window.TowerRewards && opts.rnd && window.TowerRewards.setRnd) window.TowerRewards.setRnd(opts.rnd);

      emit({
        type: 'start', total: c.floors || 30, mobsPerFloor: mobsPerFloor(),
        affixIds: ids, corrosion: state.combo ? state.combo.corrosion : 0
      });
      beginMob();
      return await waitUntilDone();
    } finally {
      releasePage(); // 正常终局 finish() 已释放（幂等）；异常路径由这里兜住
    }
  }

  // 推进是 setTimeout 异步链，这里轮询等待终局，保持「await 拿结算」的形态（与副本一致）
  function waitUntilDone() {
    return new Promise(resolve => {
      const poll = () => {
        if (!state.running && state.result) { resolve({ ok: true, ...state.result }); return; }
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  function getState() {
    return {
      running: state.running, floor: state.floor, mob: state.mob, mobsPerFloor: mobsPerFloor(),
      maxFloor: state.maxFloor, total: cfg().floors || 30,
      corrosion: state.combo ? state.combo.corrosion : 0,
      affixIds: state.affixIds.slice(), result: state.result
    };
  }

  window.TowerEngine = {
    start, getState, mobEnemyStats, floorEnemyStats, floorTotalHp,
    floorLevelOf, floorDifficultyOf, mobsPerFloor, wait
  };
})();
