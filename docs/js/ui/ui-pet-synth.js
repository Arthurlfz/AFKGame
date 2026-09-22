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

  /* 一只宠"能不能当合成素材"，以及**差什么**（合成页最重要的一个判定：
   * 以前是"不合格的宠根本不出现"，玩家看不到自己离门槛有多近 —— 现在全部列出来、置灰写明原因）。 */
  function synthLockReason(pet, minLevel) {
    const ec = Object.values(pet.equipment || {}).filter(Boolean).length;
    if (!pet.cloudId) return '未同步云端 · 刷新页面后再试';
    if (Market && Market.isListed && Market.isListed(pet.cloudId)) return '在集市出售中 · 先取回';
    if (window.Pet && window.Pet.isGodPet && window.Pet.isGodPet(pet)) return '神级宠不能当合成素材（只能涅槃）';
    if (ec) return '穿着 ' + ec + ' 件装备 · 先卸下装备';
    if (!(pet.level >= minLevel)) return '等级不足 · 需要 Lv.' + minLevel + '（当前 Lv.' + (pet.level || 1) + '，差 ' + (minLevel - (pet.level || 1)) + ' 级）';
    return null;
  }

  /* 缺副素材时的空态面板：列出"接近条件"的宠物 + 差什么 + 现在该去哪（升级 / 孵化跳转）。
   * 原来只有一行"没有可用的副素材（需要另一只 40 级…）"——玩家看完不知道该干嘛，是条死路。 */
  function nearSubsHtml(main, minLevel) {
    const rows = getPets()
      .filter(p => p.id !== main.id)
      .map(p => ({ pet: p, why: synthLockReason(p, minLevel) }))
      // 只挑玩家自己能马上解决的：差等级 / 差卸装备
      .filter(x => x.why && (/等级不足/.test(x.why) || /穿着/.test(x.why)))
      .sort((a, b) => (b.pet.level || 0) - (a.pet.level || 0))
      .slice(0, 4);
    const listHtml = rows.length
      ? '<div class="lg-records">' + rows.map(r => '<div class="lg-rec"><span class="t">Lv.' + (r.pet.level || 1) + '</span>'
        + '<span>' + escapeHtml(r.pet.name) + '</span><span class="d">' + escapeHtml(r.why) + '</span></div>').join('') + '</div>'
      : '<div class="lg-empty-hint">其它宠物离条件都还很远，先孵化 / 练新宠吧</div>';
    return '<div class="lg-box lg-center">'   /* lg-center：右列空态垂直居中（V2 §3） */
      + '<div class="lg-head">没有可用的副素材<span class="hint">这些差一点点</span></div>'
      + listHtml
      + '<div class="lg-warn lg-warn--calm">副素材条件：Lv.' + minLevel + ' 以上 · 没穿装备 · 不在出售 · 不是神级宠</div>'
      + '<div class="pn-actions">'
      +   '<button type="button" class="lg-cta lg-cta--ghost" id="synth-go-level">去挂机练级 →</button>'
      +   '<button type="button" class="lg-cta lg-cta--ghost" id="synth-go-egg">去孵蛋 →</button>'
      + '</div></div>';
  }
  function bindNearSubs(scope) {
    if (!scope || !scope.querySelector) return;
    const lv = scope.querySelector('#synth-go-level');
    if (lv) lv.onclick = () => {
      if (UI.switchPage) UI.switchPage('battle');
      if (UI.showToast) UI.showToast('去练级', '在战斗页选一张图开始挂机，出战的宠物会跟着长经验');
    };
    const egg = scope.querySelector('#synth-go-egg');
    if (egg) egg.onclick = () => {
      if (UI.openBagEggs) UI.openBagEggs();
      else if (UI.openBagWindow) UI.openBagWindow();
    };
  }

  /* ---------- 底部 CTA 栏（V3 §1/§6）----------
 * 🔴 死规矩：**按钮常驻，禁止整个消失**。不可用时置灰 + 原因文案（原因排在按钮左边同一栏内）。
 * 反例就是上一版：三个分支里都写着 `cb.innerHTML = ''`，玩家看到的是"这一页没有确认键"。 */
