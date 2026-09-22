/* ============================================================
 * ui/ui-pet.js —— 宠物页 UI
 * 职责：
 *  1. 出战宠物面板（属性含装备加成）、装备 tab 三连屏（属性 / 12 装备槽 / 换装背包）
 *  2. 宠物列表（切换出战）、宠物 Tooltip
 *  3. PetUI 共享 API（iconHtml / tooltip / 特质胶囊），供 ui-pet-evolve / ui-pet-merge / ui-pet-synth 使用
 * 不在本文件：进化 / 合成 / 涅槃三个 tab 的实现在 ui-pet-evolve.js / ui-pet-synth.js / ui-pet-merge.js。
 *   它们在 游戏.html 里后加载，会覆盖同名 UI API —— 本文件不要重复实现，只提供共用的 PetUI 工具。
 * 依赖：pet / equipment / market；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const { getActivePet, getPets, getStats, getCurHp, getBonusText, expNeed, setActive } = window.Pet;
  const { unequip, describeItem, rarityOf, equipItem, getInventory, flattenAffixes } = window.Equipment;
  const Market = window.Market;
  const PetSprites = window.PetSprites;

  // 宠物头像 HTML（小尺寸用头像版）：有头像图则 <img>，否则留空（不回退 emoji，2026-09-10 移除占位头像）。
  // inline=true → 行内小头像（跟文字齐平，用于「路线：<头像> 名字」这类文案里）；
  // 不传 → 块级，尺寸由所在容器的 CSS 决定（img.pet-avatar-sprite 有兜底尺寸，不会按原图炸开）。
  function iconHtml(name, inline) {
    let p = PetSprites && PetSprites.avatarOf(name);
    // 神级宠：名字不在立绘表里 → 用 godPets.sprite（该线终形态立绘）兜底
    if (!p && window.Pet && window.Pet.godInfoOf) {
      const g = window.Pet.godInfoOf({ name: name });
      if (g && g.sprite && PetSprites) p = PetSprites.avatarOf(g.sprite);
    }
    return p ? `<img class="pet-avatar-sprite${inline ? ' inline' : ''}" src="${p}" alt="">` : '';
  }

  /* ---------- 宠物 Tooltip（与装备 .bag-tooltip 同款：body 层共享浮层，悬停显示属性） ----------
   * 环形 = 该属性占"参考上限"的比例：生命/攻击/防御按「同等级但成长练满(10)」的自己算潜力完成度，
   * 速度/暴击/暴伤按固定参考值（120 / 50% / 300%），纯视觉参考，准确数值看环里的数字。 */
  function petTipHtml(pet) {
    const s = getStats(pet);
    const cap = getStats(Object.assign({}, pet, { growth: 10 }));
    const rows = [
      { label: '生命', val: Math.round(s.hp), max: Math.max(1, cap.hp), c: 'var(--hp-hi-rgb)' },
      { label: '攻击', val: Math.round(s.atk), max: Math.max(1, cap.atk), c: 'var(--action-gold-rgb)' },
      { label: '防御', val: Math.round(s.def), max: Math.max(1, cap.def), c: 'var(--r-blue-rgb)' },
      { label: '速度', val: Math.round(s.spd), max: 120, c: 'var(--spd-rgb)' },
      { label: '暴击', val: Math.round(s.critRate * 100) + '%', num: Math.round(s.critRate * 100), max: 50, c: 'var(--hp-hi-rgb)' },
      { label: '暴伤', val: Math.round(s.critDamage * 100) + '%', num: Math.round(s.critDamage * 100), max: 300, c: 'var(--action-gold-rgb)' }
    ];
    const R = 24, C = 2 * Math.PI * R;
    const rings = rows.map(r => {
      const ratio = Math.max(0, Math.min(1, (r.num != null ? r.num : r.val) / r.max));
      return `<div class="pt-ring" style="--c:${r.c}">
        <svg viewBox="0 0 58 58">
          <circle class="pt-bg" cx="29" cy="29" r="${R}"></circle>
          <circle class="pt-fg" cx="29" cy="29" r="${R}" stroke-dasharray="${(C * ratio).toFixed(1)} ${C.toFixed(1)}"></circle>
        </svg>
        <div class="pt-num">${r.val}</div>
        <div class="pt-label">${r.label}</div>
      </div>`;
    }).join('');
    const profile = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile;
    return `<div class="pt-name">${escapeHtml(pet.name)}</div>
      <div class="pt-sub">Lv.${pet.level} · 成长 ${(pet.growth || 0).toFixed(1)} · ${escapeHtml(profile.role || '均衡型')}</div>
      <div class="pt-rings">${rings}</div>
      ${UI.bloodlineHtml ? UI.bloodlineHtml(pet) : ''}
      <div class="pt-foot">${escapeHtml(profile.description || '')}</div>`;
  }
  function showPetTip(el, pet) {
    const tip = $('pet-tooltip');
    if (!tip || !el || !pet) return;
    /* 内容渲染失败就干脆不显示 —— 绝不让异常从这里冒出去
     *（浮窗是纯展示，任何异常都不该影响选宠/列表这些主流程）。 */
    try {
      tip.innerHTML = petTipHtml(pet);
    } catch (e) {
      return;
    }
    /* 先 show 再定位：display:none 时 offsetWidth/Height 量出来是 0，
     * 先量得到真实尺寸，避让才算得准（也不会先闪一下再跳位置）。 */
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const de = document.documentElement;
    // 视口尺寸：documentElement 拿不到时退回 window.inner*（桩环境/个别浏览器）
    const vw = (de && de.clientWidth) || (window.innerWidth || 0);
    const vh = (de && de.clientHeight) || (window.innerHeight || 0);
    const tw = tip.offsetWidth || 252, th = tip.offsetHeight || 240;
    let left = r.right + 10;
    // 右边放不下 → 翻到左边
    if (vw && left + tw > vw - 6) left = Math.max(6, r.left - tw - 10);
    let top = Math.max(6, r.top);
    // 下边放不下 → 往上抬（原来只夹了左右：卡片靠屏幕下方时，浮窗整块掉到视口外，看着像"没弹出来"）
    if (vh && top + th > vh - 6) top = Math.max(6, vh - th - 6);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hidePetTip() {
    const tip = $('pet-tooltip');
    if (tip) tip.classList.remove('show');
  }
  function bindPetTip(el, pet) {
    if (!el) return;
    el.addEventListener('mouseenter', () => showPetTip(el, pet));
    el.addEventListener('mouseleave', hidePetTip);
  }

  /* ---------- 属性变化闪烁（通用小动画） ---------- */
  function flashStat(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('changed');
    setTimeout(() => el.classList.remove('changed'), 500);
  }
  /* ---------- 养成 tab 的"还差什么"（2026-09-21 内测 🟠12：四个 tab 全亮，后三个新手进不去）----------
   * 做法：**只提示、不置灰不拦截** —— 点进去看看也谈不上是什么损失（AGENTS §七：只有"失败会丢资产"
   * 才值得拦）。玩家要的信息是"我现在够不够"，不是一道禁止入内的门。
   * 🔴🔴 2026-09-22 修正（用户实机抓到"觉醒显示未开启不对"）：上一版是**我自己拼条件**，
   *   与三个页面各自的真实判据对不上（觉醒页用的是"这只宠在主动技能表里 = 终形态"，
   *   合成页用 `Merge.canSynthesize` 还额外排除了穿装备/在售/神级宠）。
   * ⇒ 现在一律**直接调 core 自己的判定**（Merge.canSynthesize / canNirvanaMain + 觉醒页同款技能表口径），
   *   本文件不拼第二份条件。改门槛只动 core，这里自动跟着走。
   *
   * ⭐ 两态必须分开（上一版的第二个错）：**没资格** vs **有资格但缺材料** 是两回事 ——
   *   "还差终形态魂兽"= 这个玩法还没开；"缺 1 颗觉醒石"= 开了，只是这次做不了。
   *   都写成「未开启」会让已经熬到终形态的玩家以为自己白练了。 */
  /* 门槛判定的结构化版本：{ reason, kind }，kind ∈ 'pet'（还没资格）/ 'item'（有资格、只差东西）。
   * 为什么要分：角标要按类型分色 → 实心红点=只差东西、空心灰点=还没资格。
   * 对外只暴露字符串版（petTabGate），页面文案照旧。 */
  function petTabGateInfo(name) {
    const pets = getPets() || [];
    const Merge = window.Merge || {};
    const listed = (p) => !!(window.Market && window.Market.isListed && p.cloudId && window.Market.isListed(p.cloudId));
    if (name === 'synth') {
      const lv = (Config.synthesize || {}).minLevel || 40;
      const ok = (p) => (Merge.canSynthesize ? Merge.canSynthesize(p) : (p.level || 1) >= lv) && !listed(p);
      const n = pets.filter(ok).length;
      return n >= 2 ? null : { kind: 'pet', reason: `需要两只 Lv.${lv} 以上、没穿装备且不在出售的宠物，现在有 ${n} 只` };
    }
    if (name === 'merge') {   // ⚠️ 涅槃 tab 的 data-pet-tab 叫 merge，不是 nirvana
      const ok = (p) => (Merge.canNirvanaMain ? Merge.canNirvanaMain(p) : false) && !listed(p);
      const n = pets.filter(ok).length;
      const N = Config.nirvana || {};
      return n >= 1 ? null : { kind: 'pet', reason: `需要一只 Lv.${N.minLevel || 60} 以上的神级宠（且不在出售），现在有 ${n} 只` };
    }
    if (name === 'awaken') {
      /* 终形态的口径 = 觉醒页 `petList()` 同一套：这只宠的名字在主动技能表里
       * （`Config.pet.evolution.activeSkills`），神级宠查它复用立绘的原名；
       * **已经觉醒过的宠一定算**（它已经用上了这个玩法）。 */
      const skills = (Config.pet && Config.pet.evolution && Config.pet.evolution.activeSkills) || {};
      const skillOf = (p) => {
        if (p.awakened) return true;
        const base = String(p.name || '').replace(/·异变$/, '');
        if (skills[base]) return true;
        const sp = (window.Pet && window.Pet.isGodPet && window.Pet.isGodPet(p) && window.Pet.spriteNameOf)
          ? window.Pet.spriteNameOf(p) : null;
        return !!(sp && skills[sp]);
      };
      const finals = pets.filter(skillOf);
      if (!finals.length) return { kind: 'pet', reason: '还差：终形态魂兽（先在「进化」页进化到终阶）' };
      if (finals.every(p => p.awakened)) return null;   // 全部已觉醒：没有可做的事了
      const stone = (window.Materials && window.Materials.getQuantity) ? Number(window.Materials.getQuantity('觉醒石')) || 0 : 0;
      return stone >= 1 ? null : { kind: 'item', reason: '缺 1 颗觉醒石：做任务「觉醒之路」可反复领取' };
    }
    return null;   // 资料 / 进化：一直都能用
  }
  function petTabGate(name) {
    const info = petTabGateInfo(name);
    return info ? info.reason : null;
  }
  function renderPetTabHints() {
    const tabs = $('pet-tabs');
    if (!tabs || !tabs.querySelectorAll) return;
    tabs.querySelectorAll('.pet-tab').forEach(btn => {
      const info = petTabGateInfo(btn.dataset.petTab);
      // 完整原因挂 title（hover 可见）：玩家要知道的是"缺什么、去哪弄"，不是一句"缺材料"
      if (info) btn.setAttribute('title', info.reason); else btn.removeAttribute('title');
      /* 角标从"文字后缀"改成"右上角小圆点"（2026-09-22）：
       * 文字后缀把 tab 条挤得参差不齐；圆点不占位，鼠标悬停能看到完整原因。
       * 两态分色（CSS `.pet-tab-dot` / `.pet-tab-dot.is-locked`）：
       *   实心红点 = 有资格、只差材料；空心灰点 = 玩法还没开（差宠物）—— 别让刚练到终形态的人以为白练。 */
      let dot = btn.querySelector('.pet-tab-dot');
      if (info && !dot) {
        dot = document.createElement('span');
        dot.className = 'pet-tab-dot';
        btn.appendChild(dot);
      }
      if (info) dot.className = 'pet-tab-dot' + (info.kind === 'pet' ? ' is-locked' : '');
      else if (dot) dot.remove();
    });
  }

  /* ---------- 宠物面板 ---------- */
  function renderPetPanel() {
    renderPetTabHints();   // 先刷新养成 tab 提示（没有出战宠时也要刷新，所以放在 return 之前）
    const pet = getActivePet();
    if (!pet) return;
    const s = getStats(pet);
    const base = window.Pet.baseStats(pet);
    const profile = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile;
    /* 资料页头像（`.pet-avatar` = 158×158 的肖像框）：**优先头像版**（头肩特写），没有头像素材才回退逐帧动画立绘。
     * 🔴 2026-09-21 用户拍板**反转顺序**（原来是"动画立绘优先"）：框只有一百多像素，全身立绘塞进去就是
     *    "一只小蚂蚁在动"，脸都看不清；头肩像在这个尺寸才立得住。
     * ⚠️ **战斗页保持"动画立绘优先"**（那里是 350px 的大位，要看动作）—— 两处顺序不同是刻意的，别顺手统一。 */
    const pa = $('pet-avatar');
    if (pa) {
      if (PetSprites && PetSprites.mountAvatar(pa, pet.name)) {}
      else if (PetSprites && PetSprites.mountAnimated(pa, pet.name)) {}
      else pa.textContent = '';
    }
    $('pet-name').textContent = pet.name;
    $('pet-level').textContent = 'Lv.' + pet.level;
    $('exp-bar').style.width = Math.min(100, (pet.exp / expNeed(pet.level)) * 100) + '%';
    $('exp-text').textContent = `${fmtNum(pet.exp)}/${fmtNum(expNeed(pet.level))}`;
    // 「成长」是全游戏最核心也最抽象的术语（🟠10 / 🟡7）：它决定每升一级能加多少属性
    const growthEl = $('pet-growth');
    if (growthEl) {
      growthEl.textContent = pet.growth.toFixed(1);
      growthEl.title = '成长决定这只宠每升一级能加多少属性：数字越大，练同级就越强 —— 判断一只宠好不好的第一指标';
    }
    /* 术语就地解释（2026-09-22 内测 🟠10"术语太多，新玩家看不懂"）：
     * 不删术语（那是游戏的一部分），但每个术语都要能**就地看懂它到底是什么意思** ——
     * 悬停给完整解释，能塞下白话的地方直接写在旁边。 */
    const reborn = $('pet-reborn');
    if (reborn) {
      const n = pet.rebornCount || 0;
      reborn.textContent = n ? `转生 ${n} 次（涅槃重练过 ${n} 次）` : '转生 0 次（还没涅槃过）';
      reborn.title = '涅槃一次就记一次：涅槃会把等级打回 1 级，换来成长永久上涨 —— 转生次数越多，这只宠的底子越厚';
    }
    const skillInfo = $('pet-active-skill-info');
    if (skillInfo) {
      // 用 skillOf 而不是 activeSkills[名字]：变异宠名字带「·异变」，直接查表必然查不到，
      // 结果就是"明明有技能却显示未解锁"。skillOf 会剥后缀查本体（config 里现成的）。
      const evo = Config.pet.evolution || {};
      const skill = (evo.skillOf ? evo.skillOf(pet) : null) || (evo.activeSkills || {})[pet.name];
      // 触发概率以前全项目 UI 都没有展示（只有战斗逻辑在读），玩家只能看到"有技能"却不知道多强
      const chanceTxt = skill ? `${Math.round((skill.triggerChance || 0) * 100)}% 概率发动` : '';
      const effect = skill ? `${Math.round(skill.damageMultiplier * 100)}% 伤害${skill.maxHpDamageRate ? ` + 目标最大生命 ${Math.round(skill.maxHpDamageRate * 100)}%` : ''}` : '';
      const tierTxt = skill && skill.tier && skill.tier < 3 ? `（${skill.tierName} 档·进化升档）` : '';
      /* 还没解锁时（🟠11「主动技能没说明」）：不能只说"以后会解锁"，
       * 要说出**这只宠将来会学什么** + 怎么才能拿到 —— 玩家才知道现在该往哪练。 */
      const future = skill ? null : finalSkillOf(pet.name);
      const futureTxt = future
        ? `将来会学：${future.name}（${skillEffectLine(future)} · ${future.cooldownTurns} 回合冷却）`
        : '';
      skillInfo.textContent = skill
        ? `主动技能：${skill.name}${tierTxt} · ${chanceTxt} · ${effect} · ${skill.cooldownTurns} 回合冷却`
        : `主动技能：终形态 Lv.60 解锁${futureTxt ? ' — ' + futureTxt : '，随进化升档'}`;
    }
    // 血脉特质胶囊（出战面板常驻；空态以前只写"无血脉特质" —— 玩家不知道那是什么、怎么得到）
    const traitsEl = $('pet-traits');
    if (traitsEl) {
      const th = PetUI.traitsHtml(pet);
      if (th) {
        traitsEl.innerHTML = th;
      } else {
        traitsEl.innerHTML = '<span class="trait-none">还没有额外天赋</span>';
        traitsEl.title = '天赋是宠物带的小加成（吸血、暴击之类）：孵化时可能自带，合成/涅槃也有机会得到';
      }
    }
    // 觉醒徽标（觉醒页用觉醒石激活后永久亮起，与等级无关）
    const awEl = $('pet-awaken');
    if (awEl) {
      const aw = window.Pet.getAwakenState(pet);
      awEl.style.display = aw ? '' : 'none';
      if (aw) {
        // 觉醒加成：{stat, value} 扁平结构 → 中文属性名 + 百分比（spd 例外，为绝对值）
        const STAT_CN = { hp: '生命', atk: '攻击', def: '防御', spd: '速度', crit: '暴击率', critDamage: '暴击伤害', hit: '命中', dodge: '闪避', lifesteal: '吸血', pen: '穿透', dmgBonus: '伤害加成', dr: '受伤减免' };
        const ab = aw.bonus;
        let btxt = '';
        if (ab && ab.stat != null) {
          const flat = ['spd'].indexOf(ab.stat) >= 0;
          btxt = ' · ' + (STAT_CN[ab.stat] || ab.stat) + '+' + ab.value + (flat ? '' : '%');
        }
        awEl.innerHTML = '<span class="awaken-badge">觉醒 · ' + escapeHtml(aw.skillName || '') +
          '：主动技能伤害+' + Math.round((aw.damage || 0) * 100) + '%' + btxt + '</span>';
      }
    }
    /* 2026-09-16：**满级经验池 / 凝魂晶石已整条删除**（用户拍板"没必要有了"）⇒ 这一行不再显示，
     * 满级后的溢出经验直接丢弃。元素若还留在 HTML 里就保持隐藏，兼容旧存档里的 pet.expPool 字段。 */
    const poolEl = $('pet-exp-pool');
    if (poolEl) poolEl.style.display = 'none';
    /* ---------- 「下一步能变什么」：进化下一形态 + 装备摘要 ----------
     * 资料页原来只回答「现在多强」，属性区下面整块是空的，玩家得不到「接着该干嘛」。
     * 数据全部现成：Config.pet.evolution.nextStage() / stageOf() / pet.equipment —— 不新增系统。 */
    const nextEl = $('pet-next');
    if (nextEl) {
      const E = Config.pet.evolution || {};
      const stages = E.stages || [];
      const cur = (E.stageOf ? E.stageOf(pet) : 1) || 1;
      const curStage = stages.find(x => x.stage === cur) || null;
      const nx = E.nextStage ? E.nextStage(pet) : null;
      const eqCount = Object.values(pet.equipment || {}).filter(Boolean).length;
      const fmt = PetUI.fmtNum;
      const rows = [];
      if (nx) {
        const gap = Math.max(0, (nx.minLevel || 0) - (pet.level || 0));
        rows.push('<div class="pn-row">'
          + '<span class="pn-label">下一形态</span>'
          + `<span class="pn-value">${escapeHtml(curStage ? curStage.label : '当前')} <span class="lg-arrow">→</span> <b>${escapeHtml(nx.label)}</b></span>`
          + `<span class="pn-tip">${gap > 0 ? `还差 ${gap} 级（Lv.${nx.minLevel}）` : `等级已够 · Lv.${nx.minLevel}`}</span>`
          + '</div>');
        if (nx.material) {
          const haveM = (window.Materials && window.Materials.getQuantity) ? Number(window.Materials.getQuantity(nx.material)) || 0 : null;
          const needM = nx.amount || 1;
          rows.push('<div class="pn-row">'
            + '<span class="pn-label">需要</span>'
            + `<span class="pn-value">${escapeHtml(nx.material)} ×${fmt(needM)}</span>`
            + `<span class="pn-tip">${haveM != null ? (haveM >= needM ? '材料已够' : `还差 ${fmt(needM - haveM)} 个`) : escapeHtml(nx.desc || '')}</span>`
            + '</div>');
        }
      } else {
        rows.push('<div class="pn-row">'
          + '<span class="pn-label">形态</span>'
          + `<span class="pn-value">已到顶（${escapeHtml(curStage ? curStage.label : '')}）</span>`
          + '<span class="pn-tip">可走合成 / 涅槃继续变强</span>'
          + '</div>');
      }
      /* 装备：进度条 + 加成 chips 网格（原来是一行被截断的长串「攻击+177 生命+50767…」） */
      const bnTxt = getBonusText(pet);
      rows.push('<div class="pn-row">'
        + '<span class="pn-label">装备</span>'
        + `<span class="pn-value">已穿 ${eqCount}/12</span>`
        + `<span class="pn-tip">${bnTxt && bnTxt !== '无' ? '装备加成见下' : '暂无加成 · 去背包里给宠穿上'}</span>`
        + '</div>'
        + '<div class="pn-row pn-eq">' + PetUI.barHtml(eqCount, 12, eqCount >= 12 ? 'is-ok' : '') + '</div>');
      /* ⚠️ 这里**不再**铺装备加成 chips：装备加成的明细已经在右边「次级属性」那一格里
       *（那里是它的家，还有悬停浮层），铺两遍既重复又把「下一步」撑成两屏高。 */
      /* 条件 checklist（V2 要求「下一步」里带条件清单）：
       * 等级 / 进化素材 / 进化次数 三项逐条 ✓✗ —— 玩家看完就知道差哪一样，不用去别的页面对。 */
      if (nx) {
        const minLv = nx.minLevel || 1;
        const matName = nx.material;
        const needM = nx.amount || 1;
        const haveM = (matName && window.Materials && window.Materials.getQuantity) ? Number(window.Materials.getQuantity(matName)) || 0 : null;
        const conds = [{ ok: (pet.level || 1) >= minLv, text: '等级 ≥ <b>Lv.' + minLv + '</b>（当前 Lv.' + (pet.level || 1) + '）' }];
        if (matName) conds.push({ ok: haveM != null && haveM >= needM, text: '备好 <b>' + escapeHtml(matName) + ' ×' + needM + '</b>' + (haveM != null ? '（持有 ' + fmt(haveM) + '）' : '') });
        // 不加小标题（"进化条件"四个字占一整行，条件本身自己说明了自己）
        rows.push('<div class="pn-row">' + PetUI.condListHtml(conds) + '</div>');
      }
      /* 按钮不在这里 —— V2 硬性规则：五个 tab 的 CTA 按钮统一放右内容区底部 CTA 栏
       *（#profile-confirm，见 游戏.html），保证四页位置完全一致。 */
      nextEl.innerHTML = rows.join('');
    }
    // CTA 栏里的"当前出战"徽章（V2：与三个次按钮同栏）
    const ctPet = $('ctabar-pet');
    if (ctPet) ctPet.textContent = pet.name;
    const hpText = `${fmtNum(Math.round(getCurHp(pet)))}/${fmtNum(Math.round(s.hp))}`;
    if ($('pet-hp').textContent !== hpText) flashStat('pet-hp');
    $('pet-hp').textContent = hpText;
    // 属性数字走滚动（2026-09-20）：升级/进化/换装时能看到数字"涨"上去，不是硬切。
    // 滚动 + 弹一下由动效层 UI.setNum 统一提供；这里只管喂值（元素常驻 ⇒ 它有上次的值当起点）。
    ['atk', 'def', 'spd'].forEach(k => {
      const el = $('pet-' + k);
      const v = Math.round(s[k]);
      if (el.textContent !== String(v)) flashStat('pet-' + k);
      UI.setNum(el, v, { fmt: x => fmtNum(Math.round(x)) });   // 千分位（六位数以上才看得出来，但口径要统一）
    });
    // 暴击率/暴击伤害（真实属性，来自 getStats）
    const critEl = $('pet-crit');
    if (critEl) {
      const v = Math.round(s.critRate * 100);
      if (critEl.textContent !== v + '%') flashStat('pet-crit');
      UI.setNum(critEl, v, { fmt: x => Math.round(x) + '%' });
    }
    const cdEl = $('pet-critdmg');
    if (cdEl) {
      const txt = Math.round(s.critDamage * 100) + '%';
      if (cdEl.textContent !== txt) flashStat('pet-critdmg');
      cdEl.textContent = txt;
    }
    // 命中/闪避：显示数值；悬停给出「对同级怪的实际命中率」（2026-09-15 命中/闪避升格配套，
    // 治"这两个数字看不出好坏"——公式 hit/(hit+dodge)，效果取决于对手，所以必须给换算）
    const mechTip = (key, selfIsAtk) => {
      const EM = (Config.battle && Config.battle.enemyMech) || {};
      const lv = Number(pet.level) || 1;
      const mk = t => Math.round((((EM.dodgeAtRef || {})[t]) || 125) * Math.pow(lv / (EM.refLevel || 60), EM.dodgeExp || 1.6));
      const eh = Math.round((EM.hitPerLv || 8) * lv);
      const rate = (a, d) => a + d > 0 ? Math.round(Math.max(5, Math.min(95, a / (a + d) * 100))) : 5;
      if (key === 'hit') return `命中 ${Math.round(s.hit)}：对同级普通怪 ≈${rate(s.hit, mk('normal'))}%，变异怪更低；命中不够，刀会被躲掉`;
      return `闪避 ${Math.round(s.dodge)}：同级普通怪打你 ≈${rate(eh, s.dodge)}%（越深图的怪命中越高）`;
    };
    ['hit', 'dodge'].forEach(key => {
      const el = $('pet-' + key);
      if (!el) return;
      const txt = fmtNum(Math.round(s[key]));
      if (el.textContent !== txt) flashStat('pet-' + key);
      el.textContent = txt;
      if (typeof el.setAttribute === 'function') el.title = mechTip(key);
    });
    const lsEl = $('pet-ls');
    if (lsEl) {
      const txt = Math.round(s.lifesteal * 100) + '%';
      if (lsEl.textContent !== txt) flashStat('pet-ls');
      lsEl.textContent = txt;
    }
    const bonus = $('pet-bonus');
    if (bonus) {
      const equip = getBonusText(pet);
      // 格子只显示简短摘要，明细走 tooltip（#pet-bonus-pop），避免撑高框架
      const short = equip === '无' ? '无' : equip.split(' ').slice(0, 2).join(' ');
      if (bonus.textContent !== short) flashStat('pet-bonus');
      bonus.textContent = short;
      const pop = $('pet-bonus-pop');
      if (pop) {
        const coeff = window.Pet.getStatCoeff ? window.Pet.getStatCoeff(pet) : (Config.pet.statCoeff || { hp: 5, atk: 2, def: 1 });
        const growthLine = `成长贡献：生命 +${Math.round(pet.level * pet.growth * coeff.hp)} · 攻击 +${Math.round(pet.level * pet.growth * coeff.atk)} · 防御 +${Math.round(pet.level * pet.growth * coeff.def)} · 速度不受成长影响`;
        pop.innerHTML =
          `<b>${profile.role}</b>：${profile.description}<br>` +
          `${growthLine}<br>` +
          `装备贡献：${equip}<br>` +
          `暴击：${Math.round(s.critRate * 100)}% · 暴击伤害 ${Math.round(s.critDamage * 100)}%<br>` +
          `<span class="hint">攻击决定单次伤害，速度决定出手频率；高攻速宠物会压低攻击和暴击乘区。</span>`;
      }
    }
  
    // 血统被动卡片
    const blEl = $('pet-bloodline');
    if (blEl) {
      blEl.innerHTML = UI.bloodlineHtml ? UI.bloodlineHtml(pet) : '';
      const blCard = blEl.querySelector('.bloodline-card');
      if (blCard) {
        const blDesc = blCard.querySelector('.bloodline-desc');
        if (blDesc) blCard.title = blDesc.textContent;
      }
    }
  }

  /* ---------- 装备 tab 三连屏：左列属性面板（与资料页一致，id 前缀 eqp-） ---------- */
  // 更新宠物属性面板：prefix 决定元素 id 前缀（资料页 'pet-' / 装备页 'eqp-'）
  // 攻击/防御/速度保留两位小数；生命显示 当前/上限（整数）；百分比属性（暴击/命中/闪避/吸血）取整%
  function updatePetStatsPanel(pet, prefix) {
    const $id = id => document.getElementById(prefix + id);
    if (!pet) return;
    const s = getStats(pet);
    const profile = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile;
    // 属性面板左列的宠物头像（资料页 `pet-avatar` / 装备页 `eqp-avatar`，都是 158×158 肖像框）
    // —— 同资料页口径：**头像版优先**（见上面那条注释的原因），动画立绘只在大图位（战斗页）用。
    const av = $id('avatar');
    if (av) {
      if (PetSprites && PetSprites.mountAvatar(av, pet.name)) {}
      else if (PetSprites && PetSprites.mountAnimated(av, pet.name)) {}
      else av.textContent = '';
    }
    const nm = $id('name'); if (nm) nm.textContent = pet.name;
    const lv = $id('level'); if (lv) lv.textContent = 'Lv.' + pet.level;
    const eb = $id('exp-bar'); if (eb) eb.style.width = Math.min(100, (pet.exp / expNeed(pet.level)) * 100) + '%';
    const et = $id('exp-text'); if (et) et.textContent = `${fmtNum(pet.exp)}/${fmtNum(expNeed(pet.level))}`;
    const gr = $id('growth'); if (gr) gr.textContent = pet.growth.toFixed(1);
    const rn = $id('reborn');
    if (rn) {
      const rebornN = Number(pet.rebornCount) || 0;
      rn.textContent = `转生 ${rebornN} 次`;
      rn.hidden = rebornN <= 0; // 没转生过就不显示（旧版永远挂着一行"转生 0 次"= 白占地方，还像玩法入口）
    }
    const hp = $id('hp'); if (hp) hp.textContent = `${fmtNum(Math.round(getCurHp(pet)))}/${fmtNum(Math.round(s.hp))}`;
    // 攻击/防御/速度：取整显示（基底经 materialTier 相乘为小数，取整更干净）
    // 数字滚动统一走动效层（2026-09-20）：面板 id 常驻 ⇒ setNum 拿得到上次的值当起点，会自己滚
    const sn = (id, v, fmt) => { const el = $id(id); if (el) UI.setNum(el, v, fmt ? { fmt } : undefined); };
    ['atk', 'def', 'spd'].forEach(k => sn(k, Math.round(s[k]), x => fmtNum(Math.round(x))));
    sn('crit', Math.round(s.critRate * 100), x => Math.round(x) + '%');
    sn('critdmg', Math.round(s.critDamage * 100), x => Math.round(x) + '%');
    // 命中/闪避是固定数值（非百分比），直接显示数值；吸血是百分比
    sn('hit', Math.round(s.hit), x => fmtNum(Math.round(x)));
    sn('dodge', Math.round(s.dodge), x => fmtNum(Math.round(x)));
    const lsEl = $id('ls'); if (lsEl) lsEl.textContent = Math.round(s.lifesteal * 100) + '%';
    const bn = $id('bonus'); if (bn) {
      const equip = getBonusText(pet);
      bn.textContent = equip === '无' ? '无' : equip.split(' ').slice(0, 2).join(' ');
      const pop = $id('bonus-pop');
      if (pop) {
        const coeff = window.Pet.getStatCoeff ? window.Pet.getStatCoeff(pet) : (Config.pet.statCoeff || { hp: 5, atk: 2, def: 1 });
        const growthLine = `成长贡献：生命 +${Math.round(pet.level * pet.growth * coeff.hp)} · 攻击 +${Math.round(pet.level * pet.growth * coeff.atk)} · 防御 +${Math.round(pet.level * pet.growth * coeff.def)} · 速度不受成长影响`;
        pop.innerHTML =
          `<b>${profile.role}</b>：${profile.description}<br>` +
          `${growthLine}<br>` +
          `装备贡献：${equip}<br>` +
          `暴击：${Math.round(s.critRate * 100)}% · 暴击伤害 ${Math.round(s.critDamage * 100)}%<br>` +
          `<span class="hint">攻击决定单次伤害，速度决定出手频率；高攻速宠物会压低攻击和暴击乘区。</span>`;
      }
    }
  }
  // 装备 tab 三连屏：渲染左列完整属性面板（eqp- 前缀）
  function renderEquipPetStats() {
    updatePetStatsPanel(getActivePet(), 'eqp-');
  }

  /* ---------- 宠物栏（切换出战 / 上架） ---------- */
  let petSearchQ = '';
  let petFilterMode = 'all';
  function renderPetList() {
    const list = $('pet-list');
    list.innerHTML = '';
    // 出战宠可能为空（刚被卖掉/上架），不能拿它当必然存在的前提，否则整个宠物页渲染会崩
    const active = getActivePet();
    const activeId = active ? active.id : null;
    const Evolve = window.Evolve;
    let pets = getPets();
    // 搜索过滤
    if (petSearchQ) pets = pets.filter(p => p.name && p.name.includes(petSearchQ));
    // 筛选
    if (petFilterMode === 'evolvable' && Evolve && Evolve.canEvolve) {
      pets = pets.filter(p => Evolve.canEvolve(p));
    } else if (petFilterMode === 'equipped') {
      pets = pets.filter(p => Object.values(p.equipment || {}).filter(Boolean).length > 0);
    }
    /* 统一宠物卡（PetUI.renderList）—— 5 个 tab 同一套：40px 圆头像 + 两行。
     * 资料页只锁「在集市出售中」的宠（点它出战会被拦），其余一律能点：换出战没有任何代价。
     * 卡片上的血统说明撤了（两行卡放不下）—— 悬停详情里有（bindPetTip 的 petTipHtml）。 */
    PetUI.renderList(list, pets, {
      selectedId: activeId,
      badgeOf: p => (p.id === activeId ? '出战' : ''),
      lockOf: p => (p.cloudId && window.Market && Market.isListed && Market.isListed(p.cloudId))
        ? '在集市出售中 · 先在「市集 · 我的上架」取回' : null,
      extraOf: p => (p.id === activeId ? '<span class="lg-on">当前出战</span>' : ''),
      emptyHtml: petSearchQ || petFilterMode !== 'all'
        ? '没有符合条件的宠物（换个筛选看看）'
        : '还没有宠物：去「背包 · 素材蛋」孵化一只',
      onPick: (pet) => {
        setActive(pet.id);
        addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 8.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"/><path d="M18.8 10.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M12 13.2c-3 0-4.8 1.7-4.8 3.9 0 2.4 1.8 4.4 4.8 4.4s4.8-2 4.8-4.4c0-2.2-1.8-3.9-4.8-3.9z"/></svg> ${pet.name} 出战！`, 'battle');
        UI.renderAll();
      }
    });
    // 绑定搜索框和筛选下拉（只绑一次）
    const searchEl = $('pet-search');
    const filterEl = $('pet-filter');
    if (searchEl && !searchEl.__bound) {
      searchEl.__bound = true;
      searchEl.addEventListener('input', () => { petSearchQ = searchEl.value.trim(); renderPetList(); });
    }
    if (filterEl && !filterEl.__bound) {
      filterEl.__bound = true;
      filterEl.addEventListener('change', () => { petFilterMode = filterEl.value; renderPetList(); });
    }
  }

  /* ---------- 当前装备（12 槽沿宠物立绘四边环绕） ---------- */
  function renderEquipSlots() {
    renderEquipPetStats(); // 三连屏左列属性面板（与资料页一致，eqp- 前缀）
    const wrap = $('equip-slots');
    if (!wrap) return;
    wrap.innerHTML = '';
    const pet = getActivePet();
    if (!pet) return;
    const orbit = document.createElement('div');
    orbit.className = 'equip-orbit';
    const center = document.createElement('div');
    center.className = 'equip-orbit-center';
    center.innerHTML = '<div class="equip-orbit-art" id="equip-orbit-art"></div><div class="equip-orbit-name">' + escapeHtml(pet.name) + '</div>';
    orbit.appendChild(center);
    const groups = { output: ['武器', '戒指', '项链'], defense: ['头盔', '护甲', '盾牌'], mobility: ['靴子', '腰带', '斗篷'], utility: ['饰品', '护符', '徽章'] };
    const groupOf = (slot) => Object.keys(groups).find(k => groups[k].includes(slot)) || 'utility';
    const slots = Object.values(groups).flat();
    slots.forEach((slot, index) => {
      const eq = pet.equipment && pet.equipment[slot];
      const div = document.createElement('div');
      const rarity = eq ? rarityOf(eq) : null;
      div.className = 'equip-slot equip-slot-' + (index + 1) + (eq ? ' equipped rarity-' + ((eq.rarity && eq.rarity.id) || 'white') : ' empty');
      div.dataset.group = groupOf(slot);
      div.innerHTML = `<div class="slot-label">${escapeHtml(slot)}</div><div class="slot-item"></div>`;
      const item = div.querySelector('.slot-item');
      if (eq) {
        item.style.color = rarity.color;
        /* 格子里只放「图标 + 装备名」。
         * 旧写法还塞了一整行 describeItem（部位｜基底｜全部词缀）—— 那行必定被 ellipsis 截成半句话，
         * 既挤又没信息量；详情本来就在右侧面板/悬停里（2026-09-14 用户反馈"左边挺挤的"）。 */
        item.innerHTML = `<span class="slot-icon" aria-hidden="true">${(window.UI && window.UI.EQUIP_ICON ? window.UI.EQUIP_ICON[slot] : null) || eq.icon || '◆'}</span><span class="slot-copy"><span class="slot-name">${escapeHtml(eq.name)}</span></span>`;
        // 单击槽位 → 右侧面板显示穿戴详情（可脱下）；不再挂 hover 浮层（根治遮挡）
        item.onclick = (e) => { e.stopPropagation(); bagActiveEqId = eq.id; if (UI.renderBagEqDetail) UI.renderBagEqDetail(eq); };
        const takeBtn = document.createElement('button');
        takeBtn.className = 'btn-sm ghost slot-unequip';
        takeBtn.textContent = '脱下';
        takeBtn.title = '放回背包（也可以直接双击这个槽位）';
        takeBtn.onclick = (e) => { e.stopPropagation(); const taken = unequip(pet, slot); if (taken) { addLog(`脱下 ${taken.name}，放回背包`); UI.renderAll(); } };
        item.appendChild(takeBtn);
        // 双击槽位 = 脱下（2026-09-14 用户要的快捷操作）
        div.ondblclick = (e) => { e.stopPropagation(); takeBtn.onclick(e); };
        div.title = '单击看详情 · 双击脱下';
      } else {
        item.textContent = ''; // 空槽不再写"空槽"两个字（12 格里 9 格是废话，一格两行才是"挤"的主因）
        div.title = '空装备槽 · 从背包里穿装备进来';
      }
      orbit.appendChild(div);
    });
    wrap.appendChild(orbit);
    // 装备环绕中心的宠物位（`.equip-orbit-art` = **220px 圆形框**、overflow:hidden）
    // —— 圆框里放全身立绘，头脚会被圆弧切掉 ⇒ 这里也**头像版优先**。
    const art = orbit.querySelector('#equip-orbit-art');
    if (art) {
      if (typeof PetSprites !== 'undefined' && PetSprites.mountAvatar(art, pet.name)) {}
      else if (typeof PetSprites !== 'undefined' && PetSprites.mountAnimated(art, pet.name)) {}
      else art.textContent = '';
    }
  }

  /* ---------- 换装背包（装备 tab：给当前出战宠物穿上背包里的装备，悬停看属性面板） ---------- */
  // 换装背包筛选状态（模块级，避免 renderAll 高频重建时重置）
  const equipInvFilter = { slot: 'all', rarity: 'all', baseTier: 'all', affixTier: 'all', affixType: 'all' };
  let bagActiveEqId = null; // 背包窗口「装备」子页当前选中（右侧详情+打造）
  const EQUIP_INV_SLOTS = window.Equipment.SLOTS || [];

  function renderPetEquipInv() {
    renderEquipPetStats(); // 换装/穿装备后属性面板实时刷新
    const box = $('pet-equip-inv');
    if (!box) return;
    box.innerHTML = '';
    const pet = getActivePet();
    const inv = getInventory ? getInventory() : [];

    // 筛选工具条（紧凑，三连屏右列空间有限）
    const bar = document.createElement('div');
    bar.className = 'equip-inv-filter';
    const mkSel = (label, options, cur, onSet) => {
      const s = document.createElement('select');
      s.className = 'bag-filter-sel';
      s.setAttribute('aria-label', label);
      s.innerHTML = options.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
      s.onchange = () => { onSet(s.value); renderPetEquipInv(); };
      return s;
    };
    bar.appendChild(mkSel('部位', [
      ['all', '部位全部'], ...EQUIP_INV_SLOTS.map(s => [s, s])
    ], equipInvFilter.slot, v => { equipInvFilter.slot = v; }));
    bar.appendChild(mkSel('稀有度', [
      ['all', '品质全部'], ['gold', '金'], ['blue', '蓝'], ['white', '白']
    ], equipInvFilter.rarity, v => { equipInvFilter.rarity = v; }));
    bar.appendChild(mkSel('底材T', [
      ['all', '底材T'], ...['1', '2', '3', '4', '5'].map(t => [t, 'T' + t])
    ], equipInvFilter.baseTier, v => { equipInvFilter.baseTier = v; }));
    bar.appendChild(mkSel('词缀T', [
      ['all', '词缀T'], ...['1', '2', '3', '4', '5'].map(t => [t, '含T' + t])
    ], equipInvFilter.affixTier, v => { equipInvFilter.affixTier = v; }));
    bar.appendChild(mkSel('词缀类型', [
      ['all', '词缀类型'], ...(window.Equipment.AFFIX_POOL || []).map(a => [a.type, a.label])
    ], equipInvFilter.affixType, v => { equipInvFilter.affixType = v; }));
    box.appendChild(bar);

    // 过滤逻辑（与独立背包页一致）
    const highestAffixTier = eq => {
      let best = Infinity;
      for (const a of flattenAffixes(eq.affixes)) best = Math.min(best, a.tier || 5);
      return best === Infinity ? 5 : best;
    };
    const hasAffixType = (eq, type) => flattenAffixes(eq.affixes).some(a => a.type === type);
    const list = inv.filter(eq => {
      if (equipInvFilter.slot !== 'all' && eq.slot !== equipInvFilter.slot) return false;
      if (equipInvFilter.rarity !== 'all' && (!eq.rarity || eq.rarity.id !== equipInvFilter.rarity)) return false;
      if (equipInvFilter.baseTier !== 'all' && Number(eq.materialTier) !== Number(equipInvFilter.baseTier)) return false;
      if (equipInvFilter.affixTier !== 'all' && highestAffixTier(eq) > Number(equipInvFilter.affixTier)) return false;
      if (equipInvFilter.affixType !== 'all' && !hasAffixType(eq, equipInvFilter.affixType)) return false;
      return true;
    });

    if (!inv.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '背包空空，去挂机捡装备或到「装备打造」页做一件';
      box.appendChild(empty);
      return;
    }
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '没有符合条件的装备';
      box.appendChild(empty);
      return;
    }
    for (const eq of list) {
      const row = document.createElement('div');
      row.className = 'quick-eq q-' + (eq.rarity && eq.rarity.id ? eq.rarity.id : 'white') + (bagActiveEqId === eq.id ? ' selected' : '');
      const name = document.createElement('span');
      name.className = 'qe-name';
      name.innerHTML = `<span class="qe-icon" aria-hidden="true">${(window.UI && window.UI.EQUIP_ICON ? window.UI.EQUIP_ICON[eq.slot] : null) || eq.icon || '◆'}</span><span class="qe-copy">${escapeHtml(eq.name)}</span>`;
      name.style.color = rarityOf(eq).color;
      row.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'qe-meta';
      meta.textContent = `${rarityOf(eq).label}·T${eq.tier}`;
      row.appendChild(meta);
      const btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = '穿上';
      btn.onclick = (e) => {
        e.stopPropagation();
        const res = equipItem(pet, eq.id);
        if (res) {
          addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ ${pet.name} 装备了 ${res.equipped.name}（${describeItem(res.equipped)}）`);
          UI.renderAll();
        } else {
          showToast('❌ 无法穿上', '可能是槽位已满或等级不符');
        }
      };
      row.appendChild(btn);
      // 点卡片 → 右侧面板详情+打造（选中高亮；不再挂 hover 浮层，根治遮挡）
      row.onclick = () => {
        bagActiveEqId = eq.id;
        renderPetEquipInv();
        if (UI.renderBagEqDetail) UI.renderBagEqDetail(eq);
      };
      box.appendChild(row);
    }
  }

  /* ---------- 装备/孵化面板（2026-09-10 墓碑清理，已删除）----------
   * 原这里的「宠物蛋孵化面板」（renderEggPanel）与「装备直达 pane」的 tab 按钮早已移除，
   * pane 变成无 tab 高亮的孤儿页（引导「去孵化」跳过去就是它 → 用户拍板删）。
   * 正主入口：孵化 = 背包浮窗 · 素材蛋（UI.openBagEggs）；装备 = 背包浮窗 · 装备（switchPage('equip')）。 */

  /* ---------- 宠物页顶部 tab 切换（资料 / 进化 / 合成 / 涅槃 / 觉醒） ---------- */
  function initPetTabs() {
    /* 底部 CTA 栏里的跳转按钮（资料页的去进化/去合成/去涅槃）：事件委托绑一次。
     * ⚠️ 必须在下面的 `__petTabBound` 早退之前绑 —— 否则第二次进宠物页就绑不上了。 */
    const cta = $('profile-confirm');
    if (cta && !cta.__bound) {
      cta.__bound = true;
      cta.addEventListener('click', e => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-goto-tab]') : null;
        if (!btn) return;
        const tab = document.querySelector('.pet-tab[data-pet-tab="' + btn.dataset.gotoTab + '"]');
        if (tab) tab.click();
      });
    }
    const tabs = $('pet-tabs');
    if (!tabs || tabs.__petTabBound) return;
    tabs.__petTabBound = true;
    tabs.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('.pet-tab');
      if (!btn) return;
      const name = btn.dataset.petTab;
      tabs.querySelectorAll('.pet-tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.pet-tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.petPane === name));
      // 切 tab 时收起背包浮窗（它带全屏遮罩，开着会盖住宠物页——历史上的"层级压住"根因）
      if (window.UI && UI.closeBagWindow) UI.closeBagWindow();
    });
  }

  /* ---------- 对外 API（宠物页） ---------- */
  // 养成门槛的唯一读法（合成/涅槃/觉醒三个 tab 的角标与页面空态共用，
  // 免得每个页面各拼一份条件 —— 改门槛只动 petTabGate 一处）
  UI.petTabGate = petTabGate;
  UI.renderPetPanel = renderPetPanel;
  UI.renderPetList = renderPetList;
  UI.showPetTip = showPetTip;
  UI.hidePetTip = hidePetTip;
  UI.bindPetTip = bindPetTip;
  UI.updatePetStatsPanel = updatePetStatsPanel;
  UI.renderEquipPetStats = renderEquipPetStats;
  UI.renderEquipSlots = renderEquipSlots;
  UI.renderPetEquipInv = renderPetEquipInv;
  UI.initPetTabs = initPetTabs;

  /* ---------- PetUI 共享 API（供 ui-pet-evolve / ui-pet-merge / ui-pet-synth 使用） ----------
   * 宠物血脉特质：pet.traits = [{ id, tier }]，T1~T3（T1 最强最稀有）；Config.petTraits 为配置表。
   * traitsHtml：宠物卡/市场/图鉴共用的特质胶囊渲染（带 T 阶色与数值）。
   * traitInheritLine：合成/涅槃预览概率说明（读 Config.traitInherit / traitNirvana 真实值）。 */
  const PetUI = window.PetUI || (window.PetUI = {});
  // 特质 T 阶颜色（与装备词缀惯例一致：T1 最好 → 暗金）
  const TRAIT_TIER_COLORS = { 1: '#c9a86a', 2: '#b99a6a', 3: '#7fae7f' };
  function traitsHtml(petLike) {
    const arr = petLike && petLike.traits;
    if (!Array.isArray(arr) || !arr.length) return '';
    const defs = (window.Config && window.Config.petTraits) || {};
    return '<div class="trait-row">' + arr.map(function (t) {
      const id = (t && t.id) || '?';
      const tier = (t && t.tier) || 1;
      const d = defs[id] || {};
      const name = d.label || id;
      const v = (d.values && d.values[tier]);
      const isFlat = ['hit', 'dodge', 'spd'].indexOf(d.type) >= 0;
      const eff = (v != null) ? '<em>' + escapeHtml(name) + '+' + v + (isFlat ? '' : '%') + '</em>' : '';
      const color = TRAIT_TIER_COLORS[tier] || '#9a9a9a';
      // b=特质名(id)，em=属性+值（如 嗜血 → <b>嗜血</b><em>吸血+8%</em>）
      return '<span class="trait-pill t' + tier + '" style="border-color:' + color + '">' +
        '<b style="color:' + color + '">' + escapeHtml(id) + '</b><i>T' + tier + '</i>' + eff + '</span>';
    }).join('') + '</div>';
  }
  /* ---------- 终形态 / 终形态主动技能（共享给进化页与宠物资料页）----------
   * 2026-09-22 内测 🟠11「主动技能没说明」+ 🟠14「两条分支看不出区别」都需要它，
   * 所以只在这（PetUI）写一份，进化页调它 —— 别在两个页面各拼一份。
   * 🔴 取证事实：**两条分支的数值本来完全一样**（速度/成长/门槛全同），
   *   真正的差异只有两样：① 最终长成哪个形态 ② 那个终形态的**主动技能**。
   *   ⇒ 不造假差异，把这两样摆出来（进化页按技能选分支）。
   * ⚠️ 取**终形态技能的原值（满档）**，不用 `skillOf(一阶名)`：后者返回 I 档缩放值，会误导玩家。 */
  function finalFormOf(name) {
    const tree = (window.Config && window.Config.pet && window.Config.pet.evolution && window.Config.pet.evolution.tree) || {};
    let cur = name, next = tree[cur], guard = 0;
    while (Array.isArray(next) && next.length && guard++ < 12) { cur = next[0].to; next = tree[cur]; }
    return cur;
  }
  function finalSkillOf(name) {
    const E = window.Config && window.Config.pet && window.Config.pet.evolution;
    return ((E && E.activeSkills) || {})[finalFormOf(name)] || null;
  }
  // 技能效果一句话（概率 / 倍率 / 附加真伤），终形态满档口径
  function skillEffectLine(sk) {
    if (!sk) return '';
    const chance = Math.round((sk.triggerChance || 0) * 100);
    const mult = Math.round((sk.damageMultiplier || 1) * 100);
    const extra = sk.maxHpDamageRate ? ` + 目标最大生命 ${Math.round(sk.maxHpDamageRate * 100)}%` : '';
    return `${chance}% 概率打出 ${mult}% 伤害${extra}`;
  }

  function traitInheritLine(main, sub, type) {
    const cfg = (window.Config && window.Config.traitInherit) || {};
    const subTraits = (sub && sub.traits) || [];
    const defs = (window.Config && window.Config.petTraits) || {};
    const names = subTraits.map(function (t) { return (defs[t.id] ? defs[t.id].label : t.id); }).join('、');
    if (!Array.isArray(subTraits) || !subTraits.length) {
      return '<div class="es-preview-row"><span class="trait-none">副宠无血脉特质，无可继承</span></div>';
    }
    const giveP = type === 'nirvana'
      ? Math.round(((window.Config.traitNirvana && window.Config.traitNirvana.implantChance != null ? window.Config.traitNirvana.implantChance : 0.3)) * 100)
      : Math.round(((cfg.synthGive != null ? cfg.synthGive : 0.4)) * 100);
    const upP = Math.round(((cfg.up != null ? cfg.up : 0.2)) * 100);
    const cap = (cfg.cap != null ? cfg.cap : 3);
    const label = type === 'nirvana' ? '涅槃植入' : '合成继承';
    if (type === 'synth') {
      return '<div class="es-preview-row">' + label + '：主宠词条全保留（' + upP + '% 概率升档，不会丢不会降）；副宠特质（' + escapeHtml(names) + '）' +
        giveP + '% 概率嫁接（主宠成长≥' + (cfg.growthMin != null ? cfg.growthMin : 60) + ' 额外 +' +
        Math.round((cfg.growthBonus != null ? cfg.growthBonus : 0.1) * 100) + '%；上限 ' + cap + ' 条）</div>';
    }
    return '<div class="es-preview-row">' + label + '：副宠特质（' + escapeHtml(names) + '）各 ' + giveP +
      '% 概率植入（同类型取高阶；上限 ' + cap + ' 条）；用锁魂玉可指定一条 100% 植入</div>';  
  }
  /* ============================================================
   * 宠物军团组件库（2026-09-22）—— 5 个 tab 共用同一套
   *
   * 为什么放在这里：本文件就是"宠物页共享 API"的家（iconHtml / tooltip / 特质胶囊），
   * 进化/合成/涅槃/觉醒四页在 游戏.html 里**后加载**、直接取 `PetUI.*` —— 天然能拿到。
   * ⛔ 别在各页面里再抄一份卡片/按钮/进度条：抄了就是第二份事实源，早晚两边长得不一样
   *   （这正是 2026-09-22 那次评审里"5 个 tab 同类组件各式各样"的成因）。
   * 样式全部在 `css/pet-legion.css`（挂在 #tab-pet 之下）。
   * ============================================================ */

  /* 千分位（191,531）。全站数值统一口径；成长值这类小数字不用它，免得看起来像另一个量级。 */
  function fmtNum(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return v.toLocaleString('en-US');
  }
  // 当前阶（1~5）：判定只在 core，UI 不重算
  function stageOf(pet) {
    return (window.Pet && window.Pet.getEvolveStage) ? window.Pet.getEvolveStage(pet) : ((pet.evolveTimes || 0) + 1);
  }
  /* 阶段总数：**从 config 的 stages 表推**，别再硬写 5（改阶段表时界面要跟着走）。
   * （原来这个函数只长在 ui-pet-evolve.js 里，卡片要显示 x/5 阶，就上移到共享库来 —— 唯一一份。） */
  function stageTotal() {
    return (((Config.pet && Config.pet.evolution && Config.pet.evolution.stages) || []).length) || 5;
  }
  function isGodOf(pet) {
    return (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(pet) : !!(pet && pet.isGodPet);
  }
  const equipCountOf = pet => Object.values((pet && pet.equipment) || {}).filter(Boolean).length;

  /* 统一宠物卡：两行（① 名称 + 等级 ② 成长 / 阶数 / 转生 / 装备）+ 成长微条。
   * opts.selectedId         选中的宠 id（高亮）
   * opts.onPick(pet)        点选回调
   * opts.lockOf(pet)        返回"为什么不能选"，非空 → 置灰 + 写明原因（点它只提示，不选）
   * opts.badgeOf(pet)       左上角小徽标文字（如"出战"）
   * opts.extraOf(pet)       追加的第三行 HTML（如"接近条件：差 1 级"）
   * 返回 DOM 元素（⚠️ 必须 createElement + onclick：守值 vtest_nirvana_ui 依赖 list.children[0].onclick） */
  function listCard(pet, opts) {
    const o = opts || {};
    const card = document.createElement('div');
    const lock = o.lockOf ? o.lockOf(pet) : null;
    const sel = !!o.selectedId && pet.id === o.selectedId;
    const god = isGodOf(pet);
    card.className = 'pet-card' + (sel ? ' active' : '') + (god ? ' pet-card--god' : '') + (lock ? ' is-locked' : '');
    const badge = o.badgeOf ? o.badgeOf(pet) : '';
    const reborn = Number(pet.rebornCount) || 0;
    const gbar = Math.max(4, Math.min(100, Math.round(pet.growth || 0)));
    card.innerHTML =
      (god ? '<div class="pet-card-god-badge">神</div>' : '')
      + (badge ? '<div class="pet-card-badge">' + escapeHtml(badge) + '</div>' : '')
      + '<div class="icon">' + iconHtml(pet.name) + '</div>'
      + '<div class="card-info">'
      +   '<div class="lg-row1"><span class="pname">' + escapeHtml(pet.name) + '</span>'
      +     '<span class="lg-lv">Lv.' + (pet.level || 1) + '</span></div>'
      +   '<div class="lg-row2">'
      +     '<span>成长 <b>' + (pet.growth || 0).toFixed(1) + '</b></span>'
      +     '<span>' + stageOf(pet) + '/' + stageTotal() + ' 阶</span>'
      +     (reborn ? '<span>转生 <b>' + reborn + '</b></span>' : '')
      +     '<span>装备 <b>' + equipCountOf(pet) + '/12</b></span>'
      +   '</div>'
      +   (o.extraOf ? o.extraOf(pet) : '')
      +   (lock ? '<span class="lg-why">' + escapeHtml(lock) + '</span>' : '')
      +   '<div class="growth-bar"><i style="width:' + gbar + '%"></i></div>'
      + '</div>';
    bindPetTip(card, pet);
    card.onclick = () => {
      if (lock) { showToast('不能选这只', lock); return; }
      if (o.onPick) o.onPick(pet);
    };
    return card;
  }

  /* 渲染一整个列表：可用在前、锁定的排后面（玩家第一眼看到的永远是"能用的"）。
   * emptyHtml：列表为空时的占位（各页自己写"这是什么玩法/还差什么"）。 */
  function renderList(container, pets, opts) {
    if (!container) return;
    const o = opts || {};
    container.innerHTML = '';
    const list = pets || [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'lg-empty-hint';
      empty.innerHTML = o.emptyHtml || '还没有宠物';
      container.appendChild(empty);
      return;
    }
    const rank = p => (o.lockOf && o.lockOf(p) ? 1 : 0);
    list.slice().sort((a, b) => rank(a) - rank(b)).forEach(p => container.appendChild(listCard(p, o)));
  }

  /* 步骤提示（选主宠 → 选方向 → 确认）：已完成打勾 / 当前高亮 / 未做置灰。
   * steps: [{ label, state: 'done' | 'cur' | 'todo' }] */
  function stepsHtml(steps) {
    return '<div class="lg-steps">' + stepsItems(steps) + '</div>';
  }
  function stepsItems(steps) {
    return (steps || []).map(s => {
      const st = s.state === 'done' ? ' is-done' : s.state === 'cur' ? ' is-cur' : '';
      return '<span class="lg-step' + st + '">' + escapeHtml(s.label) + '</span>';
    }).join('');
  }
  // 把步骤条填进一个已有的容器（页面里预留的空 div，省得各页再拼一遍字符串）
  function stepsInto(el, steps) {
    if (el && el.innerHTML != null) el.innerHTML = stepsItems(steps);
  }

  /* 进度条（x/y 必须配它，禁止裸文本）。cls 可传 'is-ok' / 'lg-bar--sm' */
  function barHtml(have, need, cls) {
    const n = Math.max(1, Number(need) || 1);
    const pct = Math.max(0, Math.min(100, (Number(have) || 0) / n * 100));
    return '<span class="lg-bar' + (cls ? ' ' + cls : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></span>';
  }
  /* 一行进度：标签 + 条 + 数值 */
  function progHtml(label, have, need) {
    const h = Number(have) || 0, n = Number(need) || 0;
    const ok = h >= n && n > 0;
    return '<div class="lg-prog' + (ok ? ' is-ok' : '') + '">'
      + '<span class="k">' + escapeHtml(label) + '</span>'
      + barHtml(h, n, ok ? 'is-ok' : '')
      + '<span class="v">' + fmtNum(h) + ' / ' + fmtNum(n) + '</span></div>';
  }
  /* 属性加成 chips（两列网格）：rows = [{ label, val, flat }]，flat=true 表示绝对值不加 % */
  function chipsHtml(rows, cols) {
    return '<div class="lg-chips' + (cols === 3 ? ' lg-chips--3' : '') + '">' + (rows || []).map(r =>
      '<span class="lg-chip' + (r.flat ? ' is-flat' : '') + '"><span>' + escapeHtml(r.label) + '</span><b>'
      + escapeHtml(String(r.val)) + '</b></span>').join('') + '</div>';
  }
  /* 条件清单（逐项 ✓/✗）：rows = [{ ok, text }] —— 涅槃的主宠/副宠条件、资料页「下一步」的进化条件共用。
   * 规则用它拆成可勾选的项目，玩家不用读一大段话才知道差哪一项。 */
  function condListHtml(rows) {
    return '<div class="lg-check">' + (rows || []).map(r =>
      '<div' + (r.ok ? ' class="ok"' : '') + '>' + r.text + '</div>').join('') + '</div>';
  }

  /* 自定义下拉（替换原生 <select>）：原生框在暗色面板里是系统灰、和整体割裂。
   * opts = [{ value, label, disabled }]，返回 HTML；调用方拿到后自己绑 .lg-select__opt 的点击（见 bindSelect）。 */
  function selectHtml(id, opts, cur) {
    const list = opts || [];
    const curOpt = list.find(o => String(o.value) === String(cur)) || list[0] || { label: '—' };
    return '<div class="lg-select" id="' + id + '">'
      + '<button type="button" class="lg-select__btn"><span class="lg-select__label">' + escapeHtml(curOpt.label) + '</span><span class="caret">▾</span></button>'
      + '<div class="lg-select__list">' + list.map(o =>
        '<div class="lg-select__opt' + (String(o.value) === String(curOpt.value) ? ' on' : '') + (o.disabled ? ' disabled' : '') + '" data-v="' + escapeHtml(String(o.value)) + '">'
        + escapeHtml(o.label) + '</div>').join('') + '</div></div>';
  }
  /* 绑自定义下拉：scope 里找 #id，点按钮开合、点选项回调 onPick(value)。
   * ⚠️ 测试桩的 querySelector 返回空壳、querySelectorAll 返回 [] ⇒ 这里必须做能力判断，不能直接 .forEach。 */
  function bindSelect(scope, id, onPick) {
    if (!scope || !scope.querySelector) return;
    const box = scope.querySelector('#' + id);
    if (!box) return;
    const btn = box.querySelector ? box.querySelector('.lg-select__btn') : null;
    if (btn) btn.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); box.classList.toggle('open'); };
    const opts = (box.querySelectorAll ? box.querySelectorAll('.lg-select__opt') : []) || [];
    opts.forEach(o => {
      o.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (o.className && o.className.indexOf('disabled') >= 0) return;
        box.classList.remove('open');
        if (onPick) onPick(o.dataset ? o.dataset.v : o.getAttribute('data-v'));
      };
    });
  }

  /* 培育记录（本机、最多 5 条）：
   * 进化 / 培育这类"喂素材换成长"的操作，事后想回看"我这只宠到底吃了多少"。
   * ⚠️ 只写 localStorage（纯前端记录），**不写宠物的等级/经验** —— 托管期间客户端不许碰真账。 */
  const REC_KEY = 'fof_pet_records';
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(REC_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function pushRecord(key, text, delta) {
    if (!key) return;
    try {
      const all = loadRecords();
      const arr = all[key] || [];
      arr.unshift({ t: Date.now(), text: String(text || ''), d: String(delta || '') });
      all[key] = arr.slice(0, 5);
      localStorage.setItem(REC_KEY, JSON.stringify(all));
    } catch (e) { /* 隐私模式/测试桩：记不下不影响操作本身 */ }
  }
  function recordsHtml(key, title) {
    const arr = (loadRecords()[key]) || [];
    if (!arr.length) return '';
    return '<div class="lg-head">' + escapeHtml(title || '培育记录') + '<span class="hint">最近 ' + arr.length + ' 次 · 只记在本机</span></div>'
      + '<div class="lg-records">' + arr.map(r => {
        let hh = '';
        try {
          const d = new Date(r.t);
          hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { hh = ''; }
        return '<div class="lg-rec"><span class="t">' + hh + '</span><span>' + escapeHtml(r.text) + '</span>'
          + (r.d ? '<span class="d">' + escapeHtml(r.d) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  }

  /* 不可逆操作的二次确认 —— 复用**项目唯一的那块确认面板**（装备分解用的 #salvage-modal）。
   * ⛔ 不新建第二个确认框：同一件事两份实现 = 迟早两边行为不一致。
   * 面板不可用时退回 window.confirm；测试桩里两者都没有 → 直接执行（与 salvageConfirm 同口径）。 */
  function confirmIrreversible(opts) {
    const o = opts || {};
    const run = () => { try { if (o.onOk) o.onOk(); } catch (e) { console.error('[pet] 确认后执行失败', e); } };
    if (typeof UI.salvageConfirm === 'function') {
      UI.salvageConfirm({
        title: o.title, bodyHtml: o.bodyHtml, okLabel: o.okLabel,
        fallbackText: o.fallbackText, onOk: run
      });
      return;
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(o.fallbackText || '确认执行？此操作不可撤销。')) run();
      return;
    }
    run();
  }

  PetUI.fmtNum = fmtNum;
  PetUI.stageOf = stageOf;
  PetUI.stageTotal = stageTotal;
  PetUI.isGodOf = isGodOf;
  PetUI.equipCountOf = equipCountOf;
  PetUI.listCard = listCard;
  PetUI.renderList = renderList;
  PetUI.stepsHtml = stepsHtml;
  PetUI.stepsItems = stepsItems;
  PetUI.stepsInto = stepsInto;
  PetUI.barHtml = barHtml;
  PetUI.progHtml = progHtml;
  PetUI.chipsHtml = chipsHtml;
  PetUI.condListHtml = condListHtml;
  PetUI.selectHtml = selectHtml;
  PetUI.bindSelect = bindSelect;
  PetUI.confirmIrreversible = confirmIrreversible;
  PetUI.pushRecord = pushRecord;
  PetUI.recordsHtml = recordsHtml;
  PetUI.iconHtml = iconHtml;
  PetUI.petTipHtml = petTipHtml;
  PetUI.showPetTip = showPetTip;
  PetUI.hidePetTip = hidePetTip;
  PetUI.bindPetTip = bindPetTip;
  PetUI.flashStat = flashStat;
  PetUI.traitsHtml = traitsHtml;
  PetUI.traitInheritLine = traitInheritLine;
  PetUI.finalFormOf = finalFormOf;
  PetUI.finalSkillOf = finalSkillOf;
  PetUI.skillEffectLine = skillEffectLine;
  UI.traitsHtml = traitsHtml;
})();
