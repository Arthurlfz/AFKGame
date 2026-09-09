(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = value => UI.escapeHtml ? UI.escapeHtml(String(value || '')) : String(value || '');

  function renderResourceTrial() {
    const panel = $('resource-trial-panel');
    const T = window.ResourceTrial;
    if (!panel || !T) return;
    const state = T.getState();
    const ticket = window.Config.resourceTrials.ticketName;
    const qty = window.Materials ? window.Materials.getQuantity(ticket) : 0;
    const current = state.route;
    const source = esc(window.Config.resourceTrials.ticketSources || '');
    panel.innerHTML = `<div class="resource-trial-head"><div><h2>资源试炼</h2><p>消耗 1 张门票，连续 ${window.Config.resourceTrials.rounds} 场短战斗，定向获得一种资源。普通地图掉什么随缘，这里掉什么是你选的。</p></div><button class="fs-btn fs-btn--ghost" id="resource-trial-close">关闭</button></div>
      <div class="resource-trial-ticket">${esc(ticket)}：<b>${qty}</b>${source ? ` · 来源：${source}` : ''} · ${state.running ? `正在进行：${esc(current && current.name)} ${state.round}/${window.Config.resourceTrials.rounds}` : (qty < 1 ? '没有门票了，去交一次地图委托' : '选择一条路线开始')}</div>
      <div class="resource-trial-routes">${T.routes().map(route => `<article class="resource-trial-card"><h3>${esc(route.name)}</h3><p>${esc(route.desc)}</p><small>最低等级：Lv${route.minLevel}</small><button class="fs-btn fs-btn--primary resource-trial-start" data-route="${esc(route.id)}" ${state.running || qty < 1 || (window.Pet.getActivePet() && window.Pet.getActivePet().level < route.minLevel) ? 'disabled' : ''}>开始试炼</button></article>`).join('')}</div>
      ${state.result ? `<div class="resource-trial-result ${state.result.cleared ? 'is-clear' : 'is-fail'}">${state.result.cleared ? `✓ 通关 5 场（剩余血量 ${state.result.hpPercent || 0}%）` : `第 ${(state.result.rounds || 0) + 1} 场倒下，强度不足`} · 奖励：${esc((Array.isArray(state.result.reward) ? state.result.reward : [state.result.reward]).map(item => `${item.name}×${item.qty}`).join('、'))}</div>` : ''}`;
    $('resource-trial-close').onclick = () => { panel.hidden = true; };
    /* 铁律：await 之后的 UI 状态必须兜底复原。
     * 旧写法 button.disabled = true 后没有任何 catch —— start 一旦抛错（材料系统异常、
     * 渲染异常）按钮永久卡死，玩家以为功能坏了。成功/失败/异常三条路都要把按钮放回来。 */
    panel.querySelectorAll('.resource-trial-start').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const r = await T.start(button.dataset.route);
          if (!r || r.ok === false) {
            if (window.UI && window.UI.showToast) window.UI.showToast('无法开始试炼', (r && r.error) || '未知原因');
          }
        } catch (e) {
          if (window.UI && window.UI.showToast) window.UI.showToast('试炼异常', (e && e.message) || '未知错误');
        } finally {
          button.disabled = false;
          try { renderResourceTrial(); } catch (e) { /* 重渲染失败不吞掉按钮复原 */ }
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
  UI.renderResourceTrial = renderResourceTrial;
  UI.openResourceTrial = openResourceTrial;
})();
