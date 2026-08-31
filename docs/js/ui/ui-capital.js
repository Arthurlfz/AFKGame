/* ============================================================
 * ui/ui-capital.js —— 主城页（不归城）：等距城寨全景 + 建筑热区
 * 职责：
 *  1. 渲染主城底图上的 6 个建筑热区（孵化所/兽栏/鉴定屋/铸造坊/商会/冒险者公会）
 *  2. 建筑悬停 → 信息卡（名字/描述/点击进入），点击 → 跳对应功能页
 *  3. 页眉「回城休整」：出战宠物一键回满血（复用 UI.healActivePet）
 *  4. 底图为 docs/assets/City/City.png（meowa 等距暗黑水墨城寨）
 * 依赖：ui-common（UI.$ / escapeHtml / showToast）、ui-worldmap.js（healActivePet）、
 *       ui-shell.js（switchPage）、ui-quest.js（openQuestPanel）
 * 说明：纯前端展示 + 复用现有入口；建筑坐标 = 相对底图 City.png 的百分比。
 *       「未来加建筑」：在 BUILDINGS 加一条 {id,name,icon,x,y,desc,go} 即可，不用改代码。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI || (window.UI = {});
  const $ = id => document.getElementById(id);
  const esc = s => (UI.escapeHtml ? UI.escapeHtml(s) : String(s));

  /* ---------- 建筑配置（坐标 = 相对底图 City.png 的百分比 0~100）----------
   * go：点击跳转动作。加新建筑：复制一条，改 id/name/x/y/desc/go 即可。 */
  const BUILDINGS = [
    {
      id: 'hatchery', name: '孵化',
      x: 41, y: 80,
      desc: '宠物蛋在此孵化。挂机掉落的蛋，到这里孵出你的新伙伴。',
      go: () => {
        if (!window.UI.switchPage) return;
        window.UI.switchPage('pet');
        // 切到「宠物蛋」tab（模拟点击，复用 initPetTabs 的事件委托）
        const eggTab = document.querySelector('.pet-tab[data-pet-tab="egg"]');
        if (eggTab) eggTab.click();
      }
    },
    {
      id: 'kennel', name: '兽栏',
      x: 34, y: 55,
      desc: '收容你的宠物军团。查看资料、切换出战、养成进化都在这。',
      go: () => { if (window.UI.switchPage) window.UI.switchPage('pet'); }
    },
    {
      id: 'appraise', name: '鉴定',
      x: 62, y: 80,
      desc: '鉴定未鉴定的装备。卷轴开封，词缀揭晓——好货全在这。',
      go: () => { if (window.UI.switchPage) window.UI.switchPage('bag'); }
    },
    {
      id: 'forge', name: '铸造',
      x: 72, y: 52,
      desc: '铁砧与炉火。打造新装备、重铸词缀、分解旧物都在这里。',
      go: () => { if (window.UI.switchPage) window.UI.switchPage('equip'); }
    },
    {
      id: 'market', name: '商会',
      x: 41, y: 40,
      desc: '玩家真实交易的地方。上架宠物/装备/材料，捡漏低价好货。',
      go: () => { if (window.UI.switchPage) window.UI.switchPage('market'); }
    },
    {
      id: 'guild', name: '任务中心',
      x: 59, y: 35,
      desc: '接取与交付任务。主线、日常、养成任务都在公告板上。',
      go: () => { if (window.UI.openQuestPanel) window.UI.openQuestPanel(); }
    }
  ];

  /* ---------- 渲染建筑热区（ui-shell 切到 capital 页时调用，幂等） ---------- */
  let rendered = false;

  function renderCapitalPage() {
    const host = $('capital-buildings');
    if (!host) return;
    if (!rendered) {
      // 建筑名字标签（静态，无动效）
      for (const b of BUILDINGS) host.appendChild(makeMarker(b));
      rendered = true;
    }
    bindCapital();
  }

  function makeMarker(b) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cap-bldg';
    el.dataset.id = b.id;
    el.style.left = b.x + '%';
    el.style.top = b.y + '%';
    el.setAttribute('aria-label', b.name);
    el.innerHTML = `<span class="cap-bldg-name">${esc(b.name)}</span>`;
    return el;
  }

  /* ---------- 事件（悬停信息卡 / 点击跳转 / 回城休整） ---------- */
  function bindCapital() {
    // 回世界地图（页眉按钮）
    const back = $('btn-capital-return-map');
    if (back && !back.__capBound) {
      back.__capBound = true;
      back.onclick = () => { if (window.UI.switchPage) window.UI.switchPage('worldmap'); };
    }
    // 回城休整（页眉按钮）：出战宠物回满血
    const rest = $('btn-capital-rest');
    if (rest && !rest.__capBound) {
      rest.__capBound = true;
      rest.onclick = () => { if (window.UI.healActivePet) window.UI.healActivePet(); };
    }
    // 建筑热区
    document.querySelectorAll('.cap-bldg').forEach(el => {
      if (el.__capBound) return;
      el.__capBound = true;
      el.addEventListener('mouseenter', () => {
        const b = BUILDINGS.find(x => x.id === el.dataset.id);
        if (!b) return;
        const tip = $('capital-tip');
        if (!tip) return;
        tip.innerHTML = `<div class="cap-tip-name">${b.icon} ${esc(b.name)}</div>
          <div class="cap-tip-desc">${esc(b.desc)}</div>
          <div class="cap-tip-cta">点击进入</div>`;
        tip.hidden = false;
        // 信息卡跟随建筑上方（绝对定位在 stage 内，坐标与 marker 同基准）
        const stage = $('capital-stage');
        if (!stage) return;
        const sr = stage.getBoundingClientRect();
        const mr = el.getBoundingClientRect();
        let tx = (mr.left - sr.left) + mr.width / 2 - 90;
        let ty = (mr.top - sr.top) - 6;
        tip.style.left = tx + 'px';
        tip.style.top = ty + 'px';
        tip.style.transform = 'translateY(-100%)';
        // 防超屏
        const tW = tip.offsetWidth || 180, tH = tip.offsetHeight || 60;
        if (tx + tW > (sr.width - 8)) tip.style.left = (sr.width - tW - 8) + 'px';
        if (ty - tH < 8) { tip.style.top = (mr.top - sr.top) + mr.height + 8 + 'px'; tip.style.transform = ''; }
      });
      el.addEventListener('mouseleave', () => { const tip = $('capital-tip'); if (tip) tip.hidden = true; });
      el.addEventListener('click', () => {
        const b = BUILDINGS.find(x => x.id === el.dataset.id);
        if (b && b.go) b.go();
      });
    });
  }

  // 对外 API：切到主城页时重渲染（ui-shell.js renderPage 钩子调用）
  UI.renderCapitalPage = renderCapitalPage;
})();
