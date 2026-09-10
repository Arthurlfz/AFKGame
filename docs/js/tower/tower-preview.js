/* ============================================================
 * tower/tower-preview.js —— 进塔前的难度预估（单一职责）
 * 职责：贴完腐印后，用 BattleSim 真跑几局「白图推演」，给出
 *       预估可达层数区间 + 风险等级 + 通关剩余血。让「加腐」不是盲赌
 *       （用户把「失败要买重置卡」定为规则，这是缓释付费墙的关键一件）。
 * 不负责：进入资格、推进、发奖、渲染。
 * 依赖：tower-config、tower-engine（怪数值同源）、battle-sim.global（window.BattleSim）。
 * 说明：
 *  - 推演按「每层 mobsPerFloor 只怪」逐只打，与真实引擎同口径（含守卫更硬）。
 *  - 不污染 Config：用一层浅拷贝把「临时怪数值」挂到 simCfg 上，
 *    真 Config.battle.areaEnemyStats 一个键都不加。
 *  - 固定种子：同一套（宠物 + 腐印）每次算出的预估完全一致 ——
 *    否则详情页每次重渲染数字都在跳，看起来像坏了。
 *  - 结果按 key 缓存：贴/摘腐印才重算。
 * 术语（2026-09-10 用户指定）：对外文案叫【腐蚀度】，代码字段 `corrosion`。
 * ============================================================ */
(function () {
  'use strict';

  const cfg = () => (window.Config && window.Config.tower) || {};
  const PREVIEW_AREA_ID = '__tower_preview'; // 只存在于浅拷贝里，真 Config 不会被写

  let cacheKey = null;
  let cacheVal = null;

  function petKey(pet) {
    if (!pet) return 'none';
    return [pet.id, pet.name, pet.level, pet.growth].join('|');
  }
  function comboKey(combo) {
    if (!combo) return 'empty';
    const e = combo.enemy || {};
    return [combo.corrosion,
      e.hpMult, e.atkMult, e.defMult, e.spdMult, e.dr, e.pen, e.dmgBonus, e.hit, e.lifesteal,
      combo.flags && combo.flags.healBlock ? 1 : 0].join('|');
  }

  /* 浅拷贝一份 config 供模拟器用：只替换 battle.areaEnemyStats 这一层 */
  function simConfig() {
    const C = window.Config;
    const battle = Object.assign({}, C.battle, {
      areaEnemyStats: Object.assign({}, C.battle.areaEnemyStats, { [PREVIEW_AREA_ID]: { hp: 1, atk: 1, def: 1 } })
    });
    return Object.assign({}, C, { battle });
  }

  /* 推演 runs 局：每局从第 1 层第 1 只打到死或通关（血量全程累计，与真实塔同口径）。
   * 返回 { ok, runs, medianFloor, p10, p90, clearRate, hpLeftPct, total, mobsPerFloor } */
  function estimate(combo, opts) {
    opts = opts || {};
    const BS = window.BattleSim;
    const E = window.TowerEngine;
    const pet = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    const total = Number(cfg().floors) || 30;
    const per = E && E.mobsPerFloor ? E.mobsPerFloor() : 1;
    if (!BS || !E || !pet) return { ok: false, reason: '预估不可用（缺模拟器或出战宠物）', total };

    const runs = Math.max(1, Math.min(9, Number(opts.runs) || 3));
    const key = [petKey(pet), comboKey(combo), total, per, runs].join('#');
    if (key === cacheKey && cacheVal) return cacheVal;

    const simCfg = simConfig();
    const stats = BS.petStats(pet, simCfg);
    const reached = [];
    const hpPct = [];
    // 固定种子：同输入同输出（掺一点腐蚀度，让加腐后的预估确实会变化）
    const seedBase = 1337 + (combo ? combo.corrosion : 0) * 17;
    let fightSeq = 0;

    for (let r = 0; r < runs; r++) {
      let hp = stats.hp, best = 0;
      for (let f = 1; f <= total; f++) {
        let died = false;
        for (let m = 1; m <= per; m++) {
          const en = E.mobEnemyStats(f, m, combo);
          Object.assign(simCfg.battle.areaEnemyStats[PREVIEW_AREA_ID], { hp: en.hp, atk: en.atk, def: en.def });
          const area = { id: PREVIEW_AREA_ID, levelRange: [en.level, en.level], difficulty: 1, enemyMult: 1 };
          let res;
          try {
            fightSeq += 1;
            res = BS.simulateFight({
              pet, stats, area, enemyData: en, config: simCfg,
              rnd: BS.mulberry32(seedBase + r * 977 + fightSeq * 31), curHp: hp
            });
          } catch (e) {
            return { ok: false, reason: '预估失败：' + ((e && e.message) || '未知'), total };
          }
          if (!res || !res.win) { hp = 0; died = true; break; }
          hp = res.petHpLeft;
          if (hp <= 0) { died = true; break; }
        }
        if (died) break;
        best = f;
      }
      reached.push(best);
      hpPct.push(hp / (stats.hp || 1) * 100);
    }
    reached.sort((a, b) => a - b);
    const clearCount = reached.filter(x => x >= total).length;
    const clearHp = hpPct.filter((_, i) => reached[i] >= total).sort((a, b) => a - b);
    const val = {
      ok: true, runs, total, mobsPerFloor: per,
      medianFloor: reached[Math.floor(reached.length / 2)],
      p10: reached[Math.floor(reached.length * 0.1)],
      p90: reached[Math.floor((reached.length - 1) * 0.9)],
      clearRate: clearCount / reached.length,
      hpLeftPct: clearHp.length ? clearHp[Math.floor(clearHp.length / 2)] : null,
      risk: riskLevel(reached[Math.floor(reached.length / 2)], total)
    };
    cacheKey = key; cacheVal = val;
    return val;
  }

  /* 风险等级：给文字标签（不只靠颜色 —— game-ui-design 的可达性要求） */
  function riskLevel(medianFloor, total) {
    const ratio = total > 0 ? medianFloor / total : 0;
    if (ratio >= 1) return { id: 'safe', label: '低（能通天）', hint: '这套腐蚀度你有把握打满全程' };
    if (ratio >= 0.8) return { id: 'mid', label: '中（差几层）', hint: '大概率止步后半段，可摘一条腐印再试' };
    if (ratio >= 0.5) return { id: 'high', label: '高（会死在半途）', hint: '腐蚀度明显超配，建议减少腐印' };
    return { id: 'deadly', label: '极高（早早倒下）', hint: '这套腐蚀度远超当前实力，会白费一局' };
  }

  function clearCache() { cacheKey = null; cacheVal = null; }

  window.TowerPreview = { estimate, riskLevel, clearCache };
})();
