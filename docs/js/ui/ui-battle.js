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

  // 从战斗标签（"血狐 等级：9级"）里提取纯名字，用于匹配立绘
  function pureName(name) {
    if (!name) return '';
    return String(name).split(' 等级：')[0].trim();
  }
  // 图标挂载：优先逐帧动画立绘 → 静态立绘 <img> → 回退 emoji。返回 true=已用立绘 / false=回退 emoji。
  function mountIcon(el, name, fallbackEmoji) {
    if (!el) return false;
    const n = pureName(name);
    el.dataset.pet = n;
    if (PetSprites && PetSprites.mountAnimated(el, n)) return true;
    if (PetSprites && PetSprites.mount(el, n)) {
      const img = el.firstElementChild;
      if (img) {
        img.classList.add('pet-breathe'); // 静态立绘走 CSS 待机呼吸
        // 立绘 URL 存到容器上，受击闪光层用它做遮罩（闪光形状 = 角色轮廓，不是糊一个方框）。
        // 用 img.src 而不是相对路径：img.src 是浏览器解析后的绝对 URL，
        // 自定义属性里的相对 url() 会被按样式表目录解析（踩过 /css/assets/... 404 的坑）。
        el.style.setProperty('--sprite', 'url("' + img.src + '")');
      }
      return true;
    }
    el.textContent = fallbackEmoji != null ? fallbackEmoji : '';
    return false;
  }
  // 小尺寸图标用头像版（从立绘裁出的头部），无头像则回退 emoji
  function mountIconAvatar(el, name, fallbackEmoji) {
    if (!el) return false;
    if (PetSprites && PetSprites.mountAvatar(el, pureName(name))) return true;
    el.textContent = fallbackEmoji != null ? fallbackEmoji : '';
    return false;
  }

  /* ---------- 当前地图 ---------- */
  function updateBattleArea(area) {
    const box = $('battle-area-info');
    if (!box) return;
    box.innerHTML = area
      ? `当前地图：<b style="color:#ffcf6b">${escapeHtml(area.name)}</b> · 建议等级 ${escapeHtml(area.recommended)}`
      : '🐣 请先到世界地图选择一张地图，即可自动挂机打怪、掉装备和宠物蛋';
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

  /* ---------- 掉落播报（main.js 编排后调用；只显示掉落物品，不显示战斗过程） ---------- */
  function addLootEntry(html, cls) {
    // 掉落消息统一进消息控制台（loot 分类）；时间戳与滚动由控制台负责
    if (UI.consoleLog) UI.consoleLog('loot', html);
  }
  function showLoot(reward) {
    // 改法一·单池：reward.type ∈ none/material/equipment/egg，一场最多一件。
    // 仍只保留掉落日志记录（不引入 toast / 中间弹窗）；金装/蛋保留全屏光效。
    if (!reward || reward.type === 'none') return;
    if (reward.type === 'material') {
      addLootEntry(`${escapeHtml(reward.material)} ×${reward.qty || 1}`, 'mat');
      return;
    }
    if (reward.type === 'equipment') {
      const r = reward.eq.rarity;
      addLootEntry(`<span class="loot-q ${r.id === 'gold' ? 'fs-q--gold' : r.id === 'blue' ? 'fs-q--blue' : 'fs-q--white'}">${r.label}·${escapeHtml(reward.eq.name)}</span>`, r.id);
      if (r.id === 'gold') flashStage('loot-flash-gold', 900); // 金装：全屏金光扫过
      return;
    }
    if (reward.type === 'egg') {
      addLootEntry('宠物蛋 ×1（去「宠物」页或「装备」页背包孵化）');
      flashStage('loot-flash-blue', 900); // 宠物蛋：幽蓝光扫过
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
    if (row && enemy) row.textContent = `生命：${enemyStat(enemy.hp)} / ${enemyStat(enemy.maxHp)}`;
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
  function resetBattle(petName, petIcon, enemyName, enemyIcon, petMaxHp, enemyMaxHp) {
    const enemyFighter = document.getElementById('enemy-fighter');
    if (enemyFighter) enemyFighter.style.display = '';
    bindEnemyTip();
    renderEnemyTip(getBattleEnemy());
    mountIcon($('pet-icon'), petName, petIcon);
    $('pet-icon-name').textContent = petName;
    mountIcon($('enemy-icon'), enemyName, enemyIcon);
    $('enemy-icon-name').textContent = enemyName;
    $('enemy-hp-bar').style.width = '100%';
    $('pet-hp-bar').style.width = '100%';
    $('pet-hp-text').textContent = `${petMaxHp}/${petMaxHp}`;
    $('enemy-hp-text').textContent = `${enemyMaxHp}/${enemyMaxHp}`;
    updateEnemyTipHp(getBattleEnemy());
    // 行动条小头像同步本场图标（用头像版，小尺寸更清晰）
    mountIconAvatar($('at-racer-pet'), petName, petIcon);
    mountIconAvatar($('at-racer-enemy'), enemyName, enemyIcon);
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
  }
  function updateBars(petHp, petMaxHp, enemyHp, enemyMaxHp) {
    $('pet-hp-bar').style.width = Math.max(0, (petHp / petMaxHp) * 100) + '%';
    $('enemy-hp-bar').style.width = Math.max(0, (enemyHp / enemyMaxHp) * 100) + '%';
    $('pet-hp-text').textContent = `${Math.max(0, petHp)}/${petMaxHp}`;
    $('enemy-hp-text').textContent = `${Math.max(0, enemyHp)}/${enemyMaxHp}`;
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
  function animateAttack(attacker) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const foe = attacker === 'pet' ? $('enemy-icon') : $('pet-icon');
    if (!icon) { lastBackMs = 0; return 0; }
    const pace = paceOf(attacker);
    lastBackMs = Math.round(pace.back * 1000);
    const dashMs = setDashDistance(icon, foe, attacker, pace.speed);
    icon.style.setProperty('--dash-charge', (pace.charge / 1000).toFixed(3) + 's');
    icon.style.setProperty('--dash-back', pace.back.toFixed(3) + 's');
    /* 前摇（蓄力压扁）→ 扑击（冲到对方脸上）→ 后摇（收招回位）。
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
      icon.__attackT = setTimeout(() => icon.classList.remove('attacking'), dashMs + pace.back * 1000);
    }, pace.charge);
    // 逐帧动画立绘：有攻击帧则切换播一遍（无则维持现有 CSS 突进+刀光）
    const node = icon && icon.querySelector('.pet-anim');
    if (node && PetSprites && PetSprites.setAnim) {
      PetSprites.setAnim(node, 'attack');
      setTimeout(() => { if (node.isConnected) PetSprites.setAnim(node, 'idle'); }, 850);
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
    const label = FLOAT_LABEL[type] || '攻击';
    const sign = type === 'lifesteal' ? '+' : type === 'miss' ? '' : '-';
    el.textContent = type === 'miss' ? label : `${label}：${sign}${text}`;
    host.appendChild(el);
    setTimeout(() => {
      el.remove();
      floatActive.set(host, Math.max(0, (floatActive.get(host) || 1) - 1));
    }, 850);
  }
  // battle.js 结算时调用（伤害/暴击/吸血实际生效那一刻）→ 转飘字；业务计算零改动
  function showDamage(target, damage, type) {
    if (type === 'crit') flashStage('stage-shake', 300); // 暴击：舞台震屏
    showFloatingText(target, damage, type || 'normal', type === 'lifesteal' ? { side: 'right' } : null);
  }

  /* ---------- 挂机状态徽章（battle.js 调用） ---------- */
  const STATUS_TEXT = { idle: '空闲', fighting: '挂机中', stopped: '已停止', healing: '恢复中', recovering: '回血中' };
  function updateStatus(type, fightCount) {
    const badge = $('status-badge');
    badge.textContent = STATUS_TEXT[type] || type;
    badge.className = 'status-badge ' + type;
    $('fight-count').textContent = fightCount || 0;
  }

  /* ---------- 战斗按钮（main.js 调用，main 决定文案/可用性） ---------- */
  function renderBattleButton(label, disabled) {
    const btn = $('btn-battle');
    btn.textContent = label;
    btn.disabled = !!disabled;
  }
  function renderActiveSkill(skill, cooldown, queued) {
    const btn = $('btn-active-skill');
    if (!btn) return;
    btn.hidden = false; // 主动技能按钮始终显示；未解锁置灰占位（2026-09-03）
    if (!skill) {
      btn.disabled = true;
      btn.textContent = '主动技能 · 未解锁';
      return;
    }
    btn.disabled = cooldown > 0 || queued;
    btn.textContent = queued ? `${skill.name} · 待释放` : cooldown > 0 ? `${skill.name} · 冷却 ${cooldown}` : skill.name;
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
      text.textContent = `经验 ${current} / ${need}`;
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
    if (window.Battle && window.Battle.isRunning()) return; // 战斗中：立绘由 beginFight 快照维护
    if (window.IdleBridge && window.IdleBridge.isActive()) return; // 服务器托管挂机：敌方立绘由演出循环维护，不能藏（藏了 = 宠物打空气）
    mountIcon($('pet-icon'), pet.name, pet.icon);
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
      const iconHtml = avatarSrc ? '<img class="pet-avatar-sprite" src="' + avatarSrc + '" alt="">' : `<span>${pet.icon}</span>`;
      btn.innerHTML = `<span class="roster-pet-icon">${iconHtml}</span><span class="rp-lv">${pet.level}</span>`;
      btn.onclick = () => {
        if (pet.cloudId && window.Market && Market.isListed && Market.isListed(pet.cloudId)) {
          UI.showToast('⚠️ 已上架的宠物不能出战', '请先在市场取回');
          return;
        }
        setActive(pet.id);
        if (UI.addLog) UI.addLog(`🐾 ${pet.name} 出战！`);
        if (!(window.Battle && window.Battle.isRunning())) syncCombatantSnapshot();
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
            <strong>${escapeHtml(pet.icon)} ${escapeHtml(pet.name)}</strong>
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
          </div>`;
        const r = anchor.getBoundingClientRect();
        tipBox.style.left = (r.right + 8) + 'px';
        tipBox.style.top = Math.max(6, r.top) + 'px';
        tipBox.classList.add('show');
      };
      const hideTip = () => tipBox.classList.remove('show');
      box.addEventListener('mouseover', (e) => {
        const el = e.target.closest ? e.target.closest('.roster-pet') : null;
        if (!el) return;
        const pet = getPets().find(p => p.id === Number(el.dataset.id));
        if (pet) showTipFor(pet, el);
      });
      box.addEventListener('mouseout', (e) => {
        if (e.target.closest && e.target.closest('.roster-pet')) hideTip();
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

  /* ---------- 对外 API（战斗页） ---------- */
  UI.renderStats = renderStats;
  UI.showLoot = showLoot;
  UI.resetBattle = resetBattle;
  UI.updateBars = updateBars;
  UI.updateAction = updateAction;
  UI.animateAttack = animateAttack;
  UI.attackRecoverMs = attackRecoverMs;
  UI.animateHit = animateHit;
  UI.animateVictory = animateVictory;
  UI.showDamage = showDamage;
  UI.showFloatingText = showFloatingText;
  UI.updateStatus = updateStatus;
  UI.renderBattleButton = renderBattleButton;
  UI.renderActiveSkill = renderActiveSkill;
  UI.updateBattleArea = updateBattleArea;
  UI.renderCombatantData = renderCombatantData;
  UI.syncCombatantSnapshot = syncCombatantSnapshot;
  UI.renderRoster = renderRoster;
})();
