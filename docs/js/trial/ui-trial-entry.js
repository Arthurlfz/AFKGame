/* ============================================================
 * trial/ui-trial-entry.js —— 副本入口 UI（单一职责）
 * 职责：
 *  1. 资源副本面板（世界地图标题栏入口，引导 N6 的落点）
 *  2. 大地图副本节点详情页（复用野图详情容器 #area-detail：介绍/选宠/资格/进入，
 *     奖励预览改为按【层数档位】展示——5/10/15/20 层各一档）
 * 不负责：战斗推进（trial-engine.js + ui-trial-battle.js）、结算面板（ui-trial-settle.js）。
 * 依赖：trial-config/access/engine/rewards、pet、ui-common。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = value => UI.escapeHtml ? UI.escapeHtml(String(value || '')) : String(value || '');

  /* 刷新所有入口展示：面板 + 大地图副本节点徽标（每次进页 / 每次副本结束后调用） */
  function refreshAll() {
    try { renderResourceTrial(); } catch (e) { /* 面板不在当前页面时忽略 */ }
    if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
  }

  /* 单条路线的进入资格文案（免费剩余 / 门票数量） */
  function entryLine(routeId) {
    const A = window.TrialAccess;
    const info = (A && A.entryInfo) ? A.entryInfo(routeId) : { freeLeft: 0, freePerDay: 0, ticketQty: 0 };
    const freeTxt = info.freePerDay > 0
      ? `今日免费 <b>${info.freeLeft}/${info.freePerDay}</b>`
      : '门票模式';
    return `${freeTxt} · 门票 <b>${info.ticketQty}</b>`;
  }

  /* 开始按钮的文案与可用性（免费优先，用尽后门票） */
  function goLabel(routeId) {
    const A = window.TrialAccess;
    const info = (A && A.entryInfo) ? A.entryInfo(routeId) : null;
    const route = (A && A.routeOf) ? A.routeOf(routeId) : null;
    const pet = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    if (!info || !route) return { label: '进入副本', disabled: true };
    const canFree = info.freeLeft > 0;
    const canTicket = info.ticketQty > 0;
    const levelOk = !!(pet && (Number(pet.level) || 1) >= (Number(route.minLevel) || 1));
    const label = canFree ? `免费进入（剩 ${info.freeLeft} 次）` : (canTicket ? '消耗门票进入' : '免费次数用尽 · 需门票');
    return { label, disabled: !(levelOk && (canFree || canTicket)) };
  }

  /* ---------- 面板（世界地图标题栏「资源副本」入口，也是引导 N6 的落点） ---------- */
  function renderResourceTrial() {
    const panel = $('resource-trial-panel');
    const T = window.TrialEngine;
    const A = window.TrialAccess;
    if (!panel || !T || !A) return;
    const state = T.getState();
    const cfg = window.Config.resourceTrials || {};
    const ticket = cfg.ticketName || '资源试炼门票';
    const qty = window.Materials ? window.Materials.getQuantity(ticket) : 0;
    const current = state.route;
    const source = esc(cfg.ticketSources || '');
    const freePerDay = Number(cfg.freeEntriesPerDay) || 0;
    const total = state.total || cfg.floors || 20;
    panel.innerHTML = `<div class="resource-trial-head"><div><h2>资源副本</h2><p>三个定向资源副本：蜕变 / 涅槃 / 淬炼。每个副本是 ${total} 层爬塔——血量跨层累计不回满，层数越深难度越高，奖励按【最高到达层数】给档（${(cfg.routes || []).length ? (cfg.routes[0].floorTiers || []).map(t => t.floor).join('/') : '5/10/15/20'} 层各一档），不足第一层档只有少量补偿。每天北京时间 12:00 刷新免费进入次数，免费次数用尽后可消耗 1 张门票继续进入。</p></div><button class="fs-btn fs-btn--ghost" id="resource-trial-close">关闭</button></div>
      <div class="resource-trial-ticket">${esc(ticket)}：<b>${qty}</b>${source ? ` · 来源：${source}` : ''}${freePerDay > 0 ? ` · 每副本每日免费 <b>${freePerDay}</b> 次（北京时间 12:00 刷新）` : ''}${state.running ? ` · 正在进行：${esc(current && current.name)} 第 ${state.floor}/${total} 层` : ''}</div>
      <div class="resource-trial-routes">${A.routes().map(route => {
        const gl = goLabel(route.id);
        return `<article class="resource-trial-card"><h3>${esc(route.name)}</h3><p>${esc(route.desc)}</p><small>最低等级：Lv${route.minLevel || 1} · 连续 ${total} 层 · ${entryLine(route.id)}</small><button class="fs-btn fs-btn--primary resource-trial-start" data-route="${esc(route.id)}" ${state.running || gl.disabled ? 'disabled' : ''}>${esc(gl.label)}</button></article>`;
      }).join('')}</div>
      ${state.result ? `<div class="resource-trial-result ${state.result.cleared ? 'is-clear' : 'is-fail'}">${state.result.cleared ? `✓ 通关 ${state.result.maxFloor}/${state.result.floors} 层` : `止步第 ${state.result.maxFloor} 层`} · 奖励：${esc((Array.isArray(state.result.reward) ? state.result.reward : [state.result.reward]).map(item => `${item.name}×${item.qty}`).join('、'))}</div>` : ''}`;
    $('resource-trial-close').onclick = () => { panel.hidden = true; };
    /* 铁律：await 之后的 UI 状态必须兜底复原。
     * 成功/失败/异常三条路都要把按钮放回来（refreshAll 在 finally 统一重建面板）。 */
    panel.querySelectorAll('.resource-trial-start').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const route = A.routeOf(button.dataset.route);
          if (route) await UI.startTrialBattle(route, { from: 'panel' });
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

  /* ---------- 副本节点详情页：点击大地图上的副本节点进入 ----------
   * 复用野图节点详情页的容器（#area-detail），结构与野图一致：介绍 / 选宠 / 资格 / 进入。
   * 奖励预览按层数档位（floorTiers），不再按宠物等级。 */
  function trialDetailHTML(route, point) {
    const A = window.TrialAccess;
    const cfg = window.Config.resourceTrials || {};
    const info = (A && A.entryInfo) ? A.entryInfo(route.id) : { freeLeft: 0, freePerDay: 0, used: 0, ticketName: '', ticketQty: 0 };
    const total = cfg.floors || 20;
    const tiersHtml = (Array.isArray(route.floorTiers) ? route.floorTiers : []).map(t =>
      `<div class="nd-boss-row"><span class="k">第 ${t.floor} 层</span><span class="v">${esc((t.items || []).map(i => `${i.name}×${i.qty}`).join('、'))}</span></div>`
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
      ? `出战：<b>${esc(active.name)}</b> · Lv.<b>${active.level || 1}</b>`
      : '还没有出战宠物';
    const levelOk = !!(active && (Number(active.level) || 1) >= (Number(route.minLevel) || 1));
    const canFree = info.freeLeft > 0;
    const canTicket = info.ticketQty > 0;
    const goDisabled = !(levelOk && (canFree || canTicket));
    const goTxt = canFree ? `免费进入（剩 ${info.freeLeft} 次）` : (canTicket ? '消耗门票进入' : '免费次数用尽 · 需门票');
    const freeClass = info.freeLeft > 0 ? '' : ' warn';

    return `
      <div class="nd-top">
        <div class="nd-title">${esc(route.name)}</div>
        <div class="nd-sub">
          <span>资源副本</span>
          <span>最低等级 <b>Lv${route.minLevel || 1}</b></span>
          <span>连续 <b>${total}</b> 层</span>
          <span>血量跨层累计</span>
        </div>
        <button type="button" class="nd-back" id="nd-back">← 返回大地图</button>
      </div>
      <div class="nd-grid">
        <div class="nd-card">
          <div class="nd-card-title">副本介绍<span class="hint">爬多深、拿什么</span></div>
          <p class="nd-desc">${esc(route.desc)}</p>
          <div class="nd-card-title" style="margin-top:14px">层数档位<span class="hint">按最高到达层数给</span></div>
          <div class="nd-boss-rows">${tiersHtml}</div>
          <div class="nd-card-title" style="margin-top:14px">失败补偿<span class="hint">不足第一层档时</span></div>
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
        <span class="tip">中途失败不回退次数/门票，达到 5 层档按档给奖励 · <b>门票来自地图委托</b></span>
        <button type="button" class="nd-go" id="nd-trial-go" ${goDisabled ? 'disabled' : ''}><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg> ${esc(goTxt)}</button>
      </div>`;
  }

  function showTrialDetail(point) {
    const el = $('area-detail');
    const body = $('area-detail-body');
    const A = window.TrialAccess;
    if (!el || !body || !A || !point || !point.routeId) {
      // 容器或配置缺失时退回面板（老页面结构 / 异常状态兜底）
      if (window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial();
      return;
    }
    const route = A.routeOf(point.routeId);
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
    // 进入副本：免费优先，用尽后门票 → 整页战斗推进，打完弹结算面板
    const go = body.querySelector('#nd-trial-go');
    if (go) {
      go.onclick = async () => {
        go.disabled = true;
        try {
          await UI.startTrialBattle(route, { from: 'node', point });
        } catch (e) {
          if (window.UI && window.UI.showToast) window.UI.showToast('副本异常', (e && e.message) || '未知错误');
        } finally {
          if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
        }
      };
    }
    if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
  }

  UI.renderResourceTrial = renderResourceTrial;
  UI.openResourceTrial = openResourceTrial;
  UI.showTrialDetail = showTrialDetail;
})();
