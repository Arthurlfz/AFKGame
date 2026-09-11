/* ============================================================
 * ui/ui-craft.js —— 打造页 UI（重铸石 / 剥离石 / 神圣石 / 增缀石）
 * 职责：装备打造面板（重铸 / 剥离 / 重 Roll / 增缀）
 * 依赖：craft / market / equipment（只读查询与流程接口）；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $, showToast, addLog, runWithLoading } = UI;

  const Config = window.Config;
  const Craft = window.Craft;
  const Market = window.Market;
  const Materials = window.Materials;
  const { flattenAffixes, rarityOf } = window.Equipment;

  /* ---------- 装备打造面板（重铸石 / 剥离石 / 神圣石 / 增缀石） ---------- */
  let activeCraftEq = null;
  // 魂铸独立 tab（2026-09-10）：false=打造 / true=魂铸。两者不再混在同一屏
  let soulTabActive = false;

  /* ---------- 装备打造面板（重铸石 / 剥离石 / 神圣石 / 增缀石 / 锁定词缀） ----------
   * 2026-09-04 主从式：打造内容渲染进「背包页右侧面板」的打造容器（renderCraftInto(el, eq)），
   * openCraftPanel 改为重定向到 UI.renderEqDetail；旧抽屉 craft-modal 不再打开。
   * 锁定改为 POE 锁前/锁后（2026-09-04 拍板）：只锁一边（eq.lockPrefix / eq.lockSuffix），
   * 锁定侧在重铸/神圣中整组保留、剥离/增缀不触及；重铸/神圣时按锁定侧条数扣锁定石。
   */
  function renderCraftInto(el, eq) {
    // 魂铸选择状态跟着装备走：换一件装备就清空重选。
    // 残留的 petId/traitId 指向的宠可能已不在当前档位候选里 → selPet 为空 → 确认按钮一直灰着。
    if (!activeCraftEq || activeCraftEq.id !== eq.id) { soulState.petId = null; soulState.traitId = null; }
    activeCraftEq = eq;
    const C = Config.craft;
    const inSell = Market.isItemListed(eq.cloudId);
    const pfx = eq.affixes.prefix || [];
    const sfx = eq.affixes.suffix || [];
    const lockPrefix = !!eq.lockPrefix, lockSuffix = !!eq.lockSuffix;
    const lockCfg = C.lock || { name: '锁定石', amount: 1 };
    const lockStone = Materials.getQuantity(lockCfg.name);
    const affixLine = (a) => `<div class="grp-line">${Craft.affixText(a)}</div>`;
    const grpTitle = (label, cnt, locked) =>
      `<div class="grp-title">${label}（${cnt}/3）${locked ? '<span class="grp-lock">🔒 已锁</span>' : ''}</div>`;
    const affixGroupHtml = `
      <div class="craft-affix-group">
        ${grpTitle('前缀', pfx.length, lockPrefix)}
        ${pfx.map(affixLine).join('') || '<span class="hint">无</span>'}
        <hr class="craft-affix-divider">
        ${grpTitle('后缀', sfx.length, lockSuffix)}
        ${sfx.map(affixLine).join('') || '<span class="hint">无</span>'}
      </div>`;
    const stoneTitle = key => {
      const s = C[key] || {};
      return `${s.name || ''}：${s.effect || ''}${s.rule ? '（' + s.rule + '）' : ''}`;
    };
    // POE 锁前锁后：锁定侧在重铸/神圣中整组保留，按条数扣锁定石；只能锁一边
    const lockSideBtn = (side, label) => {
      const locked = side === 'prefix' ? lockPrefix : lockSuffix;
      const blocked = side === 'prefix' ? lockSuffix : lockPrefix;
      return `<button class="craft-lock-side-btn${locked ? ' on' : ''}" data-lock-side="${side}" ${blocked ? 'disabled' : ''} title="${blocked ? '只能锁定一边，先解锁另一边' : (locked ? '点击解锁（免费）' : '消耗 1 ' + lockCfg.name + ' · 只保一次打造')}">
        <span class="clsb-icon">${locked ? '🔒' : '🔓'}</span><span class="clsb-label">${label}</span><span class="clsb-sub">${locked ? '已锁定 · 下次打造后失效 · 点击解锁（免费）' : '消耗 1 ' + lockCfg.name + ' · 只保一次打造'}</span></button>`;
    };
    const lockAreaHtml = `
      <div class="craft-section-label">锁定（锁前 / 锁后）<span class="craft-lock-count">${lockCfg.name} ×${lockStone}</span></div>
      <div class="craft-lock-sides">${lockSideBtn('prefix', '锁前缀')}${lockSideBtn('suffix', '锁后缀')}</div>`;
    const lockActive = lockPrefix || lockSuffix;
    const reforgeSub = lockActive ? '锁定侧保留 · 生效后失效' : '全部词缀重洗';
    const esc = window.escapeHtml || (s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const eqR = eq.rarity || { label: '白色', color: '#b2aa9c' };
    const mt = eq.materialTier != null ? eq.materialTier : (eq.tier != null ? eq.tier : 4);
    const ilvl = window.Equipment.ilvlOf ? window.Equipment.ilvlOf(eq) : (eq.ilvl != null ? Number(eq.ilvl) : 100);
    const _gates = (Config.equipment.affixIlvlGates) || {};
    let _maxT = 5;
    for (const _k in _gates) { const _t = Number(_k), _g = Number(_gates[_k]); if (ilvl >= _g && _t < _maxT) _maxT = _t; }
    // 未鉴定：不泄露词缀，但物品等级(ilvl)掉落时即确定、不涉及词缀内容，
    // 仍展示等级 + 词缀 T 阶上限，便于判断是否为图10 的 T1 胚子（无需先鉴定）。
    if (eq.identified === false) {
      el.innerHTML = `<div class="eq-unid-block"><div class="eq-unid-icon">🔒</div><div class="eq-unid-name" style="color:${eqR.color}">${esc(eq.name || '未知装备')}</div><div class="eq-unid-line">未鉴定的 ${esc(eq.slot || '装备')} · 词缀封印</div><div class="eq-unid-line hint">鉴定后揭晓词缀并开放打造</div><div class="ceh-stats" style="display:flex; gap:14px; margin-top:8px;"><div class="ceh-stat" style="display:flex; flex-direction:column;"><span style="font-size:11px; color:#8a8478;">物品等级</span><b style="font-size:14px;">${ilvl}</b></div><div class="ceh-stat" style="display:flex; flex-direction:column;"><span style="font-size:11px; color:#8a8478;">词缀 T 阶上限</span><b style="font-size:14px;">T${_maxT}</b></div></div></div>`;
      return;
    }
    const eqBase = (eq.base && eq.base.label != null) ? eq.base : null;
    const baseTxt = eqBase ? `${esc(eqBase.label)} +${eqBase.value}` : '—';
    // PoE 式紧凑头部：名称 → 部位/品质 → 一行底材/等级 → 基底词缀，不再放规则长文（规则看百科）
    const headHtml = `
      <div class="craft-eq-head" style="border-bottom:1px solid rgba(184,155,89,.25); padding-bottom:8px; margin-bottom:8px;">
        <div class="ceh-name" style="font-weight:600; font-size:16px; color:${eqR.color}">${esc(eq.name || '装备')}</div>
        <div class="ceh-slot" style="font-size:12px; color:#9a9486; margin:2px 0 4px;">${eq.slot} · ${eqR.label}装 · ${pfx.length + sfx.length} 条词缀</div>
        <div class="ceh-meta" style="font-size:12px; color:#8a8478; margin-bottom:5px;">底材 T${mt} ｜ 物品等级 ${ilvl} ｜ 词缀上限 T${_maxT}</div>
        <div class="ceh-base" style="font-size:13px; color:#c9a86a;">${baseTxt}</div>
      </div>`;
    const tabHtml = `
      <div class="craft-tabs">
        <button class="craft-tab${soulTabActive ? '' : ' on'}" data-ctab="craft">⚒ 打造</button>
        <button class="craft-tab${soulTabActive ? ' on' : ''}" data-ctab="soul">🔥 魂铸${eq.soulAffix ? ' ✓' : ''}</button>
      </div>`;
    const craftBody = `
      <div class="craft-eq">
        ${affixGroupHtml}
      </div>
      ${lockAreaHtml}
      <div class="craft-section-label">打造操作</div>
      <div class="craft-actions craft-action-grid">
        <button class="btn-mini primary" id="craft-reforge" title="${esc(stoneTitle('reforge'))}">🎲 重铸石<span>×${Materials.getQuantity(C.reforge.name)} · ${reforgeSub}</span></button>
        <button class="btn-mini alt" id="craft-strip" ${(pfx.length + sfx.length <= 1) ? 'disabled' : ''} title="${esc(stoneTitle('strip'))}">✂️ 剥离石<span>×${Materials.getQuantity(C.strip.name)} · ${(pfx.length + sfx.length <= 1) ? '仅剩 1 条' : '移除未锁侧词缀'}</span></button>
        <button class="btn-mini holy" id="craft-holy" title="${esc(stoneTitle('holy'))}">🔮 神圣石<span>×${Materials.getQuantity(C.holy.name)} · 重 Roll 未锁侧数值</span></button>
        <button class="btn-mini augment" id="craft-augment" ${(pfx.length >= 3 && sfx.length >= 3) ? 'disabled' : ''} title="${esc(stoneTitle('augment'))}">➕ 增缀石<span>×${Materials.getQuantity(C.augment.name)} · ${(pfx.length >= 3 && sfx.length >= 3) ? '前后缀已满' : '新增到未锁侧'}</span></button>
      </div>
      ${inSell ? '<div class="inv-empty">装备在售中，先取回才能打造</div>' : ''}
      <div class="craft-result" id="craft-result"></div>`;
    const soulBody = `
      <div class="craft-section-label">魂铸（消耗 1 只魂兽 → 写入 1 条永久词缀）</div>
      <div class="craft-soul-tab-body">${soulCastHtml(eq, inSell)}</div>`;
    el.innerHTML = tabHtml + headHtml + (soulTabActive ? soulBody : craftBody);
    el.querySelectorAll('.craft-tab').forEach(btn => {
      btn.onclick = () => { soulTabActive = btn.dataset.ctab === 'soul'; renderCraftInto(el, eq); };
    });
    /* 结果区必须【每次现查】：renderCraftInto 会整块重建 el.innerHTML，
     * 之前缓存的 resultEl 当场变成被丢弃的孤儿节点 —— 写进去的文字玩家根本看不到，
     * 表现为「点完重铸，词条闪一下，提示一个字没有」（2026-09-11）。 */
    function setResult(html) {
      const box = el.querySelector('#craft-result');
      if (box) box.innerHTML = html;
    }

    /* 乐观 UI（打造的四种石头共用） */
    function craftOptimistic(btn, loadingText, craftFn, showResult) {
      return runWithLoading(btn, loadingText, async () => {
        let appliedEarly = false;
        const res = await craftFn((r) => { appliedEarly = true; showResult(r); });
        if (res.error) {
          if (appliedEarly) renderCraftInto(el, eq);
          setResult(`<span class="err">❌ ${res.error}</span>`);
          return;
        }
        if (!appliedEarly) showResult(res);
      });
    }
    const btnReforge = el.querySelector('#craft-reforge');
    if (btnReforge) btnReforge.onclick = () => {
      if (inSell) return;
      return craftOptimistic(btnReforge, '🎲 重铸中…',
        (onApplied) => Craft.reforge(eq, onApplied),
        (r) => {
          const ns = flattenAffixes(r.changed.new);
          const text = `🎲 重铸完成：${lockActive ? '锁定侧保留，未锁侧已重洗 · 🔒锁定已失效（需重新上锁定石）' : '全部词缀已重洗（数量 / 类型 / T 阶 / 数值 随机）'}<br>${ns.length ? ns.map(Craft.affixText).join('<br>') : '（无词缀）'}`;
          addLog(`🎲 重铸成功：${eq.name} ${lockActive ? '未锁侧词缀已重洗（锁定' + (lockPrefix ? '前缀' : '后缀') + '保留，锁定已失效）' : '词缀全部重洗'}`);
          showToast('🎲 重铸完成', `词条已全部随机重洗`);
          renderCraftInto(el, eq);
          setResult(text); // 必须在 renderCraftInto 之后写：重建面板会丢掉旧结果区
          if (UI.renderInventory) UI.renderInventory();
          if (UI.renderInvToolbar) UI.renderInvToolbar();
        });
    };
    const btnStrip = el.querySelector('#craft-strip');
    if (btnStrip) btnStrip.onclick = () => {
      if (inSell) return;
      return craftOptimistic(btnStrip, '✂️ 剥离中…',
        (onApplied) => Craft.strip(eq, onApplied),
        (r) => {
          const removed = r.changed.removed;
          const text = `✂️ 剥离成功：移除 ${Craft.affixText(removed)}（剩余 ${flattenAffixes(eq.affixes).length} 条）${lockActive ? ' · 🔒锁定已失效' : ''}`;
          addLog(`✂️ 剥离成功：${eq.name} 移除词缀 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + '+' + removed.value + '%'}（T${removed.tier}）`);
          showToast('✂️ 剥离成功', `移除 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + ' +' + removed.value + '%'}`);
          renderCraftInto(el, eq);
          setResult(text);
          if (UI.renderInventory) UI.renderInventory();
          if (UI.renderInvToolbar) UI.renderInvToolbar();
        });
    };
    const btnHoly = el.querySelector('#craft-holy');
    if (btnHoly) btnHoly.onclick = () => {
      if (inSell) return;
      return craftOptimistic(btnHoly, '🔮 重铸中…',
        (onApplied) => Craft.reroll(eq, onApplied),
        (r) => {
          const os = flattenAffixes(r.changed.old);
          const ns = flattenAffixes(r.changed.new);
          const lines = os.map((o, i) => `${o.label} +${o.value}%（T${o.tier}）→ ${Craft.affixText(ns[i])}`).join('<br>');
          const text = `🔮 重铸成功（类型 / T 阶不变，数值已重 Roll）：<br>${lines}${lockActive ? '<br>🔒锁定已失效' : ''}`;
          addLog(`🔮 重铸成功：${eq.name} 词缀数值重 Roll（类型 / T 阶不变）`);
          showToast('🔮 重铸成功', `数值已重 Roll<br><small>类型 / T 阶不变</small>`);
          renderCraftInto(el, eq);
          setResult(text);
          if (UI.renderInventory) UI.renderInventory();
          if (UI.renderInvToolbar) UI.renderInvToolbar();
        });
    };
    const btnAug = el.querySelector('#craft-augment');
    if (btnAug) btnAug.onclick = () => {
      if (inSell || (eq.affixes.prefix.length >= 3 && eq.affixes.suffix.length >= 3)) return;
      return craftOptimistic(btnAug, '➕ 增缀中…',
        (onApplied) => Craft.augment(eq, onApplied),
        (r) => {
          const n = r.changed.new;
          const text = `➕ 增缀成功：新增 ${Craft.affixText(n)}（前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3）${lockActive ? ' · 🔒锁定已失效' : ''}`;
          addLog(`➕ 增缀成功：${eq.name} 新增词缀 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + '+' + n.value + '%'}（T${n.tier}）`);
          showToast('➕ 增缀成功', `新增 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + ' +' + n.value + '%'}<br><small>T${n.tier} · 前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3</small>`);
          renderCraftInto(el, eq);
          setResult(text);
          if (UI.renderInventory) UI.renderInventory();
          if (UI.renderInvToolbar) UI.renderInvToolbar();
        });
    };
    // ---- 锁定按钮（POE 锁前锁后）：切换 eq.lockPrefix / eq.lockSuffix，免费，云同步 ----
    el.querySelectorAll('.craft-lock-side-btn').forEach(btn => {
      btn.onclick = async () => {
        if (inSell) return;
        const side = btn.dataset.lockSide;
        const locked = side === 'prefix' ? eq.lockPrefix : eq.lockSuffix;
        const sideName = side === 'prefix' ? '前缀' : '后缀';
        const res = locked ? await Craft.unlockSide(eq, side) : await Craft.lockSide(eq, side);
        if (res && res.error) { setResult(`<span class="err">❌ ${res.error}</span>`); return; }
        const text = locked ? `🔓 已解锁${sideName}（免费）` : `🔒 已锁定${sideName}（消耗 1 ${lockCfg.name} · 下次打造后失效）`;
        showToast(locked ? '🔓 已解锁' : '🔒 已锁定', `${sideName}${locked ? '解锁' : '锁定'}成功`);
        renderCraftInto(el, eq);
        setResult(text);
        if (UI.renderInventory) UI.renderInventory();
        if (UI.renderInvToolbar) UI.renderInvToolbar();
      };
    });
    bindSoulCast(el, eq, () => renderCraftInto(el, eq));
  }

  function openCraftPanel(eq) {
    // 主从式：打造直接渲染到「背包页右侧面板」；无右侧面板时兜底开旧抽屉
    if (UI.renderEqDetail) { UI.renderEqDetail(eq); return; }
    const host = $('craft-modal');
    if (!host) return;
    activeCraftEq = eq;
    const body = $('craft-body');
    renderCraftInto(body, eq);
    host.style.display = 'block';
    host.classList.add('is-open');
  }
  function closeCraftPanel() {
    activeCraftEq = null;
    lockMode = false; lockSel.clear();
    if (UI.hideEqDetail) { UI.hideEqDetail(); return; }
    if (UI.renderInventory) UI.renderInventory();
    const host = $('craft-modal');
    if (!host) return;
    host.classList.remove('is-open');
    window.setTimeout(() => {
      if (!host.classList.contains('is-open')) host.style.display = 'none';
    }, 300);
  }


  /* ---------- 魂铸（宠物 → 装备）UI ---------- */
  // 当前魂铸选择状态：{ tier, petId, traitId }（档位按钮 = 筛选器，始终可点；确认按钮控制能否铸）
  const soulState = { tier: 'normal', petId: null, traitId: null };
  const soulTier = k => { const T = (Config.soulCast && Config.soulCast.tiers) || {}; return T[k] || {}; };
  // 该档位下可魂铸的宠物列表（按 level/growth/needFinal 过滤）
  function soulCandidates(eq) {
    const T = soulTier(soulState.tier);
    const P = window.Pet;
    const pets = (P && P.getPets ? P.getPets() : []) || [];
    return pets.filter(p => {
      const lvl = T.minLevel != null ? T.minLevel : T.level;
      if (!lvl || Number(p.level) < lvl) return false;
      const grw = T.minGrowth != null ? T.minGrowth : T.growth;
      if (grw != null && p.growth < grw) return false;
      if (T.needFinal && !(P.getAwakenState && P.getAwakenState(p))) return false;
      if (T.source === 'awaken') return !!(P.getAwakenState && P.getAwakenState(p));
      return Array.isArray(p.traits) && p.traits.length > 0; // 血脉档需要特质
    });
  }
  // 特质 T 阶颜色
  const S_TIER_COLOR = { 1: '#c9a86a', 2: '#b99a6a', 3: '#7fae7f' };
  function soulCastHtml(eq, inSell) {
    const S = Config.soulCast || {};
    const mat = S.material || '凝魂晶石';
    const matCount = S.materialCount || 10;
    // 已有魂铸词缀：只读展示，不可再铸
    if (eq.soulAffix) {
      const a = eq.soulAffix;
      const color = S_TIER_COLOR[a.tier] || '#c9a86a';
      const val = (a.value != null && !['skillDmg'].includes(a.type))
        ? '+' + a.value + (['hit', 'dodge', 'spd'].includes(a.type) ? '' : '%') : '';
      return `<div class="craft-soul-block">
          <div class="craft-soul-affix" style="color:${color}">${a.label || '魂·?'} <b>T${a.tier}</b> ${val} <em>（${a.source || ''} · 永久不可剥离）</em></div>
          <div class="craft-soul-note">每件装备最多 1 条魂铸词缀 · 可随装备交易</div>
        </div>`;
    }
    const T = soulTier(soulState.tier);
    const cands = soulCandidates(eq);
    const selPet = cands.find(p => p.id === soulState.petId) || null;
    // 档位按钮（始终可点 = 筛选器）
    const tiers = [
      { k: 'normal', label: '普通', desc: 'Lv40+ / 成长≥10 · 铸血脉 T=原阶' },
      { k: 'elite', label: '精锐', desc: 'Lv40+ / 成长≥40 · 血脉 T+1' },
      { k: 'legend', label: '传承', desc: '已觉醒终形态 / 成长≥60 · 铸觉醒 T1' }
    ];
    const tierBtns = tiers.map(t => {
      const cur = Config.soulCast && Config.soulCast.tiers && Config.soulCast.tiers[t.k];
      const ml = cur && (cur.minLevel != null ? cur.minLevel : cur.level);
      const mg = cur && (cur.minGrowth != null ? cur.minGrowth : cur.growth);
      const disable = cur && (ml == null || mg == null);
      return `<button class="btn-mini soul-tier ${soulState.tier === t.k ? 'on' : ''}" data-tier="${t.k}" ${disable ? 'disabled' : ''}>
        ${t.label}<span>${cur ? 'Lv' + ml + '·成长≥' + mg : ''}</span></button>`;
    }).join('');
    // 宠物列表
    const petRows = cands.length ? cands.map(p => {
      const traits = (Array.isArray(p.traits) && p.traits.length)
        ? p.traits.map(t => { const d = (Config.petTraits || {})[t.id] || {}; return (d.label || t.id) + ' T' + t.tier; }).join('、')
        : (T.source === 'awaken' ? '觉醒特质' : '无特质');
      const sel = selPet && selPet.id === p.id ? ' sel' : '';
      return `<div class="craft-soul-pet${sel}" data-pet="${p.id}"><span class="sp-name">${p.name}</span><span class="sp-meta">Lv${p.level} · 成长${p.growth}</span><span class="sp-traits">${traits}</span></div>`;
    }).join('') : (function () {
      // 空态必须能自查：光写"门槛 Lv40 / 成长≥10"，玩家看不出自己差哪一项、差多少。
      const all = (window.Pet && window.Pet.getPets) ? (window.Pet.getPets() || []) : [];
      const maxLv = all.length ? Math.max.apply(null, all.map(p => Number(p.level) || 1)) : 0;
      const maxGrw = all.length ? Math.max.apply(null, all.map(p => Number(p.growth) || 0)) : 0;
      const diag = all.length
        ? `你名下 ${all.length} 只：最高 Lv${maxLv} · 最高成长 ${maxGrw.toFixed(1)}`
        : '你名下还没有魂兽';
      return `<div class="craft-soul-empty">当前档位没有可魂铸的宠物（${T.label}：Lv${T.minLevel != null ? T.minLevel : T.level}+ / 成长≥${T.minGrowth != null ? T.minGrowth : T.growth}${T.needFinal ? ' / 终形态' : ''}）<br>${diag}</div>`;
    })();
    // 特质自选（血脉档：宠有多条特质时选 1 条）
    let traitSel = '';
    if (selPet && T.source !== 'awaken') {
      const trs = (Array.isArray(selPet.traits) ? selPet.traits : []).sort((a, b) => a.tier - b.tier);
      if (trs.length > 1) {
        traitSel = '<div class="craft-soul-trait">选择要铸的特质：' + trs.map(t => {
          const d = (Config.petTraits || {})[t.id] || {};
          const color = S_TIER_COLOR[t.tier] || '#9a9a9a';
          return `<button class="btn-mini soul-trait ${soulState.traitId === t.id ? 'on' : ''}" data-trait="${t.id}" style="color:${color}">${d.label || t.id} T${t.tier}</button>`;
        }).join('') + '</div>';
      }
    }
    const canCast = !!selPet && (T.source === 'awaken' || !!(soulState.traitId || (selPet.traits || []).length === 1));
    // 按钮文案要说清到底缺哪一步（旧版不论缺什么都写"先选宠物"，误导玩家）
    const castText = inSell ? '装备在售中'
      : !selPet ? '先选宠物'
        : canCast ? '⚒ 确认魂铸（消耗 1 只宠物 + ' + matCount + ' ' + mat + '）'
          : '先选要铸的特质';
    return `<div class="craft-soul-block">
        <div class="craft-soul-tiers">${tierBtns}</div>
        <div class="craft-soul-desc">${T.label}：${T.source === 'awaken' ? '铸觉醒特质（固定 T1）' : '铸血脉特质'} · 消耗装备 + 宠物（消失）+ ${matCount} 颗${mat}</div>
        <div class="craft-soul-pets">${petRows}</div>
        ${traitSel}
        <div class="craft-soul-actions">
          <button class="btn-mini primary" id="craft-soul-cast" ${inSell || !canCast ? 'disabled' : ''}>
            ${castText}
          </button>
          <div class="craft-soul-result" id="craft-soul-result"></div>
        </div>
      </div>`;
  }
  // 绑定魂铸事件（档位切换 / 选宠 / 选特质 / 确认）
  function bindSoulCast(el, eq, rerender) {
    const body = el;
    body.querySelectorAll('.craft-soul-tier').forEach(btn => {
      btn.onclick = () => {
        soulState.tier = btn.dataset.tier;
        soulState.petId = null; soulState.traitId = null;
        rerender();
      };
    });
    body.querySelectorAll('.craft-soul-pet').forEach(row => {
      row.onclick = () => {
        soulState.petId = Number(row.dataset.pet);
        soulState.traitId = null;
        rerender();
      };
    });
    // 特质自选（宠有 2 条以上特质时必须选 1 条才能铸）。
    // 血泪（2026-09-08）：这段绑定漏了 → 特质按钮点了没反应 → canCast 永远 false
    // → 确认按钮一直 disabled「先选宠物」，魂铸整条线看起来"完全不能用"。
    body.querySelectorAll('.soul-trait').forEach(btn => {
      btn.onclick = () => {
        soulState.traitId = btn.dataset.trait;
        rerender();
      };
    });
    const btnCast = body.querySelector('#craft-soul-cast');
    if (btnCast && !btnCast.disabled) btnCast.onclick = async () => {
      const btn = btnCast;
      btn.disabled = true;
      btn.textContent = '⚒ 魂铸中…';
      /* ⚠️ 整段必须 try/catch（2026-09-08 血泪）：
       * 这里原来读 res.aff.label，但 Craft.soulCast 返回的字段名是 soulAffix（没有 aff）
       * → 魂铸其实已经成功，却在这一行抛 TypeError → 后面的 btn.disabled=false 永远不执行
       * → 按钮永久卡在「魂铸中…」，玩家以为整条线坏了。
       * 结论：任何 await 之后的异常都必须先把按钮放回来，否则一次小错误 = 界面永久卡死。 */
      try {
        const petObj = (window.Pet && window.Pet.getPets ? window.Pet.getPets() : []).find(p => p.id === soulState.petId);
        if (!petObj) { btn.disabled = false; btn.textContent = '⚒ 确认魂铸'; return; }
        const res = await Craft.soulCast(eq, petObj, soulState.tier, soulState.traitId || undefined);
        const box = body.querySelector('#craft-soul-result');
        if (!box) { if (UI.renderAll) UI.renderAll(); return; }
        if (res && res.ok) {
          const aff = res.soulAffix || {};
          box.innerHTML = `<span style="color:#7fae7f">⚒ 魂铸成功：${aff.label || '魂铸词缀'}（T${aff.tier}）已永久铸入 ${eq.name}。${res.petName} 已消失。</span>`;
          addLog(`⚒ 魂铸成功：${eq.name} 获得 ${aff.label || '魂铸词缀'}（T${aff.tier}），${res.petName} 被消耗`);
          showToast('⚒ 魂铸成功', `${aff.label || '魂铸词缀'}（T${aff.tier}）<br><small>永久词缀 · 不可剥离/重铸/神圣石洗</small>`);
          // 宠已被消耗、装备已有魂铸词缀 → 清空选择，避免残留指向不存在的宠
          soulState.petId = null; soulState.traitId = null;
          if (UI.renderAll) UI.renderAll();
        } else {
          box.innerHTML = `<span class="err">❌ ${(res && res.error) || '魂铸失败'}</span>`;
          btn.disabled = false;
          btn.textContent = '⚒ 确认魂铸';
        }
      } catch (e) {
        console.error('[soulcast] 魂铸异常', e);
        const box = body.querySelector('#craft-soul-result');
        if (box) box.innerHTML = `<span class="err">❌ 魂铸异常：${(e && e.message) || e}</span>`;
        btn.disabled = false;
        btn.textContent = '⚒ 确认魂铸';
      }
    };
  }

  /* ---------- 对外 API（打造页） ---------- */
  UI.openCraftPanel = openCraftPanel;
  UI.closeCraftPanel = closeCraftPanel;
  UI.renderCraftInto = renderCraftInto;
  UI.soulCastHtml = soulCastHtml;
  UI.bindSoulCast = bindSoulCast;
})();
