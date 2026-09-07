/* ============================================================
 * ui/ui-codex.js —— 百科页（规则与数值速查）
 * 职责：
 *  1. 8 个板块的规则说明与数值表格（宠物 / 战斗 / 装备 / 打造 / 材料 / 地图 / 变强 / 市场）
 *  2. 左侧目录跳转 + 关键词搜索过滤
 *  3. 懒渲染：只在首次进入百科页时构建一次 DOM，不进 UI.renderAll（挂机结算高频，避免重建）
 * 内容定性：**百科不是攻略**。只陈述"规则是什么、数值是多少"，不出现任何玩法建议。
 * 数值全部从 Config / Equipment 动态读取，禁止写死第二份数值（config.js 是唯一数值源）。
 * 依赖：config.js（数值）、equipment.js（部位与词缀池）、ui-common.js（escapeHtml）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const Config = window.Config;
  const Equipment = window.Equipment;
  const PetSprites = window.PetSprites;
  const escapeHtml = (UI && UI.escapeHtml) || (s => String(s == null ? '' : s));

  /* ---------- 小工具 ---------- */
  // 宠物小头像（行内）：有头像图则 <img>，否则回退 emoji
  function petIconHtml(name, emoji) {
    const p = PetSprites && PetSprites.avatarOf(name);
    return p ? `<img class="pet-avatar-sprite inline" src="${p}" alt="">` : emoji;
  }
  // 百分比显示：0.3 → 30%
  const pct = v => Math.round((v || 0) * 100) + '%';
  // 数值表：rows 为二维数组，第一列是名称（左对齐），其余是数值（右对齐等宽）
  function table(headers, rows) {
    const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
    const body = rows.map(r =>
      `<tr>${r.map((c, i) => `<td class="${i === 0 ? 'codex-key' : 'codex-num'}">${c}</td>`).join('')}</tr>`
    ).join('');
    return `<div class="codex-table-wrap"><table class="fs-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  // 规则条目列表
  function rules(items) {
    return `<ul class="codex-rules">${items.map(t => `<li>${t}</li>`).join('')}</ul>`;
  }
  // 段落说明（陈述式文字）
  const note = t => `<p class="codex-note">${t}</p>`;

  /* ============================================================
   * 8 个板块词条
   * intro：一句话陈述说明（不是建议）
   * build()：返回正文 HTML，数值全部现取 Config
   * ============================================================ */

  /* ---------- 1. 宠物 ---------- */
  function buildPet() {
    const P = Config.pet;
    const coeff = P.statCoeff || {};
    const names = (P.starters || []).map(s => s.name);
    const profOf = n => (P.petProfiles && P.petProfiles[n]) || P.defaultPetProfile || {};

    const rows1 = (P.starters || []).map(s => {
      const p = profOf(s.name);
      return [
        `${petIconHtml(s.name, s.icon)} ${escapeHtml(s.name)}`,
        escapeHtml(p.role || '均衡型'),
        s.baseHp, s.baseAtk, s.baseDef,
        Number(s.growth).toFixed(1),
        P.speeds[s.name] != null ? P.speeds[s.name] : '?'
      ];
    });
    const rows2 = names.map(n => {
      const p = profOf(n);
      return [
        escapeHtml(n),
        (p.critRate != null ? p.critRate : 5) + '%',
        (p.critDamage != null ? p.critDamage : 150) + '%',
        p.hit != null ? p.hit : 90,
        p.dodge != null ? p.dodge : 0,
        (p.lifesteal != null ? p.lifesteal : 0) + '%'
      ];
    });

    const EV = P.evolution || {};
    const targets = new Set(Object.values(EV.tree || {}).flat().map(route => route.to));
    const finals = [...targets].filter(name => !(EV.tree || {})[name]);
    const skillRows = finals.map(name => {
      const skill = (EV.activeSkills || {})[name];
      return [
        escapeHtml(name),
        skill ? escapeHtml(skill.name) : '未配置',
        skill ? `Lv.${skill.minLevel}` : '—',
        skill ? `${skill.cooldownTurns} 回合` : '—',
        skill ? `${Math.round(skill.damageMultiplier * 100)}%伤害${skill.maxHpDamageRate ? ` + 目标最大生命${Math.round(skill.maxHpDamageRate * 100)}%` : ''}` : '—'
      ];
    });

    // ===== 血脉特质图鉴（8 条 × T1~T3） + 孵化概率 + 流动规则 + 觉醒表 =====
    const TRAITS = Config.petTraits || {};
    const traitRows = Object.keys(TRAITS).map(id => {
      const d = TRAITS[id];
      const isFlat = ['hit', 'dodge', 'spd'].indexOf(d.type) >= 0;
      const f = v => '+' + v + (isFlat ? '' : '%');
      return [escapeHtml(d.label || id), f(d.values[1]), f(d.values[2]), f(d.values[3]), escapeHtml(d.desc || '')];
    });
    const H = Config.traitHatch || {};
    const hc = H.counts || [40, 45, 13, 2];
    const tr = H.tierRoll || [0, 10, 30, 60];
    const mH = H.mutant || {};
    const hatchRows = [
      ['0 条', hc[0] + '%', '白板 = 纯肥料'],
      ['1 条', hc[1] + '%', ''],
      ['2 条', hc[2] + '%', ''],
      ['3 条', hc[3] + '%', '稀有'],
      ['单条 T 阶', 'T1 ' + tr[1] + '% / T2 ' + tr[2] + '% / T3 ' + tr[3] + '%', 'T1 最强最稀有'],
      ['变异宠（·异变）', '保底 ' + (mH.minCount || 1) + ' 条 · 3 条 ' + (mH.count3 || 8) + '% · T1 ' + (mH.t1Boost || 20) + '%', '保底不低于 T' + (mH.minTier || 2)]
    ];
    const inh = Config.traitInherit || {};
    const nir = Config.traitNirvana || {};
    const awBonus = Config.awakenBonus || {};
    const awRows = Object.keys(awBonus).map(line => {
      const b = awBonus[line] || {};
      const bKey = Object.keys(b)[0];
      const bv = b[bKey];
      return [escapeHtml(line), bKey + ' +' + bv + (['spd'].indexOf(bKey) >= 0 ? '' : '%')];
    });

    // ===== 5 阶进化：门槛与素材按「当前阶」走，共 4 次进化（初始 → 终阶）=====
    const stageRows = (EV.stages || []).map(s => {
      const gb = s.growthBoost || [0, 0];
      const mat = s.material
        ? `${escapeHtml(s.material)} ×${s.amount}${s.extra ? ' + ' + escapeHtml(s.extra.name) + ' ×' + s.extra.amount : ''}`
        : '无';
      return [
        escapeHtml(s.label || ('第' + s.stage + '阶')),
        'Lv.' + s.minLevel,
        mat,
        gb[0] === gb[1] ? '+' + gb[0] : `+${gb[0]} 到 +${gb[1]}`,
        s.form === false ? '形态不变' : '换形态',
        escapeHtml(s.desc || '')
      ];
    });
    // ===== 进化强化道具：可选消耗，按倍率放大本次成长提升 =====
    const evoItemRows = (Config.itemsOf ? Config.itemsOf('evolve') : []).map(it => [
      it.icon + ' ' + escapeHtml(it.name),
      '成长提升 ×' + (1 + (it.boost || 0)).toFixed(2).replace(/0$/, ''),
      escapeHtml(it.effect || ''),
      escapeHtml(it.rarity || '')
    ]);
    // ===== 血统被动：每只基宠天生一条，战斗中生效，不可继承、不可更换 =====
    const passiveRows = Object.keys(Config.bloodlinePassive || {}).map(n => {
      const b = Config.bloodlinePassive[n] || {};
      return [`${escapeHtml(b.icon || '')} ${escapeHtml(n)}`, escapeHtml(b.name || ''), escapeHtml(b.desc || '')];
    });
    // ===== 神级宠：单独的宠物（不是普通宠的进阶形态），只有它能涅槃 =====
    const G = P.godPets || {};
    const godRows = (G.list || []).map(g => {
      const c = g.statCoeff || {};
      return [escapeHtml(g.name), escapeHtml(g.line || ''), g.speed, g.baseHp, g.baseAtk, g.baseDef, `${c.hp} / ${c.atk} / ${c.def}`];
    });

    return table(['宠物', '定位', '生命', '攻击', '防御', '成长', '速度'], rows1)
      + note('属性公式（成长系数每只宠不同，进化后沿用来源基宠的系数）：')
      + rules([
        `生命 = 基础生命 + 等级 × 成长值 × ${coeff.hp}`,
        `攻击 = 基础攻击 + 等级 × 成长值 × ${coeff.atk}`,
        `防御 = 基础防御 + 等级 × 成长值 × ${coeff.def}`,
        '速度 = 该宠固定基础速度 + 装备加成，等级与成长值不影响速度',
        `等级上限 ${P.maxLevel} 级`
      ])
      + note('每只宠的隐藏底子（上表系数之外的固定值）：')
      + table(['宠物', '暴击', '暴击伤害', '命中', '闪避', '吸血'], rows2)
      + note('终形态主动技能（终形态达到对应等级后，可在战斗中手动释放）：')
      + table(['终形态', '主动技能', '解锁', '冷却', '效果'], skillRows)
      + note(`5 阶进化：共 ${EV.maxEvolveTimes} 次进化（初始 → 终阶），素材与成长提升由「当前阶」决定：`)
      + table(['阶段', '门槛', '消耗素材', '成长提升', '形态', '说明'], stageRows)
      + (evoItemRows.length
          ? note('进化强化道具（进化时可选用 1 个，按倍率放大本次成长提升；不用则按基础值结算）：')
            + table(['道具', '倍率', '效果', '稀有度'], evoItemRows)
          : '')
      + note('血统被动（每只基宠天生一条，战斗中生效，不可继承、不可更换）：')
      + table(['基宠', '被动', '效果'], passiveRows)
      + note('血脉特质（8 条 × T1~T3，T1 最强最稀有；特质一律不含攻击%，只叠加机制 / 生存属性）：')
      + table(['特质', 'T1', 'T2', 'T3', '说明'], traitRows)
      + note('孵化特质概率（变异宠保底 1 条，T 阶整体抬升）：')
      + table(['条数 / 规则', '概率', '说明'], hatchRows)
      + note('继承 / 植入（合成与涅槃）：')
      + rules([
        `合成：主宠特质每条保留 ${Math.round((inh.synthKeep != null ? inh.synthKeep : 0.7) * 100)}%、副宠每条继承 ${Math.round((inh.synthGive != null ? inh.synthGive : 0.4) * 100)}%；继承时 ${Math.round((inh.up != null ? inh.up : 0.2) * 100)}% 升一阶（封顶 T1）、${Math.round((inh.down != null ? inh.down : 0.1) * 100)}% 降一阶（最低 T3）；变异成功额外追 1 条；总上限 ${inh.cap != null ? inh.cap : 3} 条`,
        `涅槃：主宠特质全保留；副宠每条 ${Math.round((nir.implantChance != null ? nir.implantChance : 0.3) * 100)}% 概率植入（同类型取高 T，不叠加）`
      ])
      + note(`觉醒特质（Lv60 终形态解锁 = 对应主动技能伤害 +${Math.round((Config.awakenSkillDamage || 0.2) * 100)}% + 血统定位加成）：`)
      + table(['血统线', '觉醒定位加成'], awRows)
      + note(`神级宠（${(G.list || []).length} 只，每条血统线 1 只；独立宠物而非进阶形态，成长系数约为普通宠的 1.5 倍，只有它能涅槃）：`)
      + table(['神级宠', '血统线', '速度', '生命', '攻击', '防御', '成长系数 血/攻/防'], godRows)
      + (G.minGrowth != null
          ? note(`成神门槛：主副宠都终阶且成长 ≥ ${G.minGrowth}；出生成长上限 ${G.birthGrowthCap}，超出部分折算为成长系数加成（每点 +${Math.round((G.excessStatCoeffRatio || 0) * 100)}%，封顶 +${Math.round((G.excessStatCoeffMax || 0) * 100)}%）。`)
          : '');
  }

  /* ---------- 2. 战斗 ---------- */
  function buildBattle() {
    const B = Config.battle || {};
    const scale = B.speedScale || 1;
    const speeds = Object.values(Config.pet.speeds || {}).filter(v => typeof v === 'number');
    const fast = speeds.length ? Math.max.apply(null, speeds) : 0;
    const slow = speeds.length ? Math.min.apply(null, speeds) : 0;
    // 打一次所需秒数 ≈ 10 × speedScale / 速度（进度条满 100，每 100ms 累加 速度/speedScale）
    const secOf = v => v > 0 ? (10 * scale / v).toFixed(1) : '?';
    const stopPct = pct(B.stopHpRatio || 0);
    const regenPct = pct((Config.regen && Config.regen.hpPerSecRatio) || 0);

    const tm = B.typeMult || {};
    const clampCfg = B.levelScaleClamp || [0, 1];
    const sk = (Config.pet && Config.pet.evolution && Config.pet.evolution.activeSkills) || {};
    const skillLv = Object.keys(sk).reduce((m, k) => Math.max(m, sk[k].minLevel || 0), 0);
    const cd = Object.keys(sk).reduce((m, k) => Math.max(m, sk[k].cooldownTurns || 0), 0);
    return note('战斗全自动进行，出手快慢由速度决定，命中、暴击、吸血各自独立结算。')
      + rules([
        `出手：进度条满 100 打一次，每 100 毫秒累加 速度 ÷ ${scale}。速度 ${fast} 约 ${secOf(fast)} 秒出手一次，速度 ${slow} 约 ${secOf(slow)} 秒一次`,
        '命中：命中率 = 命中 ÷（命中 + 闪避），最低 5%，最高 95%',
        '伤害：伤害 = 攻击 − 防御，最低 1',
        '暴击：按暴击率触发，触发后伤害 × 暴击伤害倍率',
        '吸血：命中后按 伤害 × 吸血率 回血，回血不超过生命上限',
        `回血：血量低于 ${stopPct} 自动停止挂机，每秒恢复最大生命的 ${regenPct}`,
        '战败：自动等待回血，回满后继续下一场',
        `怪类型强度：普通 ×${tm.normal != null ? tm.normal : 1} / 进化 ×${tm.evolved != null ? tm.evolved : 1} / 变异 ×${tm.mutant != null ? tm.mutant : 1}`,
        `怪数值按等级缩放，倍率钳制在 ${clampCfg[0]} 到 ${clampCfg[1]} 之间`,
        '守关 Boss：每场 1/1600 概率出现（连续 2400 场未出必出，出后 200 场内不再出）；它是该图怪池里等级最高的怪，等级取图段上限，血 ×5、攻 ×1.5，名字带「霸主·」前缀',
        `主动技能：终形态达到 Lv.${skillLv} 后可在战斗中手动释放，释放后冷却 ${cd} 回合`,
        '血统被动：每只基宠天生一条，战斗中自动生效（见宠物板块）'
      ]);
  }

  /* ---------- 3. 装备 ---------- */
  function buildEquip() {
    const E = Config.equipment || {};
    const SC = Config.soulCast || {};
    const scRows = Object.keys(SC.tiers || {}).map(k => {
      const t = SC.tiers[k] || {};
      return [
        escapeHtml(t.label || k),
        'Lv.' + t.minLevel,
        '成长 ≥ ' + t.minGrowth,
        t.source === 'awaken' ? '觉醒特质' : '血脉特质',
        t.tierShift ? 'T 阶 +' + t.tierShift : 'T 阶不变',
        t.needFinal ? '需终形态' : '无'
      ];
    });
    const rarities = E.rarities || [];
    const slots = (Equipment && Equipment.SLOTS) || [];
    const pool = (Equipment && Equipment.AFFIX_POOL) || [];

    const rarityRows = rarities.map(r => [
      escapeHtml(r.label),
      r.affixMin === r.affixMax ? `${r.affixMin} 条` : `${r.affixMin} 到 ${r.affixMax} 条`
    ]);
    const matRows = Object.keys(E.materialTierMultipliers || {}).sort((a, b) => a - b).map(t => [
      'T' + t, '×' + E.materialTierMultipliers[t]
    ]);
    const areaRows = (E.baseTierMultipliers || []).map((m, i) => [`第 ${i + 1} 档`, '×' + m]);
    const tierRows = (E.affixTiers || []).map(t => ['T' + t.tier, `${t.min} 到 ${t.max}`]);
    const spdRows = (E.speedAffixTiers || []).map(t => ['T' + t.tier, `${t.min} 到 ${t.max}`]);
    // 独立定标的词缀数值表（2026-09-04）：各属性量纲不同，共用一张表会失衡（吸血+8 神条、暴伤+8 废条）
    const customTables = [
      ['吸血', E.lifestealAffixTiers], ['暴击率', E.critAffixTiers], ['暴击伤害', E.critDamageAffixTiers],
      ['穿透', E.penAffixTiers], ['伤害加成', E.dmgBonusAffixTiers], ['受伤减免', E.drAffixTiers]
    ].filter(x => x[1]);
    const prefixList = pool.filter(a => a.category === 'prefix').map(a => escapeHtml(a.label));
    const suffixList = pool.filter(a => a.category === 'suffix').map(a => escapeHtml(a.label));

    return note(`装备共 ${slots.length} 个部位：${slots.map(s => escapeHtml(s)).join('、')}`)
      + table(['品质', '词缀条数'], rarityRows)
      + note('底材档位影响装备基底数值：')
      + table(['底材', '基底倍率'], matRows)
      + note('地图档次影响装备基底数值：')
      + table(['地图档', '基底倍率'], areaRows)
      + note(`词缀分两类。前缀：${prefixList.join('、')}。后缀：${suffixList.join('、')}`)
      + note('词缀档位决定数值区间，T1 最高：')
      + table(['词缀档', '数值区间'], tierRows)
      + note('速度词缀使用独立区间：')
      + table(['速度词缀档', '数值区间'], spdRows)
      + customTables.map(([label, rows]) =>
          note(label + '词缀使用独立区间：') + table([label + '词缀档', '数值区间'],
            rows.map(t => ['T' + t.tier, `${t.min} 到 ${t.max}`]))
        ).join('')
      + note('最终属性怎么算：')
      + rules([
        '攻击 / 生命 / 防御 = 宠物裸属性 ×（1 + 百分比词缀总和）+ 装备底材固定值',
        '暴击 / 暴击伤害 / 吸血 / 命中 / 闪避 / 速度 = 宠物底子 + 装备底材 + 词缀',
        '穿透 = 无视 X 点防御（只削防御不成负数）；伤害加成 = 最终伤害 +X%；受伤减免 = 受到伤害 -X%（最低承伤 10%）'
      ])
      + note(`魂铸：把宠物的特质铸进装备，消耗 ${escapeHtml(SC.material || '凝魂晶石')} ×${SC.materialCount}，每件装备最多 ${SC.maxSoulAffixes} 条魂铸词缀。`)
      + table(['魂铸档', '宠物等级', '宠物成长', '特质来源', 'T 阶', '额外条件'], scRows);
  }

  /* ---------- 4. 打造 ---------- */
  function buildCraft() {
    const C = Config.craft || {};
    const S = Config.salvage || {};
    const stoneRows = ['reforge', 'strip', 'holy', 'augment', 'lock'].filter(k => C[k]).map(k => {
      const s = C[k];
      return [s.icon + ' ' + escapeHtml(s.name), '×' + s.amount, escapeHtml(s.effect), escapeHtml(s.rule)];
    });
    const rarityLabel = id => {
      const r = Config.equipment.rarities.find(x => x.id === id);
      return r ? r.label : id;
    };
    const salvageRows = Object.keys(S).map(k => {
      const out = S[k] || {};
      const parts = Object.keys(out).map(ck => (C[ck] ? C[ck].name : ck) + ' ×' + out[ck]);
      return [escapeHtml(rarityLabel(k)), parts.length ? escapeHtml(parts.join('、')) : '无产出'];
    });

    return note('打造消耗对应的石头，直接改变装备的词缀。')
      + table(['石头', '消耗', '效果', '限制'], stoneRows)
      + note(`锁定：每条已锁定的词缀在重铸 / 神圣时额外消耗 1 颗${C.lock ? C.lock.name : '锁定石'}，最多锁 ${C.lock ? C.lock.maxLocked : 0} 条。`)
      + note('分解装备的产出：')
      + table(['品质', '分解产出'], salvageRows);
  }

  /* ---------- 5. 材料 ---------- */
  function buildMaterial() {
    const mats = (Config.trade && Config.trade.materials) || [];
    const C = Config.craft || {};
    const useOf = name => {
      const it = (Config.items || []).find(i => i.name === name);
      if (it) return it.effect;
      for (const k of ['reforge', 'strip', 'holy', 'augment', 'lock']) {
        if (C[k] && C[k].name === name) return '打造：' + C[k].effect;
      }
      if (Config.synthesize && Config.synthesize.material && Config.synthesize.material.name === name) return '宠物合成消耗';
      const evo = (Config.pet && Config.pet.evolution && Config.pet.evolution.materialName) || '进化素材';
      if (name.indexOf(evo) !== -1) return '宠物进化消耗';
      if (name === '宠物蛋') return '孵化出一只基础宠';
      if (name === '鉴定石') return '鉴定未鉴定的装备';
      if (name === '涅磐兽') return '可交易材料（涅槃消耗已改为道具化，见下方道具表）';
      const crystal = (Config.pet && Config.pet.expPool && Config.pet.expPool.material) || '凝魂晶石';
      if (name === crystal) {
        const EP = Config.pet.expPool || {};
        const cb = (Config.nirvana && Config.nirvana.crystalBonus) || {};
        return `满级（${Config.pet.maxLevel} 级）后每 ${EP.perCrystal} 点溢出经验凝出 1 颗；魂铸消耗，涅槃时投入 ${cb.amount || 10} 颗可让本次吸收 ×${(1 + (cb.absorbBonus || 0)).toFixed(1)}`;
      }
      return '市场交易计价';
    };
    const rows = mats.map(m => [m.icon + ' ' + escapeHtml(m.name), escapeHtml(useOf(m.name))]);
    const catLabel = { synth: '合成', evolve: '进化', nirvana: '涅槃' };
    const itemRows = (Config.items || []).map(it => [
      it.icon + ' ' + escapeHtml(it.name),
      escapeHtml(catLabel[it.category] || it.category || ''),
      escapeHtml(it.rarity || ''),
      escapeHtml(it.effect || ''),
      escapeHtml(it.description || '')
    ]);

    return note('材料用于打造、进化、涅槃与合成，也是市场交易的计价单位。')
      + table(['材料', '用途'], rows)
      + note('道具（合成 / 进化 / 涅槃三系，在对应界面选用；唯一定义处是 Config.items）：')
      + table(['道具', '类别', '稀有度', '效果', '说明'], itemRows);
  }

  /* ---------- 6. 地图 ---------- */
  function buildArea() {
    const areas = (Config.battle && Config.battle.areas) || [];
    const areaMats = (Config.drop && Config.drop.areaMaterials) || {};
    const rows = areas.map(a => {
      const am = areaMats[a.id];
      const lv = a.levelRange || [];
      return [
        escapeHtml(a.name),
        lv.length === 2 ? `${lv[0]} 到 ${lv[1]} 级` : '不限',
        escapeHtml(a.recommended || ''),
        am && am.name ? escapeHtml(am.name) : '无'
      ];
    });

    return note('每张图对应一个等级段，并掉落该图的专属材料。')
      + table(['地图', '等级段', '推荐成长', '专属材料'], rows);
  }

  /* ---------- 7. 变强 4 条路 ---------- */
  function buildGrowth() {
    const EV = (Config.pet && Config.pet.evolution) || {};
    const NI = Config.nirvana || {};
    const SY = Config.synthesize || {};
    const SC = Config.soulCast || {};
    const baby = (Config.pet && Config.pet.babyGrowth) || {};
    const G = (Config.pet && Config.pet.godPets) || {};
    const stages = EV.stages || [];
    const gated = stages.filter(s => (s.minLevel || 1) > 1);
    const gates = gated.map(s => 'Lv.' + s.minLevel);
    const mu = (SY.mutation || {});
    const rb = SY.randomBoost || [0, 0];
    const synthItems = Config.itemsOf ? Config.itemsOf('synth') : [];
    const nirItems = Config.itemsOf ? Config.itemsOf('nirvana') : [];
    const cb = NI.crystalBonus || {};
    const godMin = (SY.god && SY.god.minGrowth) || G.minGrowth || 0;
    const godLv = G.baseLevelRequire || SY.minLevel || 60;
    const matList = gated.map(s => `${escapeHtml(s.label)}：${escapeHtml(s.material)} ×${s.amount}${s.extra ? ' + ' + escapeHtml(s.extra.name) + ' ×' + s.extra.amount : ''}`);
    const keepStage = stages.filter(s => s.form === false && (s.growthBoost || [0, 0])[0] > 0)[0];
    const keepText = keepStage
      ? `${escapeHtml(keepStage.label)}（Lv.${keepStage.minLevel}）形态不变、成长 +${keepStage.growthBoost[0]} 到 +${keepStage.growthBoost[1]}`
      : '';

    const rows = [
      [
        '🌟 进化',
        gates.length ? gates.join(' → ') : '不限',
        matList.join('；') || (EV.materialName || '进化素材'),
        `共 ${EV.maxEvolveTimes} 次（初始 → 一阶 → 二阶 → 三阶 → 终阶）。${keepText}；其余阶段换形态`,
        '素材与成长提升按「当前阶」决定；可选消耗 1 个进化道具放大倍率'
      ],
      [
        '♻️ 涅槃',
        'Lv.' + (NI.minLevel || 0) + '（主宠与副宠都要到）',
        nirItems.length ? '可选消耗 ' + nirItems.map(i => escapeHtml(i.name)).join(' / ') + ' ×1' : '无（不再消耗涅磐兽）',
        `主宠成长 += 副宠成长 × 吸收比例（${nirItems.map(i => escapeHtml(i.name) + '：' + escapeHtml(i.effect || '')).join('；')}）；副宠消失，主宠等级重置为 1`,
        `${NI.requireGodPet !== false ? '只有神级宠能涅槃；' : ''}可反复涅槃叠加成长${cb.amount ? `；额外投入 ${escapeHtml(cb.material)} ×${cb.amount} 可让本次吸收 ×${(1 + (cb.absorbBonus || 0)).toFixed(1)}` : ''}；穿着装备的宠物不能涅槃`
      ],
      [
        '⚗️ 合成',
        'Lv.' + (SY.minLevel || 0) + '（两只都要到）',
        ((SY.material || {}).name || '合成之石') + ' ×' + ((SY.material || {}).amount || 1) + ' + 合成道具 ×1',
        `新宠成长 = 主宠成长 + 副宠成长 × ${SY.baseBoostRatio} ×（1 + 等级加成 + 道具加成）+ 随机 +${rb[0]} 到 +${rb[1]}，成长只涨不跌；${pct(mu.chance || 0)} 概率出「·异变」宠`,
        `两只素材宠都消失，新宠等级回 1；普通宠成长软上限 ${SY.normalGrowthCap}；穿着装备的宠物不能合成`
      ],
      [
        '⚡ 神级宠',
        `终阶（第 ${(SY.god && SY.god.minStage) || 5} 阶）+ Lv.${godLv}`,
        '合成道具 ×1（决定出神概率）',
        synthItems.map(i => `${escapeHtml(i.name)} ${Math.round((i.godChance || 0) * 100)}%`).join(' / ') + ' 概率出神级宠',
        `门槛：主宠与副宠都终阶且成长 ≥ ${godMin}；${synthItems.filter(i => i.levelRequireReduce).map(i => `${escapeHtml(i.name)}把等级要求降到 Lv.${godLv - i.levelRequireReduce}`).join('；') || '无降门槛道具'}`
      ],
      [
        '🥚 孵化',
        '无',
        '宠物蛋 ×1',
        `孵出一只基础宠，成长 ${baby.min} 到 ${baby.max} 随机`,
        '孵出的是基础形态，高阶形态靠进化'
      ],
      [
        '🔥 魂铸',
        '宠物 Lv.40 起（传承档 Lv.60）',
        `${escapeHtml(SC.material || '凝魂晶石')} ×${SC.materialCount}`,
        '把宠物的血脉 / 觉醒特质铸进装备，让特质跨世代传承',
        `每件装备最多 ${SC.maxSoulAffixes} 条魂铸词缀；传承档需终形态、成长 ≥ ${((SC.tiers || {}).legend || {}).minGrowth || 60}`
      ]
    ];

    return note('宠物可以通过进化、涅槃、合成、神级合成、孵化变强，魂铸则把特质传承到装备上。')
      + table(['方式', '等级门槛', '消耗', '效果', '限制'], rows);
  }

  /* ---------- 8. 市场 ---------- */
  function buildMarket() {
    const T = Config.trade || {};
    return note('交易用材料计价，不用金币；挂单期间商品被锁定。')
      + rules([
        '计价：卖家自己选收什么材料、收多少',
        `交易税：每满 ${T.taxPer} 个材料收 ${T.taxAmount} 个，由卖家承担`,
        `挂单上限：宠物与装备共用，最多同时挂 ${T.maxListings} 单`,
        '锁定：上架的宠物不能出战，装备不能穿脱或改造，取回后恢复'
      ]);
  }

  /* ---------- 词条清单 ---------- */
  const ENTRIES = [
    { id: 'pet', icon: '🐾', title: '宠物', intro: '属性由基础值、等级、成长值和成长系数共同决定，速度是固定值。', build: buildPet },
    { id: 'battle', icon: '⚔️', title: '战斗', intro: '战斗全自动，出手快慢由速度决定，命中、暴击、吸血各自独立结算。', build: buildBattle },
    { id: 'equip', icon: '🛡️', title: '装备', intro: '装备分多个部位，品质由词缀条数决定，属性由底材固定值和词缀共同提供。', build: buildEquip },
    { id: 'craft', icon: '🛠️', title: '打造', intro: '打造消耗对应的石头，直接改变装备的词缀。', build: buildCraft },
    { id: 'material', icon: '💠', title: '材料', intro: '材料用于打造、进化、涅槃与合成，也是市场交易的计价单位。', build: buildMaterial },
    { id: 'area', icon: '🗺️', title: '地图', intro: '每张图对应一个等级段，并掉落该图的专属材料。', build: buildArea },
    { id: 'growth', icon: '📈', title: '变强路线', intro: '宠物通过进化、涅槃、合成、神级合成、孵化变强，魂铸把特质传承到装备。', build: buildGrowth },
    { id: 'market', icon: '💰', title: '市场', intro: '交易用材料计价，不用金币；挂单期间商品被锁定。', build: buildMarket }
  ];

  /* ---------- 渲染（懒渲染：只构建一次） ---------- */
  let rendered = false;

  function bindEvents() {
    const nav = document.getElementById('codex-nav');
    if (nav && !nav.dataset.bound) {
      nav.dataset.bound = '1';
      nav.addEventListener('click', e => {
        const btn = e.target.closest ? e.target.closest('.codex-nav-btn') : null;
        if (!btn) return;
        const id = btn.dataset.target;
        const card = document.getElementById('codex-' + id);
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        nav.querySelectorAll('.codex-nav-btn').forEach(b => b.classList.toggle('on', b === btn));
      });
    }
    const input = document.getElementById('codex-search');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => applyFilter(input.value));
    }
  }

  // 搜索：按卡片全文匹配，隐藏不命中的卡片并更新计数
  function applyFilter(keyword) {
    const q = String(keyword || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.codex-card');
    let hit = 0;
    cards.forEach(card => {
      const match = !q || String(card.textContent || '').toLowerCase().indexOf(q) !== -1;
      card.style.display = match ? '' : 'none';
      if (match) hit++;
    });
    const count = document.getElementById('codex-count');
    if (count) count.textContent = q ? `找到 ${hit} 条` : `共 ${cards.length} 个板块`;
    const empty = document.getElementById('codex-empty');
    if (empty) empty.style.display = (q && hit === 0) ? '' : 'none';
  }

  function renderCodex() {
    const nav = document.getElementById('codex-nav');
    const content = document.getElementById('codex-content');
    if (!nav || !content) return;
    if (!rendered) {
      nav.innerHTML = ENTRIES.map(e =>
        `<button class="codex-nav-btn" data-target="${e.id}">${e.icon} ${escapeHtml(e.title)}</button>`
      ).join('');
      content.innerHTML =
        `<div class="codex-count" id="codex-count">共 ${ENTRIES.length} 个板块</div>` +
        ENTRIES.map(e => {
          let body = '';
          try { body = e.build(); } catch (err) { body = '<p class="codex-note">该板块暂时无法显示。</p>'; }
          return `<section class="fs-panel codex-card" id="codex-${e.id}">
            <div class="fs-panel__head">${e.icon} ${escapeHtml(e.title)}</div>
            <div class="fs-panel__body">
              <div class="codex-intro">${escapeHtml(e.intro)}</div>
              ${body}
            </div>
          </section>`;
        }).join('') +
        `<div class="codex-empty" id="codex-empty" style="display:none">没有匹配的词条，换个关键词试试</div>`;
      rendered = true;
      bindEvents();
      applyFilter('');
    }
  }

  /* ---------- 进入百科页时触发懒渲染（不进 renderAll） ---------- */
  const isCodex = () => String((location && location.hash) || '').replace('#', '') === 'codex';
  function ensureRendered() { if (isCodex()) renderCodex(); }
  if (window.addEventListener) window.addEventListener('hashchange', ensureRendered);
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', ensureRendered);

  /* ---------- 对外 API ---------- */
  UI.renderCodex = renderCodex;
  UI.codexEntries = ENTRIES;
})();
