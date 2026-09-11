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

  // 任务类型标签
  const TYPE_LABEL = {
    collect: '收集', collect_loop: '地图委托', kill: '击败', evolve: '进化', nirvana: '涅槃',
    synth: '合成', soulcast: '魂铸', hatch: '孵化', craft: '打造', salvage: '分解',
    equipDrop: '获得装备', equip: '穿装备', list: '上架', trade: '成交', disposeBoss: '处置 + Boss',
    disposeKill: '处置 + 推进', direction: '选方向',
    meter: '周活跃', dailyChest: '日常宝箱', completion: '完成度',
    chapterChest: '章宝箱', trialRun: '通关副本', trialFloor: '副本层数',
    towerRun: '登塔', towerFloor: '塔层数'
  };
  const TRACK_MAX = 3;          // 追踪栏最多钉几条（与 quest.js 的 TRACK_MAX 一致）
  // 自动追踪：进度到这个比例的任务自动顶上追踪栏（手动钉的优先，格子不够时自动的先被挤掉）
  const AUTO_TRACK_RATIO = 0.8;

  /* ---------- 一级分类（tab） ----------
   * 唯一来源 = quest-config.js 的 KIND_META（标签/图标只在那边定义一份，UI 不抄第二份）。
   * done = 已完成聚合视图（它是视图不是分类，永远排在最后）。
   * 分类顺序 = 注意力优先级：被引导的 → 推进度的 → 正在养的 → 今天该做的 → 可以刷的 → 长期冲的。 */
  const FALLBACK_KIND_META = [
    { id: 'guide',   label: '引导', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg>', order: 1 },
    { id: 'series',  label: '系列', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>', order: 2 },
    { id: 'pet',     label: '宠物', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>', order: 3 },
    { id: 'daily',   label: '日常', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>', order: 4 },
    { id: 'loop',    label: '循环', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/></svg>️', order: 5 },
    { id: 'achieve', label: '成就', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/></svg>', order: 6 }
  ];
  const DONE_CAT = { id: 'done', label: '已完成', icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m16 9-5.5 5.5L8 12"/></svg>', order: 99 };
  // 惰性读取：规范化层若因加载顺序还没就位，UI 也不会崩（拿兜底表）。
  function cats() {
    const meta = (window.QuestConfig && window.QuestConfig.KIND_META) || FALLBACK_KIND_META;
    return meta.concat([DONE_CAT]);
  }
  // 旧分类 id 兼容（外部调用 / 老测试会传 'main' 'tutorial'）
  const CAT_ALIAS = { main: 'series', tutorial: 'guide' };
  function normCat(id) { return CAT_ALIAS[id] || id; }

  /* ---------- 二级分组的折叠记忆 ----------
   * key = 分类:组id。默认只展开「第一个有可提交的组，
   * 没有则第一个还没做完的组」；组 ≤2 个时全展开。
   * 玩家手动点过就以玩家为准（session 内有效，不写云端）。 */
  const groupOpen = {};
  function defaultOpenId(groups) {
    if (groups.length <= 2) return null;   // null = 全展开
    const first = groups.find(g => g.ready > 0) || groups.find(g => g.done < g.total) || groups[0];
    return first ? first.id : null;
  }
  function isOpen(cat, g, defId) {
    const k = cat + ':' + g.id;
    if (k in groupOpen) return groupOpen[k];
    return defId === null ? true : g.id === defId;
  }

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
      case 'collect': return Array.isArray(q.matList) ? `收集「图 1~10 区域材料」每种 ×${q.need}（共 ${q.matList.length} 种）` : `收集「${q.matName}」×${q.need}`;
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
      case 'disposeBoss': return `上架或分解 1 件，再击败 ${areaName(q.area)} Boss`;
      case 'disposeKill': {
        const need2 = (q.parts && q.parts.secondNeed) || q.need;
        return `上架或分解 1 件，再在「${areaName(q.area)}」击败 ${need2} 只`;
      }
      case 'direction': return '在普通挂机和资源试炼中选一条';
      case 'level': return `出战宠物达到 Lv${q.need}`;
      /* 目标（bonus）三条：进度是现算的，描述要把"怎么涨"讲清楚，玩家才知道该干嘛 */
      case 'dailyChest': return `今天交 ${q.need} 条日常（可做的都算）`;
      case 'meter': return `本周活跃度 ${q.need}（交日常/兑换 +10，交系列/宠物/成就 +5）`;
      case 'completion': return `全任务完成度达到 ${q.need}%`;
      /* 副本/塔（2026-09-11 接入）：层数是「历史最高」，描述要说清不会因失败回退 */
      case 'trialRun': return `通关资源试炼 ${q.need} 次`;
      case 'towerRun': return `挑战通天塔 ${q.need} 次`;
      case 'towerFloor': return `通天塔最高打到第 ${q.need} 层（只认历史最高，失败不回退）`;
      default: return `进度 ${q.need}`;
    }
  }

  function progressText(q) {
    if (q && q.parts) {
      const need = q.parts.secondNeed || q.need;
      return `处置 ${q.parts.disposed}/${q.need} · ${q.parts.secondLabel || '目标'} ${q.parts.second}/${need}`;
    }
    // 双保险钳位：循环委托的库存会超过需求（58 个但只要 50），显示钳到 need，超出的留给下一轮
    const p = Math.min(Number(q.progress) || 0, Number(q.need) || 0);
    return `${p} / ${q.need}`;
  }

  // 交完后的状态文案：按重置周期区分（日常=今日已完成 / 兑换=本周已完成 / 一次性=已完成）
  function doneLabel(q) {
    if (q.reset === 'weekly') return '本周已完成';
    if (q.reset === 'daily' || q.repeat) return '今日已完成';
    return '已完成';
  }

  // 状态：未解锁 / 已完成 / 可提交 / 进行中 / 未接取
  function stateOf(q) {
    if (!q.unlocked) return { text: '未解锁', cls: 'q-locked' };
    if (q.finished) return { text: doneLabel(q), cls: 'q-done' };
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
    const cat = cats().find(c => c.id === q.kind) || { label: '任务' };
    // 经验是任务奖励的主体（2026-08-30 用户拍板），材料是辅助：奖励列表第一行显示经验
    const expVal = (window.Quest && window.Quest.questExpOf) ? window.Quest.questExpOf(q) : 0;
    const rewardRows = Object.entries(q.reward || {}).map(([n, a]) => `${escapeHtml(n)} ×${a}`);
    const gearCount = Number((q.rewardGear && q.rewardGear.count) || q.rewardGear || 0);
    if (gearCount > 0) rewardRows.push(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/></svg> 装备 ×${gearCount}`);
    if (expVal > 0) rewardRows.unshift(`经验 +${expVal}`);
    // matList 多材料任务：逐种列出材料名 + 背包持有量（够 888 标绿，差的标红提示还缺多少）
    const matRows = Array.isArray(q.matList)
      ? q.matList.map(n => {
          const have = (window.Materials && window.Materials.getQuantity) ? window.Materials.getQuantity(n) : 0;
          const ok = have >= q.need;
          return `<div class="quest-detail-text" style="color:${ok ? '#8fae8f' : '#c88a6a'}">${escapeHtml(n)}　${have} / ${q.need}${ok ? ' ✓' : '（还差 ' + (q.need - have) + '）'}</div>`;
        }).join('')
      : '';

    return `
      <div class="quest-detail">
        <div class="quest-detail-title">${escapeHtml(q.name || '任务')}</div>
        <div class="quest-detail-state ${st.cls}">${st.text}</div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">任务需求</div>
          <div class="quest-detail-text">${escapeHtml(taskDesc(q))}</div>
          ${matRows}
          ${q.petName ? `<div class="quest-detail-text" style="color:var(--accent-hi)">绑定宠物：${escapeHtml(q.petName)}</div>` : ''}
          <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
          <div class="quest-detail-text">进度 ${progressText(q)}</div>
          <div class="quest-detail-row">${escapeHtml(cat.label)} › ${escapeHtml((q.group && q.group.label) || '任务')} › ${escapeHtml(TYPE_LABEL[q.type] || q.type)}类</div>
        </div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">奖励物品</div>
          ${rewardRows.length ? rewardRows.map(r => `<div class="quest-reward-row">${r}</div>`).join('') : '<div class="quest-detail-text">无</div>'}
          ${(() => { const pv = rewardPreviewOf(q); return pv ? `<div class="quest-reward-row quest-next-row">完成可得 ${escapeHtml(pv.labels.join('、'))} <span class="quest-next-use">→ 下一步「${escapeHtml(pv.next.name)}」要用</span></div>` : ''; })()}
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
      ? `<span class="quest-card-mat gear"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/></svg> 装备 ×${gearCount}</span>` : '';
    // 奖励即钥匙：卡片上直接写明"做完给什么、下一步是谁要用的"
    const pv = rewardPreviewOf(q);
    const nextHtml = pv
      ? `<span class="quest-card-next">完成可得 ${escapeHtml(pv.labels.join('、'))} <i>→ 下一步「${escapeHtml(pv.next.name)}」</i></span>`
      : '';
    const rewards = `<span class="quest-card-exp">经验 +${expVal}</span>` + mats + gearHtml + nextHtml;
    let btn;
    if (!q.unlocked) btn = `<button class="quest-card-btn locked" disabled>${q.lockText || '未解锁'}</button>`;
    else if (q.finished) btn = `<button class="quest-card-btn finished" disabled>${doneLabel(q)}</button>`;
    else if (q.done) btn = `<button class="quest-card-btn submit" data-id="${q.id}">提交</button>`;
    else if (q.accepted) btn = `<button class="quest-card-btn prog" disabled>${pct}%</button>`;
    else btn = `<button class="quest-card-btn accept" data-id="${q.id}">接取</button>`;
    return `
      <div class="quest-card${q.petName ? ' bind' : ''}" data-id="${q.id}">
        <div class="quest-card-head">
          <span class="quest-card-name">${markOf(q)}${escapeHtml(q.name || (TYPE_LABEL[q.type] || q.type) + '任务')}</span>
          ${q.petName ? `<span class="quest-card-pet"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg> ${escapeHtml(q.petName)}</span>` : ''}
        </div>
        <div class="quest-card-desc">${escapeHtml(taskDesc(q))}</div>
        <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
        <div class="quest-card-meta">
          <span class="quest-card-prog">${progressText(q)} · ${st.text}</span>
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
        // 引导任务走"奖励即钥匙"弹窗（拿到什么 + 给谁用 + 一键跳下一关）；其余维持 toast
        const q = Quest.getQuests().find(x => x.id === btn.dataset.id);
        if (!(q && showGuideReward(q)) && UI.showToast) UI.showToast('任务完成', '奖励：' + r.rewards.join('、'));
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
        const q = Quest.getQuests().find(x => x.id === btn.dataset.id);
        if (!(q && showGuideReward(q)) && UI.showToast) UI.showToast('任务完成', '奖励：' + r.rewards.join('、'));
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

  /* ---------- 分类 tab ----------
   * 角标两种状态：有奖可领 → 红色「可提交 N」；否则灰色「未完成 N」（都没有则不显示角标）。
   * 以前只有未完成数，玩家必须逐个点开才知道有没有奖可领。 */
  function renderQuestTabs() {
    const wrap = $('quest-tabs');
    if (!wrap) return;
    const all = Quest.getQuests();
    const statOf = id => {
      if (id === 'done') return { ready: 0, open: all.filter(q => q.finished).length };
      const rows = all.filter(q => q.kind === id && !q.finished && q.unlocked);
      return { ready: rows.filter(q => q.done).length, open: rows.length };
    };
    // 引导 tab 只在还有未完成的引导任务时显示（毕业/跳过后消失，教程 tab 不常驻 —— 业界惯例）
    let list = cats();
    if (statOf('guide').open === 0) list = list.filter(c => c.id !== 'guide');
    if (!activeCat || !list.some(c => c.id === activeCat)) {
      // 默认分类：第一个有内容的（引导优先），全空则回系列
      const first = list.find(c => c.id !== 'done' && statOf(c.id).open > 0);
      activeCat = first ? first.id : 'series';
    }
    wrap.innerHTML = list.map(c => {
      const s = statOf(c.id);
      const n = s.ready > 0 ? s.ready : s.open;
      const badge = n > 0
        ? `<span class="quest-tab-cnt${s.ready > 0 ? ' hot' : ''}"${s.ready > 0 ? ' title="有奖励可领"' : ''}>${n}</span>`
        : '';
      return `<button class="quest-tab${c.id === activeCat ? ' on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}${badge}</button>`;
    }).join('');
    wrap.querySelectorAll('.quest-tab').forEach(btn => {
      btn.onclick = () => { activeCat = btn.dataset.cat; selectedQuestId = null; renderQuestPanel(); };
    });
  }

  /* ---------- 二级分组头（三级结构：分类 tab → 分组 → 具体任务） ---------- */
  function groupHeadHtml(g, open) {
    const pct = g.total ? Math.round(g.done / g.total * 100) : 0;
    const ready = g.ready > 0 ? `<span class="quest-group-ready">可提交 ${g.ready}</span>` : '';
    return `<button type="button" class="quest-group-head${open ? ' open' : ''}${g.done === g.total ? ' cleared' : ''}" data-group="${escapeHtml(g.id)}">`
      + `<span class="quest-group-caret">${open ? '▾' : '▸'}</span>`
      + `<span class="quest-group-label">${g.label}</span>`
      + ready
      + `<span class="quest-group-prog">${g.done} / ${g.total}</span>`
      + `<span class="quest-progress quest-group-bar"><span class="quest-progress-bar" style="width:${pct}%"></span></span>`
      + `</button>`;
  }

  // 「已完成」视图按一级分类分组：各分类自己的分组键（章节 / 家族 / 目标族）混在一起会看不懂
  function doneGroups(rows) {
    const map = {}; const out = [];
    rows.forEach(q => {
      if (!map[q.kind]) {
        const meta = cats().find(c => c.id === q.kind) || { label: q.kind, icon: '·', order: 9 };
        map[q.kind] = { id: 'k:' + q.kind, label: (meta.icon || '') + ' ' + meta.label, order: meta.order || 9, quests: [] };
        out.push(map[q.kind]);
      }
      map[q.kind].quests.push(q);
    });
    out.sort((a, b) => a.order - b.order);
    out.forEach(g => { g.done = g.quests.length; g.total = g.quests.length; g.ready = 0; });
    return out;
  }

  function renderQuestPanel(cat) {
    if (cat) activeCat = normCat(cat); // 外部（测试 / 快捷入口）可指定分类，兼容旧 id
    const body = $('quest-body');
    if (!body || !Quest) return;
    if (!activeCat) activeCat = 'series';
    renderQuestTabs();
    const all = Quest.getQuests();
    // 分类视图：done = 所有已完成；其余 = 该分类未完成（未解锁也显示，灰显，让玩家看到还有什么可解锁）
    const rows = activeCat === 'done'
      ? all.filter(q => q.finished)
      : all.filter(q => q.kind === activeCat && !q.finished && q.unlocked);
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

    /* 三级结构：一级分类（tab） → 二级分组（可折叠组头） → 具体任务（卡片） */
    const groups = activeCat === 'done' ? doneGroups(rows)
      : (Quest.getGroups ? Quest.getGroups(activeCat, rows)
        : [{ id: 'all', label: '任务', order: 0, quests: rows, done: 0, total: rows.length, ready: 0 }]);
    const defId = defaultOpenId(groups);
    const readyTotal = groups.reduce((n, g) => n + g.ready, 0);

    const bar = groups.length > 1
      ? `<div class="quest-groups-bar">
           <span class="quest-groups-sum">${groups.length} 组 · ${rows.length} 条${readyTotal ? ' · <b class="hot">可提交 ' + readyTotal + '</b>' : ''}</span>
           <button type="button" class="btn-mini ghost quest-expand">全部展开</button>
           <button type="button" class="btn-mini ghost quest-collapse">全部折叠</button>
         </div>`
      : '';

    // 完成度行（2026-09-10）：只算一次性任务，百分比才不会随每日/每周重置而抖
    let completeLine = '';
    if (Quest.completion) {
      const cp = Quest.completion();
      completeLine = `<div class="quest-complete-line">任务完成度 <b>${cp.pct}%</b>` +
        `<span class="hint">${cp.done} / ${cp.total} 条一次性任务 · 里程碑在成就里</span></div>`;
    }

    body.innerHTML = completeLine + bar + groups.map(g => {
      const open = isOpen(activeCat, g, defId);
      const inner = open ? `<div class="quest-group-body">${g.quests.map(cardHtml).join('')}</div>` : '';
      return `<section class="quest-group${open ? ' open' : ''}">${groupHeadHtml(g, open)}${inner}</section>`;
    }).join('');

    // 组头点击 = 折叠/展开（记忆在 groupOpen，默认规则见 defaultOpenId）
    body.querySelectorAll('.quest-group-head').forEach(head => {
      head.onclick = () => {
        const cur = isOpen(activeCat, { id: head.dataset.group }, defId);
        groupOpen[activeCat + ':' + head.dataset.group] = !cur;
        renderQuestPanel();
      };
    });
    const expandAll = body.querySelector('.quest-expand');
    if (expandAll) expandAll.onclick = () => { groups.forEach(g => { groupOpen[activeCat + ':' + g.id] = true; }); renderQuestPanel(); };
    const collapseAll = body.querySelector('.quest-collapse');
    if (collapseAll) collapseAll.onclick = () => { groups.forEach(g => { groupOpen[activeCat + ':' + g.id] = false; }); renderQuestPanel(); };

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
    // 孵化（page:'bag'）：唯一入口 = 背包浮窗 · 素材蛋（2026-09-10 拍板，宠物页蛋 pane 已删）
    if (page === 'bag') {
      if (UI.openBagEggs) UI.openBagEggs();
      else if (UI.switchPage) UI.switchPage('bag');
      return;
    }
    const B = window.Battle;
    if (page === 'battle' && B && B.getCurrentArea && !B.getCurrentArea()) {
      const areaId = area || ((Config.battle.areas || [])[0] || {}).id;
      if (areaId && B.selectArea) B.selectArea(areaId); // 挂机中换图会被拒绝，此时保持当前图
    }
    if (UI.switchPage) UI.switchPage(page);
    if (guide && guide.tab) {
      // 装备类跳转（tab:'equip'）：12 槽界面在背包浮窗 · 装备子页（宠物页 equip pane 已删）
      if (guide.tab === 'equip') {
        if (UI.switchPage) UI.switchPage('equip');
      } else {
        const btn = document.querySelector('.pet-tab[data-pet-tab="' + guide.tab + '"]');
        if (btn && btn.click) {
          btn.click();
        } else {
          // 顶部 tab 按钮不存在时兜底：直接激活对应 pane（宠物页精简后部分 tab 无按钮）
          const pane = document.querySelector('.pet-tab-pane[data-pet-pane="' + guide.tab + '"]');
          if (pane) {
            document.querySelectorAll('.pet-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.pet-tab-pane').forEach(p => p.classList.remove('active'));
            pane.classList.add('active');
          }
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
      // 孵化唯一入口 = 背包 · 素材蛋（2026-09-10 拍板；宠物页蛋 pane 已删）
      case 'hatch': return { page: 'bag', btn: '去孵化' };
      case 'soulcast': return { page: 'equip', tab: 'soulcast', btn: '去魂铸' };
      case 'equip': return { page: 'pet', tab: 'equip', btn: '去穿装备' };
      case 'list': return { page: 'market-sell', btn: '去上架' };
      case 'trade': return { page: 'market', btn: '去交易' };
      case 'disposeBoss': return { page: 'equip', btn: '先处理装备' };
      case 'disposeKill': return { page: 'equip', btn: '先处理装备，再回图刷怪' };
      case 'direction': return { page: 'worldmap', btn: '选择方向' };
      default: return { page: 'battle', btn: '去做' };
    }
  }

  /* ---------- 奖励即钥匙（2026-09-08 v2）：奖励写清楚"给什么、给谁用" ----------
   * 引导关的 reward 已清空，真正的奖励是「下一关的钥匙」——钥匙表里 taskIds 指向下一关的那些项。
   * 展示层必须让玩家【接任务时】就看到"做完给什么、下一步要拿它干嘛"，否则闭环对玩家是隐形的。
   * 数据只有一份来源（钥匙表），UI 不另造一份，避免两处漂移。 */
  function nextQuestOf(qid) {
    return (Config.drop.quests || []).find(x => x.requires === qid) || null;
  }
  function keyLabelOf(it) {
    if (!it) return '';
    if (it.type === 'mat') return `${it.name} ×${Number(it.qty) || 1}`;
    if (it.type === 'gear') {
      const r = (Config.equipment.rarities || []).find(x => x.id === (it.rarity || 'white'));
      return `${(r && r.label) || ''}装备 ×${Number(it.count) || 1}`;
    }
    if (it.type === 'egg') return `${it.baseName || ''}蛋 ×${Number(it.qty) || 1}`;
    if (it.type === 'exppack') {
      const p = (window.TutorialMode && window.TutorialMode.expPackFor) ? window.TutorialMode.expPackFor(it.cap) : null;
      return p ? p.name : '经验包';
    }
    if (it.type === 'fodder') return `素材宠「${it.baseName || ''}」`;
    return '';
  }
  // 完成这一关会拿到什么（= 下一关的钥匙）；没有下一关则返回 null
  function rewardPreviewOf(q) {
    const T = window.TutorialMode;
    const next = nextQuestOf(q.id);
    if (!next || !T || !T.keyItemsFor) return null;
    const labels = T.keyItemsFor(next.id).map(keyLabelOf).filter(Boolean);
    return labels.length ? { next: next, labels: labels } : null;
  }
  /* ---------- 引导毕业结算（2026-09-10，业界惯例四件套）----------
   * 对照主流做法（大话西游式收尾：及时奖励反馈 + 目标感闭环 + 平滑过渡）：
   *   1. 仪式感：毕业弹窗回顾「这一路你学会了什么」（recap = config n1~n5 的 learned 字段）
   *   2. 奖励反馈：毕业礼包清单当场念出来（内容唯一来源 = Config.tutorialMode.starterPack）
   *   3. 下一步预告：按玩家在 n6 选的方向给不同的"接下来"引导
   *   4. 平滑过渡：追踪栏由「下一步」（第一个未完成的系列任务）无缝接管（见 trackerItems）
   * 弹窗只在 n6 交任务那一刻出现；checkGuide 登录补发路径不弹（老玩家登录不轰炸）。 */
  function graduationRecap() {
    return (Config.drop.quests || [])
      .filter(q => q.category === 'tutorial' && q.learned && /^n[1-5]$/.test(q.id))
      .map(q => '· ' + escapeHtml(q.learned));
  }
  function showGuideGraduation(choice) {
    const pack = (Config.tutorialMode && Config.tutorialMode.starterPack) || {};
    const rewards = (pack.mats || []).map(m => `${escapeHtml(m.name)} ×${Number(m.qty) || 1}`).join('、');
    const recap = graduationRecap();
    const isTrial = choice === 'trial';
    const nextLine = isTrial
      ? '资源试炼已为你敞开：进化、涅槃、打造的缺口，都可以去那里定向补。'
      : '回到挂机地图继续推进，第 2 章和守关 Boss 在前方等你。';
    if (!UI.showDialog) { if (UI.showToast) UI.showToast('引导完成', '已进入正常游戏节奏'); return; }
    UI.showDialog({
      icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>',
      speaker: '引路人',
      npcTitle: '魂兽向导',
      text: `<b>新手引导完成！</b><br>`
        + (recap.length ? `这一路你已经学会了：<br>${recap.join('<br>')}<br>` : '')
        + (rewards ? `<span class="qt-grad-reward">毕业礼包已发放：${rewards}</span><br>` : '')
        + escapeHtml(nextLine),
      buttons: [{ label: isTrial && UI.openResourceTrial ? '进入试炼' : '继续冒险',
                  onClick: () => { if (isTrial && UI.openResourceTrial) UI.openResourceTrial(); } }]
    });
  }

  // 交完引导任务：用对话气泡讲清"拿到什么、下一步要用"（替代原来只有一行 toast）
  function showGuideReward(q) {
    const pv = rewardPreviewOf(q);
    if (!pv || !UI.showDialog) return false;
    const g = guideOf(pv.next);
    UI.showDialog({
      icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"/></svg>',
      speaker: '引路人',
      text: `「${escapeHtml(q.name || '任务')}」完成，拿到 `
        + `<b>${escapeHtml(pv.labels.join('、'))}</b><br>`
        + `<span class="quest-next-use">这是下一步「${escapeHtml(pv.next.name)}」要用的</span>`,
      buttons: [{ label: g.btn || '去用掉它', onClick: () => goGuide(g, pv.next.area) }]
    });
    return true;
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
      if (q.kind === 'guide') continue;                // 引导任务由引导链负责，不重复钉
      const cat = cats().find(c => c.id === q.kind);
      items.push(Object.assign({}, q, { isTutorial: false, tag: cat ? cat.label : '任务' }));
    }
    /* 自动追踪（2026-09-10）：进度 ≥80% 的任务自己顶上来，玩家不用翻面板找"马上能交的"。
     * 手动钉的优先；格子不够时，自动的按进度从高到低往后排。 */
    if (items.length < TRACK_MAX) {
      const auto = all
        .filter(q => q.unlocked && !q.finished && q.kind !== 'guide' &&
                     q.need > 0 && q.progress / q.need >= AUTO_TRACK_RATIO &&
                     !items.some(it => it.id === q.id))
        .sort((a, b) => (b.progress / b.need) - (a.progress / a.need));
      for (const q of auto) {
        if (items.length >= TRACK_MAX) break;
        const cat = cats().find(c => c.id === q.kind);
        items.push(Object.assign({}, q, { isTutorial: false, tag: cat ? cat.label : '任务', auto: true }));
      }
    }
    /* 引导毕业交接（2026-09-10，业界惯例：引导结束 ≠ 没人管）：
     * 引导条消失的那一刻，追踪栏若空掉 = 玩家从"始终有人指路"突然变成"没人管"。
     * 补一条「下一步」= 第一个未完成的已解锁系列任务。玩家一旦自己钉了任务或
     * 有进度 ≥80% 的自动项，它就自动让位（低侵扰，不抢玩家自主权）。 */
    if (!items.length) {
      const next = all.find(q => q.kind === 'series' && q.unlocked && !q.finished);
      if (next) items.push(Object.assign({}, next, { isTutorial: false, tag: '下一步', handoff: true }));
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

  /* ---------- 顶栏「任务」按钮的总红点 ----------
   * 全分类「可提交」条数。玩家不打开面板就知道有奖可领；0 则移除红点。 */
  function renderQuestBadge() {
    const btn = document.querySelector('.top-btn[data-dialog="任务"]');
    if (!btn || !btn.querySelector) return;
    const n = (Quest && Quest.readyCount) ? Quest.readyCount() : 0;
    let dot = btn.querySelector('.quest-dot');
    if (n <= 0 || !document.createElement) { if (dot) dot.remove(); return; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'quest-dot'; if (btn.appendChild) btn.appendChild(dot); }
    dot.textContent = n > 99 ? '99+' : String(n);
  }

  /* ---------- 追踪栏折叠（2026-09-10：改成悬浮层后，收起状态要能在刷新后保留）----------
   * 收起后只剩一枚右上角胶囊：任务条数 + 可提交数（不打开就知道有没有奖可领）。
   * 状态存 localStorage（体验型标记，丢了大不了展开一次，不进云端）。 */
  const TRACK_COLLAPSE_KEY = 'fos_track_collapsed';
  let trackCollapsed = (function () {
    try { return localStorage.getItem(TRACK_COLLAPSE_KEY) === '1'; } catch (e) { return false; }
  })();
  function setTrackCollapsed(v) {
    trackCollapsed = !!v;
    try { localStorage.setItem(TRACK_COLLAPSE_KEY, trackCollapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 追踪栏拖动（2026-09-10：悬浮面板必须能挪，否则右上固定位会挡住要看的地方）----------
   * 不走 UI.makeDraggable：那是给居中弹窗的（mousedown 会把 left/top 归零再 transform，
   * 对 right:14px 定位的 fixed 面板会跳位）。这里直接改 left/top，位置存 localStorage。
   * 把手 = 标题栏左侧的 ⠿（.qt-grip），与「收起/展开」按钮分开职责，不用猜点击还是拖拽。
   * 越界钳位：至少留 60px 在屏幕内，不会拖丢。 */
  const TRACK_POS_KEY = 'fos_track_pos';
  let trackPos = (function () {
    try { const v = JSON.parse(localStorage.getItem(TRACK_POS_KEY) || 'null'); return (v && typeof v.left === 'number') ? v : null; }
    catch (e) { return null; }
  })();
  function applyTrackPos(bar) {
    // 没存过 → 用 CSS 默认位置；窄屏（<900px）走底部横条样式，不用宽屏存的坐标
    if (!trackPos || (typeof window !== 'undefined' && window.innerWidth < 900)) return;
    bar.style.left = trackPos.left + 'px';
    bar.style.top = trackPos.top + 'px';
    bar.style.right = 'auto';                 // 交出 right，改由 left 定位
  }
  function bindTrackerDrag(bar, handle) {
    if (!bar || !handle || handle.__dragBound) return;
    handle.__dragBound = true;
    /* 整条标题栏都能拖（只认 ⠿ 太小太淡，玩家根本不会去点它）。
     * 阈值 4px：没挪动 = 当成点折叠按钮；挪过了 = 拖完把随后的那次 click 吞掉，
     * 不会"拖完手一松就把面板收起来"。 */
    let moved = false;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = bar.getBoundingClientRect();
      const bx = r.left, by = r.top, sx = e.clientX, sy = e.clientY;
      moved = false;
      bar.style.left = bx + 'px'; bar.style.top = by + 'px'; bar.style.right = 'auto';
      e.preventDefault();
      const mv = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
        if (!moved) return;                       // 阈值内不动 → 让 click 正常触发（=折叠）
        const limX = window.innerWidth - 60, limY = window.innerHeight - 40;
        const nx = Math.min(Math.max(bx + dx, 60 - bar.offsetWidth), limX);
        const ny = Math.min(Math.max(by + dy, 0), limY);
        bar.style.left = nx + 'px'; bar.style.top = ny + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (!moved) return;
        const r2 = bar.getBoundingClientRect();
        trackPos = { left: Math.round(r2.left), top: Math.round(Math.max(0, r2.top)) };
        try { localStorage.setItem(TRACK_POS_KEY, JSON.stringify(trackPos)); } catch (er) { /* 忽略 */ }
        window.setTimeout(() => { moved = false; }, 0);   // click 派发完再复位
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    // 捕获阶段吞掉"拖完那一下"的 click，避免拖完顺手把面板收起
    handle.addEventListener('click', e => {
      if (!moved) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function renderQuestTracker() {
    renderQuestBadge();
    const bar = $('quest-tracker');
    if (!bar || !Quest) return;
    const items = trackerItems();
    if (!items.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }

    bar.style.display = '';
    const readyN = items.filter(it => it.done).length;
    bar.classList.toggle('is-collapsed', trackCollapsed);
    // 标题栏 = 左侧 ⠿ 拖动手柄 + 右侧折叠按钮（职责分开：拖就拖、点就点）
    const toggleHtml = `<div class="qt-head">`
      + `<span class="qt-grip" title="按住这里拖动，挪到不挡视线的位置">⠿</span>`
      + `<button type="button" class="qt-toggle" title="${trackCollapsed ? '展开任务列表' : '收起任务列表（不再占屏幕）'}">`
      + (trackCollapsed
        ? `<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg> 任务 ${items.length}${readyN ? ' · <b>可提交 ' + readyN + '</b>' : ''}`
        : `任务 ${items.length}${readyN ? ' · <b>可提交 ' + readyN + '</b>' : ''} ▾`)
      + `</button></div>`;
    bar.innerHTML = toggleHtml + '<div class="qt-list">' + items.map(it => {
      const pct = it.need ? Math.min(100, Math.round(it.progress / it.need * 100)) : 0;
      const g = guideOf(it);
      // 补发钥匙（2026-09-08 补给箱重构）：这一关的钥匙被花掉/卖掉 → 引导条给手动补发，
      // 每关每种限 1 次（账本）。不显示 = 不缺，别让按钮常驻打扰。
      const T = window.TutorialMode;
      const missing = (it.isTutorial && T && T.missingKeysFor) ? T.missingKeysFor(it.id) : [];
      const reissueBtn = (missing.length && T && T.reissueKeys)
        ? `<button class="btn-mini ghost qt-reissue" data-id="${it.id}" title="${escapeHtml('钥匙弄丢了？补一次（每关每种限 1 次）：' + missing.map(m => m.name || m.key).join('、'))}">补钥匙</button>`
        : '';
      const choiceActs = it.isTutorial && it.type === 'direction' && !it.done && Array.isArray(it.options)
        ? `<div class="qt-choices">${it.options.map(o => `<button class="btn-mini ${o.id === 'map' ? 'primary' : 'ghost'} qt-direction" data-id="${escapeHtml(o.id)}" title="${escapeHtml(o.desc || '')}">${escapeHtml(o.label)}</button>`).join('')}<button class="btn-mini ghost qt-skip" title="跳过新手引导">跳过</button></div>`
        : '';
      const acts = choiceActs || (
        // 主按钮两态（动词前置）：完成 → 原地直接提交（引导任务叫「领取奖励」）；未完成 → 去做
        it.done
          ? `<button class="btn-mini primary qt-submit" data-id="${it.id}">${it.isTutorial ? '领取奖励' : '提交'}</button>`
          : `<button class="btn-mini ${it.isTutorial ? 'primary' : 'ghost'} qt-go" data-id="${it.id}">${escapeHtml(g.btn)}</button>`
      ) + (it.isTutorial
        ? `${it.done ? '' : reissueBtn}<button class="btn-mini ghost qt-skip" title="跳过新手引导">跳过</button>`
        : (it.handoff
            // 「下一步」交接项不在玩家追踪列表里 → 没有 × 取消钮（取消不了"主线下一步"）
            ? ''
            : `<button class="btn-mini ghost qt-untrack" data-id="${it.id}" title="取消追踪">×</button>`));
      // 奖励即钥匙：引导条上常驻一行"完成可得什么、下一步是谁要用的"
      const pv = it.isTutorial ? rewardPreviewOf(it) : null;
      const rewardRow = pv
        ? `<div class="qt-reward">完成可得 ${escapeHtml(pv.labels.join('、'))} <span class="quest-next-use">→ 下一步「${escapeHtml(pv.next.name)}」要用</span></div>`
        : (it.isTutorial && it.id === 'n6' ? '<div class="qt-reward">完成后：引导结束，进入正常游戏节奏</div>' : '');
      return `<div class="qt-item${it.done ? ' qt-done' : ''}${it.auto ? ' qt-auto' : ''}"${it.auto ? ' title="自动追踪：进度已到 80%"' : ''} data-id="${it.id}">
        <div class="qt-row">
          <span class="qt-tag qt-tag--${escapeHtml(it.kind || 'series')}">${escapeHtml(it.tag)}</span>
          ${it.isTutorial && it.guideStep ? `<span class="qt-step">引导 ${it.guideStep}/${it.guideTotal}</span>` : ''}
          <span class="qt-name">${escapeHtml(it.name)}</span>
          <span class="qt-actions">${acts}</span>
        </div>
        <div class="qt-sub">
          <div class="qt-bar"><div class="qt-bar-fill" style="width:${pct}%"></div></div>
          <span class="qt-prog">${it.done ? '可提交' : progressText(it)}</span>
        </div>
        ${it.isTutorial ? `<div class="qt-hint"><b>现在：</b>${it.hint || escapeHtml(taskDesc(it))}</div><div class="qt-why"><b>为什么：</b>${it.npc || '理解这一环，下一环会更清楚。'}</div>` : ''}
        ${rewardRow}
      </div>`;
    }).join('') + '</div>';

    applyTrackPos(bar);
    bindTrackerDrag(bar, bar.querySelector('.qt-head'));   // 整条标题栏 = 拖动把手
    const toggleBtn = bar.querySelector('.qt-toggle');
    if (toggleBtn) {
      toggleBtn.onclick = () => { setTrackCollapsed(!trackCollapsed); renderQuestTracker(); };
    }
    bar.querySelectorAll('.qt-go').forEach(b => {
      b.onclick = () => {
        const it = items.find(x => x.id === b.dataset.id);
        if (!it) return;
        guideHint(it);                  // 先弹引路人的"为什么"，再跳到该去的页
        goGuide(guideOf(it), it.area);
      };
    });
    bar.querySelectorAll('.qt-direction').forEach(b => {
      b.onclick = async () => {
        const r = Quest.chooseGuideDirection ? Quest.chooseGuideDirection(b.dataset.id) : { error: '方向选择不可用' };
        if (!r || r.error) { if (UI.showToast) UI.showToast('方向未选择', r && r.error); return; }
        const done = await Quest.completeQuest('n6');
        if (done && done.error) { if (UI.showToast) UI.showToast('引导未结束', done.error); return; }
        if (UI.renderAll) UI.renderAll();
        renderQuestTracker();
        // 毕业结算弹窗（替代原来的一条 toast）：学会回顾 + 毕业礼包 + 按所选方向预告下一步。
        // 选了试炼的玩家点弹窗按钮直达试炼入口，不再交完就悄悄打开。
        showGuideGraduation(b.dataset.id);
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
        // 引导条交任务：优先弹"奖励即钥匙"（拿到什么 + 下一步要用 + 一键跳过去）
        const it = items.find(x => x.id === b.dataset.id);
        if (!(it && showGuideReward(it)) && UI.showToast && r) UI.showToast('任务完成', '奖励：' + (r.rewards || []).join('、'));
        if (UI.renderAll) UI.renderAll();
        renderQuestTracker();
      };
    });
    const skip = bar.querySelector('.qt-skip');
    if (skip) skip.onclick = () => { if (Quest.skipGuide) Quest.skipGuide(); renderQuestTracker(); };
    // 补发钥匙：账本限每关每种 1 次；重复点会被 grantOnce 拦下并提示
    bar.querySelectorAll('.qt-reissue').forEach(b => {
      b.onclick = async () => {
        const T = window.TutorialMode;
        if (!T || !T.reissueKeys) return;
        const label = b.textContent;
        b.disabled = true;
        b.textContent = '补发中…';
        let r;
        try { r = await T.reissueKeys(b.dataset.id); }
        finally { b.disabled = false; b.textContent = label; }
        if (r && r.error) { if (UI.showToast) UI.showToast('无法补发', r.error); }
        else if (r && r.skipped) { if (UI.showToast) UI.showToast('不缺钥匙', '这一关的钥匙都在，直接做任务吧'); }
        else if (r && r.ok) { if (UI.showToast) UI.showToast('钥匙已补发', (r.granted || []).join('、')); }
        else { if (UI.showToast) UI.showToast('补发未完成', ((r && r.blocked) || []).join('；') || '该钥匙已补发过一次'); }
        renderQuestTracker();
      };
    });
    bar.querySelectorAll('.qt-untrack').forEach(b => {
      b.onclick = () => { Quest.toggleTrack(b.dataset.id); renderQuestTracker(); };
    });
  }

  /* ---------- 面板开关（左侧滑出抽屉，动画节奏对齐装备打造 craft-drawer） ---------- */
  function openQuestPanel() {
    renderQuestPanel();
    renderQuestBadge();
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
  window.UI.renderQuestBadge = renderQuestBadge;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initQuestUI);
  }
})();
