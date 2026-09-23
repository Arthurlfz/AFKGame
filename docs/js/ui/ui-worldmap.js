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
      // 2026-09-09 修复「看一眼别的图，原挂机就没了」：
      // 以前点别的图会【立刻】停掉正在跑的挂机并切图 —— 玩家只是看了眼详情页就退出，
      // 或者点了「开始挂机」却被满血门槛静默挡住，旧挂机已经停了 = 两头空。
      // 现在选图 / 停挂机全部推迟到详情页的「只进战斗 / 开始挂机」按钮里：
      // 看完点「返回大地图」，原挂机毫发无损继续跑。
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
    // 「资源副本」标题栏按钮已移除（2026-09-09 用户拍板）：入口收敛到大地图的副本节点；
    // 面板 #resource-trial-panel 保留，仅供引导 N6 落点与结算返回使用。
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
      // 资源副本节点（2026-09-09）：三个试炼副本，节点进入；徽标显示今日免费剩余
      for (const p of (window.WorldMap.trialPoints || [])) {
        const m = makeTrialMarker(p);
        bindTrialPoint(m, p);
        canvas.appendChild(m);
      }
      // 通天塔节点（2026-09-10）：后期内容的独立节点，右上角留白
      if (window.WorldMap.towerPoint) {
        const tp = window.WorldMap.towerPoint;
        const tm = makeTowerMarker(tp);
        bindTowerPoint(tm, tp);
        canvas.appendChild(tm);
      }
      rendered = true;
    }
    // 副本节点徽标：每次进页刷新今日免费剩余（北京时间 12:00 换日）
    if (window.UI && window.UI.refreshTrialMarkers) window.UI.refreshTrialMarkers();
    // 塔节点徽标：今日免费次数 / 需重置卡（同一换日点）
    if (window.UI && window.UI.refreshTowerMarker) window.UI.refreshTowerMarker();
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
      ? '<span class="wm-marker-icon">' + (point.icon || '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5V3"/><path d="M14 5V3"/><path d="M15 21v-3a3 3 0 0 0-6 0v3"/><path d="M18 3v8"/><path d="M18 5H6"/><path d="M22 11H2"/><path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"/><path d="M6 3v8"/></svg>') + '</span>' + nameHTML
      : '<span class="wm-marker-dot"></span>' + nameHTML + lvHTML + passHTML;
    return el;
  }


  /* ---------- 资源副本节点（2026-09-09） ----------
   * 三个试炼副本在大地图上作为独立节点（类型 trial，见 worldmap.js trialPoints）。
   * 与野图点位的区别：没有 areaId（不经过 Battle.selectArea），点击直接打开副本详情页；
   * 每日免费剩余次数显示在标记下方徽标里，由 refreshTrialMarkers 按试炼日刷新。 */
  function makeTrialMarker(point) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wm-marker wm-marker--trial';
    el.style.left = point.x + '%';
    el.style.top = point.y + '%';
    el.setAttribute('aria-label', point.name);
    el.title = point.name;
    if (point.routeId) el.dataset.routeId = point.routeId;
    const nameHTML = '<span class="wm-marker-name">' + (UI.escapeHtml ? UI.escapeHtml(point.name) : point.name) + '</span>';
    const remainHTML = '<span class="wm-marker-remain"></span>';
    el.innerHTML = '<span class="wm-marker-dot"></span>' + nameHTML + remainHTML;
    return el;
  }

  function bindTrialPoint(marker, point) {
    marker.addEventListener('click', () => {
      if (window.UI && window.UI.showTrialDetail) window.UI.showTrialDetail(point);
      else if (window.UI && window.UI.openResourceTrial) window.UI.openResourceTrial(); // 兜底：老版本无详情页时退回面板
    });
  }

  /* ---------- 通天塔节点（2026-09-10） ----------
   * 与副本节点同构：没有 areaId（不经过 Battle.selectArea），点击打开塔详情页（#tower-detail）。
   * 视觉用朱红 + 金与副本节点的青灰区分；节点常驻可见（塔没有「首通」概念，只有历史最高层）。
   * 徽标显示「今日免费 N」或「需重置卡」。 */
  function makeTowerMarker(point) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wm-marker wm-marker--tower';
    el.style.left = point.x + '%';
    el.style.top = point.y + '%';
    el.setAttribute('aria-label', point.name);
    el.title = (point.desc ? point.desc + ' · ' : '') + point.name;
    el.dataset.tower = '1';
    const nameHTML = '<span class="wm-marker-name">' + (UI.escapeHtml ? UI.escapeHtml(point.name) : point.name) + '</span>';
    const remainHTML = '<span class="wm-marker-remain"></span>';
    el.innerHTML = '<span class="wm-marker-dot"></span>' + nameHTML + remainHTML;
    return el;
  }

  function bindTowerPoint(marker, point) {
    marker.addEventListener('click', () => {
      if (window.UI && window.UI.showTowerDetail) window.UI.showTowerDetail(point);
      else if (window.UI && window.UI.showToast) UI.showToast('通天塔未就绪', '塔详情页未加载（缺 ui-tower-entry.js）');
    });
  }

  // 塔节点徽标：今日免费次数 / 需重置卡
  UI.refreshTowerMarker = () => {
    const canvas = $('worldmap-canvas');
    if (!canvas || !window.TowerAccess || !window.TowerAccess.getDailyInfo) return;
    const marker = canvas.querySelector('.wm-marker--tower');
    if (!marker) return;
    const badge = marker.querySelector('.wm-marker-remain');
    if (!badge) return;
    const info = window.TowerAccess.getDailyInfo();
    const left = info.freeLeft || 0;
    badge.textContent = left > 0 ? ('免费' + left) : '需重置卡';
    badge.classList.toggle('is-empty', !(left > 0));
    const best = info.bestFloor || 0;
    if (best > 0) badge.title = `历史最高 ${best} 层${info.bestHot ? ' / 辣度 ' + info.bestHot : ''}`;
  };

  // 副本节点徽标：显示每个副本今日免费剩余次数（北京时间 12:00 刷新）
  UI.refreshTrialMarkers = () => {
    const canvas = $('worldmap-canvas');
    if (!canvas || !window.ResourceTrial || !window.ResourceTrial.getDailyInfo) return;
    const byRoute = {};
    window.ResourceTrial.getDailyInfo().forEach(i => { byRoute[i.routeId] = i; });
    canvas.querySelectorAll('.wm-marker--trial').forEach(m => {
      const rid = m.dataset && m.dataset.routeId;
      const badge = m.querySelector('.wm-marker-remain');
      if (!rid || !badge || !byRoute[rid]) return;
      const left = byRoute[rid].freeLeft;
      badge.textContent = left > 0 ? '免费' + left : '需门票';
      badge.classList.toggle('is-empty', !(left > 0));
    });
  };


  /* ============================================================
   * 节点详情页（2026-09-08）：选完图后弹出，替代直接进战斗。
   * 左：地图介绍（怪物 + 掉落）｜中：出战宠物选择｜右：守关领主（霸主）
   * 底部：只进战斗 / 开始挂机。hover 信息卡已取消，信息全部集中到这里。
   * ============================================================ */
  const esc = s => UI.escapeHtml ? UI.escapeHtml(s) : String(s);

  function areaDetailHTML(point, pendingId) {
    const area = ((window.Config && window.Config.battle) || {}).areas
      && ((window.Config && window.Config.battle) || {}).areas.find(a => a.id === point.areaId);
    const list = (window.EnemyData && window.EnemyData.list) || [];
    const mobs = (area && area.enemyIds ? list.filter(e => (area.enemyIds || []).indexOf(e.id) >= 0) : [])
      .sort((x, y) => (y.level || 0) - (x.level || 0));
    const boss = mobs[0] || null;   // 图内最高级怪 = 守关霸主
    /* 金装概率（point._preview.gold）已不再展示：2026-09-09 用户拍板「掉落只列东西，不写概率」。 */
    const cleared = !!(window.Quest && window.Quest.isAreaCleared && window.Quest.isAreaCleared(point.areaId));
    const [lo, hi] = (area && area.levelRange) ? area.levelRange : [null, null];
    // 地图委托：详情页里给出「这张图现在值得刷什么」
    const loopQuest = window.Quest && window.Quest.getQuests
      ? window.Quest.getQuests().find(q => q.type === 'collect_loop' && q.area === point.areaId)
      : null;
    /* 委托进度（2026-09-23）：带进度条 —— 只写 "2/200" 看不出还差多远。
     * 进度条宽度是每次渲染都不同的值，只能内联 style（走 CSS 变量只会更难读）。 */
    const loopPct = loopQuest
      ? Math.max(0, Math.min(100, Math.round((Number(loopQuest.progress) || 0) / (Number(loopQuest.need) || 1) * 100)))
      : 0;
    const loopHtml = loopQuest
      ? `<div class="nd-boss-row col">
          <div style="display:flex;align-items:center;gap:12px"><span class="k">委托进度</span><span class="v txt">${esc(loopQuest.name)} ${loopQuest.progress}/${loopQuest.need}</span></div>
          <div class="pd-bar"><i style="width:${loopPct}%"></i></div>
        </div>`
      : '';

    /* 三个小组件（2026-09-23）：**必须定义在"用它们的地方"之前** ——
     * 野怪行 / 候补卡 / 主位卡都要用，写成"用到时再定义"会撞 TDZ（报错，不是静默）。 */
    const fmtNum = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const growthOf = p => Number(p && p.growth) || 0;
    // 威胁度刻度 = 该怪等级在图段内的相对位置（1~5 格），不改数值只做可视化
    const threatOf = m => {
      if (lo == null || hi == null || hi <= lo) return 3;
      const r = (Number(m.level) - lo) / (hi - lo);
      return Math.max(1, Math.min(5, Math.round(r * 4) + 1));
    };
    // 怪物列表（普通/进化/变异分档）：真实头像图（PetSprites.avatarOf），无素材留空（不回退 emoji）。
    // 2026-09-09 补全介绍：类型 + 强度倍率 + 战斗定位（复用宠物的 petProfiles 定位，变异/进化剥「·异变」后缀查基宠）。
    const spriteOf = name => (window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(name) : null;
    const typeMultCfg = ((window.Config && window.Config.battle) || {}).typeMult || {};
    const profilesCfg = ((window.Config && window.Config.pet) || {}).petProfiles || {};
    const roleOf = name => {
      const base = String(name || '').split('·')[0].trim();
      const p = profilesCfg[base];
      return p && p.role ? p.role : '';
    };
    const mobHtml = mobs.map(m => {
      const typeTxt = m.enemyType === 'mutant' ? '变异体' : m.enemyType === 'evolved' ? '进化体' : '野生';
      const mult = typeMultCfg[m.enemyType] != null ? typeMultCfg[m.enemyType] : 1;
      const role = roleOf(m.name);
      const isBoss = !!(boss && m.id === boss.id);
      const av = spriteOf(m.name);
      // 威胁度刻度（2026-09-23）：该怪等级在图段内的**相对位置** 1~5 格（不改数值，只做可视化）
      const thr = threatOf(m);
      const bars = [1, 2, 3, 4, 5].map(i => `<i class="${i <= thr ? (isBoss ? 'h' : 'f') : ''}"></i>`).join('');
      return `<div class="nd-mob${m.enemyType === 'evolved' ? ' evolved' : ''}${m.enemyType === 'mutant' ? ' mutant' : ''}${isBoss ? ' is-boss' : ''}">
        <span class="ic">${av ? '<img src="' + av + '" alt="">' : ''}</span>
        <div class="tx">
          <div class="nm">${esc(m.name)}${isBoss ? '<span class="boss-tag">霸主</span>' : ''}</div>
          <div class="ds">${role ? esc(role) + ' · ' : ''}${typeTxt} · 强度 ×${mult}</div>
        </div>
        <div class="rt"><div class="lv">Lv.${m.level || '—'}</div><div class="pd-thr">${bars}</div></div>
      </div>`;
    }).join('') || '<div class="nd-mob"><span class="nm">未知怪群</span></div>';

    // 掉落数据源（2026-09-09 起现读 config）：区域材料 / 进化素材档位 / 材料子权重表。
    // ⚠️ 2026-09-23：名单不再在这里拼（`dropNames`/`dropHtml` 已删），改由下方 drops/dropGrid 组装
    //   —— 因为新版掉落预览要**按稀有度分三层 + 带占比**，拼字符串的老写法撑不住。
    const allAreas = (window.Config && window.Config.battle && window.Config.battle.areas) || [];
    const tierNo = allAreas.findIndex(a => a.id === point.areaId) + 1;
    const mwCfg = ((window.Config.drop || {}).materialWeightsByTier || {})[tierNo] || {};
    const areaMatCfg = ((window.Config.drop || {}).areaMaterials || {})[point.areaId];
    /* 掉落档位**复用掉落播报那套表**（UI.lootTierOf，定义在 ui-battle.js），不另抄一份名单
     * —— 抄了就是第二份事实源，改档位表时会漏。
     * 装备 / 宠物蛋不在材料档位表里，单独定档：宠物蛋=3（惊喜档），装备=2。 */
    const tierOf = n => (n === '宠物蛋' ? 3
      : (n === '装备（未鉴定）' ? 2
        : (UI.lootTierOf ? UI.lootTierOf(n) : 1)));

    // 出战宠物选择：pendingId = 详情页里刚点选、还没生效的宠物（点「只进战斗/开始挂机」才真正切换，
    // 不然 setActive 会换掉正在挂机的宠物，下一个战报回来 IdleBridge 就把挂机停了）
    const Pet = window.Pet;
    const pets = (Pet && Pet.getPets) ? Pet.getPets() : [];
    const cur = (Pet && Pet.getActivePet) ? Pet.getActivePet() : null;
    const active = (pendingId != null) ? (pets.find(p => p.id === pendingId) || cur) : cur;
    const petChanged = !!(pendingId != null && cur && active && cur.id !== active.id);
    /* 候补卡 schema 统一（2026-09-23 用户要求）：每张卡都是
     * 「名字(+★神级徽标) / Lv·成长 / 成长值」—— 同一顺序、同一位置。
     * 原来神级宠**不渲染** .p-meta（改成把 ★神级 顶到名字下面），于是同一列里
     * 一张显示「★神级」、另一张显示「Lv.60 · 成长12.8」= 卡面字段不一致。现在一律齐。 */
    const petHtml = pets.map(p => {
      const god = (Pet && Pet.isGodPet) ? Pet.isGodPet(p) : !!p.isGodPet;
      const g = growthOf(p).toFixed(1);
      const pAv = spriteOf(p.name);
      return `<div class="nd-pet${active && active.id === p.id ? ' active' : ''}${god ? ' god' : ''}" data-pid="${p.id}">
        <div class="p-ic">${pAv ? '<img src="' + pAv + '" alt="">' : ''}</div>
        <div>
          <div class="p-nm">${esc(p.name)}${god ? '<span class="p-god">★ 神级</span>' : ''}</div>
          <div class="p-meta">Lv.${p.level || 1} · 成长 ${g}</div>
        </div>
        <div class="p-growth">${g}</div>
      </div>`;
    }).join('') || '<div class="nd-pet"><div class="p-nm">还没有宠物</div></div>';

    /* ---------- 出征整备（2026-09-23 重构）附加口径 ----------
     * 🔴 数据纪律：**只用游戏里真有的数，不新造玩家可见数值**（用户 2026-09-23 拍板）。
     *  · 主数字 = 成长（pet.growth）。全项目**没有**"综合战力"字段 —— ui-pet.js 的
     *    「成长贡献：生命 +6465…」是 level×growth 的属性增量，标签是生命/攻击/防御，不是战力。
     *  · 对比尺刻度 = area.recGrowth（配置里唯一的"推荐值"）。
     *  · 掉落率：材料给「占材料 x%」= materialWeightsByTier 权重算的**相对占比**；
     *    不进权重表的（区域材料本体）/ 装备 / 蛋 只列不报率（概率口径见下方注释）。
     *  · 领主现身规则读 window.BattleSim 的 BOSS_* 常数（与服务器 battle-sim 同源），
     *    ⛔ 不写 config 里那句过期的"每累计 100 场出现"（那是 2026-09-05 的旧规则）。
     *  · 预期收益只是**估算**，口径 = 700 场/时（见 config.materialWeightsByTier 头注）。
     */
    const aGrowth = active ? growthOf(active) : 0;
    const recG = Number(area && area.recGrowth) || 0;
    const ratioG = recG > 0 ? aGrowth / recG : 0;
    const riskState = ratioG >= 1.2 ? 'safe' : (ratioG >= 0.95 ? 'even' : 'risk');
    const riskWord = { safe: '稳 妥', even: '均 势', risk: '危 险' }[riskState];
    const riskVerdict = riskState === 'safe' ? '预期稳定推进'
      : (riskState === 'even' ? '胜负难料，注意回血' : '大概率打不过，建议先养宠再来');
    // 尺子量程 = 推荐值 ×1.6（刻度线钉在推荐值处）；实际成长远超量程时截顶显示
    const meterMax = Math.max(recG * 1.6, aGrowth * 1.05, 1);
    const meterPct = Math.max(2, Math.min(100, Math.round(aGrowth / meterMax * 100)));
    const markPct = Math.max(1, Math.min(99, Math.round(recG / meterMax * 100)));
    const ratioTxt = ratioG > 0 ? '×' + (ratioG >= 10 ? Math.round(ratioG) : ratioG.toFixed(2)) : '—';
    const stats = (active && Pet && Pet.getStats) ? Pet.getStats(active) : null;
    const godActive = !!(active && Pet && Pet.isGodPet && Pet.isGodPet(active));
    const activeAv = active ? spriteOf(active.name) : null;
    // 危险度星级 = 图序 1-10 → ★1-5（把已有的"第几张图"画成星级，不新增数值）
    const tierStars = Math.max(1, Math.min(5, Math.ceil(tierNo / 2)));
    // 预期经验：Pet.expRange 与实发经验**同源**（宠物 tooltip 用的就是它），取区间中点
    const FIGHTS_PER_HOUR = 700;
    const expR = (Pet && Pet.expRange && boss) ? Pet.expRange(boss, area) : null;
    const expPerHour = expR ? Math.round((expR.min + expR.max) / 2) * FIGHTS_PER_HOUR : null;
    // 材料/时 = 700 场/时 × 材料分支占比（85/1006，见 config.materialWeightsByTier 头注）
    const matPerHour = Math.round(FIGHTS_PER_HOUR * 85 / 1006);
    // 领主规则：与服务器 battle-sim 同源的常数（缺 BattleSim 时退回注明值）
    const BS = window.BattleSim || {};
    const bossOdds = Math.round(1 / (Number(BS.BOSS_CHANCE) || (1 / 1600)));
    const bossPity = Number(BS.BOSS_PITY) || 2400;
    const bossCd = Number(BS.BOSS_COOLDOWN) || 200;
    // 首通奖励：config 里 boss{N} 任务的一次性 reward（拿不到就整行不渲染）
    const bossQuest = window.Quest && window.Quest.getQuests
      ? window.Quest.getQuests().find(q => q.type === 'boss' && q.area === point.areaId) : null;
    const clearReward = (bossQuest && bossQuest.reward)
      ? Object.keys(bossQuest.reward).map(k => `${esc(k)} ×${bossQuest.reward[k]}`).join('、') : '';
    // 掉落按稀有度三层：档位复用 UI.lootTierOf（掉落播报那套表的唯一事实源）
    const mwTotal = Object.keys(mwCfg).reduce((s, k) => s + (Number(mwCfg[k]) || 0), 0) || 1;
    const drops = [];
    if (areaMatCfg && areaMatCfg.name) drops.push({ name: areaMatCfg.name, t: 1, pct: null });
    Object.keys(mwCfg).forEach(k => {
      if (k === '区域材料') return;                 // 已用该图专属材料名单独列出，不重复
      const w = Number(mwCfg[k]) || 0;
      drops.push({ name: k, t: tierOf(k), pct: w > 0 ? Math.max(1, Math.round(w / mwTotal * 100)) : null });
    });
    drops.push({ name: '装备（未鉴定）', t: 2, pct: null });
    drops.push({ name: '宠物蛋', t: 3, pct: null });
    const dropGrid = t => drops.filter(d => d.t === t).map(d =>
      `<span class="nd-drop-chip${t > 1 ? ' hi' + t : ''}">${esc(d.name)}${d.pct != null ? `<span class="pc">占材料 ${d.pct}%</span>` : ''}</span>`
    ).join('');

    /* 主位卡（2026-09-23）：大数字 = **成长值**（pet.growth，真字段）。
     * ⛔ 不要写「综合战力」：全项目没有那个字段/函数（用户 2026-09-23 拍板不新造），
     *    ui-pet.js 的「成长贡献：生命 +6465…」是 level×growth 的属性增量，不是战力。
     * ⚠️ 它必须定义在上一节之后：aGrowth / stats / godActive / activeAv 都在那里算。 */
    const activeCard = active ? `
      <div class="pd-slot">
        <div class="pd-pav">${activeAv ? '<img src="' + activeAv + '" alt="">' : ''}</div>
        <h3>${esc(active.name)}</h3>
        <div class="pd-grade${godActive ? ' g-god' : ''}">${godActive ? '★ 神 级' : '◆ 普 通'}</div>
        <div class="pd-pw">${fmtNum(aGrowth)}<small>成 长 值 · 该图推荐 ${recG || '—'}</small></div>
        <div class="pd-stats">
          <div><div class="k">成长</div><div class="v">${aGrowth.toFixed(1)}</div></div>
          <div><div class="k">攻击</div><div class="v">${stats ? fmtNum(stats.atk) : '—'}</div></div>
          <div><div class="k">防御</div><div class="v">${stats ? fmtNum(stats.def) : '—'}</div></div>
          <div><div class="k">速度</div><div class="v">${stats ? fmtNum(stats.spd) : '—'}</div></div>
        </div>
      </div>` : '<div class="pd-slot"><h3>还没有出战宠物</h3></div>';

    return `
      <header class="pd-top">
        <h1 class="pd-title">${esc(area ? area.name : point.name)}</h1>
        <div class="pd-tags">
          <span class="pd-tag gold">危险度 ${'★'.repeat(tierStars)}</span>
          ${lo != null ? `<span class="pd-tag">区域 Lv.${lo}–${hi}</span>` : ''}
          <span class="pd-tag jade">推荐成长 ${recG || '—'}</span>
          ${cleared ? '<span class="pd-tag jade">首通 ✓</span>' : '<span class="pd-tag red">含守关领主</span>'}
          ${petChanged ? '<span class="pd-tag gold">已改选 · 进入后生效</span>' : ''}
        </div>
        <button type="button" class="pd-back" id="nd-back">← 返回大地图</button>
      </header>
      <main class="pd-board">
        <section class="pd-panel">
          <div class="pd-hd"><h3>野 怪 簿</h3><span class="sub">该图会出现的 ${mobs.length} 种</span></div>
          <div class="pd-scroll">
            ${mobHtml}
            <div class="pd-sec"><h4>掉 落 预 览</h4><div class="r"></div><em>按稀有度分层</em></div>
            ${dropGrid(3) ? `<div class="pd-tier t3"><b>传 说</b><div class="r"></div></div><div class="pd-drop-grid">${dropGrid(3)}</div>` : ''}
            ${dropGrid(2) ? `<div class="pd-tier t2"><b>稀 有</b><div class="r"></div></div><div class="pd-drop-grid">${dropGrid(2)}</div>` : ''}
            <div class="pd-tier t1"><b>常 规</b><div class="r"></div></div><div class="pd-drop-grid">${dropGrid(1)}</div>
          </div>
        </section>
        <section class="pd-panel">
          <div class="pd-hd"><h3>出 战 编 成</h3><span class="sub">点击候补切换主位</span></div>
          <div class="pd-scroll">
            ${activeCard}
            <div class="pd-sec"><h4>候 补 名 册</h4><div class="r"></div><em>共 ${pets.length} 只</em></div>
            <div class="pd-roster">${petHtml}</div>
            <button type="button" class="pd-add" id="pd-goto-pet">＋ 去宠物页编队</button>
          </div>
        </section>
        <section class="pd-panel pd-boss">
          <div class="pd-hd"><h3>守 关 领 主</h3><span class="sub">每场 ${bossOdds} 分之一</span></div>
          <div class="pd-scroll">
            <div class="pd-bossstage">
              <div class="pd-ring">${boss && (window.PetSprites && window.PetSprites.pathOf) && window.PetSprites.pathOf(boss.name) ? '<img src="' + window.PetSprites.pathOf(boss.name) + '" alt="">' : ''}</div>
              <h3>霸主 · ${esc(boss ? boss.name : '？？？')}</h3>
              <p>本图最高级怪 · 血 ×5 · 攻 ×1.5</p>
            </div>
            <div class="pd-rows">
              <div class="nd-boss-row"><span class="k">等级</span><span class="v warn">Lv.${boss ? (boss.level || '—') : '—'}</span></div>
              <div class="nd-boss-row"><span class="k">现身</span><span class="v txt">保底 ${bossPity} 场必出 · 出后冷却 ${bossCd} 场</span></div>
              <div class="nd-boss-row"><span class="k">首通</span><span class="v ${cleared ? 'hi' : 'warn'}">${cleared ? '✓ 已首通' : '未首通'}</span></div>
              ${clearReward ? `<div class="nd-boss-row"><span class="k">首通奖励</span><span class="v txt">${clearReward}</span></div>` : ''}
              ${loopHtml}
              <div class="nd-boss-row"><span class="k">专属掉落</span><span class="v txt">${esc(areaMatCfg && areaMatCfg.name ? areaMatCfg.name : '—')}</span></div>
            </div>
          </div>
        </section>
      </main>
      <footer class="pd-dep">
        <div>
          <div class="pd-risklab">
            <span class="k">风 险 评 估</span>
            <span class="st s-${riskState}">${riskWord}</span>
            <span class="pc">${ratioTxt} · ${riskVerdict}</span>
          </div>
          <div class="pd-meter">
            <i class="s-${riskState}" style="width:${meterPct}%"></i>
            <div class="mark" style="left:${markPct}%" data-l="推荐成长 ${recG || '—'}"></div>
          </div>
        </div>
        <div>
          <div class="pd-yield">
            <div class="pd-chip"><span class="k">经验</span><span class="v">${expPerHour != null ? '+' + fmtNum(expPerHour) : '—'}</span><span class="u">/时</span></div>
            <div class="pd-chip"><span class="k">材料</span><span class="v">≈ ${matPerHour}</span><span class="u">件/时</span></div>
            <div class="pd-chip"><span class="k">领主保底</span><span class="v">${bossPity}</span><span class="u">场</span></div>
          </div>
          <p class="pd-note">进入后自动挂机，经验 / 材料 / 装备持续入账；<b>打不过会自动停</b>，不消耗委托次数。收益按 700 场/时 口径估算。</p>
        </div>
        <div class="pd-acts">
          <button type="button" class="pd-btn" id="nd-fight">只 进 战 斗</button>
        <button type="button" class="pd-go" id="nd-idle"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/></svg> 开始挂机</button>
        </div>
      </footer>`;
  }

  // 详情页内待生效的出战选择：点卡片只先记下，点「只进战斗/开始挂机」才真正切换
  let pendingPetId = null;

  function renderAreaDetail(point) {
    const el = $('area-detail');
    const body = $('area-detail-body');
    if (!el || !body) return;
    body.innerHTML = areaDetailHTML(point, pendingPetId);
    const Battle = window.Battle;
    // 返回大地图：不动挂机、不应用待选宠物（看完就走，原挂机继续跑）
    const back = body.querySelector('#nd-back');
    if (back) back.onclick = () => { el.hidden = true; pendingPetId = null; };
    /* 「去宠物页编队」（2026-09-23 新增）：本页只负责"选谁上阵"，换宠/培养回宠物页。
     * 说明：原来设计稿里的「＋ 上阵新宠」位在本作没有对应玩法（名册 = 已拥有的全部宠），
     * 所以这里落成真实入口，不做一个点了没反应的假格子。 */
    const gotoPet = body.querySelector('#pd-goto-pet');
    if (gotoPet) gotoPet.onclick = () => {
      el.hidden = true; pendingPetId = null;
      if (UI.switchPage) UI.switchPage('pet');
    };
    // 出战宠物切换：只记下待选并重渲染（真正 setActive 推迟到进入按钮那一刻）
    body.querySelectorAll('.nd-pet').forEach(card => {
      card.onclick = () => {
        const pid = Number(card.dataset.pid);
        if (!pid || !window.Pet) return;
        pendingPetId = pid;
        renderAreaDetail(point);
      };
    });
    // 应用待选宠物，返回「是否换了出战宠物」
    const applyPendingPet = () => {
      const pid = pendingPetId;
      pendingPetId = null;
      if (pid != null && window.Pet && window.Pet.setActive) window.Pet.setActive(pid);
      return pid != null;
    };
    /* 停掉正在跑的挂机（换图进战斗 / 换宠重开才需要）。
     * 顺序与原因都封装在 IdleBridge.handoff() 里（先结算最后一段 → 只拆本地、不发 stop，
     * 服务器侧由紧接着的 battle_session('start')「停旧建新」一条事务接替）——
     * UI 层不需要知道这些先后，只管说"我要交棒"。 */
    /* 2026-09-18：实现收到 `main.js` 的 `window.Game.stopIdle`（与 startIdleAt 对称的一对）——
     * 任务胶囊的「去做」也要停旧挂机再开打，两份实现会漂，所以只留一处。 */
    const stopRunningIdle = () => (window.Game && window.Game.stopIdle
      ? window.Game.stopIdle() : Promise.resolve({ ok: true, idle: false }));
    // 进战斗页（不自动挂机）
    const enterBattle = () => {
      const el2 = $('area-detail');
      if (el2) el2.hidden = true;
      if (window.UI && window.UI.switchPage) window.UI.switchPage('battle');
      if (window.UI && window.UI.updateBattleArea) window.UI.updateBattleArea(Battle && Battle.getCurrentArea());
    };
    const fight = body.querySelector('#nd-fight');
    if (fight) fight.onclick = async () => {
      const changed = applyPendingPet();
      const cur = Battle && Battle.getCurrentArea && Battle.getCurrentArea();
      const sameMap = !!(cur && cur.id === point.areaId);
      try {
        // 进别的图的战斗页必须先停旧挂机：托管演出/结算都锚在旧图会话上，切图后剧本与掉落全错位。
        // 换了出战宠同理：旧会话绑的是旧宠，留着也会被下一个战报停掉。
        if (!sameMap || changed) await stopRunningIdle();
        if (!sameMap && Battle && !Battle.selectArea(point.areaId)) {
          UI.showToast && UI.showToast('无法进入', '该图暂不可用。');
          return;
        }
      } catch (e) { /* 停挂机失败不阻断进图 */ }
      enterBattle();
    };
    /* 开始挂机：换图/换宠时先停旧挂机（先结算，收益不丢），再选图并**直接**启动。
     * 本图已在挂且没换宠 = 重复点击：直接进战斗页看，绝不能再启动一次（那会停掉挂机）。
     * ⚠️ 2026-09-13 三处改动（用户实测"换图挂机后过几分钟失效、要重新进图再点"）：
     *   ① 不再 `setTimeout(150)` 去点主按钮 —— 那等于把"能不能挂起来"交给按钮那一刻的
     *      状态机（占用权是否为空 / 血量是否 >0），任一条不满足就静默失败或走成"停止"分支。
     *      现在直接调 window.Game.startIdleAt（主按钮用的是同一个函数，门槛只有一份）。
     *   ② 启动结果如实回报（toast + 日志），不再"看起来挂上了其实没有"。
     *   ③ 整个切换期间按钮禁用 + 显示"切换中…"：这段要等一次网络结算（几百毫秒到 1 秒），
     *      以前界面毫无反馈 → 玩家必然再点一次，两次点击会在不同时刻停/起会话，正是散架来源。 */
    const idle = body.querySelector('#nd-idle');
    if (idle) idle.onclick = async () => {
      if (idle.dataset && idle.dataset.busy === '1') return;   // 防连点
      if (idle.dataset) idle.dataset.busy = '1';
      const keepHtml = idle.innerHTML;
      idle.disabled = true;
      idle.textContent = '切换中…';
      try {
        const changed = applyPendingPet();
        const cur = Battle && Battle.getCurrentArea && Battle.getCurrentArea();
        const sameMap = !!(cur && cur.id === point.areaId);
        const running = !!((window.IdleBridge && window.IdleBridge.isActive && window.IdleBridge.isActive())
          || (Battle && Battle.isRunning && Battle.isRunning()));
        if (running && sameMap && !changed) { enterBattle(); return; }
        if (running) await stopRunningIdle();
        if (!sameMap && Battle && !Battle.selectArea(point.areaId)) {
          UI.showToast && UI.showToast('无法进入', '该图暂不可用。');
          return;
        }
        enterBattle();
        const G = window.Game;
        const r = (G && G.startIdleAt) ? await G.startIdleAt(point.areaId) : null;
        if (r && r.error && UI.showToast) {
          UI.showToast('挂机没起来', (G && G.startIdleErrorText) ? G.startIdleErrorText(r) : '请再点一次「开始挂机」');
        }
      } catch (e) { /* 停挂机失败不阻断启动 */ }
      finally {
        if (idle.dataset) idle.dataset.busy = '0';
        // 详情页可能已重渲染（原节点已脱离文档）→ 那种情况下不用还原
        if (idle.parentNode) { idle.disabled = false; idle.innerHTML = keepHtml; }
      }
    };
  }

  /* 顶栏面包屑（2026-09-23）：详情页打开时，顶栏那节空白处显示「世界地图 / 图名」。
   * 只写文本，**不管显隐** —— 显隐由 CSS 判定（`#area-detail[hidden]` 一挂就自动收起），
   * 这样"关页 / 切页 / 兜底路径"都不需要各自记得清一遍（少一处漏清就是少一个残留 bug）。 */
  function setTopCrumb(text) {
    const el = document.getElementById('topbar-crumb');
    if (el) el.textContent = text || '';
  }

  function showAreaDetail(point) {
    const el = $('area-detail');
    const body = $('area-detail-body');
    if (!el || !body) {
      // 兜底：容器缺失（老页面结构）时保持原行为直接进战斗
      if (window.UI && window.UI.switchPage) window.UI.switchPage('battle');
      return;
    }
    pendingPetId = null;
    renderAreaDetail(point);
    setTopCrumb('世界地图 / ' + (point && point.name ? point.name : ''));
    el.hidden = false;
  }

  // 对外 API
  UI.renderWorldMapPage = renderWorldMapPage;
  UI.showAreaDetail = showAreaDetail;
  UI.setTopCrumb = setTopCrumb;   // 副本（ui-trial-entry）/ 塔（ui-tower-entry）共用同一条面包屑
  UI.healActivePet = healActivePet;
  UI.capName = capName;
})();
