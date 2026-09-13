/* ============================================================
 * ui/ui-mat-entry.js —— 材料词条页（点开看全，2026-09-14）
 * 职责：把 `MatWiki.entry(name)` 的数据渲染成一个模态词条，信息结构对齐流亡编年史：
 *   本体卡（图标 / 名称 / 稀有度 / 分区 / 持有）
 *   → 【怎么用】一句（配置里查得到就派生，查不到才手写）
 *   → 【用途】表（在哪用 · 说明 · 需要多少）
 *   → 【来源】表（从哪来 · 说明 · 数量）
 *   章节标题右侧带条数（`用途 /3`）—— 编年史那种"数量即导航"，也方便看数据缺没缺。
 * 不负责：数据派生（core/mat-wiki.js）、悬停短版（ui-bag.js）。
 * 样式：复用装备详情模态的壳（.equip-detail-modal / .ed-card），只加 .me-* 行样式。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = v => UI.escapeHtml ? UI.escapeHtml(String(v != null ? v : '')) : String(v != null ? v : '');

  function closeMatEntry() {
    const m = $('mat-entry-modal');
    if (m) m.classList.remove('open');
  }

  function rowsHtml(list, emptyTxt) {
    if (!list || !list.length) return '<div class="me-empty">' + esc(emptyTxt) + '</div>';
    return list.map(r => {
      const qty = (r.qty && r.qty !== 1) ? ('×' + esc(r.qty)) : (r.qty === 1 ? '×1' : '');
      return '<div class="me-row"><span class="k">' + esc(r.where) + '</span>'
        + '<span class="v">' + esc(r.what) + '</span>'
        + (qty ? '<span class="q">' + qty + '</span>' : '')
        + '</div>';
    }).join('');
  }

  function openMatEntry(name) {
    const W = window.MatWiki;
    if (!W || !name) return;
    const e = W.entry(name);
    if (!e) return;

    let modal = $('mat-entry-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mat-entry-modal';
      modal.className = 'equip-detail-modal';
      document.body.appendChild(modal);
    }
    const held = (window.Materials && window.Materials.getQuantity) ? window.Materials.getQuantity(name) : 0;
    /* 手写的那句「怎么用」直接当用途表的第一行 —— 它本来就是一条用途，
     * 单独再开一块会造成"用途 共 0 条"这种自相矛盾的显示（同一句话也不重复念）。 */
    const useRows = (e.handUse ? [{ where: '怎么用', what: e.handUse, qty: null }] : []).concat(e.uses);

    modal.innerHTML = `
      <div class="ed-overlay" data-close="1"></div>
      <div class="ed-card me-card">
        <div class="ed-head">${e.icon || ''} ${esc(e.name)}
          <span class="ed-sub">${esc(e.groupLabel)}${e.rarity ? ' · ' + esc(e.rarity) : ''} · 持有 ×${esc(held)}</span></div>
        <div class="me-sec">
          <div class="me-sec-h">用途<span class="n">共 ${useRows.length} 条</span></div>
          ${rowsHtml(useRows, '暂未接入任何玩法（或消耗点在别处，欢迎反馈）')}
        </div>
        <div class="me-sec">
          <div class="me-sec-h">来源<span class="n">共 ${e.sources.length} 条</span></div>
          ${rowsHtml(e.sources, '暂无来源记录')}
        </div>
        <div class="ed-actions">
          <button class="btn-mini" data-close="1">关闭</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-close]').forEach(el => { el.onclick = closeMatEntry; });
    modal.classList.add('open');
  }

  UI.openMatEntry = openMatEntry;
  UI.closeMatEntry = closeMatEntry;
})();
