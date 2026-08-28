/* ============================================================
 * ui/ui-worldmap.js —— 世界地图页（二级菜单：选图 → 进战斗/主城）
 * 职责：
 *  1. 渲染世界地图底图上的点位（主城 + 6 野图印章点）
 *  2. 点位悬停 → 显示信息卡（图名/等级段/专属材料/进化素材/金装概率）
 *  3. 野图点位点击 → selectArea(图id) 并进入战斗页（三级）
 *  4. 主城点位点击 → 弹出安全区面板（回城休整、恢复满血）
 * 依赖：worldmap.js（点位配置）、battle.js（selectArea）、pet.js（回血）
 * 说明：renderWorldMapPage 由 ui-shell.renderPage 在切到 worldmap 页时调用，幂等。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI || (window.UI = {});
  const $ = UI.$ || (sel => document.querySelector(sel));

  // 信息卡：显示某野图点位的掉落预览
  function tipHTML(point) {
    const area = ((window.Config && window.Config.battle) || {}).areas;
    const a = area && area.find(x => x.id === point.areaId);
    const lv = a ? a.levelRange || a.recommended : (point.recommended || '');
    const pv = point._preview || {};
    // areaEvolutionTiers 的 value 本身是素材名数组（如 ['进化素材','精粹进化素材']），直接展示
    const tiers = (pv.evoTiers && pv.evoTiers.length) ? pv.evoTiers.join(' / ') : '普通';
    // gold 已是百分比数值（如 3 = 3%），直接展示
    const gold = (typeof pv.gold === 'number') ? pv.gold + '%' : '—';
    return `
      <div class="wm-tip-name">${UI.escapeHtml ? UI.escapeHtml(point.name) : point.name}</div>
      <div class="wm-tip-line">建议等级：${UI.escapeHtml ? UI.escapeHtml(String(lv)) : lv}</div>
      <div class="wm-tip-line">专属材料：${pv.mat ? (UI.escapeHtml ? UI.escapeHtml(pv.mat) : pv.mat) : '—'}</div>
      <div class="wm-tip-line">进化素材：${tiers}</div>
      <div class="wm-tip-line">金装概率：约 ${gold}</div>
      <div class="wm-tip-cta">点击进入挂机</div>`;
  }

  // 主城安全区面板
  function openCapitalPanel() {
    const cap = (window.WorldMap && window.WorldMap.capital) || { name: '主城', desc: '' };
    if (UI.showDialog) {
      UI.showDialog({
        icon: '🏯',
        speaker: cap.name,
        text: cap.desc + '\n点击下方按钮回城休整，将出战宠物恢复满血。',
        buttons: [
          { label: '🏥 回城休整（回满血）', onClick: () => { healActivePet(); } }
        ]
      });
    } else {
      healActivePet();
    }
  }
  // 回城休整：出战宠物回满血
  function healActivePet() {
    const Pet = window.Pet;
    const active = Pet && Pet.getActivePet && Pet.getActivePet();
    if (!active) { UI.showToast && UI.showToast('还没有出战宠物', '请先在宠物页选择出战宠物。'); return; }
    const maxHp = Pet.getStats(active).hp;
    Pet.setCurHp(active, maxHp);
    UI.showToast && UI.showToast('休整完毕', capName() + '的微光拂过，出战宠物已恢复满血。');
    // 若当前在战斗页，刷新血条
    if (UI.updateStatus) UI.updateStatus();
  }
  function capName() { return (window.WorldMap && window.WorldMap.capital && window.WorldMap.capital.name) || '主城'; }

  // 绑定单个点位的事件（悬停信息卡 / 点击进图）
  function bindPoint(marker, point) {
    const tip = $('worldmap-tip');
    const canvas = $('worldmap-canvas');
    const wrap = $('worldmap-canvas-wrap');
    marker.addEventListener('mouseenter', () => {
      if (!tip || !canvas) return;
      tip.innerHTML = point.type === 'capital'
        ? `<div class="wm-tip-name">${UI.escapeHtml ? UI.escapeHtml(point.name) : point.name}</div>
           <div class="wm-tip-line">安全区 · 可回血休整</div>
           <div class="wm-tip-cta">点击进入主城</div>`
        : tipHTML(point);
      tip.hidden = false;
      // 信息卡跟随标记上方；tip absolute 相对 wrap 定位（HTML 里 tip 在 wrap 内）
      const mr = marker.getBoundingClientRect();
      const wr = wrap ? wrap.getBoundingClientRect() : canvas.getBoundingClientRect();
      // 以红点中心为锚（marker 含名字，红点在 marker 顶部，取 mr.top 即红点顶；marker 中心偏下）
      const anchorX = mr.left + mr.width / 2;
      const anchorY = mr.top;
      let tx = anchorX - wr.left - 90; // 卡片左缘对齐锚点左 90px（近似水平居中）
      let ty = anchorY - wr.top - 8;
      tip.style.left = tx + 'px';
      tip.style.top = ty + 'px';
      tip.style.transform = 'translateY(-100%)';
      // 简单防超屏（相对 wrap 可视区）
      const tW = tip.offsetWidth, tH = tip.offsetHeight;
      if (tx + tW > wr.width - 8) tip.style.left = (wr.width - tW - 8) + 'px';
      if (ty - tH < 8) tip.style.top = (anchorY - wr.top + mr.height + 8) + 'px', tip.style.transform = '';
    });
    marker.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
    marker.addEventListener('click', () => {
      if (point.type === 'capital') { openCapitalPanel(); return; }
      const Battle = window.Battle;
      if (!Battle) return;
      // 挂机中直接换图：先停挂机 → 切到新图（不自动重启挂机，避免误操作）
      const wasRunning = Battle.isRunning && Battle.isRunning();
      if (wasRunning) Battle.stopAutoBattle && Battle.stopAutoBattle();
      if (!Battle.selectArea(point.areaId)) {
        // 选图失败（极端情况，比如图 id 不对），恢复挂机状态并提示
        UI.showToast && UI.showToast('无法进入', '该图暂不可用。');
        return;
      }
      // 进入战斗页（三级），刷新战斗页地图条
      UI.switchPage && UI.switchPage('battle');
      if (UI.renderAreaSelector) UI.renderAreaSelector();
      if (UI.updateBattleArea) UI.updateBattleArea(Battle.getCurrentArea());
      // 切图后给个明确反馈：原挂机已被停，避免玩家以为还在挂
      if (wasRunning) {
        UI.showToast && UI.showToast('已停止挂机', '当前地图已切换为「' + point.name + '」，回到战斗页手动开始挂机。');
      }
    });
  }

  // 渲染世界地图页（幂等：canvas 已有 marker 则不重复）
  let rendered = false;
  // 让地图 canvas 保持 16:9 电影取景：按可用空间等比计算宽高（宽=min(容器宽, 容器高×16/9)），居中。
  // 背景 cover 填满，图会裁剪上下一点点，但画面无黑边、有电影镜头感（用户指定）。
  function fitCanvas() {
    const wrap = $('worldmap-canvas-wrap');
    if (!wrap) return;
    // 可用空间 = worldmap-page（wrap 的父，flex:1 撑满 tab-worldmap）
    const page = wrap.parentElement;
    if (!page) return;
    const pw = page.clientWidth || 0;
    const ph = page.clientHeight || 0;
    if (pw <= 0 || ph <= 0) return;
    // 16:9 等比：宽=min(可用宽, 可用高×16/9)，高由 aspect-ratio:16/9 自动
    const RATIO = 16 / 9;
    let w = pw, h = w / RATIO;
    if (h > ph) { h = ph; w = h * RATIO; }
    wrap.style.width = Math.floor(w) + 'px';
  }
  function renderWorldMapPage() {
    const canvas = $('worldmap-canvas');
    if (!canvas || !window.WorldMap) return;
    if (!rendered) {
      // 首次：底图 + 点位（cover 填满 16:9 取景框）
      canvas.style.backgroundImage = 'url("' + window.WorldMap.img + '")';
      canvas.style.backgroundSize = 'cover';
      canvas.style.backgroundPosition = 'center';
      // 主城
      const cap = window.WorldMap.capital;
      const capEl = makeMarker(cap);
      bindPoint(capEl, cap);
      canvas.appendChild(capEl);
      // 野图
      for (const p of window.WorldMap.points) {
        p._preview = window.WorldMap.buildPreview ? window.WorldMap.buildPreview(p) : {};
        const m = makeMarker(p);
        bindPoint(m, p);
        canvas.appendChild(m);
      }
      rendered = true;
      window.addEventListener('resize', fitCanvas);
    }
    // 每次切到该页都重算 16:9 尺寸（页面 active 后 wrap 才有真实尺寸）
    fitCanvas();
  }
  function makeMarker(point) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wm-marker' + (point.type === 'capital' ? ' wm-marker--capital' : '');
    el.style.left = point.x + '%';
    el.style.top = point.y + '%';
    el.setAttribute('aria-label', point.name);
    el.title = point.name;
    const nameHTML = '<span class="wm-marker-name">' + (UI.escapeHtml ? UI.escapeHtml(point.name) : point.name) + '</span>';
    el.innerHTML = point.type === 'capital'
      ? '<span class="wm-marker-icon">' + (point.icon || '🏯') + '</span>' + nameHTML
      : '<span class="wm-marker-dot"></span>' + nameHTML;
    return el;
  }

  // 对外 API
  UI.renderWorldMapPage = renderWorldMapPage;
  UI.openWorldMapCapital = openCapitalPanel;
})();
