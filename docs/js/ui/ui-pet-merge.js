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
      card.className = 'pet-card'+ (pet.id === mergeMainId ? ' active': '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="pname">${pet.name}</div>
        <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)}</div>${UI.traitsHtml(pet)}`;
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
      const matName2 = M.material && M.material.name || '涅槃兽';
      const matAmt2 = M.material && M.material.amount || 1;
      const haveMat2 = Materials.getQuantity ? Materials.getQuantity(matName2) : 0;
      mb.innerHTML = '<div class="es-tip">🦚 涅槃是什么</div>';
      sb.innerHTML = '<div class="es-tip">主宠吸收副宠的成长值，等级重置回 <b>Lv.1</b>，突破成长上限继续养成。</div>';
      pb.innerHTML = '<div class="es-tip">条件：主宠 <b>Lv.' + (M.minLevel || 60) + '</b> 以上、未穿装备、不在出售；消耗 <b>' + matAmt2 + ' 只' + matName2 + '</b>（当前持有 ' + haveMat2 + '）。<br>符合条件后，在左侧选中主宠，这里会展开完整流程。</div>';
      cb.innerHTML = '';
      return;
    }
    const matName = M.material && M.material.name || '涅槃兽';
    const matAmt = M.material && M.material.amount || 1;
    const haveMat = Materials.getQuantity ? Materials.getQuantity(matName) : 0;
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 消耗 ${matAmt} 只${matName}（持有 ${haveMat}）</div></div>`;
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
    const matOk = haveMat >= matAmt;
    pb.innerHTML = `
      <div class="es-preview-row">成长值：<b>${main.growth.toFixed(1)} → ${newGrowth.toFixed(1)}</b></div>
      <div class="es-preview-row">等级：Lv.${main.level} → ${M.resetLevel ? '<b>Lv.1（重置）</b>': '不变'}</div>
      <div class="es-preview-row">${iconHtml(sub.name)} ${sub.name}（成长 ${sub.growth.toFixed(1)}）将消失，消耗 ${matAmt} 只${matName}（持有 ${haveMat}）</div>
      ${traitInheritLine(main, sub, 'nirvana')}
      ${M.resetLevel ? '<div class="warn"> 涅槃后等级重置回 1 级，经验清零，属性按 1 级 × 新成长重算</div>': ''}
      ${!matOk ? `<div class="es-preview-row warn="> 材料不足：需要 ${matAmt} 只${matName}，当前持有 ${haveMat}</div>` : ''}
      <div class="es-stats">属性变化：</div>
      ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}`;
    cb.innerHTML = `<button class="btn-mini primary" id="merge-ok"${matOk ? '': 'disabled'}>确认涅槃</button>`;
    cb.querySelector('#merge-ok').onclick = async () => {
      if (!matOk) { showToast('无法涅槃', '材料不足'); return; }
      const res = await Merge.nirvana(main.id, sub.id);
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
    if (el && M.minLevel) el.innerHTML = `涅槃：主宠吸副宠成长 + 重置等级。条件：两只 <b>${M.minLevel} 级</b>宠物 + 消耗 <b>${M.material.amount} 只${M.material.name}</b>`;
  }

  function openMergePanel(main) {
    const M = Config.nirvana || Config.merge || {};
    const body = $('merge-body');
    if (Object.values(main.equipment || {}).some(Boolean)) {
      body.innerHTML = `
        <div class="merge-main">主宠：${iconHtml(main.name)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
        <div class="merge-preview"> <b>${main.name} 穿着装备，不能融合。</b><br>请先到「宠物」页点击已穿装备卸下，再回来融合。</div>`;
      $('merge-modal').style.display = 'flex';
      return;
    }
    const cands = Merge.getMergeCandidates(main.id);
    const baseHtml = `
      <div class="merge-main">主宠：${iconHtml(main.name)} ${main.name}（Lv.${main.level} · 成长 ${main.growth.toFixed(1)}）</div>
      <div class="merge-tip">消耗 <b>${M.material.amount} 只${M.material.name}</b>（当前持有 ${Materials.getQuantity(M.material.name)}）</div>
      <div class="merge-tip">选择副宠（融合后消失，${main.name} 吸收其 ${Math.round(M.absorbRatio * 100)}% 成长值；副宠也不能穿装备）：</div>`;
    let html = baseHtml;
    if (!cands.length) {
      html += `<div class="inv-empty">没有可用的副宠（需要另一只 ${M.minLevel} 级、不在出售中、且没穿装备的宠物）</div>`;
    } else {
      html += '<div class="merge-cands">'+ cands.map(c =>
        `<button class="merge-cand" data-id="${c.id}">${iconHtml(c.name)} ${c.name}（成长 ${c.growth.toFixed(1)}）</button>`
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
          const cls = b > a ? 'delta-up': b < a ? 'delta-down': '';
          const arrow = b > a ? '▲': b < a ? '▼': '';
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
            ? `<div class="merge-limit warn="> 副宠成长(${sub.growth.toFixed(1)}) 低于主宠成长的一半(${subReqTxt})，吸收将<b>打折</b>（只吸 ${Math.round((M.lowGrowthPenalty || 0.2) * 100)}%）</div>`
            : `<div class="merge-limit hint=">副宠成长需 ≥ 主宠的一半(${subReqTxt}) 才给足吸收，否则打折</div>`,
          calc && calc.capApplied
            ? `<div class="merge-limit warn="> 主宠成长已到 <b>${M.growthCap}</b> 分水岭，本次吸收<b>减半</b>（成长越高后期提升越慢）</div>`
            : (M.growthCap ? `<div class="merge-limit hint=">主宠成长 < ${M.growthCap} 时给足吸收；达到 ${M.growthCap} 后吸收减半</div>` : '')
        ].join('');
        body.innerHTML = baseHtml + `
          <div class="merge-preview">
            <div>成长值：<b>${main.growth.toFixed(1)} → ${newGrowth.toFixed(1)}</b></div>
            <div>等级：<b>Lv.${main.level} → ${M.resetLevel ? 'Lv.1（重置）': '不变'}</b></div>
            <div>${iconHtml(sub.name)} ${sub.name}（成长 ${sub.growth.toFixed(1)}）将消失，消耗 ${M.material.amount} 只${M.material.name}</div>
            ${M.resetLevel
              ? `<div class="warn"> 融合后 ${main.name} 的等级<b>重置回 1 级</b>，经验清零，属性按 1 级 × 新成长值重算（需重新练级，练起来后成长优势会体现）</div>`
              : '<div class="hint">等级保留，属性按当前等级 × 新成长值重算</div>'}
            ${limitHtml}
            ${maxed ? `<div class="merge-limit warn="> 主宠成长已达上限 <b>${M.maxGrowth}</b>，本次涅槃<b>不再涨成长</b>，仅重置等级（可继续练级）</div>` : ''}
            ${CB ? `<label class="merge-crystal"><input type="checkbox" id="merge-crystal"${useCrystal ? ' checked': ''} ${haveCrystal < CB.amount ? 'disabled': ''}>额外投入 ${CB.material} ×${CB.amount}（持有 ${haveCrystal}），本次吸收 +${Math.round(CB.absorbBonus * 100)}%</label>` : ''}
            <div class="merge-stats">属性变化（按涅槃后等级计算）：</div>
            ${statHtml}
            <div style="margin-top:8px"><button class="btn-mini primary" id="merge-ok">确认涅槃</button></div>
          </div>`;
        const cb = body.querySelector('#merge-crystal');
        if (cb) cb.onchange = () => render(cb.checked);
        body.querySelector('#merge-ok').onclick = async () => {
          const origName = main.name; // 涅槃前原名
          const res = await Merge.nirvana(main.id, sub.id, !!(cb && cb.checked));
          if (res.error) { showToast('涅槃失败', res.error); return; }
          addLog(`涅槃成功！${res.subName} 消失了，${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}`);
          showToast('涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}<br><small>等级重置为 Lv.${res.main.level}，属性已按新成长值重算</small>`);
          if (UI.showDialog) UI.showDialog({ icon: '', speaker: '涅槃', text: `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}<br>等级重置为 Lv.${res.main.level}` });
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


  /* ---------- 对外 API ---------- */
  UI.renderMergeTab = renderMergeTab;
  UI.renderMergeHint = renderMergeHint;
  UI.openMergePanel = openMergePanel;
  UI.closeMergePanel = closeMergePanel;
})();