function synthCtaHtml(ok, why) {
  return (why ? '<div class="lg-cta-why is-bad">' + escapeHtml(why) + '</div>' : '')
    + '<button type="button" class="lg-cta lg-cta--danger" id="synth-ok"' + (ok ? '' : ' disabled') + '>确认合成</button>';
}
// 空态专用：直接写进 #synth-confirm（主宠/副素材还没选出来时）
function renderSynthCtaIdle(why) {
  const cb = $('synth-confirm');
  if (cb) cb.innerHTML = synthCtaHtml(false, why);
}
/* 「详细规则」折叠区（V3 §4：规则类内容一律不进正文，默认收起）。
 * 内容全部来自配置 / 判定字段，不在页面里写死数值。 */
function synthRulesHtml(main, sub, mutPct) {
  const bonus = (Config.synthesize && Config.synthesize.mutation && Config.synthesize.mutation.growthBonus) || [1, 3];
  return '<details class="lg-details"><summary>详细规则</summary><div class="lg-doc">'
    + '<div>· 新宠的形态 / 名字 / 基础值都跟<b>主素材</b>走，等级回到 <b>1</b>。</div>'
    + '<div>· <b>副素材不看成长</b>（只看终阶 + 等级）；成神时它成长越高，永久系数越高（最多 +20%）。</div>'
    + (mutPct ? '<div>· <b>' + mutPct + '%</b> 概率出「异变」宠：成长额外 +' + bonus[0] + '~' + bonus[1] + '，名字带「异变」。</div>' : '')
    + traitInheritLine(main, sub, 'synth')
    + '</div></details>';
}

