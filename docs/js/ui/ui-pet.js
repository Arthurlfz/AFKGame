/* ============================================================
 * ui/ui-pet.js —— 宠物页 UI
 * 职责：
 *  1. 出战宠物面板（属性含装备加成）
 *  2. 宠物列表（切换出战 / 融合入口）
 *  3. 当前装备（点击脱下）
 *  4. 融合条件说明 + 融合面板（选副宠 → 预览 → 确认）
 * 依赖：pet / equipment / market / merge（只读查询与流程接口）；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const { getActivePet, getPets, getStats, getCurHp, getBonusText, expNeed, setActive } = window.Pet;
  const { SLOTS, unequip, describeItem, rarityOf, equipItem, getInventory, flattenAffixes } = window.Equipment;
  const Materials = window.Materials;
  const Market = window.Market;
  const Merge = window.Merge;
  // Evolve 模块在生产环境必加载（游戏.html 脚本顺序保证）；这里做降级保护，避免缺模块时宠物面板白屏
  // 注意：openEvolvePanel/closeEvolvePanel 属于 UI 层（window.UI），不属于 Evolve，勿在此写死代码
  const Evolve = window.Evolve || {
    canEvolve: () => false, getEvolutionRoutes: () => [], getRouteMaterial: () => null
  };
  const PetSprites = window.PetSprites;

  // 宠物头像 HTML（小尺寸用头像版）：有头像图则 <img>，否则回退 emoji。
  // inline=true → 行内小头像（跟文字齐平，用于「路线：<头像> 名字」这类文案里）；
  // 不传 → 块级，尺寸由所在容器的 CSS 决定（img.pet-avatar-sprite 有兜底尺寸，不会按原图炸开）。
  function iconHtml(name, emoji, inline) {
    const p = PetSprites && PetSprites.avatarOf(name);
    return p ? `<img class="pet-avatar-sprite${inline ? ' inline' : ''}" src="${p}" alt="">` : emoji;
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
    tip.innerHTML = petTipHtml(pet);
    const r = el.getBoundingClientRect();
    tip.style.top = Math.max(6, r.top) + 'px';
    tip.style.left = (r.right + 10) + 'px';
    tip.classList.add('show');
    // 右侧放不下 → 翻到左边（与装备 tooltip 同一套视口避让）
    if (r.right + 10 + tip.offsetWidth > document.documentElement.clientWidth) {
      tip.style.left = Math.max(6, r.left - tip.offsetWidth - 10) + 'px';
    }
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
  /* ---------- 宠物面板 ---------- */
  function renderPetPanel() {
    const pet = getActivePet();
    if (!pet) return;
    const s = getStats(pet);
    const base = window.Pet.baseStats(pet);
    const profile = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile;
    // 资料页大头像：优先逐帧动画立绘，无动画素材回退头像版（裁切头部，96x96 contain 到 110px 框更聚焦）
    const pa = $('pet-avatar');
    if (pa) {
      if (PetSprites && PetSprites.mountAnimated(pa, pet.name)) {}
      else if (PetSprites && PetSprites.mountAvatar(pa, pet.name)) {}
      else pa.textContent = pet.icon;
    }
    $('pet-name').textContent = pet.name;
    $('pet-level').textContent = 'Lv.' + pet.level;
    $('exp-bar').style.width = Math.min(100, (pet.exp / expNeed(pet.level)) * 100) + '%';
    $('exp-text').textContent = `${pet.exp}/${expNeed(pet.level)}`;
    $('pet-growth').textContent = pet.growth.toFixed(1);
    const reborn = $('pet-reborn');
    if (reborn) reborn.textContent = `转生 ${pet.rebornCount || 0} 次`;
    const skillInfo = $('pet-active-skill-info');
    if (skillInfo) {
      const skill = Config.pet.evolution.activeSkills[pet.name];
      const effect = skill ? `${Math.round(skill.damageMultiplier * 100)}%伤害${skill.maxHpDamageRate ? ` + 目标最大生命${Math.round(skill.maxHpDamageRate * 100)}%` : ''}` : '';
      skillInfo.textContent = skill
        ? `主动技能：${skill.name} · ${pet.level >= skill.minLevel ? `${effect} · ${skill.cooldownTurns} 回合冷却` : `Lv.${skill.minLevel} 解锁`}`
        : '主动技能：终形态 Lv.60 解锁';
    }
    // 血脉特质胶囊（出战面板常驻；空态显示"无血脉特质"）
    const traitsEl = $('pet-traits');
    if (traitsEl) {
      const th = PetUI.traitsHtml(pet);
      traitsEl.innerHTML = th || '<span class="trait-none">无血脉特质</span>';
    }
    // 觉醒徽标（Lv60 终形态解锁）
    const awEl = $('pet-awaken');
    if (awEl) {
      const aw = window.Pet.getAwakenState(pet);
      awEl.style.display = aw ? '' : 'none';
      if (aw) {
        const bonus = Object.keys(aw.bonus || {});
        const btxt = bonus.length ? ' · ' + bonus.map(function (k) {
          const bv = aw.bonus[k];
          const isFlat = ['spd'].indexOf(k) >= 0;
          return k + '+' + bv + (isFlat ? '' : '%');
        }).join(' ') : '';
        awEl.innerHTML = '<span class="awaken-badge">觉醒·' + escapeHtml(aw.skillName || '') +
          '：主动技能伤害+' + Math.round((aw.damage || 0) * 100) + '%' + btxt + '</span>';
      }
    }
    const poolEl = $('pet-exp-pool');
    if (poolEl) {
      const EP = Config.pet.expPool;
      const maxed = pet.level >= Config.pet.maxLevel;
      poolEl.style.display = (maxed && EP) ? '' : 'none';
      if (maxed && EP) poolEl.textContent = `经验池 ${Math.round(pet.expPool || 0)}/${EP.perCrystal}（满 ${EP.perCrystal} 凝 1 颗${EP.material}）`;
    }
    const hpText = `${Math.round(getCurHp(pet))}/${s.hp}`;
    if ($('pet-hp').textContent !== hpText) flashStat('pet-hp');
    $('pet-hp').textContent = hpText;
    ['atk', 'def', 'spd'].forEach(k => {
      const el = $('pet-' + k);
      const txt = String(Math.round(s[k])); // 取整
      if (el.textContent !== txt) flashStat('pet-' + k);
      el.textContent = txt;
    });
    // 暴击率/暴击伤害（真实属性，来自 getStats）
    const critEl = $('pet-crit');
    if (critEl) {
      const txt = Math.round(s.critRate * 100) + '%';
      if (critEl.textContent !== txt) flashStat('pet-crit');
      critEl.textContent = txt;
    }
    const cdEl = $('pet-critdmg');
    if (cdEl) {
      const txt = Math.round(s.critDamage * 100) + '%';
      if (cdEl.textContent !== txt) flashStat('pet-critdmg');
      cdEl.textContent = txt;
    }
    // 命中/闪避为固定数值（非百分比），直接显示数值；吸血为百分比
    ['hit', 'dodge'].forEach(key => {
      const el = $('pet-' + key);
      if (!el) return;
      const txt = String(Math.round(s[key]));
      if (el.textContent !== txt) flashStat('pet-' + key);
      el.textContent = txt;
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
    if (blEl) blEl.innerHTML = UI.bloodlineHtml ? UI.bloodlineHtml(pet) : '';
  }

  /* ---------- 装备 tab 三连屏：左列属性面板（与资料页一致，id 前缀 eqp-） ---------- */
  // 更新宠物属性面板：prefix 决定元素 id 前缀（资料页 'pet-' / 装备页 'eqp-'）
  // 攻击/防御/速度保留两位小数；生命显示 当前/上限（整数）；百分比属性（暴击/命中/闪避/吸血）取整%
  function updatePetStatsPanel(pet, prefix) {
    const $id = id => document.getElementById(prefix + id);
    if (!pet) return;
    const s = getStats(pet);
    const profile = (Config.pet.petProfiles && Config.pet.petProfiles[pet.lineId || pet.name]) || Config.pet.defaultPetProfile;
    const av = $id('avatar');
    if (av) {
      if (PetSprites && PetSprites.mountAnimated(av, pet.name)) {}
      else if (PetSprites && PetSprites.mountAvatar(av, pet.name)) {}
      else av.textContent = pet.icon;
    }
    const nm = $id('name'); if (nm) nm.textContent = pet.name;
    const lv = $id('level'); if (lv) lv.textContent = 'Lv.' + pet.level;
    const eb = $id('exp-bar'); if (eb) eb.style.width = Math.min(100, (pet.exp / expNeed(pet.level)) * 100) + '%';
    const et = $id('exp-text'); if (et) et.textContent = `${pet.exp}/${expNeed(pet.level)}`;
    const gr = $id('growth'); if (gr) gr.textContent = pet.growth.toFixed(1);
    const rn = $id('reborn'); if (rn) rn.textContent = `转生 ${pet.rebornCount || 0} 次`;
    const hp = $id('hp'); if (hp) hp.textContent = `${Math.round(getCurHp(pet))}/${Math.round(s.hp)}`;
    // 攻击/防御/速度：取整显示（基底经 materialTier 相乘为小数，取整更干净）
    ['atk', 'def', 'spd'].forEach(k => { const el = $id(k); if (el) el.textContent = Math.round(s[k]); });
    const crit = $id('crit'); if (crit) crit.textContent = Math.round(s.critRate * 100) + '%';
    const cd = $id('critdmg'); if (cd) cd.textContent = Math.round(s.critDamage * 100) + '%';
    // 命中/闪避是固定数值（非百分比），直接显示数值；吸血是百分比
    const hitEl = $id('hit'); if (hitEl) hitEl.textContent = Math.round(s.hit);
    const dgEl = $id('dodge'); if (dgEl) dgEl.textContent = Math.round(s.dodge);
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
  function renderPetList() {
    const list = $('pet-list');
    list.innerHTML = '';
    // 出战宠可能为空（刚被卖掉/上架），不能拿它当必然存在的前提，否则整个宠物页渲染会崩
    const active = getActivePet();
    const activeId = active ? active.id : null;
    for (const pet of getPets()) {
      const equipCount = Object.values(pet.equipment || {}).filter(Boolean).length; // 已穿装备数
      const card = document.createElement('div');
      const isActive = pet.id === activeId;
      card.className = 'pet-card' + (isActive ? ' active' : '');
      card.innerHTML = `${isActive ? '<div class="pet-card-badge">出战</div>' : ''}
        <div class="icon">${iconHtml(pet.name, pet.icon)}</div>
        <div class="pname">${pet.name}</div>
        ${(function(){var bl=window.Pet&&window.Pet.getBloodline?window.Pet.getBloodline(pet):null;return bl?'<div class="pet-card-bloodline">'+bl.icon+' '+bl.name+'</div>':'';})()}
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}</div>
        <div class="meta">装备${equipCount}/3</div>`;
      card.onclick = () => {
        if (pet.cloudId && window.Market && Market.isListed && Market.isListed(pet.cloudId)) {
          UI.showToast('⚠️ 已上架的宠物不能出战', '请先在市场取回');
          return;
        }
        setActive(pet.id);
        addLog(`🐾 ${pet.name} 出战！`);
        UI.renderAll();
      };
      if (equipCount > 0) {
        const eqTag = document.createElement('div');
        eqTag.className = 'pet-eq-tag';
        eqTag.textContent = '👔 有装备';
        eqTag.title = '穿着装备的宠物不能融合，请先卸下装备';
        card.appendChild(eqTag);
      }
      bindPetTip(card, pet);
      list.appendChild(card);
    }
  }

  /* ---------- 涅槃 tab：三段式（左选主宠 → 右选副宠 → 预览确认），去弹窗 ---------- */
  let mergeMainId = null, mergeSubId = null;
  function renderMergeTab() {
    const list = $('merge-pet-list');
    if (!list) return;
    const M = Config.nirvana || Config.merge || {};
    list.innerHTML = '';
    const mainPet = getPets().find(p => p.id === mergeMainId);
    // 主宠候选：可涅槃（未穿装备、可merge、已存档、不在售）
    const cands = getPets().filter(p => {
      const ec = Object.values(p.equipment || {}).filter(Boolean).length;
      return !ec && Merge.canMerge(p) && p.cloudId && !(Market && Market.isListed(p.cloudId));
    });
    if (!cands.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '没有可涅槃的宠物（需未穿装备、不在出售）';
      list.appendChild(empty);
      renderMergeStage(null);
      return;
    }
    for (const pet of cands) {
      const card = document.createElement('div');
      card.className = 'pet-card' + (pet.id === mergeMainId ? ' active' : '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name, pet.icon)}</div>
        <div class="pname">${pet.name}</div>
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}</div>`;
      card.onclick = () => {
        mergeMainId = pet.id;
        mergeSubId = null; // 换主宠重置副宠
        UI.renderAll();
      };
      list.appendChild(card);
    }
    renderMergeStage(mainPet);
  }

  // 涅槃右侧三段式：主宠卡 + 副宠选择 + 预览 + 确认（口袋精灵2）
  function renderMergeStage(main) {
    const mb = $('merge-main-box'), sb = $('merge-sub-box'), pb = $('merge-preview'), cb = $('merge-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const M = Config.nirvana || Config.merge || {};
    if (!main) {
      mb.innerHTML = '<div class="hint">← 先在左侧选一只主宠</div>';
      sb.innerHTML = ''; pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    const matName = M.material && M.material.name || '涅槃兽';
    const matAmt = M.material && M.material.amount || 1;
    const haveMat = Materials.getQuantity ? Materials.getQuantity(matName) : 0;
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name, main.icon)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 消耗 ${matAmt} 只${matName}（持有 ${haveMat}）</div></div>`;
    // 副宠候选
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id) : [];
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副宠（需要另一只 ${M.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<div class="es-tip">选择副宠（融合后消失，主宠吸收其成长）：</div><div class="es-sub-grid">' +
      subs.map(s => {
        const sel = s.id === mergeSubId ? ' selected' : '';
        return `<button class="es-route${sel}" data-sub="${s.id}">
          <div class="es-route-icon">${iconHtml(s.name, s.icon)}</div>
          <div class="es-route-name">${s.name}</div>
          <small>成长 ${s.growth.toFixed(1)}</small>
        </button>`;
      }).join('') + '</div>';
    sb.querySelectorAll('.es-route').forEach(btn => {
      btn.onclick = () => {
        mergeSubId = Number(btn.dataset.sub);
        renderMergePreview(main, matName, matAmt, haveMat);
        UI.renderAll();
      };
    });
    // 已有选中副宠则显示预览
    if (mergeSubId) {
      const sub = getPets().find(p => p.id === mergeSubId);
      if (sub) renderMergePreview(main, matName, matAmt, haveMat);
    } else {
      pb.innerHTML = '<div class="hint">← 选择一个副宠查看预览</div>';
      cb.innerHTML = '';
    }
  }

  function renderMergePreview(main, matName, matAmt, haveMat) {
    const pb = $('merge-preview'), cb = $('merge-confirm');
    if (!pb || !cb) return;
    const M = Config.nirvana || Config.merge || {};
    const sub = getPets().find(p => p.id === mergeSubId);
    if (!sub) return;
    const calc = window.Merge && window.Merge.calcNirvanaGrowth ? window.Merge.calcNirvanaGrowth(main, sub) : null;
    const newGrowth = calc ? calc.growth : Math.round((main.growth + sub.growth * M.absorbRatio) * 10) / 10;
    const cur = getStats(main);
    const next = M.resetLevel ? getStats({ ...main, level: 1, growth: newGrowth }) : getStats({ ...main, growth: newGrowth });
    const row = (label, a, b) => {
      const cls = b > a ? 'delta-up' : b < a ? 'delta-down' : '';
      return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${b > a ? '▲' : b < a ? '▼' : ''}</span></div>`;
    };
    const matOk = haveMat >= matAmt;
    pb.innerHTML = `
      <div class="es-preview-row">成长值：<b>${main.growth.toFixed(1)} → ${newGrowth.toFixed(1)}</b></div>
      <div class="es-preview-row">等级：Lv.${main.level} → ${M.resetLevel ? '<b>Lv.1（重置）</b>' : '不变'}</div>
      <div class="es-preview-row">${iconHtml(sub.name, sub.icon)} ${sub.name}（成长 ${sub.growth.toFixed(1)}）将消失，消耗 ${matAmt} 只${matName}（持有 ${haveMat}）</div>
      ${M.resetLevel ? '<div class="warn">⚠ 涅槃后等级重置回 1 级，经验清零，属性按 1 级 × 新成长重算</div>' : ''}
      ${!matOk ? `<div class="es-preview-row warn">⚠ 材料不足：需要 ${matAmt} 只${matName}，当前持有 ${haveMat}</div>` : ''}
      <div class="es-stats">属性变化：</div>
      ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}
      ${traitInheritLine(main, sub, 'nirvana')}`;
    cb.innerHTML = `<button class="btn-mini primary" id="merge-ok" ${matOk ? '' : 'disabled'}>确认涅槃</button>`;
    cb.querySelector('#merge-ok').onclick = async () => {
      if (!matOk) { showToast('⚠ 无法涅槃', '材料不足'); return; }
      const res = await Merge.nirvana(main.id, sub.id);
      if (res.error) { showToast('❌ 涅槃失败', res.error); return; }
      addLog(`♻️ 涅槃成功！${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}`);
      showToast('♻️ 涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}`);
      mergeMainId = res.main ? res.main.id : null;
      mergeSubId = null;
      UI.renderAll();
    };
  }

  /* ---------- 合成 tab：可合成宠物列表（主宠选择 → 合成） ---------- */
  /* ---------- 合成 tab：三段式（左选主素材 → 右选副素材 → 预览确认），去弹窗 ---------- */
  let synthMainId = null, synthSubId = null;
  function renderSynthTab() {
    const list = $('synth-pet-list');
    if (!list) return;
    const S = Config.synthesize || {};
    list.innerHTML = '';
    const mainPet = getPets().find(p => p.id === synthMainId);
    const cands = getPets().filter(p => {
      const ec = Object.values(p.equipment || {}).filter(Boolean).length;
      return !ec && Merge.canMerge(p) && p.cloudId && !(Market && Market.isListed(p.cloudId));
    });
    if (!cands.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '没有可合成的宠物（需未穿装备、不在出售）';
      list.appendChild(empty);
      renderSynthStage(null);
      return;
    }
    for (const pet of cands) {
      const card = document.createElement('div');
      card.className = 'pet-card' + (pet.id === synthMainId ? ' active' : '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name, pet.icon)}</div>
        <div class="pname">${pet.name}</div>
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}</div>`;
      card.onclick = () => {
        synthMainId = pet.id;
        synthSubId = null;
        UI.renderAll();
      };
      list.appendChild(card);
    }
    renderSynthStage(mainPet);
  }

  // 合成右侧三段式：主素材卡 + 副素材选择 + 预览（含变异概率）+ 确认
  function renderSynthStage(main) {
    const mb = $('synth-main-box'), sb = $('synth-sub-box'), pb = $('synth-preview'), cb = $('synth-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const S = Config.synthesize || {};
    if (!main) {
      mb.innerHTML = '<div class="hint">← 先在左侧选一只主素材</div>';
      sb.innerHTML = ''; pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    const matName = S.material && S.material.name || '合成之石';
    const matAmt = S.material && S.material.amount || 1;
    const haveMat = Materials.getQuantity ? Materials.getQuantity(matName) : 0;
    const mutPct = Math.round((S.mutation && S.mutation.chance || 0) * 100);
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name, main.icon)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）· 变异 ${mutPct}%</div></div>`;
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id, S) : [];
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副素材（需要另一只 ${S.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<div class="es-tip">选择副素材（两只素材宠都会消失，合成一只新宠）：</div><div class="es-sub-grid">' +
      subs.map(s => {
        const sel = s.id === synthSubId ? ' selected' : '';
        return `<button class="es-route${sel}" data-sub="${s.id}">
          <div class="es-route-icon">${iconHtml(s.name, s.icon)}</div>
          <div class="es-route-name">${s.name}</div>
          <small>成长 ${s.growth.toFixed(1)}</small>
        </button>`;
      }).join('') + '</div>';
    sb.querySelectorAll('.es-route').forEach(btn => {
      btn.onclick = () => {
        synthSubId = Number(btn.dataset.sub);
        renderSynthPreview(main, matName, matAmt, haveMat, mutPct);
        UI.renderAll();
      };
    });
    if (synthSubId) {
      const sub = getPets().find(p => p.id === synthSubId);
      if (sub) renderSynthPreview(main, matName, matAmt, haveMat, mutPct);
    } else {
      pb.innerHTML = '<div class="hint">← 选择一个副素材查看预览</div>';
      cb.innerHTML = '';
    }
  }

  function renderSynthPreview(main, matName, matAmt, haveMat, mutPct) {
    const pb = $('synth-preview'), cb = $('synth-confirm');
    if (!pb || !cb) return;
    const S = Config.synthesize || {};
    const sub = getPets().find(p => p.id === synthSubId);
    if (!sub) return;
    const normalGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, false) : null;
    const mutatedGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, true) : null;
    const matOk = haveMat >= matAmt;
    pb.innerHTML = `
      <div class="es-preview-row">合成结果：一只全新的 <b>${iconHtml(main.name, main.icon)} ${main.name}${mutPct ? '（·异变）' : ''}</b>，等级回 1</div>
      <div class="es-preview-row">普通成长：<b>${normalGrowth !== null ? normalGrowth.toFixed(1) : '?'}</b></div>
      ${mutPct ? `<div class="es-preview-row">🧬 有 <b>${mutPct}%</b> 概率变异：成长额外 +${(S.mutation && S.mutation.growthBonus[0])}~${(S.mutation && S.mutation.growthBonus[1])}（如 ${mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?'}），名字带「·异变」</div>` : ''}
      <div class="es-preview-row">两只素材（${main.name}、${sub.name}）都将消失，消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）</div>
      ${!matOk ? `<div class="es-preview-row warn">⚠ 材料不足：需要 ${matAmt} 颗${matName}，当前持有 ${haveMat}</div>` : ''}
      ${traitInheritLine(main, sub, 'synth')}`;
    cb.innerHTML = `<button class="btn-mini primary" id="synth-ok" ${matOk ? '' : 'disabled'}>确认合成</button>`;
    cb.querySelector('#synth-ok').onclick = async () => {
      if (!matOk) { showToast('⚠ 无法合成', '材料不足'); return; }
      const res = await Merge.synthesize(main.id, sub.id);
      if (res.error) { showToast('❌ 合成失败', res.error); return; }
      if (res.mutated) {
        addLog(`💠🌟 合成变异成功！${res.mainName}+${res.subName} 合成了全新稀有宠【${res.baby.name}】成长 ${res.newGrowth.toFixed(1)}！`);
        showToast('💠🌟 合成变异成功！', `${iconHtml(res.baby.name, res.baby.icon)} <b style="color:#c9a86a">【${res.baby.name}】</b><br><small>成长值 ${res.newGrowth.toFixed(1)}</small>`);
      } else {
        addLog(`💠 合成成功！${res.mainName}+${res.subName} 合成了新宠 ${res.baby.name}（成长 ${res.newGrowth.toFixed(1)}）`);
        showToast('💠 合成成功！', `${iconHtml(res.baby.name, res.baby.icon)} ${res.baby.name}｜成长值 ${res.newGrowth.toFixed(1)}`);
      }
      synthMainId = res.baby && res.baby.id ? res.baby.id : null;
      synthSubId = null;
      UI.renderAll();
    };
  }

  /* ---------- 进化 tab：三段式（左选主宠 → 右选方向 → 预览确认），去弹窗 ---------- */
  // renderAll 高频重建（非战斗回血每秒、挂机每场、市场轮询都会触发），
  // 所以「玩家当前选到哪一步」必须落在 state 上，不能靠 DOM 记住：
  //   evolveMainId  = 选中的主宠（renderAll 高频重建，用 state 保存）
  //   evolvePreview = { petId, routeIndex, boost } 选中的进化方向 + 定死的成长加成
  // 涅槃 tab 的 mergeSubId 是同一套模式；进化 tab 以前漏了，导致预览/确认被重建冲掉。
  let evolveMainId = null;
  let evolvePreview = null;
  function renderEvolveTab() {
    const list = $('evolve-pet-list');
    if (!list) return;
    const E = Config.pet.evolution || {};
    const maxTimes = E.maxEvolveTimes || 10;
    list.innerHTML = '';
    const evoPets = getPets().filter(p => Evolve.hasRoute(p) && p.cloudId && !(Market && Market.isListed(p.cloudId)));
    if (!evoPets.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '还没有可进化的宠物';
      list.appendChild(empty);
      renderEvolveStage(null);
      return;
    }
    for (const pet of evoPets) {
      const card = document.createElement('div');
      card.className = 'pet-card' + (pet.id === evolveMainId ? ' active' : '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name, pet.icon)}</div>
        <div class="pname">${pet.name}</div>
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)} · 进化${(pet.evolveTimes || 0)}/${maxTimes}</div>`;
      card.onclick = () => {
        evolveMainId = pet.id;
        evolvePreview = null; // 换主宠 → 旧的方向预览作废
        UI.renderAll();
      };
      list.appendChild(card);
    }
    const main = getPets().find(p => p.id === evolveMainId) || null;
    renderEvolveStage(main);
  }

  // 右侧：主宠卡 + 进化方向列表 + 预览 + 确认（口袋精灵2 三段式）
  function renderEvolveStage(main) {
    const mb = $('evolve-main-box');
    const tb = $('evolve-target-box');
    const pb = $('evolve-preview');
    const cb = $('evolve-confirm');
    if (!mb || !tb || !pb || !cb) return;
    const E = Config.pet.evolution || {};
    if (!main) {
      mb.innerHTML = '<div class="hint">← 先在左侧选一只主宠</div>';
      tb.innerHTML = ''; pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    const routes = Evolve.getEvolutionRoutes(main);
    const maxTimes = E.maxEvolveTimes || 10;
    const times = main.evolveTimes || 0;
    const maxed = times >= maxTimes;
    const rm = (routes.length && Evolve.getRouteMaterial(main, 0)) || null;
    const matName = (rm && rm.name) || E.materialName || '进化素材';
    const have = rm ? rm.have : (Materials.getQuantity ? Materials.getQuantity(matName) : 0);
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name, main.icon)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 进化 ${times}/${maxTimes} · 转生 ${main.rebornCount || 0}</div></div>`;

    if (maxed) {
      tb.innerHTML = `<div class="warn">🔒 进化已达上限(${maxTimes}次)，需通过<b>涅槃</b>重置进化次数后才能继续</div>`;
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    if (!routes.length) {
      tb.innerHTML = '<div class="hint">该形态无法再进化</div>';
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    tb.innerHTML = '<div class="es-tip">选择进化方向（等级不变、成长+、换形态）：</div><div class="es-route-grid">' +
      routes.map((r, i) => {
        const okLevel = main.level >= (r.minLevel || 1);
        return `<button class="es-route ${okLevel ? '' : 'lv-low'}" data-i="${i}">
          <div class="es-route-icon">${iconHtml(r.to, r.icon)}</div>
          <div class="es-route-name">${r.to}</div>
          <small>${r.minLevel ? (okLevel ? '需 Lv.' + r.minLevel + ' ✓' : '⚠ 需 Lv.' + r.minLevel + '（等级不够）') : '可进化'}</small>
        </button>`;
      }).join('') + '</div>';
    tb.querySelectorAll('.es-route').forEach(btn => {
      btn.onclick = () => {
        // 不再因等级 disabled —— 仍可点击预览，预览里会提示等级不够不能进化
        renderEvolvePreview(main, Number(btn.dataset.i), matName, have);
      };
    });
    // 重建后按 state 恢复预览（否则玩家刚点的方向被 renderAll 冲掉）
    if (evolvePreview && evolvePreview.petId === main.id && routes[evolvePreview.routeIndex]) {
      renderEvolvePreview(main, evolvePreview.routeIndex, matName, have);
    } else {
      evolvePreview = null;
      pb.innerHTML = '<div class="hint">← 选择一个进化方向查看预览</div>';
      cb.innerHTML = '';
    }
  }

  function renderEvolvePreview(pet, i, matName, have) {
    const E = Config.pet.evolution || {};
    const pb = $('evolve-preview');
    const cb = $('evolve-confirm');
    if (!pb || !cb) return;
    const routes = Evolve.getEvolutionRoutes(pet);
    const route = routes[i];
    if (!route) return;
    const cur = getStats(pet);
    // 成长加成在「预览这一次」定死并记进 state：
    // 1) renderAll 每秒重建面板，数字不会乱跳；
    // 2) 确认时把这个 boost 传给 Evolve.evolve，做到预览多少就是多少。
    if (!evolvePreview || evolvePreview.petId !== pet.id || evolvePreview.routeIndex !== i) {
      evolvePreview = { petId: pet.id, routeIndex: i, boost: window.Util.randFloat(E.growthBoost[0], E.growthBoost[1]) };
    }
    const boost = evolvePreview.boost;
    const nextGrowth = Math.round((pet.growth + boost) * 10) / 10;
    const next = getStats({ ...pet, growth: nextGrowth });
    const row = (label, a, b) => {
      const cls = b > a ? 'delta-up' : '';
      return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${b > a ? '▲' : ''}</span></div>`;
    };
    const formText = route.keepForm ? '形态不变，成长值提升' : `进化后名字变为【${route.to}】`;
    const lvOk = pet.level >= (route.minLevel || 1);
    const matOk = have >= 1;
    const canEvolve = lvOk && matOk;
    let warnRow = '';
    if (!lvOk) warnRow += `<div class="es-preview-row warn">⚠ 等级不足：需要 Lv.${route.minLevel}，当前 Lv.${pet.level}</div>`;
    if (!matOk) warnRow += `<div class="es-preview-row warn">⚠ 材料不足：需要 1 个 ${matName}，当前持有 ${have}</div>`;
    pb.innerHTML = `
      <div class="es-preview-row">路线：<b>${iconHtml(route.to, route.icon, true)} ${route.to}</b>（${route.minLevel ? '需 Lv.' + route.minLevel : '无等级要求'}）</div>
      <div class="es-preview-row">消耗：<b>${matName} ×1</b>（当前持有 ${have}）</div>
      <div class="hint">等级不变（Lv.${pet.level}）；${formText}；进化次数 ${pet.evolveTimes || 0}→${(pet.evolveTimes || 0) + 1}</div>
      ${warnRow}
      <div class="es-stats">属性变化：</div>
      ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}`;
    cb.innerHTML = `<button class="btn-mini primary" id="evolve-ok" ${canEvolve ? '' : 'disabled'}>确认进化</button>`;
    cb.querySelector('#evolve-ok').onclick = async () => {
      if (!canEvolve) {
        showToast('⚠ 无法进化', !lvOk ? '等级不够' : '材料不足');
        return;
      }
      const origName = pet.name;
      const origGrowth = pet.growth;
      const res = await Evolve.evolve(pet.id, i, boost); // 用预览定好的 boost，所见即所得
      if (res.error) { showToast('❌ 进化失败', res.error); return; }
      const changed = res.keepForm ? '（形态不变）' : '';
      addLog(`🌟 进化成功！${origName} 成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${changed}`);
      showToast('🌟 进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}</small>`);
      evolveMainId = res.pet ? res.pet.id : pet.id;
      evolvePreview = null; // 已进化：旧预览（形态/成长都变了）作废
      UI.renderAll();
    };
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
        item.innerHTML = `<span class="slot-icon" aria-hidden="true">${eq.icon || '◆'}</span><span class="slot-copy"><span class="slot-name">${escapeHtml(eq.name)}</span><span class="sub">${escapeHtml(describeItem(eq))}</span></span>`;
        const tip = document.createElement('div');
        tip.className = 'equip-tip';
        const detailAffixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(eq.affixes) : (eq.affixes || { prefix: [], suffix: [] });
        const detailLine = (list, cls) => (list || []).map(a => window.Equipment.formatAffixHtml(a, cls)).join('') || '<div class="tip-empty">无</div>';
        const itemLevel = eq.level ?? eq.itemLevel ?? eq.areaTier ?? 1;
        const base = eq.base || { label: '攻击', value: 0 };
        let soulLine = '';
        if (eq.soulAffix) {
          const a = eq.soulAffix;
          const sFlat = ['hit', 'dodge', 'spd'].indexOf(a.type) >= 0;
          soulLine = `<div class="tip-section">魂铸</div><div class="tip-soul" style="color:#c9a86a">${escapeHtml(a.label || '')}${a.tier ? ' T' + a.tier : ''}${a.value != null ? ' +' + a.value + (sFlat ? '' : '%') : ''}</div>`;
        }
        tip.innerHTML = `<div class="tip-name" style="color:${rarity.color}">${escapeHtml(eq.name)}</div><div class="tip-line">等级：<b>${itemLevel}</b></div><div class="tip-section">基底词缀</div><div class="tip-base">${escapeHtml(base.label)} +${base.value} <span class="tip-tier">T${eq.materialTier ?? eq.tier ?? 4}</span></div><div class="tip-section">前缀</div>${detailLine(detailAffixes.prefix, 'tip-prefix')}<div class="tip-section">后缀</div>${detailLine(detailAffixes.suffix, 'tip-suffix')}${soulLine}`;
        item.appendChild(tip);
        item.onclick = (e) => { e.stopPropagation(); item.classList.toggle('open'); };
        const takeBtn = document.createElement('button');
        takeBtn.className = 'btn-sm ghost slot-unequip';
        takeBtn.textContent = '脱下';
        takeBtn.onclick = (e) => { e.stopPropagation(); const taken = unequip(pet, slot); if (taken) { addLog(`脱下 ${taken.name}，放回背包`); UI.renderAll(); } };
        item.appendChild(takeBtn);
        div.title = '点击脱下';
        div.onclick = () => { const taken = unequip(pet, slot); if (taken) { addLog(`脱下 ${taken.name}，放回背包`); UI.renderAll(); } };
      } else {
        item.textContent = '空槽';
        div.title = '空装备槽';
      }
      orbit.appendChild(div);
    });
    wrap.appendChild(orbit);
    const art = orbit.querySelector('#equip-orbit-art');
    if (art) {
      if (typeof PetSprites !== 'undefined' && PetSprites.mountAnimated(art, pet.name)) {}
      else if (typeof PetSprites !== 'undefined' && PetSprites.mountAvatar(art, pet.name)) {}
      else art.textContent = pet.icon || '未知';
    }
  }

  /* ---------- 换装背包（装备 tab：给当前出战宠物穿上背包里的装备，悬停看属性面板） ---------- */
  // 换装背包筛选状态（模块级，避免 renderAll 高频重建时重置）
  const equipInvFilter = { slot: 'all', rarity: 'all', baseTier: 'all', affixTier: 'all', affixType: 'all' };
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
      row.className = 'quick-eq q-' + (eq.rarity && eq.rarity.id ? eq.rarity.id : 'white');
      // 装备属性面板（悬停 + 点击看）
      const tip = document.createElement('div');
      tip.className = 'equip-tip';
      const detailAffixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(eq.affixes) : (eq.affixes || { prefix: [], suffix: [] });
      const detailLine = (list, cls) => (list || []).map(a => window.Equipment.formatAffixHtml(a, cls)).join('') || '<div class="tip-empty">无</div>';
      const itemLevel = eq.level ?? eq.itemLevel ?? eq.areaTier ?? 1;
      const base = eq.base || { label: '攻击', value: 0 };
      tip.innerHTML = `<div class="tip-name" style="color:${rarityOf(eq).color}">${escapeHtml(eq.name)}</div><div class="tip-line">等级：<b>${itemLevel}</b></div><div class="tip-section">基底词缀</div><div class="tip-base">${escapeHtml(base.label)} +${base.value} <span class="tip-tier">T${eq.materialTier ?? eq.tier ?? 4}</span></div><div class="tip-section">前缀</div>${detailLine(detailAffixes.prefix, 'tip-prefix')}<div class="tip-section">后缀</div>${detailLine(detailAffixes.suffix, 'tip-suffix')}`;

      const name = document.createElement('span');
      name.className = 'qe-name';
      name.innerHTML = `<span class="qe-icon" aria-hidden="true">${eq.icon || '◆'}</span><span class="qe-copy">${escapeHtml(eq.name)}</span>`;
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
          addLog(`⚔️ ${pet.name} 装备了 ${res.equipped.name}（${describeItem(res.equipped)}）`);
          UI.renderAll();
        } else {
          showToast('❌ 无法穿上', '可能是槽位已满或等级不符');
        }
      };
      row.appendChild(btn);
      row.appendChild(tip);
      row.onclick = () => row.classList.toggle('open');
      box.appendChild(row);
    }
  }

  /* ---------- 涅槃（原融合）条件说明 ---------- */
  function renderMergeHint() {
    const el = $('merge-hint-text');
    const M = Config.nirvana || Config.merge || {};
    if (el && M.minLevel) el.innerHTML = `♻️ 涅槃：主宠吸副宠成长 + 重置等级。条件：两只 <b>${M.minLevel} 级</b>宠物 + 消耗 <b>${M.material.amount} 只${M.material.name}</b>`;
  }

  /* ---------- 进化条件说明 ---------- */
  function renderEvolveHint() {
    const el = $('evolve-hint-text');
    const E = Config.pet.evolution;
    if (el && E) el.innerHTML = `🌟 进化：消耗 <b>${E.materialName || '进化素材'} ×1</b>走一段进化树（等级不变、成长提升、名字变化），单宠最多进化 <b>${E.maxEvolveTimes || 10} 次</b>，吃满后需<b>融合(转生)</b>重置次数继续`;
  }

  /* ---------- 宠物蛋孵化面板（宠物页「宠物蛋」tab：按品种展示 + 孵化） ---------- */
  function renderEggPanel() {
    const wrap = $('egg-panel');
    const Drop = window.Drop;
    if (!wrap || !Drop) return;
    const eggMap = Drop.getEggs ? Drop.getEggs() : {};
    const eggs = Drop.getEggCount();
    wrap.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'egg-info';
    const count = document.createElement('div');
    count.className = 'egg-count';
    count.innerHTML = eggs > 0
      ? `🥚 宠物蛋共 ×<b>${eggs}</b>`
      : '🥚 暂无宠物蛋（挂机打基础怪有概率掉落对应品种的蛋）';
    info.appendChild(count);
    const desc = document.createElement('div');
    desc.className = 'egg-desc';
    desc.textContent = UI.isLoggedIn() ? '每个品种的蛋孵出对应的宠物；可上架市场交易' : '登录后才能孵化';
    info.appendChild(desc);
    wrap.appendChild(info);

    // 按品种逐一展示（每种蛋一张卡：品种名 + 数量 + 孵化按钮）
    const list = document.createElement('div');
    list.className = 'egg-species-list';
    const entries = Object.entries(eggMap).filter(([, n]) => n > 0);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '背包空空，去挂机捡蛋';
      list.appendChild(empty);
    }
    for (const [baseName, n] of entries) {
      const row = document.createElement('div');
      row.className = 'egg-species';
      const name = document.createElement('span');
      name.className = 'egg-species-name';
      name.textContent = Drop.makeEggName(baseName);
      const qty = document.createElement('span');
      qty.className = 'egg-species-qty';
      qty.textContent = `×${n}`;
      const btn = document.createElement('button');
      btn.className = 'btn-sm alt';
      btn.textContent = UI.isLoggedIn() ? '孵化' : '🔒 登录后孵化';
      btn.disabled = !UI.isLoggedIn() || n <= 0;
      btn.onclick = async () => {
        if (!UI.isLoggedIn()) return;
        const res = await Drop.hatchEgg(baseName);
        if (!res) return;
        if (res.error) { showToast('❌ 无法孵化', res.error); return; }
        addLog(`🐣 孵化成功！获得新宠物 ${res.baby.name}（成长值 ${res.baby.growth}）！`);
        showToast('🐣 孵化成功！', `${iconHtml(res.baby.name, res.baby.icon)} ${res.baby.name}｜成长值 ${res.baby.growth}｜已出战`);
        const traitBlock = (res.baby && Array.isArray(res.baby.traits) && res.baby.traits.length)
          ? PetUI.traitsHtml(res.baby)
          : '<span class="trait-none">无血脉特质</span>';
        if (UI.showDialog) UI.showDialog({ icon: '🐣', speaker: '孵化', text: `${iconHtml(res.baby.name, res.baby.icon)} ${res.baby.name}<br>成长值 ${res.baby.growth} · 已出战<br>${traitBlock}` });
        if (res.saveError) addLog('⚠️ 云端存档失败，宠物仅保存在本地');
        UI.renderAll();
      };
      row.appendChild(name);
      row.appendChild(qty);
      row.appendChild(btn);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  /* ---------- 宠物页顶部 5 tab 切换（资料/装备/融合/进化/宠物蛋） ---------- */
  function initPetTabs() {
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
    });
  }

  /* ---------- 宠物融合面板（选副宠 → 预览 → 确认） ---------- */
  function openMergePanel(main) {
    const M = Config.nirvana || Config.merge || {};
    const body = $('merge-body');
    if (Object.values(main.equipment || {}).some(Boolean)) {
      body.innerHTML = `
        <div class="merge-main">主宠：${iconHtml(main.name, main.icon)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
        <div class="merge-preview">⚠️ <b>${main.name} 穿着装备，不能融合。</b><br>请先到「宠物」页点击已穿装备卸下，再回来融合。</div>`;
      $('merge-modal').style.display = 'flex';
      return;
    }
    const cands = Merge.getMergeCandidates(main.id);
    const baseHtml = `
      <div class="merge-main">主宠：${iconHtml(main.name, main.icon)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
      <div class="merge-tip">消耗 <b>${M.material.amount} 只${M.material.name}</b>（当前持有 ${Materials.getQuantity(M.material.name)}）</div>
      <div class="merge-tip">选择副宠（融合后消失，${main.name} 吸收其 ${Math.round(M.absorbRatio * 100)}% 成长值；副宠也不能穿装备）：</div>`;
    let html = baseHtml;
    if (!cands.length) {
      html += `<div class="inv-empty">没有可用的副宠（需要另一只 ${M.minLevel} 级、不在出售中、且没穿装备的宠物）</div>`;
    } else {
      html += '<div class="merge-cands">' + cands.map(c =>
        `<button class="merge-cand" data-id="${c.id}">${iconHtml(c.name, c.icon)} ${c.name}（成长 ${c.growth.toFixed(1)}）</button>`
      ).join('') + '</div>';
    }
    body.innerHTML = html;
    $('merge-modal').style.display = 'flex';

    body.querySelectorAll('.merge-cand').forEach(btn => {
      btn.onclick = () => {
        const sub = getPets().find(p => p.id === Number(btn.dataset.id));
        if (!sub) return;
        // 凝魂晶石加成（可选）：预览与实际共用 calcNirvanaGrowth，勾上就按加成后的成长重算
        const CB = M.crystalBonus;
        const haveCrystal = CB ? Materials.getQuantity(CB.material) : 0;
        const render = (useCrystal) => {
        const bonusMult = (useCrystal && CB) ? 1 + CB.absorbBonus : 1;
        const calc = window.Merge && window.Merge.calcNirvanaGrowth ? window.Merge.calcNirvanaGrowth(main, sub, bonusMult) : null;
        const newGrowth = calc ? calc.growth : Math.round((main.growth + sub.growth * M.absorbRatio * bonusMult) * 10) / 10;
        const cur = getStats(main);
        // 属性对比按「融合后的等级」计算：重置等级时用 1 级，保留等级时用当前等级
        const next = M.resetLevel
          ? getStats({ ...main, level: 1, growth: newGrowth })
          : getStats({ ...main, growth: newGrowth });
        const row = (label, a, b) => {
          const cls = b > a ? 'delta-up' : b < a ? 'delta-down' : '';
          const arrow = b > a ? '▲' : b < a ? '▼' : '';
          return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${arrow}</span></div>`;
        };
        const statHtml = row('生命', cur.hp, next.hp) + row('攻击', cur.atk, next.atk)
          + row('防御', cur.def, next.def) + row('速度', cur.spd, next.spd);
        // 涅槃成长软上限提示：主宠成长已达上限则不再涨成长
        const maxed = (main.growth || 0) >= (M.maxGrowth || 100);
        // 合成限制提示（对齐口袋精灵2）：副宠成长不足主宠一半会打折；主宠成长到 60 后吸收减半
        const subReqTxt = (main.growth * (M.subGrowthRatio || 0)).toFixed(1);
        const limitHtml = [
          calc && calc.subRatioPenalty
            ? `<div class="merge-limit warn">⚠️ 副宠成长(${sub.growth.toFixed(1)}) 低于主宠成长的一半(${subReqTxt})，吸收将<b>打折</b>（只吸 ${Math.round((M.lowGrowthPenalty || 0.2) * 100)}%）</div>`
            : `<div class="merge-limit hint">副宠成长需 ≥ 主宠的一半(${subReqTxt}) 才给足吸收，否则打折</div>`,
          calc && calc.capApplied
            ? `<div class="merge-limit warn">⚠️ 主宠成长已到 <b>${M.growthCap}</b> 分水岭，本次吸收<b>减半</b>（成长越高后期提升越慢）</div>`
            : (M.growthCap ? `<div class="merge-limit hint">主宠成长 < ${M.growthCap} 时给足吸收；达到 ${M.growthCap} 后吸收减半</div>` : '')
        ].join('');
        body.innerHTML = baseHtml + `
          <div class="merge-preview">
            <div>成长值：<b>${main.growth.toFixed(1)} → ${newGrowth.toFixed(1)}</b></div>
            <div>等级：<b>Lv.${main.level} → ${M.resetLevel ? 'Lv.1（重置）' : '不变'}</b></div>
            <div>${iconHtml(sub.name, sub.icon)} ${sub.name}（成长 ${sub.growth.toFixed(1)}）将消失，消耗 ${M.material.amount} 只${M.material.name}</div>
            ${M.resetLevel
              ? `<div class="warn">⚠️ 融合后 ${main.name} 的等级<b>重置回 1 级</b>，经验清零，属性按 1 级 × 新成长值重算（需重新练级，练起来后成长优势会体现）</div>`
              : '<div class="hint">等级保留，属性按当前等级 × 新成长值重算</div>'}
            ${limitHtml}
            ${maxed ? `<div class="merge-limit warn">⚠️ 主宠成长已达上限 <b>${M.maxGrowth}</b>，本次涅槃<b>不再涨成长</b>，仅重置等级（可继续练级）</div>` : ''}
            ${CB ? `<label class="merge-crystal"><input type="checkbox" id="merge-crystal" ${useCrystal ? 'checked' : ''} ${haveCrystal < CB.amount ? 'disabled' : ''}>额外投入 ${CB.material} ×${CB.amount}（持有 ${haveCrystal}），本次吸收 +${Math.round(CB.absorbBonus * 100)}%</label>` : ''}
            <div class="merge-stats">属性变化（按涅槃后等级计算）：</div>
            ${statHtml}
            <div style="margin-top:8px"><button class="btn-mini primary" id="merge-ok">确认涅槃</button></div>
          </div>`;
        const cb = body.querySelector('#merge-crystal');
        if (cb) cb.onchange = () => render(cb.checked);
        body.querySelector('#merge-ok').onclick = async () => {
          const origName = main.name; // 涅槃前原名
          const res = await Merge.nirvana(main.id, sub.id, !!(cb && cb.checked));
          if (res.error) { showToast('❌ 涅槃失败', res.error); return; }
          addLog(`♻️ 涅槃成功！${res.subName} 消失了，${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}`);
          showToast('♻️ 涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}<br><small>等级重置为 Lv.${res.main.level}，属性已按新成长值重算</small>`);
          if (UI.showDialog) UI.showDialog({ icon: '♻️', speaker: '涅槃', text: `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}<br>等级重置为 Lv.${res.main.level}` });
          closeMergePanel();
          // 融合后立即把主宠设为出战并刷新：面板用新成长值 × 当前等级重算全部属性并即时显示
          setActive(res.main.id);
          UI.renderAll();
        };
        };
        render(false);
      };
    });
  }
  function closeMergePanel() {
    $('merge-modal').style.display = 'none';
  }

  /* ---------- 宠物合成面板（选副宠 → 预览新宠成长/变异概率 → 确认） ---------- */
  // 合成：两只素材宠 → 概率合成一只全新「·异变」稀有宠（消耗合成之石）
  function openSynthPanel(main) {
    const S = Config.synthesize || {};
    const body = $('merge-body');
    if (Object.values(main.equipment || {}).some(Boolean)) {
      body.innerHTML = `
        <div class="merge-main">${iconHtml(main.name, main.icon)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
        <div class="merge-preview">⚠️ <b>${main.name} 穿着装备，不能合成。</b><br>请先卸下装备再合成。</div>`;
      $('merge-modal').style.display = 'flex';
      return;
    }
    const cands = Merge.getMergeCandidates(main.id, S);
    const baseHtml = `
      <div class="merge-main">主素材：${iconHtml(main.name, main.icon)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
      <div class="merge-tip">消耗 <b>${S.material && S.material.amount} 颗${S.material && S.material.name}</b>（持有 ${Materials.getQuantity(S.material && S.material.name)}）· 概率 <b>${Math.round((S.mutation && S.mutation.chance || 0) * 100)}%</b> 合成出全新「·异变」稀有宠</div>
      <div class="merge-tip">选择副素材（两只素材宠都会消失，合成一只新宠）：</div>`;
    let html = baseHtml;
    if (!cands.length) {
      html += `<div class="inv-empty">没有可用的副素材（需要另一只 ${S.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
    } else {
      html += '<div class="merge-cands">' + cands.map(c =>
        `<button class="merge-cand" data-id="${c.id}">${iconHtml(c.name, c.icon)} ${c.name}（成长 ${c.growth.toFixed(1)}）</button>`
      ).join('') + '</div>';
    }
    body.innerHTML = html;
    $('merge-modal').style.display = 'flex';

    body.querySelectorAll('.merge-cand').forEach(btn => {
      btn.onclick = () => {
        const sub = getPets().find(p => p.id === Number(btn.dataset.id));
        if (!sub) return;
        // 预览两种结果：普通合成 vs 变异合成
        const normalGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, false) : null;
        const mutatedGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, true) : null;
        const mutPct = Math.round((S.mutation && S.mutation.chance || 0) * 100);
        body.innerHTML = baseHtml + `
          <div class="merge-preview">
            <div>合成结果：一只全新的 <b>${iconHtml(main.name, main.icon)} ${main.name}${mutPct ? '（·异变）' : ''}</b>，等级回 1</div>
            <div>普通成长：<b>${normalGrowth !== null ? normalGrowth.toFixed(1) : '?'}</b></div>
            ${mutPct ? `<div class="merge-mutation">🧬 有 <b>${mutPct}%</b> 概率变异：新宠成长额外 +${(S.mutation && S.mutation.growthBonus[0])}~${(S.mutation && S.mutation.growthBonus[1])}（如 ${mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?'}），名字带「·异变」后缀，更稀有</div>` : ''}
            <div>两只素材宠（${main.name}、${sub.name}）都将消失，消耗 ${S.material.amount} 颗${S.material.name}</div>
            <div style="margin-top:8px"><button class="btn-mini primary" id="merge-ok">确认合成</button></div>
          </div>`;
        const okBtn = body.querySelector('#merge-ok');
        okBtn.onclick = async () => {
          // 连点防护：合成要跑多次云端往返（getUser/扣材料/建档/删素材），期间按钮仍可点，
          // 一次点击可能跑出两只新宠并扣两份材料 → 先禁用，跑完再放开
          if (okBtn.disabled) return;
          okBtn.disabled = true;
          try {
            const res = await Merge.synthesize(main.id, sub.id);
            if (res.error) { showToast('❌ 合成失败', res.error); return; }
            if (res.cloudWarn) showToast('⚠️ 云端建档失败', res.cloudWarn + '，请刷新页面重试');
            if (res.mutated) {
              addLog(`💠🌟 合成变异成功！${res.mainName}+${res.subName} 合成了全新稀有宠【${res.baby.name}】成长 ${res.newGrowth.toFixed(1)}！`);
              showToast('💠🌟 合成变异成功！', `${iconHtml(res.baby.name, res.baby.icon)} <b style="color:#c9a86a">【${res.baby.name}】</b><br><small>成长值 ${res.newGrowth.toFixed(1)} · 全新稀有宠</small>`);
              if (UI.showDialog) UI.showDialog({ icon: '💠🌟', speaker: '合成', text: `合成变异成功！<br>${res.mainName}+${res.subName} → <b style="color:#c9a86a">【${res.baby.name}】</b><br>成长值 ${res.newGrowth.toFixed(1)}` });
            } else {
              addLog(`💠 合成成功！${res.mainName}+${res.subName} 合成了新宠 ${res.baby.name}（成长 ${res.newGrowth.toFixed(1)}）`);
              showToast('💠 合成成功！', `${iconHtml(res.baby.name, res.baby.icon)} ${res.baby.name}｜成长值 ${res.newGrowth.toFixed(1)}`);
            }
            closeMergePanel();
            if (res.baby && res.baby.id) { setActive(res.baby.id); }
            UI.renderAll();
          } finally {
            okBtn.disabled = false;
          }
        };
      };
    });
  }

  /* ---------- 宠物进化面板（可配置多层树：选下一形态 → 预览素材/属性 → 确认） ---------- */
  function openEvolvePanel(pet) {
    const E = Config.pet.evolution || {};
    const body = $('evolve-body');
    const routes = Evolve.getEvolutionRoutes(pet);
    const maxTimes = E.maxEvolveTimes || 10;
    const times = pet.evolveTimes || 0;
    const maxed = times >= maxTimes;
    // 进化素材按已进化次数分档（1~3普通/4~6精粹/7~10传说），面板用 Evolve.getRouteMaterial 拿当前档素材
    const rm = (routes.length && Evolve.getRouteMaterial(pet, 0)) || null;
    const matName = (rm && rm.name) || E.materialName || '进化素材';
    const have = rm ? rm.have : Materials.getQuantity(matName);
    let html = `<div class="merge-main">${iconHtml(pet.name, pet.icon, true)} ${pet.name}（Lv.${pet.level} · 成长 ${pet.growth.toFixed(1)}）</div>`;
    html += `<div class="merge-preview">进化次数 <b>${times}/${maxTimes}</b>；转生 <b>${pet.rebornCount || 0} 次</b>；消耗 <b>${matName} ×1</b>（持有 ${have}）</div>`;
    if (maxed) {
      html += `<div class="merge-preview">🔒 进化已达上限(${maxTimes}次)，需通过<b>融合(转生)</b>重置进化次数后才能继续</div>`;
    } else if (!routes.length) {
      html += `<div class="merge-preview">该形态无法再进化</div>`;
    } else {
      html += `<div class="merge-tip">选择进化方向（<b>等级不变</b>、每次成长+0.1~0.2、主要<b>更换形态</b>；成长大幅提升靠<b>融合</b>）</div>`;
      html += '<div class="merge-cands">' + routes.map((r, i) => {
        const ok = pet.level >= (r.minLevel || 1);
        const sub = r.keepForm ? '成长+（形态不变）' : (r.minLevel ? '需 Lv.' + r.minLevel : '可进化');
        return `<button class="merge-cand evolve-route${ok ? '' : ' disabled'}" data-i="${i}"${ok ? '' : ' disabled'}>
          ${iconHtml(r.to, r.icon, true)} ${r.to}<br><small>${sub}</small></button>`;
      }).join('') + '</div>';
    }
    body.innerHTML = html;
    $('evolve-modal').style.display = 'flex';

    body.querySelectorAll('.evolve-route').forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const i = Number(btn.dataset.i);
        const route = routes[i];
        const cur = getStats(pet);
        const boost = window.Util.randFloat(E.growthBoost[0], E.growthBoost[1]);
        const nextGrowth = Math.round((pet.growth + boost) * 10) / 10;
        const next = getStats({ ...pet, growth: nextGrowth }); // 等级不变，仅成长提升
        const row = (label, a, b) => {
          const cls = b > a ? 'delta-up' : '';
          const arrow = b > a ? '▲' : '';
          return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${arrow}</span></div>`;
        };
        const statHtml = row('生命', cur.hp, next.hp) + row('攻击', cur.atk, next.atk)
          + row('防御', cur.def, next.def) + row('速度', cur.spd, next.spd);
        const formText = route.keepForm
          ? `形态不变，成长值提升`
          : `进化后名字变为【${route.to}】`;
        body.innerHTML = `
          <div class="merge-main">${iconHtml(pet.name, pet.icon)} ${pet.name}（Lv.${pet.level} · 成长 ${pet.growth.toFixed(1)}）</div>
          <div class="merge-preview">
            <div>路线：<b>${iconHtml(route.to, route.icon)} ${route.to}</b>（${route.minLevel ? '需 Lv.' + route.minLevel : '无等级要求'}）</div>
            <div>消耗：<b>${matName} ×1</b>（当前持有 ${have}）</div>
            <div class="hint">等级不变（Lv.${pet.level}）；${formText}；进化次数 ${times}→${times + 1}</div>
            <div class="merge-stats">属性变化（等级不变）：</div>
            ${statHtml}
            <div style="margin-top:8px"><button class="btn-mini primary" id="evolve-ok">确认进化</button></div>
          </div>`;
        body.querySelector('#evolve-ok').onclick = async () => {
          const origName = pet.name;
          const origGrowth = pet.growth;
          const res = await Evolve.evolve(pet.id, i);
          if (res.error) { showToast('❌ 进化失败', res.error); return; }
          const changed = res.keepForm ? '（形态不变）' : '';
          addLog(`🌟 进化成功！${origName} 成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${changed}，进化次数 ${res.pet.evolveTimes}/${maxTimes}`);
          showToast('🌟 进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)} · 进化次数 ${res.pet.evolveTimes}/${maxTimes}</small>`);
          if (UI.showDialog) UI.showDialog({ icon: '🌟', speaker: '进化', text: `进化成功！<br>${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}` });
          closeEvolvePanel();
          UI.renderAll();
        };
      };
    });
  }
  function closeEvolvePanel() {
    $('evolve-modal').style.display = 'none';
  }

  /* ---------- 对外 API（宠物页） ---------- */
  UI.renderPetPanel = renderPetPanel;
  UI.renderPetList = renderPetList;
  UI.showPetTip = showPetTip;
  UI.hidePetTip = hidePetTip;
  UI.bindPetTip = bindPetTip;
  UI.updatePetStatsPanel = updatePetStatsPanel;
  UI.renderEquipPetStats = renderEquipPetStats;
  UI.renderEquipSlots = renderEquipSlots;
  UI.renderMergeHint = renderMergeHint;
  UI.renderEvolveHint = renderEvolveHint;
  UI.renderMergeTab = renderMergeTab;
  UI.renderSynthTab = renderSynthTab;
  UI.renderEvolveTab = renderEvolveTab;
  UI.renderPetEquipInv = renderPetEquipInv;
  UI.renderEggPanel = renderEggPanel;
  UI.openMergePanel = openMergePanel;
  UI.closeMergePanel = closeMergePanel;
  UI.openSynthPanel = openSynthPanel;
  UI.openEvolvePanel = openEvolvePanel;
  UI.closeEvolvePanel = closeEvolvePanel;
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
    const downP = Math.round(((cfg.down != null ? cfg.down : 0.1)) * 100);
    const cap = (cfg.cap != null ? cfg.cap : 3);
    const label = type === 'nirvana' ? '涅槃植入' : '合成继承';
    return '<div class="es-preview-row">' + label + '：副宠特质（' + escapeHtml(names) + '）' +
      giveP + '% 概率继承（主宠成长≥' + (cfg.growthMin != null ? cfg.growthMin : 60) + ' 额外 +' +
      Math.round((cfg.growthBonus != null ? cfg.growthBonus : 0.1) * 100) + '%；T 阶 ' + upP + '% 升 / ' + downP +
      '% 降；上限 ' + cap + ' 条）</div>';
  }
  PetUI.iconHtml = iconHtml;
  PetUI.petTipHtml = petTipHtml;
  PetUI.showPetTip = showPetTip;
  PetUI.hidePetTip = hidePetTip;
  PetUI.bindPetTip = bindPetTip;
  PetUI.flashStat = flashStat;
  PetUI.traitsHtml = traitsHtml;
  PetUI.traitInheritLine = traitInheritLine;
  UI.traitsHtml = traitsHtml;
})();