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
  // 图标挂载：有立绘图则塞 <img>，否则回退 emoji。返回 true=已用立绘 / false=回退 emoji。
  function mountIcon(el, name, fallbackEmoji) {
    if (!el) return false;
    if (PetSprites && PetSprites.mount(el, pureName(name))) return true;
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

  /* 二级跳转：未选图自动弹出浮层；已选图只显示顶部地图条，点「换图」再打开浮层 */
  function setMapOverlay(show) {
    const ov = $('map-select-overlay');
    if (!ov || !ov.classList) return;
    if (typeof ov.classList.toggle === 'function') ov.classList.toggle('show', !!show);
    else ov.classList[show ? 'add' : 'remove']('show');
  }
  function updateBattleArea(area) {
    const box = $('battle-area-info');
    if (!box) return;
    box.innerHTML = area
      ? `当前地图：<b style="color:#ffcf6b">${escapeHtml(area.name)}</b> · 建议等级 ${escapeHtml(area.recommended)}`
      : '🐣 先选一张地图，即可自动挂机打怪、掉装备和宠物蛋';
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
  function renderAreaSelector() {
    const box = $('battle-area-selector');
    const Battle = window.Battle;
    if (!box || !Battle) return;
    const selected = Battle.getCurrentArea();
    box.innerHTML = Battle.getAreas().map(area => `
      <button class="area-card${selected?.id === area.id ? ' is-selected' : ''}" data-area-id="${escapeHtml(area.id)}">
        <b>${escapeHtml(area.name)}</b><span>建议等级：${escapeHtml(area.recommended)}</span>
      </button>`).join('');
    box.querySelectorAll('[data-area-id]').forEach(button => {
      button.addEventListener('click', () => {
        if (!Battle.selectArea(button.dataset.areaId)) return;
        renderAreaSelector();
        updateBattleArea(Battle.getCurrentArea());
        setMapOverlay(false); // 选完收起浮层，回到战斗画面
      });
    });
    // 首次进入且未选图 → 自动弹出浮层引导选图
    if (!selected) setMapOverlay(true);
  }
  /* 换图 / 关闭浮层按钮绑定（只绑一次；用元素自身标记避免依赖 dataset） */
  (function bindMapOverlay() {
    const openBtn = $('btn-change-map');
    const closeBtn = $('map-select-close');
    const ov = $('map-select-overlay');
    if (openBtn && !openBtn.__mapBound) {
      openBtn.__mapBound = true;
      openBtn.addEventListener('click', () => setMapOverlay(true));
    }
    if (closeBtn && !closeBtn.__mapBound) {
      closeBtn.__mapBound = true;
      closeBtn.addEventListener('click', () => setMapOverlay(false));
    }
    if (ov && !ov.__mapBound) {
      ov.__mapBound = true;
      ov.addEventListener('click', e => { if (e.target === ov) setMapOverlay(false); });
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
    // 【去除所有左下角 toast 与屏幕中间弹窗】—— 只保留掉落日志记录。
    // 说明：showToast / UI.showDialog 为通用组件函数，本体保留（勿删，删了会报错）；
    //       这里仅注释调用点。掉落仍然写进 #loot-list（掉落日志面板），游戏逻辑零改动。
    if (reward.phoenix) {
      addLootEntry(`${Config.drop.phoenixName} ×1（融合材料）`, 'mat');
      // showToast('掉落材料', `${Config.drop.phoenixName} ×1`);
    }
    if (reward.reforgeStone) {
      addLootEntry(`${Config.craft.reforge.name} ×1（重铸全部词缀）`, 'mat');
    }
    if (reward.stripStone) {
      addLootEntry(`${Config.craft.strip.name} ×1（移除一条词缀）`, 'mat');
    }
    if (reward.holyStone) {
      addLootEntry(`${Config.craft.holy.name} ×1（重 Roll 词缀数值）`, 'mat');
      // showToast('掉落神圣石', `${Config.craft.holy.name} ×1`);
    }
    if (reward.augmentStone) {
      addLootEntry(`${Config.craft.augment.name} ×1（新增词缀）`, 'mat');
      // showToast('掉落增缀石', `${Config.craft.augment.name} ×1`);
    }
    if (reward.evoMaterials && reward.evoMaterials.length) {
      for (const m of reward.evoMaterials) addLootEntry(`${m} ×1（进化素材）`, 'mat');
    }
    if (reward.areaMaterial) {
      addLootEntry(`${reward.areaMaterial} ×1（本图专属材料）`, 'mat');
    }
    if (reward.type === 'none') return; // 无主掉落：材料提示已加，直接返回
    if (reward.type === 'equipment') {
      const r = reward.eq.rarity;
      addLootEntry(`<span class="loot-q ${r.id === 'gold' ? 'fs-q--gold' : r.id === 'blue' ? 'fs-q--blue' : 'fs-q--white'}">${r.label}·${escapeHtml(reward.eq.name)}</span>`, r.id);
      if (r.id === 'gold') flashStage('loot-flash-gold', 900); // 金装：全屏金光扫过
    } else if (reward.type === 'egg') {
      addLootEntry('宠物蛋 ×1（去「宠物」页或「装备」页背包孵化）');
      flashStage('loot-flash-blue', 900); // 宠物蛋：幽蓝光扫过
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
    const experience = Math.round((enemy.level * 5 + enemy.maxHp * 0.1) * enemy._diff);
    tip.innerHTML = `
      <div class="enemy-tip-title"><strong>${escapeHtml(enemy.name || '未知怪物')}</strong><span>Lv.${enemyStat(enemy.level)}</span><b class="enemy-type ${type.className}">${type.label}</b></div>
      <div class="enemy-tip-group"><div class="enemy-tip-heading">基础属性</div>
        <div class="enemy-tip-row" data-enemy-hp>生命：${enemyStat(enemy.hp)} / ${enemyStat(enemy.maxHp)}</div>
        <div class="enemy-tip-row">攻击：${enemyStat(enemy.atk)}</div>
        <div class="enemy-tip-row">防御：${enemyStat(enemy.def)}</div>
        <div class="enemy-tip-row">速度：${enemyStat(enemy.spd)}</div>
      </div>
      <div class="enemy-tip-group enemy-tip-drop"><div class="enemy-tip-heading">掉落信息</div>
        <div class="enemy-tip-row">怪物类型：${type.label}</div>
        <div class="enemy-tip-row">地图难度：×${Number(enemy._diff || 0).toFixed(2)}</div>
        <div class="enemy-tip-row">掉落品质：<span class="rarity-white">白 ${Number(weights.white || 0)}%</span> · <span class="rarity-blue">蓝 ${Number(weights.blue || 0)}%</span> · <span class="rarity-gold">金 ${Number(weights.gold || 0)}%</span></div>
        <div class="enemy-tip-row">经验：+${enemyStat(experience)}</div>
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
    const box = icon.closest('.stage-enemy');
    if (!box) return;
    tip.classList.toggle('enemy-tip-left', icon.getBoundingClientRect().right + tip.offsetWidth > window.innerWidth - 8);
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
  function animateAttack(attacker) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    // 舞台上下布局：宠物在上（向下扑）、怪物在下（向上扑）
    icon.style.setProperty('--lunge-dir', attacker === 'pet' ? '26px' : '-26px');
    icon.classList.add('attacking');
    setTimeout(() => icon.classList.remove('attacking'), 300);
  }
  function animateHit(target) {
    const icon = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    icon.classList.add('hit');
    setTimeout(() => icon.classList.remove('hit'), 300);
  }
  // 战斗飘字：在目标头像上方弹带类型标签的数字（攻击：-X / 暴击：-X / 吸血：+X）
  // 普通白 / 暴击亮红大20% / 吸血暗绿侧边；同一目标同时最多 3 个，超出延迟 120ms 排队；
  // 淡入 → 上飘 → 淡出 0.8s 后自动移除。只做表现，不参与任何战斗计算。
  const floatActive = new WeakMap();
  const FLOAT_LABEL = { normal: '攻击', crit: '暴击', lifesteal: '吸血', miss: '闪避' };
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

  /* ---------- 对战区同步（登录/刷新后调用，修复"未开战一直显示写死的莱姆"） ----------
   * 游戏.html 里对战区图标/名字是静态初始值（🟢 莱姆），只在 beginFight→resetBattle 时更新。
   * 刷新页面后即使出战宠物已还原成别的宠物，未开战前对战区仍显示旧静态值。
   * 此函数在 renderAll 里调用：未开战时把对战区同步成当前出战宠物；战斗中不覆盖（由 resetBattle 维护本场快照）。
   */
  function updateBattleExp(pet) {
    const text = $('pet-exp-text');
    const percent = $('pet-exp-percent');
    const fill = $('pet-exp-fill');
    if (!text || !percent || !fill) return;
    const need = Math.max(1, window.Pet.expNeed(pet.level));
    const current = Math.min(Math.max(0, pet.exp || 0), need);
    const progress = Math.round(current / need * 100);
    text.textContent = `经验 ${current} / ${need}`;
    percent.textContent = `${progress}%`;
    fill.style.width = `${progress}%`;
  }

  function syncCombatant() {
    const pet = getActivePet();
    if (!pet) return;
    const Battle = window.Battle;
    if (Battle && Battle.isRunning()) return; // 战斗中：本场宠物由 beginFight 快照维护，不覆盖
    updateBattleExp(pet);
    mountIcon($('pet-icon'), pet.name, pet.icon);
    $('pet-icon-name').textContent = pet.name;
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
        if (!(window.Battle && window.Battle.isRunning())) syncCombatant();
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
        tipBox.innerHTML = `<div class="rt-name">${pet.icon} ${escapeHtml(pet.name)}</div>
          <div class="rt-row"><span>等级</span><span>Lv.${pet.level}</span></div>
          <div class="rt-row"><span>成长</span><span>${pet.growth.toFixed(1)}</span></div>
          <div class="rt-row"><span>生命</span><span>${s.hp}</span></div>
          <div class="rt-row"><span>攻击</span><span>${s.atk}</span></div>
          <div class="rt-row"><span>防御</span><span>${s.def}</span></div>
          <div class="rt-row"><span>速度</span><span>${s.spd}</span></div>
          <div class="rt-row"><span>暴击</span><span>${Math.round(s.critRate * 100)}%</span></div>
          <div class="rt-row"><span>暴伤</span><span>${Math.round(s.critDamage * 100)}%</span></div>
          <div class="rt-row"><span>命中</span><span>${Math.round(s.hit * 100)}%</span></div>
          <div class="rt-row"><span>闪避</span><span>${Math.round(s.dodge * 100)}%</span></div>
          <div class="rt-row"><span>吸血</span><span>${Math.round(s.lifesteal * 100)}%</span></div>
          <div class="rt-row"><span>装备</span><span>${equipCount}/3${bonusText && bonusText !== '无' ? '（' + bonusText + '）' : ''}</span></div>
          ${active && pet.id === active.id ? '<div class="rt-row"><span style="color:var(--accent-hi)">当前出战</span></div>' : ''}`;
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
  UI.animateHit = animateHit;
  UI.animateVictory = animateVictory;
  UI.showDamage = showDamage;
  UI.showFloatingText = showFloatingText;
  UI.updateStatus = updateStatus;
  UI.renderBattleButton = renderBattleButton;
  UI.updateBattleArea = updateBattleArea;
  UI.renderAreaSelector = renderAreaSelector;
  UI.syncCombatant = syncCombatant;
  UI.renderRoster = renderRoster;
})();
