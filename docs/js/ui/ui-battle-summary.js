/* ============================================================
 * ui/ui-battle-summary.js —— 唯一职责：挂机结算汇总弹窗（切回前台时把这段时间的收益摊给你看）。
 * 从 ui-battle.js 迁出（2026-09-21，一个文件一个职责）。
 *
 * 对外：`UI.showIdleSummary(r)`（idle-bridge 结算回来时调用）
 * 依赖：`UI`（$ / escapeHtml / setNum / switchPage）、`Supabase.usageOf`（背包快满提醒）、`window.showToast`（可选）。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { escapeHtml, $ } = UI;
  const toast = (title, sub) => { if (window.showToast) window.showToast(title, sub); };

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
        setTimeout(function(){ toast('⚠️ 背包快满了', '剩余 ' + (use.cap - use.used) + ' 格 · 去分解一下'); }, 1000);
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

  UI.showIdleSummary = showIdleSummary;
})();
