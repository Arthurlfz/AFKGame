/* ============================================================
 * ui/ui-equipment.js —— 装备页 UI（背包 / 筛选 / 多选 / 分解）
 * 职责：
 *  1. 背包渲染（穿装备 / 多选批量分解 / 锁定）
 *  2. 筛选栏（稀有度 / T 阶 / 锁定）与工具栏（计数 / 全选 / 批量分解）
 *  3. 一键分解确认框 + 批量分解确认框
 *  4. 装备详情浮层（前后缀分组）
 * 依赖：equipment / market / salvage（只读查询与流程接口）；通用组件来自 ui-common
 * ⚠️ 2026-09-14 更正：旧注释写着「打造按钮点击后调用 ui-craft 的 openCraftPanel」——
 *    本文件里【没有】这个调用，打造走的是右侧详情面板里的 UI.renderCraftInto（注释在说假话，已删）。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $, showToast, addLog } = UI;

  const Config = window.Config;
  const { getActivePet } = window.Pet;
  const { getInventory, equipItem, describeItem, scoreOf } = window.Equipment;
  const Materials = window.Materials;
  const Salvage = window.Salvage;

  /* ---------- 装备筛选 + 多选（仅装备页，不影响数据结构） ----------
   * 2026-09-14 改版（用户拍板「跟宠物页对齐」）：
   *   旧版只有 稀有度 / T阶 / 锁定 三组；那组「T阶」筛的其实是**底材 T**（eq.tier = materialTier），
   *   而页面上每件装备又都标着词缀的 T → 名不对实，看着像 bug；且缺「部位」「未鉴定」这两个天天要用的维度。
   *   现在与宠物页换装背包同一套口径：部位 / 稀有度 / 底材T / 词缀T / 词缀类型 / 鉴定 / 锁定。
   * 控件分工：选项多的（部位 12 / 词缀T 5 / 词缀类型 8+）走下拉，选项少的走 chip。 */
  let invFilter = { slot: 'all', rarity: null, baseTier: null, affixTier: 'all', affixType: 'all', ident: null, lock: null };
  let selectedEqIds = new Set(); // 选中的装备本地 id（只由角上的勾选框改，点卡片不再误选）
  let activeEqId = null; // 右侧详情面板当前聚焦的装备 id（主从式 2026-09-04）
  let invRenderSig = ''; // 内容签名：没变就不重建 DOM（装备页挂在 renderAll 里，每秒会调一次 → 旧写法每秒重建卡片，点着卡）

  const highestAffixTier = eq => {
    let best = Infinity;
    for (const a of window.Equipment.flattenAffixes(eq.affixes)) best = Math.min(best, a.tier || 5);
    return best === Infinity ? 5 : best;
  };
  const hasAffixType = (eq, type) => window.Equipment.flattenAffixes(eq.affixes).some(a => a.type === type);

  // 按当前筛选条件过滤背包（所有分支都做字段兜底：旧数据可能缺 rarity/affixes）
  function getFilteredInventory() {
    const F = invFilter;
    return getInventory().filter(eq => {
      if (!eq) return false;
      if (F.slot !== 'all' && eq.slot !== F.slot) return false;
      if (F.rarity && (!eq.rarity || eq.rarity.id !== F.rarity)) return false;
      if (F.baseTier != null && Number(eq.materialTier != null ? eq.materialTier : eq.tier) !== Number(F.baseTier)) return false;
      if (F.affixTier !== 'all' && highestAffixTier(eq) > Number(F.affixTier)) return false;
      if (F.affixType !== 'all' && !hasAffixType(eq, F.affixType)) return false;
      if (F.ident === 'unid' && eq.identified !== false) return false;
      if (F.ident === 'id' && eq.identified === false) return false;
      if (F.lock && (F.lock === 'locked' ? !eq.locked : !!eq.locked)) return false;
      return true;
    });
  }
  /* 把「哪个 chip 是选中的」就地同步（**不重建 DOM**，保留焦点、不闪）。
   * 为什么必须有这一步：点 chip 只改了 invFilter 状态，如果不同步，chip 的 .active
   * 要等下一次 renderAll（挂机时每秒一次）才更新 —— 表现就是「点 T4 亮一下又跳回 T5 高亮」。
   * 每个 chip/select 上都挂了 data-fk（状态字段）；值从 invFilter 现场读，不存第二份。 */
  function syncFilterUI() {
    const box = $('inv-filter');
    if (!box || typeof box.querySelectorAll !== 'function') return;
    box.querySelectorAll('.f-chip').forEach(b => {
      const k = b.dataset ? b.dataset.fk : null;
      if (!k) return;
      b.classList.toggle('active', invFilter[k] != null && String(invFilter[k]) === String(b.dataset.fv));
    });
    box.querySelectorAll('.f-select').forEach(s => {
      const k = s.dataset ? s.dataset.fk : null;
      if (k) s.value = invFilter[k] == null ? 'all' : String(invFilter[k]);
    });
  }
  function applyFilter() {
    invRenderSig = ''; // 筛选变了必须重建列表
    syncFilterUI();    // 筛选条自身的选中态也要立刻跟上
    renderInventory();
    renderInvToolbar();
  }
  // 筛选栏（部位 / 稀有度 / 底材T / 词缀T / 词缀类型 / 鉴定 / 锁定 / 重置）
  function renderInvFilter() {
    const box = $('inv-filter');
    if (!box) return;
    box.innerHTML = '';
    // 每个控件都带上「它代表哪个状态字段 + 值」→ 选中态由 syncFilterUI 从 invFilter 现场算，不存第二份
    const chip = (key, value, text, onClick) => {
      const b = document.createElement('button');
      b.className = 'f-chip';
      if (key) { b.dataset.fk = key; b.dataset.fv = String(value); }
      b.innerHTML = text;
      b.onclick = onClick;
      return b;
    };
    const toggle = (key, value) => () => {
      invFilter[key] = invFilter[key] === value ? null : value;
      applyFilter();
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
    const sel = (key, label, options, onChange) => {
      const wrap = document.createElement('div');
      wrap.className = 'f-group';
      const l = document.createElement('span');
      l.className = 'f-label';
      l.textContent = label;
      wrap.appendChild(l);
      const s = document.createElement('select');
      s.className = 'f-select';
      s.dataset.fk = key;
      for (const [v, t] of options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        s.appendChild(o);
      }
      s.onchange = () => onChange(s.value);
      wrap.appendChild(s);
      return wrap;
    };
    const SLOTS = window.Equipment.SLOTS || [];
    const POOL = window.Equipment.AFFIX_POOL || [];
    box.appendChild(sel('slot', '部位', [['all', '部位全部']].concat(SLOTS.map(s => [s, s])),
      v => { invFilter.slot = v; applyFilter(); }));
    box.appendChild(group('稀有度', [
      chip('rarity', 'white', '白', toggle('rarity', 'white')),
      chip('rarity', 'blue', '蓝', toggle('rarity', 'blue')),
      chip('rarity', 'gold', '金', toggle('rarity', 'gold'))
    ]));
    box.appendChild(group('底材T', [1, 2, 3, 4, 5].map(t =>
      chip('baseTier', t, 'T' + t, toggle('baseTier', t))
    )));
    box.appendChild(sel('affixTier', '词缀T', [['all', '词缀全部']].concat([1, 2, 3, 4, 5].map(t => [String(t), '含 T' + t])),
      v => { invFilter.affixTier = v; applyFilter(); }));
    box.appendChild(sel('affixType', '词缀类型', [['all', '类型全部']].concat(POOL.map(a => [a.type, a.label])),
      v => { invFilter.affixType = v; applyFilter(); }));
    box.appendChild(group('鉴定', [
      chip('ident', 'unid', '未鉴定', toggle('ident', 'unid')),
      chip('ident', 'id', '已鉴定', toggle('ident', 'id'))
    ]));
    box.appendChild(group('锁定', [
      chip('lock', 'locked', '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 已锁', toggle('lock', 'locked')),
      chip('lock', 'unlocked', '未锁', toggle('lock', 'unlocked'))
    ]));
    box.appendChild(chip(null, null, '重置', () => {
      invFilter = { slot: 'all', rarity: null, baseTier: null, affixTier: 'all', affixType: 'all', ident: null, lock: null };
      applyFilter();
    }));
    syncFilterUI(); // 初始选中态与 invFilter 对齐（唯一真源）
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
    // 「一键清理」= 按评分阈值清理（会保护锁定/在售/比身上好的），入口以前一直没接上，
    // 玩家只能用「批量分解」或背包里的快捷键 —— 后者当时还没有确认框。
    const autoBtn = $('btn-salvage-auto');
    if (autoBtn) autoBtn.onclick = openSalvagePanel;
  }

  /* ---------- 背包（穿装备 / 多选批量分解） ---------- */
  // 内容签名：装备页挂在 renderAll 里（挂机时每秒被调一次），内容没变就别重建 DOM，
  // 否则「切筛选/点卡片」时会跟每秒的重建互相打架 —— 表现就是用户说的"卡呼呼的"。
  function invSig(filtered) {
    return filtered.map(e => e.id + (e.locked ? 'L' : '') + (e.fresh ? 'F' : '') + (e.identified === false ? 'U' : '') + (e.soulAffix ? 'S' : '')).join(',')
      + '|a' + activeEqId + '|s' + [...selectedEqIds].sort().join(',') + '|n' + getInventory().length;
  }
  function renderInventory() {
    const list = $('inv-list');
    if (!list) return;
    const pet = getActivePet();
    const filtered = getFilteredInventory();
    const sig = invSig(filtered);
    if (sig === invRenderSig && list.firstChild) return; // 一模一样 → 不重建
    invRenderSig = sig;
    // 滚动容器在上一级（⚠️ 测试桩没有 .closest，必须做能力判断，否则测试集体在渲染期抛错）
    const scroller = (typeof list.closest === 'function' ? list.closest('.ew-col') : null) || list.parentElement;
    const keepScroll = scroller ? scroller.scrollTop : 0;
    list.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'equip-grid';
    for (const eq of filtered) {
      if (!eq || typeof eq !== 'object') continue; // 兜底：跳过空/异常项
      // 稀有度/基底兜底（旧数据可能缺字段），避免渲染 undefined
      const r = (eq.rarity && eq.rarity.id) ? eq.rarity : { id: 'white', label: '白色', color: '#b2aa9c' };
      const b = (eq.base && eq.base.label) ? eq.base : { type: 'atk', label: '攻击', value: 0 };
      const card = document.createElement('div');
      const unid = eq.identified === false; // 未鉴定：词缀封印，鉴定石揭晓
      const selected = selectedEqIds.has(eq.id);
      const active = activeEqId === eq.id;
      card.className = 'equip-card' + (eq.locked ? ' locked' : '') + (selected ? ' selected' : '') + (active ? ' active' : '') + (unid ? ' q-unid' : '');
      // 卡片只显示核心信息；详情与打造统一进右侧面板（2026-09-04 主从式，去掉 hover 浮层）
      const affRows = unid
        ? '<div class="ec-unid"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 未鉴定 · 词缀封印</div>'
        : (window.Equipment.flattenAffixes ? window.Equipment.flattenAffixes(eq.affixes) : [])
          .filter(a => !a.base)
          .map(a => window.Equipment.formatAffixHtml(a, 'tip-affix'))
          .join('');
      card.innerHTML = `
        <div class="ec-name" style="color:${r.color}">
          ${eq.fresh ? '<span class="eq-new">新</span>' : ''}${escapeHtml(eq.name || '未知装备')}${eq.locked ? '<span class="eq-lock"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>' : ''}
        </div>
        <div class="ec-meta">${r.label}装 · 底材T${eq.materialTier ?? eq.tier ?? 4}</div>
        <div class="ec-slot">${eq.slot || '武器'}｜${b.label}+${b.value}</div>
        <div class="ec-affixes">${affRows || '<div class="tip-empty">无词缀</div>'}</div>`;
      // 选择角标（多选只走这里；点卡片本身 = 只看详情）
      const selBox = document.createElement('div');
      selBox.className = 'ec-sel' + (selected ? ' on' : '') + (eq.locked ? ' off' : '');
      selBox.title = eq.locked ? '已锁定（不参与批量分解）' : (selected ? '取消选中' : '选中用于批量分解');
      selBox.onclick = (e) => {
        e.stopPropagation();
        if (eq.locked) { showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 已锁定', '锁定装备不参与批量分解'); return; }
        if (selectedEqIds.has(eq.id)) selectedEqIds.delete(eq.id);
        else selectedEqIds.add(eq.id);
        activeEqId = eq.id;
        renderInventory();
        renderInvToolbar();
      };
      card.appendChild(selBox);
      card.onclick = () => {
        /* 2026-09-14 改：点卡片 = 只看详情。
         * 旧写法顺带把装备塞进「批量分解」的选中集（再点取消）→ 玩家"点一下看看"就变成了待分解，
         * 再点批量分解就真分解了（锁定装备之外没有任何保护）= 误分解好装备。 */
        if (eq.fresh) eq.fresh = false;
        activeEqId = eq.id;
        renderInventory();
        renderInvToolbar();
        renderBagEqDetail(eq);
      };

      const actions = document.createElement('div');
      actions.className = 'ec-actions';
      // 快捷穿上保留；打造/上架/详情 → 右侧面板
      const btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = '穿上';
      if (unid) {
        btn.disabled = true;
        btn.title = '未鉴定 · 先用鉴定石揭晓';
      }
      btn.onclick = (e) => {
        e.stopPropagation();
        // 差异必须在换装【之前】算：换完之后候选装备已经上身，再比对就是 0 了
        const changes = equipDeltas(pet, eq);
        const res = equipItem(pet, eq.id);
        if (res) {
          addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ ${pet.name} 装备了 ${res.equipped.name}（${describeItem(res.equipped)}）`);
          if (changes.length) showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg>️ 换装完成', changes.map(c => `${c.label} ${fmtDelta(c)}`).join('　'));
          UI.renderAll();
        }
      };
      actions.appendChild(btn);
      if (unid) {
        const idBtn = document.createElement('button');
        idBtn.className = 'btn-sm id';
        idBtn.innerHTML = '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/></svg> 鉴定';
        idBtn.title = '消耗 1 鉴定石揭晓词缀';
        idBtn.onclick = (e) => { e.stopPropagation(); identifyEq(eq, idBtn); };
        actions.appendChild(idBtn);
      }
      const lockBtn = document.createElement('button');
      lockBtn.className = 'btn-sm lock' + (eq.locked ? ' on' : '');
      lockBtn.innerHTML = eq.locked ? '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
      lockBtn.title = eq.locked ? '已锁定（分解跳过）' : '锁定（防分解）';
      /* 锁定/解锁：toggleLock 内部是「本地先翻转 → 云端同步」（1 趟，~340ms），
       * 但界面要等 await 完才 renderAll —— 这段时间按钮毫无变化。给个即时反馈。 */
      lockBtn.onclick = (e) => {
        e.stopPropagation();
        UI.runWithLoading(lockBtn, '…', async () => {
          await Salvage.toggleLock(eq);
          UI.renderAll();
        });
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
    // 重建后把滚动位置放回去（否则穿上/筛选一次就被弹回顶部，像"跳了一下"）
    if (scroller && keepScroll) scroller.scrollTop = keepScroll;
  }

  /* ---------- 分解确认面板（唯一实现，全项目共用） ----------
   * 分解是【不可逆操作】：拆掉就没了，没有撤销。
   * 2026-09-17 之前这一层根本不存在 —— 背包里的 Ctrl+Enter「全部分解」与
   * Ctrl/Alt+点「快分解」都是点了直接执行，误触（尤其 Ctrl+Enter 在聊天框还是发送键）
   * 就是整包装备永久损失。现在四个入口（一键清理 / 批量分解 / 快捷键 / 单件快分解）
   * 全部走这里，先让玩家看清"要拆几件、能得到什么"再点确认。
   */
  function salvageConfirm(opts) {
    const run = () => { try { return opts.onOk && opts.onOk(); } catch (e) { console.error('[salvage] 执行失败', e); } };
    const modal = $('salvage-modal');
    if (!modal || !$('salvage-body')) {
      // 面板不可用时也不能让玩家无确认就丢装备
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(opts.fallbackText || '确认分解？此操作不可撤销。')) run();
      } else run(); // node / 测试桩：没有 UI 可问，直接执行（测试用）
      return;
    }
    const titleEl = modal.querySelector('.modal-title');
    if (titleEl && opts.title) titleEl.innerHTML = opts.title;
    if (opts.bodyHtml != null) $('salvage-body').innerHTML = opts.bodyHtml;
    if (typeof opts.afterRender === 'function') opts.afterRender();
    const ok = $('salvage-ok');
    const cancel = $('salvage-cancel');
    if (ok) {
      ok.textContent = opts.okLabel || '确认分解';
      ok.onclick = () => { closeSalvagePanel(); run(); };
    }
    // 「取消」以前压根没绑事件 —— 点了没反应，玩家只能刷新页面
    if (cancel) cancel.onclick = closeSalvagePanel;
    modal.style.display = 'flex';
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
      if (!inv.length) { showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 背包没有装备', '去战斗页刷点掉落吧'); return; }
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

      salvageConfirm({
        title: '<img class="eic-img" src="assets/ui/ic_shred.png" alt=""> 一键清理',
        okLabel: '确认清理',
        fallbackText: '确认分解低于 ' + median + ' 分的装备？此操作不可撤销。',
        onOk: async () => {
        const th = Number($('salvage-threshold').value);
        const res = await Salvage.salvageBelow(Number.isFinite(th) ? th : 0);
        if (res.error) { showToast('❌ 分解失败', res.error); return; }
        const parts = [`清理了 ${res.count} 件装备（低于 ${res.threshold} 分）`];
        for (const [k, n] of Object.entries(res.gains || {})) parts.push(`${Config.craft[k]?.name || k} ×${n}`);
        addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 一键清理：${parts.join('，')}`);
        showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 清理完成', parts.join('<br>'));
        UI.renderAll();
        }
      });
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
    salvageConfirm({
      title: '<img class="eic-img" src="assets/ui/ic_shred.png" alt=""> 批量分解',
      okLabel: '确认分解',
      fallbackText: '确认分解选中的 ' + targets.length + ' 件装备？此操作不可撤销。',
      onOk: async () => {
      const res = await Salvage.salvageList(targets);
      if (res.error) { showToast('❌ 分解失败', res.error); return; }
      const parts = [`分解了 ${res.count} 件装备`];
      for (const [k, n] of Object.entries(res.gains || {})) parts.push(`${Config.craft[k]?.name || k} ×${n}`);
      if (res.skipped) parts.push(`跳过 ${res.skipped} 件锁定`);
      addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 批量分解：${parts.join('，')}`);
      showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 分解完成', parts.join('<br>'));
      if (UI.showDialog) UI.showDialog({ icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', speaker: '分解', text: parts.join('<br>') });
      selectedEqIds.clear();
      UI.renderAll();
      }
    });
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
    { key: 'lifesteal',  label: '吸血',     scale: 100, unit: '%', digits: 0 },
    { key: 'pen',        label: '穿透',     scale: 1,   unit: '',  digits: 0 },
    { key: 'dmgBonus',   label: '伤害加成', scale: 1,   unit: '%', digits: 0 },
    { key: 'dr',         label: '受伤减免', scale: 1,   unit: '%', digits: 0 }
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


  /* ---------- 主从式右侧面板：装备详情 + 打造（2026-09-04） ---------- */
  /* ---------- 详情+打造面板（2026-09-04 容器化）
   * renderEqDetailInto(hostEl, eq)：侧边栏装备页 / 背包窗口通用。
   * 容器结构约定：.eq-detail > .eq-detail-empty + .eq-detail-body(.eq-detail-info + .eq-detail-craft)
   */
  function renderEqDetailInto(hostEl, eq) {
    if (!hostEl) return;
    const body = hostEl.querySelector('.eq-detail-body');
    if (!eq || !body) {
      const emptyEl = hostEl.querySelector('.eq-detail-empty');
      if (emptyEl) emptyEl.style.display = '';
      if (body) body.style.display = 'none';
      return;
    }
    const emptyEl = hostEl.querySelector('.eq-detail-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    body.style.display = 'flex';
    hostEl.classList.remove('lock-mode'); // 重置锁定模式（打造区切换时会再设回）
    /* 右栏只留打造（2026-09-07）：属性详情/穿上/上架已移除——
     * 具体属性看物品 tooltip，穿上走列表卡片按钮，上架走市集。 */
    const craftEl = hostEl.querySelector('.eq-detail-craft');
    if (eq.identified === false) {
      // 未鉴定：右侧只给封印信息 + 鉴定入口，不暴露任何词缀/打造
      if (craftEl) {
        const r2 = (eq.rarity && eq.rarity.id) ? eq.rarity : { id: 'white', label: '白色', color: '#b2aa9c' };
        const mt = eq.materialTier ?? eq.tier ?? 4;
        const ilvl = window.Equipment && window.Equipment.ilvlOf ? window.Equipment.ilvlOf(eq) : (eq.ilvl != null ? Number(eq.ilvl) : 100);
        const _gates = (Config.equipment.affixIlvlGates) || {};
        let _maxT = 5;
        for (const _k in _gates) { const _t = Number(_k), _g = Number(_gates[_k]); if (ilvl >= _g && _t < _maxT) _maxT = _t; }
        craftEl.innerHTML =
          '<div class="eq-unid-block">' +
            '<div class="eq-unid-icon"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
            '<div class="eq-unid-name" style="color:' + r2.color + '">' + escapeHtml(eq.name || '未知装备') + '</div>' +
            '<div class="eq-unid-line">未鉴定的 ' + escapeHtml(eq.slot || '装备') + ' · 底材 T' + mt + '</div>' +
            '<div class="eq-unid-line hint">词缀被封印，鉴定后揭晓</div>' +
            '<div class="ceh-stats" style="display:flex; gap:14px; margin-top:8px;">' +
              '<div class="ceh-stat" style="display:flex; flex-direction:column;"><span style="font-size:11px; color:#8a8478;">物品等级</span><b style="font-size:14px;">' + ilvl + '</b></div>' +
              '<div class="ceh-stat" style="display:flex; flex-direction:column;"><span style="font-size:11px; color:#8a8478;">词缀 T 阶上限</span><b style="font-size:14px;">T' + _maxT + '</b></div>' +
            '</div>' +
            '<button class="btn-sm id" id="eq-unid-btn"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/></svg> 鉴定（消耗 1 鉴定石）</button>' +
          '</div>';
        const idBtn = craftEl.querySelector('#eq-unid-btn');
        if (idBtn) idBtn.onclick = () => identifyEq(eq, idBtn);
      }
      return;
    }
    if (craftEl && UI.renderCraftInto) UI.renderCraftInto(craftEl, eq);
  }
  function renderEqDetail(eq) { renderEqDetailInto($('eq-detail'), eq); } // 侧边栏装备页
  function renderBagEqDetail(eq) { renderEqDetailInto($('bag-eq-detail'), eq); } // 背包窗口装备子页
  /* ---------- 鉴定：消耗 1 鉴定石揭晓未鉴定装备（与背包 tab 的 identifyEquip 同规则） ---------- */
  async function identifyEq(eq, btn) {
    if (!eq || eq.identified !== false) return;
    const have = window.Materials && window.Materials.getQuantity ? window.Materials.getQuantity('鉴定石') : 0;
    if (!have || have <= 0) { showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/></svg> 没有鉴定石', '去挂机捡鉴定石'); return; }
    /* 反馈（2026-09-15）：扣鉴定石 + 同步云端 = 2 趟往返（约 0.7 秒），原先这段时间按钮毫无变化，
     * 玩家以为没点上会反复点（重复扣石头）。用 runWithLoading 包住【整个鉴定流程】——
     * 不能只包扣石那一步，否则后面同步云端那段又没反馈了。
     * ⚠️ `btn || {}`：runWithLoading 遇到"按钮不存在/已禁用"会直接 early return 什么都不做，
     *    那样鉴定会被静默跳过；传个空对象当占位，保证"没有按钮时照样鉴定，只是没有 loading 态"。 */
    return UI.runWithLoading(btn || {}, '鉴定中…', async () => {
    const r = await window.Materials.spend('鉴定石', 1);
    if (!r || !r.ok) { showToast('❌ 鉴定失败', (r && r.error) || '鉴定石不足'); return; }
    eq.identified = true;
    /* 鉴定状态同步云端（不同步 → 刷新后 fromCloud 读回 false，又变回未鉴定且白扣鉴定石）。
     * ⚠️ 原来是 fire-and-forget（失败只 addLog）：鉴定石已经真扣了、状态没落库 = 玩家白亏一颗。
     * 改成 await + 失败回滚（与 ui-pet-awaken.js 觉醒失败退石头同一口径）。 */
    if (eq.cloudId && window.Items) {
      let up = null;
      try { up = await window.Items.updateCloudItem(eq, { identified: true }); } catch (e) { up = { error: e }; }
      if (up && up.error) {
        eq.identified = false;
        if (window.Materials && window.Materials.gain) window.Materials.gain('鉴定石', 1);
        showToast('❌ 鉴定失败', '云端同步失败，鉴定石已退还（' + ((up.error && up.error.message) || '未知错误') + '）');
        UI.renderAll();
        return;
      }
    }
    showToast('<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg> 鉴定完成', eq.name);
    UI.renderAll();
    if (activeEqId === eq.id) renderBagEqDetail(eq);
    });   // ← 对应上面 return UI.runWithLoading(btn, '鉴定中…', async () => {
  }
  function hideEqDetail() {
    const hostEl = $('eq-detail');
    if (!hostEl) return;
    const body = hostEl.querySelector('.eq-detail-body');
    if (body) body.style.display = 'none';
    const emptyEl = hostEl.querySelector('.eq-detail-empty');
    if (emptyEl) emptyEl.style.display = '';
    activeEqId = null;
  }

  /* ---------- 对外 API（装备页） ---------- */
  UI.renderInvFilter = renderInvFilter;
  UI.renderInvToolbar = renderInvToolbar;
  UI.renderInventory = renderInventory;
  UI.renderEqDetail = renderEqDetail;
  UI.renderEqDetailInto = renderEqDetailInto;
  UI.renderBagEqDetail = renderBagEqDetail;
  UI.buildEquipCompare = buildEquipCompare; // 纯函数导出，供换装对比测试直接断言（不依赖浮层渲染）
  UI.hideEqDetail = hideEqDetail;
  UI.openSalvagePanel = openSalvagePanel;
  UI.closeSalvagePanel = closeSalvagePanel;
  UI.openBatchSalvagePanel = openBatchSalvagePanel;
  UI.salvageConfirm = salvageConfirm; // 分解确认的唯一实现：背包快捷键 / 单件快分解也走它
})();
