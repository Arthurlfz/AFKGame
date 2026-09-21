/* ============================================================
 * ui/ui-battle-tip.js —— 唯一职责：敌方怪物的悬浮提示（悬停立绘/名字 → 弹出数值浮层）。
 *
 * 从 `ui-battle.js` 迁出（2026-09-21，一个文件一个职责）：那边只保留调用时机
 * （`resetBattle` 里 bind + render、`updateBars` 里 updateHp）。
 *
 * 对外（window.BattleTip）：
 *   getEnemy()        取"画面上真正的这只怪"
 *   render(enemy)     渲染浮层内容（传 null 则隐藏）
 *   updateHp(enemy)   只更新浮层里的血量那一行（每帧刷血时用，不重建整块 HTML）
 *   position()        按立绘位置摆浮层（悬停与窗口 resize 都会调）
 *   bind()            绑悬停事件（幂等：靠 tip.dataset.bound 防重复绑）
 *
 * 依赖：`UI`（通用组件：$ / escapeHtml / groupNum，ui-common 先加载）；
 *      `Pet.expRange`（经验区间必须与实发同源，UI 不许另写一套公式）；
 *      `Battle.state.enemy` 或（托管挂机时）`IdleBridge.getShowEnemy()`。
 * ⚠️ 本模块【必需】加载：vtest_ui 会断言"悬浮框真的渲染出来"，缺了它测试与线上都是空白浮层。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $ } = UI;
  // 千分位来自 ui-battle.js 导出的 UI.groupNum（单一事实源）；⚠️ 用时取，避免依赖两个文件的加载顺序
  const fmtNum = (n) => (UI.groupNum ? UI.groupNum(n) : String(n));

  const ENEMY_TYPE = {
    normal: { label: '普通', className: 'normal' },
    evolved: { label: '进化', className: 'evolved' },
    mutant: { label: '变异', className: 'mutant' }
  };

  // 服务器托管挂机：本地 battle.js 从不开场（state.enemy 恒 null），
  // 画面上的怪由 idle-bridge 的演出循环持有 → 回退读它，
  // 否则敌方 tooltip / 名字 / 血量同步全是空的（或本地模式的残留怪）。
  function getEnemy() {
    if (window.IdleBridge && window.IdleBridge.isActive && window.IdleBridge.isActive()) {
      return (window.IdleBridge.getShowEnemy && window.IdleBridge.getShowEnemy()) || null;
    }
    return (window.Battle && window.Battle.state && window.Battle.state.enemy) || null;
  }

  function stat(value) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  }

  function render(enemy) {
    const tip = $('enemy-tip');
    if (!tip) return;
    if (!enemy) {
      tip.hidden = true;
      return;
    }
    const type = ENEMY_TYPE[enemy.enemyType] || ENEMY_TYPE.normal;
    const weights = enemy.rarityWeights || {};
    // 经验：显示 Pet.expRange 的区间，与实际发放（main.js 调 Pet.expFromBattle）同一个函数算出来
    // 经验预览与实发同源（Pet.expRange），UI 不许再自己写一套公式
    const er = window.Pet.expRange(enemy, window.Battle && window.Battle.getCurrentArea());
    const experience = er.min === er.max ? String(er.min) : `${er.min}~${er.max}`;
    // 战斗属性：显示完整（生命/攻击/防御/速度 + 暴击/暴伤/命中/闪避/吸血）
    const pct = (v) => Math.round((Number(v) || 0) * 100) + '%';
    const num = (v) => stat(v);
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

  function updateHp(enemy) {
    const row = $('enemy-tip') && $('enemy-tip').querySelector('[data-enemy-hp]');
    if (row && enemy) row.textContent = `生命：${fmtNum(stat(enemy.hp))} / ${fmtNum(stat(enemy.maxHp))}`;
  }

  function position() {
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

  function bind() {
    const icon = $('enemy-icon');
    const name = $('enemy-icon-name');
    const tip = $('enemy-tip');
    if (!icon || !name || !tip || tip.dataset.bound) return;
    tip.dataset.bound = '1';
    const show = () => {
      const enemy = getEnemy();
      if (!enemy) return;
      render(enemy);
      tip.hidden = false;
      position();
    };
    const hide = () => { tip.hidden = true; };
    icon.addEventListener('mouseenter', show);
    name.addEventListener('mouseenter', show);
    icon.addEventListener('mouseleave', hide);
    name.addEventListener('mouseleave', hide);
    window.addEventListener('resize', position);
  }

  window.BattleTip = { getEnemy, render, updateHp, position, bind };
})();
