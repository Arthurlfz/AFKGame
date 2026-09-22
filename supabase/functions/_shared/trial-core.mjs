/* ============================================================
 * trial-core.mjs —— 资源试炼的服务端权威计算（纯函数，无 IO）
 *
 * 为什么单独放这里：
 *   资源试炼「服务端正式化」—— 成败与奖励一律由服务器判定，客户端只负责播放结果
 *   （不能自己算、更不能自己发奖）。公式的唯一事实源就是本文件。
 *   ⚠️ 改这里必须同步跑 docs/tests/vtest_trial_core.js（它同时守「与前端 trial-engine 同源」）。
 *
 * 🔄 2026-09-23 重写（老模型已废）：
 *   旧版是 2026-09-09 的「5 轮 + 按最大血固定比例掉血 + 老奖励口径」简化模型，
 *   与现在客户端的 20 层副本**完全对不上**（层数、奖励、伤害模型三处全漂移）。
 *   现改为与 `docs/js/trial/trial-engine.js` 逐公式同源：
 *     · 层等级 / 层难度 / 怪数值 = 客户端 floorLevelOf / floorDifficultyOf / floorEnemyStats
 *     · 每层用 `simulateFight` 真跑一场（走显式敌人数值入口 enemyData.explicit）
 *     · 血量跨层累计、层间不回血（与客户端 hpCarry 同口径）
 *     · 奖励 = 按【最高到达层数】取 floorTiers 档位，不足第一档给 consolation
 *
 * 数值来源：config-server.mjs 的 resourceTrials（由 gen_server_config.js 从前端 config.js 生成，同源）。
 * 属性来源：battle-sim.mjs 的 petStats（与挂机战斗同一套属性口径）。
 * ============================================================ */
import { simulateFight } from './battle-sim.mjs';

/* ---------- 层曲线（与 trial-engine.js 逐公式一致） ----------
 * 怪等级 = floorLevelStart ~ floorLevelEnd 线性插值；
 * 层难度 = floorDifficultyStart × (1+floorDifficultyPerFloor)^(N-1)
 *          × eliteMult^(已跨过的强档层数) × route.difficulty
 * 怪数值 = baseStats × (怪等级 / floorLevelEnd) × 层难度。 */
function floorLevelOf(floor, cfg) {
  const total = Math.max(2, Number(cfg.floors) || 20);
  const lo = Number(cfg.floorLevelStart) || 10, hi = Number(cfg.floorLevelEnd) || 100;
  const t = (floor - 1) / (total - 1);
  return Math.max(1, Math.round(lo + (hi - lo) * t));
}

function floorDifficultyOf(route, floor, cfg) {
  const start = (cfg.floorDifficultyStart != null) ? Number(cfg.floorDifficultyStart) : 0.3;
  const per = Number(cfg.floorDifficultyPerFloor) || 0.045;
  const eliteMult = Number(cfg.eliteMult) || 1;
  const every = Number(cfg.eliteEvery) || 0;
  const elites = every > 0 ? Math.floor(floor / every) : 0;
  return start * Math.pow(1 + per, floor - 1) * Math.pow(eliteMult, elites) * ((route && route.difficulty) || 1);
}

/* 第 N 层的守关者（与客户端 floorEnemyStats 同口径：血攻防按层缩放，命中/闪避按等级走 mech） */
function floorEnemyStats(route, floor, cfg) {
  const base = cfg.baseStats || { hp: 100000, atk: 7200, def: 3600 };
  const level = floorLevelOf(floor, cfg);
  const diff = floorDifficultyOf(route, floor, cfg);
  const scale = level / (Number(cfg.floorLevelEnd) || 100);
  const MC = cfg.mech || {};
  return {
    level,
    hp: Math.round(base.hp * scale * diff),
    atk: Math.round(base.atk * scale * diff),
    def: Math.round(base.def * scale * diff),
    hit: Math.round((Number(MC.hitPerLv) || 3.5) * level),
    dodge: Math.round((Number(MC.dodgeAtRef) || 200) * Math.pow(level / (Number(MC.refLevel) || 60), Number(MC.dodgeExp) || 1.35)),
    spd: 80 // 与客户端一致（固定值，与野图 evolved 档同）
  };
}

