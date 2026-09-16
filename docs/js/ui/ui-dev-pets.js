/* ============================================================
 * ui/ui-dev-pets.js —— 开发者面板「宠物数值总表」页
 *
 * 目的：宠物数据在 config.js 里散在五处（pet.starters / pet.speeds /
 *   pet.petProfiles / pet.evolution.tree / pet.evolution.activeSkills /
 *   Config.bloodlinePassive / pet.godPets），想核对"一条血统线现在什么样"
 *   要在文件里来回跳。本页把它按血统线聚成一屏：可读 + 可就地改。
 *
 * 语义（与调参页一致，别改）：只改内存里的 Config，本机立即生效；刷新复原。
 *   要"全员生效、刷新不丢"走 ui-dev.js 的云端保存/读取。
 *
 * 两条必须守住的规则：
 *   1. 进化等级门槛只在 Config.pet.evolution.stages 里生效。tree 节点里的
 *      minLevel 被 pet_evolve.js 的 getEvolutionRoutes 覆盖（见该文件第 34~49 行），
 *      是死数据 —— 所以门槛做成全局一处，绝不放进每条线里各配一份。
 *   2. 速度的权威值是 speeds[基宠名]。pet.js 的 getBaseSpeed 先按 lineId 查表，
 *      形态级那几行（血牙狐 96 等）只在老存档缺 lineId 时兜底。所以只暴露基宠一行。
 *
 * 依赖：config.js、ui-dev.js（window.DevPanel 注册点，必须在本文件之前加载）
 * ============================================================ */
