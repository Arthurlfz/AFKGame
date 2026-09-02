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
      card.className = 'pet-card'+ (pet.id === evolveMainId ? ' active': '');
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
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
    mb.innerHTML = `<div class="es-pet"><span class="es-icon">${iconHtml(main.name)}</span>
      <div><b>${main.name}</b> Lv.${main.level}</div>
      <div class="hint">成长 ${main.growth.toFixed(1)} · 进化 ${times}/${maxTimes} · 转生 ${main.rebornCount || 0}</div></div>`;

    if (maxed) {
      tb.innerHTML = `<div class="warn"> 进化已达上限(${maxTimes}次)，需通过<b>涅槃</b>重置进化次数后才能继续</div>`;
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    if (!routes.length) {
      tb.innerHTML = '<div class="hint">该形态无法再进化</div>';
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    tb.innerHTML = '<div class="es-tip">选择进化方向（等级不变、成长+、换形态）：</div><div class="es-route-grid">'+
      routes.map((r, i) => {
        const okLevel = main.level >= (r.minLevel || 1);
        return `<button class="es-route ${okLevel ? '': 'lv-low'}" data-i="${i}">
          <div class="es-route-icon">${iconHtml(r.to)}</div>
          <div class="es-route-name">${r.to}</div>
          <small>${r.minLevel ? (okLevel ? '需 Lv.'+ r.minLevel + '✓': '需 Lv.'+ r.minLevel + '（等级不够）') : '可进化'}</small>
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
      const cls = b > a ? 'delta-up': '';
      return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${b > a ? '▲': ''}</span></div>`;
    };
    const formText = route.keepForm ? '形态不变，成长值提升': `进化后名字变为【${route.to}】`;
    const lvOk = pet.level >= (route.minLevel || 1);
    const matOk = have >= 1;
    const canEvolve = lvOk && matOk;
    let warnRow = '';
    if (!lvOk) warnRow += `<div class="es-preview-row warn="> 等级不足：需要 Lv.${route.minLevel}，当前 Lv.${pet.level}</div>`;
    if (!matOk) warnRow += `<div class="es-preview-row warn="> 材料不足：需要 1 个 ${matName}，当前持有 ${have}</div>`;
    pb.innerHTML = `
      <div class="es-preview-row">路线：<b>${iconHtml(route.to, true)} ${route.to}</b>（${route.minLevel ? '需 Lv.'+ route.minLevel : '无等级要求'}）</div>
      <div class="es-preview-row">消耗：<b>${matName} ×1</b>（当前持有 ${have}）</div>
      <div class="hint">等级不变（Lv.${pet.level}）；${formText}；进化次数 ${pet.evolveTimes || 0}→${(pet.evolveTimes || 0) + 1}</div>
      ${warnRow}
      <div class="es-stats">属性变化：</div>
      ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}`;
    cb.innerHTML = `<button class="btn-mini primary" id="evolve-ok"${canEvolve ? '': 'disabled'}>确认进化</button>`;
    cb.querySelector('#evolve-ok').onclick = async () => {
      if (!canEvolve) {
        showToast('无法进化', !lvOk ? '等级不够': '材料不足');
        return;
      }
      const origName = pet.name;
      const origGrowth = pet.growth;
      const res = await Evolve.evolve(pet.id, i, boost); // 用预览定好的 boost，所见即所得
      if (res.error) { showToast('进化失败', res.error); return; }
      const changed = res.keepForm ? '（形态不变）': '';
      addLog(`进化成功！${origName} 成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${changed}`);
      showToast('进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}</small>`);
      evolveMainId = res.pet ? res.pet.id : pet.id;
      evolvePreview = null; // 已进化：旧预览（形态/成长都变了）作废
      UI.renderAll();
    };
  }

  function renderEvolveHint() {
    const el = $('evolve-hint-text');
    const E = Config.pet.evolution;
    if (el && E) el.innerHTML = `进化：消耗 <b>${E.materialName || '进化素材'} ×1</b>走一段进化树（等级不变、成长提升、名字变化），单宠最多进化 <b>${E.maxEvolveTimes || 10} 次</b>，吃满后需<b>融合(转生)</b>重置次数继续`;
  }

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
    let html = `<div class="merge-main">${iconHtml(pet.name, true)} ${pet.name}（Lv.${pet.level} · 成长 ${pet.growth.toFixed(1)}）</div>`;
    html += `<div class="merge-preview">进化次数 <b>${times}/${maxTimes}</b>；转生 <b>${pet.rebornCount || 0} 次</b>；消耗 <b>${matName} ×1</b>（持有 ${have}）</div>`;
    if (maxed) {
      html += `<div class="merge-preview"> 进化已达上限(${maxTimes}次)，需通过<b>融合(转生)</b>重置进化次数后才能继续</div>`;
    } else if (!routes.length) {
      html += `<div class="merge-preview">该形态无法再进化</div>`;
    } else {
      html += `<div class="merge-tip">选择进化方向（<b>等级不变</b>、每次成长+0.1~0.2、主要<b>更换形态</b>；成长大幅提升靠<b>融合</b>）</div>`;
      html += '<div class="merge-cands">'+ routes.map((r, i) => {
        const ok = pet.level >= (r.minLevel || 1);
        const sub = r.keepForm ? '成长+（形态不变）': (r.minLevel ? '需 Lv.'+ r.minLevel : '可进化');
        return `<button class="merge-cand evolve-route${ok ? '': 'disabled'}" data-i="${i}"${ok ? '': 'disabled'}>
          ${iconHtml(r.to, true)} ${r.to}<br><small>${sub}</small></button>`;
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
          const cls = b > a ? 'delta-up': '';
          const arrow = b > a ? '▲': '';
          return `<div class="delta-row ${cls}"><span>${label}</span><span>${a} → ${b} ${arrow}</span></div>`;
        };
        const statHtml = row('生命', cur.hp, next.hp) + row('攻击', cur.atk, next.atk)
          + row('防御', cur.def, next.def) + row('速度', cur.spd, next.spd);
        const formText = route.keepForm
          ? `形态不变，成长值提升`
          : `进化后名字变为【${route.to}】`;
        body.innerHTML = `
          <div class="merge-main">${iconHtml(pet.name)} ${pet.name}（Lv.${pet.level} · 成长 ${pet.growth.toFixed(1)}）</div>
          <div class="merge-preview">
            <div>路线：<b>${iconHtml(route.to)} ${route.to}</b>（${route.minLevel ? '需 Lv.'+ route.minLevel : '无等级要求'}）</div>
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
          if (res.error) { showToast('进化失败', res.error); return; }
          const changed = res.keepForm ? '（形态不变）': '';
          addLog(`进化成功！${origName} 成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${changed}，进化次数 ${res.pet.evolveTimes}/${maxTimes}`);
          showToast('进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)} · 进化次数 ${res.pet.evolveTimes}/${maxTimes}</small>`);
          if (UI.showDialog) UI.showDialog({ icon: '', speaker: '进化', text: `进化成功！<br>${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}` });
          closeEvolvePanel();
          UI.renderAll();
        };
      };
    });
  }
  function closeEvolvePanel() {
    $('evolve-modal').style.display = 'none';
  }


  /* ---------- 对外 API ---------- */
  UI.renderEvolveTab = renderEvolveTab;
  UI.renderEvolveHint = renderEvolveHint;
  UI.openEvolvePanel = openEvolvePanel;
  UI.closeEvolvePanel = closeEvolvePanel;
})();
