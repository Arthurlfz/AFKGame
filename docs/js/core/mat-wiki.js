/* ============================================================
 * core/mat-wiki.js —— 材料词条数据（对齐流亡编年史的信息结构，2026-09-14）
 * 职责：给一个材料名，算出它的【怎么用】【用途表】【来源表】—— **全部从 Config 现场派生**。
 * 为什么派生而不手写：手写文案会跟配置脱节（项目头号病因＝同一件事两份、只有一份对）。
 *   配置里本来就有这些定义，直接读：
 *     Config.craft[].effect/rule          打造石的效果与限制（唯一定义处）
 *     Config.items[].effect               9 件合成/进化/涅槃/培育道具的效果（唯一定义处）
 *     Config.pet.evolution.stages         进化到各阶需要什么、几颗
 *     Config.synthesize / nirvana / soulCast   合成、涅槃、魂铸的消耗
 *     Config.tower / resourceTrials       腐印、重置卡、副本门票
 *     Config.drop.*                       掉落表 / 区域材料 / 任务奖励与需求（来源）
 *   只有「消耗点在代码里、配置里查不到」的，才由 `Config.materialInfo[].use` 手写（目前 2 条：鉴定石 / 觉醒石）。
 * 不负责：DOM 渲染（悬停在 ui-bag.js，完整词条在 ui/ui-mat-entry.js）。
 * 纯函数：只读 window.Config，可被 node 测试直接加载。
 * ============================================================ */
