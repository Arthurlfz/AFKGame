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
  // 已迁出的模块一律**用时取**（不能在这里存成 const）：测试 harness 的清单里它们可能排在 ui-battle.js 之后。
  //   BattleTip   → js/ui/battle/tip.js（敌方悬浮提示）
  //   StageFx     → js/ui/battle/stage-fx.js（横幅 / 舞台闪光 / 屏幕脉冲）
  //   （掉落演出整体在 js/ui/battle/loot.js，它自己往 UI 上挂 showLoot / lootTierOf）
  const BattleTip = () => window.BattleTip;
  const StageFx = () => window.StageFx;

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

  /* ---------- 掉落播报 + 掉落演出 → 已整体迁出到 `js/ui/battle/loot.js`（2026-09-21） ----------
   * 那边自己往 UI 上挂 `showLoot` / `lootTierOf`，调用方（main.js / 世界地图掉落预览）不用改；
   * 舞台横幅等原语在 `js/ui/battle/stage-fx.js`。本文件不再管掉落，改它请去那两个文件。 */

  /* 掉落起点 / 飞入演出：已迁出 → `js/ui/battle/loot.js`（`rectOf` / `lootOrigin` / `flyToBag`，2026-09-21） */
  /* 舞台横幅：已迁出 → `js/ui/battle/stage-fx.js` 的 `StageFx().banner(...)`（2026-09-21） */
  /* 材料配色 / 掉落播报：已迁出 → `js/ui/battle/loot.js`（2026-09-21） */
  /* showLoot（掉落播报 + 演出）已迁出 → `js/ui/battle/loot.js`（2026-09-21） */


  /* ---------- 敌方怪物悬浮提示 → 已迁出到 `js/ui/battle/tip.js`（2026-09-21） ----------
   * 内容渲染 / 定位 / 悬停绑定都在那个模块（`window.BattleTip`）；本文件只负责"什么时候刷"：
   * resetBattle 里 bind + render，updateBars 里 updateHp。改浮层内容请去那个文件。 */

  /* ---------- 战斗视觉（battle.js 调用） ---------- */
  function resetBattle(petName, enemyName, petMaxHp, enemyMaxHp) {
    const enemyFighter = document.getElementById('enemy-fighter');
    if (enemyFighter) enemyFighter.style.display = '';
    BattleTip().bind();
    BattleTip().render(BattleTip().getEnemy());
    mountIcon($('pet-icon'), petName);
    $('pet-icon-name').textContent = petName;
    mountIcon($('enemy-icon'), enemyName);
    $('enemy-icon-name').textContent = enemyName;
    $('enemy-hp-bar').style.width = '100%';
    $('pet-hp-bar').style.width = '100%';
    $('pet-hp-text').textContent = `${groupNum(petMaxHp)}/${groupNum(petMaxHp)}`;
    $('enemy-hp-text').textContent = `${groupNum(enemyMaxHp)}/${groupNum(enemyMaxHp)}`;
    BattleTip().updateHp(BattleTip().getEnemy());
    // 行动条小头像同步本场图标（用头像版，小尺寸更清晰）
    mountIconAvatar($('at-racer-pet'), petName);
    mountIconAvatar($('at-racer-enemy'), enemyName);
    // 敌人差异化表现：变异怪挂 is-mutant（名字血红+体型大）；上一场的击败淡出还原
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (stage && stage.querySelector) {
      const enemyBox = stage.querySelector('.fighter-enemy');
      if (enemyBox && enemyBox.classList) {
        const enemy = BattleTip().getEnemy();
        enemyBox.classList.toggle('is-mutant', !!(enemy && enemy.enemyType === 'mutant'));
        const avatar = enemyBox.querySelector('.stage-avatar');
        if (avatar && avatar.classList) avatar.classList.remove('defeated');
      }
    }
    updateAction(0, 0);
    /* Boss 出场：名字带「霸主·」前缀（服务端与本地都是这个口径，比 isBoss 字段更可靠）。
     * Boss 是稀有事件（1/1600，保底 2400 场），玩家可能几百场才见一次，不能悄无声息地出现。 */
    if (enemyName && String(enemyName).indexOf('霸主·') === 0) {
      StageFx().banner('boss-banner', [
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
    const enemy = BattleTip().getEnemy();
    if (enemy) enemy.hp = Math.max(0, enemyHp);
    BattleTip().updateHp(enemy);
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
  // 舞台高光 / 屏幕脉冲：已迁出 → `js/ui/battle/stage-fx.js`（`StageFx().flash` / `StageFx().goldPulse`，2026-09-21）
  /* 冲到对方脸前所需的水平位移：量两个立绘的实际间距，冲掉 78%（留一点间隙，别糊在对方脸上）。
   * 视觉方向：我方在左向右冲（正值），敌方在右向左冲（负值）。
   * ⚠️ 位移量必须这么量：舞台是响应式布局，两个立绘的间距随视口宽度变，写死数值必然对不上。 */
  /* 冲刺速度恒定（px/秒）：舞台越宽、两只宠离得越远，冲刺时间自动变长，
   * 而不是距离翻倍速度也翻倍——后者在宽屏上等于瞬移，晃眼。
   * 1700~2000 是"看得出在冲、又不刺眼"的区间，调快调慢改这一个数。 */
  /* ---------- 出手与命中演出（节奏 / 冲刺 / 受击形变 / 飘字 / 命中特效触发）----------
   * 已整体迁出 → `js/ui/battle/act.js`（2026-09-21，一个文件一个职责）。
   * 那边自己往 UI 上挂 `animateAttack` / `attackRecoverMs` / `animateHit` / `showDamage` / `showFloatingText`，
   * 调用方（battle.js / idle-bridge.js）不用改。守值盯着那几个时序契约，改东前先读那边的注释。 */




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
      /* 🟠11「主动技能没说明」：只写"未解锁"玩家还是不知道自己将来能得到什么、往哪练。
       * 现在把**这只宠将来会学的技能**写进悬停（查询走 PetUI 那份，不在这儿另抄）。 */
      const act = (window.Pet && window.Pet.getActivePet) ? window.Pet.getActivePet() : null;
      const UI2 = window.PetUI;
      const future = (act && UI2 && UI2.finalSkillOf) ? UI2.finalSkillOf(act.name) : null;
      btn.title = (future && UI2 && UI2.skillEffectLine)
        ? `终形态 Lv.60 解锁：${future.name}（${UI2.skillEffectLine(future)} · ${future.cooldownTurns} 回合冷却）`
        : '终形态 Lv.60 解锁主动技能';
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
  /* 出战宠物竖列（头像 + 悬停详情 + 快捷入口）：已迁出 → `js/ui/battle/roster.js`（2026-09-21） */

  // 胜利演出：敌人立绘淡出下沉（battle.js endFight 胜利时防御式调用）
  function animateVictory() {
    const avatar = document.querySelector('#tab-battle .fighter-enemy .stage-avatar');
    if (!avatar || !avatar.classList) return;
    avatar.classList.add('defeated');
    setTimeout(() => avatar.classList.remove('defeated'), 650);
  }

  /* 挂机结算汇总弹窗：已迁出 → `js/ui/battle/summary.js`（`UI.showIdleSummary`，2026-09-21） */

  /* ---------- 对外 API（战斗页） ---------- */
  UI.renderStats = renderStats;
  // 千分位格式化对外：ui-battle-tip.js 复用同一份（不另写一套，避免两个事实源）
  UI.groupNum = groupNum;
  // UI.showLoot / UI.lootTierOf / UI.showIdleSummary / UI.renderRoster 由各自模块自己挂
  //   （ui-battle-loot.js / ui-battle-summary.js / ui-battle-roster.js，2026-09-21）
  UI.resetBattle = resetBattle;
  UI.updateBars = updateBars;
  UI.updateAction = updateAction;
  // UI.animateAttack / UI.attackRecoverMs / UI.animateHit 由 js/ui/battle/act.js 自己挂（2026-09-21）
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
    StageFx().banner('levelup-banner', [
      { c: 'lu-k', t: 'LEVEL UP' },
      { c: 'lu-n', t: newLevel ? ('Lv.' + newLevel) : '' }
    ], 1900);
  }
  // UI.showDamage / UI.showFloatingText 由 js/ui/battle/act.js 自己挂（2026-09-21）
  UI.showLevelUp = showLevelUp;
  UI.updateStatus = updateStatus;
  UI.renderBattleButton = renderBattleButton;
  UI.renderActiveSkill = renderActiveSkill;
  UI.updateBattleArea = updateBattleArea;
  UI.renderCombatantData = renderCombatantData;
  UI.syncCombatantSnapshot = syncCombatantSnapshot;
  // UI.renderRoster 由 js/ui/battle/roster.js 自己挂（2026-09-21）
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

