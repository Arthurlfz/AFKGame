/* ============================================================
 * ui/ui-craft.js —— 打造页 UI（重铸石 / 剥离石 / 神圣石 / 增缀石）
 * 职责：装备打造面板（重铸 / 剥离 / 重 Roll / 增缀）
 * 依赖：craft / market / equipment（只读查询与流程接口）；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $, showToast, addLog } = UI;

  const Config = window.Config;
  const Craft = window.Craft;
  const Market = window.Market;
  const Materials = window.Materials;
  const { flattenAffixes, rarityOf } = window.Equipment;

  /* ---------- 装备打造面板（重铸石 / 剥离石 / 神圣石 / 增缀石） ---------- */
  let activeCraftEq = null;

  function openCraftPanel(eq) {
    activeCraftEq = eq;
    const C = Config.craft;
    const body = $('craft-body');
    const render = () => {
      const inSell = Market.isItemListed(eq.cloudId);
      const pfx = eq.affixes.prefix || [];
      const sfx = eq.affixes.suffix || [];
      const affixGroupHtml = `
        <div class="craft-affix-group">
          <div class="grp-title">前缀（${pfx.length}/3）</div>
          ${pfx.map(a => `<div class="grp-line prefix">${Craft.affixText(a)}</div>`).join('') || '<span class="hint">无</span>'}
          <hr class="craft-affix-divider">
          <div class="grp-title">后缀（${sfx.length}/3）</div>
          ${sfx.map(a => `<div class="grp-line suffix">${Craft.affixText(a)}</div>`).join('') || '<span class="hint">无</span>'}
        </div>`;
      const stoneTip = key => {
        const stone = C[key];
        return `<span class="craft-stone-tip-wrap"><span class="craft-stone-name">${stone.name}</span><span class="craft-stone-tip" role="tooltip"><b>${stone.name}</b><span>${stone.effect}</span><em>${stone.rule}</em></span></span>`;
      };
      body.innerHTML = `
        <div class="craft-eq">
          <div class="ename" style="color:${rarityOf(eq).color}">${eq.name} <span style="font-size:0.833rem">${rarityOf(eq).label}装·T${eq.tier}</span></div>
          <div class="edesc">${eq.slot}｜${eq.base.label}+${eq.base.value}</div>
          ${affixGroupHtml}
          <div class="craft-affixcount">前缀 ${pfx.length}/3 · 后缀 ${sfx.length}/3</div>
        </div>
        <div class="craft-section-label">打造资源</div>
        <div class="craft-stones craft-resource-grid">
          <div class="craft-resource-item"><span class="resource-icon">🎲</span><span>${stoneTip('reforge')}</span><b>×${Materials.getQuantity(C.reforge.name)}</b></div>
          <div class="craft-resource-item"><span class="resource-icon">✂️</span><span>${stoneTip('strip')}</span><b>×${Materials.getQuantity(C.strip.name)}</b></div>
          <div class="craft-resource-item holy"><span class="resource-icon">🔮</span><span>${stoneTip('holy')}</span><b>×${Materials.getQuantity(C.holy.name)}</b></div>
          <div class="craft-resource-item"><span class="resource-icon">➕</span><span>${stoneTip('augment')}</span><b>×${Materials.getQuantity(C.augment.name)}</b></div>
        </div>
        <div class="craft-section-label">打造操作</div>
        <div class="craft-actions craft-action-grid">
          <button class="btn-mini primary" id="craft-reforge">🎲 重铸石<span>消耗 1 · 全部重洗</span></button>
          <button class="btn-mini alt" id="craft-strip" ${(flattenAffixes(eq.affixes).length <= 1) ? 'disabled' : ''}>✂️ 剥离石<span>${flattenAffixes(eq.affixes).length <= 1 ? '仅剩 1 条' : '消耗 1 · 移除词缀'}</span></button>
          <button class="btn-mini holy" id="craft-holy">🔮 神圣石<span>消耗 1 · 重 Roll 数值</span></button>
          <button class="btn-mini augment" id="craft-augment" ${(flattenAffixes(eq.affixes).length >= 6) ? 'disabled' : ''}>➕ 增缀石<span>${flattenAffixes(eq.affixes).length >= 6 ? '前后缀已满' : '消耗 1 · 新增词缀'}</span></button>
        </div>
        ${inSell ? '<div class="inv-empty">装备在售中，先取回才能打造</div>' : ''}
        <div class="craft-result" id="craft-result"></div>`;
      // 打造按钮统一防连点：点击后立即禁用（云同步期间再点无效），完成后恢复。
      // 不这么做时快速连点会并发触发多次打造，词缀被连续改多次 + 材料重复扣（曾报"卡顿/突破上限"）
      const btnReforge = body.querySelector('#craft-reforge');
      if (btnReforge) btnReforge.onclick = async () => {
        if (inSell) return;
        btnReforge.disabled = true; // 立即禁用：云同步期间防连点
        const res = await Craft.reforge(eq);
        const box = $('craft-result');
        if (res.error) { box.innerHTML = `<span class="err">❌ ${res.error}</span>`; btnReforge.disabled = false; return; }
        const ns = flattenAffixes(res.changed.new);
        box.innerHTML = `🎲 重铸完成：全部词缀已重洗（数量 / 类型 / T 阶 / 数值 随机）<br>${ns.length ? ns.map(Craft.affixText).join('<br>') : '（无词缀）'}`;
        addLog(`🎲 重铸成功：${eq.name} 词缀全部重洗`);
        showToast('🎲 重铸完成', `词条已全部随机重洗`);
        render(); // 重建按钮：恢复可用
        if (UI.renderInventory) UI.renderInventory();
        if (UI.renderInvToolbar) UI.renderInvToolbar();
      };
      const btnStrip = body.querySelector('#craft-strip');
      if (btnStrip) btnStrip.onclick = async () => {
        if (inSell) return;
        btnStrip.disabled = true; // 立即禁用：云同步期间防连点
        const res = await Craft.strip(eq);
        const box = $('craft-result');
        if (res.error) { box.innerHTML = `<span class="err">❌ ${res.error}</span>`; btnStrip.disabled = false; return; }
        const removed = res.changed.removed;
        box.innerHTML = `✂️ 剥离成功：移除 ${Craft.affixText(removed)}（剩余 ${flattenAffixes(eq.affixes).length} 条）`;
        addLog(`✂️ 剥离成功：${eq.name} 移除词缀 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + '+' + removed.value + '%'}（T${removed.tier}）`);
        showToast('✂️ 剥离成功', `移除 ${Equipment.formatAffix ? Equipment.formatAffix(removed) : removed.label + ' +' + removed.value + '%'}`);
        render(); // 重建按钮：恢复可用
        if (UI.renderInventory) UI.renderInventory();
        if (UI.renderInvToolbar) UI.renderInvToolbar();
      };
      const btnHoly = body.querySelector('#craft-holy');
      btnHoly.onclick = async () => {
        if (inSell) return;
        btnHoly.disabled = true; // 立即禁用：云同步期间防连点
        const res = await Craft.reroll(eq);
        const box = $('craft-result');
        if (res.error) { box.innerHTML = `<span class="err">❌ ${res.error}</span>`; btnHoly.disabled = false; return; }
        const os = flattenAffixes(res.changed.old);
        const ns = flattenAffixes(res.changed.new);
        const lines = os.map((o, i) =>
          `${o.label} +${o.value}%（T${o.tier}）→ ${Craft.affixText(ns[i])}`
        ).join('<br>');
        box.innerHTML = `🔮 重铸成功（类型 / T 阶不变，数值已重 Roll）：<br>${lines}`;
        addLog(`🔮 重铸成功：${eq.name} 词缀数值重 Roll（类型 / T 阶不变）`);
        showToast('🔮 重铸成功', `数值已重 Roll<br><small>类型 / T 阶不变</small>`);
        render(); // 重建按钮：恢复可用
        if (UI.renderInventory) UI.renderInventory();
        if (UI.renderInvToolbar) UI.renderInvToolbar();
      };
      const btnAug = body.querySelector('#craft-augment');
      if (btnAug) btnAug.onclick = async () => {
        if (inSell || (eq.affixes.prefix.length >= 3 && eq.affixes.suffix.length >= 3)) return;
        btnAug.disabled = true; // 立即禁用：云同步期间防连点卡顿/重复触发
        const res = await Craft.augment(eq);
        const box = $('craft-result');
        if (res.error) { box.innerHTML = `<span class="err">❌ ${res.error}</span>`; btnAug.disabled = false; return; }
        const n = res.changed.new;
        box.innerHTML = `➕ 增缀成功：新增 ${Craft.affixText(n)}（前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3）`;
        addLog(`➕ 增缀成功：${eq.name} 新增词缀 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + '+' + n.value + '%'}（T${n.tier}）`);
        showToast('➕ 增缀成功', `新增 ${Equipment.formatAffix ? Equipment.formatAffix(n) : n.label + ' +' + n.value + '%'}<br><small>T${n.tier} · 前缀 ${eq.affixes.prefix.length}/3 · 后缀 ${eq.affixes.suffix.length}/3</small>`);
        render(); // 重建按钮：未满恢复可用，已满则保持 disabled（前后缀都满时本就禁用）
        UI.renderAll();
      };
    };
    render();
    $('craft-modal').style.display = 'block';
    $('craft-modal').classList.add('is-open');
    if (UI.renderInventory) UI.renderInventory();
  }
  function closeCraftPanel() {
    activeCraftEq = null;
    if (UI.renderInventory) UI.renderInventory();
    $('craft-modal').classList.remove('is-open');
    window.setTimeout(() => {
      if (!$('craft-modal').classList.contains('is-open')) $('craft-modal').style.display = 'none';
    }, 300);
  }

  /* ---------- 对外 API（打造页） ---------- */
  UI.openCraftPanel = openCraftPanel;
  UI.closeCraftPanel = closeCraftPanel;
  UI.getActiveCraftEqId = () => activeCraftEq && activeCraftEq.id;
})();
