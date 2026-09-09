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

  // 绑定单个点位的事件（点击进图 → 打开节点详情页；hover 信息卡已取消，2026-09-08）
  function bindPoint(marker, point) {
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
      // 重复点击当前正在挂机的图：同样打开详情页（可换宠/查看领主），不影响挂机运行
      const curArea = Battle.getCurrentArea && Battle.getCurrentArea();
      if (curArea && curArea.id === point.areaId) {
        showAreaDetail(point);
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
      // 打开节点详情页（选完图 → 先看地图/怪物/领主 → 再进战斗），替代直接跳战斗页
      showAreaDetail(point);
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
    const trialBtn = $('btn-resource-trial');
    if (trialBtn && !trialBtn._boundResourceTrial) {
      trialBtn._boundResourceTrial = true;
      trialBtn.onclick = () => window.UI && window.UI.openResourceTrial && window.UI.openResourceTrial();
    }
    if (window.UI && window.UI.renderResourceTrial) window.UI.renderResourceTrial();
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
    // 首通状态变化后同步标记（canvas 不重建，只更新 class 与 ✓ 徽标）
    if (window.Quest && window.Quest.isAreaCleared) {
      const markers = canvas.querySelectorAll('.wm-marker');
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!m || !m.dataset || !m.dataset.areaId) continue;
        const done = window.Quest.isAreaCleared(m.dataset.areaId);
        m.classList.toggle('wm-marker--cleared', !!done);
        const pass = m.querySelector('.wm-marker-pass');
        if (pass) pass.textContent = done ? '✓' : '';
      }
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
    if (point.areaId) el.dataset.areaId = point.areaId;
    const nameHTML = '<span class="wm-marker-name">' + (UI.escapeHtml ? UI.escapeHtml(point.name) : point.name) + '</span>';
    // 野图在名字下方显示怪物等级段
    const lv = markerLevelText(point);
    const lvHTML = lv ? '<span class="wm-marker-lv">' + lv + '</span>' : '';
    // 首通标记（2026-09-05）：金色 ✓ 徽标，随 Quest.isAreaCleared 状态
    const cleared = point.type !== 'capital' && !!(window.Quest && window.Quest.isAreaCleared && window.Quest.isAreaCleared(point.areaId));
    if (cleared) el.classList.add('wm-marker--cleared');
    const passHTML = point.type !== 'capital'
      ? '<span class="wm-marker-pass">' + (cleared ? '✓' : '') + '</span>' : '';
    el.innerHTML = point.type === 'capital'
      ? '<span class="wm-marker-icon">' + (point.icon || '🏯') + '</span>' + nameHTML
      : '<span class="wm-marker-dot"></span>' + nameHTML + lvHTML + passHTML;
    return el;
  }


  /* ============================================================
   * 节点详情页（2026-09-08）：选完图后弹出，替代直接进战斗。
   * 左：地图介绍（怪物 + 掉落）｜中：出战宠物选择｜右：守关领主（霸主）
   * 底部：只进战斗 / 开始挂机。hover 信息卡已取消，信息全部集中到这里。
   * ============================================================ */
  const esc = s => UI.escapeHtml ? UI.escapeHtml(s) : String(s);

  function areaDetailHTML(point) {
    const area = ((window.Config && window.Config.battle) || {}).areas
      && ((window.Config && window.Config.battle) || {}).areas.find(a => a.id === point.areaId);
    const list = (window.EnemyData && window.EnemyData.list) || [];
    const mobs = (area && area.enemyIds ? list.filter(e => (area.enemyIds || []).indexOf(e.id) >= 0) : [])
      .sort((x, y) => (y.level || 0) - (x.level || 0));
    const boss = mobs[0] || null;   // 图内最高级怪 = 守关霸主
    const pv = point._preview || {};
    const gold = (typeof pv.gold === 'number') ? pv.gold + '%' : '—';
    const cleared = !!(window.Quest && window.Quest.isAreaCleared && window.Quest.isAreaCleared(point.areaId));
    const [lo, hi] = (area && area.levelRange) ? area.levelRange : [null, null];
    // 地图委托：详情页里给出「这张图现在值得刷什么」
    const loopQuest = window.Quest && window.Quest.getQuests
      ? window.Quest.getQuests().find(q => q.type === 'collect_loop' && q.area === point.areaId)
      : null;
    const loopHtml = loopQuest
      ? `<div class="nd-boss-row"><span class="k">委托</span><span class="v">${esc(loopQuest.name)} ${loopQuest.progress}/${loopQuest.need}</span></div>`
      : '';

    // 怪物列表（普通/变异分档）：真实头像图（PetSprites.avatarOf），无图回退 emoji
    const spriteOf = name => (window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(name) : null;
    const mobHtml = mobs.map(m => {
      const evolved = m.enemyType === 'evolved';
      const av = spriteOf(m.name);
      return `<div class="nd-mob${evolved ? ' evolved' : ''}"><span class="ic">${av ? '<img src="' + av + '" alt="">' : (m.icon || '🐾')}</span><span class="nm">${esc(m.name)}</span><span class="lv">Lv.${m.level || '—'}</span></div>`;
    }).join('') || '<div class="nd-mob"><span class="nm">未知怪群</span></div>';

    // 出战宠物选择
    const Pet = window.Pet;
    const pets = (Pet && Pet.getPets) ? Pet.getPets() : [];
    const active = (Pet && Pet.getActivePet) ? Pet.getActivePet() : null;
    const petHtml = pets.map(p => {
      const god = (Pet && Pet.isGodPet) ? Pet.isGodPet(p) : !!p.isGodPet;
      const growth = (p.growth || 0).toFixed(1);
      const meta = god ? '' : `<div class="p-meta">Lv.${p.level || 1} · 成长${growth}</div>`;
      const godTxt = god ? '<div class="p-god">★ 神级</div>' : '';
      const pAv = spriteOf(p.name);
      return `<div class="nd-pet${active && active.id === p.id ? ' active' : ''}${god ? ' god' : ''}" data-pid="${p.id}">
        <div class="p-ic">${pAv ? '<img src="' + pAv + '" alt="">' : (p.icon || '🐾')}</div>
        <div class="p-nm">${esc(p.name)}</div>${meta}${godTxt}
      </div>`;
    }).join('') || '<div class="nd-pet"><div class="p-nm">还没有宠物</div></div>';
    const activeInfo = active
      ? `出战：<b>${esc(active.name)}</b> · 成长 <b>${(active.growth || 0).toFixed(1)}</b>`
      : '还没有出战宠物';

    return `
      <div class="nd-top">
        <div class="nd-title">${esc(area ? area.name : point.name)}</div>
        <div class="nd-sub">
          ${lo != null ? `<span>Lv.<b>${lo}~${hi}</b></span>` : ''}
          <span>推荐成长 <b>${area && area.recGrowth ? area.recGrowth : '—'}</b></span>
          ${cleared ? '<span>首通 <b style="color:var(--r-gold)">✓ 已完成</b></span>' : ''}
        </div>
        <button type="button" class="nd-back" id="nd-back">← 返回大地图</button>
      </div>
      <div class="nd-grid">
        <div class="nd-card">
          <div class="nd-card-title">地图介绍<span class="hint">该图会出现的野怪</span></div>
          <div class="nd-mobs">${mobHtml}</div>
          <div class="nd-card-title" style="margin-top:14px">掉落预览<span class="hint">挂机收益</span></div>
          <div class="nd-drop">
            <div class="nd-drop-cell"><div class="k">金装</div><div class="v">${gold}</div></div>
            <div class="nd-drop-cell"><div class="k">材料</div><div class="v">≈19%</div></div>
            <div class="nd-drop-cell"><div class="k">宠物蛋</div><div class="v">≈2%</div></div>
          </div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">选择战斗宠物<span class="hint">点击切换出战</span></div>
          <div class="nd-pets">${petHtml}</div>
          <div class="nd-active-row"><span>${activeInfo}</span><span class="tag">可出战</span></div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">守关领主<span class="hint">挂机按小时现身</span></div>
          <div class="nd-boss-art">${boss ? (((window.PetSprites && window.PetSprites.pathOf) && window.PetSprites.pathOf(boss.name)) ? '<img src="' + window.PetSprites.pathOf(boss.name) + '" alt="">' : (boss.icon || '👹')) : '👹'}</div>
          <div class="nd-boss-name">霸主 · ${esc(boss ? boss.name : '？？？')}</div>
          <div class="nd-boss-rows">
            <div class="nd-boss-row"><span class="k">等级</span><span class="v warn">Lv.${boss ? (boss.level || '—') : '—'}</span></div>
            <div class="nd-boss-row"><span class="k">首通</span><span class="v">${cleared ? '✓ 已首通' : '未首通'}</span></div>
            ${loopHtml}
          </div>
        </div>
      </div>
      <div class="nd-foot">
        <span class="tip">进入后自动挂机，经验 / 材料 / 装备持续入账 · <b>打不过会自动停</b></span>
        <button type="button" class="nd-go nd-go--ghost" id="nd-fight">只进战斗</button>
        <button type="button" class="nd-go" id="nd-idle">⚔ 开始挂机</button>
      </div>`;
  }

  function showAreaDetail(point) {
    const el = $('area-detail');
    const body = $('area-detail-body');
    if (!el || !body) {
      // 兜底：容器缺失（老页面结构）时保持原行为直接进战斗
      if (window.UI && window.UI.switchPage) window.UI.switchPage('battle');
      return;
    }
    body.innerHTML = areaDetailHTML(point);
    el.hidden = false;
    const Battle = window.Battle;
    // 返回大地图
    const back = body.querySelector('#nd-back');
    if (back) back.onclick = () => { el.hidden = true; };
    // 出战宠物切换：点击头像 setActive 后重渲染详情页（下一场生效，与战斗页 roster 同口径）
    body.querySelectorAll('.nd-pet').forEach(card => {
      card.onclick = () => {
        const pid = card.dataset.pid;
        if (!pid || !window.Pet || !window.Pet.setActive) return;
        window.Pet.setActive(pid);
        showAreaDetail(point);
      };
    });
    // 进战斗页（不自动挂机）
    const enterBattle = () => {
      el.hidden = true;
      if (window.UI && window.UI.switchPage) window.UI.switchPage('battle');
      if (window.UI && window.UI.updateBattleArea) window.UI.updateBattleArea(Battle && Battle.getCurrentArea());
    };
    const fight = body.querySelector('#nd-fight');
    if (fight) fight.onclick = enterBattle;
    // 开始挂机：进战斗页后点挂机开关（复用主流程：托管/本地自动判断）
    const idle = body.querySelector('#nd-idle');
    if (idle) idle.onclick = () => {
      enterBattle();
      setTimeout(() => {
        const b = document.getElementById('btn-battle');
        if (b && typeof b.click === 'function') b.click();
      }, 150);
    };
  }

  // 对外 API
  UI.renderWorldMapPage = renderWorldMapPage;
  UI.showAreaDetail = showAreaDetail;
  UI.healActivePet = healActivePet;
  UI.capName = capName;
})();
