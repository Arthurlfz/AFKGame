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
      + table(['终形态', '主动技能', '解锁', '冷却', '效果'], skillRows);

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
      + note('血脉特质（8 条 × T1~T3，T1 最强最稀有；特质一律不含攻击%，只叠加机制 / 生存属性）：')
      + table(['特质', 'T1', 'T2', 'T3', '说明'], traitRows)
      + note('孵化特质概率（变异宠保底 1 条，T 阶整体抬升）：')
      + table(['条数 / 规则', '概率', '说明'], hatchRows)
      + note('继承 / 植入（合成与涅槃）：')
      + rules([
        `合成：主宠特质每条保留 ${Math.round((inh.synthKeep != null ? inh.synthKeep : 0.7) * 100)}%、副宠每条继承 ${Math.round((inh.synthGive != null ? inh.synthGive : 0.4) * 100)}%；继承时 ${Math.round((inh.up != null ? inh.up : 0.2) * 100)}% 升一阶（封顶 T1）、${Math.round((inh.down != null ? inh.down : 0.1) * 100)}% 降一阶（最低 T3）；变异成功额外追 1 条；总上限 ${inh.cap != null ? inh.cap : 3} 条`,
        `涅槃：主宠特质全保留；副宠每条 ${Math.round((nir.implantChance != null ? nir.implantChance : 0.3) * 100)}% 概率植入（同类型取高 T，不叠加）`
      ])
      + note('觉醒特质（Lv60 终形态解锁 = 对应主动技能伤害 +20% + 血统定位加成）：')
      + table(['血统线', '觉醒定位加成'], awRows);
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

    return note('战斗全自动进行，出手快慢由速度决定，命中、暴击、吸血各自独立结算。')
      + rules([
        `出手：进度条满 100 打一次，每 100 毫秒累加 速度 ÷ ${scale}。速度 ${fast} 约 ${secOf(fast)} 秒出手一次，速度 ${slow} 约 ${secOf(slow)} 秒一次`,
        '命中：命中率 = 命中 ÷（命中 + 闪避），最低 5%，最高 95%',
        '伤害：伤害 = 攻击 − 防御，最低 1',
        '暴击：按暴击率触发，触发后伤害 × 暴击伤害倍率',
        '吸血：命中后按 伤害 × 吸血率 回血，回血不超过生命上限',
        `回血：血量低于 ${stopPct} 自动停止挂机，每秒恢复最大生命的 ${regenPct}`,
        '战败：自动等待回血，回满后继续下一场'
      ]);
  }

  /* ---------- 3. 装备 ---------- */
  function buildEquip() {
    const E = Config.equipment || {};
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
      + note('最终属性怎么算：')
      + rules([
        '攻击 / 生命 / 防御 = 宠物裸属性 ×（1 + 百分比词缀总和）+ 装备底材固定值',
        '暴击 / 暴击伤害 / 吸血 / 命中 / 闪避 / 速度 = 宠物底子 + 装备底材 + 词缀'
      ]);
  }

  /* ---------- 4. 打造 ---------- */
  function buildCraft() {
    const C = Config.craft || {};
    const S = Config.salvage || {};
    const stoneRows = ['reforge', 'strip', 'holy', 'augment'].filter(k => C[k]).map(k => {
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
      + note('分解装备的产出：')
      + table(['品质', '分解产出'], salvageRows);
  }

  /* ---------- 5. 材料 ---------- */
  function buildMaterial() {
    const mats = (Config.trade && Config.trade.materials) || [];
    const C = Config.craft || {};
    const useOf = name => {
      for (const k of ['reforge', 'strip', 'holy', 'augment']) {
        if (C[k] && C[k].name === name) return '打造：' + C[k].effect;
      }
      if (Config.synthesize && Config.synthesize.material && Config.synthesize.material.name === name) return '宠物合成消耗';
      if (Config.nirvana && Config.nirvana.material && Config.nirvana.material.name === name) return '宠物涅槃消耗';
      const evo = (Config.pet && Config.pet.evolution && Config.pet.evolution.materialName) || '进化素材';
      if (name.indexOf(evo) !== -1) return '宠物进化消耗';
      if (name === '宠物蛋') return '孵化出一只基础宠';
      if (name === ((Config.pet && Config.pet.expPool && Config.pet.expPool.material) || '凝魂晶石')) { const EP = Config.pet.expPool; return `满级(${Config.pet.maxLevel}级)后每 ${EP.perCrystal} 点溢出经验凝出 1 颗；涅槃时可投入强化吸收`; }
      return '市场交易计价';
    };
    const rows = mats.map(m => [m.icon + ' ' + escapeHtml(m.name), escapeHtml(useOf(m.name))]);

    return note('材料用于打造、进化、涅槃与合成，也是市场交易的计价单位。')
      + table(['材料', '用途'], rows);
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
    const baby = (Config.pet && Config.pet.babyGrowth) || {};
    // 进化门槛：从进化树里收集所有 minLevel，去重排序
    const levels = [];
    Object.keys(EV.tree || {}).forEach(k => (EV.tree[k] || []).forEach(n => {
      if (n.minLevel != null && levels.indexOf(n.minLevel) === -1) levels.push(n.minLevel);
    }));
    levels.sort((a, b) => a - b);
    const gb = EV.growthBoost || [0, 0];
    const mu = (SY.mutation || {});

    const rows = [
      [
        '🌟 进化',
        levels.length ? levels.join(' / ') + ' 级' : '不限',
        (EV.materialName || '进化素材') + ' ×1',
        `换形态，成长 +${gb[0]} 到 +${gb[1]}`,
        `单宠最多 ${EV.maxEvolveTimes} 次`
      ],
      [
        '♻️ 涅槃',
        (NI.minLevel || 0) + ' 级',
        ((NI.material || {}).name || '涅磐兽') + ' ×' + ((NI.material || {}).amount || 1),
        `主宠吸收副宠成长 ×${NI.absorbRatio}，副宠消失，等级重置为 1`,
        `成长上限 ${NI.maxGrowth}，达到 ${NI.growthCap} 后吸收减半；穿着装备的宠物不能涅槃`
      ],
      [
        '⚗️ 合成',
        (SY.minLevel || 0) + ' 级',
        ((SY.material || {}).name || '合成之石') + ' ×' + ((SY.material || {}).amount || 1),
        `${pct(mu.chance || 0)} 概率出「·异变」宠，新宠成长 = 主 ×${SY.mainW} + 副 ×${SY.subW}，变异再 +${(mu.growthBonus || [0, 0])[0]} 到 +${(mu.growthBonus || [0, 0])[1]}`,
        '两只素材宠都消失，新宠等级回到 1；穿着装备的宠物不能合成'
      ],
      [
        '🥚 孵化',
        '无',
        '宠物蛋 ×1',
        `孵出一只基础宠，成长 ${baby.min} 到 ${baby.max} 随机`,
        '孵出的是基础形态，高阶形态靠进化'
      ]
    ];

    return note('宠物可以通过进化、涅槃、合成、孵化四种方式变更形态或提升成长值。')
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
    { id: 'equip', icon: '🛡️', title: '装备', intro: '装备分 12 个部位，品质由词缀条数决定，属性由底材固定值和词缀共同提供。', build: buildEquip },
    { id: 'craft', icon: '🛠️', title: '打造', intro: '打造消耗对应的石头，直接改变装备的词缀。', build: buildCraft },
    { id: 'material', icon: '💠', title: '材料', intro: '材料用于打造、进化、涅槃与合成，也是市场交易的计价单位。', build: buildMaterial },
    { id: 'area', icon: '🗺️', title: '地图', intro: '每张图对应一个等级段，并掉落该图的专属材料。', build: buildArea },
    { id: 'growth', icon: '📈', title: '变强 4 条路', intro: '宠物可以通过进化、涅槃、合成、孵化四种方式变更形态或提升成长值。', build: buildGrowth },
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
