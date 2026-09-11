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
  // 路线目标形态头像：直接按名字取真实素材，无素材留空（不回退 emoji）
  const routeIcon = (nm) => iconHtml(nm);

  let evolveMainId = null;
  let evolvePreview = null;
  let godCulItemId = null; // 神宠培育：记住选中的玉露道具 id

  // 阶段总数（从 config 推导；别再硬写 5 —— 改阶段表时界面要跟着走）
  const stageCount = () => (((Config.pet && Config.pet.evolution && Config.pet.evolution.stages) || []).length) || 5;

  function evoStatRows(s) {
    return `<div><span>生命</span><b>${s.hp}</b></div><div><span>攻击</span><b>${s.atk}</b></div><div><span>防御</span><b>${s.def}</b></div><div><span>速度</span><b>${s.spd}</b></div>`;
  }

  function renderEvolveTab() {
    const list = $('evolve-pet-list');
    if (!list) return;
    const E = Config.pet.evolution || {};
    const maxTimes = E.maxEvolveTimes || 10;
    list.innerHTML = '';
    const evoPets = getPets().filter(p => {
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(p) : !!p.isGodPet;
      // 神宠也走进化页：吃玉露培育成长（2026-09-11）
      return (isGod || Evolve.hasRoute(p)) && p.cloudId && !(Market && Market.isListed(p.cloudId));
    });
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
      const isGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(pet) : !!pet.isGodPet;
      card.className = 'pet-card'+ (pet.id === evolveMainId ? ' active': '') + (isGod ? ' pet-card--god': '');
      const stg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(pet) : ((pet.evolveTimes || 0) + 1);
      const gbar = Math.max(4, Math.min(100, Math.round((pet.growth || 0))));
      card.innerHTML = `<div class="icon">${iconHtml(pet.name)}</div>
        <div class="card-info">
          <div class="pname">${pet.name}</div>
          <div class="meta">Lv.${pet.level} · 成长${pet.growth.toFixed(1)} · ${stg}/${stageCount()}阶 · 进化${(pet.evolveTimes || 0)}/${maxTimes}</div>
          <div class="growth-bar"><i style="width:${gbar}%"></i></div>
        </div>`;
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

  // 进化 v2 面板化：当前形态 ｜ → ｜ 目标形态 + 属性对照表 + 方向卡 + 消耗 + 确认
  function renderEvolveStage(main) {
    const mb = $('evolve-main-box');
    const tb = $('evolve-target-box');
    const pb = $('evolve-preview');
    const cb = $('evolve-confirm');
    if (!mb || !tb || !pb || !cb) return;
    const E = Config.pet.evolution || {};
    const arrow = $('evolve-arrow');
    if (!main) {
      mb.innerHTML = '<div class="hint">← 先在左侧选一只主宠</div>';
      tb.innerHTML = ''; pb.innerHTML = ''; cb.innerHTML = '';
      if (arrow) arrow.innerHTML = '';
      return;
    }
    if (arrow) arrow.innerHTML = '<div class="evo-arrow">→</div>';
    const routes = Evolve.getEvolutionRoutes(main);
    const maxTimes = E.maxEvolveTimes || 10;
    const times = main.evolveTimes || 0;
    /* 2026-09-10 修：上限判定改为「还有没有下一阶」（原来用 times >= maxTimes）。
     * 次数是历史累计值、会和阶段脱钩 —— 老存档会出现"次数已满但没到终阶"，
     * 用次数当闸门会把宠物永久卡在中间阶（用户实测：三阶 Lv58 / 次数 4 → 永远到不了终阶）。 */
    const maxed = !Evolve.nextStageOf(main);
    const rm = (routes.length && Evolve.getRouteMaterial(main, 0)) || null;
    const matName = (rm && rm.name) || E.materialName || '进化素材';
    const have = rm ? rm.have : (Materials.getQuantity ? Materials.getQuantity(matName) : 0);
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    if (mainIsGod) { renderGodCultivate(main); return; } // 神宠培育：不走进化树
    mb.innerHTML = `<div class="evo-card">
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="pname">${main.name}${mainIsGod ? ' · 神级' : ''}</div>
      <div class="pmeta">Lv.${main.level} · ${window.Pet && window.Pet.stageLabel ? window.Pet.stageLabel(main) : '第' + ((main.evolveTimes || 0) + 1) + '阶'} · 进化 ${times}/${maxTimes} · 转生 ${main.rebornCount || 0}</div>
    </div>`;

    if (maxed) {
      tb.innerHTML = `<div class="warn"> 已登临<b>终阶</b>（${stageCount()} 阶走完）——进化之路到此为止。想再变强：两只<b>终阶宠</b> + 成长 60 可在<b>合成</b>里搏一只神级宠，或走<b>涅槃</b>重置重练。</div>`;
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    if (!routes.length) {
      // 兜底（正常走不到：没下一阶时上面的 maxed 已返回）：形态无法再进化
      const atFinal = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(main) >= stageCount() : false;
      tb.innerHTML = atFinal
        ? '<div class="warn"> 已登临<b>终阶</b>——进化之路到此为止。想再变强：两只终阶宠 + 成长 60 可在<b>合成</b>里搏一只神级宠。</div>'
        : '<div class="hint">该形态无法再进化</div>';
      pb.innerHTML = ''; cb.innerHTML = ''; evolvePreview = null;
      return;
    }
    // 重建后按 state 恢复预览（否则玩家刚点的方向被 renderAll 冲掉）
    if (evolvePreview && evolvePreview.petId === main.id && routes[evolvePreview.routeIndex]) {
      renderEvolvePreview(main, evolvePreview.routeIndex, matName, have);
    } else {
      evolvePreview = null;
      tb.innerHTML = `<div class="evo-card">
        <div class="avatar" style="opacity:.28;filter:grayscale(.7)">?</div>
        <div class="pname" style="color:var(--text-faint)">未选方向</div>
        <div class="pmeta">在下方选择进化方向后，这里会显示目标形态</div>
      </div>`;
      pb.innerHTML = `<div class="alt-routes">${routes.map((r, i) => {
        const okLevel = main.level >= (r.minLevel || 1);
        return `<div class="alt-route" data-i="${i}">
          <span class="ic">${routeIcon(r.to)}</span>
          <span class="rt-name">${r.to}${r.minLevel ? `<span class="lv-tag ${okLevel ? 'ok' : 'no'}">Lv.${r.minLevel}</span>` : ''}</span>
          <small>${r.label ? '→ ' + r.label : ''}</small>
        </div>`;
      }).join('')}</div>`;
      pb.querySelectorAll('.alt-route').forEach(btn => {
        btn.onclick = () => { renderEvolvePreview(main, Number(btn.dataset.i), matName, have); };
      });
      cb.innerHTML = '';
    }
  }

  function renderEvolvePreview(pet, i, matName, have) {
    const E = Config.pet.evolution || {};
    const pb = $('evolve-preview');
    const cb = $('evolve-confirm');
    const tb = $('evolve-target-box');
    if (!pb || !cb || !tb) return;
    const routes = Evolve.getEvolutionRoutes(pet);
    const route = routes[i];
    if (!route) return;
    const cur = getStats(pet);
    // 成长加成在「预览这一次」定死并记进 state：
    // 1) renderAll 每秒重建面板，数字不会乱跳；
    // 2) 确认时把这个 boost 传给 Evolve.evolve，做到预览多少就是多少。
    if (!evolvePreview || evolvePreview.petId !== pet.id || evolvePreview.routeIndex !== i) {
      // 成长加成按「下一阶」的档位随机（三阶淬体 +0.3~0.4，其它阶 +0.1~0.2）
      const range = (route && route.stage && E.stages) ? ((E.stages.find(s => s.stage === route.stage) || {}).growthBoost || E.growthBoost) : E.growthBoost;
      evolvePreview = { petId: pet.id, routeIndex: i, boost: window.Util.randFloat(range[0], range[1]) };
    }
    const boostItems = (E.boostItems || []).map(id => Config.itemOf(id)).filter(item => item && item.category === 'evolve');
    const selectedItem = evolvePreview.boostItemId ? Config.itemOf(evolvePreview.boostItemId) : null;
    const boost = Math.round(evolvePreview.boost * (1 + (selectedItem ? selectedItem.boost || 0 : 0)) * 100) / 100;
    const nextGrowth = Math.round((pet.growth + boost) * 10) / 10;
    const next = getStats({ ...pet, growth: nextGrowth });
    const row = (label, a, b) => {
      const cls = b > a ? 'up': b < a ? 'down': '';
      const arrowTxt = b > a ? '▲' : b < a ? '▼' : '—';
      return `<tr><td>${label}</td><td>${a}</td><td class="${cls}">${b} ${arrowTxt}</td></tr>`;
    };
    // 5 阶（2026-09-06）：素材档位/数量/终阶额外素材统一从 stages 读
    const rm = Evolve.getRouteMaterial ? Evolve.getRouteMaterial(pet, i) : null;
    const matAmt = rm ? rm.amount : 1;
    const ex = rm && rm.extra ? rm.extra : null;
    const stageLabel = (rm && rm.label) || '';
    const formText = route.keepForm ? `淬体进阶${stageLabel ? '（' + stageLabel + '）': ''}：形态不变，成长值提升`: `进化后名字变为【${route.to}】${stageLabel ? '（' + stageLabel + '）': ''}`;
    const lvOk = pet.level >= (route.minLevel || 1);
    // 同名素材（若下一阶配了同名 extra）已在 rm.enough 里按合并总量判定；异名才单独看 ex.enough
    const matOk = rm ? (rm.enough && (!ex || ex.sameName || ex.enough)) : have >= 1;
    const itemOk = !selectedItem || Materials.getQuantity(selectedItem.name) >= 1;
    const canEvolve = lvOk && matOk && itemOk;
    const boostOptions = ['<option value="">不用强化道具</option>'].concat(boostItems.map(item =>
      `<option value="${item.id}"${selectedItem && selectedItem.id === item.id ? ' selected' : ''}>${item.icon} ${item.name}｜${item.effect}（持有 ${Materials.getQuantity(item.name)}）</option>`
    )).join('');
    let warnRow = '';
    if (!lvOk) warnRow += `<div class="es-preview-row warn"> 等级不足：需要 Lv.${route.minLevel}，当前 Lv.${pet.level}</div>`;
    if (rm && !rm.enough) warnRow += `<div class="es-preview-row warn"> 材料不足：需要 ${rm.total || matAmt} 个 ${matName}${ex && ex.sameName ? '（含终阶额外 ' + ex.amount + ' 个）' : ''}，当前持有 ${rm.have}</div>`;
    if (ex && !ex.sameName && !ex.enough) warnRow += `<div class="es-preview-row warn"> ${stageLabel}额外材料不足：需要 ${ex.amount} 个 ${ex.name}，当前持有 ${ex.have}</div>`;
    if (selectedItem && !itemOk) warnRow += `<div class="es-preview-row warn"> ${selectedItem.name}不足：需要 1 个，当前持有 ${Materials.getQuantity(selectedItem.name)}</div>`;
    // 目标形态卡
    tb.innerHTML = `<div class="evo-card next">
      <div class="avatar">${routeIcon(route.to)}</div>
      <div class="pname">${route.to}</div>
      <div class="pmeta">${stageLabel || '进化后'} · Lv.${pet.level}（不变）· 成长 ${nextGrowth.toFixed(1)}${route.minLevel ? ' · 需 Lv.' + route.minLevel : ''}</div>
    </div>`;
    // 方向卡（选中态）+ 对照表 + 消耗 + 警告
    pb.innerHTML = `
      <div class="alt-routes">${routes.map((r, j) => {
        const okLevel = pet.level >= (r.minLevel || 1);
        const on = j === i ? ' on': '';
        return `<div class="alt-route${on}" data-i="${j}">
          <span class="ic">${routeIcon(r.to)}</span>
          <span class="rt-name">${r.to}${r.minLevel ? `<span class="lv-tag ${okLevel ? 'ok' : 'no'}">Lv.${r.minLevel}</span>` : ''}</span>
          <small>${r.label ? '→ ' + r.label : ''}</small>
        </div>`;
      }).join('')}</div>
      <table class="cmp-table"><tr><th>属性</th><th>当前</th><th>进化后</th></tr>
        ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}
      </table>
      <div class="req-row">
        <span>消耗 <b>${matName} ×${(rm && ex && ex.sameName) ? rm.total : matAmt}</b>${ex && !ex.sameName ? ` + <b>${ex.name} ×${ex.amount}</b>` : ''}（持有 ${rm ? (ex && !ex.sameName ? rm.have + ' / ' + ex.have : rm.have) : have}）</span>
        <span>强化道具 <select id="evolve-boost-item">${boostOptions}</select></span>
        <span>成长 <b>+${evolvePreview.boost.toFixed(2)}${selectedItem ? ' → +' + boost.toFixed(2) : ''}</b> · ${formText} · 进化 ${pet.evolveTimes || 0}→${(pet.evolveTimes || 0) + 1}</span>
      </div>
      ${warnRow}`;
    pb.querySelectorAll('.alt-route').forEach(btn => {
      btn.onclick = () => { renderEvolvePreview(pet, Number(btn.dataset.i), matName, have); };
    });
    pb.querySelector('#evolve-boost-item').onchange = event => {
      evolvePreview.boostItemId = event.target.value || null;
      renderEvolvePreview(pet, i, matName, have);
    };
    cb.innerHTML = `<button class="confirm-btn" id="evolve-ok"${canEvolve ? '': 'disabled'}>确认进化</button>`;
    cb.querySelector('#evolve-ok').onclick = async () => {
      if (!canEvolve) {
        showToast('无法进化', !lvOk ? '等级不够': '材料不足');
        return;
      }
      const origName = pet.name;
      const origGrowth = pet.growth;
      const res = await Evolve.evolve(pet.id, i, evolvePreview.boost, evolvePreview.boostItemId);
      if (res.error) { showToast('进化失败', res.error); return; }
      const changed = res.keepForm ? '（形态不变）': '';
      const itemText = res.boostItem ? `（消耗 ${res.boostItem.name}）` : '';
      addLog(`进化成功！${origName} → 【${res.result}】成长 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}（第 ${res.stage}/5 阶）${changed}${itemText}`);
      showToast('进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${itemText}</small>`);
      evolveMainId = res.pet ? res.pet.id : pet.id;
      evolvePreview = null; // 已进化：旧预览（形态/成长都变了）作废
      UI.renderAll();
    };
  }

  // 神宠培育（2026-09-11）：神级宠吃玉露直接涨成长（天仙 0.5~0.8 / 琼浆 0.8~1.3），成长 100 封顶。
  // 不占进化次数、不改形态；普通宠不适用（它们走正常进化）。
  function renderGodCultivate(main) {
    const mb = $('evolve-main-box'), tb = $('evolve-target-box'), pb = $('evolve-preview'), cb = $('evolve-confirm');
    const items = (Config.itemsOf ? Config.itemsOf('evolve') : []).concat(Config.itemsOf ? Config.itemsOf('cultivate') : []).filter(i => i.godGrowth);
    if (!godCulItemId && items.length) godCulItemId = items[0].id;
    const item = items.find(i => i.id === godCulItemId) || null;
    const have = item && Materials.getQuantity ? Materials.getQuantity(item.name) : 0;
    const maxCul = (Config.pet && Config.pet.godPets && Config.pet.godPets.cultivateMax) || 10;
    const used = main.cultivateUsed || 0;
    const left = Math.max(0, maxCul - used);
    const outOfTurn = used >= maxCul;
    const full = (main.growth || 0) >= 100;
    const nextGrowth = item ? Math.min(100, Math.round((main.growth + (item.godGrowth[0] + item.godGrowth[1]) / 2) * 10) / 10) : main.growth;
    mb.innerHTML = `<div class="evo-card">
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="pname">${main.name} · 神级</div>
      <div class="pmeta">Lv.${main.level} · 成长 ${main.growth.toFixed(1)}${full ? ' · 已满' : ''}</div>
    </div>`;
    tb.innerHTML = `<div class="evo-card next">
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="pname">培育</div>
      <div class="pmeta">神宠不走进化树 · 吃玉露直接涨成长（上限 100）</div>
    </div>`;
    const opts = items.map(i => '<option value="' + i.id + '"' + (i.id === godCulItemId ? ' selected' : '') + '>' + i.name + ' +' + i.godGrowth[0] + '~' + i.godGrowth[1] + '（持有 ' + (Materials.getQuantity ? Materials.getQuantity(i.name) : 0) + '）</option>').join('');
    pb.innerHTML = `<div class="preview-bar">
      <div class="pv"><div class="k">培育素材</div><div class="v"><select id="god-cul-item">${opts}</select></div></div>
      <div class="pv"><div class="k">成长</div><div class="v">${main.growth.toFixed(1)} → ${nextGrowth.toFixed(1)}<small>${item ? '期望 +' + item.godGrowth[0] + '~' + item.godGrowth[1] : ''}</small></div></div>
      <div class="pv"><div class="k">本轮次数</div><div class="v">${used}/${maxCul}<small>${outOfTurn ? '已用完 · 涅槃后重置' : '剩 ' + left + ' 次'}</small></div></div>
      <div class="pv"><div class="k">说明</div><div class="v"><small>形态与等级不变 · 只涨成长 · 上限 100</small></div></div>
    </div>`;
    cb.innerHTML = `<button class="confirm-btn" id="god-cul-go"${(!item || have < 1 || full || outOfTurn) ? ' disabled' : ''}>确认培育</button>`;
    const sel = document.getElementById('god-cul-item');
    if (sel) sel.onchange = () => { godCulItemId = sel.value; renderGodCultivate(main); };
    document.getElementById('god-cul-go').onclick = async () => {
      const res = await Merge.cultivate(main.id, godCulItemId);
      if (res.error) { addLog(`培育失败：${res.error}`); showToast('培育失败', res.error); return; }
      addLog(`培育成功！${res.pet.name} 成长 +${res.add.toFixed(1)}（消耗 ${res.itemName}；本轮还剩 ${res.left}/${maxCul} 次）`);
      showToast('培育成功！', `${res.pet.name} 成长 +${res.add.toFixed(1)}（剩 ${res.left} 次）`);
      UI.renderAll();
    };
  }
  function renderEvolveHint() {
    const el = $('evolve-hint-text');
    const E = Config.pet.evolution;
    if (el && E) el.innerHTML = `进化：5 个阶段 = 初始 → <b>一阶 Lv10</b>（进化素材）→ <b>二阶 Lv25</b>（精粹）→ <b>三阶 Lv40</b> 淬体（传说，形态不变）→ <b>终阶 Lv60</b>（传说×1，解锁主动技能）。等级不变、成长提升；只有<b>终阶</b>宠才能参与<b>神级宠</b>合成；神宠可在本页吃<b>天仙玉露 / 琼浆玉露</b>培育成长（上限 100）。`;
  }



  /* ---------- 对外 API ---------- */
  UI.renderEvolveTab = renderEvolveTab;
  UI.renderEvolveHint = renderEvolveHint;
})();
