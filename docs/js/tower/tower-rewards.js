/* ============================================================
 * tower/tower-rewards.js —— 通天塔结算与掉落（单一职责）
 * 职责：
 *  1. rollLayer：每只怪死时摇一次掉落（材料按深度分档 / 装备未鉴定；守卫用肥池）
 *  2. settle：按【最高到达层数】取档位奖励（装备 + 高级材料）；腐蚀度只加掉率、不提档位
 *  3. titleFor：按「最高层 + 本局腐蚀度」给称号
 * 规则（用户拍板）：
 *   · 死在第 N 层 = 拿 ≤N 里最深的一档；不足第一档（5 层）只给 consolation。
 *   · 腐蚀度不提高档位（打通靠硬实力），只提高「每层掉落的数量/质量」。
 *   · 越深越出好货：材料子池按 1~10 / 11~20 / 21~30 三档（Config.tower.materialBands）。
 * 依赖：tower-config、tower-affix（算腐蚀度增益）、equipment（generateEquipment）、
 *       materials（发材料）、items（装备落云端存档）。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => (window.Config && window.Config.tower) || {};
  // 可注入随机源（node 测试注入固定序列；浏览器缺省 Math.random）
  let rnd = Math.random;
  function setRnd(fn) { if (typeof fn === 'function') rnd = fn; }

  function rarityObj(id) {
    const list = (window.Config && window.Config.equipment && window.Config.equipment.rarities) || [];
    return list.find(r => r.id === id) || list[0] || null;
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

  /* ---------- 材料子池：按层数取档 ---------- */
  function bandWeights(floor) {
    const bands = cfg().materialBands || [];
    const hit = bands.find(b => floor >= b.from && floor <= b.to);
    return (hit && hit.weights) || {};
  }
  // 从权重表里抽一个键（空表返回 null）
  function pickWeightedKey(weights) {
    const keys = Object.keys(weights || {}).filter(k => num(weights[k], 0) > 0);
    if (!keys.length) return null;
    const total = keys.reduce((s, k) => s + num(weights[k], 0), 0);
    let r = rnd() * total;
    for (const k of keys) {
      r -= num(weights[k], 0);
      if (r < 0) return k;
    }
    return keys[keys.length - 1];
  }

  /* ---------- 单只怪的掉落（每只都摇） ----------
   * ctx = { floor, ilvl, combo, kind }：kind = 'guardian'（第 5 只守卫，用肥池）
   *      | 其它/缺省 = 'mob'（杂兵，用碎屑池）；combo = TowerAffix.combine 的结果，可空。
   * 返回 { kind, name?, qty?, eq? }（kind: 'none' | 'material' | 'equipment'） */
  function rollLayer(ctx) {
    ctx = ctx || {};
    const floor = Math.max(1, num(ctx.floor, 1));
    const drop = cfg().layerDrop || {};
    const isGuardian = ctx.kind === 'guardian';
    const pool = (isGuardian ? drop.guardianPool : drop.mobPool)
      || drop.pool                                     // 向后兼容：老配置只有单池
      || { none: 86, material: 12, equipment: 1.2 };
    const bonus = (ctx.combo && ctx.combo.dropBonus) || { equipPct: 0, matPct: 0 };
    // 腐印的掉率增益：直接加在 material / equipment 权重上（none 不变 → 加腐就是「稀释空手」）
    const weights = {
      none: num(pool.none, 0),
      material: Math.max(0, num(pool.material, 0) * (1 + num(bonus.matPct, 0) / 100)),
      equipment: Math.max(0, num(pool.equipment, 0) * (1 + num(bonus.equipPct, 0) / 100))
    };
    const kind = pickWeightedKey(weights) || 'none';
    if (kind === 'material') {
      const w = bandWeights(floor);
      const name = pickWeightedKey(w);
      if (!name) return { kind: 'none' };
      const q = cfg().materialQty || { min: 1, max: 2 };
      const lo = Math.max(1, Math.floor(num(q.min, 1)));
      const hi = Math.max(lo, Math.floor(num(q.max, lo)));
      const qty = lo + Math.floor(rnd() * (hi - lo + 1));
      return { kind: 'material', name, qty };
    }
    if (kind === 'equipment') {
      const rw = drop.equipmentRarityWeights || { blue: 70, gold: 30 };
      const rid = pickWeightedKey({ blue: num(rw.blue, 70), gold: num(rw.gold, 30) });
      // 底材恒 T1（2026-09-11 修）：materialTier 是【反向档】——倍率表 {1:1.5 … 5:0.6}，T1 最优 T5 最烂。
      // 旧写法 gearMatTierFor 把它当"越深越大"的正向数（1~10 层 3 / 21+ 层 5）= 塔越深装备越垃圾，
      // 被野图图 10（能 roll 出 T1 ×1.5）全面碾压。塔是最高强度区域，底材必须全 T1；
      // 深层的成长走 ilvl（塔怪 Lv60→120，底材命中 baseHitByIlvl 段位随之上移），不走底材降档。
      const eq = makeGear(rid || 'blue', drop.equipmentAreaTier || 10, 1, num(ctx.ilvl, 100));
      return { kind: 'equipment', eq };
    }
    return { kind: 'none' };
  }

  /* 云端存档待办队列（模块级）。
   * 为什么不能只靠调用方传的 pending：rollLayer 是同步的、没有 pending 可传，
   * 旧代码因此把层掉落的装备写成「发起写入但不等待」—— 玩家在结算面板看到 N 件、
   * 立刻刷新就少几件（写入还没落地就被云端快照覆盖）。settle 里统一 await 清空。 */
  const SAVING = [];

  /* 造一件装备并落到背包（本地 + 云端存档）。
   * 云端存档是异步的：把 Promise 收集起来由调用方 await（层掉落一次 30 件不能逐件 await，
   * 但也不能丢 —— 丢写入 = 刷新后装备消失）。 */
  function makeGear(rarityId, areaTier, materialTier, ilvl, pending) {
    const E = window.Equipment;
    if (!E || !E.generateEquipment) return null;
    const eq = E.generateEquipment(rarityObj(rarityId), areaTier, materialTier, ilvl);
    if (!eq) return null;
    eq.identified = (cfg().layerDrop && cfg().layerDrop.equipmentIdentified === true);
    if (E.addToInventory) E.addToInventory(eq);
    const I = window.Items;
    if (I && I.saveItem) {
      const p = Promise.resolve(I.saveItem(eq)).catch(() => { /* 未登录/失败：本地保留，等补建档 */ });
      SAVING.push(p);
      if (pending) pending.push(p);
    }
    return eq;
  }

  /* ---------- 档位奖励 ---------- */
  function tierFor(maxFloor) {
    const tiers = Array.isArray(cfg().floorTiers) ? cfg().floorTiers : [];
    let best = null;
    for (const t of tiers) {
      const f = num(t.floor, 0);
      if (maxFloor >= f && (!best || f > num(best.floor, 0))) best = t;
    }
    return best;
  }
  function consolationItems() {
    const c = cfg().consolation;
    return (Array.isArray(c) && c.length) ? c : [{ name: '重铸石', qty: 1 }];
  }
  // 预览（不发奖）：详情页「打到第 N 层能拿什么」用
  function preview(maxFloor) {
    const t = tierFor(Math.max(0, num(maxFloor, 0)));
    const items = (t && Array.isArray(t.items)) ? t.items : consolationItems();
    return { tierFloor: t ? num(t.floor, 0) : 0, items: items.map(i => ({ name: i.name, qty: i.qty })), gear: (t && t.gear) || null };
  }

  /* 称号：取「达标且最靠后」的一条。
   * 同一层数可以挂多条（如 30 层「通天者」与 30 层 + 腐蚀度 60 的「焚天·通天者」）——
   * 层数相同时取腐蚀度门槛更高的那条（更苛刻 = 更高级），否则先出现的那条会永远压住它。
   * 字段兼容：minCorrosion（新）/ minHot（旧）。 */
  function minCorrosionOf(t) {
    return num(t.minCorrosion != null ? t.minCorrosion : t.minHot, 0);
  }
  function titleFor(maxFloor, corrosion) {
    const list = Array.isArray(cfg().titles) ? cfg().titles : [];
    const corr = Math.max(0, num(corrosion, 0));
    let best = null;
    const rank = t => [num(t.minFloor, 0), minCorrosionOf(t)];
    for (const t of list) {
      if (maxFloor < num(t.minFloor, 0)) continue;
      if (minCorrosionOf(t) > 0 && corr < minCorrosionOf(t)) continue;
      if (!best) { best = t; continue; }
      const [bf, bh] = rank(best), [tf, th] = rank(t);
      if (tf > bf || (tf === bf && th > bh)) best = t;
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  /* ---------- 终局结算 ----------
   * ctx = { maxFloor, cleared, corrosion, combo, ilvl, layerLoot[] }（corrosion 兼容读旧的 hot）
   * 返回 { maxFloor, cleared, tierFloor, corrosion, items[], gear[], layerLoot[], title }（已入包）。
   * 异步：等装备的云端存档落地（返回值不允许丢弃）。 */
  async function settle(ctx) {
    ctx = ctx || {};
    const maxFloor = Math.max(0, num(ctx.maxFloor, 0));
    const hot = Math.max(0, num(ctx.corrosion != null ? ctx.corrosion : ctx.hot, 0));
    const tier = tierFor(maxFloor);
    const pending = [];

    // 档位材料
    const items = ((tier && Array.isArray(tier.items)) ? tier.items : consolationItems())
      .map(i => ({ name: i.name, qty: num(i.qty, 1) }));
    for (const it of items) {
      if (window.Materials && window.Materials.gain) window.Materials.gain(it.name, it.qty);
    }

    // 档位装备
    const gear = [];
    const gs = (tier && tier.gear) || null;
    if (gs && num(gs.count, 0) > 0) {
      for (let i = 0; i < Math.floor(num(gs.count, 0)); i++) {
        const eq = makeGear(gs.rarity || 'gold', num(gs.areaTier, 10), num(gs.materialTier, 4), num(ctx.ilvl, 100), pending);
        if (eq) gear.push(eq);
      }
    }

    // 每层掉落：材料由引擎【掉的那一刻】就入账了（见 tower-engine.rollFloorLoot），
    // 装备在 rollLayer 时已入包。这里只做账目汇总，**不再发一次**（否则双倍）。
    const layerLoot = Array.isArray(ctx.layerLoot) ? ctx.layerLoot : [];
    const mats = {};
    for (const l of layerLoot) {
      if (!l || l.kind !== 'material' || !l.name) continue;
      mats[l.name] = (mats[l.name] || 0) + num(l.qty, 0);
    }

    // 档位装备（pending）+ 全局层掉落的装备（SAVING）一起等落地，再让结算面板弹出来
    await Promise.all(SAVING.splice(0, SAVING.length).concat(pending));

    return {
      maxFloor, cleared: !!ctx.cleared, tierFloor: tier ? num(tier.floor, 0) : 0,
      corrosion: hot, items, gear,
      // 逐层掉落里的【装备对象】也要带出来：结算面板要列出"掉了哪几件"（只留名字的话 UI 只能写"装备×2"）
      layerGear: layerLoot.filter(l => l && l.kind === 'equipment' && l.eq).map(l => l.eq),
      layerLoot: layerLoot.map(l => ({ kind: l.kind, name: l.name, qty: l.qty })),
      layerMats: Object.keys(mats).map(name => ({ name, qty: mats[name] })),
      title: titleFor(maxFloor, hot)
    };
  }

  window.TowerRewards = { rollLayer, settle, preview, tierFor, titleFor, bandWeights, setRnd, makeGear };
})();
