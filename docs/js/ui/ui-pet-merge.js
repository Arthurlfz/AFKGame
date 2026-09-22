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

  /* ---------- 条件清单（2026-09-22：把三大段规则文案拆成逐项 ✓/✗）----------
   * 🔴 主宠与副宠的条件**故意不同**（主宠涅槃后保留、装备跟着留着完全没问题；
   *    副宠会消失，穿着装备会连带出事 ⇒ 副宠必须脱）。
   *    所以这里分两组列，别再合成一句"未穿装备"套在主宠头上（那会把穿满装备的神宠判成不合格）。 */
  function condsHtml(rows) {
    return '<div class="lg-check">' + rows.map(r =>
      '<div' + (r.ok ? ' class="ok"' : '') + '>' + r.text + '</div>').join('') + '</div>';
  }
  function mainConds(main, M) {
    const minLv = M.minLevel || 60;
    const listed = !!(main.cloudId && Market && Market.isListed && Market.isListed(main.cloudId));
    /* V3 §4 文字减负：条件行压到"一眼扫得完"。完整解释在标题的 ? 里，不必在每一行展开。
     * （"主宠可穿装备"那条最容易踩坑 —— 玩家会以为要脱，所以保留，但只留 6 个字。） */
    return [
      { ok: PetUI.isGodOf(main), text: '神级宠' },
      { ok: (main.level || 1) >= minLv, text: 'Lv.' + minLv + ' 以上（当前 Lv.' + (main.level || 1) + '）' },
      { ok: !listed, text: '不在集市出售' },
      // 主宠装备不用脱：涅槃后宠还在、装备也还在（副宠才必须脱）
      { ok: true, text: '可穿装备（涅槃后仍在）' }
    ];
  }
  function subConds(sub, M) {
    const minLv = M.minLevel || 60;
    const ec = Object.values((sub && sub.equipment) || {}).filter(Boolean).length;
    const listed = !!(sub && sub.cloudId && Market && Market.isListed && Market.isListed(sub.cloudId));
    return [
      { ok: !!(sub && sub.cloudId), text: '已同步云端' },
      { ok: !!(sub && (sub.level || 0) >= minLv), text: 'Lv.' + minLv + ' 以上' + (sub ? '（当前 Lv.' + (sub.level || 1) + '）' : '') },
      { ok: !ec, text: '没穿装备（它会消失）' + (ec ? '（穿着 ' + ec + ' 件）' : '') },
      { ok: !listed, text: '不在集市出售' }
    ];
  }
  // 步骤条：选主宠 → 选副宠 → 确认涅槃
  function syncMergeSteps(main, sub) {
    PetUI.stepsInto($('merge-steps'), [
      { label: '选主宠', state: main ? 'done' : 'cur' },
      { label: '选副宠', state: !main ? 'todo' : (sub ? 'done' : 'cur') },
      { label: '确认涅槃', state: (main && sub) ? 'cur' : 'todo' }
    ]);
  }
  // 标题右侧的 ? 帮助（规则背景说明；条件本身走上面的 ✓/✗ 清单常驻显示）
  function syncMergeHelp(M) {
    const el = $('merge-help');
    if (!el || !el.setAttribute) return;
    const pct = Math.round((M.absorbRatio || 0.5) * 100);
    el.setAttribute('data-tip',
      '涅槃是什么：把一只副宠喂给主宠，主宠吸走它 ' + pct + '% 的成长值，然后等级重置回 Lv.1。'
      + '成长是跟一辈子的（等级是临时的）；主宠成长越高，每次新吸收越少（分段阻尼）。'
      + '神级宠 = 主宠终阶 + 成长 ≥ ' + godMinG() + '，在「合成」里搏出来（概率看合成道具，至尊神石必出）。');
  }

  /* ---------- 底部 CTA 栏（V3 §2-红框4：与另外三页同位置、同规格）----------
   * 按钮常驻：可点 = 警示红描边 + 呼吸光；不可点 = 置灰 + 原因排在按钮左边。
   * ⚠️ 按钮文案**不再重复**"等级重置为 Lv.1" —— 同一信息全页最多两处（统计格 + 警示条）。 */
  function mergeCtaHtml(canMerge, why) {
    return (why ? '<div class="lg-cta-why is-bad">' + escapeHtml(why) + '</div>' : '')
      + '<button type="button" class="lg-cta lg-cta--danger" id="merge-ok"' + (canMerge ? '' : ' disabled') + '>确认涅槃</button>';
  }
  function renderMergeCtaIdle(why) {
    const cb = $('merge-confirm');
    if (cb) cb.innerHTML = mergeCtaHtml(false, why);
  }
  // 「详细规则」折叠区（V3 §4：规则一律不进正文）
  function mergeRulesHtml(main, sub) {
    return '<details class="lg-details"><summary>详细规则</summary><div class="lg-doc">'
      + '<div>· 主宠吸走副宠 <b>' + Math.round(((Config.nirvana || {}).absorbRatio || 0.5) * 100) + '%</b> 的成长，'
      + '主宠成长越高，每次新吸收越少（<b>分段阻尼</b>）。</div>'
      + '<div>· 副宠会<b>永久消失</b>，穿着的装备会一起没 —— 所以副宠必须脱光。</div>'
      + traitInheritLine(main, sub, 'nirvana')
      + '</div></details>';
  }

  function renderMergeTab() {
    const list = $('merge-pet-list');
    if (!list) return;
    const M = Config.nirvana || Config.merge || {};
    const mainPet = getPets().find(p => p.id === mergeMainId);
    /* 主宠候选：等级够 + 已存档 + 不在售。
     * 🔴 2026-09-17 修（用户实测「神宠无法涅槃，都不能选择」）：
     *   这里以前套用了 `Merge.canMerge(p)` —— 那是【副宠】的门槛，含"未穿装备"这一条。
     *   副宠涅槃后会【消失】，穿着装备会连带出事，所以它必须脱；
     *   而主宠涅槃后是【保留】的（只重置等级），装备跟着留着完全没问题。
     *   误用的后果：穿着一套装备的神宠在主宠列表里**直接不出现**，
     *   玩家看到的是"我的神宠根本选不了"（实测：血月神狐 Lv60 神级、穿满 12 件 → 列表空）。
     *   服务端 `pet_merge.js` 的 nirvana 对主宠也只校验等级、不校验装备 —— UI 现已与服务端同口径。 */
    const minLv = M.minLevel || 60;
    /* 统一列表卡：列**全部宠物**，不合格的置灰 + 写明原因（差几级 / 不是神级 / 在售）。
     * 门槛判定一律调 core（Merge.canNirvanaMain），UI 不再自己拼条件 —— 避免再被误改成副宠那套。 */
    PetUI.renderList(list, getPets(), {
      selectedId: mergeMainId,
      lockOf: (p) => {
        if (!p.cloudId) return '未同步云端 · 刷新页面后再试';
        if (Market && Market.isListed && Market.isListed(p.cloudId)) return '在集市出售中 · 先取回';
        if (!PetUI.isGodOf(p)) return '普通宠不能涅槃 · 先在合成里搏一只神级宠';
        if (!Merge.canNirvanaMain(p)) return '神级宠还需练到 Lv.' + minLv + '（当前 Lv.' + (p.level || 1) + '）';
        return null;
      },
      onPick: (pet) => {
        mergeMainId = pet.id;
        mergeSubId = null; // 换主宠重置副宠
        useLock = false; lockTraitId = null;
        UI.renderAll();
      },
      extraOf: (p) => (PetUI.isGodOf(p) ? '<span class="lg-on">神级 · 可涅槃</span>' : ''),
      emptyHtml: '还没有宠物：先去「背包 · 素材蛋」孵化一只；神级宠要在「合成」里搏出来'
    });
    renderMergeStage(mainPet);
  }

  /* 成神【成长】门槛的唯一取值口（2026-09-20）：读**判定字段** `synthesize.god.minGrowth`。
   * ⚠️ 别再读 `pet.godPets.minGrowth` —— 那个只喂 UI 文案、调了不生效
   *    （"同一件事两份数据"的老坑，两值恰好都是 60 所以一直没人发现）。 */
  function godMinG() {
    const G = Config.synthesize && Config.synthesize.god;
    return (G && G.minGrowth != null) ? G.minGrowth : 60;
  }

  // 涅槃 v2 面板化：神级主宠 ｜ 业火炉 ｜ 副宠（将被吸收）+备选条 ｜ 结果预览条 + 确认
  function renderMergeStage(main) {
    const mb = $('merge-main-box'), sb = $('merge-sub-box'), pb = $('merge-preview'), cb = $('merge-confirm');
    if (!mb || !sb || !pb || !cb) return;
    const M = Config.nirvana || Config.merge || {};
    const arrow = $('merge-arrow');
    if (!main) {
      /* 空态（未选主宠）：左边画流程、右边列门槛 —— 把原来三大段正文拆开，玩家不用读完整段才知道要干嘛。 */
      const pill2 = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
      const minLv0 = M.minLevel || 60;
      mb.innerHTML = '<div class="lg-box">'
        + '<div class="lg-head">涅槃 · 三步</div>'
        + '<div class="lg-flow">'
        +   '<div><div class="fh">选主宠</div><div class="fd">神级宠 · Lv.' + minLv0 + ' 以上' + (pill2 ? ' · 可加 ' + escapeHtml(pill2.name) : '') + '</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">选副宠</div><div class="fd">副宠会被吸收、永久消失（必须脱光装备）</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">成长上涨</div><div class="fd">核心代价：主宠<b>等级重置回 Lv.1</b>，成长永久上涨</div></div>'
        + '</div>'
        + '<div class="lg-warn">⚠️ 涅槃<b>不可撤销</b>：等级会从当前等级掉回 1 级，副宠永久消失</div>'
        + '</div>';
      /* V3 §4：这块原来是一整段"要满足什么"正文 —— 规则搬进「详细规则」折叠区，
       *   正文只留一行"还差什么"（gate 文案来自 UI.petTabGate，不在页面里抄条件）。 */
      sb.innerHTML = '<div class="lg-box lg-center">'
        + '<div class="lg-head">要满足什么</div>'
        + '<div class="lg-warn lg-warn--calm">' + escapeHtml((UI.petTabGate && UI.petTabGate('merge')) || ('还差：一只 Lv.' + minLv0 + ' 以上的神级宠')) + '</div>'
        + '<details class="lg-details"><summary>详细规则</summary><div class="lg-doc">'
        +   '<div>· <b>主宠</b>：神级宠 · Lv.' + minLv0 + ' 以上 · 不在出售（可穿装备）</div>'
        +   '<div>· <b>副宠</b>：Lv.' + minLv0 + ' 以上 · 没穿装备 · 不在出售（它会消失，越强吸得越多）</div>'
        +   '<div>· <b>可加料</b>：' + (pill2 ? escapeHtml(pill2.name) + ' ×1（吸收 ×' + (pill2.boostMult || 1.2) + '）' : '无') + '</div>'
        +   '<div>· 神级宠怎么来：主宠终阶 + 成长 ≥ ' + godMinG() + '（副宠只要终阶，不看成长）在「合成」里搏出，概率看合成道具。</div>'
        + '</div></details>'
        + '</div>';
      pb.innerHTML = '';
      renderMergeCtaIdle('先在左侧选一只主宠');   // V3：按钮常驻（置灰 + 原因），不许整个消失
      if (arrow) arrow.innerHTML = '';
      syncMergeSteps(null, null);
      syncMergeHelp(M);
      return;
    }
    syncMergeHelp(M);
    // 主宠不是神级宠：整体置灰并给出去向提示
    const mainIsGod = window.Pet && window.Pet.isGodPet ? window.Pet.isGodPet(main) : !!main.isGodPet;
    const pillDef = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const matName = pillDef ? pillDef.name : '涅槃丹';
    const matAmt = 1;
    const haveMat = pillDef && Materials.getQuantity ? Materials.getQuantity(pillDef.name) : 0;
    const gbar = Math.max(4, Math.min(100, Math.round((main.growth || 0))));
    if (!mainIsGod) {
      const minG = godMinG();
      mb.innerHTML = `<div class="pet-card2">
        <span class="lg-cap lg-cap--cur">主宠 · 当前</span>
        <div class="pname">${main.name}</div>
        <div class="pmeta">Lv.${main.level} · 普通宠 · 不可涅槃</div>
        <div class="avatar">${iconHtml(main.name)}</div>
        <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
        <div class="stats">${statRows(main)}</div>
        <div class="lg-head" style="margin-top:10px">为什么不能涅槃</div>
        ${condsHtml(mainConds(main, M))}
      </div>`;
      syncMergeSteps(main, null);
      if (arrow) arrow.innerHTML = '';
      sb.innerHTML = '<div class="warn"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.929 4.929 19.07 19.071"/></svg> 只有<b>神级宠</b>才能涅槃——' + main.name + ' 是普通宠。先把<b>主宠</b>养成终阶 + 成长 ≥ ' + minG + '，再配一只终阶副宠（<b>副宠不看成长</b>）拿去<b>合成</b>，概率看合成道具（至尊神石必出）。</div>';
      pb.innerHTML = '';
      renderMergeCtaIdle('这只不是神级宠 · 先在「合成」里搏一只');
      return;
    }
    // 神级主宠（条件逐项 ✓/✗ 常驻显示 —— 规则不再靠玩家读一大段文字）
    mb.innerHTML = `<div class="pet-card2 god">
      <span class="lg-cap lg-cap--cur">主宠 · 神级</span>
      <div class="pname">${main.name} · 神级</div>
      <div class="pmeta">Lv.${main.level} · 可涅槃 · 可选消耗 ${matName} ×1（持有 ${haveMat}）</div>
      <div class="avatar">${iconHtml(main.name)}</div>
      <div class="growline"><b>${main.growth.toFixed(1)}</b><span class="gbar"><i style="width:${gbar}%"></i></span></div>
      <div class="stats">${statRows(main)}</div>
      <div class="lg-head" style="margin-top:10px">主宠条件</div>
      ${condsHtml(mainConds(main, M))}
    </div>`;
    if (arrow) arrow.innerHTML = '<div class="forge-core"><div class="cauldron fire">焰</div><div class="cauldron-tip">业火炉<br>副宠将被吸收</div></div>';
    /* 副宠候选：必须把涅槃门槛（M.minLevel=60）传进去。
     * 🔴 2026-09-17 修：以前这里不传 cfg，getMergeCandidates 退回默认 40 级 ⇒
     *   Lv40~59 的宠会被列成"可当副宠"，玩家点了才被服务端拒（"两只宠物都必须达到 60 级"），
     *   而界面上写的却是"需要另一只 60 级"。合成页一直是传了配置的（ui-pet-synth.js），
     *   只有涅槃页漏了 —— 现在两边口径一致。 */
    const subs = Merge.getMergeCandidates ? Merge.getMergeCandidates(main.id, M) : [];
    if (!subs.length) {
      /* V3 §2-红框3：空态**垂直居中**（.lg-center 用 flex:1 撑满整列），
       * 规则收进折叠区，正文只留一句"现在该干嘛"。 */
      sb.innerHTML = '<div class="lg-box lg-center"><div class="lg-head">没有可用的副宠</div>'
        + '<div class="lg-warn lg-warn--calm">去挂机练级，或先把宠物身上的装备卸下来</div>'
        + '<details class="lg-details"><summary>副宠条件</summary><div class="lg-doc">'
        + '<div>· Lv.' + (M.minLevel || 60) + ' 以上 · <b>没穿装备</b> · 不在出售</div>'
        + '<div>· 它会永久消失，所以穿着装备的不能上（否则装备一起没）</div>'
        + '</div></details></div>';
      pb.innerHTML = '';
      renderMergeCtaIdle('没有可用的副宠 · 需 Lv.' + (M.minLevel || 60) + ' 以上且没穿装备');
      syncMergeSteps(main, null);
      return;
    }
    let sub = mergeSubId ? getPets().find(p => p.id === mergeSubId) : null;
    if (!sub) { mergeSubId = subs[0].id; sub = subs[0]; }
    const s2 = getStats(sub);
    const sgbar = Math.max(4, Math.min(100, Math.round((sub.growth || 0))));
    const sstg = window.Pet && window.Pet.getEvolveStage ? window.Pet.getEvolveStage(sub) : 1;
    /* 神级副宠要【显式标出来】（2026-09-17 用户拍板：「之后肯定是神宠互相吃」）：
     * 神级宠当副宠是正经玩法（把练起来的神宠喂给主宠换成长），所以：
     *   ① 候选里【不许】过滤掉神级宠（合成页反过来 —— 那里神宠不能当素材，见 ui-pet-synth.js）；
     *   ② 但它一旦被选中就【必须一眼看出是神级】—— 主宠卡片本来就标了"神级"，副宠卡片以前不标，
     *      玩家会把一只神宠当普通肥料点掉。这里补上对称的标记。 */
    const isGodOf = p => (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(p) : !!(p && p.isGodPet);
    const subIsGod = isGodOf(sub);
    sb.innerHTML = `<div class="pet-card2 sub-card${subIsGod ? ' god' : ''}">
      <span class="lg-cap lg-cap--cur">副宠 · 将被吸收</span>
      <div class="pname">${sub.name}${subIsGod ? ' · 神级' : ''}</div>
      <div class="pmeta">Lv.${sub.level} · ${sstg}/${PetUI.stageTotal()} 阶</div>
      <div class="avatar">${iconHtml(sub.name)}</div>
      <div class="growline"><b>${sub.growth.toFixed(1)}</b><span class="gbar"><i style="width:${sgbar}%"></i></span></div>
      <div class="stats">${statRows(sub)}</div>
      <div class="lg-head" style="margin-top:10px">副宠条件</div>
      ${condsHtml(subConds(sub, M))}
    </div>
    <div class="sub-options">${subs.map(s => {
      const sel = s.id === mergeSubId ? ' on': '';
      return `<div class="sub-opt${sel}" data-sub="${s.id}"><span class="ic">${iconHtml(s.name)}</span><span>${s.name}${isGodOf(s) ? ' · 神级' : ''}<small>Lv.${s.level} · 成长 ${s.growth.toFixed(1)}</small></span></div>`;
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
    /* 成长曲线预估（2026-09-22）：一次涅槃只看到"这一下涨多少"，玩家没法判断值不值。
     * 用同一只副宠再走一次算"下一次"—— 阻尼会让涨幅明显变小，这正好把规则讲明白了（数据是真的，不是示意图）。 */
    const nextIter = (window.Merge && window.Merge.calcNirvanaGrowth && sub)
      ? window.Merge.calcNirvanaGrowth(Object.assign({}, main, { growth: finalGrowth }), sub, bonusMult) : null;
    const curveCell = (k, v, d) => '<div><div class="fh">' + escapeHtml(k) + '</div><div class="fi lg-num" style="color:var(--lg-gold)">' + escapeHtml(v) + '</div><div class="fd">' + escapeHtml(d) + '</div></div>';
    const curveBox = '<div class="lg-box" style="margin-top:8px"><div class="lg-head">成长曲线预估<span class="hint">用同一只副宠再来一次</span></div>'
      + '<div class="lg-flow">'
      +   curveCell('现在', main.growth.toFixed(1), 'Lv.' + main.level)
      +   '<span class="lg-arrow">→</span>'
      +   curveCell('这次涅槃后', finalGrowth.toFixed(1), '等级回 Lv.1 · 吸收 +' + absorb.toFixed(1))
      +   '<span class="lg-arrow">→</span>'
      +   curveCell('再来一次', nextIter ? nextIter.growth.toFixed(1) : '—', nextIter ? '吸收仅 +' + Number(nextIter.absorb || 0).toFixed(1) + '（阻尼）' : '数据不足')
      + '</div></div>';
    /* V3 §4 文字减负：这一块原来是一大段正文（"XX（成长13.6）将消失 · 消耗涅槃丹×1（持有40）·
     *   涅槃后等级重置回1级，属性按1级×新成长重算"）—— 现在只留**一行警示条**，
     *   「等级重置 Lv.1」全页只出现两处（统计格的「等级」+ 这条），完整说明进二次确认弹窗。
     *   ⚠️ 副宠名与「★ 神级」必须保留：要喂掉的是一只神宠时必须一眼看得出（守值钉着这条）。 */
    const subGod = (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(sub) : !!sub.isGodPet;
    const footLine = '⚠ <b>' + escapeHtml(sub.name) + '</b>' + (subGod ? ' ★ 神级' : '') + ' 将消失'
      + (M.resetLevel ? ' · 等级重置 Lv.1' : '');
    pb.innerHTML = `
      <div class="preview-bar">
        <div class="pv"><div class="k">吸收成长</div><div class="v">+${absorb.toFixed(1)}<small>副宠 ${sub.growth.toFixed(1)} × ${Math.round((M.absorbRatio || 0.5) * 100)}%${bonusMult > 1 ? ' ×' + bonusMult : ''}${(calcBoost && calcBoost.damped) ? ' · 阻尼' : ''}</small></div></div>
        <div class="pv"><div class="k">涅槃后成长</div><div class="v">${finalGrowth.toFixed(1)}<small>主宠 ${main.growth.toFixed(1)} → ${finalGrowth.toFixed(1)}</small></div></div>
        <div class="pv pv-danger"><div class="k">等级</div><div class="v">Lv.${main.level} → ${M.resetLevel ? 'Lv.1' : '不变'}</div></div>
        <div class="pv"><div class="k">涅槃丹</div><div class="v"><label><input type="checkbox" id="nir-pill-check" ${useNirvanaPill ? 'checked' : ''} ${pillOk ? '' : 'disabled'}> ×${pillMult}<small>持有 ${pillHave}</small></label></div></div>
        <div class="pv"><div class="k">锁魂玉</div><div class="v"><label><input type="checkbox" id="nir-lock-check" ${useLock ? 'checked' : ''} ${lockHave >= 1 && subTraitList.length ? '' : 'disabled'}> 定向植入<small>持有 ${lockHave}</small></label>${useLock ? `<select id="nir-lock-trait">${lockOpts}</select>` : ''}</div></div>
      </div>
      <div class="lg-warn">${footLine}</div>
      ${curveBox}
      <table class="cmp-table"><tr><th>属性</th><th>当前</th><th>涅槃后</th></tr>
        ${row('生命', cur.hp, next.hp)}${row('攻击', cur.atk, next.atk)}${row('防御', cur.def, next.def)}${row('速度', cur.spd, next.spd)}
      </table>
      ${mergeRulesHtml(main, sub)}`;
    /* 确认按钮：**红色危险态 + 二次确认**（V3 §2-红框4：按钮常驻在底部 CTA 栏，原因排在它左边）。
     * 按钮文案不再写"等级重置为 Lv.1" —— 那句同一页已经有了两处（统计格 + 警示条）。 */
    const ctaWhy = [
      (useNirvanaPill && !pillOk) ? matName + '不足（持有 ' + pillHave + '）' : '',
      (useLock && (lockHave < 1 || !lockTraitId)) ? '锁魂玉不足（持有 ' + lockHave + '）' : ''
    ].filter(Boolean).join(' · ');
    cb.innerHTML = mergeCtaHtml(canMerge, ctaWhy);
    const pillCheck = document.getElementById('nir-pill-check');
    if (pillCheck) {
      pillCheck.onchange = () => { useNirvanaPill = pillCheck.checked; renderMergePreview(main, matName, matAmt, haveMat); };
    }
    const lockCheck = document.getElementById('nir-lock-check');
    if (lockCheck) {
      lockCheck.onchange = () => { useLock = lockCheck.checked; renderMergePreview(main, matName, matAmt, haveMat); };
      const lockSel = document.getElementById('nir-lock-trait');
      if (lockSel) lockSel.onchange = () => { lockTraitId = lockSel.value; };
    }
    /* ⚠️ 涅槃要串 3~5 次服务器往返（查条件 → 逐项扣材料 → 改主宠 → 删副宠），实测 1~2 秒。
     * 以前这段时间按钮不置灰也不改字 = 玩家以为没点着，会反复点（重复扣材料）。
     * 统一走 UI.runWithLoading（打造/购买用的同一套）：点下立刻换文案 + 禁用，结束恢复。 */
    const nirBtn = cb.querySelector('#merge-ok');
    const doNirvana = async () => {
      const res = await UI.runWithLoading(nirBtn, '涅槃中…', () => Merge.nirvana(main.id, sub.id, useCrystal, useNirvanaPill, useLock ? lockTraitId : null)) || { error: '请稍候再试' };
      if (res.error) { showToast('涅槃失败', res.error); return; }
      addLog(`涅槃成功！${res.main.name} 成长 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}，等级重置为 Lv.${res.main.level}，转生 ${res.main.rebornCount} 次；本轮培育次数已重置（0/10）`);
      showToast('涅槃成功！', `${res.main.name} 成长值 ${res.oldGrowth.toFixed(1)} → ${res.newGrowth.toFixed(1)}`);
      // 本机记录：涅槃是全游戏最重的操作，留一条"我什么时候把哪只喂了"
      if (PetUI.pushRecord) {
        PetUI.pushRecord(main.cloudId || ('local-' + main.id),
          '涅槃 · 吃掉 ' + sub.name + '（Lv.' + sub.level + '）' + (res.main.rebornCount ? ' · 第 ' + res.main.rebornCount + ' 次' : ''),
          '成长 +' + (res.newGrowth - res.oldGrowth).toFixed(1));
      }
      // 揭幕演出：涅槃是全流程最重的一次投入（要养副宠），必须要有"成了"的那一下
      if (UI.celebrate) UI.celebrate({ title: '涅槃', name: res.main.name, sub: '成长 ' + res.oldGrowth.toFixed(1) + ' → ' + res.newGrowth.toFixed(1) + '　等级重置为 Lv.' + res.main.level });
      mergeMainId = res.main ? res.main.id : null;
      mergeSubId = null;
      useLock = false; lockTraitId = null;
      UI.renderAll();
    };
    nirBtn.onclick = () => {
      if (!canMerge) { showToast('无法涅槃', '道具或材料不足'); return; }
      // 副宠是不是神级（要喂掉的是一只神宠时必须一眼看得出；这里自己算，不依赖上层作用域）
      const subGod = (window.Pet && window.Pet.isGodPet) ? window.Pet.isGodPet(sub) : !!sub.isGodPet;
      /* 二次确认弹窗：把"将失去什么"逐条列出来（等级 60 → 1 是最容易被忽略的代价）。 */
      PetUI.confirmIrreversible({
        title: '🔥 确认涅槃 · 不可撤销',
        okLabel: '确认涅槃',
        fallbackText: '确认涅槃？主宠等级将重置为 Lv.1，副宠永久消失，不可撤销。',
        bodyHtml: '<div class="salvage-detail">'
          + '<div>主宠：<b>' + escapeHtml(main.name) + '</b></div>'
          + '<div class="salvage-warn">将失去：<b>等级 Lv.' + main.level + ' → Lv.1</b>（经验清零，要从头练）</div>'
          + '<div>将失去：副宠 <b>' + escapeHtml(sub.name) + '</b>（Lv.' + sub.level + ' · 成长 ' + sub.growth.toFixed(1) + '）' + (subGod ? ' <b>★ 神级</b>' : '') + '，永久消失</div>'
          + (useNirvanaPill ? '<div>将消耗：<b>' + escapeHtml(matName) + ' ×1</b>（吸收 ×' + pillMult + '）</div>' : '')
          + (useLock ? '<div>将消耗：<b>' + escapeHtml(lockItem ? lockItem.name : '锁魂玉') + ' ×1</b>（定向植入 ' + escapeHtml(lockTraitId || '') + '）</div>' : '')
          + '<div>将获得：主宠成长 <b>' + main.growth.toFixed(1) + ' → ' + finalGrowth.toFixed(1) + '</b>（永久，且转生次数 +1）</div>'
          + '<div class="salvage-warn">以上操作不可撤销，材料与副宠都不会返还。</div>'
          + '</div>',
        onOk: doNirvana
      });
    };
  }

  function renderMergeHint() {
    const el = $('merge-hint-text');
    const M = Config.nirvana || Config.merge || {};
    const minG = godMinG();
    const hintPill = Config.itemOf ? Config.itemOf(M.defaultItem || 'nir_pill') : null;
    const hintPillName = hintPill ? hintPill.name : '涅槃丹';
    if (el && M.minLevel) el.innerHTML = `涅槃：<b>只有神级宠</b>能涅槃。主宠吸副宠 <b>${Math.round((M.absorbRatio || 0.5) * 100)}%</b> 成长 + 重置等级；成长无上限，但主宠成长越高，每次新吸收越少（<b>分段阻尼</b>）。条件：神级宠 Lv.<b>${M.minLevel}</b>；可选消耗 <b>${hintPillName} ×1</b>（吸收 ×${hintPill && hintPill.boostMult ? hintPill.boostMult : 1.2}）。神级宠 = 主宠终阶 + 成长 ≥ ${minG}（副宠只要终阶，不看成长）合成，概率看合成道具。`;
  }



  /* ---------- 对外 API ---------- */
  UI.renderMergeTab = renderMergeTab;
  UI.renderMergeHint = renderMergeHint;
})();
