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
  const Evolve = window.Evolve || { canEvolve: () => false, getEvolutionRoutes: () => [], getRouteMaterial: () => null };
  const PetSprites = window.PetSprites;
  const PetUI = window.PetUI || (window.PetUI = {});
  const { iconHtml, petTipHtml, showPetTip, hidePetTip, bindPetTip, flashStat, traitInheritLine } = PetUI;

  let synthMainId = null, synthSubId = null, synthItemId = '';  // '' = 不使用道具，也能合成（只消耗基础合成之石）

  function renderSynthTab() {
    const list = $('synth-pet-list');
    if (!list) return;
    const S = Config.synthesize || {};
    list.innerHTML = '';
    const mainPet = getPets().find(p => p.id === synthMainId);
    const cands = getPets().filter(p => {
      const ec = Object.values(p.equipment || {}).filter(Boolean).length;
      return !ec && Merge.canSynthesize(p) && p.cloudId && !(Market && Market.isListed(p.cloudId));
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
      card.className = 'pet-card'+ (pet.id === synthMainId ? ' active': '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="pname">${pet.name}</div>
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}</div>${UI.traitsHtml(pet)}`;
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
    // 神级宠门槛（手册 2.6）：终阶 + 成长 ≥ minGrowth
    const minG = (Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
    const mainStage = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(main) : 1;
    const mainGodReady = mainStage >= (S.god && S.god.minStage || 5) && main.growth >= minG;
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）· 变异 ${mutPct}%</div>
      <div class="hint">${mainStage >= 5 ? (mainGodReady ? '⚡ 终阶 + 成长达标（≥' + minG + '）：满足神级宠条件' : '已终阶，但成长未达 ' + minG + '（神级宠门槛）'): '未终阶（' + mainStage + '/5 阶），与神级宠无缘'}</div></div>`;
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id, S) : [];
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副素材（需要另一只 ${S.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<div class="es-tip">选择副素材（两只素材宠都会消失，合成一只新宠）：</div><div class="es-sub-grid">'+
      subs.map(s => {
        const sel = s.id === synthSubId ? ' selected': '';
        return `<button class="es-route${sel}" data-sub="${s.id}">
          <div class="es-route-icon">${iconHtml(s.name)}</div>
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
    const normalGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, false, synthItemId) : null;
    const mutatedGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, true, synthItemId) : null;
    const matOk = haveMat >= matAmt;
    // 道具下拉框（第二版手册 2.2：合成道具化）
    const synthItems = (Config.itemsOf ? Config.itemsOf('synth') : []).filter(i => i.category === 'synth');
    const curItem = synthItemId ? (Config.itemOf ? Config.itemOf(synthItemId) : null) : null;
    const itemOk = !synthItemId || !curItem || (Materials.getQuantity ? Materials.getQuantity(curItem.name) : 0) >= 1;
    const itemSelectHtml = `<div class="es-preview-row">合成道具：<select id="synth-item-select" style="margin-left:6px;">
      <option value="" ${!synthItemId ? 'selected' : ''}>不使用道具（无加成）</option>
      ${synthItems.map(i => {
        const have = Materials.getQuantity ? Materials.getQuantity(i.name) : 0;
        return `<option value="${i.id}" ${i.id === synthItemId ? 'selected' : ''} ${have < 1 ? 'disabled' : ''}>${i.icon} ${i.name}（${i.effect}）×${have}</option>`;
      }).join('')}
    </select></div>`;
    // 神级宠判定（第二版手册 2.2：道具化）：门槛 + 概率由选中道具 godChance 决定
    const gi = Merge.godSynthInfo ? Merge.godSynthInfo(main, sub, synthItemId) : null;
    const stg = p => (window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(p) : ((p.evolveTimes || 0) + 1));
    const godRow = (gi && gi.god)
      ? `<div class="es-preview-row">⚡ <b>神级宠【${gi.god.name}】</b>：<b style="color:#f2b632">${Math.round(gi.chance * 100)}%</b> 概率出生（成长系数 +50%、可涅槃）</div>`
      : `<div class="es-preview-row hint">神级宠门槛：两只都需<b>终阶</b>（5 阶）+ 成长 ≥ ${gi ? gi.minGrowth : 60}（当前：主宠 ${stg(main)}/5 阶·成长 ${main.growth.toFixed(1)}｜副宠 ${stg(sub)}/5 阶·成长 ${sub.growth.toFixed(1)}）</div>`;
    pb.innerHTML = `
      <div class="es-preview-row">合成结果：一只全新的 <b>${iconHtml(gi && gi.god && gi.ready ? gi.god.name : main.name)} ${gi && gi.god && gi.ready ? gi.god.name : main.name}${mutPct ? '（·异变）': ''}</b>，等级回 1</div>
      <div class="es-preview-row">普通成长：<b>${normalGrowth !== null ? normalGrowth.toFixed(1) : '?'}</b></div>
      ${itemSelectHtml}
      ${godRow}
      ${mutPct ? `<div class="es-preview-row"> 有 <b>${mutPct}%</b> 概率变异：成长额外 +${(S.mutation && S.mutation.growthBonus[0])}~${(S.mutation && S.mutation.growthBonus[1])}（如 ${mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?'}），名字带「·异变」</div>` : ''}
      <div class="es-preview-row">两只素材（${main.name}、${sub.name}）都将消失，消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）</div>
      ${traitInheritLine(main, sub, 'synth')}
      ${!matOk ? `<div class="es-preview-row warn"> 材料不足：需要 ${matAmt} 颗${matName}，当前持有 ${haveMat}</div>` : ''}`;
    cb.innerHTML = `<button class="btn-mini primary" id="synth-ok"${matOk && itemOk ? '': 'disabled'}>确认合成</button>`;
    const itemSel = document.getElementById('synth-item-select');
    if (itemSel) {
      itemSel.onchange = () => { synthItemId = itemSel.value; renderSynthPreview(main, matName, matAmt, haveMat, mutPct); };
    }
    cb.querySelector('#synth-ok').onclick = async () => {
      if (!matOk || !itemOk) { showToast('无法合成', synthItemId ? '材料或道具不足' : '材料不足'); return; }
      const res = await Merge.synthesize(main.id, sub.id, synthItemId);
      if (res.error) { showToast('合成失败', res.error); return; }
      if (res.isGod) {
        // 神级宠降世（手册 2.6）：金色特殊提示
        addLog(`⚡ 神级宠降世！${res.mainName}+${res.subName} 合成出【${res.baby.name}】，成长 ${res.newGrowth.toFixed(1)}！`);
        showToast('⚡ 神级宠降世！', `${iconHtml(res.baby.name)} <b style="color:#f2b632">【${res.baby.name}】</b>（神级宠 · 成长系数+50% · 可涅槃）<br><small>成长值 ${res.newGrowth.toFixed(1)}</small>`);
      } else if (res.mutated) {
        addLog(`合成变异成功！${res.mainName}+${res.subName} 合成了全新稀有宠【${res.baby.name}】成长 ${res.newGrowth.toFixed(1)}！`);
        showToast('合成变异成功！', `${iconHtml(res.baby.name)} <b style="color:#c9a86a">【${res.baby.name}】</b><br><small>成长值 ${res.newGrowth.toFixed(1)}</small>`);
      } else {
        addLog(`合成成功！${res.mainName}+${res.subName} 合成了新宠 ${res.baby.name}（成长 ${res.newGrowth.toFixed(1)}）`);
        showToast('合成成功！', `${iconHtml(res.baby.name)} ${res.baby.name}｜成长值 ${res.newGrowth.toFixed(1)}`);
      }
      synthMainId = res.baby && res.baby.id ? res.baby.id : null;
      synthSubId = null;
      UI.renderAll();
    };
  }



  /* ---------- 对外 API ---------- */
  UI.renderSynthTab = renderSynthTab;
})();
