/* ============================================================
 * tower/ui-tower-battle.js —— 通天塔·整页战斗驱动（单一职责）
 * 职责：
 *  1. startTowerBattle：详情页「进入」→ 切整页战斗页 → TowerEngine.start → 结算面板
 *  2. 战斗页塔专属表现：顶部信息条（#battle-area-info）+ 横向 30 格层阶刻度条
 *     + 逐层掉落日志（金色高亮）
 * 不负责：层推进与掉落（tower-engine/rewards）、详情页（ui-tower-entry）、结算面板（ui-tower-settle）。
 * 依赖：tower-engine、ui-shell（switchPage）、ui-battle（resetBattle/updateBars/renderCombatantData）、
 *       ui-common（addLog/consoleLog/showToast）。
 * 设计约束（game-ui-design）：
 *  - 战斗画面零新渲染循环：立绘/血条/行动条/飘字/震屏全部复用现有通道；
 *  - 刻度条只在塔模式出现，退出塔必须隐藏（不得残留）；
 *  - 掉落用金色 + 「掉落」文字前缀双编码（不只靠颜色）；动效 ≤300ms。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = v => UI.escapeHtml ? UI.escapeHtml(String(v || '')) : String(v || '');
  const cfg = () => (window.Config && window.Config.tower) || {};

  /* ---------- 横向 30 格层阶刻度条（塔专属，懒创建） ---------- */
  function ensureLadder() {
    let el = $('tw-ladder');
    if (el) return el;
    const arena = document.querySelector('#tab-battle .bp-arena');
    const topbar = document.querySelector('#tab-battle .bp-topbar');
    if (!arena) return null;
    el = document.createElement('div');
    el.id = 'tw-ladder';
    el.className = 'tw-ladder';
    el.hidden = true;
    if (topbar && topbar.parentNode === arena && topbar.nextSibling) arena.insertBefore(el, topbar.nextSibling);
    else arena.insertBefore(el, arena.firstChild);
    return el;
  }
  function hideLadder() {
    const el = $('tw-ladder');
    if (el) el.hidden = true;
  }
  /* 战斗页标题/提示是野图口径（"野外探险"）——进塔时换塔口径，退出时还原。
   * 这是「塔模式不得污染野图」的一部分：不还原的话打完塔回野图还写着"通天塔"。 */
  const WILD_TITLE = '野外探险';
  const WILD_HINT = '选好地图即自动挂机打怪';
  function setBattleHead(mode) {
    const title = document.querySelector('#tab-battle .bp-title');
    const hint = document.querySelector('#tab-battle .bp-hint');
    if (title) title.textContent = mode === 'tower' ? (cfg().name || '通天塔') : WILD_TITLE;
    if (hint) hint.textContent = mode === 'tower' ? '每 5 层换一名守卫 · 血量跨层累计' : WILD_HINT;
  }
  function renderLadder(floor, total, cleared) {
    const el = ensureLadder();
    if (!el) return;
    const tierFloors = (cfg().floorTiers || []).map(t => Number(t.floor) || 0);
    const cells = [];
    for (let f = 1; f <= total; f++) {
      const isTier = tierFloors.indexOf(f) >= 0;
      const past = f < floor || (cleared && f <= floor);
      const now = (f === floor && !cleared);
      cells.push(`<span class="tw-ladder-cell${isTier ? ' is-tier' : ''}${past ? ' is-past' : ''}${now ? ' is-now' : ''}" title="第 ${f} 层${isTier ? '（档位）' : ''}">${isTier ? f : ''}</span>`);
    }
    el.innerHTML = `<span class="tw-ladder-h">层阶</span><span class="tw-ladder-track">${cells.join('')}</span>`;
    el.hidden = false;
  }
  function resetBattleInfo() {
    // 退出塔后把顶部信息条交还给野图口径（下一次 updateBattleArea 会覆盖，这里只是兜底清塔文案）
    const box = $('battle-area-info');
    if (box && /通天塔/.test(box.innerHTML || '')) box.innerHTML = '';
  }
  // 退出塔视图：刻度条隐藏 + 标题还原 + 顶部信息条清塔文案（三个出口共用，避免漏一处留残影）
  function exitTowerView() {
    hideLadder();
    setBattleHead('wild');
    resetBattleInfo();
  }
  UI.exitTowerView = exitTowerView;

  /* ---------- 顶部信息条（塔口径） ---------- */
  UI.updateTowerFloor = function (info) {
    setBattleHead('tower');
    const box = $('battle-area-info');
    const total = Number(info && info.total) || Number(cfg().floors) || 30;
    const corrosion = Number(info && info.corrosion) || 0;
    const per = Number(info && info.mobsPerFloor) || Number(cfg().mobsPerFloor) || 5;
    const mob = Number(info && info.mob) || 1;
    if (box) {
      box.innerHTML = `通天塔 · 第 <b>${esc(info && info.floor)}</b>/${esc(total)} 层 · 第 <b>${esc(mob)}</b>/${esc(per)} 只 `
        + `${info && info.isGuardian ? '<b class="tw-warn">守卫</b> ' : '杂兵 '}`
        + `<b style="color:#ffcf6b">${esc(info && info.enemy && info.enemy.name)}</b> Lv.${esc(info && info.enemy && info.enemy.level)}`
        + (corrosion > 0 ? ` · 腐蚀度 <b class="tw-warn">${esc(corrosion)}</b>` : ' · 白图');
    }
    const stage = document.querySelector('#tab-battle .battle-stage');
    if (stage && typeof stage.setAttribute === 'function') {
      const floor = Number(info && info.floor) || 1;
      let towerBg;
      if (floor <= 5) towerBg = 'tower-base';
      else if (floor <= 15) towerBg = 'tower-cloud';
      else if (floor <= 25) towerBg = 'tower-storm';
      else towerBg = 'tower-cosmos';
      stage.setAttribute('data-area-id', towerBg);
      const h = stage.offsetHeight || 0;
      if (stage.style && stage.style.setProperty) stage.style.setProperty('--bg-w', (h * (1376 / 768)) + 'px');
      if (stage.classList && !stage.classList.contains('stage-scroll')) stage.classList.add('stage-scroll');
    }
  };

  /* ---------- 掉落日志：金色 + 文字前缀（双编码，不只靠颜色） ---------- */
  function logLootLoot(text) {
    if (UI.consoleLog) UI.consoleLog('system', `<span class="tw-loot">🎁 ${esc(text)}</span>`);
    else if (UI.addLog) UI.addLog('🎁 ' + text);
  }
  function logEpic(text) {
    if (UI.consoleLog) UI.consoleLog('system', `<span class="tw-epic">${esc(text)}</span>`);
    else if (UI.addLog) UI.addLog(text);
  }

  /* ---------- 引擎事件 → 战斗页表现 ---------- */
  UI.onTowerEvent = function (event) {
    if (!event) return;
    try {
      if (event.type === 'start') {
        const total = Number(event.total) || Number(cfg().floors) || 30;
        const per = Number(event.mobsPerFloor) || Number(cfg().mobsPerFloor) || 5;
        if (event.corrosion > 0) logEpic(`🔥 贴入腐印：腐蚀度 ${event.corrosion}（怪物更强、掉落更多）`);
        renderLadder(0, total, false);
        logEpic(`🕯 每层 ${per} 只怪 · 整局只吃一管血（层间与楼内都不回满）`);
      } else if (event.type === 'floor') {
        UI.updateTowerFloor(event);
        if (UI.renderCombatantData) UI.renderCombatantData();
      } else if (event.type === 'log') {
        if (UI.addLog) UI.addLog(event.text);
      } else if (event.type === 'loot') {
        const l = event.loot || {};
        if (l.kind === 'material') logLootLoot(`${l.name} ×${l.qty}`);
        else if (l.kind === 'equipment' && l.eq) logLootLoot(`装备：${(l.eq.rarity && l.eq.rarity.label) || ''}${l.eq.slot || ''}（未鉴定）`);
      } else if (event.type === 'floorClear') {
        const total = Number(cfg().floors) || 30;
        renderLadder(Number(event.floor) || 0, total, false);
      } else if (event.type === 'floorFail') {
        if (UI.addLog) UI.addLog('💀 守卫拦住了去路……');
      } else if (event.type === 'clear') {
        logEpic(`🏆 通天塔 ${event.total} 层全部通过！`);
      } else if (event.type === 'settle') {
        exitTowerView();
        if (UI.showTowerSettle) UI.showTowerSettle(event.result);
        else if (UI.backToTowerEntry) UI.backToTowerEntry();
      }
    } catch (e) {
      /* 表现层异常绝不中断引擎推进，但**必须留痕** —— 以前这里静默吞掉，
       * 导致浏览器实测「结算面板没弹」时控制台一句报错都没有，只能靠猜（2026-09-10）。 */
      try { console.warn('[tower] 表现层异常（引擎继续跑）:', e && (e.stack || e.message)); } catch (e2) { /* ignore */ }
    }
  };

  /* ---------- 主流程：进塔 = 切整页战斗页 + 引擎逐层推进 ----------
   * 资格（免费次数/重置卡）、腐印校验与消耗、层推进、野图挂机暂停/恢复
   * 全在 core 层（tower-access/engine）保证，UI 只做导航与表现。 */
  async function startTowerBattle(affixIds, opts) {
    const E = window.TowerEngine;
    opts = opts || {};
    if (!E) { if (UI.showToast) UI.showToast('通天塔未就绪', '塔模块未加载'); return; }
    const detail = $('tower-detail');
    if (detail) detail.hidden = true;
    if (UI.switchPage) UI.switchPage('battle');
    try {
      const res = await E.start(affixIds || [], {});
      if (!res || res.ok === false) {
        if (UI.showToast) UI.showToast('无法进入通天塔', (res && res.error) || '未知原因');
        exitTowerView();
        // 详情页在世界地图页里 → 必须先切回地图页，否则它和结算面板一样被 display:none 藏起来
        if (UI.switchPage) UI.switchPage('worldmap');
        if (UI.showTowerDetail) UI.showTowerDetail(); // 回详情页让玩家改腐印/看资格
        return;
      }
      // 正常路径：引擎 emit settle 时已弹结算面板（UI.onTowerEvent）
    } catch (e) {
      if (UI.showToast) UI.showToast('通天塔异常', (e && e.message) || '未知错误');
      exitTowerView();
      if (UI.switchPage) UI.switchPage('worldmap');  // 同上：详情页在地图页里
      if (UI.showTowerDetail) UI.showTowerDetail();
    }
  }

  UI.startTowerBattle = startTowerBattle;
  UI.hideTowerLadder = hideLadder;
})();
