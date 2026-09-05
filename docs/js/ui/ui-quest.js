/* ============================================================
 * ui-quest.js —— 任务面板 + 新手引导条
 * 职责：
 *  1. 任务面板：按四类分组（新手 / 主线 / 日常 / 成就），左栏列表 + 右栏详情
 *  2. 新手引导条：常驻所有页面顶部，显示新手链当前该做的一条，可一键跳转、可跳过
 * 任务数据全部来自 Quest.getQuests() / Quest.getGuideQuest()，本文件只管展示。
 * 依赖：quest.js、ui-common($ / escapeHtml / showToast / switchPage)
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;
  const Quest = window.Quest;
  const UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const escapeHtml = UI.escapeHtml || (s => String(s == null ? '' : s));

  // 任务类型标签（13 种）
  const TYPE_LABEL = {
    collect: '收集', collect_loop: '地图委托', kill: '击败', evolve: '进化', nirvana: '涅槃',
    synth: '合成', soulcast: '魂铸', hatch: '孵化', craft: '打造', salvage: '分解',
    equipDrop: '获得装备', equip: '穿装备', list: '上架', trade: '成交'
  };
  const TRACK_MAX = 3;          // 追踪栏最多钉几条（与 quest.js 的 TRACK_MAX 一致）

  // 六个分类（新手动线排序；pet = 宠物专属 2026-08-31 新增；done = 已完成汇总 2026-08-31 用户拍板）
  // done 是特殊分类：汇总所有已完成（含当天交掉的日常），其它分类只显示未完成
  const CATS = [
    { id: 'tutorial', label: '新手', icon: '🌱' },
    { id: 'main', label: '主线', icon: '📜' },
    { id: 'daily', label: '日常', icon: '🔁' },
    { id: 'achieve', label: '成就', icon: '🏆' },
    { id: 'pet', label: '宠物', icon: '🐾' },
    { id: 'done', label: '已完成', icon: '✅' }
  ];

  function areaName(areaId) {
    const a = (Config.battle.areas || []).find(x => x.id === areaId);
    return a ? a.name : areaId;
  }

  let selectedQuestId = null;

  /* ---------- 任务需求描述 ----------
   * petName 存在（宠物专属任务）时，需求描述带「绑定宠物」：
   *   孵化·血狐 → 孵化「血狐」；血狐试炼 → 带「血狐」击败 80 只；血狐的进化 → 「血狐」进化 1 次 */
  function taskDesc(q) {
    const pn = q.petName;
    switch (q.type) {
      case 'collect': return `收集「${q.matName}」×${q.need}`;
      case 'collect_loop': return `在「${areaName(q.area)}」收集「${q.matName}」×${q.need}，交完继续下一轮`;
      case 'kill': return pn ? `带「${pn}」击败 ${q.need} 只` : (q.area ? `在「${areaName(q.area)}」击败 ${q.need} 只` : `击败 ${q.need} 只`);
      case 'evolve': return pn ? `「${pn}」进化 ${q.need} 次` : `进化 ${q.need} 次`;
      case 'nirvana': return `涅槃 ${q.need} 次`;
      case 'synth': return `合成 ${q.need} 次`;
      case 'hatch': return pn ? `孵化「${pn}」` : `孵化 ${q.need} 只`;
      case 'craft': return `打造 ${q.need} 次`;
      case 'salvage': return `分解 ${q.need} 件`;
      case 'equipDrop': return `获得装备 ${q.need} 件`;
      case 'equip': return `穿装备 ${q.need} 件`;
      case 'list': return `上架 ${q.need} 次`;
      case 'trade': return `市场成交 ${q.need} 次`;
      case 'level': return `出战宠物达到 Lv${q.need}`;
      default: return `进度 ${q.need}`;
    }
  }

  // 状态：未解锁 / 已完成 / 可提交 / 进行中 / 未接取
  function stateOf(q) {
    if (!q.unlocked) return { text: '未解锁', cls: 'q-locked' };
    if (q.finished) return { text: q.repeat ? '今日已完成' : '已完成', cls: 'q-done' };
    if (q.done) return { text: '可提交', cls: 'q-done' };
    if (q.accepted) return { text: '进行中', cls: 'q-active' };
    return { text: '未接取', cls: '' };
  }

  // 任务状态角标（网游惯例：可接 ! / 可交 ?，进行中不标）
  function markOf(q) {
    if (q.done) return '<span class="q-mark q-mark--submit" title="可提交">?</span>';
    if (!q.accepted) return '<span class="q-mark q-mark--accept" title="可接取">!</span>';
    return '';
  }

  function detailHtml(q, trackedIds) {
    const tracked = trackedIds || [];
    const pct = q.need ? Math.min(100, Math.round(q.progress / q.need * 100)) : 0;
    const st = stateOf(q);
    const cat = CATS.find(c => c.id === q.category) || CATS[1];
    // 经验是任务奖励的主体（2026-08-30 用户拍板），材料是辅助：奖励列表第一行显示经验
    const expVal = (window.Quest && window.Quest.questExpOf) ? window.Quest.questExpOf(q) : 0;
    const rewardRows = Object.entries(q.reward || {}).map(([n, a]) => `${escapeHtml(n)} ×${a}`);
    const gearCount = Number((q.rewardGear && q.rewardGear.count) || q.rewardGear || 0);
    if (gearCount > 0) rewardRows.push(`🎁 装备 ×${gearCount}`);
    if (expVal > 0) rewardRows.unshift(`经验 +${expVal}`);

    return `
      <div class="quest-detail">
        <div class="quest-detail-title">${escapeHtml(q.name || '任务')}</div>
        <div class="quest-detail-state ${st.cls}">${st.text}</div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">任务需求</div>
          <div class="quest-detail-text">${escapeHtml(taskDesc(q))}</div>
          ${q.petName ? `<div class="quest-detail-text" style="color:var(--accent-hi)">绑定宠物：${escapeHtml(q.petName)}</div>` : ''}
          <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
          <div class="quest-detail-text">进度 ${q.progress} / ${q.need}</div>
          <div class="quest-detail-row">${escapeHtml(TYPE_LABEL[q.type] || q.type)}类任务 · ${escapeHtml(cat.label)}</div>
        </div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">奖励物品</div>
          ${rewardRows.length ? rewardRows.map(r => `<div class="quest-reward-row">${r}</div>`).join('') : '<div class="quest-detail-text">无</div>'}
        </div>
        <div class="quest-actions">
          ${!q.unlocked ? '<div class="quest-detail-text">等级或前置条件达成后解锁</div>' :
            q.finished ? '<div class="quest-detail-text">这个任务已经交过了</div>' :
              q.done ? `<button class="btn-mini primary quest-submit" data-id="${q.id}">提交任务</button>` :
                `<button class="btn-mini ghost quest-accept" data-id="${q.id}" ${q.accepted ? 'disabled' : ''}>${q.accepted ? '已接取' : '接取任务'}</button>`}
          ${q.finished || q.category === 'tutorial' ? '' :
            `<button class="btn-mini ghost quest-track" data-id="${q.id}">${tracked.indexOf(q.id) >= 0 ? '取消追踪' : '追踪'}</button>`}
          ${q.accepted && !q.finished && q.category !== 'tutorial' ?
            `<button class="btn-mini danger quest-abandon" data-id="${q.id}">放弃</button>` : ''}
        </div>
      </div>`;
  }

  /* ---------- 任务面板：左侧滑出抽屉（tab 分类 + 卡片列表，点卡片进详情） ---------- */
  let activeCat = null; // 当前分类（默认取第一个非空分类）

  // 任务卡片（对齐 2026-08-31 demo 排版：名称+绑定宠标签 → 描述 → 进度条 → 进度+按钮 → 奖励）
  function cardHtml(q) {
    const pct = q.need ? Math.min(100, Math.round(q.progress / q.need * 100)) : 0;
    const st = stateOf(q);
    const expVal = Quest.questExpOf ? Quest.questExpOf(q) : 0;
    const mats = Object.entries(q.reward || {}).map(([n, a]) => `<span class="quest-card-mat">${escapeHtml(n)} ×${a}</span>`).join('');
    // 送装备的任务（新手链 t2）：卡片上要写清楚，玩家才知道「做完这条就有装备穿了」
    const gearCount = Number((q.rewardGear && q.rewardGear.count) || q.rewardGear || 0);
    const gearHtml = gearCount > 0
      ? `<span class="quest-card-mat gear">🎁 装备 ×${gearCount}</span>` : '';
    const rewards = `<span class="quest-card-exp">经验 +${expVal}</span>` + mats + gearHtml;
    let btn;
    if (!q.unlocked) btn = `<button class="quest-card-btn locked" disabled>${q.lockText || '未解锁'}</button>`;
    else if (q.finished) btn = `<button class="quest-card-btn finished" disabled>${q.repeat ? '今日已完成' : '已完成'}</button>`;
    else if (q.done) btn = `<button class="quest-card-btn submit" data-id="${q.id}">提交</button>`;
    else if (q.accepted) btn = `<button class="quest-card-btn prog" disabled>${pct}%</button>`;
    else btn = `<button class="quest-card-btn accept" data-id="${q.id}">接取</button>`;
    return `
      <div class="quest-card${q.petName ? ' bind' : ''}" data-id="${q.id}">
        <div class="quest-card-head">
          <span class="quest-card-name">${markOf(q)}${escapeHtml(q.name || (TYPE_LABEL[q.type] || q.type) + '任务')}</span>
          ${q.petName ? `<span class="quest-card-pet">🐾 ${escapeHtml(q.petName)}</span>` : ''}
        </div>
        <div class="quest-card-desc">${escapeHtml(taskDesc(q))}</div>
        <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
        <div class="quest-card-meta">
          <span class="quest-card-prog">${q.progress} / ${q.need} · ${st.text}</span>
          ${btn}
        </div>
        <div class="quest-card-rewards">${rewards}</div>
      </div>`;
  }

  // 卡片上的快捷操作：接取 / 提交（详情里的完整操作走 bindDetailActions）
  function bindCardActions() {
    const body = $('quest-body');
    body.querySelectorAll('.quest-card-btn.accept').forEach(btn => {
      btn.onclick = () => { Quest.acceptQuest(btn.dataset.id); renderQuestPanel(); };
    });
    body.querySelectorAll('.quest-card-btn.submit').forEach(btn => {
      btn.onclick = async () => {
        // 提交要等云端落盘（几百 ms），不立刻给反馈玩家会以为卡死
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = '提交中…';
        let r;
        try {
          r = await Quest.completeQuest(btn.dataset.id);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        if (r.error) { UI.showToast ? UI.showToast('任务失败', r.error) : alert(r.error); return; }
        if (UI.showToast) UI.showToast('任务完成', '奖励：' + r.rewards.join('、'));
        renderQuestPanel();
        renderQuestTracker(); // 交完的任务要从追踪栏撤下
      };
    });
  }

  // 详情视图里的完整操作（接取 / 提交 / 追踪 / 放弃）
  function bindDetailActions() {
    const body = $('quest-body');
    body.querySelectorAll('.quest-accept').forEach(btn => {
      btn.onclick = () => { Quest.acceptQuest(btn.dataset.id); renderQuestPanel(); };
    });
    body.querySelectorAll('.quest-submit').forEach(btn => {
      btn.onclick = async () => {
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = '提交中…';
        let r;
        try {
          r = await Quest.completeQuest(btn.dataset.id);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        if (r.error) { UI.showToast ? UI.showToast('任务失败', r.error) : alert(r.error); return; }
        if (UI.showToast) UI.showToast('任务完成', '奖励：' + r.rewards.join('、'));
        renderQuestPanel();
        renderQuestTracker();
      };
    });
    body.querySelectorAll('.quest-track').forEach(btn => {
      btn.onclick = () => {
        Quest.toggleTrack(btn.dataset.id);
        renderQuestPanel();
        renderQuestTracker();
      };
    });
    body.querySelectorAll('.quest-abandon').forEach(btn => {
      btn.onclick = () => {
        // 放弃会清零进度，先确认；测试环境没有 confirm 时直接执行
        if (window.confirm && !window.confirm('放弃后进度清零，确定放弃这个任务？')) return;
        const r = Quest.abandonQuest(btn.dataset.id);
        if (r.error) { UI.showToast ? UI.showToast('无法放弃', r.error) : alert(r.error); return; }
        if (UI.showToast) UI.showToast('已放弃', r.name);
        renderQuestPanel();
        renderQuestTracker();
      };
    });
  }

  // 分类 tab：普通分类角标 = 未完成数；「已完成」角标 = 已完成总数
  function renderQuestTabs() {
    const wrap = $('quest-tabs');
    if (!wrap) return;
    const all = Quest.getQuests();
    const inCat = cat => cat === 'done'
      ? all.filter(q => q.finished).length
      : all.filter(q => q.category === cat && !q.finished && q.unlocked).length;
    // 默认分类：第一个有未完成任务的（新手优先），都空则回主线
    if (!activeCat || !CATS.some(c => c.id === activeCat)) {
      const first = CATS.find(c => c.id !== 'done' && inCat(c.id) > 0);
      activeCat = first ? first.id : 'main';
    }
    wrap.innerHTML = CATS.map(c => {
      const n = inCat(c.id);
      return `<button class="quest-tab${c.id === activeCat ? ' on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}<span class="quest-tab-cnt">${n}</span></button>`;
    }).join('');
    wrap.querySelectorAll('.quest-tab').forEach(btn => {
      btn.onclick = () => { activeCat = btn.dataset.cat; renderQuestPanel(); };
    });
  }

  function renderQuestPanel(cat) {
    if (cat) activeCat = cat; // 外部（测试 / 快捷入口）可指定分类
    const body = $('quest-body');
    if (!body || !Quest) return;
    renderQuestTabs();
    const all = Quest.getQuests();
    // 分类视图：done=所有已完成；其余=该分类未完成（未解锁也显示，灰显，让玩家看到还有什么可解锁）
    const rows = activeCat === 'done'
      ? all.filter(q => q.finished)
      : all.filter(q => q.category === activeCat && !q.finished && q.unlocked);
    // 排序：可提交 > 进行中 > 未接取 > 未解锁
    const rank = q => !q.unlocked ? 3 : q.done ? 0 : q.accepted ? 1 : 2;
    rows.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

    // 详情视图：点卡片进入，返回按钮回到列表
    if (selectedQuestId && rows.find(q => q.id === selectedQuestId)) {
      const q = rows.find(x => x.id === selectedQuestId);
      const trackedIds = Quest.getTracked ? Quest.getTracked() : [];
      body.innerHTML = `<button class="btn-mini ghost quest-back">← 返回列表</button>` + detailHtml(q, trackedIds);
      body.querySelector('.quest-back').onclick = () => { selectedQuestId = null; renderQuestPanel(); };
      bindDetailActions();
      return;
    }

    if (!rows.length) {
      body.innerHTML = `<div class="quest-empty">${activeCat === 'done' ? '还没有已完成的任务' : '该分类暂无任务'}</div>`;
      return;
    }
    body.innerHTML = rows.map(cardHtml).join('');
    body.querySelectorAll('.quest-card').forEach(card => {
      card.onclick = e => {
        if (e.target.closest('button')) return; // 卡片内按钮（接取/提交）优先，不触发详情
        selectedQuestId = card.dataset.id;
        renderQuestPanel();
      };
    });
    bindCardActions();
  }

  /* ---------- 新手引导条 ---------- */
  // 跳到任务该去的页面（宠物页还要切对应 tab）
  // area：任务的目标地图。去战斗页时若还没选图就自动选一张，
  // 否则玩家跳过去只会看到「请先选择挂机地图」，引导就断了。
  function goGuide(guide, area) {
    const page = (guide && guide.page) || 'battle';
    const B = window.Battle;
    if (page === 'battle' && B && B.getCurrentArea && !B.getCurrentArea()) {
      const areaId = area || ((Config.battle.areas || [])[0] || {}).id;
      if (areaId && B.selectArea) B.selectArea(areaId); // 挂机中换图会被拒绝，此时保持当前图
    }
    if (UI.switchPage) UI.switchPage(page);
    if (guide && guide.tab) {
      const btn = document.querySelector('.pet-tab[data-pet-tab="' + guide.tab + '"]');
      if (btn && btn.click) {
        btn.click();
      } else {
        // 顶部 tab 按钮已移除（宠物页精简 2026-09-03）：直接激活对应 pane 兜底，引导不断链
        const pane = document.querySelector('.pet-tab-pane[data-pet-pane="' + guide.tab + '"]');
        if (pane) {
          document.querySelectorAll('.pet-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.pet-tab-pane').forEach(p => p.classList.remove('active'));
          pane.classList.add('active');
          if (guide.tab === 'egg' && window.UI.renderEggPanel) window.UI.renderEggPanel();
          if (guide.tab === 'equip') { const gb = document.getElementById('btn-pet-equip-goto'); if (gb) gb.click(); }
        }
      }
    }
    // 战斗页地图条要跟着刷新（与世界地图选图进战斗页的做法一致）
    if (page === 'battle') {
      if (UI.updateBattleArea && B) UI.updateBattleArea(B.getCurrentArea());
    }
  }

  // 普通任务按类型推导「该去哪」（新手任务用 config 里配的 guide，没配就也走这里）
  function guideOf(q) {
    if (q && q.guide) return q.guide;
    switch (q && q.type) {
      case 'kill': case 'collect': case 'equipDrop': return { page: 'battle', btn: '去挂机' };
      case 'craft': case 'salvage': return { page: 'equip', btn: '去打造' };
      case 'evolve': return { page: 'pet', tab: 'evolve', btn: '去进化' };
      case 'nirvana': return { page: 'pet', tab: 'merge', btn: '去涅槃' };
      case 'synth': return { page: 'pet', tab: 'synth', btn: '去合成' };
      case 'soulcast': return { page: 'equip', tab: 'soulcast', btn: '去魂铸' };
      case 'hatch': return { page: 'pet', tab: 'egg', btn: '去孵化' };
      case 'equip': return { page: 'pet', tab: 'equip', btn: '去穿装备' };
      case 'list': return { page: 'market-sell', btn: '去上架' };
      case 'trade': return { page: 'market', btn: '去交易' };
      default: return { page: 'battle', btn: '去做' };
    }
  }

  // 追踪栏条目：新手链当前任务排最前，后面接玩家钉住的任务，最多 TRACK_MAX 条
  function trackerItems() {
    const items = [];
    const g = Quest.getGuideQuest ? Quest.getGuideQuest() : null;
    if (g) items.push(Object.assign({}, g, { isTutorial: true, tag: '新手' }));
    const all = Quest.getQuests();
    for (const id of Quest.getTracked()) {
      if (items.length >= TRACK_MAX) break;
      const q = all.find(x => x.id === id);
      if (!q || q.finished || !q.unlocked) continue;   // 交过的、没解锁的不显示
      if (q.category === 'tutorial') continue;         // 新手任务由引导链负责，不重复钉
      const cat = CATS.find(c => c.id === q.category);
      items.push(Object.assign({}, q, { isTutorial: false, tag: cat ? cat.label : '任务' }));
    }
    return items;
  }

  /* ---------- 引导单步指引：点「去XX」时先讲清"这一步干嘛、为什么" ----------
   * 目标通常在「还没切过去」的页面里（如宠物页 synth tab），此刻 getBoundingClientRect
   * 量到 0×0 → hotspot 引擎会当"缺失"隐藏，控制台刷警告。
   * 这里轮询等目标真正可见（≤1.5s）再弹；goGuide 紧随其后同步切页，下一帧就量到了。 */
  function guideHint(it) {
    try {
      if (!it || !it.isTutorial || !it.target) return;
      if (!window.Onboarding || !window.Onboarding.hotspot) return;
      let tries = 0;
      const attempt = function () {
        let rc = null;
        try {
          const el = document.querySelector(it.target);
          if (el && typeof el.getBoundingClientRect === 'function') rc = el.getBoundingClientRect();
        } catch (e) { rc = null; }
        if ((rc && rc.width > 1 && rc.height > 1) || ++tries >= 15) {
          window.Onboarding.hotspot(it.target, {
            title: it.name || '下一步',
            npc: it.npc || '',
            npcName: '引路人',
            npcTitle: '魂兽向导'
          });
          return;
        }
        window.setTimeout(attempt, 100);
      };
      attempt();
    } catch (e) { console.warn('[quest] 引导指引失败', e); }
  }

  function renderQuestTracker() {
    const bar = $('quest-tracker');
    if (!bar || !Quest) return;
    const items = trackerItems();
    if (!items.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }

    bar.style.display = '';
    bar.innerHTML = items.map(it => {
      const pct = it.need ? Math.min(100, Math.round(it.progress / it.need * 100)) : 0;
      const g = guideOf(it);
      const acts = it.isTutorial
        // 引导任务已达标 → 主按钮变「领取奖励」（G1 领资粮这类"等级即目标"的任务靠它交）
        ? (it.done
            ? `<button class="btn-mini primary qt-submit" data-id="${it.id}">领取奖励</button>
               <button class="btn-mini ghost qt-skip" title="跳过新手引导">跳过</button>`
            : `<button class="btn-mini primary qt-go" data-id="${it.id}">${escapeHtml(g.btn)}</button>
               <button class="btn-mini ghost qt-skip" title="跳过新手引导">跳过</button>`)
        : `<button class="btn-mini ghost qt-go" data-id="${it.id}">${escapeHtml(g.btn)}</button>
           <button class="btn-mini ghost qt-untrack" data-id="${it.id}" title="取消追踪">×</button>`;
      return `<div class="qt-item${it.done ? ' qt-done' : ''}" data-id="${it.id}">
        <span class="qt-tag">${escapeHtml(it.tag)}</span>
        <span class="qt-name">${escapeHtml(it.name)}</span>
        <span class="qt-prog">${Math.min(it.progress, it.need)} / ${it.need}</span>
        <div class="qt-bar"><div class="qt-bar-fill" style="width:${pct}%"></div></div>
        ${acts}
      </div>`;
    }).join('');

    bar.querySelectorAll('.qt-go').forEach(b => {
      b.onclick = () => {
        const it = items.find(x => x.id === b.dataset.id);
        if (!it) return;
        guideHint(it);                  // 先弹引路人的"为什么"，再跳到该去的页
        goGuide(guideOf(it), it.area);
      };
    });
    // 引导任务达标后：直接在引导条领奖（G1 领资粮这类任务没有"去某页"的操作）
    bar.querySelectorAll('.qt-submit').forEach(b => {
      b.onclick = async () => {
        const label = b.textContent;
        b.disabled = true;
        b.textContent = '领取中…';
        let r;
        try { r = await Quest.completeQuest(b.dataset.id); }
        finally { b.disabled = false; b.textContent = label; }
        if (r && r.error) { if (UI.showToast) UI.showToast('领取失败', r.error); return; }
        if (UI.showToast && r) UI.showToast('任务完成', '奖励：' + (r.rewards || []).join('、'));
        if (UI.renderAll) UI.renderAll();
        renderQuestTracker();
      };
    });
    const skip = bar.querySelector('.qt-skip');
    if (skip) skip.onclick = () => { if (Quest.skipGuide) Quest.skipGuide(); renderQuestTracker(); };
    bar.querySelectorAll('.qt-untrack').forEach(b => {
      b.onclick = () => { Quest.toggleTrack(b.dataset.id); renderQuestTracker(); };
    });
  }

  /* ---------- 面板开关（左侧滑出抽屉，动画节奏对齐装备打造 craft-drawer） ---------- */
  function openQuestPanel() {
    renderQuestPanel();
    const host = $('quest-panel');
    if (!host) return;
    host.style.display = 'block';
    requestAnimationFrame(() => host.classList.add('is-open'));
  }
  function closeQuestPanel() {
    const host = $('quest-panel');
    if (!host) return;
    host.classList.remove('is-open');
    window.setTimeout(() => { if (!host.classList.contains('is-open')) host.style.display = 'none'; }, 300);
  }

  function initQuestUI() {
    const cancel = $('quest-cancel');
    if (cancel) cancel.onclick = closeQuestPanel;
    const scrim = $('quest-scrim');
    if (scrim) scrim.onclick = closeQuestPanel;
    const taskBtn = document.querySelector('.top-btn[data-dialog="任务"]');
    if (taskBtn) taskBtn.onclick = openQuestPanel;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQuestPanel(); });
    // 任务窗口拖动（标题栏按住拖动）
    const questWin = document.querySelector('.quest-drawer');
    const questHeader = document.querySelector('.quest-drawer-header');
    if (questWin && questHeader && UI.makeDraggable) UI.makeDraggable(questWin, questHeader);
  }

  window.UI = window.UI || {};
  window.UI.openQuestPanel = openQuestPanel;
  window.UI.closeQuestPanel = closeQuestPanel;
  window.UI.initQuestUI = initQuestUI;
  window.UI.renderQuestPanel = renderQuestPanel;
  window.UI.renderQuestTracker = renderQuestTracker;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initQuestUI);
  }
})();
