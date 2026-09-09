(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = value => UI.escapeHtml ? UI.escapeHtml(String(value || '')) : String(value || '');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* 每场战斗的演出时长（视觉节奏）。逻辑节奏交给 ResourceTrial.start 的 instant 选项，
   * 由本层 onRound 控制「每场画面停留多久」，让玩家看得清战斗过程（5 场约 5.5 秒）。 */
  const ROUND_VISUAL_MS = 1100;

  /* 试炼会话来源：node = 大地图副本节点；panel = 标题栏「资源副本」面板。
   * 结算面板的「返回副本」按来源导航（节点→回节点详情页；面板→回面板）。 */
  let session = { from: 'node', point: null };

  // 刷新所有入口展示：面板 + 大地图副本节点徽标（每次进页 / 每次试炼结束后调用）
  function refreshAll() {
    try { renderResourceTrial(); } catch (e) { /* 面板不在当前页面时忽略 */ }
    if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
  }

  /* 单条路线的进入资格文案（免费剩余 / 门票数量） */
  function entryLine(routeId) {
    const T = window.ResourceTrial;
    const info = (T && T.entryInfo) ? T.entryInfo(routeId) : { freeLeft: 0, freePerDay: 0, ticketQty: 0 };
    const freeTxt = info.freePerDay > 0
      ? `今日免费 <b>${info.freeLeft}/${info.freePerDay}</b>`
      : '门票模式';
    return `${freeTxt} · 门票 <b>${info.ticketQty}</b>`;
  }

  /* 开始按钮的文案与可用性（免费优先，用尽后门票） */
  function goLabel(routeId) {
    const T = window.ResourceTrial;
    const info = (T && T.entryInfo) ? T.entryInfo(routeId) : null;
    const route = T && T.routeOf ? T.routeOf(routeId) : null;
    const pet = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    if (!info || !route) return { label: '开始试炼', disabled: true };
    const canFree = info.freeLeft > 0;
    const canTicket = info.ticketQty > 0;
    const levelOk = !!(pet && (Number(pet.level) || 1) >= (Number(route.minLevel) || 1));
    const label = canFree ? `免费进入（剩 ${info.freeLeft} 次）` : (canTicket ? '消耗门票进入' : '免费次数用尽 · 需门票');
    return { label, disabled: !(levelOk && (canFree || canTicket)) };
  }

  /* ---------- 面板（世界地图标题栏「资源副本」入口，也是引导 N6 的落点） ---------- */
  function renderResourceTrial() {
    const panel = $('resource-trial-panel');
    const T = window.ResourceTrial;
    if (!panel || !T) return;
    const state = T.getState();
    const cfg = window.Config.resourceTrials || {};
    const ticket = cfg.ticketName || '资源试炼门票';
    const qty = window.Materials ? window.Materials.getQuantity(ticket) : 0;
    const current = state.route;
    const source = esc(cfg.ticketSources || '');
    const freePerDay = Number(cfg.freeEntriesPerDay) || 0;
    panel.innerHTML = `<div class="resource-trial-head"><div><h2>资源副本</h2><p>三个定向资源副本：蜕变 / 涅槃 / 淬炼。每天北京时间 12:00 刷新免费进入次数，免费次数用尽后可消耗 1 张门票继续进入。普通地图掉什么随缘，副本里掉什么是你选的。</p></div><button class="fs-btn fs-btn--ghost" id="resource-trial-close">关闭</button></div>
      <div class="resource-trial-ticket">${esc(ticket)}：<b>${qty}</b>${source ? ` · 来源：${source}` : ''}${freePerDay > 0 ? ` · 每副本每日免费 <b>${freePerDay}</b> 次（北京时间 12:00 刷新）` : ''}${state.running ? ` · 正在进行：${esc(current && current.name)} ${state.round}/${cfg.rounds || 5}` : ''}</div>
      <div class="resource-trial-routes">${T.routes().map(route => {
        const gl = goLabel(route.id);
        return `<article class="resource-trial-card"><h3>${esc(route.name)}</h3><p>${esc(route.desc)}</p><small>最低等级：Lv${route.minLevel || 1} · ${entryLine(route.id)}</small><button class="fs-btn fs-btn--primary resource-trial-start" data-route="${esc(route.id)}" ${state.running || gl.disabled ? 'disabled' : ''}>${esc(gl.label)}</button></article>`;
      }).join('')}</div>
      ${state.result ? `<div class="resource-trial-result ${state.result.cleared ? 'is-clear' : 'is-fail'}">${state.result.cleared ? `✓ 通关 ${state.result.rounds || 5} 场（剩余血量 ${state.result.hpPercent || 0}%）` : `第 ${(state.result.rounds || 0) + 1} 场倒下，强度不足`} · 奖励：${esc((Array.isArray(state.result.reward) ? state.result.reward : [state.result.reward]).map(item => `${item.name}×${item.qty}`).join('、'))}</div>` : ''}`;
    $('resource-trial-close').onclick = () => { panel.hidden = true; };
    /* 铁律：await 之后的 UI 状态必须兜底复原。
     * 旧写法 button.disabled = true 后没有任何 catch —— start 一旦抛错（材料系统异常、
     * 渲染异常）按钮永久卡死，玩家以为功能坏了。成功/失败/异常三条路都要把按钮放回来。 */
    panel.querySelectorAll('.resource-trial-start').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const route = T.routeOf(button.dataset.route);
          if (route) await startTrialBattle(route, { from: 'panel' });
        } catch (e) {
          if (window.UI && window.UI.showToast) window.UI.showToast('副本异常', (e && e.message) || '未知错误');
        } finally {
          refreshAll();
        }
      };
    });
  }

  function openResourceTrial() {
    const panel = $('resource-trial-panel');
    if (!panel) return;
    panel.hidden = false;
    renderResourceTrial();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 副本节点详情页（2026-09-09）：点击大地图上的副本节点进入 ----------
   * 复用野图节点详情页的容器（#area-detail），结构与野图一致：介绍 / 选宠 / 资格 / 进入。 */
  function trialDetailHTML(route, point) {
    const T = window.ResourceTrial;
    const info = (T && T.entryInfo) ? T.entryInfo(route.id) : { freeLeft: 0, freePerDay: 0, used: 0, ticketName: '', ticketQty: 0 };
    const cfg = window.Config.resourceTrials || {};
    const tiersHtml = (Array.isArray(route.tiers) ? route.tiers : []).map(t =>
      `<div class="nd-boss-row"><span class="k">Lv${t.minLevel || 1}+</span><span class="v">${esc((t.items || []).map(i => `${i.name}×${i.qty}`).join('、'))}</span></div>`
    ).join('') || '<div class="nd-boss-row"><span class="v">—</span></div>';
    const cons = esc((Array.isArray(route.consolation) ? route.consolation : []).map(i => `${i.name}×${i.qty}`).join('、') || '重铸石×1');
    // 出战宠物选择（与野图详情页同口径）
    const Pet = window.Pet;
    const pets = (Pet && Pet.getPets) ? Pet.getPets() : [];
    const active = (Pet && Pet.getActivePet) ? Pet.getActivePet() : null;
    const spriteOf = name => (window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(name) : null;
    const petHtml = pets.map(p => {
      const god = (Pet && Pet.isGodPet) ? Pet.isGodPet(p) : !!p.isGodPet;
      const growth = (p.growth || 0).toFixed(1);
      const meta = god ? '' : `<div class="p-meta">Lv.${p.level || 1} · 成长${growth}</div>`;
      const godTxt = god ? '<div class="p-god">★ 神级</div>' : '';
      const pAv = spriteOf(p.name);
      return `<div class="nd-pet${active && active.id === p.id ? ' active' : ''}${god ? ' god' : ''}" data-pid="${p.id}">
        <div class="p-ic">${pAv ? '<img src="' + pAv + '" alt="">' : ''}</div>
        <div class="p-nm">${esc(p.name)}</div>${meta}${godTxt}
      </div>`;
    }).join('') || '<div class="nd-pet"><div class="p-nm">还没有宠物</div></div>';
    const activeInfo = active
      ? `出战：<b>${esc(active.name)}</b> · 成长 <b>${(active.growth || 0).toFixed(1)}</b>`
      : '还没有出战宠物';
    const levelOk = !!(active && (Number(active.level) || 1) >= (Number(route.minLevel) || 1));
    const canFree = info.freeLeft > 0;
    const canTicket = info.ticketQty > 0;
    const goDisabled = !(levelOk && (canFree || canTicket));
    const goLabel = canFree ? `免费进入（剩 ${info.freeLeft} 次）` : (canTicket ? '消耗门票进入' : '免费次数用尽 · 需门票');
    const freeClass = info.freeLeft > 0 ? '' : ' warn';

    return `
      <div class="nd-top">
        <div class="nd-title">${esc(route.name)}</div>
        <div class="nd-sub">
          <span>资源副本</span>
          <span>最低等级 <b>Lv${route.minLevel || 1}</b></span>
          <span>连续 <b>${cfg.rounds || 5}</b> 场</span>
        </div>
        <button type="button" class="nd-back" id="nd-back">← 返回大地图</button>
      </div>
      <div class="nd-grid">
        <div class="nd-card">
          <div class="nd-card-title">副本介绍<span class="hint">打什么、掉什么</span></div>
          <p class="nd-desc">${esc(route.desc)}</p>
          <div class="nd-card-title" style="margin-top:14px">奖励预览<span class="hint">按宠物等级取最高档</span></div>
          <div class="nd-boss-rows">${tiersHtml}</div>
          <div class="nd-card-title" style="margin-top:14px">失败补偿</div>
          <div class="nd-boss-rows"><div class="nd-boss-row"><span class="k">少量</span><span class="v">${cons}</span></div></div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">选择战斗宠物<span class="hint">点击切换出战</span></div>
          <div class="nd-pets">${petHtml}</div>
          <div class="nd-active-row"><span>${activeInfo}</span><span class="tag">可出战</span></div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">今日进入次数<span class="hint">北京时间 12:00 刷新</span></div>
          <div class="nd-boss-rows">
            <div class="nd-boss-row"><span class="k">免费</span><span class="v${freeClass}">${info.freeLeft}/${info.freePerDay || '—'}</span></div>
            <div class="nd-boss-row"><span class="k">门票</span><span class="v">${esc(info.ticketName || '资源试炼门票')} × ${info.ticketQty}</span></div>
            <div class="nd-boss-row"><span class="k">刷新</span><span class="v">每日 12:00（北京时间）</span></div>
          </div>
          <div class="nd-ticket-tip">免费次数用尽后，消耗 1 张门票可继续进入副本。${!levelOk ? `需要出战宠物达到 Lv${route.minLevel || 1}` : ''}</div>
        </div>
      </div>
      <div class="nd-foot">
        <span class="tip">中途失败不回退次数/门票，给少量本副本补偿 · <b>门票来自地图委托</b></span>
        <button type="button" class="nd-go" id="nd-trial-go" ${goDisabled ? 'disabled' : ''}>⚔ ${esc(goLabel)}</button>
      </div>`;
  }

  function showTrialDetail(point) {
    const el = $('area-detail');
    const body = $('area-detail-body');
    const T = window.ResourceTrial;
    if (!el || !body || !T || !point || !point.routeId) {
      // 容器或配置缺失时退回面板（老页面结构 / 异常状态兜底）
      if (window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial();
      return;
    }
    const route = T.routeOf(point.routeId);
    if (!route) {
      if (window.UI && window.UI.showToast) window.UI.showToast('副本不存在', '该副本配置缺失。');
      return;
    }
    body.innerHTML = trialDetailHTML(route, point);
    el.hidden = false;
    // 返回大地图
    const back = body.querySelector('#nd-back');
    if (back) back.onclick = () => { el.hidden = true; };
    // 出战宠物切换：点击头像 setActive 后重渲染详情页（与野图详情页同口径）
    body.querySelectorAll('.nd-pet').forEach(card => {
      card.onclick = () => {
        const pid = card.dataset.pid;
        if (!pid || !window.Pet || !window.Pet.setActive) return;
        window.Pet.setActive(pid);
        showTrialDetail(point);
      };
    });
    // 进入试炼：免费优先，用尽后门票 → 先看战斗画面，打完弹结算面板
    const go = body.querySelector('#nd-trial-go');
    if (go) {
      go.onclick = async () => {
        go.disabled = true;
        try {
          await startTrialBattle(route, { from: 'node', point });
        } catch (e) {
          if (window.UI && window.UI.showToast) window.UI.showToast('副本异常', (e && e.message) || '未知错误');
        } finally {
          if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
        }
      };
    }
    if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
  }

  /* ============================================================
   * 试炼战斗画面（2026-09-09）：进入副本后先看战斗，再弹结算面板。
   * 布局：上方标题/场次，中间敌我双方（立绘 + 血条），下方战斗日志。
   * 数据完全来自 ResourceTrial.roundResult 的逐场结果（turns/taken/hpLeft/damage/enemyHp），
   * UI 只做表现，不改任何数值。
   * ============================================================ */
  function trialBattleHTML(route, pet) {
    const cfg = window.Config.resourceTrials || {};
    const total = cfg.rounds || 5;
    const g = (route.guardian && route.guardian.name) ? route.guardian : { name: '试炼之影', title: '神秘守护者' };
    const gName = `${g.title || '守护者'} · ${g.name}`;
    const spriteOf = name => (window.PetSprites && window.PetSprites.pathOf) ? window.PetSprites.pathOf(name) : null;
    const petSprite = spriteOf(pet && pet.name);
    const gSprite = spriteOf(g.name);
    return `<div class="trial-battle" data-route-id="${esc(route.id)}">
      <div class="tb-top">
        <span class="tb-name">⚔ ${esc(route.name)}</span>
        <span class="tb-round">第 <b id="tb-round">1</b>/<span id="tb-round-total">${total}</span> 场</span>
        <button type="button" class="tb-close" id="tb-close" title="离开战斗画面（试炼仍会继续，结束后弹结算）">✕</button>
      </div>
      <div class="tb-stage" id="tb-stage">
        <div class="tb-side">
          <div class="tb-sprite" id="tb-pet-sprite">${petSprite ? '<img src="' + petSprite + '" alt="">' : ''}</div>
          <div class="tb-label" id="tb-pet-name">${esc(pet ? pet.name : '出战宠物')}</div>
          <div class="tb-hp-track"><div class="tb-hp-fill tb-hp-fill--pet" id="tb-pet-hp"></div></div>
          <div class="tb-hp-num" id="tb-pet-hp-text"></div>
        </div>
        <div class="tb-vs">VS</div>
        <div class="tb-side">
          <div class="tb-sprite" id="tb-enemy-sprite">${gSprite ? '<img src="' + gSprite + '" alt="">' : ''}</div>
          <div class="tb-label" id="tb-enemy-name">${esc(gName)}</div>
          <div class="tb-hp-track"><div class="tb-hp-fill tb-hp-fill--enemy" id="tb-enemy-hp"></div></div>
          <div class="tb-hp-num" id="tb-enemy-hp-text"></div>
        </div>
      </div>
      <div class="tb-log" id="tb-log"></div>
    </div>`;
  }

  function initBattleView(route) {
    const petBar = $('tb-pet-hp');
    if (petBar) petBar.style.width = '100%';
    const petTxt = $('tb-pet-hp-text');
    if (petTxt) petTxt.textContent = '剩余 100%';
    const enemyBar = $('tb-enemy-hp');
    if (enemyBar) enemyBar.style.width = '100%';
    const enemyTxt = $('tb-enemy-hp-text');
    if (enemyTxt) enemyTxt.textContent = '100%';
    const close = $('tb-close');
    if (close) close.onclick = () => { const el = $('area-detail'); if (el) el.hidden = true; };
    const log = $('tb-log');
    if (log) log.innerHTML = `<div class="tb-log-line">🗡 试炼开始：连续挑战 ${window.Config.resourceTrials.rounds || 5} 场，血量跨场累计、不回满</div>`;
  }

  /* 每场战斗演出：血条/场次/日志/受击闪光（纯表现，数值来自 roundResult） */
  function updateTrialRound(result, route) {
    const roundEl = $('tb-round');
    if (roundEl) roundEl.textContent = String(result.round);
    // 敌方血条：本场从满血被打到 0（回合越多打得越久）
    const enemyBar = $('tb-enemy-hp');
    if (enemyBar) {
      enemyBar.style.transitionDuration = Math.min(1.5, 0.35 + (result.turns || 1) * 0.1) + 's';
      enemyBar.style.width = '0%';
    }
    const enemyTxt = $('tb-enemy-hp-text');
    if (enemyTxt) enemyTxt.textContent = result.success ? '守关者被击退' : '守关者安然无恙';
    // 我方血条：跨场累计（剩余百分比）
    const pct = result.maxHp > 0 ? Math.max(0, Math.round(result.hpLeft / result.maxHp * 100)) : 0;
    const petBar = $('tb-pet-hp');
    if (petBar) {
      petBar.style.transitionDuration = '0.45s';
      petBar.style.width = pct + '%';
      if (petBar.classList && typeof petBar.classList.toggle === 'function') petBar.classList.toggle('is-low', pct <= 25);
    }
    const petTxt = $('tb-pet-hp-text');
    if (petTxt) petTxt.textContent = '剩余 ' + pct + '%';
    // 受击闪光（短命 class，CSS 播完自动消失）
    const stage = $('tb-stage');
    if (stage && stage.classList) {
      stage.classList.add('tb-hit');
      setTimeout(() => { if (stage.classList) stage.classList.remove('tb-hit'); }, 260);
    }
    // 战斗日志
    const log = $('tb-log');
    if (log) {
      const line = document.createElement('div');
      line.className = 'tb-log-line' + (result.success ? '' : ' is-fail');
      line.innerHTML = (result.success ? '⚔' : '💀') +
        ` 第 ${result.round} 场 · 你连续攻击 ${result.turns} 回合，造成 ${result.damage} 点伤害（守关者 ${result.enemyHp} 血）` +
        (result.success ? `，击退守关者！你受到 ${result.taken} 点伤害（剩余 ${pct}%）` : `，在第 ${result.turns} 回合被击倒…… 试炼结束`);
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ---------- 结算面板（2026-09-09）：打完副本后弹出 ---------- */
  function showTrialSettle(result, route) {
    const wrap = $('trial-settle');
    const card = $('trial-settle-card');
    if (!wrap || !card) { // 老页面结构没有结算容器：退回入口
      backToEntry(route);
      return;
    }
    const cleared = !!(result && result.ok !== false && result.cleared);
    const rewards = (result && result.reward)
      ? (Array.isArray(result.reward) ? result.reward : [result.reward]) : [];
    const info = (window.ResourceTrial && window.ResourceTrial.entryInfo)
      ? window.ResourceTrial.entryInfo(route.id) : null;
    const consumedTxt = result && result.consumed === 'ticket'
      ? '门票 ×1' : (info && info.freePerDay > 0 ? '免费进入' : '门票 ×0');
    const freeTxt = info ? `今日免费剩余 ${info.freeLeft}/${info.freePerDay || '—'}` : '';
    card.innerHTML = `
      <div class="ts-badge ${cleared ? 'is-clear' : 'is-fail'}">${cleared ? '✓ 通关' : '✕ 试炼结束'}</div>
      <div class="ts-title">${esc(route.name)}</div>
      <div class="ts-stat">连续挑战 <b>${result.rounds || 0}</b>/${window.Config.resourceTrials.rounds || 5} 场 · 剩余血量 <b>${result.hpPercent || 0}%</b></div>
      <div class="ts-reward">
        <div class="ts-reward-h">${cleared ? '战斗奖励（已入背包）' : '失败补偿（已入背包）'}</div>
        <div class="ts-reward-list">${rewards.map(item => `<span class="ts-item">${esc(item.name)} ×${item.qty}</span>`).join('') || '<span class="ts-item">—</span>'}</div>
      </div>
      <div class="ts-note">消耗：${consumedTxt}${freeTxt ? ' · ' + freeTxt : ''}</div>
      <div class="ts-actions">
        <button type="button" class="fs-btn fs-btn--primary" id="ts-again">再打一次</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="ts-back">返回副本</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="ts-close">关闭</button>
      </div>`;
    wrap.hidden = false;
    bindSettle(route);
  }

  function bindSettle(route) {
    const wrap = $('trial-settle');
    if (!wrap) return;
    const again = $('ts-again');
    if (again) again.onclick = () => {
      wrap.hidden = true;
      startTrialBattle(route, { from: session.from, point: session.point });
    };
    const back = $('ts-back');
    if (back) back.onclick = () => { wrap.hidden = true; backToEntry(route); };
    const close = $('ts-close');
    if (close) close.onclick = () => {
      wrap.hidden = true;
      const el = $('area-detail');
      if (el) el.hidden = true;
      if (session.from === 'panel' && window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial();
    };
  }

  /* 结算后返回：节点来源 → 副本详情页；面板来源 → 资源副本面板 */
  function backToEntry(route) {
    if (session.from === 'panel') {
      if (window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial();
      return;
    }
    if (session.point && window.UI && window.UI.showTrialDetail) window.UI.showTrialDetail(session.point);
  }

  /* ---------- 试炼主流程（2026-09-09）：战斗画面 → 结算面板 ----------
   * 面板与节点详情页的「开始」按钮都走这里。全程走 ResourceTrial.start：
   * 免费次数优先，用尽后扣门票，等级不够在扣任何东西之前拦截（都在 core 层保证）。
   * 本层用 onRound 逐场渲染战斗画面，打完再弹结算面板。 */
  async function startTrialBattle(route, opts) {
    const T = window.ResourceTrial;
    opts = opts || {};
    if (!T) return;
    const r = (typeof route === 'string') ? T.routeOf(route) : route;
    if (!r) {
      if (window.UI && window.UI.showToast) window.UI.showToast('副本不存在', '该副本配置缺失。');
      return;
    }
    session = { from: opts.from || session.from, point: opts.point || session.point };
    // 面板入口：先收起面板，进入节点战斗画面
    if (session.from === 'panel') {
      const panel = $('resource-trial-panel');
      if (panel) panel.hidden = true;
    }
    const el = $('area-detail');
    const body = $('area-detail-body');
    if (!el || !body) { // 容器缺失（老页面结构）：退回面板
      if (session.from === 'panel' && window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial();
      return;
    }
    const pet = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    body.innerHTML = trialBattleHTML(r, pet);
    el.hidden = false;
    initBattleView(r);
    try {
      const res = await T.start(r.id, {
        instant: true, // 逻辑不等待，节奏交给 onRound 的画面演出
        onRound: async result => { updateTrialRound(result, r); await wait(ROUND_VISUAL_MS); }
      });
      if (!res || res.ok === false) {
        if (window.UI && window.UI.showToast) window.UI.showToast('无法进入副本', (res && res.error) || '未知原因');
        backToEntry(r);
        return;
      }
      showTrialSettle(res, r);
    } catch (e) {
      if (window.UI && window.UI.showToast) window.UI.showToast('副本异常', (e && e.message) || '未知错误');
      backToEntry(r);
    }
  }

  UI.renderResourceTrial = renderResourceTrial;
  UI.openResourceTrial = openResourceTrial;
  UI.showTrialDetail = showTrialDetail;
  UI.startTrialBattle = startTrialBattle;
  UI.showTrialSettle = showTrialSettle;
})();