(function () {
  'use strict';

  const DP = window.DevPanel;
  if (!DP) return;                 // 加载顺序不对（本文件必须排在 ui-dev.js 之后）
  const Config = window.Config;
  if (!Config || !Config.pet) return;

  /* ================= 字段机制 =================
   * 每个可改项 = 一个 field 对象：{ label, get, set, def, min, max, step, note }
   * def 在模块加载时取一次 —— 它是"复原值"与"是否改动"的比较基准。
   * get/set 用闭包直接指向 config 里的那个对象，所以 UI.renderAll() 后仍是同一份数据。 */
  const FIELDS = [];
  function field(label, get, set, opt) {
    const f = Object.assign({ label: label, get: get, set: set }, opt || {});
    f.def = get();
    FIELDS.push(f);
    return FIELDS.length - 1;      // fid
  }
  const fld = (fid) => FIELDS[fid];
  function isChanged(f) {
    const a = f.get(), b = f.def;
    if (typeof a === 'number' && typeof b === 'number') return a !== b;
    return String(a) !== String(b);
  }
  function changedCount() {
    let n = 0;
    for (let i = 0; i < FIELDS.length; i++) if (isChanged(FIELDS[i])) n++;
    return n;
  }
  function resetAll() { for (let i = 0; i < FIELDS.length; i++) FIELDS[i].set(FIELDS[i].def); }

  /* ================= 中文标签（可读性：别让人对着 chance/damageMult 猜） ================= */
  const PARAM_LABEL = {
    critRate: '暴击率', dodge: '闪避', hit: '命中',
    chance: '触发概率', damageMult: '伤害倍率', defRatio: '防御占比',
    threshold: '速度阈值', perPoint: '每多少点', bonusPer: '每档加成', cap: '加成上限',
    perStack: '每层增伤', maxStacks: '最大层数', ratio: '比例'
  };
  const SKILL_LABEL = {
    triggerChance: '触发概率', damageMultiplier: '伤害倍率',
    cooldownTurns: '冷却回合', maxHpDamageRate: '追加最大血'
  };
  const COEFF_LABEL = { hp: '血系数', atk: '攻系数', def: '防系数' };

  /* ================= 构建：8 条血统线 ================= */
  const P = Config.pet;
  const TREE = (P.evolution && P.evolution.tree) || {};
  const SKILLS = (P.evolution && P.evolution.activeSkills) || {};
  const PROFILES = P.petProfiles || {};
  const GODS = (P.godPets && P.godPets.list) || [];
  const PASSIVES = Config.bloodlinePassive || {};
  const SPEEDS = P.speeds || {};
  const STARTERS = P.starters || [];

  // 形态树里第 1/2/3 段分别对应 evolution.stages 的哪个下标
  // （stages: 0=初始 1=一阶Lv10 2=二阶Lv25 3=三阶淬体Lv40 4=终阶Lv60；
  //   tree 只有换形态的三段，淬体阶不换形态所以树里没有节点）
  const HOP_STAGE = [1, 2, 4];

  /* ⚠️ 形态树只在【基宠层】分叉（基宠 → 一阶A / 一阶B），再往上一层只有一条路。
   * 所以 idx 只作用于第一跳，后续必须走 routes[0]。
   * 早前写成每层都取 routes[idx] → 二阶/终阶全断在一阶，技能表跟着显示"该终形态没有配技能"（2026-09-16 修）。 */
  function buildBranch(base, idx) {
    const out = [];
    let cur = base, hop = 0, useIdx = idx;
    while (hop < HOP_STAGE.length) {
      const r = (TREE[cur] || [])[useIdx];
      if (!r) break;
      out.push({ from: cur, to: r.to, stageIdx: HOP_STAGE[hop], node: r });
      cur = r.to; hop++;
      useIdx = 0;                      // 后续层只有一条路
    }
    return out;
  }

  function buildLine(st) {
    const base = st.name;
    const role = (PROFILES[base] && PROFILES[base].role) || '均衡型';
    const line = { base: base, role: role, groups: [], branches: [buildBranch(base, 0), buildBranch(base, 1)] };

    /* --- 速度与基础三围 --- */
    const statCells = [
      field('速度', () => SPEEDS[base], v => { SPEEDS[base] = v; },
        { min: 1, max: 300, step: 1, int: true, note: '本线所有形态共用（进化不改速度）' }),
      field('基础生命', () => st.baseHp, v => { st.baseHp = v; }, { min: 0, max: 5000, step: 1, int: true }),
      field('基础攻击', () => st.baseAtk, v => { st.baseAtk = v; }, { min: 0, max: 2000, step: 1, int: true }),
      field('基础防御', () => st.baseDef, v => { st.baseDef = v; }, { min: 0, max: 2000, step: 1, int: true }),
      field('生命系数', () => st.statCoeff.hp, v => { st.statCoeff.hp = v; }, { min: 0, max: 50, step: 0.01 }),
      field('攻击系数', () => st.statCoeff.atk, v => { st.statCoeff.atk = v; }, { min: 0, max: 50, step: 0.01 }),
      field('防御系数', () => st.statCoeff.def, v => { st.statCoeff.def = v; }, { min: 0, max: 50, step: 0.01 })
    ];
    if (st.mech) {
      statCells.push(
        field('命中倍率', () => st.mech.hit, v => { st.mech.hit = v; }, { min: 0, max: 5, step: 0.01, note: '乘在全局 mechCoeff 上' }),
        field('闪避倍率', () => st.mech.dodge, v => { st.mech.dodge = v; }, { min: 0, max: 5, step: 0.01 })
      );
    }
    line.groups.push({ title: '速度与基础', cells: statCells });

    /* --- 面板属性（宠物页对玩家展示的机制属性） --- */
    const prof = PROFILES[base];
    if (prof) {
      line.groups.push({
        title: '面板属性', compact: true,
        cells: [
          field('暴击率 %', () => prof.critRate, v => { prof.critRate = v; }, { min: 0, max: 100, step: 1, int: true }),
          field('暴击伤害 %', () => prof.critDamage, v => { prof.critDamage = v; }, { min: 100, max: 500, step: 5, int: true }),
          field('命中', () => prof.hit, v => { prof.hit = v; }, { min: 0, max: 300, step: 1, int: true }),
          field('闪避', () => prof.dodge, v => { prof.dodge = v; }, { min: 0, max: 300, step: 1, int: true }),
          field('吸血 %', () => prof.lifesteal, v => { prof.lifesteal = v; }, { min: 0, max: 100, step: 1, int: true })
        ]
      });
    }

    /* --- 形态链（只读；门槛跟着全局 stages 走） --- */
    line.groups.push({ title: '形态链', kind: 'chain' });

    /* --- 主动技能（终形态 × A/B 分支） --- */
    const skillRows = [];
    line.branches.forEach((path, idx) => {
      if (!path.length) return;
      const top = path[path.length - 1].to;         // 终形态
      const def = SKILLS[top];
      if (!def) { skillRows.push({ tag: ['A', 'B'][idx], top: top, def: null }); return; }
      const cells = [
        field('触发概率', () => def.triggerChance, v => { def.triggerChance = v; },
          { min: 0, max: 1, step: 0.01, note: '期望提升 = 概率 ×(倍率−1)，16 个技能都压在 +13%~+18%' }),
        field('伤害倍率', () => def.damageMultiplier, v => { def.damageMultiplier = v; }, { min: 1, max: 5, step: 0.05 }),
        field('冷却回合', () => def.cooldownTurns, v => { def.cooldownTurns = v; }, { min: 0, max: 20, step: 1, int: true })
      ];
      if (def.maxHpDamageRate != null) {
        cells.push(field('追加最大血', () => def.maxHpDamageRate, v => { def.maxHpDamageRate = v; }, { min: 0, max: 0.5, step: 0.005 }));
      }
      skillRows.push({ tag: ['A', 'B'][idx], top: top, name: def.name, cells: cells });
    });
    line.groups.push({ title: '主动技能（终阶）', kind: 'skill', rows: skillRows });

    /* --- 血统被动（type/名称只读，参数可改） --- */
    const pas = PASSIVES[base];
    if (pas) {
      const cells = [];
      const params = pas.params || {};
      Object.keys(params).forEach(k => {
        if (typeof params[k] !== 'number') return;
        const isInt = Number.isInteger(params[k]);
        cells.push(field(PARAM_LABEL[k] || k, () => params[k], v => { params[k] = v; },
          { min: 0, max: 1000, step: isInt ? 1 : 0.01, int: isInt }));
      });
      line.groups.push({
        title: '血统被动',
        kind: 'passive', name: pas.name, type: pas.type, desc: pas.desc, cells: cells
      });
    }

    /* --- 神级形态 --- */
    const god = GODS.filter(g => g.line === base)[0];
    if (god) {
      line.groups.push({
        title: '神级形态', kind: 'god', name: god.name, sprite: god.sprite,
        cells: [
          field('速度', () => god.speed, v => { god.speed = v; }, { min: 1, max: 300, step: 1, int: true }),
          field('基础生命', () => god.baseHp, v => { god.baseHp = v; }, { min: 0, max: 5000, step: 1, int: true }),
          field('基础攻击', () => god.baseAtk, v => { god.baseAtk = v; }, { min: 0, max: 2000, step: 1, int: true }),
          field('基础防御', () => god.baseDef, v => { god.baseDef = v; }, { min: 0, max: 2000, step: 1, int: true }),
          field(COEFF_LABEL.hp, () => god.statCoeff.hp, v => { god.statCoeff.hp = v; }, { min: 0, max: 50, step: 0.01 }),
          field(COEFF_LABEL.atk, () => god.statCoeff.atk, v => { god.statCoeff.atk = v; }, { min: 0, max: 50, step: 0.01 }),
          field(COEFF_LABEL.def, () => god.statCoeff.def, v => { god.statCoeff.def = v; }, { min: 0, max: 50, step: 0.01 })
        ]
      });
    }

    return line;
  }
  const LINES = STARTERS.map(buildLine);

  /* ================= 全局：进化阶段 / 神级规则 ================= */
  function buildGlobal() {
    const E = P.evolution || {};
    const groups = [];

    // 进化阶段：等级门槛唯一生效处（tree 里的 minLevel 是死数据）
    const stageCells = [];
    (E.stages || []).forEach((s, i) => {
      if (i === 0) return;                                   // 初始阶 Lv1 不需要改
      stageCells.push(field(s.label + '门槛', () => s.minLevel, v => { s.minLevel = v; },
        { min: 1, max: 100, step: 1, int: true, note: i === 4 ? '同时是涅槃门槛' : '' }));
    });
    if (E.stages && E.stages[1]) {
      stageCells.push(field('一阶成长下限', () => E.stages[1].growthBoost[0], v => { E.stages[1].growthBoost[0] = v; }, { min: 0, max: 5, step: 0.05 }));
      stageCells.push(field('一阶成长上限', () => E.stages[1].growthBoost[1], v => { E.stages[1].growthBoost[1] = v; }, { min: 0, max: 5, step: 0.05 }));
    }
    if (E.stages && E.stages[3]) {
      stageCells.push(field('淬体成长下限', () => E.stages[3].growthBoost[0], v => { E.stages[3].growthBoost[0] = v; }, { min: 0, max: 5, step: 0.05, note: '三阶淬体是双倍档' }));
      stageCells.push(field('淬体成长上限', () => E.stages[3].growthBoost[1], v => { E.stages[3].growthBoost[1] = v; }, { min: 0, max: 5, step: 0.05 }));
    }
    groups.push({ title: '进化阶段', kind: 'stages', cells: stageCells });

    // 技能档位缩放（只缩放概率与倍率）
    const scCells = [];
    ((E.skillTierScale) || []).forEach((sc, i) => {
      scCells.push(field(['I 档', 'II 档', 'III 档'][i] + '概率', () => sc.chance, v => { sc.chance = v; }, { min: 0, max: 2, step: 0.05 }));
      scCells.push(field(['I 档', 'II 档', 'III 档'][i] + '倍率', () => sc.damage, v => { sc.damage = v; }, { min: 0, max: 2, step: 0.05 }));
    });
    if (scCells.length) groups.push({ title: '技能档位缩放（按阶）', compact: true, cells: scCells });

    // 神级宠规则
    const G = P.godPets || {};
    const godCells = [];
    const godNum = [
      ['成神成长门槛', 'minGrowth', 0, 200, 1, true],
      ['出生成长上限', 'birthGrowthCap', 0, 200, 1, true],
      ['合成终阶等级要求', 'baseLevelRequire', 1, 100, 1, true],
      ['至尊神石降级', 'supremeStoneLevelReduce', 0, 60, 1, true],
      ['每轮培育上限', 'cultivateMax', 0, 100, 1, true],
      ['超额折算比例', 'excessStatCoeffRatio', 0, 0.1, 0.005, false],
      ['超额折算封顶', 'excessStatCoeffMax', 0, 2, 0.01, false]
    ];
    godNum.forEach(function (it) {
      if (G[it[1]] == null) return;
      godCells.push(field(it[0], () => G[it[1]], v => { G[it[1]] = v; }, { min: it[2], max: it[3], step: it[4], int: it[5] }));
    });
    if (godCells.length) groups.push({ title: '神级宠规则', cells: godCells });

    return groups;
  }
  const GLOBAL_GROUPS = buildGlobal();

  /* ================= 渲染 ================= */
  function num2str(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 1000) / 1000);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inputHtml(fid) {
    const f = fld(fid);
    let s = '<input class="devp-num" type="number" data-fid="' + fid + '" value="' + num2str(f.get()) + '"';
    if (f.min != null) s += ' min="' + f.min + '"';
    if (f.max != null) s += ' max="' + f.max + '"';
    s += ' step="' + (f.step != null ? f.step : (f.int ? 1 : 0.01)) + '"';
    if (f.note) s += ' title="' + esc(f.note) + '"';
    return s + '>';
  }
  function cellHtml(fid) {
    const f = fld(fid);
    return '<label class="devp-cell' + (isChanged(f) ? ' is-changed' : '') + '" data-cell="' + fid + '">' +
      '<span class="devp-cell-label">' + esc(f.label) + '</span>' + inputHtml(fid) + '</label>';
  }
  function gridHtml(cells) {
    return '<div class="devp-grid">' + cells.map(cellHtml).join('') + '</div>';
  }

  function chainHtml(line) {
    const stages = (P.evolution && P.evolution.stages) || [];
    let rows = '';
    line.branches.forEach(function (path, idx) {
      if (!path.length) return;
      const tag = ['A', 'B'][idx];
      path.forEach(function (hop, i) {
        const st = stages[hop.stageIdx] || {};
        rows += '<tr>' +
          (i === 0 ? '<td class="devp-branch" rowspan="' + path.length + '">' + tag + '</td>' : '') +
          '<td>' + esc(st.label || '') + '</td>' +
          '<td>' + esc(hop.from) + ' <span class="devp-arrow">→</span> <b>' + esc(hop.to) + '</b></td>' +
          '<td class="devp-numcell">Lv' + (st.minLevel != null ? st.minLevel : '?') + '</td>' +
          '</tr>';
      });
    });
    if (!rows) return '<div class="devp-note-inline">这条线在形态树里没有进化节点。</div>';
    return '<table class="fs-table devp-table"><thead><tr>' +
      '<th>分支</th><th>阶</th><th>形态</th><th>门槛</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="devp-note-inline">门槛取自上方「进化阶段」，改那里才生效。</div>';
  }

  function skillHtml(group) {
    let rows = '';
    group.rows.forEach(function (r) {
      if (!r.def && !r.cells) {
        rows += '<tr><td class="devp-branch">' + r.tag + '</td><td>' + esc(r.top) + '</td>' +
          '<td colspan="5" class="devp-muted">该终形态没有配主动技能</td></tr>';
        return;
      }
      rows += '<tr><td class="devp-branch">' + r.tag + '</td>' +
        '<td><b>' + esc(r.top) + '</b><br><span class="devp-muted">' + esc(r.name) + '</span></td>' +
        r.cells.map(function (fid) {
          const f = fld(fid);
          return '<td class="devp-cell' + (isChanged(f) ? ' is-changed' : '') + '" data-cell="' + fid + '">' + inputHtml(fid) + '</td>';
        }).join('') +
        '</tr>';
    });
    return '<table class="fs-table devp-table"><thead><tr>' +
      '<th>分支</th><th>终形态 / 技能</th><th>概率</th><th>倍率</th><th>冷却</th><th>追加</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function groupHtml(group) {
    let inner = '';
    let head = '<div class="devp-group-title">' + esc(group.title) + '</div>';
    if (group.kind === 'chain') {
      inner = chainHtml(group.line);
    } else if (group.kind === 'skill') {
      inner = skillHtml(group);
    } else if (group.kind === 'passive') {
      head += '<div class="devp-sub">' + esc(group.name) + ' <span class="fs-tag">' + esc(group.type) + '</span></div>' +
        '<div class="devp-desc">' + esc(group.desc || '') + '</div>';
      inner = group.cells.length ? gridHtml(group.cells) : '<div class="devp-note-inline">该被动没有可调参数。</div>';
    } else if (group.kind === 'god') {
      head += '<div class="devp-sub">' + esc(group.name) + ' <span class="devp-muted">立绘复用：' + esc(group.sprite || '—') + '</span></div>';
      inner = gridHtml(group.cells);
    } else if (group.kind === 'stages') {
      head += '<div class="devp-note-inline">等级门槛只在这里生效（进化树节点里的 minLevel 会被覆盖，是死数据）。</div>';
      inner = gridHtml(group.cells);
    } else {
      inner = gridHtml(group.cells);
    }
    return '<div class="devp-group' + (group.compact ? ' is-compact' : '') + '">' + head + inner + '</div>';
  }

  function lineHtml(line) {
    let changed = 0;
    line.groups.forEach(function (g) {
      (g.cells || []).forEach(function (fid) { if (isChanged(fld(fid))) changed++; });
      if (g.kind === 'skill') (g.rows || []).forEach(function (r) {
        (r.cells || []).forEach(function (fid) { if (isChanged(fld(fid))) changed++; });
      });
    });
    const speed = SPEEDS[line.base];
    return '<section class="fs-panel devp-line" data-line="' + esc(line.base) + '">' +
      '<div class="fs-panel__head devp-line-head">' +
        '<span class="devp-line-name">' + esc(line.base) + '</span>' +
        '<span class="fs-tag">' + esc(line.role) + '</span>' +
        '<span class="devp-line-meta">速度 ' + (speed != null ? speed : '—') + ' · 已改 ' + changed + ' 项</span>' +
      '</div>' +
      '<div class="fs-panel__body">' +
        line.groups.map(function (g) { g.line = line; return groupHtml(g); }).join('') +
      '</div></section>';
  }

  function renderPetsPanel() {
    const n = changedCount();
    let html = '<div class="devp-head">' +
      '<div class="devp-head-left">' +
        '<span class="devp-head-title">宠物数值总表</span>' +
        '<span class="devp-head-sub">' + LINES.length + ' 条血统线 · 共 ' + FIELDS.length + ' 个可调项</span>' +
      '</div>' +
      '<div class="devp-head-right">' +
        '<span class="devp-changed' + (n ? ' is-on' : '') + '" id="devp-changed">已改动 ' + n + ' 项</span>' +
        '<button class="btn-mini ghost" id="devp-reset">全部复原</button>' +
        '<button class="btn-mini ghost" id="devp-copy">复制总表</button>' +
      '</div></div>' +
      '<div class="devp-warn" id="devp-warn" style="display:none"></div>';

    html += '<section class="fs-panel devp-global"><div class="fs-panel__head devp-line-head">' +
      '<span class="devp-line-name">全局规则</span>' +
      '<span class="devp-line-meta">所有血统线共用</span></div>' +
      '<div class="fs-panel__body">' + GLOBAL_GROUPS.map(groupHtml).join('') + '</div></section>';

    html += LINES.map(lineHtml).join('');

    html += '<div class="devp-foot">改完直接生效（本机）。要让所有玩家都生效、且刷新不丢，' +
      '去「调参」页点「保存到云端」。墨灵是孵化测试线（不在 8 只基宠里），见 docs/宠物总表.md。</div>';
    return html;
  }

  /* ================= 校验 ================= */
  // 只拦「会让游戏崩或让数值自相矛盾」的情况，不做平衡判断（平衡是人拍板的事）
  function validate() {
    const errs = [];
    const stages = (P.evolution && P.evolution.stages) || [];
    for (let i = 1; i < stages.length; i++) {
      if (!(stages[i].minLevel > stages[i - 1].minLevel)) {
        errs.push('进化阶段等级门槛必须递增：' + stages[i - 1].label + ' ' + stages[i - 1].minLevel +
          ' → ' + stages[i].label + ' ' + stages[i].minLevel);
      }
    }
    LINES.forEach(function (line) {
      const g = GODS.filter(x => x.line === line.base)[0];
      if (g && g.statCoeff && g.statCoeff.hp <= 0) errs.push(line.base + ' 的神级生命系数为 0，属性会算成 0');
      const st = STARTERS.filter(x => x.name === line.base)[0];
      if (st && st.statCoeff && (st.statCoeff.hp <= 0 || st.statCoeff.atk <= 0)) {
        errs.push(line.base + ' 的成长系数为 0，升级不涨属性');
      }
    });
    return errs;
  }
  function refreshWarn() {
    const el = document.getElementById('devp-warn');
    if (!el) return;
    const errs = validate();
    if (!errs.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = '<b>数值有问题：</b>' + errs.map(e => '<div>· ' + esc(e) + '</div>').join('');
  }
  function refreshHead() {
    const n = changedCount();
    const el = document.getElementById('devp-changed');
    if (el) {
      el.textContent = '已改动 ' + n + ' 项';
      el.classList.toggle('is-on', n > 0);
    }
    // 线块标题上的「已改 N 项」就地刷，避免整面板重渲染
    LINES.forEach(function (line) {
      const sec = document.querySelector('.devp-line[data-line="' + line.base + '"]');
      if (!sec) return;
      let changed = 0;
      line.groups.forEach(function (g) {
        (g.cells || []).forEach(function (fid) { if (isChanged(fld(fid))) changed++; });
        if (g.kind === 'skill') (g.rows || []).forEach(function (r) {
          (r.cells || []).forEach(function (fid) { if (isChanged(fld(fid))) changed++; });
        });
      });
      const meta = sec.querySelector('.devp-line-meta');
      if (meta) meta.textContent = '速度 ' + (SPEEDS[line.base] != null ? SPEEDS[line.base] : '—') + ' · 已改 ' + changed + ' 项';
    });
  }

  /* ================= 导出总表（Markdown，给人和 AI 读） ================= */
  function toMarkdown() {
    const stages = (P.evolution && P.evolution.stages) || [];
    let md = '# 宠物总表（面板导出快照）\n\n';
    md += '> 由开发者面板「宠物」页导出。改数值请改 config.js，本表只是读数。\n\n';
    md += '## 血统线速查\n\n| 血统线 | 定位 | 速度 | 血统被动 | A 线终形态 | B 线终形态 | 神级形态 |\n|---|---|---|---|---|---|---|\n';
    LINES.forEach(function (line) {
      const pas = PASSIVES[line.base];
      const god = GODS.filter(g => g.line === line.base)[0];
      const topOf = (i) => (line.branches[i].length ? line.branches[i][line.branches[i].length - 1].to : '—');
      md += '| ' + line.base + ' | ' + line.role + ' | ' + (SPEEDS[line.base] != null ? SPEEDS[line.base] : '—') + ' | ' +
        (pas ? pas.name : '—') + ' | ' + topOf(0) + ' | ' + topOf(1) + ' | ' + (god ? god.name : '—') + ' |\n';
    });

    md += '\n## 进化阶段\n\n| 阶 | 等级门槛 | 素材 | 成长提升 | 换形态 |\n|---|---|---|---|---|\n';
    stages.forEach(function (s) {
      md += '| ' + s.label + ' | Lv' + s.minLevel + ' | ' + (s.material || '—') + ' | ' +
        (s.growthBoost ? '+' + s.growthBoost[0] + ' ~ +' + s.growthBoost[1] : '—') + ' | ' + (s.form ? '是' : '否') + ' |\n';
    });

    md += '\n## 各线明细\n';
    LINES.forEach(function (line) {
      const st = STARTERS.filter(x => x.name === line.base)[0] || {};
      const prof = PROFILES[line.base] || {};
      const pas = PASSIVES[line.base];
      const god = GODS.filter(g => g.line === line.base)[0];
      md += '\n### ' + line.base + '（' + line.role + '）\n\n';
      md += '- 速度 **' + SPEEDS[line.base] + '**｜基础 ' + st.baseHp + ' / ' + st.baseAtk + ' / ' + st.baseDef +
        '｜系数 ' + st.statCoeff.hp + ' / ' + st.statCoeff.atk + ' / ' + st.statCoeff.def + '\n';
      md += '- 面板：暴击 ' + prof.critRate + '%｜暴伤 ' + prof.critDamage + '%｜命中 ' + prof.hit +
        '｜闪避 ' + prof.dodge + '｜吸血 ' + prof.lifesteal + '%\n';
      line.branches.forEach(function (path, idx) {
        if (!path.length) return;
        md += '- ' + ['A', 'B'][idx] + ' 线：' + path.map(function (h) {
          const s = stages[h.stageIdx] || {};
          return h.from + ' →' + h.to + '(Lv' + s.minLevel + ')';
        }).join(' → ') + '\n';
        const top = path[path.length - 1].to;
        const sk = SKILLS[top];
        if (sk) md += '  - 技能：' + sk.name + '｜概率 ' + (sk.triggerChance * 100).toFixed(0) + '%｜倍率 ×' + sk.damageMultiplier +
          '｜冷却 ' + sk.cooldownTurns + (sk.maxHpDamageRate ? '｜追加最大血 ' + (sk.maxHpDamageRate * 100).toFixed(1) + '%' : '') + '\n';
      });
      if (pas) md += '- 血统被动：' + pas.name + ' —— ' + pas.desc + '\n';
      if (god) md += '- 神级形态：' + god.name + '｜速度 ' + god.speed + '｜' + god.baseHp + ' / ' + god.baseAtk + ' / ' + god.baseDef +
        '｜系数 ' + god.statCoeff.hp + ' / ' + god.statCoeff.atk + ' / ' + god.statCoeff.def + '\n';
    });
    return md;
  }

  /* ================= 绑定 ================= */
  function bindPetsPanel() {
    const body = document.getElementById('dev-body');
    if (!body) return;

    const commit = function (inp) {
      const f = fld(Number(inp.dataset.fid));
      const v = Number(inp.value);
      if (!f || !Number.isFinite(v)) return;
      f.set(v);
      const cell = inp.closest('.devp-cell');
      if (cell) cell.classList.toggle('is-changed', isChanged(f));
      refreshHead();
      refreshWarn();
    };

    body.querySelectorAll('.devp-num[data-fid]').forEach(function (inp) {
      // 输入过程中：只写值 + 刷标记，不整面板重渲染（否则光标会被打断）
      inp.addEventListener('input', function () { commit(inp); });
      // 失焦/回车：让面板外的页面（宠物页、图鉴、战斗）看到新数值
      inp.addEventListener('change', function () { commit(inp); DP.applyAll(); });
    });

    const reset = document.getElementById('devp-reset');
    if (reset) reset.onclick = function () {
      resetAll();
      DP.applyAll();
      DP.refresh();
      DP.toast('已复原', '所有宠物数值回到 config.js 里的值');
    };

    const copy = document.getElementById('devp-copy');
    if (copy) copy.onclick = function () {
      const md = toMarkdown();
      const done = function (ok) {
        DP.toast(ok ? '已复制总表' : '复制失败', ok ? 'Markdown 格式，可直接粘进 docs/宠物总表.md 对照' : '请手动选中复制');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    };

    refreshWarn();
  }

  DP.registerTab('pets', { render: renderPetsPanel, bind: bindPetsPanel });
})();
