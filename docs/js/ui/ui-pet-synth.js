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

  function statRows(pet) {
    const s = getStats(pet);
    return `<div><span>生命</span><b>${s.hp}</b></div><div><span>攻击</span><b>${s.atk}</b></div><div><span>防御</span><b>${s.def}</b></div><div><span>速度</span><b>${s.spd}</b></div>`;
  }

  function renderSynthTab() {
    const list = $('synth-pet-list');
    if (!list) return;
    const S = Config.synthesize || {};
    list.innerHTML = '';
    const mainPet = getPets().find(p => p.id === synthMainId);
    const cands = getPets().filter(p => {
      const ec = Object.values(p.equipment || {}).filter(Boolean).length;
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(p) : !!p.isGodPet;
      // 神级宠不准参与合成（2026-09-11 拍板），列表里直接不出现
      return !ec && !isGod && Merge.canSynthesize(p) && p.cloudId && !(Market && Market.isListed(p.cloudId));
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
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(pet) : !!pet.isGodPet;
      card.className = 'pet-card'+ (pet.id === synthMainId ? ' active': '') + (isGod ? ' pet-card--god': '');
      const stg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(pet) : ((pet.evolveTimes || 0) + 1);
      const gbar = Math.max(4, Math.min(100, Math.round((pet.growth || 0))));
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="card-info">
          <div class="pname">${pet.name}</div>
          <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)} · ${stg}/5阶${isGod ? ' · 神级' : ''}</div>
          <div class="growth-bar"><i style="width:${gbar}%"></i></div>
        </div>`;
      card.onclick = () => {
        synthMainId = pet.id;
        synthSubId = null;
        UI.renderAll();
      };
      list.appendChild(card);
    }
    renderSynthStage(mainPet);
  }

  // 合成 v2 面板化：主宠面板 ｜ 中央炼妖炉 ｜ 副宠面板+备选条 ｜ 结果预览条（成长/神级/变异/道具）+ 确认
  function renderSynthStage(main) {
    const mb = $('synth-main-box'), sb = $('synth-sub-box'), pb = $('synth-preview'), cb = $('synth-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const S = Config.synthesize || {};
    const arrow = $('synth-arrow');
    if (!main) {
      mb.innerHTML = '<div class="hint">← 先在左侧选一只主素材</div>';
      sb.innerHTML = ''; pb.innerHTML = ''; cb.innerHTML = '';
      if (arrow) arrow.innerHTML = '';
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
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    const gbar = Math.max(4, Math.min(100, Math.round((main.growth || 0))));
    const godNote = mainIsGod
      ? '<div class="pet-note ok">神级宠 · 已是神级（成长系数 +50% · 可涅槃）</div>'
      : (mainStage >= 5
        ? (mainGodReady ? '<div class="pet-note ok"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/></svg> 终阶 + 成长达标（≥' + minG + '）：满足神级宠条件</div>' : '<div class="pet-note no">已终阶，但成长未达 ' + minG + '（神级宠门槛）</div>')
        : '<div class="pet-note">未终阶（' + mainStage + '/5 阶），与神级宠无缘</div>');
    mb.innerHTML = `<div class="pet-card2 main${mainIsGod ? ' god': ''}">
      <div class="pname">${main.name}${mainIsGod ? ' · 神级' : ''}</div>
      <div class="pmeta">Lv.${main.level} · ${mainStage}/5阶 · 消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）</div>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
      <div class="stats">${statRows(main)}</div>
      ${godNote}</div>`;
    if (arrow) arrow.innerHTML = '<div class="forge-core"><div class="cauldron">合</div><div class="cauldron-tip">炼妖炉<br>两只素材宠都将消失</div></div>';
    const subs = (Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id, S) : []).filter(s => !(window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(s) : !!s.isGodPet)); // 神宠禁当副宠
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副素材（需要另一只 ${S.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    // 默认选中第一只候选副宠（免去多余点击，仍可随时换）
    let sub = synthSubId ? getPets().find(p => p.id === synthSubId) : null;
    if (!sub) { synthSubId = subs[0].id; sub = subs[0]; }
    const s2 = getStats(sub);
    const sgbar = Math.max(4, Math.min(100, Math.round((sub.growth || 0))));
    const sstg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(sub) : 1;
    sb.innerHTML = `<div class="pet-card2 sub-card">
      <div class="pname">${sub.name}</div>
      <div class="pmeta">副宠 · Lv.${sub.level} · ${sstg}/5阶</div>
      <div class="avatar">${iconHtml(sub.name)}</div>
      <div class="growline"><b>${sub.growth.toFixed(1)}</b><span class="gbar"><i style="width:${sgbar}%"></i></span></div>
      <div class="stats">${statRows(sub)}</div>
    </div>
    <div class="sub-options">${subs.map(s => {
      const sel = s.id === synthSubId ? ' on': '';
      return `<div class="sub-opt${sel}" data-sub="${s.id}"><span class="ic">${iconHtml(s.name)}</span><span>${s.name}<small>Lv.${s.level} · 成长 ${s.growth.toFixed(1)}</small></span></div>`;
    }).join('')}</div>`;
    sb.querySelectorAll('.sub-opt').forEach(btn => {
      btn.onclick = () => {
        synthSubId = Number(btn.dataset.sub);
        renderSynthPreview(main, matName, matAmt, haveMat, mutPct);
        UI.renderAll();
      };
    });
    renderSynthPreview(main, matName, matAmt, haveMat, mutPct);
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
    const itemSelectHtml = `<select id="synth-item-select">
      <option value="" ${!synthItemId ? 'selected' : ''}>不使用道具</option>
      ${synthItems.map(i => {
        const have = Materials.getQuantity ? Materials.getQuantity(i.name) : 0;
        return `<option value="${i.id}" ${i.id === synthItemId ? 'selected' : ''} ${have < 1 ? 'disabled' : ''}>${i.icon} ${i.name}（${i.effect}）×${have}</option>`;
      }).join('')}
    </select>`;
    // 神级宠判定（第二版手册 2.2：道具化）：门槛 + 概率由选中道具 godChance 决定
    const gi = Merge.godSynthInfo ? Merge.godSynthInfo(main, sub, synthItemId) : null;
    const stg = p => (window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(p) : ((p.evolveTimes || 0) + 1));
    const godCell = (gi && gi.god)
      ? `<div class="v">${Math.round(gi.chance * 100)}%<small>${gi.god.name}</small></div>`
      : `<div class="v">未达标<small>两只终阶 + 成长≥${gi ? gi.minGrowth : 60}</small></div>`;
    const growthCell = normalGrowth !== null
      ? `<div class="v">${normalGrowth.toFixed(1)}<small>主宠 ${main.growth.toFixed(1)} → ${normalGrowth.toFixed(1)}</small></div>`
      : `<div class="v">?<small>计算失败</small></div>`;
    const footWarns = [];
    if (!matOk) footWarns.push(`<span class="warn">材料不足：需要 ${matAmt} 颗${matName}，当前持有 ${haveMat}</span>`);
    if (synthItemId && !itemOk) footWarns.push('<span class="warn">道具不足：合成道具仅剩 0 个</span>');
    pb.innerHTML = `
      <div class="preview-bar">
        <div class="pv"><div class="k">合成结果成长</div>${growthCell}</div>
        <div class="pv"><div class="k">神级宠</div>${godCell}</div>
        <div class="pv"><div class="k">变异</div><div class="v">${mutPct ? mutPct + '%' : '—'}<small>${mutPct ? '再+1~3' : ''}</small></div></div>
        <div class="pv"><div class="k">合成道具</div><div class="v">${itemSelectHtml}</div></div>
      </div>
      <div class="preview-foot">
        消耗 <b>${matName} ×${matAmt}</b>（持有 ${haveMat}）· 两只素材（<b>${main.name}</b>、<b>${sub.name}</b>）都将消失，新宠等级回 1${mutPct ? ` · 变异时成长额外 +${S.mutation && S.mutation.growthBonus[0]}~${S.mutation && S.mutation.growthBonus[1]}（如 ${mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?'}），名字带「·异变」` : ''}
        ${traitInheritLine(main, sub, 'synth')}
        ${footWarns.join('')}
      </div>`;
    cb.innerHTML = `<button class="confirm-btn" id="synth-ok"${matOk && itemOk ? '': 'disabled'}>确认合成</button>`;
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
        addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/></svg> 神级宠降世！${res.mainName}+${res.subName} 合成出【${res.baby.name}】，成长 ${res.newGrowth.toFixed(1)}！`);
        showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/></svg> 神级宠降世！', `${iconHtml(res.baby.name)} <b style="color:#f2b632">【${res.baby.name}】</b>（神级宠 · 成长系数+50% · 可涅槃）<br><small>成长值 ${res.newGrowth.toFixed(1)}</small>`);
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
