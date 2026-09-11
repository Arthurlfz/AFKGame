/* ============================================================
 * tower/ui-tower-settle.js —— 通天塔结算面板（单一职责）
 * 职责：
 *  1. 结算面板（容器 #tower-settle，**挂在 body 层**，复用 .trial-settle/.ts-* 外壳）
 *  2. 信息分层（2026-09-10 重构，用户要求「这个页面重新重构一下」）：
 *       ① 大结果：到达层数（主视觉，最大字号）
 *       ② 本次收获：装备单列（稀有度色 + 部位/T阶 + 未鉴定）/ 腐印 / 高级材料 / 保底碎屑（淡色收尾）
 *       ③ 诊断：事实 + 一条可操作建议
 *       ④ 称号 + 一行小字（消耗 / 今日免费 / 历史最高）
 *       ⑤ 按钮
 *  3. 诊断区：死在第几层、剩多少血、建议摘哪条腐印（缓释「失败要买重置卡」的关键）
 * 不负责：层推进（tower-engine）、详情页（ui-tower-entry）、战斗页表现（ui-tower-battle）。
 * 依赖：tower-access（资格与记录）、tower-preview（重算预估）、tower-affix、ui-common。
 *
 * 设计约束（game-ui-design）：正文 ≥ --fs-xs(14px)；品质不只靠颜色（同时写"金装/蓝装/未鉴定"）；
 *   动效 ≤300ms；信息按重要性递减排列（Progressive disclosure：碎屑压到最底部淡色一行）。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = v => UI.escapeHtml ? UI.escapeHtml(String(v || '')) : String(v || '');
  const cfg = () => (window.Config && window.Config.tower) || {};

  // 高级材料（塔的招牌产出）：结算里按「高级 / 碎屑」两档分开展示
  const HIGH_MATS = ['神圣石', '越龙之石', '天仙玉露', '强化丹B', '锁魂玉', '琼浆玉露'];
  const isAffixName = n => /^腐印/.test(String(n || ''));

  /* ---------- 诊断：事实 + 一条可操作建议 ---------- */
  function diagnose(result) {
    const total = Number(result.floors) || Number(cfg().floors) || 30;
    const maxFloor = Number(result.maxFloor) || 0;
    const ids = Array.isArray(result.affixIds) ? result.affixIds : [];
    const endHp = (result.endHpPct == null) ? null : Number(result.endHpPct);
    const killed = (result.layerLoot || []).length;
    const facts = [], tips = [];

    if (result.cleared) {
      facts.push(`打满 ${total} 层，通关时剩余血量 <b>${endHp == null ? '—' : endHp + '%'}</b>`);
      if (endHp != null && endHp < 20) tips.push('极限通关：再加腐印大概率翻车，想追掉率建议先补装备');
    } else {
      facts.push(`倒在第 <b>${maxFloor + 1}</b> 层（抵达 ${maxFloor}/${total} 层${endHp != null ? `，结束时血量 ${endHp}%` : ''}）`);
      facts.push(`这一局清掉 <b>${killed}</b> 只怪`);
      if (!ids.length) {
        tips.push('本局是白图（0 腐印）止步 —— 说明硬实力还没到：先涅槃提成长、或把 12 件装备词缀刷好再回来');
      } else if (window.TowerAffix && window.TowerPreview) {
        // 「摘掉腐蚀度最高那条能到几层」——用预估器真算一次（结果有缓存）
        const items = ids.map(id => window.TowerAffix.itemOf(id)).filter(Boolean);
        if (items.length) {
          const corr = it => window.TowerAffix.corrosionOf(it);
          const worst = items.slice().sort((a, b) => corr(b) - corr(a))[0];
          const e = window.TowerPreview.estimate(window.TowerAffix.combine(ids.filter(id => id !== worst.id)), { runs: 3 });
          tips.push(e && e.ok
            ? `想爬更高：先摘掉腐蚀度最高的「<b>${esc(worst.name)}</b>」（腐 ${esc(corr(worst))}）→ 预估可达第 <b>${e.medianFloor}</b> 层`
            : `想爬更高：先摘掉腐蚀度最高的「<b>${esc(worst.name)}</b>」再打一次`);
        }
      }
    }
    return { facts, tips };
  }

  /* ---------- 收获分组：装备 / 腐印 / 高级材料 / 保底碎屑 ---------- */
  function splitLoot(result) {
    const gear = (result.gear || []).concat(result.layerGear || []);
    const sum = {};
    (result.layerMats || []).forEach(m => { sum[m.name] = (sum[m.name] || 0) + (Number(m.qty) || 0); });
    (result.items || []).forEach(m => { sum[m.name] = (sum[m.name] || 0) + (Number(m.qty) || 0); });
    const affix = [], high = [], junk = [];
    Object.keys(sum).forEach(n => {
      const row = { name: n, qty: sum[n] };
      if (isAffixName(n)) affix.push(row);
      else if (HIGH_MATS.indexOf(n) >= 0) high.push(row);
      else junk.push(row);
    });
    const byQty = (a, b) => b.qty - a.qty;
    return { gear, affix: affix.sort(byQty), high: high.sort(byQty), junk: junk.sort(byQty) };
  }

  function gearRow(eq) {
    if (!eq) return '';
    const rar = eq.rarity || {};
    const col = rar.color || 'var(--text-dim)';
    const label = rar.label || '白';
    const tier = (eq.materialTier != null) ? eq.materialTier : (eq.tier != null ? eq.tier : '—');
    return `<div class="tw-s-gear" style="border-left-color:${esc(col)}">
      <span class="nm" style="color:${esc(col)}">${esc(eq.name || eq.slot || '装备')}</span>
      <span class="mt">${esc(eq.slot || '')} · ${esc(label)}装 · 底材T${esc(tier)}</span>
      <span class="unid">未鉴定</span>
    </div>`;
  }
  const chip = (m, cls) => `<span class="ts-item${cls ? ' ' + cls : ''}">${esc(m.name)} ×${esc(m.qty)}</span>`;

  function showSettle(result) {
    const wrap = $('tower-settle');
    const card = $('tower-settle-card');
    if (!wrap || !card) { // 容器缺失（老页面结构）兜底：回详情页
      if (UI.showTowerDetail) UI.showTowerDetail();
      return;
    }
    result = result || {};
    const total = Number(result.floors) || Number(cfg().floors) || 30;
    const cleared = !!result.cleared;
    const maxFloor = Number(result.maxFloor) || 0;
    const corrosion = Number(result.corrosion != null ? result.corrosion : result.hot) || 0;
    const per = Number(result.mobsPerFloor) || Number(cfg().mobsPerFloor) || 5;
    const info = (window.TowerAccess && window.TowerAccess.entryInfo) ? window.TowerAccess.entryInfo() : null;
    const L = splitLoot(result);

    let diag = { facts: [], tips: [] };
    try { diag = diagnose(result); }
    catch (e) { diag = { facts: ['（诊断不可用：' + esc((e && e.message) || '未知') + '）'], tips: [] }; }

    const tierFloor = Number(result.tierFloor) || 0;
    const secGear = L.gear.length
      ? `<div class="tw-s-sec"><div class="tw-s-sec-h">装备（${L.gear.length}）<span class="hint">未鉴定，回背包用鉴定石揭晓</span></div>${L.gear.map(gearRow).join('')}</div>`
      : '';
    const secAffix = L.affix.length
      ? `<div class="tw-s-sec"><div class="tw-s-sec-h">腐印（${L.affix.length} 种）<span class="hint">进塔的门票，也可上架</span></div><div class="ts-reward-list">${L.affix.map(m => chip(m, 'tw-item-affix')).join('')}</div></div>`
      : '';
    const secHigh = L.high.length
      ? `<div class="tw-s-sec"><div class="tw-s-sec-h">高级材料<span class="hint">塔的招牌产出</span></div><div class="ts-reward-list">${L.high.map(m => chip(m, 'tw-item-gold')).join('')}</div></div>`
      : '';
    const secJunk = L.junk.length
      ? `<div class="tw-s-junk"><span class="k">保底碎屑</span>${L.junk.map(m => `<span>${esc(m.name)} ×${esc(m.qty)}</span>`).join('')}</div>`
      : '';
    const nothing = (!L.gear.length && !L.affix.length && !L.high.length && !L.junk.length)
      ? '<div class="tw-s-sec"><div class="tw-s-empty">这一局什么都没拿到（第 1 层就倒下了）</div></div>' : '';

    const title = result.title ? `<div class="ts-title-tag">获得称号：<b>${esc(result.title.name)}</b></div>` : '';
    const consumedTxt = result.consumed === 'card'
      ? `消耗 ${esc((info && info.cardName) || '通天塔重置卡')} ×1`
      : '免费进入';
    const freeTxt = info ? `今日免费 ${info.freeLeft}/${info.freePerDay || 1} · 重置卡 ×${info.cardQty || 0}` : '';
    const bestTxt = info ? `历史最高 ${info.bestFloor || 0} 层${info.bestCorrosion ? ` / 腐蚀度 ${info.bestCorrosion}` : ''}` : '';
    const canAgain = !!(info && (info.freeLeft > 0 || (info.cardQty || 0) > 0));
    const againTxt = !info ? '再打一次'
      : (info.freeLeft > 0 ? `再打一次（免费 ${info.freeLeft} 次）` : (info.cardQty > 0 ? '再打一次（消耗重置卡 ×1）' : '今日次数用尽 · 需重置卡'));

    card.innerHTML = `
      <div class="ts-badge ${cleared ? 'is-clear' : 'is-fail'}">${cleared ? '✓ 通关' : '✕ 塔行结束'}</div>
      <div class="tw-s-floor">第 <b>${maxFloor}</b> / ${total} 层</div>
      <div class="tw-s-sub">每层 ${per} 只 · 腐蚀度 <b>${corrosion}</b> · ${cleared ? '全程通关' : (maxFloor > 0 ? '中途力竭' : '寸步未行')}${tierFloor > 0 ? ` · 拿到第 ${tierFloor} 层档` : ''}</div>

      <div class="tw-s-body">
        <div class="tw-s-sec-h tw-s-main-h">本次收获<span class="hint">已入背包</span></div>
        ${secGear}${secAffix}${secHigh}${secJunk}${nothing}
      </div>

      <div class="tw-s-diag">
        ${diag.facts.map(t => `<div class="tw-s-diag-f">${t}</div>`).join('')}
        ${diag.tips.map(t => `<div class="tw-s-diag-t">${t}</div>`).join('')}
      </div>

      ${title}
      <div class="tw-s-meta">${esc(consumedTxt)}${freeTxt ? ' · ' + esc(freeTxt) : ''}${bestTxt ? ' · ' + esc(bestTxt) : ''}</div>
      <div class="ts-actions">
        <button type="button" class="fs-btn fs-btn--primary" id="tws-again" ${canAgain ? '' : 'disabled'}>${esc(againTxt)}</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="tws-back">返回大地图</button>
        <button type="button" class="fs-btn fs-btn--ghost" id="tws-close">关闭</button>
      </div>`;
    wrap.hidden = false;
    bind(result);
  }

  function backToEntry() {
    const settle = $('tower-settle');
    if (settle) settle.hidden = true;
    const detail = $('tower-detail');
    if (detail) detail.hidden = true;
    if (UI.switchPage) UI.switchPage('worldmap');
    if (UI.renderWorldMapPage) UI.renderWorldMapPage();
    if (UI.refreshTowerMarker) UI.refreshTowerMarker();
  }
  UI.backToTowerEntry = backToEntry;

  function bind(result) {
    const wrap = $('tower-settle');
    if (!wrap) return;
    const again = $('tws-again');
    if (again) again.onclick = async () => {
      again.disabled = true;
      wrap.hidden = true;
      try {
        // 再打一次沿用本局腐印（腐印已消耗，缺货时引擎会拦下并回详情页）
        if (UI.startTowerBattle) await UI.startTowerBattle(result.affixIds || [], { from: 'settle' });
        else if (UI.showTowerDetail) UI.showTowerDetail();
      } catch (e) {
        if (UI.showToast) UI.showToast('通天塔异常', (e && e.message) || '未知错误');
      } finally {
        // 铁律：成功/失败/异常三条路都把按钮放回来
        again.disabled = false;
      }
    };
    const back = $('tws-back');
    if (back) back.onclick = backToEntry;
    const close = $('tws-close');
    if (close) close.onclick = backToEntry;
  }

  UI.showTowerSettle = showSettle;
})();
