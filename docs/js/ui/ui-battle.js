/* ============================================================
 * ui/ui-battle.js —— 战斗页 UI
 * 职责：
 *  1. 累计统计（战斗场数 / 获得装备数）
 *  2. 掉落播报（独立「掉落」面板 + toast）
 *  3. 战斗视觉（血条 / 行动条 / 攻击动画 / 飘字）
 *  4. 挂机状态徽章、战斗按钮
 *  5. 快捷操作区（换宠 / 穿脱装备 / 属性预览）
 * 依赖：pet / equipment（只读查询与穿脱接口）；通用组件来自 ui-common
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  // 复用通用组件（ui-common 已先行加载并挂载到 UI）
  const { escapeHtml, $ } = UI;

  const Config = window.Config;
  const { getActivePet, getPets, getStats, setActive, getBonusText } = window.Pet;
  const PetSprites = window.PetSprites;

  // 从战斗标签（"血狐 等级：9级"）里提取纯名字，用于匹配立绘；Boss 带「霸主·」前缀也要剥掉
  function pureName(name) {
    if (!name) return '';
    return String(name).replace(/^霸主·/, '').split(' 等级：')[0].trim();
  }
  // 数字千分位：挂机页的血量/经验都是六到七位，不加分隔符得一格格数（2026-09-15）
  function groupNum(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // 图标挂载：优先逐帧动画立绘 → 静态立绘 <img> → 空（不回退 emoji，2026-09-10 移除占位头像）。
  function mountIcon(el, name) {
    if (!el) return false;
    const n = pureName(name);
    el.dataset.pet = n;
    // ⚠️ 2026-09-21：这里原来要给「受击轮廓闪光层」写 `--sprite`（用它当 mask-image 的遮罩）。
    // 命中特效改用素材版（脚底墨爆 `.hit-fx`）之后那层已删 ⇒ `--sprite` 整条链路
    // （CSS 的 mask-image + 这里的写入）一起清掉，**别留死代码**（守值会盯着）。
    if (PetSprites && PetSprites.mountAnimated(el, n)) return true;
    if (PetSprites && PetSprites.mount(el, n)) {
      const img = el.firstElementChild;
      if (img) img.classList.add('pet-breathe'); // 静态立绘走 CSS 待机呼吸
      return true;
    }
    el.textContent = '';
    return false;
  }
  // 小尺寸图标用头像版（从立绘裁出的头部），无素材则留空
  function mountIconAvatar(el, name) {
    if (!el) return false;
    if (PetSprites && PetSprites.mountAvatar(el, pureName(name))) return true;
    el.textContent = '';
    return false;
  }

  /* ---------- 当前地图 ---------- */
  function updateBattleArea(area) {
    const box = $('battle-area-info');
    if (!box) return;
    /* 爬塔进行中（副本 trial / 通天塔 tower）：顶部信息条由对应引擎写（"第 N/M 层 · 第 k/5 只"）。
     * 这里必须让位 —— 否则任何一次 renderAll / 切页都会把它冲成野图口径
     * （2026-09-10 浏览器实测：塔战斗时顶部显示"请先到世界地图选择一张地图"）。
     * 用 BattleSession 判定（它覆盖整局、含层间空隙）；不能用 Battle.state.mode——层间会复位成 'wild'。 */
    if (window.BattleSession && (window.BattleSession.is('tower') || window.BattleSession.is('trial'))) return;
    /* 战斗页被副本/塔占用时，顶部信息条是它们在写（副本层数 / 塔层阶）；
     * 野图这边任何一次刷新（renderAll 每隔几秒就会走到这里）都不许把它覆盖成"当前地图"。 */
    const S = window.BattleSession;
    if (S && !S.isIdle() && !S.is('wild')) return;
    if (area) {
      /* 当前地图：地图名当主角（原来最亮的是页名"野外探险"，玩家最常看的这张信息反而最小最灰）。
       * 推荐成长标签按「出战宠的成长 vs 该图 recGrowth」上色，只做提示，不拦人 ——
       * 数字口径与世界地图「推荐成长」同一份事实源（Config.battle.areas[].recGrowth）。 */
      const pet = getActivePet && getActivePet();
      const growth = Number(pet && pet.growth) || 0;
      const rec = Number(area.recGrowth) || 0;
      const gap = rec - growth;
      const recCls = gap <= 0 ? 'is-ok' : (gap <= 3 ? 'is-warn' : 'is-risk');
      box.innerHTML = '<span class="bai-inner">'
        + `<span class="bai-name">${escapeHtml(area.name)}</span>`
        + (rec ? `<span class="bai-rec ${recCls}">推荐成长 ${rec}</span>` : '')
        + '</span>';
    } else {
      box.innerHTML = '<span class="bai-empty"><svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg> 请先到世界地图选择一张地图，选好即自动挂机打怪、掉装备和宠物蛋</span>';
    }
    // 切换战斗舞台背景图（data-area-id 设在 .battle-stage，触发 CSS 三层背景）
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (stage && typeof stage.setAttribute === 'function') {
      if (area && area.id) stage.setAttribute('data-area-id', area.id);
      else stage.removeAttribute('data-area-id');
      // 背景滚动：设一层图宽 = 舞台高 × 1376/768（auto 100% 时图宽=舞台高×1.79），位移一个图宽无缝循环
      const h = stage.offsetHeight || 0;
      if (stage.style && stage.style.setProperty) stage.style.setProperty('--bg-w', (h * (1376 / 768)) + 'px');
      if (stage.classList && !stage.classList.contains('stage-scroll')) stage.classList.add('stage-scroll');
    }
  }
  /* 顶部「返回地图」按钮：回到世界地图页（二级菜单）选图（只绑一次） */
  (function bindReturnMap() {
    const openBtn = $('btn-change-map');
    if (openBtn && !openBtn.__mapBound) {
      openBtn.__mapBound = true;
      openBtn.addEventListener('click', () => {
        if (window.UI && window.UI.switchPage) window.UI.switchPage('worldmap');
      });
    }
  })();

  /* ---------- 累计统计（main.js 传入数据，避免 ui 依赖 battle） ---------- */
  function renderStats(totalFights, totalEquipDrops) {
    $('stat-fights').textContent = String(totalFights);
    $('stat-equips').textContent = String(totalEquipDrops);
  }

  /* ---------- 掉落播报（main.js 编排后调用；只显示掉落物品，不显示战斗过程） ----------
   * 挂机没有「地上的东西」可以踩（不像别的游戏能走过去捡），所以掉宝的信息只能落在消息控制台里——
   * 于是靠【字号 + 字重 + 辉光】把三档拉开，档位表在 config.js 的 `drop.lootTiers`。
   * 判据：越难出 / 越关键，字越大越亮；**日常材料不套档位 class = 不提亮**（提亮一切等于没提亮）。
   * 颜色不在这里定：装备沿用白/蓝/金三档稀有度色，宠物蛋走 .loot-egg 幽蓝。 */
  function lootTierOf(name) {
    const t = (Config && Config.drop && Config.drop.lootTiers) ? Config.drop.lootTiers[name] : 0;
    return Number(t) || 1;
  }

  /* ---------- 掉落演出（2026-09-16）----------
   * 挂机没有"地上的东西"可捡，掉落的反馈原本只有聊天框里一行字 —— 玩家挂机一小时，
   * 最容易错过的恰恰是"刚掉了好东西"。所以补两层：
   *   ① 飞入：东西从怪身上飞进顶栏背包（眼睛会跟着走，知道它进包了）
   *   ② 横幅：只有稀有档（tier3 / 金装 / 蛋）才出。普通材料不打扰 —— 天天出就等于没出。
   * ⚠️ 纯表现：拿不到坐标 / 不在战斗页时一律静默跳过，绝不影响结算。
   *
   * 🔴 起点必须【逐个候选验 rect】（2026-09-16 首次上线后用户反馈"没看到飞"的真因）：
   *   掉落播报发生在每场结算之后，而那一刻 `#enemy-fighter` 正好被 idle-bridge
   *   收成 display:none（它要等飘字播完再收起，下一只怪上台才恢复）。
   *   display:none 的元素 **querySelector 照样能取到**，只是 rect 全 0 ——
   *   所以"取到元素就用"会让每一次掉落都拿不到起点，飞入永远不出现。
   *   这里的规矩：取到 → 验 rect → 不行就换下一个候选；全都不行才当作"战斗页不在前台"。 */
  function rectOf(sel) {
    const el = document.querySelector(sel);
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return (r.width && r.height) ? r : null;
  }
  function lootOrigin() {
    // ① 怪身上（东西是从它身上掉的）
    const av = rectOf('#tab-battle .fighter-enemy .stage-avatar');
    if (av) return { x: av.left + av.width / 2, y: av.top + av.height * 0.42 };
    // ② 怪被收起 / 换场空档 → 退回舞台右侧：那本来就是怪站的位置
    const stage = rectOf('#tab-battle .battle-stage');
    if (stage) return { x: stage.left + stage.width * 0.72, y: stage.top + stage.height * 0.52 };
    return null; // 战斗页不在前台：不飞（免得别的页面莫名飘东西）
  }
  function flyToBag(text, kind) {
    if (typeof document === 'undefined' || !document.body) return;
    // 玩家自己在设置里关了动画 → 尊重，不飞
    if (document.body.classList && document.body.classList.contains('rm-anim')) return;
    const bag = $('topbar-bag');
    const from = lootOrigin();
    if (!bag || !from || !bag.getBoundingClientRect) return;
    const to = bag.getBoundingClientRect();
    if (!to.width) return;
    // 兜底信号：背包图标自己亮一下（飞行物万一没被注意到，"进包了"这件事也不会丢）
    if (bag.classList) {
      bag.classList.remove('bag-pulse');
      void bag.offsetWidth;
      bag.classList.add('bag-pulse');
      setTimeout(() => bag.classList.remove('bag-pulse'), 480);
    }
    const el = document.createElement('div');
    el.className = 'loot-fly' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    document.body.appendChild(el);
    const dx = (to.left + to.width / 2) - from.x;
    const dy = (to.top + to.height / 2) - from.y;
    /* 用 Web Animations 而不是 transition：元素刚插进 DOM 就改 transform 时，
     * 浏览器可能还没算过初始样式 → transition 不生效，东西直接闪到终点（看着就像"没飞"）。
     * WAAPI 由 JS 直接给时长，不受这个时序影响。老浏览器退回 transition。 */
    if (el.animate) {
      el.animate(
        [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
         { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.72)', opacity: .15 }],
        { duration: 620, easing: 'cubic-bezier(.35,0,.25,1)', fill: 'forwards' }
      );
    } else {
      const go = () => {
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.72)';
        el.style.opacity = '.15';
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(go); else setTimeout(go, 16);
    }
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 720);
  }
  /* 舞台横幅：cls 决定样式，lines = [{c:class, t:文本}]，播完自己删。返回元素供挂事件。 */
  function stageBanner(cls, lines, life) {
    if (typeof document === 'undefined' || !document.body) return null;
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = (lines || []).map(l => '<div class="' + l.c + '">' + escapeHtml(l.t || '') + '</div>').join('');
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, life || 2300);
    return el;
  }
  /* 材料名 → 用途配色 class：现读 Config.trade.materials（那里是材料名的唯一定义处），
   * **不在这里另抄一份名单** —— 抄了就是第二份事实源，改了材料表忘了改这儿就静默失效。
   * 分工：**字号 = 稀有度（lootTiers），颜色 = 用途（这里）**，两者不重叠。
   * 区域材料（枯荣种荚等）不进 trade.materials → 拿不到类别 → 不上色（用户 2026-09-13：无所谓）。 */
  let matCatMap = null;
  function matClassOf(name) {
    if (!matCatMap) {
      matCatMap = Object.create(null);
      const list = (Config && Config.trade && Config.trade.materials) || [];
      for (const m of list) if (m && m.name && m.category) matCatMap[m.name] = m.category;
    }
    const c = matCatMap[name];
    if (c === 'evo') return 'loot-c-evo';     // 进化系 · 病绿
    if (c === 'stone') return 'loot-c-stone'; // 打造 / 功能石 · 暗紫
    return '';                                 // 腐印、区域材料等：不上色（靠档位字号区分）
  }
  /* 🔴 档位 class 与颜色 class **必须在同一个 span 上**：顶档的流光靠 `currentColor` 取色，
   * 拆成两层（外层档位、内层颜色）的话，外层取到的是继承色而不是装备/材料的颜色 → 金装会变成默认色。 */
  function addLootEntry(html, tier, colorCls) {
    if (!UI.consoleLog) return;
    const t = Math.max(1, Math.min(3, Number(tier) || 1));
    // 档位 class 用通用的 hi2 / hi3（不是 loot-t*）：鉴定揭晓、打造出 T1、地图掉落预览都要复用同一套
    const cls = [colorCls || '', t > 1 ? 'hi' + t : ''].filter(Boolean).join(' ');
    // 掉落消息统一进消息控制台（loot 分类）；时间戳与滚动由控制台负责
    UI.consoleLog('loot', cls ? '<span class="' + cls + '">' + html + '</span>' : html);
  }
  function showLoot(reward) {
    // 改法一·单池：reward.type ∈ none/material/equipment/egg，一场最多一件。
    // 仍只保留掉落日志记录（不引入 toast / 中间弹窗）；金装/蛋保留全屏光效。
    if (!reward || reward.type === 'none') return;
    if (reward.type === 'material') {
      const name = reward.material, qty = reward.qty || 1;
      addLootEntry(`${escapeHtml(name)} ×${qty}`, lootTierOf(name), matClassOf(name));
      flyToBag(`${name} ×${qty}`, matClassOf(name) === 'loot-c-evo' ? 'is-evo' : '');
      if (lootTierOf(name) >= 3) {
        stageBanner('loot-banner', [{ c: 'lb-k', t: '稀有掉落' }, { c: 'lb-n', t: name }, { c: 'lb-s', t: '×' + qty }, { c: 'lb-line', t: '' }]);
      }
      return;
    }
    if (reward.type === 'equipment') {
      const r = reward.eq.rarity;
      const q = r.id === 'gold' ? 'fs-q--gold' : (r.id === 'blue' ? 'fs-q--blue' : 'fs-q--white');
      addLootEntry(`${r.label}·${escapeHtml(reward.eq.name)}`,
        r.id === 'gold' ? 3 : (r.id === 'blue' ? 2 : 1), 'loot-q ' + q);
      if (r.id === 'gold') {
        flashStage('loot-flash-gold', 900); // 金装：全屏金光扫过
        screenGoldPulse(); // 金装：屏幕边缘金色脉冲
        if (window.Tips) Tips.show('gold_pulse', '✨ 金装提醒', '出金装时屏幕边缘会闪金光');
        const banner = stageBanner('loot-banner', [
          { c: 'lb-k', t: '稀有掉落' },
          { c: 'lb-n', t: reward.eq.name },
          { c: 'lb-s', t: r.label },
          { c: 'lb-action', t: '去背包鉴定 →' },
          { c: 'lb-line', t: '' }
        ], 5000);
        if (banner) {
          const act = banner.querySelector('.lb-action');
          if (act) act.style.cursor = 'pointer';
          banner.addEventListener('click', (e) => {
            if (e.target === act || (act && act.contains(e.target))) {
              if (UI.switchPage) UI.switchPage('bag');
            }
          });
        }
      } else {
        flyToBag(`${r.label}·${reward.eq.name}`, r.id === 'blue' ? 'is-blue' : '');
      }
      return;
    }
    if (reward.type === 'egg') {
      addLootEntry('宠物蛋 ×1（孵化去「背包 → 宠物蛋」）', 3, 'loot-egg');
      flashStage('loot-flash-blue', 900); // 宠物蛋：幽蓝光扫过
      stageBanner('loot-banner is-blue', [{ c: 'lb-k', t: '稀有掉落' }, { c: 'lb-n', t: '宠物蛋' }, { c: 'lb-s', t: '孵化去「背包 → 宠物蛋」' }, { c: 'lb-line', t: '' }]);
      return;
    }
  }


  /* ---------- 敌方怪物悬浮提示 ---------- */
  const ENEMY_TYPE = {
    normal: { label: '普通', className: 'normal' },
    evolved: { label: '进化', className: 'evolved' },
    mutant: { label: '变异', className: 'mutant' }
  };
  function getBattleEnemy() {
    // 服务器托管挂机：本地 battle.js 从不开场（state.enemy 恒 null），
    // 画面上的怪由 idle-bridge 的演出循环持有 → 回退读它，
    // 否则敌方 tooltip / 名字 / 血量同步全是空的（或本地模式的残留怪）。
    if (window.IdleBridge && window.IdleBridge.isActive && window.IdleBridge.isActive()) {
      return (window.IdleBridge.getShowEnemy && window.IdleBridge.getShowEnemy()) || null;
    }
    return window.Battle?.state?.enemy || null;
  }
  function enemyStat(value) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  }
  function renderEnemyTip(enemy) {
    const tip = $('enemy-tip');
    if (!tip) return;
    if (!enemy) {
      tip.hidden = true;
      return;
    }
    const type = ENEMY_TYPE[enemy.enemyType] || ENEMY_TYPE.normal;
    const weights = enemy.rarityWeights || {};
    // 经验：显示Pet.expRange 的区间，与实际发放（main.js 调 Pet.expFromBattle）同一个函数算出来
    // 经验预览与实发同源（Pet.expRange），UI 不许再自己写一套公式
    const er = window.Pet.expRange(enemy, window.Battle && window.Battle.getCurrentArea());
    const experience = er.min === er.max ? String(er.min) : `${er.min}~${er.max}`;
    // 战斗属性：显示完整（生命/攻击/防御/速度 + 暴击/暴伤/命中/闪避/吸血）
    const pct = (v) => Math.round((Number(v) || 0) * 100) + '%';
    const num = (v) => enemyStat(v);
    tip.innerHTML = `
      <div class="enemy-tip-title">
        <strong>${escapeHtml(enemy.name || '未知怪物')}</strong>
        <span>Lv.${num(enemy.level)}</span>
        <b class="enemy-type ${type.className}">${type.label}</b>
      </div>
      <div class="enemy-tip-group">
        <div class="enemy-tip-heading">基础属性</div>
        <div class="enemy-tip-rows">
          <div class="enemy-tip-row" data-enemy-hp>生命<b>${num(enemy.hp)} / ${num(enemy.maxHp)}</b></div>
          <div class="enemy-tip-row">攻击<b>${num(enemy.atk)}</b></div>
          <div class="enemy-tip-row">防御<b>${num(enemy.def)}</b></div>
          <div class="enemy-tip-row">速度<b>${num(enemy.spd)}</b></div>
        </div>
      </div>
      <div class="enemy-tip-group">
        <div class="enemy-tip-heading">战斗属性</div>
        <div class="enemy-tip-rows">
          <div class="enemy-tip-row">暴击<b>${pct(enemy.critRate)}</b></div>
          <div class="enemy-tip-row">暴伤<b>${pct(enemy.critDamage)}</b></div>
          <div class="enemy-tip-row">命中<b>${num(enemy.hit)}</b></div>
          <div class="enemy-tip-row">闪避<b>${num(enemy.dodge)}</b></div>
          <div class="enemy-tip-row">吸血<b>${pct(enemy.lifesteal)}</b></div>
        </div>
      </div>
      <div class="enemy-tip-group enemy-tip-drop">
        <div class="enemy-tip-heading">掉落信息</div>
        <div class="enemy-tip-rows">
          <div class="enemy-tip-row">难度<b>×${Number(enemy._diff || 0).toFixed(2)}</b></div>
          <div class="enemy-tip-row">经验<b>+${escapeHtml(experience)}</b></div>
          <div class="enemy-tip-row" style="grid-column:1/-1">掉落品质：<span class="rarity-white">白 ${Number(weights.white || 0)}%</span> · <span class="rarity-blue">蓝 ${Number(weights.blue || 0)}%</span> · <span class="rarity-gold">金 ${Number(weights.gold || 0)}%</span></div>
        </div>
      </div>`;
  }
  function updateEnemyTipHp(enemy) {
    const row = $('enemy-tip')?.querySelector('[data-enemy-hp]');
    if (row && enemy) row.textContent = `生命：${groupNum(enemyStat(enemy.hp))} / ${groupNum(enemyStat(enemy.maxHp))}`;
  }
  function positionEnemyTip() {
    const tip = $('enemy-tip');
    const icon = $('enemy-icon');
    if (!tip || !icon) return;
    const GAP = 14; // tip 与立绘的间距
    const ar = icon.getBoundingClientRect();
    const tw = tip.offsetWidth || 280, th = tip.offsetHeight;
    // 优先放在立绘的**左侧偏上**（怪物在舞台右下 → tip 在立绘左边且不挡画面）
    let left = ar.left - tw - GAP;
    let top = ar.top - th + ar.height * 0.4; // 立绘中部偏上对齐
    // 超左缘 → 翻到立绘右侧
    if (left < 8) left = ar.right + GAP;
    // 超右缘 → 贴右缘
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    // 上下夹边
    if (top < 8) top = 8;
    if (top + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function bindEnemyTip() {
    const icon = $('enemy-icon');
    const name = $('enemy-icon-name');
    const tip = $('enemy-tip');
    if (!icon || !name || !tip || tip.dataset.bound) return;
    tip.dataset.bound = '1';
    const show = () => {
      const enemy = getBattleEnemy();
      if (!enemy) return;
      renderEnemyTip(enemy);
      tip.hidden = false;
      positionEnemyTip();
    };
    const hide = () => { tip.hidden = true; };
    icon.addEventListener('mouseenter', show);
    name.addEventListener('mouseenter', show);
    icon.addEventListener('mouseleave', hide);
    name.addEventListener('mouseleave', hide);
    window.addEventListener('resize', positionEnemyTip);
  }

  /* ---------- 战斗视觉（battle.js 调用） ---------- */
  function resetBattle(petName, enemyName, petMaxHp, enemyMaxHp) {
    const enemyFighter = document.getElementById('enemy-fighter');
    if (enemyFighter) enemyFighter.style.display = '';
    bindEnemyTip();
    renderEnemyTip(getBattleEnemy());
    mountIcon($('pet-icon'), petName);
    $('pet-icon-name').textContent = petName;
    mountIcon($('enemy-icon'), enemyName);
    $('enemy-icon-name').textContent = enemyName;
    $('enemy-hp-bar').style.width = '100%';
    $('pet-hp-bar').style.width = '100%';
    $('pet-hp-text').textContent = `${groupNum(petMaxHp)}/${groupNum(petMaxHp)}`;
    $('enemy-hp-text').textContent = `${groupNum(enemyMaxHp)}/${groupNum(enemyMaxHp)}`;
    updateEnemyTipHp(getBattleEnemy());
    // 行动条小头像同步本场图标（用头像版，小尺寸更清晰）
    mountIconAvatar($('at-racer-pet'), petName);
    mountIconAvatar($('at-racer-enemy'), enemyName);
    // 敌人差异化表现：变异怪挂 is-mutant（名字血红+体型大）；上一场的击败淡出还原
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (stage && stage.querySelector) {
      const enemyBox = stage.querySelector('.fighter-enemy');
      if (enemyBox && enemyBox.classList) {
        const enemy = getBattleEnemy();
        enemyBox.classList.toggle('is-mutant', !!(enemy && enemy.enemyType === 'mutant'));
        const avatar = enemyBox.querySelector('.stage-avatar');
        if (avatar && avatar.classList) avatar.classList.remove('defeated');
      }
    }
    updateAction(0, 0);
    /* Boss 出场：名字带「霸主·」前缀（服务端与本地都是这个口径，比 isBoss 字段更可靠）。
     * Boss 是稀有事件（1/1600，保底 2400 场），玩家可能几百场才见一次，不能悄无声息地出现。 */
    if (enemyName && String(enemyName).indexOf('霸主·') === 0) {
      stageBanner('boss-banner', [
        { c: 'bb-k', t: '霸主降临' },
        { c: 'bb-n', t: String(enemyName).replace(/^霸主·/, '') }
      ], 2300);
      if (stage && stage.classList) {
        stage.classList.add('boss-arrive');
        setTimeout(() => stage.classList.remove('boss-arrive'), 1200);
      }
    }
  }
  function updateBars(petHp, petMaxHp, enemyHp, enemyMaxHp) {
    $('pet-hp-bar').style.width = Math.max(0, (petHp / petMaxHp) * 100) + '%';
    $('enemy-hp-bar').style.width = Math.max(0, (enemyHp / enemyMaxHp) * 100) + '%';
    $('pet-hp-text').textContent = `${groupNum(petHp)}/${groupNum(petMaxHp)}`;
    $('enemy-hp-text').textContent = `${groupNum(enemyHp)}/${groupNum(enemyMaxHp)}`;
    const enemy = getBattleEnemy();
    if (enemy) enemy.hp = Math.max(0, enemyHp);
    updateEnemyTipHp(enemy);
    // 低血量告警（≤25% 亮红，视觉反馈，不影响战斗数据；测试桩元素可能无 classList，防御处理）
    const petBar = $('pet-hp-bar');
    if (petBar && petBar.classList && typeof petBar.classList.toggle === 'function') {
      petBar.classList.toggle('is-low', petMaxHp > 0 && petHp / petMaxHp <= 0.25);
    }
  }
  // 行动值 → 垂直行动条位置（阴阳师式：0 顶部 → 100 底部，先到底者出手）
  // battle.js 的 tick 依旧调用 updateAction，这里只改表现：头像 top 由 --pct 驱动（CSS min 防止溢出）
  function updateAction(petAction, enemyAction) {
    setRacer('pet', petAction, enemyAction);
    setRacer('enemy', enemyAction, petAction);
    // 血条下方的攻击进度条 + 轨道金色填充：宽度/高度 = 行动值（表现层，战斗逻辑零改动）
    const p = Math.min(100, Math.max(0, petAction));
    const e = Math.min(100, Math.max(0, enemyAction));
    const pb = $('atk-bar-pet'); if (pb) pb.style.width = p + '%';
    const eb = $('atk-bar-enemy'); if (eb) eb.style.width = e + '%';
    const fill = $('at-fill'); if (fill) fill.style.height = Math.max(p, e) + '%';
  }
  function setRacer(side, action, other) {
    const el = side === 'pet' ? $('at-racer-pet') : $('at-racer-enemy');
    if (!el) return;
    const pct = Math.min(100, Math.max(0, action));
    el.style.setProperty('--pct', pct + '%');
    // 当前最接近底部（行动值更大）的一方获得出手权高亮：放大 1.2x + 发光
    if (action >= other && pct > 0) el.classList.add('leading');
    else el.classList.remove('leading');
  }
  // 舞台高光：给 .battle-stage 挂一个短命 class 触发 CSS 动画（震屏/扫光），播完自动摘除
  function flashStage(cls, ms) {
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (!stage || !stage.classList) return;
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), ms);
  }
  // 金装掉落：屏幕四缘金色脉冲（玩家不在战斗页也能余光看到）
  function screenGoldPulse() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.add('gold-pulse-edge');
    setTimeout(() => document.body.classList.remove('gold-pulse-edge'), 1200);
  }
  /* 冲到对方脸前所需的水平位移：量两个立绘的实际间距，冲掉 78%（留一点间隙，别糊在对方脸上）。
   * 视觉方向：我方在左向右冲（正值），敌方在右向左冲（负值）。
   * ⚠️ 位移量必须这么量：舞台是响应式布局，两个立绘的间距随视口宽度变，写死数值必然对不上。 */
  /* 冲刺速度恒定（px/秒）：舞台越宽、两只宠离得越远，冲刺时间自动变长，
   * 而不是距离翻倍速度也翻倍——后者在宽屏上等于瞬移，晃眼。
   * 1700~2000 是"看得出在冲、又不刺眼"的区间，调快调慢改这一个数。 */
  const DASH_MIN = 0.24, DASH_MAX = 0.6; // 秒：太近别一闪而过，太远也别拖沓
  /* 出手节奏按角色类型区分。挂机玩家不一定盯着血条，但能感觉到"这只抬手慢、收招沉"= 不好惹，
   * 类型辨识度就是靠这个建立的，光靠体型大一圈不够。
   *   charge = 前摇(ms)：抬手蓄力，越长越有威胁感，也给玩家反应时间
   *   speed  = 冲刺速度(px/s)：见下方"速度恒定"说明
   *   back   = 后摇(秒)：收招回位，越长显得越笨重
   * 前摇/后摇以 CSS 变量注入（--dash-charge / --dash-back），CSS 里不再写死时长。 */
  const PACE = {
    pet:     { charge: 160, speed: 1800, back: 0.30 },
    normal:  { charge: 140, speed: 1950, back: 0.26 }, // 路边小怪：快、轻、收招利索
    evolved: { charge: 200, speed: 1700, back: 0.36 }, // 进化体：沉稳
    mutant:  { charge: 300, speed: 1450, back: 0.52 }  // 变异体：抬手慢、收招沉
  };
  // 敌人的类型从战斗状态里读；我方固定走 pet 档
  function paceOf(attacker) {
    if (attacker !== 'enemy') return PACE.pet;
    const st = window.Battle && window.Battle.state;
    const type = st && st.enemy && st.enemy.enemyType;
    return PACE[type] || PACE.normal;
  }
  // 返回冲刺时长（毫秒）；量不到距离时返回 0（调用方按 0 处理）
  function setDashDistance(icon, foe, attacker, speed) {
    if (!icon || !foe) return 0;
    const a = icon.getBoundingClientRect(), b = foe.getBoundingClientRect();
    if (!a.width || !b.width) return 0; // 未开战时敌方不可见（尺寸 0），此时不冲
    // 冲进对方容器 40%：立绘是透明 PNG，角色本体只占中间约 78%（两边各留 11%），
    // 只按容器边缘对齐的话，视觉上角色本体离对方还差一截，看着像半路刹车。
    const OVERLAP = 0.4;
    const toRight = attacker === 'pet';
    const gap = toRight
      ? (b.left + b.width * OVERLAP) - a.right
      : (b.right - b.width * OVERLAP) - a.left;
    // 只朝对手方向冲：我方恒为非负，敌方恒为非正，避免布局异常时冲反
    const dist = toRight ? Math.max(0, gap) : Math.min(0, gap);
    const dur = Math.min(DASH_MAX, Math.max(DASH_MIN, Math.abs(dist) / speed));
    icon.style.setProperty('--dash-x', Math.round(dist) + 'px');
    icon.style.setProperty('--dash-out', dur.toFixed(3) + 's');
    return Math.round(dur * 1000);
  }
  /* 上一次出手演出的「后摇归位」时长（毫秒）。
   * battle.js 拿它决定行动条冻结多久 —— 命中不等于演完，立绘还得收招回位，
   * 这段时间行动条继续走的话，会出现"人还在半路、下一次出手已经开始蓄力"的错位。 */
  let lastBackMs = 0;
  function attackRecoverMs() { return lastBackMs; }
  function animateAttack(attacker, holdMs) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const foe = attacker === 'pet' ? $('enemy-icon') : $('pet-icon');
    if (!icon) { lastBackMs = 0; return 0; }
    const pace = paceOf(attacker);
    holdMs = holdMs || 0;
    /* 「滞空挥爪」时长 = 逐帧攻击素材自己的时长：冲到脸上后**停住挥完再退**。
     * 静态立绘没有"挥爪"这个过程 ⇒ 滞空 0，行为与以前完全一致（不影响到没有动画的宠/怪）。 */
    const node = icon.querySelector ? icon.querySelector('.pet-anim') : null;
    const anim = (node && window.PetSprites && PetSprites.animOf) ? PetSprites.animOf(node.dataset.petName) : null;
    const atkDurMs = (anim && anim.attack && parseFloat(anim.attack.dur))
      ? Math.round(parseFloat(anim.attack.dur) * 1000) : 0;
    /* 归位时长必须把【滞空】算进去：battle.js / idle-bridge 拿它冻结行动条。
     * 漏掉的话会出现注释里警告过的错位——"人还贴在怪脸上，下一手已经在原地蓄力"。
     * ⚠️ 托管挂机的行动条定速会「扣掉冻结开销」（idle-bridge 的 costOf），所以挂机模式下
     *    这笔滞空不影响出刀数，只是把每刀重新铺在时间轴上。 */
    lastBackMs = Math.round(pace.back * 1000) + holdMs + atkDurMs;
    const dashMs = setDashDistance(icon, foe, attacker, pace.speed);
    icon.style.setProperty('--dash-charge', (pace.charge / 1000).toFixed(3) + 's');
    icon.style.setProperty('--dash-back', pace.back.toFixed(3) + 's');
    // 滞空：CSS 把"回退"动画往后推这么久 ⇒ 冲到脸上先停住挥完，再退回来
    icon.style.setProperty('--dash-hold', (atkDurMs / 1000).toFixed(3) + 's');
    /* 前摇（蓄力压扁）→ 扑击（冲到对方脸上）→ 滞空挥爪 → 后摇（收招回位）。
     * 连击时必须先摘掉旧 class 并强制重排：同名 class 的 CSS 动画不会自己重播，
     * 不重排的话第二次出手会丢掉前摇动作，只剩一段位移。 */
    clearTimeout(icon.__chargeT);
    clearTimeout(icon.__attackT);
    icon.classList.remove('charging', 'attacking');
    void icon.offsetWidth;
    icon.classList.add('charging');
    icon.__chargeT = setTimeout(() => {
      icon.classList.remove('charging');
      icon.classList.add('attacking');
      icon.__attackT = setTimeout(() => icon.classList.remove('attacking'),
        dashMs + holdMs + atkDurMs + pace.back * 1000);
    }, pace.charge);
    /* 逐帧动画立绘：攻击帧必须等【冲到对方脸上】才播。
     * 🔴 2026-09-21 用户要求："跑到怪物脸上之后才播放出手动作"、"停在怪脸上挥完再退" ——
     *    起手就播的话，玩家看到的是"在原地挥爪子、爪子打在空气里"，冲刺位移成了白演。
     * 时刻 = 前摇 + 冲刺（就是本函数最后 return 的"命中时刻"，与伤害结算同一刻度，不另算一份）；
     * "退回原位"由上面的 --dash-hold 推到挥完之后 ⇒ 观感 = 冲过去 → 在脸上挥完 → 再退。 */
    if (node && window.PetSprites && PetSprites.setAnim && atkDurMs) {
      const contactMs = pace.charge + dashMs;
      clearTimeout(icon.__animAtkT);
      clearTimeout(icon.__animBackT);
      icon.__animAtkT = setTimeout(() => {
        if (!node.isConnected) return;
        PetSprites.setAnim(node, 'attack');
        // 挥完（+一点停留）再切回待机；时长同样取素材自己的 dur，不写死
        icon.__animBackT = setTimeout(() => {
          if (node.isConnected) PetSprites.setAnim(node, 'idle');
        }, atkDurMs + 120);
      }, contactMs);
    }
    // 命中时刻（前摇结束 + 冲到对方脸上）：伤害结算与受击特效都对齐这一刻，
    // 由调用方决定怎么用，表现层不写死——前摇按类型、冲刺按距离，都是变的。
    return pace.charge + dashMs;
  }
  function animateHit(target, isCrit) {
    const icon = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    if (!icon) return;
    clearTimeout(icon.__hitT);
    icon.classList.remove('hit', 'crit-hit');
    // 连续挨打时，同名 class 的 CSS 动画不会自己重播，必须摘掉 → 强制重排 → 再挂上
    void icon.offsetWidth;
    const cls = isCrit ? 'crit-hit' : 'hit';
    icon.classList.add(cls);
    icon.__hitT = setTimeout(() => icon.classList.remove('hit', 'crit-hit'), isCrit ? 440 : 320);
  }

  /* ---------- 命中特效：脚底墨爆（2026-09-21 新增） ----------
   * 素材 assets/effects/hit-ink/命中墨爆.png = 9 帧 × 256 的横向帧条（透明底）。
   * 🔴 必须用 JS 定时器逐帧写 background-position-x（**像素**值）：不能走 CSS animation ——
   *    design-tokens.css / market-cascade.css 有
   *    `@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important; iteration-count:1!important}}`，
   *    开了「减少动态效果」的机器上动画会被压成静帧（逐帧立绘 2026-09-21 就是这么翻车的，且那是 *{} + !important，盖不住）。
   * 🔴 图片 URL 必须由 JS 写内联 background-image：CSS 自定义属性里的相对 url() 会按样式表所在目录 css/ 解析 → 404 全白。
   * 位置/裁框见 game.css 的 .hit-fx；连击时先清旧元素与旧定时器，避免叠成一坨。 */
  const FX_SRC = 'assets/effects/hit-ink/命中墨爆.png'; // 相对 docs/
  const FX_FRAMES = 9;
  /* 节奏 = 出手者攻击素材自己的时长（不写死），换素材 / 改 attack.dur 自动跟着走：
   * 9 帧里第 5~6 帧（≈2/3 处）炸开，正对攻击素材后 3 格的下劈。
   * ⚠️ 兜底 800ms：静态立绘的宠与怪都没有逐帧攻击素材（45ms/帧 = 405ms 太短，用户反馈看不清）。 */
  const FX_DEFAULT_MS = 800;
  function fxDurationMs(attacker) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const node = icon && icon.querySelector ? icon.querySelector('.pet-anim') : null;
    const anim = (node && window.PetSprites && PetSprites.animOf) ? PetSprites.animOf(node.dataset.petName) : null;
    const d = anim && anim.attack && parseFloat(anim.attack.dur);
    return d > 0 ? Math.round(d * 1000) : FX_DEFAULT_MS;
  }
  function playFx(target) {
    const host = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    if (!host) return;
    clearInterval(host.__fxT);
    if (host.__fxEl) { host.__fxEl.remove(); host.__fxEl = null; }
    const el = document.createElement('div');
    el.className = 'hit-fx';
    el.style.backgroundImage = 'url("' + FX_SRC + '")';
    el.style.backgroundSize = (FX_FRAMES * 100) + '% 100%';
    host.appendChild(el);
    host.__fxEl = el;
    // 出手者是"被打中者的对面"：打中敌人 ⇒ 我方出手；打中我方 ⇒ 敌方出手
    const frameMs = Math.max(30, Math.round(fxDurationMs(target === 'pet' ? 'enemy' : 'pet') / FX_FRAMES));
    let k = 0;
    const step = () => {
      if (!el.isConnected) { clearInterval(host.__fxT); host.__fxEl = null; return; } // 怪下场/切页兜底
      if (k >= FX_FRAMES) { clearInterval(host.__fxT); el.remove(); host.__fxEl = null; return; }
      el.style.backgroundPositionX = (-k * el.clientWidth) + 'px'; // 必须像素：百分比是按整张 9 格帧条算的
      k++;
    };
    step();
    host.__fxT = setInterval(step, frameMs);
  }
  // 战斗飘字：在目标头像上方弹带类型标签的数字（攻击：-X / 暴击：-X / 吸血：+X）
  // 普通白 / 暴击亮红大20% / 吸血暗绿侧边；同一目标同时最多 3 个，超出延迟 120ms 排队；
  // 淡入 → 上飘 → 淡出 0.8s 后自动移除。只做表现，不参与任何战斗计算。
  const floatActive = new WeakMap();
  const FLOAT_LABEL = { normal: '攻击', skill: '技能', crit: '暴击', lifesteal: '吸血', miss: '闪避' };
  function showFloatingText(target, text, type, opts) {
    const host = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    if (!host) return;
    const active = floatActive.get(host) || 0;
    if (active >= 3) {
      setTimeout(() => showFloatingText(target, text, type, opts), 120);
      return;
    }
    floatActive.set(host, active + 1);
    const el = document.createElement('div');
    el.className = 'fs-float ' + (type || 'normal') + (opts && opts.side === 'right' ? ' side-right' : '');
    const label = (opts && opts.label) || FLOAT_LABEL[type] || '攻击';
    const sign = type === 'lifesteal' ? '+' : type === 'miss' ? '' : '-';
    el.textContent = type === 'miss' ? label : `${label}：${sign}${text}`;
    host.appendChild(el);
    setTimeout(() => {
      el.remove();
      floatActive.set(host, Math.max(0, (floatActive.get(host) || 1) - 1));
    }, 850);
  }
  // battle.js 结算时调用（伤害/暴击/吸血实际生效那一刻）→ 转飘字；业务计算零改动
  function showDamage(target, damage, type, label) {
    if (type === 'crit') {
      flashStage('stage-shake', 300); // 暴击：舞台震屏
      flashStage('crit-impact', 400); // 暴击：屏幕边缘红脉冲
    }
    // 命中才有痕迹：闪避（miss）与吸血回血（lifesteal，飘在出手者身上）都不播
    if (type !== 'miss' && type !== 'lifesteal') playFx(target);
    // label：自定义飘字标签（如主动技能名"腐蚀喷吐：-1500"）；吸血固定右侧错位
    showFloatingText(target, damage, type || 'normal', type === 'lifesteal' ? { side: 'right' } : (label ? { label: label } : null));
  }

  /* ---------- 挂机状态徽章（battle.js 调用） ----------
   * 两个显示点：① 战斗页内的 #status-badge ② 顶栏 #topbar-idle。
   * 🔴 2026-09-17 加顶栏那份：挂机是后台行为，以前只有战斗页看得到，
   *   玩家逛市集 / 商店 / 百科时完全不知道挂机还在不在跑（掉线了也看不出来）。
   *   顶栏那份点一下回世界地图（战斗页从地图进，不在侧边栏）。 */
  const STATUS_TEXT = { idle: '空闲', fighting: '挂机中', stopped: '已停止', healing: '恢复中', recovering: '回血中' };
  const STATUS_RUNNING = { fighting: 1, healing: 1, recovering: 1 };
  function updateStatus(type, fightCount) {
    const badge = $('status-badge');
    badge.textContent = STATUS_TEXT[type] || type;
    badge.className = 'status-badge ' + type;
    $('fight-count').textContent = fightCount || 0;

    const chip = $('topbar-idle');
    if (chip) {
      chip.textContent = STATUS_TEXT[type] || type;
      chip.className = 'idle-chip'
        + (STATUS_RUNNING[type] ? ' is-running' : '')
        + (type === 'fighting' ? ' is-fighting' : '');
      chip.title = '挂机状态 · 点击回到世界地图';
      if (!chip.__bound) {
        chip.__bound = true;
        chip.addEventListener('click', () => { if (UI.switchPage) UI.switchPage('worldmap'); });
      }
    }
  }

  /* ---------- 战斗按钮（main.js 调用，main 决定文案/可用性） ---------- */
  function renderBattleButton(label, disabled) {
    const btn = $('btn-battle');
    btn.textContent = label;
    btn.disabled = !!disabled;
  }
  function renderActiveSkill(skill, cooldown, queued, opts) {
    const btn = $('btn-active-skill');
    if (!btn) return;
    btn.hidden = false; // 主动技能按钮始终显示；未解锁置灰占位（2026-09-03）
    if (!skill) {
      btn.disabled = true;
      btn.textContent = '主动技能 · 未解锁';
      return;
    }
    if (opts && opts.auto) {
      btn.disabled = true;
      btn.textContent = `${skill.name} · 自动释放`;
      btn.title = `托管挂机中由服务器自动释放 · ${Math.round((skill.triggerChance || 0) * 100)}% 概率替代普攻 · ${Math.round(skill.damageMultiplier * 100)}% 伤害 · ${skill.cooldownTurns} 回合冷却`;
      return;
    }
    btn.disabled = cooldown > 0 || queued;
    btn.textContent = queued ? `${skill.name} · 待释放` : cooldown > 0 ? `${skill.name} · 冷却 ${cooldown}` : skill.name;
    // 悬停给出完整口径（触发概率以前 UI 全项目不展示，玩家只看到技能名）
    btn.title = `${Math.round((skill.triggerChance || 0) * 100)}% 概率替代普攻`
      + ` · ${Math.round(skill.damageMultiplier * 100)}% 伤害`
      + (skill.maxHpDamageRate ? ` + 目标最大生命 ${Math.round(skill.maxHpDamageRate * 100)}%` : '')
      + ` · ${skill.cooldownTurns} 回合冷却`;
  }
  (function bindActiveSkill() {
    const btn = $('btn-active-skill');
    if (!btn || btn.__skillBound) return;
    btn.__skillBound = true;
    btn.addEventListener('click', () => window.Battle?.useActiveSkill?.());
  })();

  /* ---------- 对战区：数据 与 快照 是两个状态，分开管 ----------
   * 以前这两件事挤在一个 syncCombatant() 里，靠「战斗中早退」区分，
   * 结果连经验条一起被早退吃掉（挂机时进度条全程不动）。现在拆成两个职责：
   *   1) 数据（经验条 / 等级）→ renderCombatantData()：无条件刷新，永远跟当前出战宠物走。
   *      战斗中升级必须立刻跳，这是玩家唯一盯着的成长反馈。
   *   2) 立绘 / 名字 → syncCombatantSnapshot()：只在非战斗时同步。
   *      战斗中切宠不能把台上的换掉——本场仍由 beginFight 的快照打完。
   * renderAll 分别调用，职责互不遮蔽，不需要任何"在早退之前插一行"的技巧。
   */
  function renderCombatantData() {
    const pet = getActivePet();
    if (!pet) return;
    const text = $('pet-exp-text');
    const percent = $('pet-exp-percent');
    const fill = $('pet-exp-fill');
    if (text && percent && fill) {
      const need = Math.max(1, window.Pet.expNeed(pet.level));
      const current = Math.min(Math.max(0, Math.round(pet.exp || 0)), need);
      const progress = Math.round(current / need * 100);
      text.textContent = `经验 ${groupNum(current)} / ${groupNum(need)}`;
      percent.textContent = `${progress}%`;
      fill.style.width = `${progress}%`;
    }
    // 等级标签同步真实等级。只对同名宠物改：战斗中途切宠时台上还是旧宠，名字保持开战快照。
    const nameEl = $('pet-icon-name');
    if (nameEl && pureName(nameEl.textContent) === pet.name) {
      nameEl.textContent = `${pet.name} 等级：${pet.level || 1}级`;
    }
  }

  function syncCombatantSnapshot() {
    const pet = getActivePet();
    if (!pet) return;
    /* 战斗页被任何一方占用（本地挂机 / 托管演出 / 副本 / 塔，含层间空隙）时，立绘与敌方显隐
     * 由正在打的那一方维护 —— 这里再同步一次就等于把台上正在打的怪抹掉。
     * 判定用占用权这一个事实源，不再拼 isRunning/isTrialMode/IdleBridge 三个状态
     *（以前市场轮询每 5 秒触发一次 renderAll，层间空隙正好漏判 → 守关者立绘闪没）。 */
    const S = window.BattleSession;
    if (S && !S.isIdle()) return;
    mountIcon($('pet-icon'), pet.name);
    $('pet-icon-name').textContent = `${pet.name} 等级：${pet.level || 1}级`;
    // 未开战：隐藏敌方（避免显示占位怪）
    const enemyFighter = document.getElementById('enemy-fighter');
    if (enemyFighter) enemyFighter.style.display = 'none';
  }

  /* ---------- 左侧出战宠物竖列：悬停看属性 / 点击切换出战（下一场生效） ---------- */
  function renderRoster() {
    const box = $('pet-roster');
    if (!box) return;
    box.innerHTML = '';
    const active = getActivePet();
    const tipBox = $('roster-tooltip');
    for (const pet of getPets()) {
      const s = getStats(pet);
      const equipCount = Object.values(pet.equipment || {}).filter(Boolean).length;
      const bonusText = getBonusText ? getBonusText(pet) : '';
      const btn = document.createElement('div');
      btn.className = 'roster-pet' + (active && pet.id === active.id ? ' active' : '');
      btn.dataset.id = pet.id;
      // 出战竖列用头像版（小尺寸更清晰）
      const avatarSrc = PetSprites && PetSprites.avatarOf(pet.name);
      const iconHtml = avatarSrc ? '<img class="pet-avatar-sprite" src="' + avatarSrc + '" alt="">' : '';
      btn.innerHTML = `<span class="roster-pet-icon">${iconHtml}</span><span class="rp-lv">${pet.level}</span>`;
      btn.onclick = () => {
        if (pet.cloudId && window.Market && Market.isListed && Market.isListed(pet.cloudId)) {
          UI.showToast('⚠️ 已上架的宠物不能出战', '请先在市场取回');
          return;
        }
        setActive(pet.id);
        if (UI.addLog) UI.addLog(` ${pet.name} 出战！`, 'battle');
        syncCombatantSnapshot(); // 战斗页被占用时它自己会让位（见函数内说明）
        renderRoster();
        if (UI.renderAll) UI.renderAll();
      };
      box.appendChild(btn);
    }
    // 事件委托到竖列容器（容器不随 renderAll 重建，悬停状态稳定）：hover 头像 → 共享 tooltip
    if (tipBox && !box.__rosterBound) {
      box.__rosterBound = true;
      const showTipFor = (pet, anchor) => {
        const s = getStats(pet);
        const equipCount = Object.values(pet.equipment || {}).filter(Boolean).length;
        const bonusText = getBonusText ? getBonusText(pet) : '';
        const active = getActivePet();
        // 复用怪物悬浮框同款结构（.enemy-tip-*），只保留宠物该有的信息，不照搬怪物"掉落信息"
        tipBox.className = 'roster-tooltip enemy-tip';
        tipBox.innerHTML = `<div class="enemy-tip-title">
            <strong>${escapeHtml(pet.name)}</strong>
            <span>Lv.${pet.level}</span>
            ${active && pet.id === active.id ? '<b class="enemy-type evolved">出战</b>' : ''}
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">成长</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row">成长值<b>${pet.growth.toFixed(1)}</b></div>
              <div class="enemy-tip-row">经验<b>${pet.exp || 0}</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">基础属性</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row" data-enemy-hp>生命<b>${s.hp}</b></div>
              <div class="enemy-tip-row">攻击<b>${s.atk}</b></div>
              <div class="enemy-tip-row">防御<b>${s.def}</b></div>
              <div class="enemy-tip-row">速度<b>${s.spd}</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">战斗属性</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row">暴击<b>${Math.round(s.critRate * 100)}%</b></div>
              <div class="enemy-tip-row">暴伤<b>${Math.round(s.critDamage * 100)}%</b></div>
              <div class="enemy-tip-row">命中<b>${Math.round(s.hit)}</b></div>
              <div class="enemy-tip-row">闪避<b>${Math.round(s.dodge)}</b></div>
              <div class="enemy-tip-row">吸血<b>${Math.round(s.lifesteal * 100)}%</b></div>
            </div>
          </div>
          <div class="enemy-tip-group">
            <div class="enemy-tip-heading">装备</div>
            <div class="enemy-tip-rows">
              <div class="enemy-tip-row" style="grid-column:1/-1">已装备<b>${equipCount}/12${bonusText && bonusText !== '无' ? '（' + escapeHtml(bonusText) + '）' : ''}</b></div>
            </div>
          </div>
          <div class="roster-quick-actions">
            <button class="rqa-btn" data-rqa="evolve">进化</button>
            <button class="rqa-btn" data-rqa="synth">合成</button>
            <button class="rqa-btn" data-rqa="equip">装备</button>
          </div>`;
        const r = anchor.getBoundingClientRect();
        tipBox.style.left = (r.right + 8) + 'px';
        tipBox.style.top = Math.max(6, r.top) + 'px';
        tipBox.classList.add('show');
      };
      let hoverTarget = null; // 记录当前 hover 的宠物，供按钮点击用
      const hideTip = () => tipBox.classList.remove('show');
      box.addEventListener('mouseover', (e) => {
        const el = e.target.closest ? e.target.closest('.roster-pet') : null;
        if (!el) return;
        hoverTarget = getPets().find(p => p.id === Number(el.dataset.id));
        if (hoverTarget) showTipFor(hoverTarget, el);
      });
      box.addEventListener('mouseout', (e) => {
        if (e.target.closest && e.target.closest('.roster-pet')) hideTip();
      });
      // 鼠标移到 tooltip 上不消失；点快捷按钮跳转
      tipBox.addEventListener('mouseenter', () => { tipBox.classList.add('show'); });
      tipBox.addEventListener('mouseleave', hideTip);
      tipBox.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('.rqa-btn') : null;
        if (!btn || !hoverTarget) return;
        const action = btn.dataset.rqa;
        if (action === 'equip') {
          if (window.UI && UI.switchPage) UI.switchPage('equip');
        } else {
          if (window.UI && UI.switchPage) UI.switchPage('pet');
          setTimeout(() => {
            const tab = document.querySelector('.pet-tab[data-pet-tab="' + action + '"]');
            if (tab) tab.click();
          }, 100);
        }
        hideTip();
      });
    }
  }

  // 胜利演出：敌人立绘淡出下沉（battle.js endFight 胜利时防御式调用）
  function animateVictory() {
    const avatar = document.querySelector('#tab-battle .fighter-enemy .stage-avatar');
    if (!avatar || !avatar.classList) return;
    avatar.classList.add('defeated');
    setTimeout(() => avatar.classList.remove('defeated'), 650);
  }

  /* ---------- 挂机结算汇总（切回前台时弹出） ----------
   * 收到 settle 返回的 r，聚合 r.detail 里的掉落，弹一个结算窗。
   * 太短（<3场 或 <15秒）不弹，避免频繁切标签页被烦。 */
  function showIdleSummary(r) {
    if (!r) return;
    const fights = Number(r.fights) || 0;
    const secs = Number(r.elapsedSec) || 0;
    if (fights < 3 || secs < 15) return; // 太短不弹

    const detail = Array.isArray(r.detail) ? r.detail : [];
    let totalExp = 0;
    const mats = {}; // name -> qty
    let goldCount = 0, blueCount = 0, whiteCount = 0, eggCount = 0;

    for (const row of detail) {
      if (!row) continue;
      totalExp += Number(row.exp) || 0;
      const rw = row.reward;
      if (!rw || !rw.type) continue;
      if (rw.type === 'material' && rw.material) {
        mats[rw.material] = (mats[rw.material] || 0) + (Number(rw.qty) || 1);
      } else if (rw.type === 'equipment' && rw.eq) {
        const rid = (rw.eq.rarity && rw.eq.rarity.id) || 'white';
        if (rid === 'gold') goldCount++;
        else if (rid === 'blue') blueCount++;
        else whiteCount++;
      } else if (rw.type === 'egg') {
        eggCount++;
      }
    }

    // 格式化时长
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const durText = mm > 0 ? mm + '分' + ss + '秒' : ss + '秒';

    // 材料列表
    const matEntries = Object.entries(mats).sort((a, b) => b[1] - a[1]);
    const matHtml = matEntries.length
      ? matEntries.map(([n, q]) => '<div class="is-row"><span>' + escapeHtml(n) + '</span><b>×' + q + '</b></div>').join('')
      : '<div class="is-empty">无新材料</div>';

    // 装备列表
    const eqRows = [];
    if (goldCount) eqRows.push('<div class="is-row gold"><span>金装</span><b>×' + goldCount + '</b></div>');
    if (blueCount) eqRows.push('<div class="is-row blue"><span>蓝装</span><b>×' + blueCount + '</b></div>');
    if (whiteCount) eqRows.push('<div class="is-row"><span>白装</span><b>×' + whiteCount + '</b></div>');
    if (eggCount) eqRows.push('<div class="is-row egg"><span>宠物蛋</span><b>×' + eggCount + '</b></div>');
    const eqHtml = eqRows.length
      ? eqRows.join('')
      : '<div class="is-empty">无新装备</div>';

    // 金装提示
    const goldHint = goldCount
      ? '<div class="is-gold-hint">' + goldCount + ' 件金装待鉴定 · <button class="is-go-bag">去背包鉴定 →</button></div>'
      : '';

    let modal = $('idle-summary-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'idle-summary-modal';
      modal.className = 'equip-detail-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = '<div class="ed-overlay" data-close="1"></div>' +
      '<div class="ed-card is-card">' +
        '<div class="ed-head" style="color:var(--gold,#e7d39a)">挂机结算</div>' +
        '<div class="ed-base">离开了 ' + durText + ' · 打了 ' + fights + ' 场 · 经验 +<span class="is-exp-num">0</span></div>' +
        '<div class="craft-affix-group">' +
          '<div class="grp-title">掉落装备</div>' +
          eqHtml +
          '<hr class="craft-affix-divider">' +
          '<div class="grp-title">材料</div>' +
          matHtml +
        '</div>' +
        goldHint +
        '<div class="ed-actions"><button class="btn-mini" data-close="1">继续挂机</button></div>' +
      '</div>';

    modal.querySelectorAll('[data-close]').forEach(el => el.onclick = () => {
      modal.classList.remove('open');
    });
    const goBag = modal.querySelector('.is-go-bag');
    if (goBag) goBag.onclick = () => {
      modal.classList.remove('open');
      if (UI.switchPage) UI.switchPage('bag');
    };
    modal.classList.add('open');
    // 背包快满提醒
    try {
      const use = window.Supabase && window.Supabase.usageOf && window.Supabase.usageOf('bag');
      if (use && use.cap - use.used <= 3 && !use.full) {
        setTimeout(function(){ showToast('⚠️ 背包快满了', '剩余 ' + (use.cap - use.used) + ' 格 · 去分解一下'); }, 1000);
      }
    } catch(e) {}
    // 数字滚动：经验从 0 滚到实际值。统一走动效层的 UI.setNum（全站唯一的滚动实现）
    var expEl = modal.querySelector('.is-exp-num');
    if (expEl && UI.setNum) UI.setNum(expEl, totalExp, { from: 0 });
    // 装备/材料数量也滚动（错开 100ms，一件件蹦出来）
    modal.querySelectorAll('.is-row b').forEach(function(b, i) {
      var n = parseInt(b.textContent.replace(/[^0-9]/g, ''), 10);
      if (n > 0 && UI.setNum) setTimeout(function(){ UI.setNum(b, n, { from: 0, fmt: function (v) { return '×' + Math.round(v); } }); }, i * 100);
    });
  }

  /* ---------- 对外 API（战斗页） ---------- */
  UI.renderStats = renderStats;
  UI.showLoot = showLoot;
  UI.showIdleSummary = showIdleSummary;
  // 档位对外：世界地图的「掉落预览」要用同一套（不另抄一份名单 → 不会出现第二份事实源）
  UI.lootTierOf = lootTierOf;
  UI.resetBattle = resetBattle;
  UI.updateBars = updateBars;
  UI.updateAction = updateAction;
  UI.animateAttack = animateAttack;
  UI.attackRecoverMs = attackRecoverMs;
  UI.animateHit = animateHit;
  UI.animateVictory = animateVictory;

  /* 升级演出：立绘脚下金环 + "LEVEL UP" 横幅
   * 🔴 原实现有两个毛病（2026-09-16 修）：① `const petIcon = pet-icon` 是笔错
   *   （拿的是个不存在的变量，一进来就抛错）；② 全仓没有任何地方调用它。
   *   结果就是"升级"这件大事在实际游戏里一点表示都没有。 */
  function showLevelUp(newLevel) {
    const icon = $('pet-icon');
    if (icon && icon.classList) {
      icon.classList.remove('level-up');
      void icon.offsetWidth;
      icon.classList.add('level-up');
      setTimeout(() => icon.classList.remove('level-up'), 1600);
    }
    stageBanner('levelup-banner', [
      { c: 'lu-k', t: 'LEVEL UP' },
      { c: 'lu-n', t: newLevel ? ('Lv.' + newLevel) : '' }
    ], 1900);
  }
  UI.showDamage = showDamage;
  UI.showLevelUp = showLevelUp;
  UI.showFloatingText = showFloatingText;
  UI.updateStatus = updateStatus;
  UI.renderBattleButton = renderBattleButton;
  UI.renderActiveSkill = renderActiveSkill;
  UI.updateBattleArea = updateBattleArea;
  UI.renderCombatantData = renderCombatantData;
  UI.syncCombatantSnapshot = syncCombatantSnapshot;
  UI.renderRoster = renderRoster;
})();

  /* ========== 战斗页快捷进化入口 ========== */
  (function initQuickEvo() {
    const btn = document.getElementById('quick-evo');
    if (!btn) return;
    const dot = btn.querySelector('.qevo-dot');

    function checkEvolvable() {
      try {
        const Pet = window.Pet;
        const Evolve = window.Evolve;
        if (!Pet || !Evolve || !Evolve.canEvolve || !Evolve.getRouteMaterial) return;
        const pets = Pet.getPets ? Pet.getPets() : [];
        let anyReady = false;
        for (const p of pets) {
          if (!Evolve.canEvolve(p)) continue;
          const routes = Evolve.getEvolutionRoutes(p);
          const rm = Evolve.getRouteMaterial(p, 0);
          if (rm && rm.enough) { anyReady = true; break; }
        }
        if (dot) dot.hidden = !anyReady;
      } catch(e) { /* silent */ }
    }

    btn.addEventListener('click', () => {
      if (window.UI && window.UI.switchPage) {
        window.UI.switchPage('pet');
        // 切过去后自动点"进化"tab
        setTimeout(() => {
          const tab = document.querySelector('.pet-tab[data-pet-tab="evolve"]');
          if (tab) tab.click();
        }, 100);
      }
    });

    // 每5秒检查一次（用 setTimeout 链 + unref，不阻塞测试进程退出）
    function scheduleCheck() {
      const t = setTimeout(() => { checkEvolvable(); scheduleCheck(); }, 5000);
      if (t.unref) t.unref();
    }
    const t0 = setTimeout(checkEvolvable, 1000);
    if (t0.unref) t0.unref();
    scheduleCheck();
  })();

