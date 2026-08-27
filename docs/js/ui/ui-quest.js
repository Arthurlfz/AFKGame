/* ============================================================
 * ui-quest.js —— 任务面板 UI（接 quest.js）
 * 分栏布局：左栏任务列表（按地图分类），右栏任务详情（需求 + 奖励）。
 * 接取：标记已接；提交：材料够则扣材料+发奖励（Quest.completeQuest）。
 * 依赖：quest.js、ui-common(showToast)
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;
  const Quest = window.Quest;
  const $ = id => document.getElementById(id);

  const TYPE_LABEL = { collect: '收集', evolve: '进化', kill: '击败' };

  function areaName(areaId) {
    const a = (Config.battle.areas || []).find(x => x.id === areaId);
    return a ? a.name : areaId;
  }

  // 当前选中的任务 id
  let selectedQuestId = null;

  // 任务需求描述
  function taskDesc(q) {
    if (q.type === 'collect') return `收集「${q.matName}」×${q.need}`;
    if (q.type === 'evolve') return `进化宠物 ${q.need} 次`;
    if (q.type === 'kill') return `在「${areaName(q.area)}」击败 ${q.need} 只怪`;
    return `进度 ${q.need}`;
  }

  // 任务详情：需求列表 + 奖励物品
  function detailHtml(q) {
    const pct = q.need ? Math.min(100, Math.round(q.progress / q.need * 100)) : 0;
    const locked = !q.unlocked;
    const done = q.done;
    const stateText = locked ? '未解锁' : done ? '可提交' : (q.accepted ? '进行中' : '未接取');

    // 需求条目
    const needRows = [];
    if (q.type === 'collect') needRows.push(`收集材料「${q.matName}」`);
    if (q.type === 'evolve') needRows.push(`完成进化`);
    if (q.type === 'kill') needRows.push(`击败怪物`);

    // 奖励物品
    const rewardRows = Object.entries(q.reward || {}).map(([n, a]) => `${n} ×${a}`);

    return `
      <div class="quest-detail">
        <div class="quest-detail-title">${q.type === 'collect' ? '收集任务' : q.type === 'evolve' ? '进化任务' : '击败任务'} · ${areaName(q.area)}</div>
        <div class="quest-detail-state ${locked ? 'q-locked' : done ? 'q-done' : 'q-active'}">${stateText}</div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">任务需求</div>
          <div class="quest-detail-text">${taskDesc(q)}</div>
          <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
          <div class="quest-detail-text">进度 ${q.progress} / ${q.need}</div>
          ${needRows.map(r => `<div class="quest-detail-row">${r}</div>`).join('')}
        </div>
        <div class="quest-detail-sec">
          <div class="quest-detail-head">奖励物品</div>
          ${rewardRows.length ? rewardRows.map(r => `<div class="quest-reward-row">${r}</div>`).join('') : '<div class="quest-detail-text">—</div>'}
        </div>
        <div class="quest-actions">
          ${locked ? '<div class="quest-detail-text">通关对应地图后解锁</div>' :
            done ? `<button class="btn-mini primary quest-submit" data-id="${q.id}">提交任务</button>` :
              `<button class="btn-mini ghost quest-accept" data-id="${q.id}" ${q.accepted ? 'disabled' : ''}>${q.accepted ? '已接取' : '接取任务'}</button>`}
        </div>
      </div>`;
  }

  // 左栏：任务列表，按地图分类
  function renderQuestPanel() {
    const body = $('quest-body');
    if (!body) return;
    const quests = Quest.getQuests();
    if (!quests.length) { body.innerHTML = '<div class="merge-preview">暂无任务</div>'; return; }

    // 选中的任务：默认第一个
    if (!selectedQuestId || !quests.find(q => q.id === selectedQuestId)) {
      selectedQuestId = quests[0].id;
    }
    const selected = quests.find(q => q.id === selectedQuestId);

    // 按地图分组
    const groups = {};
    quests.forEach(q => {
      const key = areaName(q.area);
      (groups[key] = groups[key] || []).push(q);
    });

    // 左栏列表
    const listHtml = Object.keys(groups).map(key => {
      const list = groups[key];
      return `
        <div class="quest-group">
          <div class="quest-group-title">${key}</div>
          ${list.map(q => {
            const pct = q.need ? Math.min(100, Math.round(q.progress / q.need * 100)) : 0;
            const sel = q.id === selectedQuestId ? ' quest-list-item--active' : '';
            return `<div class="quest-list-item${sel}" data-id="${q.id}">
              <div class="quest-list-name">${TYPE_LABEL[q.type] || q.type}任务</div>
              <div class="quest-progress"><div class="quest-progress-bar" style="width:${pct}%"></div></div>
              <div class="quest-list-meta">${q.progress}/${q.need} · ${!q.unlocked ? '未解锁' : q.done ? '可提交' : (q.accepted ? '进行中' : '未接取')}</div>
            </div>`;
          }).join('')}
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="quest-layout">
        <div class="quest-list">${listHtml}</div>
        <div class="quest-detail-col">${detailHtml(selected)}</div>
      </div>`;

    // 绑定：点列表项选中
    body.querySelectorAll('.quest-list-item').forEach(item => {
      item.onclick = () => { selectedQuestId = item.dataset.id; renderQuestPanel(); };
    });
    // 绑定：接取/提交
    body.querySelectorAll('.quest-accept').forEach(btn => {
      btn.onclick = () => { Quest.acceptQuest(btn.dataset.id); renderQuestPanel(); };
    });
    body.querySelectorAll('.quest-submit').forEach(btn => {
      btn.onclick = async () => {
        const r = await Quest.completeQuest(btn.dataset.id);
        if (r.error) { (window.UI && UI.showToast) ? UI.showToast('任务失败', r.error) : alert(r.error); return; }
        if (window.UI && UI.showToast) UI.showToast('任务完成', '奖励：' + r.rewards.join('、'));
        renderQuestPanel();
      };
    });
  }

  // 拖拽（标题栏）
  function enableDrag() {
    const panel = $('quest-panel');
    const head = $('quest-panel-head');
    if (!panel || !head) return;
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.quest-panel-close')) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const left0 = panel.offsetLeft, top0 = panel.offsetTop;
      const onMove = (ev) => {
        panel.style.left = (left0 + ev.clientX - startX) + 'px';
        panel.style.top = (top0 + ev.clientY - startY) + 'px';
        panel.style.transform = 'none';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function openQuestPanel() {
    renderQuestPanel();
    const panel = $('quest-panel');
    if (panel) panel.style.display = 'flex';
  }
  function closeQuestPanel() {
    const panel = $('quest-panel');
    if (panel) panel.style.display = 'none';
  }

  function initQuestUI() {
    const panel = $('quest-panel');
    const cancel = $('quest-cancel');
    if (cancel) cancel.onclick = closeQuestPanel;
    enableDrag();
    const taskBtn = document.querySelector('.top-btn[data-dialog="任务"]');
    if (taskBtn) taskBtn.onclick = openQuestPanel;
  }

  window.UI = window.UI || {};
  window.UI.openQuestPanel = openQuestPanel;
  window.UI.closeQuestPanel = closeQuestPanel;
  window.UI.initQuestUI = initQuestUI;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initQuestUI);
  }
})();
