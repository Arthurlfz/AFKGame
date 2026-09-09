/* ============================================================
 * ui-pet-awaken.js —— 宠物页「觉醒」tab（2026-09-10 v2 觉醒改版）
 * 觉醒 = 永久标记（pet.awakened）：宠物页用「觉醒石」激活，与等级无关，
 *       涅槃/转生不清除。觉醒加成 = 主动技能伤害+20% + 血统线定位加成（Config.awakenBonus）。
 * 觉醒石来源：任务「觉醒之路」（图 1~10 区域材料 ×888 求和，可反复交）。
 * 门槛：必须是终形态（名字在 activeSkills 表 / 神级宠查对应线终形态）——
 *       觉醒加成挂在主动技能上，非终形态宠没有技能，觉醒无意义。
 * 落盘：pets.awaken_trait = '1'（复用旧列，缺列时 savePet 容错剔除）。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI;
  const { escapeHtml, showToast, addLog } = UI;
  const Config = window.Config;
  const Materials = window.Materials;
  const PetSprites = window.PetSprites;
  const PetUI = window.PetUI || {};
  const iconHtml = PetUI.iconHtml || (n => escapeHtml(n));

  const STONE = '觉醒石';
  let awakenMainId = null;
  let inFlight = false;   // 觉醒提交闸门（连点防重入）

  /* 觉醒目标技能：与 pet.js getAwakenState 同一套名字解析（变异剥后缀 / 神级宠查 sprite 名） */
  function awakenTargetSkill(pet) {
    const skills = (Config.pet && Config.pet.evolution && Config.pet.evolution.activeSkills) || {};
    let base = String(pet.name || '').replace(/·异变$/, '');
    if (window.Pet.isGodPet && window.Pet.isGodPet(pet)) {
      const sp = window.Pet.spriteNameOf ? window.Pet.spriteNameOf(pet) : null;
      if (sp) base = sp;
    }
    return skills[base] || null;
  }

  /* 觉醒任务（觉醒之路）进度：10 种区域材料每种 888，取最短板 */
  function awakenQuestInfo() {
    const q = (Config.drop.quests || []).find(x => x.id === 'awaken_road');
    if (!q || !Array.isArray(q.matList)) return null;
    const have = q.matList.reduce((min, n) => Math.min(min, Materials.getQuantity(n)), Infinity) || 0;
    return { need: q.need, have, matList: q.matList, done: have >= q.need };
  }

  function petList() {
    return (window.Pet.getPets ? window.Pet.getPets() : []).filter(p => p.awakened || awakenTargetSkill(p));
  }

  /* ---------- 渲染 ---------- */
  function renderAwakenTab() {
    const list = document.getElementById('awaken-pet-list');
    const detail = document.getElementById('awaken-detail');
    if (!list || !detail) return;

    /* 左：魂兽名录（终形态 + 已觉醒） */
    const pets = petList();
    list.innerHTML = '';
    if (!pets.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = '还没有终形态魂兽：先进化到终阶（Lv60）再来觉醒';
      list.appendChild(empty);
    }
    for (const pet of pets) {
      const card = document.createElement('div');
      const isGod = window.Pet.isGodPet && window.Pet.isGodPet(pet);
      card.className = 'pet-card' + (pet.id === awakenMainId ? ' active' : '') + (isGod ? ' pet-card--god' : '');
      const gbar = Math.max(4, Math.min(100, Math.round(pet.growth || 0)));
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="card-info">
          <div class="pname">${escapeHtml(pet.name)}${pet.awakened ? ' <span class="awaken-badge">已觉醒</span>' : ''}</div>
          <div class="meta">Lv.${pet.level} · 成长${(pet.growth || 0).toFixed(1)} · 转生 ${pet.rebornCount || 0}</div>
          <div class="growth-bar"><i style="width:${gbar}%"></i></div>
        </div>`;
      card.onclick = () => { awakenMainId = pet.id; UI.renderAll(); };
      list.appendChild(card);
    }

    /* 右：觉醒详情 */
    const pet = pets.find(p => p.id === awakenMainId) || null;
    if (!pet) { detail.innerHTML = '<div class="hint">← 先在左侧选一只魂兽</div>'; return; }

    const stoneHave = Materials.getQuantity(STONE);
    const quest = awakenQuestInfo();
    const skill = awakenTargetSkill(pet);
    const aw = window.Pet.getAwakenState ? window.Pet.getAwakenState(pet) : null;
    const STAT_CN = { hp: '生命', atk: '攻击', def: '防御', spd: '速度', crit: '暴击率', critDamage: '暴击伤害', hit: '命中', dodge: '闪避', lifesteal: '吸血', pen: '穿透', dmgBonus: '伤害加成', dr: '受伤减免' };
    const bonusLine = (aw && aw.bonus && aw.bonus.stat != null)
      ? `<div class="pv"><div class="k">血统加成</div><div class="v">${STAT_CN[aw.bonus.stat] || aw.bonus.stat}+${aw.bonus.value}${aw.bonus.stat === 'spd' ? '' : '%'}</div></div>` : '';

    /* 已觉醒：状态卡 */
    if (aw) {
      detail.innerHTML = `
        <div class="merge-hint">
          <div class="pv"><div class="k">觉醒状态</div><div class="v"><span class="awaken-badge">已觉醒 · 永久生效</span></div></div>
          <div class="pv"><div class="k">主动技能</div><div class="v">${escapeHtml(aw.skillName || '')} · 伤害+${Math.round((aw.damage || 0) * 100)}%</div></div>
          ${bonusLine}
          <div class="hint">觉醒永久保留：涅槃 / 转生不清除，等级回 1 也不失效。</div>
        </div>`;
      return;
    }

    /* 未觉醒：门槛 + 材料 + 按钮 */
    let block = '';
    if (!skill) {
      block = '<div class="hint">该魂兽尚未到达终形态：先在「进化」页进化到终阶，再回来觉醒。</div>';
    } else {
      const questLine = quest
        ? `任务进度：每种 ${quest.have} / ${quest.need}（图 1~10 十种区域材料每种 888，任务面板「觉醒之路」可反复提交）`
        : '任务「觉醒之路」未配置';
      const canDo = stoneHave >= 1;
      block = `
        <div class="merge-hint">
          <div class="pv"><div class="k">觉醒石</div><div class="v">持有 ${stoneHave} / 需要 1</div></div>
          <div class="pv"><div class="k">来源</div><div class="v">${questLine}</div></div>
          <div class="pv"><div class="k">觉醒后</div><div class="v">${escapeHtml(skill.name)} 伤害+${Math.round((Config.awakenSkillDamage != null ? Config.awakenSkillDamage : 0.2) * 100)}%（永久）</div></div>
          ${bonusLine ? bonusLine.replace('血统加成', '觉醒后血统加成') : ''}
          <div class="panel-actions">
            <button type="button" class="fs-btn fs-btn--primary" id="btn-awaken-go" ${canDo ? '' : 'disabled'}>
              ${canDo ? `✨ 消耗 ${STONE} ×1 觉醒「${escapeHtml(pet.name)}」` : `缺少${STONE}：先去交「觉醒之路」任务`}
            </button>
          </div>
          <div class="hint">觉醒永久生效，涅槃 / 转生不清除；觉醒消耗 1 颗${STONE}，石头不会返还。</div>
        </div>`;
    }
    detail.innerHTML = block;

    const go = document.getElementById('btn-awaken-go');
    if (go && !go.disabled) go.onclick = () => doAwaken(pet, go);
  }

  /* ---------- 觉醒动作：先扣石 → 本地生效 → 云端落盘（失败全量回退） ---------- */
  async function doAwaken(pet, btn) {
    if (inFlight) return;
    inFlight = true;
    if (btn) btn.disabled = true;
    try {
      const spent = await Materials.spend(STONE, 1);
      if (!spent.ok) {
        showToast(spent.error || `${STONE}扣减失败`);
        return;
      }
      pet.awakened = true;
      if (pet.cloudId && window.Supabase && window.Supabase.updatePet) {
        const { error } = await window.Supabase.updatePet(pet.cloudId, { awaken_trait: '1' });
        if (error) {
          pet.awakened = false;
          await Materials.gain(STONE, 1);   // 云端写失败 → 石头退回，本地回退
          showToast('⚠️ 觉醒云端保存失败，已回退：' + (error.message || '未知错误'));
          UI.renderAll();
          return;
        }
      }
      const aw = window.Pet.getAwakenState ? window.Pet.getAwakenState(pet) : null;
      addLog(`✨「${pet.name}」觉醒成功：${aw ? aw.skillName : '主动技能'} 伤害+${Math.round((aw ? aw.damage : 0.2) * 100)}%，永久生效！`);
      UI.renderAll();
    } catch (e) {
      // 任何异常都要把按钮放回来，别让玩家以为功能坏了
      showToast('觉醒失败：' + (e && e.message || '未知错误'));
    } finally {
      inFlight = false;
      if (btn) btn.disabled = false;
      renderAwakenTab();
    }
  }

  UI.renderAwakenTab = renderAwakenTab;
})();
