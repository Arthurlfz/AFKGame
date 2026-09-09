/* ============================================================
 * trial-core.mjs —— 资源试炼的服务端权威计算（纯函数，无 IO）
 *
 * 为什么单独放这里：
 *   2026-09-09 起资源试炼「服务端正式化」—— 成败与奖励一律由服务器判定，
 *   客户端只负责播放结果（不能自己算、更不能自己发奖）。
 *   前端 js/core/resource-trial.js 因此不再持有伤害/奖励公式，公式的唯一事实源就是本文件。
 *   ⚠️ 改这里必须同步跑 docs/tests/vtest_trial_core.js。
 *
 * 数值来源：config-server.mjs 的 resourceTrials（由 gen_server_config.js 从前端 config.js 生成，同源）。
 * 属性来源：battle-sim.mjs 的 petStats（与挂机战斗同一套属性口径）。
 * ============================================================ */

/* 单场结果
 * 伤害模型（2026-09-09 修正）：旧模型 taken = (敌攻 − 玩家防) × 回合，
 *   玩家防御成长远快于试炼敌攻 → 全程 0 伤害、100% 通关，失败分支是死代码。
 * 现在：每回合按最大生命固定比例掉血，比例随轮次递增，总伤 = 比例 × 回合数；
 *   血量跨场累计不回满（连续 5 场是一场远征，不是 5 次独立判定）。
 *   - 攻击越高 → 回合越少 → 挨打越少（强度真正决定结果）
 *   - 轮次越深 → 掉血越快（后段可能撑不住 → 只拿区域材料补偿）
 */
function roundResult(stats, route, petLevel, round, hpLeft, cfg) {
  const level = Number(petLevel) || 1;
  const maxHp = Number(stats.hp) || 1;
  const enemyDef = Math.round((8 + level * 0.9 + round * 2) * route.difficulty);
  const enemyHp = Math.round((55 + level * 5 + round * 12) * route.difficulty);
  const damage = Math.max(1, Math.floor((Number(stats.atk) || 1) - enemyDef));
  const turns = Math.ceil(enemyHp / damage);
  const perHit = maxHp * (cfg.hitRatio || 0.05) * route.difficulty * (1 + round * (cfg.roundRatio || 0.15));
  const taken = perHit * Math.max(1, turns);
  const left = hpLeft - taken;
  return {
    round: round + 1,
    turns,
    taken: Math.round(taken),
    hpLeft: Math.max(0, left),
    success: left > 0
  };
}

/* 奖励：通关按路线给，失败只给区域材料补偿（门票不退，规则如此） */
function rewardFor(route, petLevel) {
  if (route.reward === 'phoenix') return [{ name: '涅槃丹', qty: 1 }];
  if (route.reward === 'craft') {
    return Number(petLevel) >= 25
      ? [{ name: '增缀石', qty: 1 }, { name: '剥离石', qty: 1 }]
      : [{ name: '重铸石', qty: 2 }];
  }
  const level = Number(petLevel) || 1;
  if (level >= 40) return [{ name: '传说进化素材', qty: 1 }];
  if (level >= 25) return [{ name: '精粹进化素材', qty: 1 }];
  return [{ name: '进化素材', qty: 2 }];
}

/* 完整试炼计划（纯计算）
 * 输入：{ stats（宠物属性，petStats 结果）, route（含 difficulty / _petLevel）, cfg（resourceTrials） }
 * 输出：{ rounds:[{round,turns,taken,hpLeft,success}], cleared, hpPercent, reward:[{name,qty}] }
 */
function planTrial({ stats, route, petLevel, cfg }) {
  const total = Math.max(1, Number(cfg.rounds) || 5);
  const maxHp = Number(stats.hp) || 1;
  const rounds = [];
  let hpLeft = maxHp;
  for (let i = 0; i < total; i++) {
    const r = roundResult(stats, route, petLevel, i, hpLeft, cfg);
    hpLeft = r.hpLeft;
    rounds.push(r);
    if (!r.success) break;
  }
  const cleared = rounds.length === total && rounds.every(r => r.success);
  return {
    rounds,
    cleared,
    hpPercent: Math.max(0, Math.round((hpLeft / maxHp) * 100)),
    reward: cleared ? rewardFor(route, petLevel) : [{ name: '区域材料', qty: 1 }]
  };
}

/* 路线查找 + 等级校验（EF 与测试共用，避免各写一份判断） */
function findRoute(cfg, routeId) {
  const routes = (cfg && Array.isArray(cfg.routes)) ? cfg.routes : [];
  return routes.find(r => r.id === routeId) || null;
}

export { planTrial, roundResult, rewardFor, findRoute };
