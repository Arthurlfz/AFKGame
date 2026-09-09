/* ============================================================
 * ui/ui-codex.js —— 百科页（页签式规则速查，2026-09-09 重构）
 * 形式（用户拍板）：顶部页签切换，一次只看一个板块，不做长滚动单页。
 * 内容（用户拍板）：只写关键规则（掉落 / 副本 / 鉴定 / 核心公式），
 *   细节让玩家进对应界面看，控制维护成本。
 * 数值全部从 Config / Equipment / Config.towerDrops 动态现读，
 *   禁止写死第二份数值（config.js 是唯一数值源）。
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
  function petIconHtml(name) {
    const p = PetSprites && PetSprites.avatarOf(name);
    return p ? `<img class="pet-avatar-sprite inline" src="${p}" alt="">` : '';
  }
  const pct = v => Math.round((v || 0) * 100) + '%';
  function table(headers, rows) {
    const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
    const body = rows.map(r =>
      `<tr>${r.map((c, i) => `<td class="${i === 0 ? 'codex-key' : 'codex-num'}">${c}</td>`).join('')}</tr>`
    ).join('');
    return `<div class="codex-table-wrap"><table class="fs-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function rules(items) {
    return `<ul class="codex-rules">${items.map(t => `<li>${t}</li>`).join('')}</ul>`;
  }
  const note = t => `<p class="codex-note">${t}</p>`;

  /* ============================================================
   * 板块构建（build() 每次切页签现算，config 改了自动反映）
   * ============================================================ */

  /* ---------- 战斗 ---------- */
  function buildBattle() {
    const B = Config.battle || {};
    const scale = B.speedScale || 1;
    const speeds = Object.values(Config.pet.speeds || {}).filter(v => typeof v === 'number');
    const fast = speeds.length ? Math.max.apply(null, speeds) : 0;
    const slow = speeds.length ? Math.min.apply(null, speeds) : 0;
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
        '伤害：伤害 = 攻击 × 攻击 ÷（攻击 + 有效防御），有效防御 = 防御 − 穿透；防御与攻击相等时挡掉一半，防御再高也挡不完',
        '暴击：按暴击率触发，触发后伤害 × 暴击伤害倍率',
        '吸血：命中后按 伤害 × 吸血率 回血，回血不超过生命上限',
        `回血：血量低于 ${stopPct} 自动停止挂机，每秒恢复最大生命的 ${regenPct}`,
        '战败：自动等待回血，回满后继续下一场',
        `怪类型强度：普通 ×${tm.normal != null ? tm.normal : 1} / 进化 ×${tm.evolved != null ? tm.evolved : 1} / 变异 ×${tm.mutant != null ? tm.mutant : 1}`,
        `怪数值按等级缩放，倍率钳制在 ${clampCfg[0]} 到 ${clampCfg[1]} 之间`,
        '守关 Boss：每场 1/1600 概率出现（连续 2400 场未出必出，出后 200 场内不再出）；它是该图怪池里等级最高的怪，等级取图段上限，血 ×5、攻 ×1.5，名字带「霸主·」前缀',
        `主动技能：进化到终形态后永久拥有，战斗中按概率自动释放（冷却 ${cd} 回合），涅槃/转生不掉`,
        '血统被动：每只基宠天生一条，战斗中自动生效（见宠物成长板块）'
      ]);
  }

  /* ---------- 掉落与鉴定 ---------- */
  function buildDrop() {
    const D = Config.drop || {};
    const stages = D.poolByStage || {};
    const shareOf = (pool, k) => {
      const keys = Object.keys(pool || {});
      const total = keys.reduce((s, k2) => s + (pool[k2] || 0), 0);
      return total > 0 ? (pool[k] || 0) / total * 100 : 0;
    };
    const f1 = stages[1] || D.pool || {};
    const f3 = stages[3] || D.pool || {};
    const probRow = (label, pool) => [
      label,
      shareOf(pool, 'material').toFixed(1) + '%',
      shareOf(pool, 'equipment').toFixed(1) + '%',
      shareOf(pool, 'egg').toFixed(1) + '%'
    ];
    // 高级物品归属：直接读 Config.towerDrops（掉落削减的另一半账本）
    const TW = Config.towerDrops || {};
    const towerRows = (TW.items || []).map(i => [
      escapeHtml(i.name),
      escapeHtml(i.note || ''),
      escapeHtml(i.backup || '')
    ]);
    return note('普通地图每场战斗只摇一次掉落，四选一：什么都没有 / 一件材料 / 一件装备（未鉴定）/ 一颗宠物蛋。')
      + table(['玩家阶段', '掉材料', '掉装备', '掉蛋'], [
        probRow('新手期（图1-3）', f1),
        probRow('毕业期（图8-10）', f3)
      ])
      + note('掉什么材料由地图档次决定：')
      + rules([
        '图1-3：进化素材 + 重铸石为主',
        '图4-7：增缀石 / 剥离石 / 合成之石',
        '图8-10：合成之石 / 剥离石为主',
        '每张图都掉自己的「区域材料」，交给地图委托换资源副本门票',
        '宠物蛋孵出副宠，是合成与涅槃的素材来源'
      ])
      + note('鉴定：掉落的装备全部是未鉴定状态，词缀封印，必须用鉴定石揭晓后才能穿戴、打造或上架。')
      + (towerRows.length
          ? note('高级物品不从普通地图产出（归属通天塔，塔开放前无法获取，见下表）：')
            + table(['物品', '用途', '当前来源'], towerRows)
          : '');
  }

  /* ---------- 副本（资源试炼） ---------- */
  function buildTrial() {
    const T = Config.resourceTrials || {};
    const routes = T.routes || [];
    const routeRows = routes.map(r => [
      escapeHtml(r.name || r.id),
      r.minLevel > 1 ? 'Lv.' + r.minLevel : '不限',
      escapeHtml(r.desc || '')
    ]);
    return note('资源副本定向补资源：普通地图掉什么随缘，副本里掉什么是你选的。入口在世界地图的菱形副本节点。')
      + table(['副本', '门槛', '产出'], routeRows)
      + rules([
        `进入：每个副本每天免费 ${T.freeEntriesPerDay != null ? T.freeEntriesPerDay : 3} 次，北京时间 12:00 刷新`,
        `免费次数用完后，每次进入消耗 1 张${escapeHtml(T.ticketName || '资源试炼门票')}`,
        `门票来源：完成地图委托，每交一轮给 1 张`,
        '流程：每趟 5 场短战斗，血量跨场累计，中途倒下本次结束',
        '失败保护：不退次数与门票，给少量本路线的基础补偿（绝不是区域材料）'
      ]);
  }

  /* ---------- 装备与打造 ---------- */
  function buildEquipCraft() {
    const E = Config.equipment || {};
    const C = Config.craft || {};
    const S = Config.salvage || {};
    const SC = Config.soulCast || {};
    const slots = (Equipment && Equipment.SLOTS) || [];
    const pool = (Equipment && Equipment.AFFIX_POOL) || [];
    const rarities = E.rarities || [];
    const rarityRows = rarities.map(r => [
      escapeHtml(r.label),
      r.affixMin === r.affixMax ? `${r.affixMin} 条` : `${r.affixMin} 到 ${r.affixMax} 条`
    ]);
    const prefixList = pool.filter(a => a.category === 'prefix').map(a => escapeHtml(a.label));
    const suffixList = pool.filter(a => a.category === 'suffix').map(a => escapeHtml(a.label));
    const stoneRows = ['reforge', 'strip', 'holy', 'augment', 'lock'].filter(k => C[k]).map(k => {
      const s = C[k];
      return [s.icon + ' ' + escapeHtml(s.name), '×' + s.amount, escapeHtml(s.effect), escapeHtml(s.rule)];
    });
    const rarityLabel = id => {
      const r = (Config.equipment.rarities || []).find(x => x.id === id);
      return r ? r.label : id;
    };
    const salvageRows = Object.keys(S).map(k => {
      const out = S[k] || {};
      const parts = Object.keys(out).map(ck => (C[ck] ? C[ck].name : ck) + ' ×' + out[ck]);
      return [escapeHtml(rarityLabel(k)), parts.length ? escapeHtml(parts.join('、')) : '无产出'];
    });
    const scRows = Object.keys(SC.tiers || {}).map(k => {
      const t = SC.tiers[k] || {};
      return [
        escapeHtml(t.label || k),
        'Lv.' + t.minLevel,
        '成长 ≥ ' + t.minGrowth,
        t.source === 'awaken' ? '觉醒特质' : '血脉特质',
        t.tierShift ? 'T 阶 +' + t.tierShift : 'T 阶不变'
      ];
    });
    return note(`装备共 ${slots.length} 个部位：${slots.map(s => escapeHtml(s)).join('、')}。品质由词缀条数唯一决定。`)
      + table(['品质', '词缀条数'], rarityRows)
      + note(`词缀分两类。前缀：${prefixList.join('、')}。后缀：${suffixList.join('、')}。词缀数值分 T1~T5 档，T1 最高（具体区间进打造页看装备详情）。`)
      + note('最终属性怎么算：')
      + rules([
        '攻击 / 生命 / 防御 = 宠物裸属性 ×（1 + 百分比词缀总和）+ 装备底材固定值',
        '暴击 / 暴击伤害 / 吸血 / 命中 / 闪避 / 速度 = 宠物底子 + 装备底材 + 词缀',
        '穿透 = 无视 X 点防御（只削防御不成负数）；伤害加成 = 最终伤害 +X%；受伤减免 = 受到伤害 -X%（最低承伤 10%）'
      ])
      + note('打造消耗对应的石头，直接改变装备的词缀：')
      + table(['石头', '消耗', '效果', '限制'], stoneRows)
      + note(`锁定：每条已锁定的词缀在重铸 / 神圣时额外消耗 1 颗${C.lock ? C.lock.name : '锁定石'}，最多锁 ${C.lock ? C.lock.maxLocked : 0} 条。`)
      + note('分解装备的产出：')
      + table(['品质', '分解产出'], salvageRows)
      + note(`魂铸：把宠物的特质铸进装备，消耗 ${escapeHtml(SC.material || '凝魂晶石')} ×${SC.materialCount}，每件装备最多 ${SC.maxSoulAffixes} 条魂铸词缀。`)
      + table(['魂铸档', '宠物等级', '宠物成长', '特质来源', 'T 阶'], scRows);
  }

  /* ---------- 宠物成长 ---------- */
  function buildPet() {
    const P = Config.pet;
    const coeff = P.statCoeff || {};
    const names = (P.starters || []).map(s => s.name);
    const profOf = n => (P.petProfiles && P.petProfiles[n]) || P.defaultPetProfile || {};
    const rows1 = (P.starters || []).map(s => {
      const p = profOf(s.name);
      return [
        `${petIconHtml(s.name)} ${escapeHtml(s.name)}`,
        escapeHtml(p.role || '均衡型'),
        s.baseHp, s.baseAtk, s.baseDef,
        Number(s.growth).toFixed(1),
        P.speeds[s.name] != null ? P.speeds[s.name] : '?'
      ];
    });
    const EV = P.evolution || {};
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
    const passiveRows = Object.keys(Config.bloodlinePassive || {}).map(n => {
      const b = Config.bloodlinePassive[n] || {};
      // 被动 key = 基宠名 → 直接取真实头像（2026-09-10 移除 emoji 占位）
      return [`${petIconHtml(n)} ${escapeHtml(n)}`, escapeHtml(b.name || ''), escapeHtml(b.desc || '')];
    });
    const G = P.godPets || {};
    const godRows = (G.list || []).map(g => {
      const c = g.statCoeff || {};
      return [escapeHtml(g.name), escapeHtml(g.line || ''), g.speed, g.baseHp, g.baseAtk, g.baseDef, `${c.hp} / ${c.atk} / ${c.def}`];
    });
    return note('属性由基础值、等级、成长值和成长系数共同决定。')
      + table(['宠物', '定位', '生命', '攻击', '防御', '成长', '速度'], rows1)
      + note('属性公式（成长系数每只宠不同，进化后沿用来源基宠的系数）：')
      + rules([
        `生命 = 基础生命 + 等级 × 成长值 × ${coeff.hp}`,
        `攻击 = 基础攻击 + 等级 × 成长值 × ${coeff.atk}`,
        `防御 = 基础防御 + 等级 × 成长值 × ${coeff.def}`,
        '速度 = 该宠固定基础速度 + 装备加成，等级与成长值不影响速度',
        `等级上限 ${P.maxLevel} 级`
      ])
      + note(`5 阶进化：共 ${EV.maxEvolveTimes} 次进化（初始 → 终阶），素材与成长提升由「当前阶」决定：`)
      + table(['阶段', '门槛', '消耗素材', '成长提升', '形态', '说明'], stageRows)
      + note('血统被动（每只基宠天生一条，战斗中生效，不可继承、不可更换）：')
      + table(['基宠', '被动', '效果'], passiveRows)
      + note(`神级宠（${(G.list || []).length} 只，每条血统线 1 只；独立宠物而非进阶形态，成长系数约为普通宠的 1.5 倍，只有它能涅槃）：`)
      + table(['神级宠', '血统线', '速度', '生命', '攻击', '防御', '成长系数 血/攻/防'], godRows);
  }

  /* ---------- 变强路线 ---------- */
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
    const TRAITS = Config.petTraits || {};
    const H = Config.traitHatch || {};
    const hc = H.counts || [40, 45, 13, 2];
    const tr = H.tierRoll || [0, 10, 30, 60];
    const rows = [
      ['🌟 进化', gates.length ? gates.join(' → ') : '不限', matList.join('；') || (EV.materialName || '进化素材'),
        `共 ${EV.maxEvolveTimes} 次（初始 → 一阶 → 二阶 → 三阶 → 终阶）。${keepText}；其余阶段换形态`,
        '素材与成长提升按「当前阶」决定；可选消耗 1 个进化道具放大倍率'],
      ['♻️ 涅槃', 'Lv.' + (NI.minLevel || 0) + '（主宠与副宠都要到）',
        nirItems.length ? '可选消耗 ' + nirItems.map(i => escapeHtml(i.name)).join(' / ') + ' ×1' : '无（不再消耗涅磐兽）',
        `主宠成长 += 副宠成长 × 吸收比例（${nirItems.map(i => escapeHtml(i.name) + '：' + escapeHtml(i.effect || '')).join('；')}）；副宠消失，主宠等级重置为 1`,
        `${NI.requireGodPet !== false ? '只有神级宠能涅槃；' : ''}可反复涅槃叠加成长${cb.amount ? `；额外投入 ${escapeHtml(cb.material)} ×${cb.amount} 可让本次吸收 ×${(1 + (cb.absorbBonus || 0)).toFixed(1)}` : ''}；穿着装备的宠物不能涅槃`],
      ['⚗️ 合成', 'Lv.' + (SY.minLevel || 0) + '（两只都要到）',
        ((SY.material || {}).name || '合成之石') + ' ×' + ((SY.material || {}).amount || 1) + ' + 合成道具 ×1',
        `新宠成长 = 主宠成长 + 副宠成长 × ${SY.baseBoostRatio} ×（1 + 等级加成 + 道具加成）+ 随机 +${rb[0]} 到 +${rb[1]}，成长只涨不跌；${pct(mu.chance || 0)} 概率出「·异变」宠`,
        `两只素材宠都消失，新宠等级回 1；普通宠成长软上限 ${SY.normalGrowthCap}；穿着装备的宠物不能合成`],
      ['⚡ 神级宠', `终阶（第 ${(SY.god && SY.god.minStage) || 5} 阶）+ Lv.${godLv}`,
        '合成道具 ×1（决定出神概率）',
        synthItems.map(i => `${escapeHtml(i.name)} ${Math.round((i.godChance || 0) * 100)}%`).join(' / ') + ' 概率出神级宠',
        `门槛：主宠与副宠都终阶且成长 ≥ ${godMin}`],
      ['🥚 孵化', '无', '宠物蛋 ×1',
        `孵出一只基础宠，成长 ${baby.min} 到 ${baby.max} 随机；孵化时按概率携带血脉特质（${hc[1]}% 一条 / ${hc[2]}% 两条 / ${hc[3]}% 三条，T 阶 T1 ${tr[1]}% / T2 ${tr[2]}% / T3 ${tr[3]}%）`,
        '孵出的是基础形态，高阶形态靠进化'],
      ['🔥 魂铸', '宠物 Lv.40 起（传承档 Lv.60）',
        `${escapeHtml(SC.material || '凝魂晶石')} ×${SC.materialCount}`,
        '把宠物的血脉 / 觉醒特质铸进装备，让特质跨世代传承',
        `每件装备最多 ${SC.maxSoulAffixes} 条魂铸词缀；传承档需终形态、成长 ≥ ${((SC.tiers || {}).legend || {}).minGrowth || 60}`]
    ];
    const traitCount = Object.keys(TRAITS).length;
    return note('宠物通过进化、涅槃、合成、神级合成、孵化变强，魂铸把特质传承到装备。')
      + table(['方式', '等级门槛', '消耗', '效果', '限制'], rows)
      + note(`血脉特质共 ${traitCount} 条 × T1~T3（T1 最强最稀有，一律不含攻击%），细节见宠物页特质栏。`);
  }

  /* ---------- 地图 ---------- */
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
    return note('每张图对应一个等级段，并掉落该图的专属材料。低推荐成长进高级图会很吃力，先回当前图刷材料、做装备。')
      + table(['地图', '等级段', '推荐成长', '专属材料'], rows);
  }

  /* ---------- 市场 ---------- */
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

  /* ---------- 页签清单（8 个板块） ---------- */
  const ENTRIES = [
    { id: 'battle', icon: '⚔️', title: '战斗', intro: '战斗全自动，出手快慢由速度决定，命中、暴击、吸血各自独立结算。', build: buildBattle },
    { id: 'drop', icon: '💧', title: '掉落与鉴定', intro: '每场战斗摇一次掉落；掉落的装备需要鉴定后才能使用。', build: buildDrop },
    { id: 'trial', icon: '🗝️', title: '资源副本', intro: '普通地图掉什么随缘，副本里掉什么是你选的。', build: buildTrial },
    { id: 'equipcraft', icon: '🛡️', title: '装备与打造', intro: '品质由词缀条数决定，打造消耗石头直接改变词缀，魂铸把特质铸进装备。', build: buildEquipCraft },
    { id: 'pet', icon: '🐾', title: '宠物成长', intro: '属性由基础值、等级、成长值和成长系数共同决定，速度是固定值。', build: buildPet },
    { id: 'growth', icon: '📈', title: '变强路线', intro: '宠物通过进化、涅槃、合成、神级合成、孵化变强，魂铸把特质传承到装备。', build: buildGrowth },
    { id: 'area', icon: '🗺️', title: '地图', intro: '每张图对应一个等级段，并掉落该图的专属材料。', build: buildArea },
    { id: 'market', icon: '💰', title: '市场', intro: '交易用材料计价，不用金币；挂单期间商品被锁定。', build: buildMarket }
  ];

  /* ---------- 渲染（页签式：一次只渲染当前板块） ---------- */
  let navReady = false;
  let current = ENTRIES[0].id;

  function renderTab() {
    const content = document.getElementById('codex-content');
    if (!content) return;
    const e = ENTRIES.find(x => x.id === current) || ENTRIES[0];
    let body = '';
    try { body = e.build(); } catch (err) { body = '<p class="codex-note">该板块暂时无法显示。</p>'; }
    content.innerHTML =
      `<section class="fs-panel codex-card" id="codex-${e.id}">
        <div class="fs-panel__head">${e.icon} ${escapeHtml(e.title)}</div>
        <div class="fs-panel__body">
          <div class="codex-intro">${escapeHtml(e.intro)}</div>
          ${body}
        </div>
      </section>`;
  }

  function renderCodex() {
    const nav = document.getElementById('codex-nav');
    const content = document.getElementById('codex-content');
    if (!nav || !content) return;
    if (!navReady) {
      nav.innerHTML = ENTRIES.map(e =>
        `<button class="codex-nav-btn" data-target="${e.id}">${e.icon} ${escapeHtml(e.title)}</button>`
      ).join('');
      navReady = true;
      const navEl = document.getElementById('codex-nav');
      if (navEl && navEl.addEventListener) {
        navEl.addEventListener('click', ev => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('.codex-nav-btn') : null;
          if (btn && btn.dataset && btn.dataset.target) show(btn.dataset.target);
        });
      }
    }
    if (nav.querySelectorAll) {
      nav.querySelectorAll('.codex-nav-btn').forEach(b => b.classList.toggle('on', b.dataset && b.dataset.target === current));
    }
    renderTab();
  }

  function show(id) {
    current = ENTRIES.some(e => e.id === id) ? id : ENTRIES[0].id;
    renderCodex();
  }

  /* ---------- 进入百科页时触发懒渲染（不进 renderAll） ---------- */
  const isCodex = () => String((location && location.hash) || '').replace('#', '') === 'codex';
  function ensureRendered() { if (isCodex()) renderCodex(); }
  if (window.addEventListener) window.addEventListener('hashchange', ensureRendered);
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', ensureRendered);

  /* ---------- 对外 API ---------- */
  UI.renderCodex = renderCodex;
  UI.codexShow = show;
  UI.codexEntries = ENTRIES;
})();