(function () {
  'use strict';

  const C = () => window.Config || {};
  const matInfo = name => (C().materialInfo || {})[name] || {};
  const labelOf = id => { const g = (C().materialInfoGroups || []).find(x => x.id === id); return g ? g.label : '其他'; };

  /* 道具 id → 名字（配置里有几个字段存的是 id，如 synthesize.defaultItem='synth_stone'） */
  function nameOfItem(idOrName) {
    if (typeof idOrName !== 'string') return null;
    const hit = (C().items || []).find(i => i.id === idOrName);
    return hit ? hit.name : idOrName;
  }
  const itemByName = name => (C().items || []).find(i => i.name === name) || null;

  /* 道具类别 → 玩家在哪个页面用它（展示用短名，不是数值） */
  const PAGE_OF_CATEGORY = {
    synth: '合成页', evolve: '进化页', nirvana: '涅槃页', nirvana_lock: '涅槃页',
    cultivate: '宠物页·培育', affix: '通天塔（进塔前贴）', stone: '背包'
  };

  /* 占比文案：极稀有的材料（如涅磐兽权重 0.05）不要显示成"0.0%" */
  const pctTxt = x => (x >= 1 ? x.toFixed(1) + '%' : (x >= 0.1 ? x.toFixed(2) + '%' : '不到 0.1%'));

  /* 图名：materialWeightsByTier 的键是图号 1~10，与 Config.battle.areas 的顺序一一对应 */
  function areaName(tier) {
    const a = (C().battle && C().battle.areas || [])[Number(tier) - 1];
    return a ? ('图' + tier + ' ' + a.name) : ('图' + tier);
  }

  /* ---------- 用途：谁会吃掉它 ---------- */
  function uses(name) {
    const out = [];
    const push = (where, what, qty) => { if (what || qty) out.push({ where, what: what || '', qty: qty == null ? null : qty }); };
    const CF = C();

    // 打造石：Config.craft 的效果与限制（唯一定义处）
    Object.keys(CF.craft || {}).forEach(k => {
      const d = CF.craft[k] || {};
      if (d.name !== name) return;
      push('打造页' + (k === 'lock' ? '·锁定' : ''), [d.effect, d.rule].filter(Boolean).join(' '), d.amount || 1);
    });

    // 9 件道具：Config.items 的效果（唯一定义处）
    const it = itemByName(name);
    if (it) {
      const isBoost = ((CF.pet && CF.pet.evolution && CF.pet.evolution.boostItems) || []).map(nameOfItem).indexOf(name) >= 0;
      const isSynthDefault = ((CF.synthesize && CF.synthesize.defaultItem) || '') === it.id;
      // 上下文写在 where 里，效果只念一遍（避免同一件事出现两行）
      const where = isBoost ? '进化页·可选加成（最多带 1 颗）'
        : isSynthDefault ? '合成页·默认放进的道具（可换别的）'
          : (PAGE_OF_CATEGORY[it.category] || '道具');
      push(where, it.effect || '', 1);
    }

    // 进化需求：各阶要什么、几颗
    ((CF.pet && CF.pet.evolution && CF.pet.evolution.stages) || []).forEach(s => {
      if (s.material !== name) return;
      push('进化页', '进化到' + (s.label || ('第' + s.stage + '阶')) + '（Lv' + s.minLevel + ' 可进化）', s.amount);
    });

    // 合成 / 涅槃 / 魂铸
    const sy = CF.synthesize || {};
    if (sy.material && sy.material.name === name) push('合成页', '合成两只宠物（Lv' + (sy.minLevel || 40) + ' 解锁）', sy.material.amount);
    const nv = CF.nirvana || {};
    if (nameOfItem(nv.defaultItem) === name) push('涅槃页', '涅槃消耗（唯一涅槃道具）', 1);
    if (nv.crystalBonus && nv.crystalBonus.material === name) {
      push('涅槃页', '投喂提升吸收 +' + Math.round((nv.crystalBonus.absorbBonus || 0) * 100) + '%', nv.crystalBonus.amount);
    }
    const sc = CF.soulCast || {};
    if (sc.material === name) push('魂铸页', '把宠物特质铸进装备', sc.materialCount);

    // 通天塔 / 副本
    const tw = CF.tower || {};
    if (((tw.affix && tw.affix.items) || []).some(i => i.name === name)) {
      const a = ((tw.affix || {}).items || []).find(i => i.name === name) || {};
      push('通天塔（进塔前贴，进入时消耗）', [a.desc, '腐蚀度 ' + (a.corrosion != null ? a.corrosion : a.hot)].filter(Boolean).join(' · '), 1);
    }
    if (tw.resetCardName === name) push('通天塔', '今天的免费次数用尽后，开一局要用 1 张', 1);
    const rt = CF.resourceTrials || {};
    const ticketName = rt.ticketName;
    if (ticketName === name) push('副本', '开一局副本消耗（每日有免费次数）', 1);
    ((rt.routes) || []).forEach(r => { if (r.ticketName === name) push(r.name, '开一局消耗', 1); });

    // 任务需求（上交）
    (CF.drop && CF.drop.quests || []).forEach(q => {
      let n = null;
      if (q.matName === name) n = q.need;
      else if ((q.matList || []).indexOf(name) >= 0) n = q.need;
      else if (q.cost && q.cost[name]) n = q.cost[name];
      if (n) push('任务「' + (q.name || q.id) + '」', '上交' + (q.repeatable ? '（可重复交）' : ''), n);
    });
    return out;
  }

  /* ---------- 来源：它从哪来 ---------- */
  function sources(name) {
    const out = [];
    const push = (where, what, qty) => { if (where && (what || qty)) out.push({ where, what: what || '', qty: qty == null ? null : qty }); };
    const CF = C();
    const D = CF.drop || {};

    // 手写补充来源：只给"掉落写在代码里、配置查不到"的（如守关 Boss 的稀有掉落在 drop.js 里）
    (matInfo(name).from || []).forEach(f => push(f.where || '额外来源', f.what || '', null));

    // 地图挂机掉落：**聚合成一条**（10 张图各列一行 = 10 行噪音，玩家只需要"哪张图最值得刷"）
    // 占比 = 该材料权重 ÷ 该图材料权重之和，越高越常见
    const tiers = [];
    Object.keys(D.materialWeightsByTier || {}).forEach(tier => {
      const w = D.materialWeightsByTier[tier] || {};
      const v = Number(w[name]) || 0;
      if (v <= 0) return;
      const total = Object.keys(w).reduce((s, k) => s + (Number(w[k]) || 0), 0) || 1;
      tiers.push({ tier: Number(tier), pct: v / total * 100 });
    });
    if (tiers.length) {
      const best = tiers.reduce((a, b) => (b.pct > a.pct ? b : a));
      if (tiers.length === 1) {
        push(areaName(best.tier), '挂机掉落（占该图材料 ' + pctTxt(best.pct) + '）', null);
      } else {
        push('地图 ' + Math.min.apply(null, tiers.map(t => t.tier)) + '~' + Math.max.apply(null, tiers.map(t => t.tier)) + ' 挂机掉落',
          '占该图材料 ' + pctTxt(Math.min.apply(null, tiers.map(t => t.pct))) + '~' + pctTxt(Math.max.apply(null, tiers.map(t => t.pct)))
          + '，最高在 ' + areaName(best.tier), null);
      }
    }

    // 区域材料：这张图的专属材料
    Object.keys(D.areaMaterials || {}).forEach((areaId, i) => {
      if ((D.areaMaterials[areaId] || {}).name !== name) return;
      const area = (CF.battle && CF.battle.areas || []).find(a => a.id === areaId);
      push(area ? ('图' + (i + 1) + ' ' + area.name) : areaId, '该图专属材料', null);
    });

    // 通天塔：材料池（按层段）/ 档位奖励 / 保底
    const tw = CF.tower || {};
    const band = (tw.materialBands || []).find(b => b.weights && b.weights[name]);
    if (band) push('通天塔 ' + band.from + '~' + band.to + ' 层', '材料掉落池（权重 ' + band.weights[name] + '）', null);
    (tw.floorTiers || []).forEach(t => {
      const hit = (t.items || []).find(i => i.name === name);
      if (hit) push('通天塔 第 ' + t.floor + ' 层档位', '固定奖励', hit.qty);
    });
    if ((tw.consolation || []).some(i => i.name === name)) push('通天塔（不足 5 层）', '保底补偿', null);

    // 副本档位
    ((CF.resourceTrials && CF.resourceTrials.routes) || []).forEach(r => {
      (r.floorTiers || []).forEach(t => {
        const hit = (t.items || []).find(i => i.name === name);
        if (hit) push(r.name + ' 第 ' + t.floor + ' 层档', '固定奖励', hit.qty);
      });
    });

    // 任务奖励：**聚合成一条**（重铸石有 40 个任务会给，列全了就是噪音；
    // 玩家要知道的是"任务也给，单次能给几个"，而不是"为了 2 个石头去挑任务"）
    const qs = (D.quests || []).filter(q => q.reward && q.reward[name]);
    if (qs.length) {
      const max = Math.max.apply(null, qs.map(q => Number(q.reward[name]) || 0));
      push('任务奖励', qs.length + ' 个任务会给（主线 / 首通 / 委托 / 每日 / 成就都有），单次最多 ' + max + ' 个', null);
    }

    // 满级经验池自动凝聚
    const ep = CF.pet && CF.pet.expPool;
    if (ep && ep.material === name) push('满级挂机', '满级后的溢出经验自动凝聚（每 ' + ep.perCrystal + ' 点凝 1 颗）', null);

    // 商店（云端 products 表，客户端看不到明细，只标一句）
    if (CF.shop && CF.shop.enabled && (CF.shop.catalog || []).some(p => p.payload && p.payload.materials && p.payload.materials[name])) {
      push('魔石商店', '用魔石购买', null);
    }
    return out;
  }

  /* ---------- 完整词条 ---------- */
  function entry(name) {
    if (!name) return null;
    const info = matInfo(name);
    const it = itemByName(name);
    return {
      name: name,
      group: info.group || 'misc',
      groupLabel: labelOf(info.group),
      icon: (it && it.icon) || (window.UI && window.UI.MAT_ICONS ? window.UI.MAT_ICONS[name] : null) || null,
      rarity: it ? it.rarity : null,
      handUse: info.use || '',   // 手写"怎么用"（仅消耗点在代码里的那几条）
      uses: uses(name),
      sources: sources(name)
    };
  }

  window.MatWiki = { entry, uses, sources, labelOf, nameOfItem, areaName, PAGE_OF_CATEGORY };
})();