/* ---------- 奖励（与 trial/trial-rewards.js 同口径） ----------
 * 按【最高到达层数】取最深的一档；一档都没到（< 第 5 层）给该路线的 consolation。 */
function tierFor(route, maxFloor) {
  const tiers = Array.isArray(route && route.floorTiers) ? route.floorTiers : [];
  let best = null;
  for (const tier of tiers) {
    const floor = Number(tier.floor) || 0;
    if (maxFloor >= floor && (!best || floor > (Number(best.floor) || 0))) best = tier;
  }
  return best;
}

function consolationFor(route) {
  const items = Array.isArray(route && route.consolation) && route.consolation.length
    ? route.consolation : [{ name: '重铸石', qty: 1 }];
  return items.map(item => ({ name: item.name, qty: item.qty }));
}

function rewardFor(route, maxFloor) {
  const tier = tierFor(route, Math.max(0, Number(maxFloor) || 0));
  if (tier && Array.isArray(tier.items) && tier.items.length) {
    return { reward: tier.items.map(i => ({ name: i.name, qty: i.qty })), tierFloor: Number(tier.floor) || 0 };
  }
  return { reward: consolationFor(route), tierFloor: 0 };
}

/* ---------- 整局计划（纯计算） ----------
 * 输入：{ pet, stats（petStats 结果）, route, petLevel, cfg（resourceTrials）, config（完整配置）, rnd }
 * 输出：{ floors:[{floor,level,enemy,win,petHpLeft}], maxFloor, cleared, hpPercent, reward, tierFloor } */
function planTrial({ pet, stats, route, petLevel, cfg, config, rnd }) {
  const total = Math.max(1, Number(cfg.floors) || 20);
  const maxHp = Number(stats.hp) || 1;
  const name = (route && route.guardian && route.guardian.name) || '试炼之影';
  const floors = [];
  let curHp = maxHp, maxFloor = 0;

  for (let floor = 1; floor <= total; floor++) {
    const e = floorEnemyStats(route, floor, cfg);
    const r = simulateFight({
      pet, stats,
      enemyData: { name, enemyType: 'evolved', explicit: e },
      config, rnd, curHp
    });
    curHp = Math.max(0, Number(r.petHpLeft) || 0);
    floors.push({
      floor, level: e.level,
      enemy: { hp: e.hp, atk: e.atk, def: e.def, hit: e.hit, dodge: e.dodge },
      win: !!r.win, petHpLeft: curHp,
      /* 演出用：这一层的逐次出手（谁打的、多少伤害、暴击/闪避/技能）。
       * 客户端照它回放，才能"看得到打架" —— 没有它，服务器模式就只剩一行行字。
       * 只留播放需要的字段（t / by / dmg / crit / miss / skill），别把内部状态往外扔。 */
      events: (r.events || []).map(ev => ({
        t: ev.t, by: ev.by, dmg: Math.max(0, Math.round(ev.dmg || 0)),
        crit: !!ev.crit, miss: !!ev.miss, skill: !!ev.skill
      }))
    });
    if (!r.win) break;          // 倒下即结算（不回血、不重试）
    maxFloor = floor;
  }

  const cleared = maxFloor >= total;
  const rw = rewardFor(route, maxFloor);
  return {
    floors,
    maxFloor,
    cleared,
    hpPercent: Math.max(0, Math.round((curHp / maxHp) * 100)),
    reward: rw.reward,
    tierFloor: rw.tierFloor
  };
}

/* 路线查找（EF 与测试共用，避免各写一份判断） */
function findRoute(cfg, routeId) {
  const routes = (cfg && Array.isArray(cfg.routes)) ? cfg.routes : [];
  return routes.find(r => r.id === routeId) || null;
}

export { planTrial, floorEnemyStats, floorLevelOf, floorDifficultyOf, rewardFor, tierFor, consolationFor, findRoute };
