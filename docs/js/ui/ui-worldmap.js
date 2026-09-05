/* ============================================================
 * ui/ui-worldmap.js —— 世界地图页（二级菜单：选图 → 进战斗/主城）
 * 职责：
 *  1. 渲染世界地图底图上的点位（主城 + 6 野图印章点）
 *  2. 点位悬停 → 显示信息卡（图名/等级段/材料掉落分布/金装概率）
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
    // gold 已是百分比数值（如 3 = 3%），直接展示
    const gold = (typeof pv.gold === 'number') ? pv.gold + '%' : '—';
    // 进化素材档位 → 短标签（普通/精粹/传说），避免信息卡里出现冗长的素材全名
    const evoShort = (pv.evoTiers || []).map(n =>
      n.indexOf('精粹') >= 0 ? '精粹' : n.indexOf('传说') >= 0 ? '传说' : '普通'
    );
    // 材料掉落分布块：条形长度=相对权重，数字=占材料分支百分比（双表达，不只靠颜色）
    let distHtml = '';
    if (pv.dropDist && pv.dropDist.length) {
      const rows = pv.dropDist.map(d => {
        const varNote = d.variants && d.variants.length > 1
          ? ` <span class="wm-drop-var">(${evoShort.join('/')})</span>` : '';
        return `<div class="wm-drop-row">`
          + `<span class="wm-drop-name" title="${UI.escapeHtml ? UI.escapeHtml(d.name) : d.name}">${UI.escapeHtml ? UI.escapeHtml(d.name) : d.name}${varNote}</span>`
          + `<span class="wm-drop-bar"><span class="wm-drop-fill" style="width:${d.bar}%"></span></span>`
          + `<span class="wm-drop-pct">${d.pct}%</span>`
          + `</div>`;
      }).join('');
      distHtml = `<div class="wm-tip-sub">材料掉落分布</div>${rows}`;
    }
    return `
      <div class="wm-tip-name">${UI.escapeHtml ? UI.escapeHtml(point.name) : point.name}</div>
      <div class="wm-tip-line">建议等级：${UI.escapeHtml ? UI.escapeHtml(String(lv)) : lv}</div>
      ${distHtml}
      <div class="wm-tip-line">金装概率：约 ${gold}</div>
      <div class="wm-tip-cta">点击进入挂机</div>`;
  }

  // 回城休整：出战宠物回满血（提取到 UI 共享层，主城页「旅店」复用）
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
  // 共享层导出：主城页旅店直接调 UI.healActivePet()
  UI.healActivePet = healActivePet;
  UI.capName = capName;

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
      // 主城标记：跳到主城页（2026-09-01 主城升级为独立页，不再弹 dialog）
      if (point.type === 'capital') {
        if (window.UI && window.UI.switchPage) window.UI.switchPage('capital');
        return;
      }
      const Battle = window.Battle;
      if (!Battle) return;
      /* 越级警告（2026-08-30 用户拍板）：怪物等级改成【由地图等级段决定】之后，
       * 等级不够的玩家进高级图会被压制到几乎必输（怪不再被压到玩家等级）。
       * 挂机玩家不看战斗细节，不提示就会"一直输、以为游戏卡了"——所以在进图前拦一次。
       * 仍允许硬闯（玩家可能就想挑战），只是必须明确告知。
       * 放在停挂机【之前】：玩家取消时不能把正在跑的挂机停掉。
       * 测试环境没有 confirm（vm 桩）→ 视为同意，不阻断。 */
      const pet = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
      const areaCfg = ((window.Config && window.Config.battle && window.Config.battle.areas) || [])
        .find(a => a.id === point.areaId);
      if (pet && areaCfg && areaCfg.levelRange) {
        const lo = areaCfg.levelRange[0], hi = areaCfg.levelRange[1], lv = pet.level || 1;
        if (lv < lo) {
          const msg = `⚠️ 等级不足\n\n「${areaCfg.name}」的怪物是 ${lo}~${hi} 级，`
            + `你的宠物只有 Lv.${lv}。\n怪物等级由地图决定，进去会被压制、几乎必输。\n\n仍要进入吗？`;
          const ok = typeof window.confirm === 'function' ? window.confirm(msg) : true;
          if (!ok) return;
        }
      }
      // 重复点击当前正在挂机的图：只是「返回观看战斗」，不要停掉挂机（否则一返回战斗画面就没了）
      const curArea = Battle.getCurrentArea && Battle.getCurrentArea();
      if (curArea && curArea.id === point.areaId) {
        UI.switchPage && UI.switchPage('battle');
        return;
      }
      // 挂机中直接换图：先停挂机 → 切到新图（不自动重启挂机，避免误操作）
      const wasRunning = Battle.isRunning && Battle.isRunning();
      if (wasRunning) {
        // 服务器托管会话一起停，否则服务器还在旧图替我们打
        // （最多丢最后 30 秒：换图是玩家主动操作，不值得为这点收益加异步等待）
        if (window.IdleBridge) window.IdleBridge.stop();
        Battle.stopAutoBattle && Battle.stopAutoBattle();
      }
      if (!Battle.selectArea(point.areaId)) {
        // 选图失败（极端情况，比如图 id 不对），恢复挂机状态并提示
        UI.showToast && UI.showToast('无法进入', '该图暂不可用。');
        return;
      }
      // 进入战斗页（三级），刷新战斗页地图条
      UI.switchPage && UI.switchPage('battle');
      if (UI.updateBattleArea) UI.updateBattleArea(Battle.getCurrentArea());
      // 切图后给个明确反馈：原挂机已被停，避免玩家以为还在挂
      if (wasRunning) {
        UI.showToast && UI.showToast('已停止挂机', '当前地图已切换为「' + point.name + '」，回到战斗页手动开始挂机。');
      }
    });
  }

  // 世界地图页内「返回战斗」按钮：纯导航回到战斗页，不碰挂机（避免一返回战斗画面就没了）
  (function bindReturnBattle() {
    const btn = $('btn-return-battle');
    if (btn && !btn.__battleBound) {
      btn.__battleBound = true;
      btn.addEventListener('click', () => {
        if (window.UI && window.UI.switchPage) window.UI.switchPage('battle');
      });
    }
  })();

  // 渲染世界地图页（幂等：canvas 已有 marker 则不重复）
  // 第一原则：地图坐标系 = 画布坐标系。
  //  - canvas 铺满可用舞台（CSS），底图 background-size:100% 100% 拉伸填满 canvas；
  //  - 点位 x/y 是相对底图的百分比，底图填满 canvas 后即相对 canvas 的百分比；
  //  - 画布 / 地图 / 点位三个组件共享同一坐标系 → 天然对齐、永不脱锚；
  //  - 任何视口比例都铺满无黑边（超宽屏地图横向拉伸，窄屏纵向拉伸，均为「铺满」的必然取舍）。
  //  此前用 16:9 锁宽 / cover / contain 换算，本质是让画布与地图比例互相打架：锁宽留黑边、cover 裁点位、
  //  contain 留大片空。这套换算在超宽屏下始终无法同时满足「铺满」和「点位全可见」，故整体删除。
  let rendered = false;
  function renderWorldMapPage() {
    const canvas = $('worldmap-canvas');
    if (!canvas || !window.WorldMap) return;
    // 「返回战斗」只在已选地图（有正在看的战斗）时显示，没选图时隐藏
    const rb = $('btn-return-battle');
    if (rb) rb.hidden = !(window.Battle && window.Battle.getCurrentArea && window.Battle.getCurrentArea());
    if (!rendered) {
      // 底图拉伸填满整个 canvas：点位百分比 = 画布百分比，无换算、无黑边、点位永不裁出
      canvas.style.backgroundImage = 'url("' + window.WorldMap.img + '")';
      canvas.style.backgroundSize = '100% 100%';
      canvas.style.backgroundPosition = 'center';
      canvas.style.backgroundRepeat = 'no-repeat';
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
    }
  }
  // 取野图怪物等级段（来自对应 area 的 levelRange，纯展示）
  function markerLevelText(point) {
    if (point.type === 'capital') return null;
    const areaCfg = ((window.Config && window.Config.battle && window.Config.battle.areas) || [])
      .find(a => a.id === point.areaId);
    if (!areaCfg || !areaCfg.levelRange) return null;
    const [lo, hi] = areaCfg.levelRange;
    return 'Lv.' + lo + '-' + hi;
  }
  function makeMarker(point) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wm-marker' + (point.type === 'capital' ? ' wm-marker--capital' : '');
    // 百分比定位：底图拉伸填满 canvas 后，x/y% 即相对整个画布的坐标
    el.style.left = point.x + '%';
    el.style.top = point.y + '%';
    el.setAttribute('aria-label', point.name);
    el.title = point.name;
    const nameHTML = '<span class="wm-marker-name">' + (UI.escapeHtml ? UI.escapeHtml(point.name) : point.name) + '</span>';
    // 野图在名字下方显示怪物等级段
    const lv = markerLevelText(point);
    const lvHTML = lv ? '<span class="wm-marker-lv">' + lv + '</span>' : '';
    el.innerHTML = point.type === 'capital'
      ? '<span class="wm-marker-icon">' + (point.icon || '🏯') + '</span>' + nameHTML
      : '<span class="wm-marker-dot"></span>' + nameHTML + lvHTML;
    return el;
  }

  // 对外 API
  UI.renderWorldMapPage = renderWorldMapPage;
  UI.healActivePet = healActivePet;
  UI.capName = capName;
})();
