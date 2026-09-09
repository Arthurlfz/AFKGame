/* ============================================================
 * trial/trial-rewards.js —— 副本结算（单一职责）
 * 职责：按【最高到达层数】取 floorTiers 档位（5/10/15/20，越深越好），
 *       不足第一档只给本路线 consolation，发奖入包，返回结算明细。
 * 规则（2026-09-10 用户拍板）：
 *   - 奖励跟层数走，不跟宠物等级走（旧 tiers.minLevel 机制废除）。
 *   - 死在第 7 层 = 到达档位 5 的奖励；死在第 4 层 = 只有基础补偿。
 * 依赖：config（Config.resourceTrials）、materials（发奖）。
 * ============================================================ */
(function () {
  'use strict';

  // 最高到达层数对应的最高档位（floor ≤ maxFloor 中最深的一档）
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

  /* 结算并发放。ctx = { maxFloor: 最高到达层数, cleared: 是否通关 }。
   * 返回 { maxFloor, tierFloor, cleared, reward }（reward 已入包）。 */
  function settle(route, ctx) {
    ctx = ctx || {};
    const maxFloor = Math.max(0, Number(ctx.maxFloor) || 0);
    const cleared = !!ctx.cleared;
    const tier = tierFor(route, maxFloor);
    let reward;
    if (tier && Array.isArray(tier.items) && tier.items.length) {
      reward = tier.items.map(item => ({ name: item.name, qty: item.qty }));
    } else {
      reward = consolationFor(route);
    }
    for (const item of reward) {
      if (window.Materials && window.Materials.gain) window.Materials.gain(item.name, item.qty);
    }
    return { maxFloor, tierFloor: tier ? (Number(tier.floor) || 0) : 0, cleared, reward };
  }

  // 结算预览（不发奖）：详情页/面板展示「打到第 N 层能拿什么」用
  function preview(route, maxFloor) {
    const tier = tierFor(route, Math.max(0, Number(maxFloor) || 0));
    return tier && Array.isArray(tier.items) ? tier.items.map(i => ({ name: i.name, qty: i.qty })) : null;
  }

  window.TrialRewards = { settle, preview, tierFor, consolationFor };
})();
