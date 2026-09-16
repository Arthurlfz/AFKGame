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

  let mergeMainId = null, mergeSubId = null, useNirvanaPill = false, useCrystal = false, useLock = false, lockTraitId = null;

  function statRows(pet) {
    const s = getStats(pet);
    return `<div><span>生命</span><b>${s.hp}</b></div><div><span>攻击</span><b>${s.atk}</b></div><div><span>防御</span><b>${s.def}</b></div><div><span>速度</span><b>${s.spd}</b></div>`;
  }

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
        useLock = false; lockTraitId = null;
        UI.renderAll();
      };
      list.appendChild(card);
    }
    renderMergeStage(mainPet);
  }

  // 涅槃 v2 面板化：神级主宠 ｜ 业火炉 ｜ 副宠（将被吸收）+备选条 ｜ 结果预览条 + 确认
  function renderMergeStage(main) {
    const mb = $('merge-main-box'), sb = $('merge-sub-box'), pb = $('merge-preview'), cb = $('merge-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const M = Config.nirvana || Config.merge || {};
    const arrow = $('merge-arrow');
    if (!main) {
      // 空态（无选中主宠）：显示玩法说明
      const pill2 = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
      const matName2 = pill2 ? pill2.name : '涅槃丹';
      const matAmt2 = 1;
      const haveMat2 = pill2 && Materials.getQuantity ? Materials.getQuantity(pill2.name) : 0;
      mb.innerHTML = '<div class="es-tip"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"/><path d="M16 8 2 22"/><path d="M17.488 15H9"/></svg> 涅槃是什么</div>';
      sb.innerHTML = '<div class="es-tip"><b>只有神级宠才能涅槃</b>（手册 2.7）。主宠吸收副宠 50% 的成长值，等级重置回 <b>Lv.1</b>，继续叠成长；<b>成长无上限</b>，但主宠成长越高，每次新吸收越少（分段阻尼）。</div>';
      pb.innerHTML = '<div class="es-tip">条件：主宠必须是<b>神级宠</b>且 Lv.<b>' + (M.minLevel || 60) + '</b> 以上、未穿装备、不在出售；可选消耗 <b>' + matName2 + ' ×1</b>（吸收 ×1.2，当前持有 ' + haveMat2 + '）。<br>神级宠：两只<b>终阶</b>宠 + 成长 ≥ ' + ((Config.pet.godPets && Config.pet.godPets.minGrowth) || 60) + ' 在<b>合成</b>里搏出（30% 概率，持涅槃丹必出）。<br>符合条件后，在左侧选中主宠，这里会展开完整流程。</div>';
      cb.innerHTML = '';
      if (arrow) arrow.innerHTML = '';
      return;
    }
    // 主宠不是神级宠：整体置灰并给出去向提示
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    const pillDef = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const matName = pillDef ? pillDef.name : '涅槃丹';
    const matAmt = 1;
    const haveMat = pillDef && Materials.getQuantity ? Materials.getQuantity(pillDef.name) : 0;
    const gbar = Math.max(4, Math.min(100, Math.round((main.growth || 0))));
    if (!mainIsGod) {
      const minG = (Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
      mb.innerHTML = `<div class="pet-card2">
        <div class="pname">${main.name}</div>
        <div class="pmeta">Lv.${main.level} · 普通宠 · 不可涅槃</div>
        <div class="avatar">${iconHtml(main.name)}</div>
        <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
        <div class="stats">${statRows(main)}</div>
      </div>`;
      if (arrow) arrow.innerHTML = '';
      sb.innerHTML = '<div class="warn"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.929 4.929 19.07 19.071"/></svg> 只有<b>神级宠</b>才能涅槃——' + main.name + ' 是普通宠。先把两只<b>终阶</b>宠（成长 ≥ ' + minG + '）拿去<b>合成</b>，30% 概率搏出神级宠（持涅槃丹必出）。</div>';
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    // 神级主宠
    mb.innerHTML = `<div class="pet-card2 god">
      <div class="pname">${main.name} · 神级</div>
      <div class="pmeta">Lv.${main.level} · 可涅槃 · 可选消耗 ${matName} ×1（持有 ${haveMat}）</div>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
      <div class="stats">${statRows(main)}</div>
    </div>`;
    if (arrow) arrow.innerHTML = '<div class="forge-core"><div class="cauldron fire">焰</div><div class="cauldron-tip">业火炉<br>副宠将被吸收</div></div>';
    // 副宠候选
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id) : [];
    if (!subs.length) {
      sb.innerHTML = `<div class="hint">没有可用的副宠（需要另一只 ${M.minLevel} 级、不在出售、没穿装备的宠物）</div>`;
      pb.innerHTML = ''; cb.innerHTML = '';
      return;
    }
    let sub = mergeSubId ? getPets().find(p => p.id === mergeSubId) : null;
    if (!sub) { mergeSubId = subs[0].id; sub = subs[0]; }
    const s2 = getStats(sub);
    const sgbar = Math.max(4, Math.min(100, Math.round((sub.growth || 0))));
    const sstg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(sub) : 1;
    sb.innerHTML = `<div class="pet-card2 sub-card">
      <div class="pname">${sub.name}</div>
      <div class="pmeta">副宠（将被吸收）· Lv.${sub.level} · ${sstg}/5阶</div>
      <div class="avatar">${iconHtml(sub.name)}</div>
      <div class="growline"><b>${sub.growth.toFixed(1)}</b><span class="gbar"><i style="width:${sgbar}%"></i></span></div>
      <div class="stats">${statRows(sub)}</div>
    </div>
    <div class="sub-options">${subs.map(s => {
      const sel = s.id === mergeSubId ? ' on': '';
      return `<div class="sub-opt${sel}" data-sub="${s.id}"><span class="ic">${iconHtml(s.name)}</span><span>${s.name}<small>Lv.${s.level} · 成长 ${s.growth.toFixed(1)}</small></span></div>`;
    }).join('')}</div>`;
    sb.querySelectorAll('.sub-opt').forEach(btn => {
      btn.onclick = () => {
        mergeSubId = Number(btn.dataset.sub);
        useLock = false; lockTraitId = null;
        renderMergePreview(main, matName, matAmt, haveMat);
        UI.renderAll();
      };
    });
    renderMergePreview(main, matName, matAmt, haveMat);
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
    // 涅槃丹加乘（第二版手册 2.4：吸收 ×1.2）
    const nirPill = Config.itemOf ? Config.itemOf('nir_pill') : null;
    const pillHave = nirPill ? (Materials.getQuantity ? Materials.getQuantity(nirPill.name) : 0) : 0;
    const pillOk = pillHave >= 1;
    /* 2026-09-16：原「凝魂晶石加成」复选框已随凝魂晶石整套删除（`Config.nirvana.crystalBonus` 已移除）。
     * `useCrystal` 变量保留（`Merge.nirvana` 的入参签名不动），这里恒置 false、UI 不再渲染那一格。 */
    if (!pillOk) useNirvanaPill = false;   // 持有不足时自动取消勾选，避免按钮被自己禁用还不知道为什么
    useCrystal = false;
    const lockItem = Config.itemOf ? Config.itemOf('nir_lock') : null;
    const lockHave = lockItem && Materials.getQuantity ? Materials.getQuantity(lockItem.name) : 0;
    const subTraitList = (sub.traits || []);
    const lockOpts = subTraitList.map(t => '<option value="' + t.id + '"' + (t.id === lockTraitId ? ' selected' : '') + '>' + ((Config.petTraits[t.id] || {}).label || t.id) + ' T' + t.tier + '</option>').join('');
    if (!lockTraitId && subTraitList.length) lockTraitId = subTraitList[0].id;
    if (useLock && (lockHave < 1 || !subTraitList.length)) useLock = false;
    const pillMult = useNirvanaPill && nirPill ? (nirPill.boostMult || 1.2) : 1;
    // 2026-09-16：cryMult（凝魂晶石加成）已随凝魂晶石删除 ⇒ 涅槃现在只剩涅槃丹一个乘区
    const bonusMult = pillMult;
    const calcBoost = window.Merge && window.Merge.calcNirvanaGrowth ? window.Merge.calcNirvanaGrowth(main, sub, bonusMult) : null;
    const finalGrowth = calcBoost ? calcBoost.growth : newGrowth;
    const absorb = calcBoost && calcBoost.absorb != null ? calcBoost.absorb : (Math.round(sub.growth * (M.absorbRatio || 0.5) * bonusMult * 10) / 10);
    const row = (label, a, b) => {
      const cls = b > a ? 'up': b < a ? 'down': '';
      const arrowTxt = b > a ? '▲' : b < a ? '▼' : '—';
      return `<tr><td>${label}</td><td>${a}</td><td class="${cls}">${b} ${arrowTxt}</td></tr>`;
    };
    const canMerge = (!useNirvanaPill || pillOk) && (!useLock || (lockHave >= 1 && !!lockTraitId));
    const footWarns = [];
    if (useNirvanaPill && !pillOk) footWarns.push(`<span class="warn">${matName}不足：需要 1 个，当前持有 ${pillHave}</span>`);
    pb.innerHTML = `
      <div class="preview-bar">
        <div class="pv"><div class="k">吸收成长</div><div class="v">+${absorb.toFixed(1)}<small>副宠 ${sub.growth.toFixed(1)} × ${Math.round((M.absorbRatio || 0.5) * 100)}%${bonusMult > 1 ? ' ×' + bonusMult : ''}${(calcBoost && calcBoost.damped) ? ' · 高成长阻尼' : ''}</small></div></div>
        <div class="pv"><div class="k">涅槃后成长</div><div class="v">${finalGrowth.toFixed(1)}<small>主宠 ${main.growth.toFixed(1)} → ${finalGrowth.toFixed(1)}</small></div></div>
        <div class="pv"><div class="k">等级</div><div class="v">Lv.${main.level} → ${M.resetLevel ? 'Lv.1' : '不变'}<small>${M.resetLevel ? '重置 · 经验清零' : ''}</small></div></div>
        <div class="pv"><div class="k">涅槃丹</div><div class="v"><label><input type="checkbox" id="nir-pill-check" ${useNirvanaPill ? 'checked' : ''} ${pillOk ? '' : 'disabled'}> ×${pillMult}（持有 ${pillHave}）</label></div></div>
        <div class="pv"><div class="k">锁魂玉</div><div class="v"><label><input type="checkbox" id="nir-lock-check" ${useLock ? 'checked' : ''} ${lockHave >= 1 && subTraitList.length ? '' : 'disabled'}> 定向植入</label>${useLock ? `<select id="nir-lock-trait">${lockOpts}</select>` : ''}（持有 ${lockHave}）</div></div>
      </div>
      <div class="preview-foot">
        <b>${sub.name}</b>（成长 ${sub.growth.toFixed(1)}）将消失${useNirvanaPill ? ` · 消耗 ${matName} ×1（持有 ${haveMat}）` : ''}${M.resetLevel ? ' · <span class="warn">涅槃后等级重置回 1 级，属性按 1 级 × 新成长重算</span>' : ''}
        ${traitInheritLine(main, sub, 'nirvana')}
        ${footWarns.join('')}
      </div>
      <table class="cmp-table"><tr><th>属性</th><th>当前</th><th>涅槃后</th></tr>
        ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}
      </table>`;
    cb.innerHTML = `<button class="confirm-btn fire" id="merge-ok"${canMerge ? '': 'disabled'}>确认涅槃</button>`;
    const pillCheck = document.getElementById('nir-pill-check');
    if (pillCheck) {
      pillCheck.onchange = () => { useNirvanaPill = pillCheck.checked; renderMergePreview(main, matName, matAmt, haveMat); };
    }
    if (lockCheck) {
      lockCheck.onchange = () => { useLock = lockCheck.checked; renderMergePreview(main, matName, matAmt, haveMat); };
      const lockSel = document.getElementById('nir-lock-trait');
      if (lockSel) lockSel.onchange = () => { lockTraitId = lockSel.value; };
    }
    /* ⚠️ 涅槃要串 3~5 次服务器往返（查条件 → 逐项扣材料 → 改主宠 → 删副宠），实测 1~2 秒。
     * 以前这段时间按钮不置灰也不改字 = 玩家以为没点着，会反复点（重复扣材料）。
     * 统一走 UI.runWithLoading（打造/购买用的同一套）：点下立刻换文案 + 禁用，结束恢复。 */
    const nirBtn = cb.querySelector('#merge-ok');
    nirBtn.onclick = async () => {
      if (!canMerge) { showToast('无法涅槃', '道具或材料不足'); return; }
      const res = await UI.runWithLoading(nirBtn, '涅槃中…', () => Merge.nirvana(main.id, sub.id, useCrystal, useNirvanaPill, useLock ? lockTraitId : null)) || { error: '请稍候再试' };
      if (res.error) { showToast('涅槃失败', res.error); return; }
      addLog(`涅槃成功！${res.main.name} 成长 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}，转生 ${res.main.rebornCount} 次；本轮培育次数已重置（0/10）`);
      showToast('涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}`);
      // 揭幕演出：涅槃是全流程最重的一次投入（要养副宠），必须要有"成了"的那一下
      if (UI.celebrate) UI.celebrate({ title: '涅槃', name: res.main.name, sub: '成长 ' + res.oldGrowth.toFixed(1) + ' → ' + res.newGrowth.toFixed(1) + '　等级重置为 Lv.' + res.main.level });
      mergeMainId = res.main ? res.main.id : null;
      mergeSubId = null;
      useLock = false; lockTraitId = null;
      UI.renderAll();
    };
  }

  function renderMergeHint() {
    const el = $('merge-hint-text');
    const M = Config.nirvana || Config.merge || {};
    const minG = (Config.pet.godPets && Config.pet.godPets.minGrowth) || 60;
    const hintPill = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const hintPillName = hintPill ? hintPill.name : '涅槃丹';
    if (el && M.minLevel) el.innerHTML = `涅槃：<b>只有神级宠</b>能涅槃。主宠吸副宠 <b>${Math.round((M.absorbRatio || 0.5) * 100)}%</b> 成长 + 重置等级；成长无上限，但主宠成长越高，每次新吸收越少（<b>分段阻尼</b>）。条件：神级宠 Lv.<b>${M.minLevel}</b>；可选消耗 <b>${hintPillName} ×1</b>（吸收 ×${hintPill && hintPill.boostMult ? hintPill.boostMult : 1.2}）。神级宠 = 两只终阶宠（成长 ≥ ${minG}）合成，概率看合成道具。`;
  }



  /* ---------- 对外 API ---------- */
  UI.renderMergeTab = renderMergeTab;
  UI.renderMergeHint = renderMergeHint;
})();
