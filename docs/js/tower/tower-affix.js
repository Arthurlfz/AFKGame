/* ============================================================
 * tower/tower-affix.js —— 腐印（词缀）纯函数（单一职责）
 * 职责：
 *  1. 校验贴法（≤maxPerRun 条、不可读组合同局最多 1 条、不许重复贴同一条）
 *  2. 把已贴的腐印合成一份「怪修正 + 掉率增益 + 腐蚀度」汇总
 *  3. 把汇总作用到怪身上（返回新对象，不改原对象）
 * 不负责：资格/消耗（tower-access.js）、层推进（tower-engine.js）、发奖（tower-rewards.js）。
 * 纯函数：只读 window.Config，不碰 DOM / 不碰网络 —— 服务端可同源复用（tower-core.mjs）。
 * 术语（2026-09-10 用户指定）：对外文案一律叫【腐蚀度】；
 *   代码字段统一 `corrosion`（兼容读旧字段 hot，避免老存档/旧数据静默变 0）。
 * 依赖：tower-config.js 必须先加载。
 * ============================================================ */
(function () {
  'use strict';

  const conf = () => (window.Config && window.Config.tower && window.Config.tower.affix) || {};

  function items() {
    const list = conf().items;
    return Array.isArray(list) ? list : [];
  }
  function itemOf(id) {
    return items().find(it => it.id === id) || null;
  }
  // 一条腐印的腐蚀度值（字段名 corrosion；兼容旧字段 hot）
  function corrosionOf(it) {
    if (!it) return 0;
    const v = (it.corrosion != null) ? it.corrosion : it.hot;
    return Number(v) || 0;
  }
  function maxPerRun() {
    const n = Number(conf().maxPerRun);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }
  function unreadableLimit() {
    const n = Number(conf().unreadableLimit);
    return (isFinite(n) && n >= 0) ? Math.floor(n) : 0;
  }
  function isUnreadable(it) {
    return !!(it && Array.isArray(it.tags) && it.tags.indexOf('unreadable') >= 0);
  }

  /* 校验一组腐印 id。返回 { ok, errors[], corrosion, dropBonus, unreadableCount, picked[] }
   * 空数组 = 白图，永远合法：不加腐也能进塔开打。
   * ⚠️ 但「能进」不等于「能通」——30 层是长线目标（腐印只加难度换掉率，不帮你通关）。 */
  function validate(ids) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const errors = [];
    const picked = [];
    const seen = {};
    for (const id of list) {
      const it = itemOf(id);
      if (!it) { errors.push(`未知腐印：${id}`); continue; }
      if (seen[id]) { errors.push(`「${it.name}」不能重复贴`); continue; }
      seen[id] = true;
      picked.push(it);
    }
    const cap = maxPerRun();
    if (cap > 0 && picked.length > cap) errors.push(`最多只能贴 ${cap} 条腐印（当前 ${picked.length} 条）`);
    const unreadable = picked.filter(isUnreadable);
    if (unreadable.length > unreadableLimit()) {
      errors.push(`「不可读」腐印同局最多 ${unreadableLimit()} 条（当前 ${unreadable.length} 条：${unreadable.map(i => i.name).join('、')}）`);
    }
    const sum = summarize(picked);
    return {
      ok: errors.length === 0,
      errors,
      picked: picked.map(i => i.id),
      corrosion: sum.corrosion,
      dropBonus: sum.dropBonus,
      unreadableCount: unreadable.length
    };
  }

  /* 把已选腐印汇总成一份修正。乘区相乘、点数相加；同一 id 只算一次（纵深防御）。 */
  function summarize(picked) {
    const combo = {
      corrosion: 0,
      enemy: { hpMult: 1, atkMult: 1, defMult: 1, spdMult: 1, dr: 0, pen: 0, dmgBonus: 0, hit: 0, lifesteal: 0 },
      flags: { healBlock: false },
      dropBonus: { equipPct: 0, matPct: 0 }
    };
    const seen = {};
    for (const it of (picked || [])) {
      if (!it || seen[it.id]) continue;
      seen[it.id] = true;
      combo.corrosion += corrosionOf(it);
      const e = it.enemy || {};
      for (const k of ['hpMult', 'atkMult', 'defMult', 'spdMult']) {
        if (e[k] != null) combo.enemy[k] *= Number(e[k]) || 1;
      }
      for (const k of ['dr', 'pen', 'dmgBonus', 'hit', 'lifesteal']) {
        if (e[k] != null) combo.enemy[k] += Number(e[k]) || 0;
      }
      if (it.flags && it.flags.healBlock) combo.flags.healBlock = true;
      const d = it.dropBonus || {};
      combo.dropBonus.equipPct += Number(d.equipPct) || 0;
      combo.dropBonus.matPct += Number(d.matPct) || 0;
    }
    return combo;
  }

  /* 便捷：直接按 id 数组出汇总（供引擎/UI 用；非法 id 静默忽略） */
  function combine(ids) {
    const list = (Array.isArray(ids) ? ids : []).map(itemOf).filter(Boolean);
    return summarize(list);
  }

  /* 把汇总作用到怪身上 —— 返回新对象，绝不改传入的 enemy。
   * hp/maxHp/atk/def 乘算后取整；spd 乘算；dr/pen/dmgBonus/hit 点数累加；吸血累加。 */
  function applyToEnemy(enemy, combo) {
    const src = enemy || {};
    const c = combo || summarize([]);
    const hp = Math.max(1, Math.round((Number(src.hp) || 0) * c.enemy.hpMult));
    return Object.assign({}, src, {
      hp,
      maxHp: hp,
      atk: Math.max(1, Math.round((Number(src.atk) || 0) * c.enemy.atkMult)),
      def: Math.max(0, Math.round((Number(src.def) || 0) * c.enemy.defMult)),
      spd: Math.max(1, Math.round((Number(src.spd) || 1) * c.enemy.spdMult)),
      hit: (Number(src.hit) || 0) + c.enemy.hit,
      dr: (Number(src.dr) || 0) + c.enemy.dr,
      pen: (Number(src.pen) || 0) + c.enemy.pen,
      dmgBonus: (Number(src.dmgBonus) || 0) + c.enemy.dmgBonus,
      lifesteal: (Number(src.lifesteal) || 0) + c.enemy.lifesteal,
      _healBlock: !!c.flags.healBlock
    });
  }

  /* UI 预览用：不做硬校验的温和汇总（贴到一半也要能显示当前腐蚀度/掉率） */
  function preview(ids) {
    const combo = combine(ids);
    const v = validate(ids);
    return { corrosion: combo.corrosion, dropBonus: combo.dropBonus, flags: combo.flags, ok: v.ok, errors: v.errors };
  }

  window.TowerAffix = {
    items, itemOf, corrosionOf, maxPerRun, unreadableLimit, isUnreadable,
    validate, combine, summarize, applyToEnemy, preview
  };
})();
