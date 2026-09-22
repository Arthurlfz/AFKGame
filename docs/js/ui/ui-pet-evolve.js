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

  // 阶段总数：唯一一份在 PetUI.stageTotal（共享库），这里只做别名，别再各页各抄一遍
  const stageCount = () => (PetUI.stageTotal ? PetUI.stageTotal() : 5);

  // 培育记录 / 二次确认 / 千分位等统一走共享库（PetUI，见 ui-pet.js）
  const fmtNum = n => (PetUI.fmtNum ? PetUI.fmtNum(n) : String(n));
  const petKey = p => (p && (p.cloudId || ('local-' + p.id))) || '';
  const recordOf = (p, text, delta) => { if (PetUI.pushRecord) PetUI.pushRecord(petKey(p), text, delta); };

  /* 进化之路（阶段轨道）：真实数据 —— Config.pet.evolution.stages + 这只宠的当前阶。
   * 放在进化页下方（原来那块是空白）：一眼看清"我走到第几阶、下一阶要多少级/什么材料、手里有多少"。 */
  function evolutionTrackHtml(pet) {
    const E = Config.pet.evolution || {};
    const stages = (E.stages || []).slice().sort((a, b) => (a.stage || 0) - (b.stage || 0));
    if (!stages.length) return '';
    const cur = PetUI.stageOf(pet);
    const track = '<div class="lg-track">' + stages.map(s => {
      const n = s.stage || 0;
      const cls = n < cur ? 'done' : n === cur ? 'cur' : 'lock';
      return '<span class="' + cls + '">' + escapeHtml(s.label || (n + '阶')) + (s.minLevel ? ' Lv.' + s.minLevel : '') + '</span>';
    }).join('') + '</div>';
    const nx = E.nextStage ? E.nextStage(pet) : null;
    let next = '';
    if (nx) {
      const gap = Math.max(0, (nx.minLevel || 0) - (pet.level || 0));
      const matName = nx.material;
      const have = (matName && window.Materials && window.Materials.getQuantity) ? Number(window.Materials.getQuantity(matName)) || 0 : null;
      next = '<div class="lg-prog"><span class="k">下一阶等级</span>'
        + PetUI.barHtml(pet.level || 1, nx.minLevel || 1, gap <= 0 ? 'is-ok' : '')
        + '<span class="v">' + (gap > 0 ? '差 ' + gap + ' 级' : '已达标') + '</span></div>'
        + (matName ? '<div class="lg-prog' + (have != null && have >= (nx.amount || 1) ? ' is-ok' : '') + '"><span class="k">' + escapeHtml(matName) + '</span>'
          + PetUI.barHtml(have || 0, nx.amount || 1, have != null && have >= (nx.amount || 1) ? 'is-ok' : '')
          + '<span class="v">' + (have == null ? '—' : fmtNum(have) + ' / ' + fmtNum(nx.amount || 1)) + '</span></div>' : '');
    } else {
      next = '<div class="lg-warn lg-warn--calm">已是终阶 —— 进化之路走完了。想再变强：去<b>合成</b>搏神级宠，或去<b>涅槃</b>重置重练。</div>';
    }
    return '<div class="lg-head">进化之路<span class="hint">' + cur + '/' + stageCount() + ' 阶</span></div>' + track + next;
  }

  /* ---------- 分支差异：这条分支"最后长成谁、学什么技能"（2026-09-22 内测 🟠14）----------
   * 玩家反馈"血牙狐和幽火狐不知道哪个强，选哪个都一样"。
   * 取证结论（别再猜）：**两条分支的数值本来就是一样的**（速度表 / 成长 / 门槛全同，
   * 见 Config.pet.speeds 与 evolution.tree），真正的差异只有两样 ——
   *   ① 后面长成哪个终形态（血牙狐→血灾领主→血月魔狐｜幽火狐→幽火王→幽火魔狐）
   *   ② 那个终形态的**主动技能**（血月斩 13%×2.0 ｜ 幽火焚身 20%×1.5）
   * ⇒ 不造假差异（不偷偷给一条加攻击，2026-09-22 用户拍板"不加数值差异"），
   *   而是把这两样**摆出来**，让玩家按技能口味选。
   * ⚠️ 查询走 `PetUI.finalFormOf / finalSkillOf`（ui-pet.js 里唯一一份），本文件不抄第二份。 */
  function branchSkillLine(name) {
    const fin = (PetUI.finalFormOf ? PetUI.finalFormOf(name) : name);
    const sk = PetUI.finalSkillOf ? PetUI.finalSkillOf(name) : null;
    if (!sk) return '';
    const eff = (PetUI.skillEffectLine ? PetUI.skillEffectLine(sk) : '');
    return `<span class="rt-skill">终形态会学 <b>${escapeHtml(sk.name)}</b>：${escapeHtml(eff)}</span>`;
  }


  /* ---------- 底部 CTA 栏（V3 §6：四页同位置、同规格）----------
   * 按钮**常驻**（不可用时置灰），原因排在按钮**左边**、同一栏内展示。
   * 原来禁用时是一行红字 + 按钮本体照旧渲染，位置在底部左角、视觉权重极低（用户反馈"难发现"）。 */
  function renderEvolveCtaIdle(why) {
    const cb = $('evolve-confirm');
    if (cb) cb.innerHTML = (why ? '<div class="lg-cta-why is-bad">' + escapeHtml(why) + '</div>' : '')
      + '<button type="button" class="lg-cta" id="evolve-ok" disabled>确认进化</button>';
  }

  function renderEvolveTab() {
    const list = $('evolve-pet-list');
    if (!list) return;
    const pets = getPets();
    /* 统一列表卡（PetUI.renderList）：能进化的在前，不能的置灰并**写明原因**（别让玩家选完才在右边看到报错）。 */
    PetUI.renderList(list, pets, {
      selectedId: evolveMainId,
      lockOf: p => {
        if (!p.cloudId) return '未同步云端 · 刷新页面后再试';
        if (Market && Market.isListed && Market.isListed(p.cloudId)) return '在集市出售中 · 先取回';
        if (!PetUI.isGodOf(p) && !(Evolve.hasRoute && Evolve.hasRoute(p))) return '已到终阶 · 没有下一阶了';
        return null;
      },
      extraOf: p => (PetUI.isGodOf(p) ? '<span class="lg-on">神级宠 · 在本页吃玉露培育成长</span>' : ''),
      emptyHtml: '还没有宠物：先去「背包 · 素材蛋」孵化一只（挂机掉蛋）',
      onPick: (pet) => {
        evolveMainId = pet.id;
        evolvePreview = null; // 换主宠 → 旧的方向预览作废
        UI.renderAll();
      }
    });
    const main = pets.find(p => p.id === evolveMainId) || null;
    renderEvolveStage(main);
  }

  // 进化 v2 面板化：当前形态 ｜ → ｜ 目标形态 + 属性对照表 + 方向卡 + 消耗 + 确认
  // 步骤条：选主宠 → 选方向 → 确认进化（每一步的三种状态都由这里算，页面里不再各写一遍）
  function syncEvolveSteps(main) {
    PetUI.stepsInto($('evolve-steps'), [
      { label: '选主宠', state: main ? 'done' : 'cur' },
      { label: '选方向', state: !main ? 'todo' : (evolvePreview ? 'done' : 'cur') },
      { label: '确认进化', state: (main && evolvePreview) ? 'cur' : 'todo' }
    ]);
  }

  function renderEvolveStage(main) {
    const mb = $('evolve-main-box');
    const tb = $('evolve-target-box');
    const pb = $('evolve-preview');
    const cb = $('evolve-confirm');
    if (!mb || !tb || !pb || !cb) return;
    const E = Config.pet.evolution || {};
    const arrow = $('evolve-arrow');
    if (!main) {
      /* 空态：摊一张「三步图解」而不是一行灰字 —— 玩家第一次点进来就知道这个玩法怎么走。 */
      mb.innerHTML = '<div class="lg-box">'
        + '<div class="lg-head">进化 · 三步</div>'
        + '<div class="lg-flow">'
        +   '<div><div class="fh">选主宠</div><div class="fd">在左栏点一只（神级宠在本页吃玉露培育，不走进化树）</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">选方向</div><div class="fd">等级够 + 素材够才能进；两条分支强度一样，按想学的技能选</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">确认进化</div><div class="fd">等级不变、成长提升；三阶是淬体（形态不变），终阶解锁主动技能</div></div>'
        + '</div></div>';
      tb.innerHTML = ''; pb.innerHTML = '';
      renderEvolveCtaIdle('先在左侧选一只主宠');   // V3 §6：按钮常驻，不许整个消失
      if (arrow) arrow.innerHTML = '';
      syncEvolveSteps(null);
      const ex0 = $('evolve-extra'); if (ex0) ex0.innerHTML = '';
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
    /* 左卡 = 当前形态（CURRENT 角标），与右卡（RESULT 角标）成对；
     * 进化次数旁边挂 ? —— 那条规则玩家一直搞混（"次数满了是不是就不能进化了？"）。 */
    mb.innerHTML = `<div class="evo-card">
      <span class="lg-cap lg-cap--cur">CURRENT · 当前</span>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="pname">${main.name}${mainIsGod ? ' · 神级' : ''}</div>
      <div class="pmeta">Lv.${main.level} · ${window.Pet && window.Pet.stageLabel ? window.Pet.stageLabel(main) : '第' + ((main.evolveTimes || 0) + 1) + '阶'}
        · 进化 <span class="lg-num">${times}/${maxTimes}</span><span class="q-tip" data-tip="进化次数只是累计记录；真正的闸门是『还有没有下一阶』—— 走到终阶就到此为止（老存档出现过次数满但仍、卡在中间阶的情况，所以判据改成了阶数）。"></span>
        · 转生 ${main.rebornCount || 0}</div>
    </div>`;
    /* 下方空白区填上真实内容：进化之路（阶段轨道 + 下一阶门槛） + 本机培育记录 */
    syncEvolveSteps(main);
    const exEl = $('evolve-extra');
    if (exEl) exEl.innerHTML = evolutionTrackHtml(main) + (PetUI.recordsHtml ? PetUI.recordsHtml(petKey(main), '培育记录') : '');

    /* 2026-09-20：这两句文案原来写死"两只终阶宠 + 成长 60"——数值不跟 config 走，
     *   而且副宠放宽后已经不准（副宠只看终阶，不看成长）。现在从**判定字段**派生 + 说清谁有门槛。 */
    const godGate = `主宠终阶 + 成长 ${((Config.synthesize && Config.synthesize.god && Config.synthesize.god.minGrowth) != null) ? Config.synthesize.god.minGrowth : 60}（副宠只要终阶，不看成长）可在<b>合成</b>里搏一只神级宠`;
    if (maxed) {
      tb.innerHTML = `<div class="warn"> 已登临<b>终阶</b>（${stageCount()} 阶走完）——进化之路到此为止。想再变强：${godGate}，或走<b>涅槃</b>重置重练。</div>`;
      pb.innerHTML = ''; evolvePreview = null;
      renderEvolveCtaIdle('已到终阶 · 没有下一阶了');
      return;
    }
    if (!routes.length) {
      // 兜底（正常走不到：没下一阶时上面的 maxed 已返回）：形态无法再进化
      const atFinal = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(main) >= stageCount() : false;
      tb.innerHTML = atFinal
        ? `<div class="warn"> 已登临<b>终阶</b>——进化之路到此为止。想再变强：${godGate}。</div>`
        : '<div class="hint">该形态无法再进化</div>';
      pb.innerHTML = ''; evolvePreview = null;
      renderEvolveCtaIdle(atFinal ? '已到终阶 · 没有下一阶了' : '该形态无法再进化');
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
      /* 方向卡：把"最后长成谁 + 学什么技能"摆出来（🟠14）。
       * 底下那句总说明是**实情**：两条分支强度一样，别让玩家以为选错就废了。 */
      pb.innerHTML = `<div class="alt-routes">${routes.map((r, i) => {
        const okLevel = main.level >= (r.minLevel || 1);
        const fin = PetUI.finalFormOf ? PetUI.finalFormOf(r.to) : r.to;
        return `<div class="alt-route" data-i="${i}">
          <span class="ic">${routeIcon(r.to)}</span>
          <span class="rt-name">${r.to}${r.minLevel ? `<span class="lv-tag ${okLevel ? 'ok' : 'no'}">Lv.${r.minLevel}</span>` : ''}</span>
          <small>${fin && fin !== r.to ? '终形态 ' + escapeHtml(fin) : (r.label ? '→ ' + r.label : '')}</small>
          ${branchSkillLine(r.to)}
        </div>`;
      }).join('')}</div>`
        + (routes.length > 1
          ? '<div class="alt-routes-note">两条<b>强度一样</b>，差别只在终形态与技能，选错不会变弱。</div>'
          : '');
      pb.querySelectorAll('.alt-route').forEach(btn => {
        btn.onclick = () => { renderEvolvePreview(main, Number(btn.dataset.i), matName, have); };
      });
      renderEvolveCtaIdle('先选一个进化方向');
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
    // 挂机中：本地等级是"预演值"，可能比服务器真等级低。此时不禁用按钮——
    // 点了之后 duringPetEdit 会先结算拿到真等级再判，够了就进化，不够再报错。
    const isIdling = !!(window.IdleBridge && window.IdleBridge.isActive && window.IdleBridge.isActive());
    const canEvolve = isIdling ? (matOk && itemOk) : (lvOk && matOk && itemOk);

    let warnRow = '';
    if (!lvOk) {
      if (isIdling) {
        warnRow += `<div class="es-preview-row"> 挂机中：本地显示 Lv.${pet.level}，点确认后将先结算再核对真实等级（需 Lv.${route.minLevel}）</div>`;
      } else {
        warnRow += `<div class="es-preview-row warn"> 等级不足：需要 Lv.${route.minLevel}，当前 Lv.${pet.level}</div>`;
      }
    }
    if (rm && !rm.enough) warnRow += `<div class="es-preview-row warn"> 材料不足：需要 ${rm.total || matAmt} 个 ${matName}${ex && ex.sameName ? '（含终阶额外 ' + ex.amount + ' 个）' : ''}，当前持有 ${rm.have}</div>`;
    if (ex && !ex.sameName && !ex.enough) warnRow += `<div class="es-preview-row warn"> ${stageLabel}额外材料不足：需要 ${ex.amount} 个 ${ex.name}，当前持有 ${ex.have}</div>`;
    if (selectedItem && !itemOk) warnRow += `<div class="es-preview-row warn"> ${selectedItem.name}不足：需要 1 个，当前持有 ${Materials.getQuantity(selectedItem.name)}</div>`;
    /* 目标形态卡（RESULT · 结果）：
     * 2026-09-22 —— **形态不变的那一阶（淬体）不再重复放一次一样的立绘**（玩家会以为"点错了、没变化"），
     * 改成大字对比成长数字：957.5 → 958.2，这次到底换来什么一眼就看清。 */
    const keepForm = !!route.keepForm;
    tb.innerHTML = keepForm
      ? `<div class="evo-card next">
          <span class="lg-cap lg-cap--res">RESULT · 结果</span>
          <div class="pname">形态不变 · ${escapeHtml(stageLabel || '淬体')}</div>
          <div class="bigrow"><span class="lg-num">${pet.growth.toFixed(1)}</span><span class="lg-arrow">→</span><span class="lg-big">${nextGrowth.toFixed(1)}</span></div>
          <div class="pmeta">成长 +${evolvePreview.boost.toFixed(2)}${selectedItem ? ' → +' + boost.toFixed(2) : ''} · 名字不变 · 属性按新成长重算（见下表）</div>
        </div>`
      : `<div class="evo-card next">
          <span class="lg-cap lg-cap--res">RESULT · 结果</span>
          <div class="avatar">${routeIcon(route.to)}</div>
          <div class="pname">${route.to}</div>
          <div class="pmeta">${stageLabel || '进化后'} · Lv.${pet.level}（不变）· 成长 ${pet.growth.toFixed(1)} → ${nextGrowth.toFixed(1)}${route.minLevel ? ' · 需 Lv.' + route.minLevel : ''}</div>
        </div>`;
    /* 收益预览（结论层）：把三个主属性的**预计提升**单独拎出来 —— 表格是明细，这一行是"值不值得点"。
     * 成长涨 0.7 到底意味着什么，玩家看不出；换算成 +多少生命/+多少攻击 就一眼明白。 */
    const dGain = k => Math.round((next[k] || 0) - (cur[k] || 0));
    const gains = [['生命', dGain('hp')], ['攻击', dGain('atk')], ['防御', dGain('def')], ['速度', dGain('spd')]]
      .filter(x => x[1] !== 0)
      .map(x => ({ label: x[0], val: (x[1] > 0 ? '+' : '') + fmtNum(x[1]) }));
    const gainsBox = '<div class="lg-head">这一次的收益<span class="hint">按当前等级换算</span></div>'
      + (gains.length ? PetUI.chipsHtml(gains, 3) : '<div class="lg-empty-hint">这次进化属性几乎不变（成长提升要下一级才显出来）</div>');
    /* V2 第二行：进化后预览条（96px 全宽）—— 小头像 + 「当前名 → 结果」，不放表、不放按钮。 */
    const strip = '<div class="lg-strip">'
      + '<div class="lg-strip-art">' + routeIcon(pet.name) + '</div>'
      + '<div class="lg-strip-main">'
      +   '<div class="lg-strip-t">' + escapeHtml(pet.name) + ' <span class="lg-arrow">→</span> '
      +     escapeHtml(keepForm ? (stageLabel || '淬体') : route.to) + '</div>'
      +   '<div class="lg-strip-s">' + (keepForm ? '形态不变 · 名字不变' : '进化后叫【' + escapeHtml(route.to) + '】')
      +     ' · Lv.' + pet.level + '（不变）· 成长 ' + pet.growth.toFixed(1) + ' → ' + nextGrowth.toFixed(1) + '</div>'
      + '</div>'
      + '<div class="lg-strip-art">' + (keepForm ? routeIcon(pet.name) : routeIcon(route.to)) + '</div>'
      + '</div>';
    /* V2 第三行右：「消耗与强化」—— 素材持有进度条 + **自定义下拉**（原生 select 在暗色面板里是系统灰、与整体割裂）。 */
    const boostOpts = [{ value: '', label: '不用强化道具' }].concat(boostItems.map(item => ({
      value: item.id,
      label: item.name + '｜' + (item.effect || '') + '（持有 ' + Materials.getQuantity(item.name) + '）',
      disabled: Materials.getQuantity(item.name) < 1
    })));
    const matHave = rm ? Number(rm.have) || 0 : Number(have) || 0;
    const matNeed = (rm && (rm.total || matAmt)) || matAmt;
    const consumeBox = '<div class="lg-head">消耗与强化</div>'
      + '<div class="lg-prog' + (matHave >= matNeed ? ' is-ok' : '') + '"><span class="k">' + escapeHtml(matName) + '</span>'
      + PetUI.barHtml(matHave, matNeed, matHave >= matNeed ? 'is-ok' : '')
      + '<span class="v">' + fmtNum(matHave) + ' / ' + fmtNum(matNeed) + '</span></div>'
      + (ex && !ex.sameName ? '<div class="lg-prog' + (ex.have >= ex.amount ? ' is-ok' : '') + '"><span class="k">' + escapeHtml(ex.name) + '</span>'
        + PetUI.barHtml(ex.have, ex.amount, ex.have >= ex.amount ? 'is-ok' : '') + '<span class="v">' + fmtNum(ex.have) + ' / ' + fmtNum(ex.amount) + '</span></div>' : '')
      + '<div class="lg-field"><span class="k">强化道具</span>' + PetUI.selectHtml('evolve-boost-item', boostOpts, evolvePreview.boostItemId || '') + '</div>'
      + '<div class="lg-field"><span class="k">成长提升</span><span class="v">+' + evolvePreview.boost.toFixed(2)
      + (selectedItem ? ' → +' + boost.toFixed(2) : '') + '</span></div>'
      + '<div class="pn-tip" style="margin-top:4px">' + escapeHtml(formText) + ' · 进化 ' + (pet.evolveTimes || 0) + '→' + ((pet.evolveTimes || 0) + 1) + '</div>'
      + warnRow;
    // 方向卡（选方向）+ 预览条 + 左右两栏（收益 ｜ 消耗与强化）
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
      ${strip}
      <div class="lg-row2col">
        <div class="lg-box">${gainsBox}</div>
        <div class="lg-box">${consumeBox}</div>
      </div>`;
    pb.querySelectorAll('.alt-route').forEach(btn => {
      btn.onclick = () => { renderEvolvePreview(pet, Number(btn.dataset.i), matName, have); };
    });
    // 自定义下拉：点选项 → 记住选择并重渲染（预览值随强化丹变）
    PetUI.bindSelect(pb, 'evolve-boost-item', v => {
      evolvePreview.boostItemId = v || null;
      renderEvolvePreview(pet, i, matName, have);
    });
    /* 确认按钮三态（可点 / 禁用 / hover）：
     * 材料为 0 时**置灰 + 写明差多少**，并给一条「前往获取」——直接打开该材料的用途与来源表
     * （不是跳商店：魔石商店卖的是充值档位，进化素材只能靠挂机刷，跳过去是死路）。 */
    const lackText = (!lvOk && !isIdling)
      ? `等级不足：需要 Lv.${route.minLevel}，当前 Lv.${pet.level}`
      : (!matOk)
        ? `材料不足：${matName} 需要 ${(rm && (rm.total || matAmt)) || matAmt} 个，当前持有 ${rm ? rm.have : have}`
        : (!itemOk)
          ? `道具不足：${selectedItem ? selectedItem.name : ''} 需要 1 个`
          : '';
    /* V3 §6：**原因排在最左**（右对齐贴在按钮左边），然后是"去哪弄"的次按钮，最后是主按钮。 */
    cb.innerHTML = (lackText ? '<div class="lg-cta-why is-bad">' + escapeHtml(lackText) + '</div>' : '')
      + ((!matOk && matName) ? '<button type="button" class="lg-cta lg-cta--ghost" id="evolve-get">材料不足 · 查看「' + escapeHtml(matName) + '」获取途径 →</button>' : '')
      + '<button type="button" class="lg-cta" id="evolve-ok"' + (canEvolve ? '' : ' disabled') + '>确认进化</button>';
    const getBtn = cb.querySelector('#evolve-get');
    if (getBtn) {
      getBtn.onclick = () => {
        if (UI.openMatEntry) UI.openMatEntry(matName);
        else showToast('获取途径', matName + '：对应地图挂机掉落（背包里点这个材料也能看来源）');
      };
    }
    const doEvolve = async (btn) => {
      const origName = pet.name;
      const origGrowth = pet.growth;
      // 融合过渡动画：不预弹，等 Evolve.evolve 通过所有检查（等级/材料/登录/在售）后才触发
      let closeFusion = null;
      const res = await UI.runWithLoading(btn, '进化中…', () => Evolve.evolve(pet.id, i, evolvePreview.boost, evolvePreview.boostItemId, {
        onFuseStart: () => { closeFusion = UI.showFusion ? UI.showFusion() : null; }
      })) || { error: '请稍候再试' };
      if (closeFusion) closeFusion(!res.error);
      if (res.error) { showToast('进化失败', res.error); return; }
      const changed = res.keepForm ? '（形态不变）': '';
      const itemText = res.boostItem ? `（消耗 ${res.boostItem.name}）` : '';
      addLog(`进化成功！${origName} → 【${res.result}】成长 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}（第 ${res.stage}/5 阶）${changed}${itemText}`);
      showToast('进化成功！', `${origName} → <b style="color:#f2b632">【${res.result}】</b>${changed}<br><small>成长值 ${origGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}${itemText}</small>`);
      // 本机培育记录（下方"培育记录"列表的数据来源）
      recordOf(pet, (res.keepForm ? '淬体' : '进化 → ' + res.result) + ' · 消耗 ' + matName + ' ×' + ((rm && (rm.total || matAmt)) || matAmt) + (res.boostItem ? ' + ' + res.boostItem.name : ''),
        '成长 +' + (res.newGrowth - origGrowth).toFixed(2));
      // 揭幕演出：进化是"跳变"的那一下，攒很久才做一次，值得给足仪式感
      if (UI.celebrate) UI.celebrate({ title: '进化', name: '【' + res.result + '】', sub: '成长 ' + origGrowth.toFixed(1) + ' → ' + res.newGrowth.toFixed(1) });
      evolveMainId = res.pet ? res.pet.id : pet.id;
      evolvePreview = null; // 已进化：旧预览（形态/成长都变了）作废
      UI.renderAll();
    };
    /* 进化要串 2~3 次服务器往返（扣进化素材 → 改宠物），约 0.7~1 秒。加反馈，别让玩家干等。 */
    const evoBtn = cb.querySelector('#evolve-ok');
    evoBtn.onclick = () => {
      if (!canEvolve) {
        showToast('无法进化', (!matOk || !itemOk) ? '材料不足': '等级不够');
        return;
      }
      // 消耗性操作：先给"要花什么、换来什么"，点了确认才真执行
      PetUI.confirmIrreversible({
        title: '⚔ 确认进化',
        okLabel: '确认进化',
        fallbackText: '确认进化？会消耗进化素材（不返还）。',
        bodyHtml: '<div class="salvage-detail">'
          + '<div>主宠：<b>' + escapeHtml(pet.name) + '</b>（Lv.' + pet.level + ' · 成长 ' + pet.growth.toFixed(1) + '）</div>'
          + '<div>结果：' + escapeHtml(keepForm ? '形态不变（' + (stageLabel || '淬体') + '）' : '进化为【' + route.to + '】') + '</div>'
          + '<div>消耗：<b>' + escapeHtml(matName) + ' ×' + ((rm && (rm.total || matAmt)) || matAmt) + '</b>'
          + (ex && !ex.sameName ? ' + ' + escapeHtml(ex.name) + ' ×' + ex.amount : '')
          + (selectedItem ? ' + ' + escapeHtml(selectedItem.name) + ' ×1' : '') + '</div>'
          + '<div>预计收益：' + (gains.length ? escapeHtml(gains.map(g => g.label + ' ' + g.val).join(' · ')) : '属性几乎不变') + '</div>'
          + '<div class="salvage-warn">等级不变；进化素材消耗后不返还。</div>'
          + '</div>',
        onOk: () => doEvolve(evoBtn)
      });
    };
  }

  /* 神宠培育（2026-09-11）：神级宠吃玉露直接涨成长（天仙 0.5~0.8 / 琼浆 0.8~1.3）。
   * ⚠️ 2026-09-17 用户拍板：**取消「成长 100 封顶」** —— 原来到 100 这里就把按钮置灰、
   *   预览值也钳在 100（客户端三层叠加之一）。现在只受「本轮次数」限制
   *   （godPets.cultivateMax，涅槃后重置），成长本身无上限。
   * 不占进化次数、不改形态；普通宠不适用（它们走正常进化）。 */
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
    const nextGrowth = item ? Math.round((main.growth + (item.godGrowth[0] + item.godGrowth[1]) / 2) * 10) / 10 : main.growth;
    const cur = getStats(main);
    const next = getStats(Object.assign({}, main, { growth: nextGrowth }));
    // 步骤条（神宠这条线只有两步：选主宠 → 确认培育）
    PetUI.stepsInto($('evolve-steps'), [
      { label: '选主宠', state: 'done' },
      { label: '确认培育', state: (item && have >= 1 && !outOfTurn) ? 'cur' : 'todo' }
    ]);
    // 上方（非神宠路径）写过的"进化之路"要清掉，否则换到神宠后还挂着上一只宠的轨道
    const exGod = $('evolve-extra');
    if (exGod) exGod.innerHTML = PetUI.recordsHtml ? PetUI.recordsHtml(petKey(main), '培育记录') : '';
    mb.innerHTML = `<div class="evo-card">
      <span class="lg-cap lg-cap--cur">CURRENT · 当前</span>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="pname">${main.name} · 神级</div>
      <div class="pmeta">Lv.${main.level} · 成长 <span class="lg-num">${main.growth.toFixed(1)}</span>
        · 本轮培育 <span class="lg-num">${used}/${maxCul}</span><span class="q-tip" data-tip="神宠培育次数：每轮 ${maxCul} 次，涅槃后重置。成长本身没有上限 —— 2026-09-17 拍板取消成长 100 封顶。"></span></div>
    </div>`;
    /* 神宠不走进化树：**把进化树灰着摊出来并写明原因**，而不是一行小字。
     * 玩家看到的是"这条路封了、但另一条路开着"，不是"界面坏了/没内容"。 */
    tb.innerHTML = `<div class="evo-card next">
      <span class="lg-cap lg-cap--res">RESULT · 结果</span>
      <div class="lg-locked-tree">
        <div class="lg-head">进化之路</div>
        ${evolutionTrackHtml(main)}
        <div class="lg-lock-note">神级宠已跳出 5 阶形态<br>进化树对它不再起作用</div>
      </div>
      <div class="pmeta">神的成长只能在下方吃玉露培育（形态与等级都不变）</div>
    </div>`;
    const opts = items.map(i => '<option value="' + i.id + '"' + (i.id === godCulItemId ? ' selected' : '') + '>' + i.name + ' +' + i.godGrowth[0] + '~' + i.godGrowth[1] + '（持有 ' + (Materials.getQuantity ? Materials.getQuantity(i.name) : 0) + '）</option>').join('');
    const dGain = k => Math.round((next[k] || 0) - (cur[k] || 0));
    const gains = [['生命', dGain('hp')], ['攻击', dGain('atk')], ['防御', dGain('def')]].filter(x => x[1] !== 0)
      .map(x => ({ label: x[0], val: (x[1] > 0 ? '+' : '') + fmtNum(x[1]) }));
    pb.innerHTML = `<div class="preview-bar">
      <div class="pv"><div class="k">培育素材</div><div class="v"><select id="god-cul-item">${opts}</select></div></div>
      <div class="pv"><div class="k">成长（期望值）</div><div class="v">${main.growth.toFixed(1)} → ${nextGrowth.toFixed(1)}<small>${item ? '每次 +' + item.godGrowth[0] + '~' + item.godGrowth[1] + '（期望值显示）' : '没有可用的玉露'}</small></div></div>
      <div class="pv"><div class="k">本轮次数</div><div class="v">${used}/${maxCul}<small>${outOfTurn ? '已用完 · 涅槃后重置' : '剩 ' + left + ' 次'}</small></div></div>
    </div>
    <div class="lg-prog"><span class="k">本轮进度</span>${PetUI.barHtml(used, maxCul, outOfTurn ? 'is-ok' : '')}<span class="v">${used} / ${maxCul}</span></div>
    <div class="lg-box" style="margin-top:8px"><div class="lg-head">这一次的收益<span class="hint">按当前等级换算</span></div>
      ${gains.length ? PetUI.chipsHtml(gains) : '<div class="lg-empty-hint">成长提升要下一级才显出来</div>'}
    </div>`;
    const lackText = outOfTurn ? `本轮培育次数已用完（${used}/${maxCul}）· 涅槃后重置`
      : (!item ? '没有可用的玉露道具'
        : (have < 1 ? `缺少 ${item.name}：图 11~17 挂机掉落 / 活动获取` : ''));
    cb.innerHTML = (lackText ? '<div class="lg-cta-why is-bad">' + escapeHtml(lackText) + '</div>' : '')
      + '<button type="button" class="lg-cta" id="god-cul-go"' + ((!item || have < 1 || outOfTurn) ? ' disabled' : '') + '>确认培育</button>';
    const sel = document.getElementById('god-cul-item');
    if (sel) sel.onchange = () => { godCulItemId = sel.value; renderGodCultivate(main); };
    const godCulBtn = document.getElementById('god-cul-go');
    const doCultivate = async () => {
      const res = await UI.runWithLoading(godCulBtn, '培育中…', () => Merge.cultivate(main.id, godCulItemId)) || { error: '请稍候再试' };
      if (res.error) { addLog(`培育失败：${res.error}`); showToast('培育失败', res.error); return; }
      addLog(`培育成功！${res.pet.name} 成长 +${res.add.toFixed(1)}（消耗 ${res.itemName}；本轮还剩 ${res.left}/${maxCul} 次）`);
      showToast('培育成功！', `${res.pet.name} 成长 +${res.add.toFixed(1)}（剩 ${res.left} 次）`);
      recordOf(main, '培育 · 消耗 ' + res.itemName + ' ×1（剩 ' + res.left + ' 次）', '成长 +' + res.add.toFixed(1));
      UI.renderAll();
    };
    godCulBtn.onclick = () => {
      if (!item || have < 1 || outOfTurn) { showToast('无法培育', lackText || '条件不足'); return; }
      PetUI.confirmIrreversible({
        title: '✿ 确认培育',
        okLabel: '确认培育',
        fallbackText: '确认培育？会消耗 1 个' + (item ? item.name : '玉露') + '（不返还）。',
        bodyHtml: '<div class="salvage-detail">'
          + '<div>神级宠：<b>' + escapeHtml(main.name) + '</b>（Lv.' + main.level + ' · 成长 ' + main.growth.toFixed(1) + '）</div>'
          + '<div>消耗：<b>' + escapeHtml(item ? item.name : '') + ' ×1</b>（持有 ' + have + '）</div>'
          + '<div>结果：成长 → ' + nextGrowth.toFixed(1) + '（形态与等级不变）</div>'
          + '<div>' + (gains.length ? '预计收益：' + escapeHtml(gains.map(g => g.label + ' ' + g.val).join(' · ')) : '属性提升要下一级才显出来') + '</div>'
          + '<div class="salvage-warn">玉露消耗后不返还；本轮还剩 ' + left + ' 次。</div>'
          + '</div>',
        onOk: doCultivate
      });
    };
  }
  function renderEvolveHint() {
    const el = $('evolve-hint-text');
    const E = Config.pet.evolution;
    if (el && E) el.innerHTML = `进化：5 个阶段 = 初始 → <b>一阶 Lv10</b>（进化素材）→ <b>二阶 Lv25</b>（精粹）→ <b>三阶 Lv40</b> 淬体（传说，形态不变）→ <b>终阶 Lv60</b>（传说×1，解锁主动技能）。等级不变、成长提升；只有<b>终阶</b>宠才能参与<b>神级宠</b>合成；神宠可在本页吃<b>天仙玉露 / 琼浆玉露</b>培育成长（无上限）。`;
  }



  /* ---------- 对外 API ---------- */
  UI.renderEvolveTab = renderEvolveTab;
  UI.renderEvolveHint = renderEvolveHint;
})();
