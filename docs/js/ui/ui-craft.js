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

  /* ---------- 装备打造面板（重铸石 / 剥离石 / 神圣石 / 增缀石 / 锁定词缀） ----------
   * 2026-09-04 主从式：打造内容渲染进「背包页右侧面板」的打造容器（renderCraftInto(el, eq)），
   * openCraftPanel 改为重定向到 UI.renderEqDetail；旧抽屉 craft-modal 不再打开。
   * 锁定改为 POE 锁前/锁后（2026-09-04 拍板）：只锁一边（eq.lockPrefix / eq.lockSuffix），
   * 锁定侧在重铸/神圣中整组保留、剥离/增缀不触及；重铸/神圣时按锁定侧条数扣锁定石。
   */
  function renderCraftInto(el, eq) {
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
    const stoneTip = key => {
      const stone = C[key];
      return `<span class="craft-stone-tip-wrap"><span class="craft-stone-name">${stone.name}</span><span class="craft-stone-tip" role="tooltip"><b>${stone.name}</b><span>${stone.effect}</span><em>${stone.rule}</em></span></span>`;
    };
    // POE 锁前锁后：锁定侧在重铸/神圣中整组保留，按条数扣锁定石；只能锁一边
    const lockSideBtn = (side, label) => {
      const locked = side === 'prefix' ? lockPrefix : lockSuffix;
      const blocked = side === 'prefix' ? lockSuffix : lockPrefix;
      const cost = (side === 'prefix' ? pfx.length : sfx.length);
      return `<button class="craft-lock-side-btn${locked ? ' on' : ''}" data-lock-side="${side}" ${blocked ? 'disabled' : ''} title="${blocked ? '只能锁定一边，先解锁另一边' : (locked ? '点击解锁（免费）' : '锁定后重铸/神圣保留该侧')}">
        <span class="clsb-icon">${locked ? '🔒' : '🔓'}</span><span class="clsb-label">${label}</span><span class="clsb-sub">${locked ? '已锁定 · 点击解锁（免费）' : '重铸/神圣保留该侧 · 耗 ' + cost + ' ' + lockCfg.name}</span></button>`;
    };
    const lockAreaHtml = `
      <div class="craft-section-label">锁定（锁前 / 锁后）<span class="craft-lock-count">${lockCfg.name} ×${lockStone}</span></div>
      <div class="craft-lock-sides">${lockSideBtn('prefix', '锁前缀')}${lockSideBtn('suffix', '锁后缀')}</div>
      <div class="craft-lock-note">只锁一边 · 重铸/神圣时按锁定侧条数扣${lockCfg.name} · ${lockCfg.name}仅图16/17掉落</div>`;
    const lockActive = lockPrefix || lockSuffix;
    const lockCost = lockPrefix ? pfx.length : (lockSuffix ? sfx.length : 0);
    const reforgeSub = lockPrefix ? `前缀锁定保留 · +${pfx.length} ${lockCfg.name}` : (lockSuffix ? `后缀锁定保留 · +${sfx.length} ${lockCfg.name}` : '全部词缀重洗');
    const soulHtml = soulCastHtml(eq, inSell);
    const soulFold = eq.soulAffix
      ? `<div class="craft-section-label">魂铸（宠物 → 装备）</div>${soulHtml}`
      : `<details class="craft-soul-details"><summary>魂铸（宠物 → 装备）<span class="craft-soul-fold-hint">▸ 点击展开</span></summary><div class="craft-soul-fold-body">${soulHtml}</div></details>`;
    el.innerHTML = `
      <div class="craft-eq">
        ${affixGroupHtml}
      </div>
      <div class="craft-section-label">打造资源</div>
      <div class="craft-stones craft-resource-grid">
        <div class="craft-resource-item"><span class="resource-icon">🎲</span><span>${stoneTip('reforge')}</span><b>×${Materials.getQuantity(C.reforge.name)}</b></div>
        <div class="craft-resource-item"><span class="resource-icon">✂️</span><span>${stoneTip('strip')}</span><b>×${Materials.getQuantity(C.strip.name)}</b></div>
        <div class="craft-resource-item holy"><span class="resource-icon">🔮</span><span>${stoneTip('holy')}</span><b>×${Materials.getQuantity(C.holy.name)}</b></div>
        <div class="craft-resource-item"><span class="resource-icon">➕</span><span>${stoneTip('augment')}</span><b>×${Materials.getQuantity(C.augment.name)}</b></div>
        <div class="craft-resource-item lock"><span class="resource-icon">🔒</span><span>${stoneTip('lock')}</span><b>×${lockStone}</b></div>
      </div>
      ${lockAreaHtml}
      <div class="craft-section-label">打造操作</div>
      <div class="craft-actions craft-action-grid">
        <button class="btn-mini primary" id="craft-reforge">🎲 重铸石<span>消耗 1${lockCost ? ' + ' + lockCost + ' ' + lockCfg.name : ''} · ${reforgeSub}</span></button>
        <button class="btn-mini alt" id="craft-strip" ${(pfx.length + sfx.length <= 1) ? 'disabled' : ''}>✂️ 剥离石<span>${(pfx.length + sfx.length <= 1) ? '仅剩 1 条' : '消耗 1 · 移除未锁侧词缀'}</span></button>
        <button class="btn-mini holy" id="craft-holy">🔮 神圣石<span>消耗 1${lockCost ? ' + ' + lockCost + ' ' + lockCfg.name : ''} · 重 Roll 未锁侧数值</span></button>
        <button class="btn-mini augment" id="craft-augment" ${(pfx.length >= 3 && sfx.length >= 3) ? 'disabled' : ''}>➕ 增缀石<span>${(pfx.length >= 3 && sfx.length >= 3) ? '前后缀已满' : '消耗 1 · 新增到未锁侧'}</span></button>
      </div>
      ${inSell ? '<div class="inv-empty">装备在售中，先取回才能打造</div>' : ''}
      <div class="craft-result" id="craft-result"></div>
      ${soulFold}`;
    const resultEl = el.querySelector('#craft-result');

    /* 乐观 UI（打造的四种石头共用） */
    function craftOptimistic(btn, loadingText, craftFn, showResult) {
      return runWithLoading(btn, loadingText, async () => {
        let appliedEarly = false;
        const res = await craftFn((r) => { appliedEarly = true; showResult(r); });
        if (res.error) {
          if (appliedEarly) renderCraftInto(el, eq);
          resultEl.innerHTML = `<span class="err">❌ ${res.error}</span>`;
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
          resultEl.innerHTML = `🎲 重铸完成：${lockActive ? '锁定侧保留，未锁侧' : '全部词缀'}已重洗（数量 / 类型 / T 阶 / 数值 随机）<br>${ns.length ? ns.map(Craft.affixText).join('<br>') : '（无词缀）'}`;
          addLog(`🎲 重铸成功：${eq.name} ${lockActive ? '未锁侧词缀已重洗（锁定' + (lockPrefix ? '前缀' : '后缀') + '保留）' : '词缀全部重洗'}`);
          showToast('🎲 重铸完成', `词条已全部随机重洗`);
          renderCraftInto(el, eq);
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
          resultEl.innerHTML = `✂️ 剥离成功：移除 ${Craft.affixText(removed)}（剩余 ${flattenAffixes(eq.affixes).length} 条）`;
          addLog(`✂️ 剥离成功：${eq.name} 移除词缀 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + '+' + removed.value + '%'}（T${removed.tier}）`);
          showToast('✂️ 剥离成功', `移除 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + ' +' + removed.value + '%'}`);
          renderCraftInto(el, eq);
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
          resultEl.innerHTML = `🔮 重铸成功（类型 / T 阶不变，数值已重 Roll）：<br>${lines}`;
          addLog(`🔮 重铸成功：${eq.name} 词缀数值重 Roll（类型 / T 阶不变）`);
          showToast('🔮 重铸成功', `数值已重 Roll<br><small>类型 / T 阶不变</small>`);
          renderCraftInto(el, eq);
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
          resultEl.innerHTML = `➕ 增缀成功：新增 ${Craft.affixText(n)}（前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3）`;
          addLog(`➕ 增缀成功：${eq.name} 新增词缀 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + '+' + n.value + '%'}（T${n.tier}）`);
          showToast('➕ 增缀成功', `新增 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + ' +' + n.value + '%'}<br><small>T${n.tier} · 前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3</small>`);
          renderCraftInto(el, eq);
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
        if (res && res.error) { resultEl.innerHTML = `<span class="err">❌ ${res.error}</span>`; return; }
        resultEl.innerHTML = locked ? `🔓 已解锁${sideName}（免费）` : `🔒 已锁定${sideName}（重铸/神圣时保留 · 按条数扣${lockCfg.name}）`;
        showToast(locked ? '🔓 已解锁' : '🔒 已锁定', `${sideName}${locked ? '解锁' : '锁定'}成功`);
        renderCraftInto(el, eq);
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
      { k: 'legend', label: '传承', desc: 'Lv60终形态 / 成长≥60 · 铸觉醒 T1' }
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
    }).join('') : `<div class="craft-soul-empty">当前档位没有可魂铸的宠物（${T.label}：Lv${T.minLevel != null ? T.minLevel : T.level}+ / 成长≥${T.minGrowth != null ? T.minGrowth : T.growth}${T.needFinal ? ' / 终形态' : ''}）</div>`;
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
    return `<div class="craft-soul-block">
        <div class="craft-soul-tiers">${tierBtns}</div>
        <div class="craft-soul-desc">${T.label}：${T.source === 'awaken' ? '铸觉醒特质（固定 T1）' : '铸血脉特质'} · 消耗装备 + 宠物（消失）+ ${matCount} 颗${mat}</div>
        <div class="craft-soul-pets">${petRows}</div>
        ${traitSel}
        <div class="craft-soul-actions">
          <button class="btn-mini primary" id="craft-soul-cast" ${inSell || !canCast ? 'disabled' : ''}>
            ${inSell ? '装备在售中' : canCast ? '⚒ 确认魂铸（消耗 1 只宠物 + ' + matCount + ' ' + mat + '）' : '先选宠物'}
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
    const btnCast = body.querySelector('#craft-soul-cast');
    if (btnCast && !btnCast.disabled) btnCast.onclick = async () => {
      const btn = btnCast;
      btn.disabled = true;
      btn.textContent = '⚒ 魂铸中…';
      const petObj = (window.Pet && window.Pet.getPets ? window.Pet.getPets() : []).find(p => p.id === soulState.petId);
      if (!petObj) { btn.disabled = false; btn.textContent = '⚒ 确认魂铸'; return; }
      const res = await Craft.soulCast(eq, petObj, soulState.tier, soulState.traitId || undefined);
      const box = body.querySelector('#craft-soul-result');
      if (!box) { if (UI.renderAll) UI.renderAll(); return; }
      if (res && res.ok) {
        box.innerHTML = `<span style="color:#7fae7f">⚒ 魂铸成功：${res.aff.label}（T${res.aff.tier}）已永久铸入 ${eq.name}。${res.petName} 已消失。</span>`;
        addLog(`⚒ 魂铸成功：${eq.name} 获得 ${res.aff.label}（T${res.aff.tier}），${res.petName} 被消耗`);
        showToast('⚒ 魂铸成功', `${res.aff.label}（T${res.aff.tier}）<br><small>永久词缀 · 不可剥离/重铸/神圣石洗</small>`);
        if (UI.renderAll) UI.renderAll();
      } else {
        box.innerHTML = `<span class="err">❌ ${(res && res.error) || '魂铸失败'}</span>`;
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
