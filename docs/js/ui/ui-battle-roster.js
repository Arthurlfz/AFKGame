/* ============================================================
 * ui/ui-battle-roster.js —— 唯一职责：战斗页右侧【出战宠物竖列】（头像 + 悬停详情 + 快捷入口）。
 * 从 ui-battle.js 迁出（2026-09-21，一个文件一个职责）。
 *
 * 对外：`UI.renderRoster()`（renderAll / 点宠出战之后调用）
 * 依赖：`Pet`（getActivePet / getPets / getStats / getBonusText / setActive）、`PetSprites.avatarOf`、
 *      `UI`（$ / escapeHtml / showToast / addLog / renderAll / switchPage / syncCombatantSnapshot）、
 *      `Market.isListed`（已上架的宠不能出战）。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $ } = UI;
  const { getActivePet, getPets, getStats, getBonusText, setActive } = window.Pet;
  const PetSprites = window.PetSprites;

  function renderRoster() {
    const box = $('pet-roster');
    if (!box) return;
    box.innerHTML = '';
    const active = getActivePet();
    const tipBox = $('roster-tooltip');
    for (const pet of getPets()) {
      const s = getStats(pet);
      const equipCount = Object.values(pet.equipment || {}).filter(Boolean).length;
      const bonusText = getBonusText ? getBonusText(pet) : '';
      const btn = document.createElement('div');
      btn.className = 'roster-pet' + (active && pet.id === active.id ? ' active' : '');
      btn.dataset.id = pet.id;
      // 出战竖列用头像版（小尺寸更清晰）
      const avatarSrc = PetSprites && PetSprites.avatarOf(pet.name);
      const iconHtml = avatarSrc ? '<img class="pet-avatar-sprite" src="' + avatarSrc + '" alt="">' : '';
      btn.innerHTML = `<span class="roster-pet-icon">${iconHtml}</span><span class="rp-lv">${pet.level}</span>`;
      btn.onclick = () => {
        if (pet.cloudId && window.Market && Market.isListed && Market.isListed(pet.cloudId)) {
          UI.showToast('⚠️ 已上架的宠物不能出战', '请先在市场取回');
          return;
        }
        setActive(pet.id);
        if (UI.addLog) UI.addLog(` ${pet.name} 出战！`, 'battle');
        if (UI.syncCombatantSnapshot) UI.syncCombatantSnapshot(); // 战斗页被占用时它自己会让位（见那边说明）
        renderRoster();
        if (UI.renderAll) UI.renderAll();
      };
      box.appendChild(btn);
    }
    // 事件委托到竖列容器（容器不随 renderAll 重建，悬停状态稳定）：hover 头像 → 共享 tooltip
    if (tipBox && !box.__rosterBound) {
      box.__rosterBound = true;
      const showTipFor = (pet, anchor) => {
        const s = getStats(pet);
        const equipCount = Object.values(pet.equipment || {}).filter(Boolean).length;
        const bonusText = getBonusText ? getBonusText(pet) : '';
        const active = getActivePet();
        // 复用怪物悬浮框同款结构（.enemy-tip-*），只保留宠物该有的信息，不照搬怪物"掉落信息"
        tipBox.className = 'roster-tooltip enemy-tip';
        tipBox.innerHTML = `<div class="enemy-tip-title">
            <strong>${escapeHtml(pet.name)}</strong>
            <span>Lv.${pet.level}</span>
            ${active && pet.id === active.id ? '<b class="enemy-type evolved">出战</b>' : ''}
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">成长</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row">成长值<b>${pet.growth.toFixed(1)}</b></div>
              <div class="enemy-tip-row">经验<b>${pet.exp || 0}</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">基础属性</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row" data-enemy-hp>生命<b>${s.hp}</b></div>
              <div class="enemy-tip-row">攻击<b>${s.atk}</b></div>
              <div class="enemy-tip-row">防御<b>${s.def}</b></div>
              <div class="enemy-tip-row">速度<b>${s.spd}</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">战斗属性</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row">暴击<b>${Math.round(s.critRate * 100)}%</b></div>
              <div class="enemy-tip-row">暴伤<b>${Math.round(s.critDamage * 100)}%</b></div>
              <div class="enemy-tip-row">命中<b>${Math.round(s.hit)}</b></div>
              <div class="enemy-tip-row">闪避<b>${Math.round(s.dodge)}</b></div>
              <div class="enemy-tip-row">吸血<b>${Math.round(s.lifesteal * 100)}%</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">装备</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row" style="grid-column:1/-1">已装备<b>${equipCount}/12${bonusText && bonusText !== '无' ? '（' + escapeHtml(bonusText) + '）' : ''}</b></div>
            </div>
          </div>
          <div class="roster-quick-actions">
            <button class="rqa-btn" data-rqa="evolve">进化</button>
            <button class="rqa-btn" data-rqa="synth">合成</button>
            <button class="rqa-btn" data-rqa="equip">装备</button>
          </div>`;
        const r = anchor.getBoundingClientRect();
        tipBox.style.left = (r.right + 8) + 'px';
        tipBox.style.top = Math.max(6, r.top) + 'px';
        tipBox.classList.add('show');
      };
      let hoverTarget = null; // 记录当前 hover 的宠物，供按钮点击用
      const hideTip = () => tipBox.classList.remove('show');
      box.addEventListener('mouseover', (e) => {
        const el = e.target.closest ? e.target.closest('.roster-pet') : null;
        if (!el) return;
        hoverTarget = getPets().find(p => p.id === Number(el.dataset.id));
        if (hoverTarget) showTipFor(hoverTarget, el);
      });
      box.addEventListener('mouseout', (e) => {
        if (e.target.closest && e.target.closest('.roster-pet')) hideTip();
      });
      // 鼠标移到 tooltip 上不消失；点快捷按钮跳转
      tipBox.addEventListener('mouseenter', () => { tipBox.classList.add('show'); });
      tipBox.addEventListener('mouseleave', hideTip);
      tipBox.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('.rqa-btn') : null;
        if (!btn || !hoverTarget) return;
        const action = btn.dataset.rqa;
        if (action === 'equip') {
          if (window.UI && UI.switchPage) UI.switchPage('equip');
        } else {
          if (window.UI && UI.switchPage) UI.switchPage('pet');
          setTimeout(() => {
            const tab = document.querySelector('.pet-tab[data-pet-tab="' + action + '"]');
            if (tab) tab.click();
          }, 100);
        }
        hideTip();
      });
    }
  }

  UI.renderRoster = renderRoster;
})();