function renderSynthTab() {
    const list = $('synth-pet-list');
    if (!list) return;
    const S = Config.synthesize || {};
    const minLevel = S.minLevel || 40;
    const pets = getPets();
    const mainPet = pets.find(p => p.id === synthMainId);
    if (!pets.length) {
      const empty = document.createElement('div');
      empty.className = 'hint pet-empty';
      empty.innerHTML =
        '<div class="pe-what">合成：两只 <b>Lv.' + minLevel + '</b> 以上的宠物合成一只更强的，' +
        '新宠成长 = 主宠成长 + 提升，<b>只涨不跌</b>。</div>' +
        '<div class="pe-need">' + ((UI.petTabGate && UI.petTabGate('synth')) || '还差：两只够等级的宠物') + '</div>' +
        '<div class="pe-do">现在：去挂机捡蛋、孵化，把宠物练到 Lv.' + minLevel + '</div>';
      list.appendChild(empty);
      renderSynthStage(null);
      return;
    }
    /* 统一列表卡：**全部宠物都列**，不合格的置灰 + 写明原因（前置校验，不是拦一道门）。
     * 能用的排前面。 */
    PetUI.renderList(list, pets, {
      selectedId: synthMainId,
      lockOf: p => synthLockReason(p, minLevel),
      onPick: (pet) => {
        synthMainId = pet.id;
        synthSubId = null;
        UI.renderAll();
      },
      emptyHtml: '还没有宠物：先去「背包 · 素材蛋」孵化一只'
    });
    renderSynthStage(mainPet);
  }

  // 步骤条：选主素材 → 选副素材 → 确认合成
  function syncSynthSteps(main, sub) {
    PetUI.stepsInto($('synth-steps'), [
      { label: '选主素材', state: main ? 'done' : 'cur' },
      { label: '选副素材', state: !main ? 'todo' : (sub ? 'done' : 'cur') },
      { label: '确认合成', state: (main && sub) ? 'cur' : 'todo' }
    ]);
  }

  // 合成 v2 面板化：主宠面板 ｜ 中央炼妖炉 ｜ 副宠面板+备选条 ｜ 结果预览条（成长/神级/变异/道具）+ 确认
  function renderSynthStage(main) {
    const mb = $('synth-main-box'), sb = $('synth-sub-box'), pb = $('synth-preview'), cb = $('synth-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const S = Config.synthesize || {};
    const arrow = $('synth-arrow');
    if (!main) {
      /* 空态图解：合成是这个游戏里"代价最大"的操作（两只宠都没了），第一次进来必须看懂流程。 */
      mb.innerHTML = '<div class="lg-box">'
        + '<div class="lg-head">合成 · 三步</div>'
        + '<div class="lg-flow">'
        +   '<div><div class="fh">选主素材</div><div class="fd">新宠的形态 / 名字 / 基础值都跟主素材走</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">选副素材</div><div class="fd">只看终阶 + 等级，不看成长（成长只影响成神后的系数）</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">确认合成</div><div class="fd">两只素材宠永久消失，换一只新宠（等级回 1）</div></div>'
        + '</div></div>';
      sb.innerHTML = ''; pb.innerHTML = '';
      /* V3 §1：这里原来写 `cb.innerHTML = ''`（按钮消失）—— 改成置灰 + 原因常驻 */
      renderSynthCtaIdle('先在左侧选一只主素材');
      if (arrow) arrow.innerHTML = '';
      syncSynthSteps(null, null);
      return;
    }
    const matName = S.material && S.material.name || '合成之石';
    const matAmt = S.material && S.material.amount || 1;
    const haveMat = Materials.getQuantity ? Materials.getQuantity(matName) : 0;
    const mutPct = Math.round((S.mutation && S.mutation.chance || 0) * 100);
    const mainStage = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(main) : 1;
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    const gbar = Math.max(4, Math.min(100, Math.round((main.growth || 0))));
    /* 副素材的等级门槛 = **合成**门槛（`synthesize.minLevel`，40），不是神级门槛（60）。
     * 🔴 2026-09-22 修：上一版这里写的是"终阶 + Lv.60"（沿用旧文案），
     *   而 core 的 `Merge.getMergeCandidates(mainId, cfg)` 只按 `cfg.minLevel` 筛
     *   ⇒ 界面一边把 Lv.40 的宠列成可选、一边在卡片上写它"不达标"，自相矛盾。
     *   现在按 core 的筛选顺序逐条列出（等级 / 云端 / 装备 / 在售）。 */
    const needLv = S.minLevel || 40;
    /* 主素材卡（V3 §1）：
     *   **删掉卡内那条红字警示条** —— "能不能选"已经在左侧名录上置灰 + 写明原因（前置校验），
     *   卡里再报一次只是重复噪音；"能不能出神级宠"由下方结果预览的「神级宠」格回答（带概率 + 差什么）。
     *   `pmeta` 里也不再重复"消耗 N 颗材料"——它就在卡底那条进度行上。 */
    mb.innerHTML = `<div class="pet-card2 main${mainIsGod ? ' god': ''}">
      <span class="lg-cap lg-cap--cur">主素材</span>
      <div class="pname">${main.name}${mainIsGod ? ' · 神级' : ''}</div>
      <div class="pmeta">Lv.${main.level} · ${mainStage}/${PetUI.stageTotal()} 阶</div>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
      <div class="stats">${statRows(main)}</div>
      <div class="lg-prog${haveMat >= matAmt ? ' is-ok' : ''}"><span class="k">${escapeHtml(matName)}</span>
        ${PetUI.barHtml(haveMat, matAmt, haveMat >= matAmt ? 'is-ok' : '')}<span class="v">${haveMat} / ${matAmt}</span></div>
    </div>`;
    /* 中列 = 炼妖炉（V3 §1）：**整列只放这一点内容并垂直居中**，而且这一列不再是"箱子"
     *   （V2 那版有 1px 边框 + 渐变底，被三列等高拉到 300px 后就是用户点名的"过高的空箱体"）。 */
    if (arrow) {
      arrow.innerHTML = '<div class="forge-core"><div class="cauldron">合</div>'
        + '<div class="cauldron-tip">炼妖炉</div>'
        + '<div class="lg-cauldron-warn">⚠ 两只素材宠都将消失</div></div>';
    }
    const subs = (Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id, S) : []).filter(s => !(window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(s) : !!s.isGodPet)); // 神宠禁当副宠
    if (!subs.length) {
      sb.innerHTML = nearSubsHtml(main, S.minLevel || 40);
      bindNearSubs(sb);
      pb.innerHTML = '';
      /* 同上：按钮常驻，只是置灰 —— 空态原因与右列那句同口径，短一行即可 */
      renderSynthCtaIdle('没有可用的副素材 · 需 Lv.' + (S.minLevel || 40) + ' 以上且没穿装备');
      syncSynthSteps(main, null);
      return;
    }
    // 默认选中第一只候选副宠（免去多余点击，仍可随时换）
    let sub = synthSubId ? getPets().find(p => p.id === synthSubId) : null;
    if (!sub) { synthSubId = subs[0].id; sub = subs[0]; }
    const sgbar = Math.max(4, Math.min(100, Math.round((sub.growth || 0))));
    /* 副素材条件：与涅槃页**同一套黑白 checklist**（V3 §3：正文里不许再出现红/绿小字），
     * 判据与 core 的 `Merge.getMergeCandidates` 逐条对齐（顺序也一致）。 */
    const subConds = PetUI.condListHtml([
      { ok: !!(sub.cloudId), text: '已同步云端' },
      { ok: (sub.level || 1) >= needLv, text: '等级 ≥ <b>Lv.' + needLv + '</b>（当前 Lv.' + sub.level + '）' },
      { ok: !Object.values(sub.equipment || {}).some(Boolean), text: '没穿装备' },
      { ok: !(Market && Market.isListed && Market.isListed(sub.cloudId)), text: '不在集市出售' }
    ]);
    sb.innerHTML = `<div class="pet-card2 sub-card">
      <span class="lg-cap lg-cap--cur">副素材 · 将消失</span>
      <div class="pname">${sub.name}</div>
      <div class="pmeta">副宠 · Lv.${sub.level}</div>
      <div class="avatar">${iconHtml(sub.name)}</div>
      <div class="growline"><b>${sub.growth.toFixed(1)}</b><span class="gbar"><i style="width:${sgbar}%"></i></span></div>
      <div class="stats">${statRows(sub)}</div>
      <div class="lg-head" style="margin-top:10px">副素材条件</div>
      ${subConds}
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
    // 合成道具：走自定义下拉（原生 select 在暗色面板里是系统灰，与整体割裂）
    const itemOpts = [{ value: '', label: '不使用道具' }].concat(synthItems.map(i => {
      const have = Materials.getQuantity ? Materials.getQuantity(i.name) : 0;
      return { value: i.id, label: i.name + '（' + (i.effect || '') + '）×' + have, disabled: have < 1 };
    }));
    const itemSelectHtml = PetUI.selectHtml('synth-item-select', itemOpts, synthItemId || '');
    // 神级宠判定（第二版手册 2.2：道具化）：门槛 + 概率由选中道具 godChance 决定
    const gi = Merge.godSynthInfo ? Merge.godSynthInfo(main, sub, synthItemId) : null;
    const stg = p => (window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(p) : ((p.evolveTimes || 0) + 1));
    /* 2026-09-20：副宠不再要求成长（只看终阶 + 等级达标）⇒ 未达标时必须**分别**说清是谁差，
     *   别再笼统写"两只终阶 + 成长≥60"——那句话会骗玩家去白刷副宠成长。 */
    const needLv = gi ? gi.levelRequire : 60, needG = gi ? gi.minGrowth : 60, needSt = gi ? gi.minStage : 5;
    const mOk = stg(main) >= needSt && (main.growth || 0) >= needG && (main.level || 1) >= needLv;
    const sOk = stg(sub) >= needSt && (sub.level || 1) >= needLv;
    const lackTxt = [(!mOk ? `主宠：终阶 + 成长≥${needG}` : ''), (!sOk ? '副宠：终阶' : '')]
      .filter(Boolean).join(' · ');
    const godCell = (gi && gi.god)
      ? `<div class="v">${Math.round(gi.chance * 100)}%<small>${gi.god.name}</small></div>`
      : `<div class="v">未达标<small>${lackTxt ? lackTxt + '（另需 Lv.' + needLv + '）' : '该血统没有对应神级形态'}</small></div>`;
    const growthCell = normalGrowth !== null
      ? `<div class="v">${normalGrowth.toFixed(1)}<small>主宠 ${main.growth.toFixed(1)} → ${normalGrowth.toFixed(1)}</small></div>`
      : `<div class="v">?<small>计算失败</small></div>`;
    const footWarns = [];
    if (!matOk) footWarns.push(`<span class="warn">材料不足：需要 ${matAmt} 颗（持有 ${haveMat}）</span>`);
    if (synthItemId && !itemOk) footWarns.push('<span class="warn">合成道具不足（持有 0）</span>');
    /* 结果预览（数值化）：点确认前必须看清"失去什么、换来什么"。
     * 名字不下断言 —— 变异时服务端加「·异变」后缀，神级是另一条血统；这里只说清"大概率是什么"。 */
    const godName = (gi && gi.god) ? gi.god.name : '';
    const strip = '<div class="lg-strip">'
      + '<div class="lg-strip-art">' + iconHtml(main.name) + '</div>'
      + '<div class="lg-strip-main">'
      +   '<div class="lg-strip-t">' + escapeHtml(main.name) + ' + ' + escapeHtml(sub.name) + ' <span class="lg-arrow">→</span> '
      +     (godName ? '可能出【' + escapeHtml(godName) + '】' : '新宠（与主素材同名）') + '</div>'
      +   '<div class="lg-strip-s">等级回到 1 · 成长 ' + (normalGrowth !== null ? normalGrowth.toFixed(1) : '?')
      +     (mutPct ? '（变异时 ' + (mutatedGrowth !== null ? mutatedGrowth.toFixed(1) : '?') + '）' : '') + '</div>'
      + '</div>'
      + '<div class="lg-strip-art">' + iconHtml(sub.name) + '</div>'
      + '</div>';
    /* V3 §4 文字减负：正文只留**一行消耗**（+ 不足提示），规则全部收进「详细规则」折叠区。
     *   红色警示**不在这里重复** —— 中列炼妖炉下面已经常显「两只素材宠都将消失」。 */
    pb.innerHTML = `${strip}
      <div class="preview-bar">
        <div class="pv"><div class="k">合成结果成长</div>${growthCell}</div>
        <div class="pv"><div class="k">神级宠</div>${godCell}</div>
        <div class="pv"><div class="k">变异</div><div class="v">${mutPct ? mutPct + '%' : '—'}<small>${mutPct ? '成长更高' : ''}</small></div></div>
        <div class="pv"><div class="k">合成道具</div><div class="v">${itemSelectHtml}</div></div>
      </div>
      <div class="preview-foot">消耗 <b>${escapeHtml(matName)} ×${matAmt}</b>（持有 ${haveMat}）${footWarns.length ? ' · ' + footWarns.join(' · ') : ''}</div>
      ${synthRulesHtml(main, sub, mutPct)}`;
    syncSynthSteps(main, sub);
    /* 底部 CTA 栏（V3 §1/§6）：**按钮永不移除** —— 不可用时置灰，原因排在按钮左边同一栏内。
     *   原来禁用时只渲染一行红字、按钮本体没有 ⇒ 玩家看到的是"这一页没有确认键"。 */
    const canSynth = matOk && itemOk;
    cb.innerHTML = (canSynth ? ''
      : '<div class="lg-cta-why is-bad">' + escapeHtml(matOk ? '合成道具不足（持有 0）' : `材料不足：${matName} ×${matAmt}（持有 ${haveMat}）`) + '</div>')
      + '<button type="button" class="lg-cta lg-cta--danger" id="synth-ok"' + (canSynth ? '' : ' disabled') + '>确认合成</button>';
    // 自定义下拉：点选项 → 记住道具并重渲染（神级概率/成长都跟着道具变）
    PetUI.bindSelect(pb, 'synth-item-select', v => {
      synthItemId = v || '';
      renderSynthPreview(main, matName, matAmt, haveMat, mutPct);
    });
    /* ⚠️ 合成要串 4~6 次服务器往返（扣材料/道具 → 查条件 → 存新宠 → 删两只素材宠），约 1~2 秒。
     * 这段时间必须给反馈，否则玩家以为没点着 → 反复点（重复扣材料，这个坑踩过）。 */
    const synthBtn = cb.querySelector('#synth-ok');
    const doSynth = async () => {
      const res = await UI.runWithLoading(synthBtn, '合成中…', () => Merge.synthesize(main.id, sub.id, synthItemId)) || { error: '请稍候再试' };
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
      // 揭幕演出：普通合成 / 变异 / 神级，三档各一副面孔（神级最亮、变异走幽蓝）
      if (UI.celebrate) UI.celebrate({
        title: res.isGod ? '神级降世' : (res.mutated ? '变异诞生' : '合成成功'),
        name: res.baby.name,
        sub: '成长值 ' + res.newGrowth.toFixed(1),
        kind: res.isGod ? 'god' : (res.mutated ? 'mutant' : '')
      });
      // 全服通告（2026-09-14）：神级宠 / 变异宠合成成功 → 广播给所有在线玩家（消息里带宠物形象）
      if ((res.isGod || res.mutated) && UI.broadcastAnnounce) {
        const dn = (window.Supabase && window.Supabase.getMyDisplayName) ? (window.Supabase.getMyDisplayName() || '') : '';
        UI.broadcastAnnounce({
          id: 'pet' + Date.now() + Math.random().toString(36).slice(2, 7),
          kind: res.isGod ? 'god' : 'mutant',
          petName: res.baby.name,
          growth: res.newGrowth,
          owner: dn
        });
      }
      // 本机记录（只记在本地，不进云端）：合成把两只宠吃掉了，事后回看"我合过什么"
      if (PetUI.pushRecord && res.baby) {
        PetUI.pushRecord(res.baby.cloudId || ('local-' + res.baby.id),
          '合成 ' + main.name + ' + ' + sub.name + ' → ' + res.baby.name, '成长 ' + res.newGrowth.toFixed(1));
      }
      synthMainId = res.baby && res.baby.id ? res.baby.id : null;
      synthSubId = null;
      UI.renderAll();
    };
    /* 二次确认：合成是**全游戏最重的不可逆操作**（两只宠永久消失）——
     * 常驻红色警示条已经写在预览里，这里再让玩家确认一次"我失去什么、换来什么"。 */
    synthBtn.onclick = () => {
      if (!matOk || !itemOk) { showToast('无法合成', synthItemId ? '材料或道具不足' : '材料不足'); return; }
      PetUI.confirmIrreversible({
        title: '⚗ 确认合成',
        okLabel: '确认合成',
        fallbackText: '确认合成？两只素材宠会永久消失（不可撤销）。',
        bodyHtml: '<div class="salvage-detail">'
          + '<div>将失去：<b>' + escapeHtml(main.name) + '</b>（Lv.' + main.level + ' · 成长 ' + main.growth.toFixed(1) + '）</div>'
          + '<div>将失去：<b>' + escapeHtml(sub.name) + '</b>（Lv.' + sub.level + ' · 成长 ' + sub.growth.toFixed(1) + '）</div>'
          + '<div>将获得：一只新宠（<b>等级回到 1</b>）· 成长 <b>' + (normalGrowth !== null ? normalGrowth.toFixed(1) : '?') + '</b>'
          + (godName ? ' · 有 ' + Math.round(gi.chance * 100) + '% 概率出【' + escapeHtml(godName) + '】' : '') + '</div>'
          + '<div>消耗：<b>' + escapeHtml(matName) + ' ×' + matAmt + '</b>' + (curItem ? ' + ' + escapeHtml(curItem.name) + ' ×1' : '') + '</div>'
          + (mutPct ? '<div>变异：' + mutPct + '% 概率出「异变」宠（成长更高）</div>' : '')
          + '<div class="salvage-warn">两只素材宠与材料都不会返还，此操作不可撤销。</div>'
          + '</div>',
        onOk: doSynth
      });
    };
  }



  /* ---------- 对外 API ---------- */
  UI.renderSynthTab = renderSynthTab;
})();
