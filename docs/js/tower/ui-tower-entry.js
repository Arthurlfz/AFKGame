/* ============================================================
 * tower/ui-tower-entry.js —— 通天塔详情页（进塔仪式 / 单一职责）
 * 职责：
 *  1. 塔详情页（容器 #tower-detail，独立于野图的 #area-detail）：塔介绍、层阶刻度、
 *     档位奖励、出战宠物、今日次数、腐印贴选、腐蚀度条、难度预估、进入
 *  2. UI.showTowerDetail()：大地图塔节点点击的落点
 * 不负责：整页战斗驱动（ui-tower-battle.js）、结算面板（ui-tower-settle.js）、
 *         资格与推进（tower-access/engine）。
 * 依赖：tower-config/access/affix/preview/engine、pet、materials、ui-common。
 * 设计约束（game-ui-design）：腐蚀度/风险不只靠颜色（同时给文字标签）；
 *   正文 ≥14px；动效 ≤300ms；Rarity 与风险都有文字；不新增独立页面。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI = window.UI || {};
  const $ = id => document.getElementById(id);
  const esc = v => UI.escapeHtml ? UI.escapeHtml(String(v || '')) : String(v || '');

  // 页面内已选腐印（进入时才真正消耗；点卡片即改，重渲染保留）
  let picked = [];
  let pendingPetId = null;

  function cfg() { return (window.Config && window.Config.tower) || {}; }
  function matQty(name) {
    return (window.Materials && window.Materials.getQuantity) ? window.Materials.getQuantity(name) : 0;
  }

  /* ---------- 层阶刻度（30 格，每 5 层一个档位节点） ---------- */
  function scaleHTML(total, best, tierFloors) {
    const cells = [];
    for (let f = 1; f <= total; f++) {
      const isTier = tierFloors.indexOf(f) >= 0;
      const reached = best >= f;
      cells.push(`<div class="tw-cell${isTier ? ' is-tier' : ''}${reached ? ' is-reached' : ''}" title="第 ${f} 层${isTier ? '（档位）' : ''}">
        <span class="tw-cell-no">${f}</span>${isTier ? '<span class="tw-cell-tag">档</span>' : ''}</div>`);
    }
    return `<div class="tw-scale">${cells.join('')}</div>`;
  }

  /* ---------- 腐印网格 ---------- */
  function affixHTML() {
    const A = window.TowerAffix;
    if (!A) return '<div class="tw-empty">腐印模块未加载</div>';
    const items = A.items();
    const used = A.validate(picked);
    return items.map(it => {
      const own = matQty(it.name);
      const on = picked.indexOf(it.id) >= 0;
      const unreadable = A.isUnreadable(it);
      const blocked = !on && (!used.ok && used.errors.length && own <= 0);
      const d = it.dropBonus || {};
      return `<button type="button" class="tw-affix${on ? ' is-on' : ''}${unreadable ? ' is-unreadable' : ''}${own <= 0 ? ' is-ownless' : ''}"
        data-affix="${esc(it.id)}" ${own <= 0 ? 'disabled' : ''}
        title="${esc(it.desc || '')}（${on ? '已贴，点击取下' : '点击贴上'}）">
        <span class="tw-affix-h">
          <span class="tw-affix-name">${esc(it.name)}</span>
          <span class="tw-affix-hot" title="腐蚀度">腐 ${esc(A.corrosionOf(it))}</span>
        </span>
        <span class="tw-affix-desc">${esc(it.desc || '')}</span>
        <span class="tw-affix-foot">
          <span class="tw-affix-drop">装备 +${esc(d.equipPct || 0)}% · 材料 +${esc(d.matPct || 0)}%</span>
          <span class="tw-affix-own${own > 0 ? '' : ' warn'}">持有 ${esc(own)}</span>
        </span>
        ${unreadable ? '<span class="tw-affix-flag">不可读</span>' : ''}
        ${blocked ? '<span class="tw-affix-flag warn">无库存</span>' : ''}
      </button>`;
    }).join('');
  }

  /* ---------- 腐蚀度条 + 预估 ---------- */
  function hotPanelHTML() {
    const A = window.TowerAffix, P = window.TowerPreview;
    const combo = A ? A.combine(picked) : { corrosion: 0, dropBonus: { equipPct: 0, matPct: 0 }, flags: {} };
    const maxCorrosion = 100; // 腐蚀度条满格刻度（纯展示比例，不是上限）
    const pct = Math.max(0, Math.min(100, Math.round(combo.corrosion / maxCorrosion * 100)));
    const checked = A ? A.validate(picked) : { ok: true, errors: [] };
    const errHTML = checked.errors.length
      ? `<div class="tw-err">${checked.errors.map(esc).join('<br>')}</div>` : '';

    let estHTML = '<div class="tw-est-empty">预估需要模拟器（BattleSim）与出战宠物</div>';
    if (P && window.Pet && window.Pet.getActivePet && window.Pet.getActivePet()) {
      const e = P.estimate(combo, { runs: 3 });
      if (e && e.ok) {
        const hpTxt = e.hpLeftPct == null ? '—' : Math.round(e.hpLeftPct) + '%';
        estHTML = `
          <div class="tw-est-row"><span class="k">预估可达</span><span class="v">第 <b>${e.medianFloor}</b>/${e.total} 层<span class="tw-dim">（${e.p10}~${e.p90}）</span></span></div>
          <div class="tw-est-row"><span class="k">通关把握</span><span class="v">${Math.round(e.clearRate * 100)}%<span class="tw-dim">（通关剩余血 ${hpTxt}）</span></span></div>
          <div class="tw-est-risk is-${e.risk.id}"><b>风险：${esc(e.risk.label)}</b><span>${esc(e.risk.hint)}</span></div>`;
      } else if (e) {
        estHTML = `<div class="tw-est-empty">${esc(e.reason || '预估不可用')}</div>`;
      }
    }

    return `
      <div class="tw-hotbar" title="腐蚀度总分 ${combo.corrosion}">
        <div class="tw-hotbar-fill" style="width:${pct}%"></div>
        <span class="tw-hotbar-txt">腐蚀度 <b>${combo.corrosion}</b>${combo.flags && combo.flags.healBlock ? ' · <b class="tw-warn">本局禁疗</b>' : ''}</span>
      </div>
      <div class="tw-drop">
        <span>掉率增益：装备 <b>+${combo.dropBonus.equipPct}%</b> · 材料 <b>+${combo.dropBonus.matPct}%</b></span>
      </div>
      ${errHTML}
      <div class="tw-est"><div class="tw-est-h">难度预估<span class="tw-dim">（白图推演 3 局）</span></div>${estHTML}</div>`;
  }

  /* ---------- 详情页 HTML ---------- */
  function detailHTML() {
    const c = cfg();
    const T = window.TowerEngine, A = window.TowerAccess, X = window.TowerAffix;
    const total = Number(c.floors) || 30;
    const per = (T && T.mobsPerFloor) ? T.mobsPerFloor() : (Number(c.mobsPerFloor) || 5);
    const info = (A && A.entryInfo) ? A.entryInfo() : { freeLeft: 0, freePerDay: 1, used: 0, cardName: c.resetCardName || '通天塔重置卡', cardQty: 0, bestFloor: 0, bestCorrosion: 0 };
    const tierFloors = (c.floorTiers || []).map(t => Number(t.floor) || 0).filter(Boolean);
    const tiersHtml = (c.floorTiers || []).map(t => {
      const mats = (t.items || []).map(i => `${i.name}×${i.qty}`).join('、') || '—';
      const gear = t.gear ? `装备（${t.gear.rarity === 'gold' ? '金' : '蓝'}）×${t.gear.count || 1}` : '';
      return `<div class="nd-boss-row"><span class="k">第 ${t.floor} 层</span><span class="v">${esc([gear, mats].filter(Boolean).join(' · '))}</span></div>`;
    }).join('');
    const cons = esc(((c.consolation || []).map(i => `${i.name}×${i.qty}`).join('、')) || '重铸石×1');

    // 出战宠物
    const Pet = window.Pet;
    const pets = (Pet && Pet.getPets) ? Pet.getPets() : [];
    const cur = (Pet && Pet.getActivePet) ? Pet.getActivePet() : null;
    const active = (pendingPetId != null) ? (pets.find(p => String(p.id) === String(pendingPetId)) || cur) : cur;
    const petChanged = !!(pendingPetId != null && cur && active && String(cur.id) !== String(active.id));
    const spriteOf = name => (window.PetSprites && window.PetSprites.avatarOf) ? window.PetSprites.avatarOf(name) : null;
    const petHtml = pets.map(p => {
      const god = (Pet && Pet.isGodPet) ? Pet.isGodPet(p) : !!p.isGodPet;
      const av = spriteOf(p.name);
      return `<div class="nd-pet${active && String(active.id) === String(p.id) ? ' active' : ''}${god ? ' god' : ''}" data-pid="${esc(p.id)}">
        <div class="p-ic">${av ? '<img src="' + esc(av) + '" alt="">' : ''}</div>
        <div class="p-nm">${esc(p.name)}</div>
        ${god ? '<div class="p-god">★ 神级</div>' : `<div class="p-meta">Lv.${esc(p.level || 1)} · 成长${esc((p.growth || 0).toFixed(1))}</div>`}
      </div>`;
    }).join('') || '<div class="nd-pet"><div class="p-nm">还没有宠物</div></div>';
    const godOk = !!(active && ((Pet && Pet.isGodPet) ? Pet.isGodPet(active) : active.isGodPet));
    const activeInfo = active
      ? `出战：<b>${esc(active.name)}</b> · 成长 <b>${esc((active.growth || 0).toFixed(1))}</b>${petChanged ? '<span class="nd-pending">已改选，进入后生效</span>' : ''}`
      : '还没有出战宠物';

    const canFree = info.freeLeft > 0;
    const canCard = (info.cardQty || 0) > 0;
    const affixOk = X ? X.validate(picked).ok : true;
    const goDisabled = !(canFree || canCard) || !affixOk || !active;
    const goTxt = canFree ? `免费进入（剩 ${info.freeLeft} 次）`
      : (canCard ? `消耗 ${esc(info.cardName)} ×1 进入` : '今日次数用尽 · 需重置卡');

    return `
      <div class="nd-top">
        <div class="nd-title">${esc(c.name || '通天塔')}</div>
        <div class="nd-sub">
          <span>后期挑战</span>
          <span>共 <b>${total}</b> 层</span>
          <span>每局从第 1 层重开</span>
          <span>血量跨层累计</span>
          <span class="tw-hint-god">${esc((c.unlock && c.unlock.hint) || '推荐神级宠')}</span>
        </div>
        <button type="button" class="nd-back" id="tw-back">← 返回大地图</button>
      </div>
      <div class="nd-grid">
        <div class="nd-card">
          <div class="nd-card-title">登塔规则<span class="hint">满级怪 · ${total} 层是长线目标</span></div>
          <p class="nd-desc">共 ${total} 层，每层 ${per} 只怪（前 ${per - 1} 只杂兵 + 最后 1 只守卫），全部清完才进下一层；<b>整局只吃一管血</b>，层与层之间、同一层 ${per} 只之间都不回满。守卫满级起步、<b>每层更强、都会放技能</b>。倒下或通关即结算，奖励按【最高到达层数】给档。<b>${total} 层是长线目标</b>：不贴腐印也能进能打，但要爬更高只有一条路——继续变强（涅槃 / 装备 / 成长）。腐印是自愿的加码：怪更强，掉落更多。</p>
          <p class="nd-desc"><b>奖励分三层</b>：每打死一只都有随机掉落（材料碎屑为主，偶尔爆装备）；<b>第 5 只守卫掉得明显更肥</b>；此外每过 5 层再额外给一次固定档位奖励（见下表）。越深的层数才掉越好的材料。</p>
          <div class="nd-card-title" style="margin-top:14px">层阶刻度<span class="hint">历史最高 ${esc(info.bestFloor || 0)} 层${info.bestCorrosion ? ` · 最高腐蚀度 ${esc(info.bestCorrosion)}` : ''}</span></div>
          ${scaleHTML(total, info.bestFloor || 0, tierFloors)}
          <div class="nd-card-title" style="margin-top:14px">档位奖励<span class="hint">按最高到达层数取最深一档</span></div>
          <div class="nd-boss-rows">${tiersHtml}</div>
          <div class="nd-boss-rows" style="margin-top:6px"><div class="nd-boss-row"><span class="k">不足 5 层</span><span class="v">${cons}</span></div></div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">选择战斗宠物<span class="hint">点击切换出战</span></div>
          <div class="nd-pets">${petHtml}</div>
          <div class="nd-active-row"><span>${activeInfo}</span><span class="tag">${godOk ? '神级宠' : '普通宠'}</span></div>
          <div class="nd-card-title" style="margin-top:14px">今日资格<span class="hint">北京时间 12:00 刷新</span></div>
          <div class="nd-boss-rows">
            <div class="nd-boss-row"><span class="k">免费</span><span class="v${canFree ? '' : ' warn'}">${esc(info.freeLeft)}/${esc(info.freePerDay || 1)}</span></div>
            <div class="nd-boss-row"><span class="k">${esc(info.cardName)}</span><span class="v${canCard ? '' : ' warn'}">× ${esc(info.cardQty || 0)}</span></div>
            <div class="nd-boss-row"><span class="k">刷新</span><span class="v">每日 12:00</span></div>
          </div>
          <div class="nd-ticket-tip">免费次数用尽后，消耗 1 张重置卡可再开一局。重置卡在魔石商店购买（每周限购）。${!godOk && active ? '<br><b class="tw-warn">当前出战不是神级宠：普通宠满配也上不到顶。</b>' : ''}</div>
        </div>
        <div class="nd-card">
          <div class="nd-card-title">腐印（腐蚀度）<span class="hint">最多贴 ${esc(X ? X.maxPerRun() : 3)} 条 · 进入时消耗</span></div>
          ${hotPanelHTML()}
          <div class="tw-affix-grid">${affixHTML()}</div>
        </div>
      </div>
      <div class="nd-foot">
        <span class="tip">倒下/通关后需重置卡才能再开 · <b>不贴腐印也能打，但高层要靠成长与装备</b></span>
        <button type="button" class="nd-go" id="tw-go" ${goDisabled ? 'disabled' : ''}>⚔ ${goTxt}</button>
      </div>`;
  }

  /* ---------- 渲染 + 事件 ---------- */
  function render() {
    const el = $('tower-detail');
    const body = $('tower-detail-body');
    if (!el || !body) return;
    body.innerHTML = detailHTML();
    const back = body.querySelector('#tw-back');
    if (back) back.onclick = () => { el.hidden = true; pendingPetId = null; };
    // 换出战宠：只记下待选，进入时生效（与野图详情页同口径，避免换宠打断正在跑的挂机）
    body.querySelectorAll('.nd-pet').forEach(card => {
      card.onclick = () => { pendingPetId = card.dataset.pid; window.TowerPreview && window.TowerPreview.clearCache(); render(); };
    });
    // 贴/摘腐印
    body.querySelectorAll('.tw-affix').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.affix;
        if (!id) return;
        const i = picked.indexOf(id);
        if (i >= 0) picked.splice(i, 1); else picked.push(id);
        window.TowerPreview && window.TowerPreview.clearCache();
        render();
      };
    });
    // 进入
    const go = body.querySelector('#tw-go');
    if (go) {
      go.onclick = async () => {
        go.disabled = true;
        try {
          const pid = pendingPetId; pendingPetId = null;
          if (pid != null && window.Pet && window.Pet.setActive) window.Pet.setActive(pid);
          if (UI.startTowerBattle) await UI.startTowerBattle(picked.slice(), { from: 'node' });
        } catch (e) {
          if (UI.showToast) UI.showToast('通天塔异常', (e && e.message) || '未知错误');
        } finally {
          // 铁律：await 后不论成功/失败/异常都要把按钮放回来
          go.disabled = false;
          if (UI.refreshTowerMarker) UI.refreshTowerMarker();
        }
      };
    }
  }

  function showTowerDetail() {
    const el = $('tower-detail');
    if (!el) {
      if (UI.showToast) UI.showToast('无法打开通天塔', '页面容器缺失（#tower-detail）');
      return;
    }
    pendingPetId = null;
    render();
    el.hidden = false;
  }

  UI.showTowerDetail = showTowerDetail;
  UI.renderTowerDetail = render;
  // 供结算面板/进入失败回退时清空已贴腐印
  UI.resetTowerPick = () => { picked = []; window.TowerPreview && window.TowerPreview.clearCache(); };
})();
