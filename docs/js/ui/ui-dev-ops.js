/* ============================================================
 * ui/ui-dev-ops.js —— 开发者面板 · 内测看板（2026-09-17）
 *
 * 内测最值钱的是数据，但以前只能靠翻数据库看。这一页把最该盯的几件事摊开：
 *   ① 有几个活人（今日 / 7 日 / 此刻在挂机的）
 *   ② 玩家进度分布 —— 看新人卡在哪一段
 *   ③ 市场有没有在动（在售挂单 + 今日/7 日成交笔数）
 *   ④ 系统今天收走几件（注入量，配 maxPrice 一起看有没有放水）
 *   ⑤ 全服材料库存 top —— 只涨不消的会自己浮上来
 *
 * ⚠️ 这一页【没有】"材料产出 vs 消耗"的账：产出只记在 battle_logs.detail（结构未固定），
 *   消耗散在各 RPC 里，没有材料流水账。要看得先建账本 —— 别在页面上编一个数出来。
 *
 * 🔴 **开发者面板的注册契约（2026-09-17 踩过坑，别再犯）**：
 *   `DevPanel.registerTab(id, { render, bind })` ——
 *     · `render()` **无参数、必须【同步】返回 HTML 字符串**
 *       （ui-dev.js 里是 `html += panels[activeTab]()` 直接拼串；
 *        写成 async 或返回 Promise 会拼出 "[object Promise]"，写成操作 DOM 会报
 *        "Cannot set properties of undefined"——因为那时候容器还没插入文档）
 *     · `bind()` **必须提供** —— ui-dev.js 里 `binders[activeTab]()` 是无条件调用的，
 *       漏了它就是 "binders[activeTab] is not a function"
 *   所以「先出壳、再异步填数据」：render 出空壳 + 占位文案，bind 里自己查 DOM 填。
 *
 * 依赖：ui-dev（DevPanel.registerTab）、core/supabase（opsBoard）
 * ============================================================ */
(function () {
  'use strict';
  const DP = window.DevPanel;
  if (!DP) return;
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const num = v => Number(v || 0).toLocaleString('en-US');

  // 一格读数（不给每个数字套盒子：一组一行，靠分隔线分层）
  function stat(label, value, sub) {
    return `<div class="ops-stat"><span class="ops-lb">${esc(label)}</span>`
      + `<b class="ops-v">${esc(num(value))}</b>`
      + (sub ? `<span class="ops-sub">${esc(sub)}</span>` : '') + '</div>';
  }

  // 条形分布：宽度按最大值归一
  function bars(rows) {
    if (!rows || !rows.length) return '<div class="dev-hint">暂无数据</div>';
    const max = Math.max.apply(null, rows.map(r => Number(r.n) || 0)) || 1;
    return rows.map(r => {
      const n = Number(r.n) || 0;
      const w = Math.max(2, Math.round(n / max * 100));
      return `<div class="ops-bar-row"><span class="ops-bar-lb">${esc(r.seg || r.name)}</span>`
        + `<span class="ops-bar-track"><i style="width:${w}%"></i></span>`
        + `<span class="ops-bar-n">${esc(num(n))}</span></div>`;
    }).join('');
  }

  /* ---------- render：同步出壳 ---------- */
  function render() {
    return '<div class="ops-head">内测看板<span class="hint">每次进这一页现拉一次</span></div>'
      + '<div id="ops-root"><div class="dev-hint">正在读取…</div></div>';
  }

  function htmlOf(d) {
    const acc = d.accounts || {};
    const mk = d.market || {};
    const sw = d.sweep || {};
    return '<div class="ops-card"><div class="ops-title">活人</div><div class="ops-row">'
        + stat('账号总数', acc.total)
        + stat('今日来过', acc.active1d)
        + stat('7 日来过', acc.active7d)
        + stat('此刻挂机中', d.idleNow)
      + '</div></div>'

      + '<div class="ops-card"><div class="ops-title">玩家进度分布<span class="hint">按每个人名下最高的宠算 —— 看新人卡在哪一段</span></div>'
        + bars(d.progress || []) + '</div>'

      + '<div class="ops-card"><div class="ops-title">市场</div><div class="ops-row">'
        + stat('在售·装备', mk.equipListings)
        + stat('在售·宠物', mk.petListings)
        + stat('在售·材料', mk.materialListings)
        + stat('今日成交', mk.soldToday)
        + stat('7 日成交', mk.sold7d)
      + '</div><div class="hint">系统今天收走：装备 ' + num(sw.equipToday) + ' 件 · 材料 ' + num(sw.materialToday) + ' 笔'
        + '（配额与买入上限见 game_config_overrides 的 bot 配置）</div></div>'

      + '<div class="ops-card"><div class="ops-title">全服材料库存 top 12<span class="hint">只涨不消的会自己浮上来</span></div>'
        + bars((d.materials || []).map(m => ({ seg: m.name, n: m.qty }))) + '</div>'

      + '<div class="dev-hint">⚠️ 这里看不到「材料产出 vs 消耗」的账 —— 没有材料流水账本，别编一个数出来。</div>';
  }

  /* ---------- bind：挂了事件之后自己去填数据 ---------- */
  function bind() {
    const root = document.getElementById('ops-root');
    if (!root) return;
    if (!window.Supabase || !window.Supabase.opsBoard) {
      root.innerHTML = '<div class="dev-hint">未就绪（Supabase.opsBoard 不存在）</div>';
      return;
    }
    window.Supabase.opsBoard().then(function (r) {
      if (!root.isConnected) return;                       // 玩家已经切走这一页了
      if (r && r.error) {
        root.innerHTML = '<div class="dev-hint">读取失败：' + esc(r.error.message || '')
          + '<br>（非管理员会被服务端挡下：ERR_NOT_ADMIN）</div>';
        return;
      }
      root.innerHTML = htmlOf(r && r.data ? r.data : {});
    }).catch(function (e) {
      if (root.isConnected) root.innerHTML = '<div class="dev-hint">读取失败：' + esc(e && e.message) + '</div>';
    });
  }

  DP.registerTab('ops', { render: render, bind: bind });
})();
