/* ============================================================
 * ui/ui-equipment.js —— 装备页 UI（背包 / 筛选 / 多选 / 分解）
 * 职责：
 *  1. 背包渲染（穿装备 / 多选批量分解 / 锁定）
 *  2. 筛选栏（稀有度 / T 阶 / 锁定）与工具栏（计数 / 全选 / 批量分解）
 *  3. 一键分解确认框 + 批量分解确认框
 *  4. 装备详情浮层（前后缀分组）
 * 依赖：equipment / market / salvage（只读查询与流程接口）；通用组件来自 ui-common
 * 注：打造按钮点击后调用 ui-craft 的 UI.openCraftPanel（跨文件走公共命名空间）
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const { getActivePet } = window.Pet;
  const { getInventory, equipItem, describeItem, scoreOf } = window.Equipment;
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

  /* ---------- 背包（穿装备 / 多选批量分解） ---------- */
  function renderInventory() {
    const list = $('inv-list');
    list.innerHTML = '';

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
      card.className = 'equip-card' + (eq.locked ? ' locked' : '') + (selected ? ' selected' : '');
      // 卡片也显示词缀（含 roll 区间）：POE 式卡片 = 名字 + 词缀行列表
      const affRows = (window.Equipment.flattenAffixes ? window.Equipment.flattenAffixes(eq.affixes) : [])
        .filter(a => !a.base)
        .map(a => window.Equipment.formatAffixHtml(a, 'tip-affix'))
        .join('');
      card.innerHTML = `
        <div class="ec-name" style="color:${r.color}">
          ${eq.fresh ? '<span class="eq-new">新</span>' : ''}${escapeHtml(eq.name || '未知装备')}${eq.locked ? '<span class="eq-lock">🔒</span>' : ''}
        </div>
        <div class="ec-meta">${r.label}装 · T${eq.tier ?? 4}</div>
        <div class="ec-slot">${eq.slot || '武器'}｜${b.label}+${b.value}</div>
        <div class="ec-affixes">${affRows || '<div class="tip-empty">无词缀</div>'}</div>`;
      const tip = document.createElement('div');
      tip.className = 'equip-tip';
      tip.innerHTML = buildEquipTip(eq, pet); // 传 pet：详情里要算「换上这件」相对身上装备的属性增减
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
        // 差异必须在换装【之前】算：换完之后候选装备已经上身，再比对就是 0 了
        const changes = equipDeltas(pet, eq);
        const res = equipItem(pet, eq.id);
        if (res) {
          addLog(`⚔️ ${pet.name} 装备了 ${res.equipped.name}（${describeItem(res.equipped)}）`);
          if (changes.length) showToast('⚔️ 换装完成', changes.map(c => `${c.label} ${fmtDelta(c)}`).join('　'));
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

    if (getInventory().length === 0) {
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

  /* ---------- 一键清理（按评分阈值，确认框 → 执行） ----------
   * 以前「一键分解」= 清空全部可分解装备，好东西也一起没了，玩家根本不敢点。
   * 装备有评分之后改成按分数清理：低于阈值才分解，并且自动保护
   * 已锁定 / 在售 / 比身上穿得好的，玩家可以放心一键减负。
   */
  function openSalvagePanel() {
    try {
      const body = $('salvage-body');
      const inv = getInventory();
      if (!inv.length) { showToast('🗑 背包没有装备', '去战斗页刷点掉落吧'); return; }
      // 默认阈值 = 背包评分中位数：清理垫底的一半，保守不误杀
      const sorted = inv.map(scoreOf).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      const gainLine = (gains) => Object.entries(gains || {}).map(([k, n]) =>
        `<div>${Config.craft[k]?.icon || ''} ${Config.craft[k]?.name || k} ×<b>${n}</b></div>`
      ).join('') || '<div class="hint">无材料产出（白装分解无产出）</div>';

      body.innerHTML = `
        <div class="salvage-count">按评分清理</div>
        <div class="salvage-detail">
          <label class="salvage-th-row">
            <span>清理低于</span>
            <input id="salvage-threshold" type="number" min="0" step="1" value="${median}" class="salvage-th-input">
            <span>分的装备</span>
          </label>
          <div class="hint">背包评分范围 ${sorted[0]} ~ ${sorted[sorted.length - 1]}（默认取中位数 ${median} = 清掉垫底一半）</div>
        </div>
        <div id="salvage-preview" class="salvage-detail"></div>
        <div class="salvage-warn">⚠️ 已锁定 / 在售 / 比身上穿得好的装备会自动保留</div>`;

      const renderPreview = () => {
        const th = Number($('salvage-threshold').value);
        const targets = Salvage.belowThreshold(Number.isFinite(th) ? th : 0);
        const pv = Salvage.previewEquips(targets);
        const box = $('salvage-preview');
        if (!box) return;
        box.innerHTML = pv.count
          ? `<div>将分解 <b>${pv.count}</b> 件：白 ${pv.byRarity.white} ｜ 蓝 ${pv.byRarity.blue} ｜ 金 ${pv.byRarity.gold}</div>
             <div class="salvage-gain">预计获得：</div>${gainLine(pv.gains)}`
          : '<div class="hint">这个阈值下没有可清理的装备（好装备都被保护了）</div>';
      };
      $('salvage-threshold').oninput = renderPreview;
      renderPreview();

      $('salvage-modal').style.display = 'flex';
      $('salvage-ok').onclick = async () => {
        const th = Number($('salvage-threshold').value);
        const res = await Salvage.salvageBelow(Number.isFinite(th) ? th : 0);
        closeSalvagePanel();
        if (res.error) { showToast('❌ 分解失败', res.error); return; }
        const parts = [`清理了 ${res.count} 件装备（低于 ${res.threshold} 分）`];
        for (const [k, n] of Object.entries(res.gains || {})) parts.push(`${Config.craft[k]?.name || k} ×${n}`);
        addLog(`🗑 一键清理：${parts.join('，')}`);
        showToast('🗑 清理完成', parts.join('<br>'));
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

  /* ---------- 换装属性对比 ----------
   * 玩家痛点：背包里一堆装备，单看一件看不出「换上去人是变强还是变弱」，只能凭感觉穿。
   * 做法：浅拷贝一只宠物、把候选装备放进对应部位，走 Pet.getStats（与战斗同源，
   *   含 atk%/hp%/def% 百分比词缀对裸属性的换算），再与当前身上的最终属性逐项比对。
   *   —— 只读试穿，不改动任何真实装备/宠物状态，也不会触发云端同步。
   * 明确不展示评分：评分只用于背包排序与批量清理，不参与战斗，混进属性对比只会误导。
   */
  const CMP_FIELDS = [
    { key: 'atk',        label: '攻击',     scale: 1,   unit: '',  digits: 0 },
    { key: 'hp',         label: '生命',     scale: 1,   unit: '',  digits: 0 },
    { key: 'def',        label: '防御',     scale: 1,   unit: '',  digits: 0 },
    { key: 'spd',        label: '速度',     scale: 1,   unit: '',  digits: 0 },
    { key: 'critRate',   label: '暴击率',   scale: 100, unit: '%', digits: 1 },
    { key: 'critDamage', label: '暴击伤害', scale: 100, unit: '%', digits: 0 },
    { key: 'hit',        label: '命中',     scale: 1,   unit: '',  digits: 0 },
    { key: 'dodge',      label: '闪避',     scale: 1,   unit: '',  digits: 0 },
    { key: 'lifesteal',  label: '吸血',     scale: 100, unit: '%', digits: 0 }
  ];
  // 试穿候选装备后的最终属性（浅拷贝，不碰真实状态）
  function previewStatsWith(pet, eq) {
    if (!pet || !eq || !window.Pet || !window.Pet.getStats) return null;
    try {
      const clone = Object.assign({}, pet);
      clone.equipment = Object.assign({}, pet.equipment || {}, { [eq.slot]: eq });
      return window.Pet.getStats(clone);
    } catch (e) { return null; } // 脏数据兜底：算不出来就不显示对比，不能让背包渲染挂掉
  }
  // 返回有变化的属性项 [{label, delta, unit, digits}]
  function equipDeltas(pet, eq) {
    if (!pet || !eq) return [];
    const before = window.Pet.getStats(pet), after = previewStatsWith(pet, eq);
    if (!before || !after) return [];
    const out = [];
    for (const f of CMP_FIELDS) {
      const d = ((after[f.key] || 0) - (before[f.key] || 0)) * f.scale;
      if (Math.abs(d) < 0.05) continue; // 浮点误差当无变化
      out.push({ label: f.label, delta: d, unit: f.unit || '', digits: f.digits || 0 });
    }
    return out;
  }
  function fmtDelta(c) {
    const v = Math.abs(c.delta).toFixed(c.digits).replace(/\.0+$/, '');
    return `${c.delta > 0 ? '+' : '−'}${v}${c.unit}`;
  }
  function buildEquipCompare(pet, eq) {
    if (!pet || !eq) return '';
    const rows = equipDeltas(pet, eq);
    if (!rows.length) return '<div class="tip-section">对比身上装备</div><div class="tip-empty">属性无变化</div>';
    const html = rows.map(c =>
      `<div class="tip-line" style="color:${c.delta > 0 ? '#5fd18b' : '#e0726f'}">${c.label} ${fmtDelta(c)}</div>`
    ).join('');
    return `<div class="tip-section">对比身上装备</div>${html}`;
  }

  // 装备详情浮层内容：按“等级 / 基底词缀 / 前缀 / 后缀 / 对比身上装备”分段展示
  function buildEquipTip(eq, pet) {
    const affixes = window.Equipment.normalizeAffixes ? window.Equipment.normalizeAffixes(eq.affixes) : (eq.affixes || { prefix: [], suffix: [] });
    const prefix = affixes.prefix || [];
    const suffix = affixes.suffix || [];
    const r = (eq.rarity && eq.rarity.id) ? eq.rarity : { id: 'white', label: '白色', color: '#b2aa9c' };
    const b = (eq.base && eq.base.label) ? eq.base : { type: 'atk', label: '攻击', value: 0 };
    const itemLevel = eq.level ?? eq.itemLevel ?? eq.areaTier ?? 1;
    // 词缀行统一走 Equipment.formatAffixHtml（POE 式：label +值 (该T阶区间 min~max)，T1/满roll 金色）
    const line = (a, cls) => a.map(x => window.Equipment.formatAffixHtml(x, cls)).join('') || '<div class="tip-empty">无</div>';
    return `
      <div class="tip-name" style="color:${r.color}">${escapeHtml(eq.name || '未知装备')}</div>
      <div class="tip-line">等级：<b>${itemLevel}</b></div>
      <div class="tip-section">基底词缀</div>
      <div class="tip-base">${escapeHtml(b.label)} +${b.value} <span class="tip-tier">T${eq.materialTier ?? eq.tier ?? 4}</span></div>
      <div class="tip-section">前缀</div>
      ${line(prefix, 'tip-prefix')}
      <div class="tip-section">后缀</div>
      ${line(suffix, 'tip-suffix')}
      ${eq.soulAffix ? '<div class="tip-section">魂铸</div><div class="tip-soul" style="color:#c9a86a">' + (eq.soulAffix.label || '') + (eq.soulAffix.tier ? ' T' + eq.soulAffix.tier : '') + (eq.soulAffix.value != null ? ' +' + eq.soulAffix.value + (['hit','dodge','spd'].includes(eq.soulAffix.type) ? '' : '%') : '') + '</div>' : ''}
      ${buildEquipCompare(pet, eq)}`;
  }

  /* ---------- 对外 API（装备页） ---------- */
  UI.renderInvFilter = renderInvFilter;
  UI.renderInvToolbar = renderInvToolbar;
  UI.renderInventory = renderInventory;
  UI.openSalvagePanel = openSalvagePanel;
  UI.closeSalvagePanel = closeSalvagePanel;
  UI.openBatchSalvagePanel = openBatchSalvagePanel;
})();
