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

  let mergeMainId = null, mergeSubId = null, useNirvanaPill = false;

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
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(pet) : !!pet.isGodPet;
      card.className = 'pet-card'+ (pet.id === mergeMainId ? ' active': '') + (isGod ? ' pet-card--god': '');
      const stg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(pet) : ((pet.evolveTimes || 0) + 1);
      const gbar = Math.max(4, Math.min(100, Math.round((pet.growth || 0))));
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="card-info">
          <div class="pname">${pet.name}</div>
          <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)} · ${stg}/5阶${isGod ? ' · 神级' : ''}</div>
          <div class="growth-bar"><i style="width:${gbar}%"></i></div>
        </div>`;
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
      // 空态（无选中主宠）：显示玩法说明，避免「未选择主宠 / ＋ / 空目标」的占位感（2026-09-03）
      // 涅槃消耗已道具化（手册 2.4）：不再消耗涅磐兽，只有可选的涅槃道具
      const pill2 = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
      const matName2 = pill2 ? pill2.name : '涅槃丹';
      const matAmt2 = 1;
      const haveMat2 = pill2 && Materials.getQuantity ? Materials.getQuantity(pill2.name) : 0;
      mb.innerHTML = '<div class="es-tip">🦚 涅槃是什么</div>';
      sb.innerHTML = '<div class="es-tip"><b>只有神级宠才能涅槃</b>（手册 2.7）。主宠吸收副宠 50% 的成长值（不衰减），等级重置回 <b>Lv.1</b>，继续叠成长。</div>';
      pb.innerHTML = '<div class="es-tip">条件：主宠必须是<b>神级宠</b>且 Lv.<b>' + (M.minLevel || 60) + '</b> 以上、未穿装备、不在出售；可选消耗 <b>' + matName2 + ' ×1</b>（吸收 ×1.2，当前持有 ' + haveMat2 + '）。<br>神级宠：两只<b>终阶</b>宠 + 成长 ≥ ' + ((Config.pet.godPets && Config.pet.godPets.minGrowth) || 60) + ' 在<b>合成</b>里搏出（30% 概率，持涅槃丹必出）。<br>符合条件后，在左侧选中主宠，这里会展开完整流程。</div>';
      cb.innerHTML = '';
      return;
    }
    // 主宠不是神级宠：整体置灰并给出去向提示（手册阶段2-UI：普通宠涅槃按钮置灰）
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    // 涅槃消耗道具化：默认道具（当前唯一 = 涅槃丹），不用也能涅槃，只是没有 ×1.2 加乘
    const pillDef = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const matName = pillDef ? pillDef.name : '涅槃丹';
    const matAmt = 1;
    const haveMat = pillDef && Materials.getQuantity ? Materials.getQuantity(pillDef.name) : 0;
    mb.innerHTML = `<div class="es-pet es-pet--god">
      <span class="es-icon">${iconHtml(main.name)}</span>
      <div><b>${main.name}</b></div>
      <span class="lv-badge">Lv.${main.level} · 神级</span>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 可选消耗 ${matName} ×1（持有 ${haveMat}）</div></div>`;
    // 主宠不是神级宠 → 不提供涅槃流程（手册 2.7：只有神级宠才能涅槃）
    if (!mainIsGod) {
      const minG = (Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
      sb.innerHTML = '<div class="warn">🚫 只有<b>神级宠</b>才能涅槃——' + main.name + ' 是普通宠。先把两只<b>终阶</b>宠（成长 ≥ ' + minG + '）拿去<b>合成</b>，30% 概率搏出神级宠（持涅槃丹必出）。</div>';
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    // 副宠候选
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id) : [];
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副宠（需要另一只 ${M.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<div class="es-tip">选择副宠（融合后消失，主宠吸收其成长）：</div><div class="es-sub-grid">'+
      subs.map(s => {
        const sel = s.id === mergeSubId ? ' selected': '';
        return `<button class="es-route${sel}" data-sub="${s.id}">
          <div class="es-route-icon">${iconHtml(s.name)}</div>
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
      const cls = b > a ? 'delta-up': b < a ? 'delta-down': '';
      return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${b > a ? '▲': b < a ? '▼': ''}</span></div>`;
    };
    // 涅槃丹加乘（第二版手册 2.4：吸收 ×1.2）
    const nirPill = Config.itemOf ? Config.itemOf('nir_pill') : null;
    const pillHave = nirPill ? (Materials.getQuantity ? Materials.getQuantity(nirPill.name) : 0) : 0;
    const pillOk = pillHave >= 1;
    const pillMult = useNirvanaPill && nirPill ? (nirPill.boostMult || 1.2) : 1;
    // 重新计算带涅槃丹的成长预览
    const calcPill = window.Merge && window.Merge.calcNirvanaGrowth ? window.Merge.calcNirvanaGrowth(main, sub, pillMult) : null;
    const newGrowthPill = calcPill ? calcPill.growth : newGrowth;
    const absorbTxt = calcPill && calcPill.absorb != null ? `（吸收副宠 ${sub.growth.toFixed(1)} × ${Math.round((M.absorbRatio || 0.5) * 100)}%${pillMult > 1 ? ' ×' + pillMult : ''} = +${calcPill.absorb}，不衰减）`: '';
    pb.innerHTML = `
      <div class="es-preview-row">成长值：<span class="grow-big">${main.growth.toFixed(1)} <span class="arrow">→</span> ${newGrowth.toFixed(1)}</span> ${absorbTxt}</div>
      <div class="es-preview-row">等级：Lv.${main.level} → ${M.resetLevel ? '<b>Lv.1（重置）</b>': '不变'}</div>
      <div class="es-preview-row">${iconHtml(sub.name)} ${sub.name}（成长 ${sub.growth.toFixed(1)}）将消失${useNirvanaPill ? `，消耗 ${matName} ×1（持有 ${haveMat}）` : ''}</div>
      <div class="es-preview-row"><label><input type="checkbox" id="nir-pill-check" ${useNirvanaPill ? 'checked' : ''} ${pillOk ? '' : 'disabled'}> 使用涅槃丹（吸收 ×${nirPill ? (nirPill.boostMult || 1.2) : 1.2}，持有 ${pillHave}）</label>${useNirvanaPill ? ` 成长：<b>${newGrowth.toFixed(1)} → ${newGrowthPill.toFixed(1)}</b>` : ''}</div>
      ${traitInheritLine(main, sub, 'nirvana')}
      ${M.resetLevel ? '<div class="warn"> 涅槃后等级重置回 1 级，经验清零，属性按 1 级 × 新成长重算</div>': ''}
      ${useNirvanaPill && !pillOk ? `<div class="es-preview-row warn"> ${matName}不足：需要 1 个，当前持有 ${pillHave}</div>` : ''}
      <div class="es-stats">属性变化：</div>
      ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}`;
    const canMerge = !useNirvanaPill || pillOk;
    cb.innerHTML = `<button class="btn-mini primary" id="merge-ok"${canMerge ? '': 'disabled'}>确认涅槃</button>`;
    const pillCheck = document.getElementById('nir-pill-check');
    if (pillCheck) {
      pillCheck.onchange = () => { useNirvanaPill = pillCheck.checked; renderMergePreview(main, matName, matAmt, haveMat); };
    }
    cb.querySelector('#merge-ok').onclick = async () => {
      if (!canMerge) { showToast('无法涅槃', '涅槃丹不足'); return; }
      const res = await Merge.nirvana(main.id, sub.id, false, useNirvanaPill);
      if (res.error) { showToast('涅槃失败', res.error); return; }
      addLog(`涅槃成功！${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}`);
      showToast('涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}`);
      mergeMainId = res.main ? res.main.id : null;
      mergeSubId = null;
      UI.renderAll();
    };
  }

  function renderMergeHint() {
    const el = $('merge-hint-text');
    const M = Config.nirvana || Config.merge || {};
    const minG = (Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
    const hintPill = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const hintPillName = hintPill ? hintPill.name : '涅槃丹';
    if (el && M.minLevel) el.innerHTML = `涅槃：<b>只有神级宠</b>能涅槃。主宠吸副宠 <b>${Math.round((M.absorbRatio || 0.5) * 100)}%</b> 成长（不衰减）+ 重置等级。条件：神级宠 Lv.<b>${M.minLevel}</b>；可选消耗 <b>${hintPillName} ×1</b>（吸收 ×${hintPill && hintPill.boostMult ? hintPill.boostMult : 1.2}）。神级宠 = 两只终阶宠（成长 ≥ ${minG}）合成，概率看合成道具。`;
  }



  /* ---------- 对外 API ---------- */
  UI.renderMergeTab = renderMergeTab;
  UI.renderMergeHint = renderMergeHint;
})();
