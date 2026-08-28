/* ============================================================
 * ui/ui-equipment.js —— 装备页 UI（背包 / 筛选 / 多选 / 孵化 / 分解）
 * 职责：
 *  1. 背包渲染（穿装备 / 孵化宠物蛋 / 多选批量分解 / 锁定）
 *  2. 筛选栏（稀有度 / T 阶 / 锁定）与工具栏（计数 / 全选 / 批量分解）
 *  3. 一键分解确认框 + 批量分解确认框
 *  4. 装备详情浮层（前后缀分组）
 * 依赖：equipment / drop / market / salvage（只读查询与流程接口）；通用组件来自 ui-common
 * 注：打造按钮点击后调用 ui-craft 的 UI.openCraftPanel（跨文件走公共命名空间）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const { getActivePet } = window.Pet;
  const { getInventory, equipItem, describeItem } = window.Equipment;
  const { getEggCount, hatchEgg } = window.Drop;
  const Materials = window.Materials;
  const Market = window.Market;
  const Salvage = window.Salvage;

  /* ---------- 装备筛选 + 多选（仅装备页，不影响数据结构） ---------- */
  let invFilter = { rarity: null, tier: null, lock: null }; // lock: 'locked' | 'unlocked' | null
  let selectedEqIds = new Set(); // 选中的装备本地 id

  // 按当前筛选条件过滤背包
  function getFilteredInventory() {
    const F = invFilter;
    return getInventory().filter(eq =>
      (!F.rarity || eq.rarity.id === F.rarity) &&
      (!F.tier || eq.tier === F.tier) &&
      (!F.lock || (F.lock === 'locked' ? eq.locked : !eq.locked))
    );
  }
  function applyFilter() {
    renderInventory();
    renderInvToolbar();
  }
  // 筛选栏（稀有度 / T 阶 / 锁定状态 / 重置）
  function renderInvFilter() {
    const box = $('inv-filter');
    box.innerHTML = '';
    const chip = (text, active, onClick) => {
      const b = document.createElement('button');
      b.className = 'f-chip' + (active ? ' active' : '');
      b.textContent = text;
      b.onclick = onClick;
      return b;
    };
    const group = (label, chips) => {
      const g = document.createElement('div');
      g.className = 'f-group';
      const l = document.createElement('span');
      l.className = 'f-label';
      l.textContent = label;
      g.appendChild(l);
      for (const c of chips) g.appendChild(c);
      return g;
    };
    box.appendChild(group('稀有度', [
      chip('白', invFilter.rarity === 'white', () => { invFilter.rarity = invFilter.rarity === 'white' ? null : 'white'; applyFilter(); }),
      chip('蓝', invFilter.rarity === 'blue', () => { invFilter.rarity = invFilter.rarity === 'blue' ? null : 'blue'; applyFilter(); }),
      chip('金', invFilter.rarity === 'gold', () => { invFilter.rarity = invFilter.rarity === 'gold' ? null : 'gold'; applyFilter(); })
    ]));
    box.appendChild(group('T阶', [1, 2, 3, 4, 5].map(t =>
      chip('T' + t, invFilter.tier === t, () => { invFilter.tier = invFilter.tier === t ? null : t; applyFilter(); })
    )));
    box.appendChild(group('锁定', [
      chip('🔒 已锁', invFilter.lock === 'locked', () => { invFilter.lock = invFilter.lock === 'locked' ? null : 'locked'; applyFilter(); }),
      chip('未锁', invFilter.lock === 'unlocked', () => { invFilter.lock = invFilter.lock === 'unlocked' ? null : 'unlocked'; applyFilter(); })
    ]));
    box.appendChild(chip('重置', false, () => { invFilter = { rarity: null, tier: null, lock: null }; applyFilter(); }));
  }
  // 工具栏：计数 / 全选(清空) / 批量分解
  function renderInvToolbar() {
    const filtered = getFilteredInventory();
    $('inv-count').textContent = `筛选 ${filtered.length} / 共 ${getInventory().length} 件`;
    const selCount = [...selectedEqIds].filter(id => getInventory().some(e => e.id === id)).length;
    const btn = $('btn-salvage-selected');
    btn.textContent = `批量分解（${selCount}）`;
    btn.disabled = selCount === 0;
    $('btn-select-all').textContent = selCount > 0 ? '清空' : '全选';
    $('btn-select-all').onclick = () => {
      if (selCount > 0) {
        selectedEqIds.clear();
      } else {
        for (const eq of filtered) if (!eq.locked) selectedEqIds.add(eq.id); // 锁定装备不选
      }
      renderInventory();
      renderInvToolbar();
    };
    btn.onclick = openBatchSalvagePanel;
  }

  /* ---------- 背包（穿装备 / 孵化宠物蛋 / 多选批量分解） ---------- */
  function renderInventory() {
    const list = $('inv-list');
    list.innerHTML = '';

    const eggs = getEggCount();
    if (eggs > 0) {
      const egg = document.createElement('div');
      egg.className = 'inv-item';
      egg.innerHTML = `<div class="info"><div class="ename">🥚 宠物蛋 ×${eggs}</div><div class="edesc">${UI.isLoggedIn() ? '孵化出新的宠物伙伴' : '登录后才能孵化'}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn-sm alt';
      btn.textContent = UI.isLoggedIn() ? '孵化' : '🔒 登录后孵化';
      btn.disabled = !UI.isLoggedIn();
      btn.onclick = async () => {
        const res = await hatchEgg();
        if (!res) return;
        if (res.error) { showToast('❌ 无法孵化', res.error); return; }
        addLog(`🐣 孵化成功！获得新宠物 ${res.baby.name}（成长值 ${res.baby.growth}）！`);
        showToast('🐣 孵化成功！', `${res.baby.icon} ${res.baby.name}｜成长值 ${res.baby.growth}｜已出战`);
        if (res.saveError) addLog('⚠️ 云端存档失败，宠物仅保存在本地');
        UI.renderAll();
      };
      egg.appendChild(btn);
      list.appendChild(egg);
    }

    const pet = getActivePet();
    const filtered = getFilteredInventory();
    const grid = document.createElement('div');
    grid.className = 'equip-grid';
    for (const eq of filtered) {
      if (!eq || typeof eq !== 'object') continue; // 兜底：跳过空/异常项
      // 稀有度/基底兜底（旧数据可能缺字段），避免渲染 undefined
      const r = (eq.rarity && eq.rarity.id) ? eq.rarity : { id: 'white', label: '白色', color: '#b2aa9c' };
      const b = (eq.base && eq.base.label) ? eq.base : { type: 'atk', label: '攻击', value: 0 };
      const card = document.createElement('div');
      const selected = selectedEqIds.has(eq.id);
      const craftSelected = UI.getActiveCraftEqId && UI.getActiveCraftEqId() === eq.id;
      card.className = 'equip-card' + (eq.locked ? ' locked' : '') + (selected ? ' selected' : '') + (craftSelected ? ' craft-selected' : '');
      card.innerHTML = `
        <div class="ec-name" style="color:${r.color}">
          ${eq.fresh ? '<span class="eq-new">新</span>' : ''}${escapeHtml(eq.name || '未知装备')}${eq.locked ? '<span class="eq-lock">🔒</span>' : ''}
        </div>
        <div class="ec-meta">${r.label}装 · T${eq.tier ?? 4}</div>
        <div class="ec-slot">${eq.slot || '武器'}｜${b.label}+${b.value}</div>`;
      const tip = document.createElement('div');
      tip.className = 'equip-tip';
      tip.innerHTML = buildEquipTip(eq);
      card.appendChild(tip);
      card.onclick = () => {
        if (eq.locked) {
          showToast('🔒 已锁定', '锁定装备不能分解，先点 🔓 解锁');
          return;
        }
        if (selectedEqIds.has(eq.id)) selectedEqIds.delete(eq.id);
        else {
          selectedEqIds.add(eq.id);
          if (eq.fresh) eq.fresh = false;
        }
        renderInventory();
        renderInvToolbar();
      };

      const actions = document.createElement('div');
      actions.className = 'ec-actions';
      const btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = '穿上';
      btn.onclick = (e) => {
        e.stopPropagation();
        const res = equipItem(pet, eq.id);
        if (res) {
          addLog(`⚔️ ${pet.name} 装备了 ${res.equipped.name}（${describeItem(res.equipped)}）`);
          UI.renderAll();
        }
      };
      actions.appendChild(btn);
      if (UI.isLoggedIn() && eq.cloudId && !Market.isItemListed(eq.cloudId)) {
        const craftBtn = document.createElement('button');
        craftBtn.className = 'btn-sm craft';
        craftBtn.textContent = '打造';
        craftBtn.onclick = (e) => {
          e.stopPropagation();
          UI.openCraftPanel(eq);
        };
        actions.appendChild(craftBtn);
        // 上架直达：跳市场页并自动展开该装备的上架表单（复用市场页现有逻辑）
        const sellBtn = document.createElement('button');
        sellBtn.className = 'btn-sm alt';
        sellBtn.textContent = '上架';
        sellBtn.onclick = (e) => {
          e.stopPropagation();
          UI.openSellForItem(eq);
        };
        actions.appendChild(sellBtn);
      }
      const lockBtn = document.createElement('button');
      lockBtn.className = 'btn-sm lock' + (eq.locked ? ' on' : '');
      lockBtn.textContent = eq.locked ? '🔒' : '🔓';
      lockBtn.title = eq.locked ? '已锁定（分解跳过）' : '锁定（防分解）';
      lockBtn.onclick = async (e) => {
        e.stopPropagation();
        await Salvage.toggleLock(eq);
        UI.renderAll();
      };
      actions.appendChild(lockBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    }
    list.appendChild(grid);

    if (eggs === 0 && getInventory().length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '背包空空如也，去刷图吧';
      list.appendChild(empty);
    } else if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '没有符合筛选条件的装备（点「重置」查看全部）';
      list.appendChild(empty);
    }
  }

  /* ---------- 一键分解（确认框 → 执行） ---------- */
  function openSalvagePanel() {
    try {
      const body = $('salvage-body');
      const preview = Salvage.getSalvagePreview();
      if (!preview.count) {
        showToast('🗑 无可分解装备', '背包里没有可分解的装备（已锁定/在售的会被跳过）');
        return;
      }
      const S = Config.salvage;
      const line = (label, n) => n ? `<div>${label} ×<b>${n}</b></div>` : '';
      const gainHtml = Object.entries(preview.gains || {}).map(([k, n]) =>
        line(`${Config.craft[k]?.icon || ''} ${Config.craft[k]?.name || k}`, n)
      ).join('') || '<div class="hint">无材料产出（白装分解无产出）</div>';
      body.innerHTML = `
        <div class="salvage-count">将分解 <b>${preview.count}</b> 件装备</div>
        <div class="salvage-detail">
          <div>白装 ${preview.byRarity.white} 件 ｜ 蓝装 ${preview.byRarity.blue} 件 ｜ 金装 ${preview.byRarity.gold} 件</div>
        </div>
        <div class="salvage-gain">预计获得：</div>
        <div class="salvage-detail">
          ${gainHtml}
        </div>
        <div class="salvage-warn">⚠️ 已锁定装备不会被分解</div>`;
      $('salvage-modal').style.display = 'flex';
      $('salvage-ok').onclick = async () => {
        const res = await Salvage.salvageAll();
        closeSalvagePanel();
        if (res.error) { showToast('❌ 分解失败', res.error); return; }
        const parts = [`分解了 ${res.count} 件装备`];
        for (const [k, n] of Object.entries(res.gains || {})) parts.push(`${Config.craft[k]?.name || k} ×${n}`);
        addLog(`🗑 一键分解：${parts.join('，')}`);
        showToast('🗑 分解完成', parts.join('<br>'));
        if (UI.showDialog) UI.showDialog({ icon: '🗑', speaker: '分解', text: parts.join('<br>') });
        if (res.cloudError) addLog('⚠️ 部分云端装备删除失败，刷新后可能重新出现');
        UI.renderAll();
      };
    } catch (err) {
      console.error('打开分解面板出错：', err);
      showToast('⚠️ 分解面板出错', (err && err.message) || String(err));
    }
  }
  function closeSalvagePanel() {
    $('salvage-modal').style.display = 'none';
  }

  /* ---------- 批量分解确认框（多选装备 → 预览 → 确认） ---------- */
  function openBatchSalvagePanel() {
    const targets = getInventory().filter(e => selectedEqIds.has(e.id));
    if (!targets.length) {
      showToast('⚠️ 未选择装备', '先点选要分解的装备（锁定装备不可选）');
      return;
    }
    const preview = Salvage.previewEquips(targets);
    const line = (label, n) => n ? `<div>${label} ×<b>${n}</b></div>` : '';
    const gainHtml = Object.entries(preview.gains || {}).map(([k, n]) =>
      line(`${Config.craft[k]?.icon || ''} ${Config.craft[k]?.name || k}`, n)
    ).join('') || '<div class="hint">无材料产出（白装分解无产出）</div>';
    $('salvage-body').innerHTML = `
      <div class="salvage-count">将分解 <b>${preview.count}</b> 件装备${preview.skipped ? `（已锁定 ${preview.skipped} 件跳过）` : ''}</div>
      <div class="salvage-detail">
        <div>白装 ${preview.byRarity.white} 件 ｜ 蓝装 ${preview.byRarity.blue} 件 ｜ 金装 ${preview.byRarity.gold} 件</div>
      </div>
      <div class="salvage-gain">预计获得：</div>
      <div class="salvage-detail">
        ${gainHtml}
      </div>
      <div class="salvage-warn">⚠️ 已锁定装备不会被分解</div>`;
    $('salvage-modal').style.display = 'flex';
    $('salvage-ok').onclick = async () => {
      $('salvage-modal').style.display = 'none';
      const res = await Salvage.salvageList(targets);
      if (res.error) { showToast('❌ 分解失败', res.error); return; }
      const parts = [`分解了 ${res.count} 件装备`];
      for (const [k, n] of Object.entries(res.gains || {})) parts.push(`${Config.craft[k]?.name || k} ×${n}`);
      if (res.skipped) parts.push(`跳过 ${res.skipped} 件锁定`);
      addLog(`🗑 批量分解：${parts.join('，')}`);
      showToast('🗑 分解完成', parts.join('<br>'));
      if (UI.showDialog) UI.showDialog({ icon: '🗑', speaker: '分解', text: parts.join('<br>') });
      selectedEqIds.clear();
      UI.renderAll();
    };
  }

  // 装备详情浮层内容：按“等级 / 基底词缀 / 前缀 / 后缀”分段展示
  function buildEquipTip(eq) {
    const affixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(eq.affixes) : (eq.affixes || { prefix: [], suffix: [] });
    const prefix = affixes.prefix || [];
    const suffix = affixes.suffix || [];
    const r = (eq.rarity && eq.rarity.id) ? eq.rarity : { id: 'white', label: '白色', color: '#b2aa9c' };
    const b = (eq.base && eq.base.label) ? eq.base : { type: 'atk', label: '攻击', value: 0 };
    const itemLevel = eq.level ?? eq.itemLevel ?? eq.areaTier ?? 1;
    const line = (a, cls) => a.map(x => `<div class="${cls}">${escapeHtml((x && x.label) || '?')} +${x ? (x.value || 0) : 0}${['hit', 'dodge', 'spd'].includes(x && x.type) ? '' : '%'} <span class="tip-tier">T${x ? (x.tier || '?') : '?'}</span></div>`).join('') || '<div class="tip-empty">无</div>';
    return `
      <div class="tip-name" style="color:${r.color}">${escapeHtml(eq.name || '未知装备')}</div>
      <div class="tip-line">等级：<b>${itemLevel}</b></div>
      <div class="tip-section">基底词缀</div>
      <div class="tip-base">${escapeHtml(b.label)} +${b.value} <span class="tip-tier">T${eq.materialTier ?? eq.tier ?? 4}</span></div>
      <div class="tip-section">前缀</div>
      ${line(prefix, 'tip-prefix')}
      <div class="tip-section">后缀</div>
      ${line(suffix, 'tip-suffix')}`;
  }

  /* ---------- 对外 API（装备页） ---------- */
  UI.renderInvFilter = renderInvFilter;
  UI.renderInvToolbar = renderInvToolbar;
  UI.renderInventory = renderInventory;
  UI.openSalvagePanel = openSalvagePanel;
  UI.closeSalvagePanel = closeSalvagePanel;
  UI.openBatchSalvagePanel = openBatchSalvagePanel;
})();
