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
      else pa.textContent = '';
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
      // 用 skillOf 而不是 activeSkills[名字]：变异宠名字带「·异变」，直接查表必然查不到，
      // 结果就是"明明有技能却显示未解锁"。skillOf 会剥后缀查本体（config 里现成的）。
      const evo = Config.pet.evolution || {};
      const skill = (evo.skillOf ? evo.skillOf(pet.name) : null) || (evo.activeSkills || {})[pet.name];
      // 触发概率以前全项目 UI 都没有展示（只有战斗逻辑在读），玩家只能看到"有技能"却不知道多强
      const chanceTxt = skill ? `${Math.round((skill.triggerChance || 0) * 100)}% 概率发动` : '';
      const effect = skill ? `${Math.round(skill.damageMultiplier * 100)}% 伤害${skill.maxHpDamageRate ? ` + 目标最大生命 ${Math.round(skill.maxHpDamageRate * 100)}%` : ''}` : '';
      skillInfo.textContent = skill
        ? `主动技能：${skill.name} · ${chanceTxt} · ${effect} · ${skill.cooldownTurns} 回合冷却`
        : '主动技能：终形态 Lv.60 解锁';
    }
    // 血脉特质胶囊（出战面板常驻；空态显示"无血脉特质"）
    const traitsEl = $('pet-traits');
    if (traitsEl) {
      const th = PetUI.traitsHtml(pet);
      traitsEl.innerHTML = th || '<span class="trait-none">无血脉特质</span>';
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
    const av = $id('avatar');
    if (av) {
      if (PetSprites && PetSprites.mountAnimated(av, pet.name)) {}
      else if (PetSprites && PetSprites.mountAvatar(av, pet.name)) {}
      else av.textContent = '';
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
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(pet) : !!pet.isGodPet;
      card.className = 'pet-card' + (isActive ? ' active' : '') + (isGod ? ' pet-card--god' : '');
      card.innerHTML = `${isActive ? '<div class="pet-card-badge">出战</div>' : ''}
        ${isGod ? '<div class="pet-card-god-badge">神</div>' : ''}
        <div class="icon">${iconHtml(pet.name)}</div>
        <div class="pname">${pet.name}</div>
        ${(function(){var bl=window.Pet&&window.Pet.getBloodline?window.Pet.getBloodline(pet):null;return bl?'<div class="pet-card-bloodline">血统 · '+bl.name+'</div>':'';})()}
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}${window.Pet&&window.Pet.stageLabel?' · '+window.Pet.stageLabel(pet):''}</div>
        <div class="meta">装备${equipCount}/12</div>`;
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
        // 点槽位 → 右侧面板显示穿戴详情（可脱下）；不再挂 hover 浮层（根治遮挡）
        item.onclick = (e) => { e.stopPropagation(); bagActiveEqId = eq.id; if (UI.renderBagEqDetail) UI.renderBagEqDetail(eq); };
        const takeBtn = document.createElement('button');
        takeBtn.className = 'btn-sm ghost slot-unequip';
        takeBtn.textContent = '脱下';
        takeBtn.onclick = (e) => { e.stopPropagation(); const taken = unequip(pet, slot); if (taken) { addLog(`脱下 ${taken.name}，放回背包`); UI.renderAll(); } };
        item.appendChild(takeBtn);
        div.title = '点击看详情';
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