import { iconHtml, petTipHtml, showPetTip, hidePetTip, bindPetTip, flashStat, traitInheritLine } from './ui-pet.js';

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

  let synthMainId = null, synthSubId = null;

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
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）· 变异 ${mutPct}%</div></div>`;
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
    const normalGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, false) : null;
    const mutatedGrowth = Merge.calcSynthesizeGrowth ? Merge.calcSynthesizeGrowth(main, sub, true) : null;
    const matOk = haveMat >= matAmt;
    pb.innerHTML = `
      <div class="es-preview-row">合成结果：一只全新的 <b>${iconHtml(main.name)} ${main.name}${mutPct ? '（·异变）': ''}</b>，等级回 1</div>
      <div class="es-preview-row">普通成长：<b>${normalGrowth !== null ? normalGrowth.toFixed(1) : '?'}</b></div>
      ${mutPct ? `<div class="es-preview-row"> 有 <b>${mutPct}%</b> 概率变异：成长额外 +${(S.mutation && S.mutation.growthBonus[0])}~${(S.mutation && S.mutation.growthBonus[1])}（如 ${mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?'}），名字带「·异变」</div>` : ''}
      <div class="es-preview-row">两只素材（${main.name}、${sub.name}）都将消失，消耗 ${matAmt} 颗${matName}（持有 ${haveMat}）</div>
      ${traitInheritLine(main, sub, 'synth')}
      ${!matOk ? `<div class="es-preview-row warn"> 材料不足：需要 ${matAmt} 颗${matName}，当前持有 ${haveMat}</div>` : ''}`;
    cb.innerHTML = `<button class="btn-mini primary" id="synth-ok"${matOk ? '': 'disabled'}>确认合成</button>`;
    cb.querySelector('#synth-ok').onclick = async () => {
      if (!matOk) { showToast('无法合成', '材料不足'); return; }
      const res = await Merge.synthesize(main.id, sub.id);
      if (res.error) { showToast('合成失败', res.error); return; }
      if (res.mutated) {
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
