/* ============================================================
 * ui/ui-dev.js —— 开发者面板（仅管理员账号可见入口）
 * 入口：登录且邮箱 ∈ Config.dev.adminEmails 时，左侧边栏显示「🛠 开发者」按钮
 * 面板用 Tab 分块：
 *  - 数值调参：滑杆改 Config 内存值立即生效（战/经/掉/怪均实时读 Config）
 *  - 资源发放：发材料/魔石/造装备/发蛋/给当前宠加经验·等级·成长（替代改库和 SQL）
 * 纯前端、不写库（除魔石走 grant_gems RPC、装备/蛋落云端）、刷新复原内存改动。
 * 依赖：ui-common（window.UI / getAuthUser）、config（window.Config）、drop/pet/equipment/items/materials
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const Config = window.Config;
  const $ = (id) => document.getElementById(id);

  const ADMIN = (Config.dev && Config.dev.adminEmails) || [];
  const isAdmin = () => {
    const u = UI.getAuthUser && UI.getAuthUser();
    return !!(u && u.email && ADMIN.indexOf(u.email) >= 0);
  };

  /* ---------- 怪物数值原值快照（全局倍率专用） ---------- */
  let ORIG_AREA = null;
  function snapshotAreas() {
    if (!ORIG_AREA && Config.battle && Config.battle.areaEnemyStats) {
      try { ORIG_AREA = JSON.parse(JSON.stringify(Config.battle.areaEnemyStats)); } catch (e) { ORIG_AREA = null; }
    }
  }
  function applyMonsterMult(m) {
    if (!ORIG_AREA) return;
    const cur = Config.battle.areaEnemyStats;
    for (const id in ORIG_AREA) {
      if (!cur[id]) continue;
      for (const k of ['hp', 'atk', 'def']) {
        if (typeof ORIG_AREA[id][k] === 'number') cur[id][k] = Math.round(ORIG_AREA[id][k] * m);
      }
    }
  }

  /* ---------- 点路径读写 Config ---------- */
  function getByPath(p) {
    return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), Config);
  }
  function setByPath(p, v) {
    const ks = p.split('.');
    let o = Config;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }

  /* ---------- 调参字段表（构建时读取当前值作为「默认值」用于复原） ---------- */
  const SCHEMA = [
    { group: '经验', fields: [
      { path: 'exp.rate', label: '全局经验倍率', min: 0.1, max: 10, step: 0.1 },
      { path: 'exp.perWinCoef', label: '每场经验系数', min: 1, max: 30, step: 1 },
      { path: 'exp.needExponent', label: '升级需求指数', min: 1.0, max: 2.0, step: 0.05, note: '改这个升级曲线会变，谨慎' },
      { path: 'exp.perWinJitter', label: '经验波动', min: 0, max: 1, step: 0.05 }
    ] },
    { group: '掉落', fields: [
      { path: 'drop.pool.equipment', label: '装备掉率权重', min: 0, max: 100, step: 1, note: '四项是相对权重，一起归一化，改比例不改总盘' },
      { path: 'drop.pool.egg', label: '蛋掉率权重', min: 0, max: 100, step: 1 },
      { path: 'drop.pool.material', label: '材料掉率权重', min: 0, max: 1000, step: 5 },
      { path: 'drop.pool.none', label: '无掉落权重', min: 0, max: 3000, step: 10 }
    ] },
    { group: '战斗节奏', fields: [
      { path: 'battle.speedScale', label: '攻速比例尺', min: 4, max: 30, step: 1 },
      { path: 'battle.nextFightDelay', label: '场间隔(ms)', min: 0, max: 3000, step: 50 },
      { path: 'battle.stopHpRatio', label: '停手血量比', min: 0.05, max: 0.8, step: 0.05 },
      { path: 'battle.critRate', label: '暴击率', min: 0, max: 0.5, step: 0.01 },
      { path: 'battle.critMultiplier', label: '暴击伤害', min: 1, max: 3, step: 0.1 }
    ] },
    { group: '怪物强度', special: 'monsterMult', label: '全局怪物数值倍率', min: 0.5, max: 2, step: 0.05, default: 1 },
    { group: '回血', fields: [
      { path: 'regen.hpPerSecRatio', label: '每秒回血比例', min: 0.02, max: 1, step: 0.01 }
    ] },
    { group: '市场机器人', fields: [
      { path: 'marketBot.enabled', label: '市场机器人开关', bool: true },
      { path: 'marketBot.intervalMs', label: '补货间隔(ms)', min: 5000, max: 120000, step: 1000 },
      { path: 'marketBot.perTick', label: '每次上架', min: 1, max: 20, step: 1 },
      { path: 'marketBot.leakChance', label: '漏价概率', min: 0, max: 0.5, step: 0.01 }
    ] },
    { group: '特质/魂铸', fields: [
      { path: 'traitHatch.mutant.t1Boost', label: '变异T1特质概率加成', min: 0, max: 50, step: 1, note: '合成变异时 T1 特质概率 +X%（%为单位）' },
      { path: 'traitHatch.mutant.count3', label: '变异3条特质概率', min: 0, max: 50, step: 1, note: '合成变异时出 3 条特质的概率（%）' },
      { path: 'traitInherit.mainKeep', label: '合成主宠特质保留率', min: 0, max: 1, step: 0.05 },
      { path: 'traitInherit.subKeep', label: '合成副宠特质继承率', min: 0, max: 1, step: 0.05 },
      { path: 'traitInherit.up', label: '继承升阶概率', min: 0, max: 1, step: 0.01, note: '特质继承时 T 阶 +1 概率（封顶 T1）' },
      { path: 'traitNirvana.implantChance', label: '涅槃特质植入率', min: 0, max: 1, step: 0.01 },
      { path: 'soulCast.materialCount', label: '魂铸消耗凝魂晶石', min: 1, max: 50, step: 1 },
      { path: 'awakenSkillDamage', label: '觉醒技能伤害加成', min: 0, max: 0.5, step: 0.05 }
    ] },
    { group: '成长系统', fields: [
      { path: 'synthesize.mutation.chance', label: '变异概率', min: 0, max: 1, step: 0.01 },
      { path: 'nirvana.absorbRatio', label: '涅槃吸收比例', min: 0, max: 1, step: 0.01 },
      { path: 'nirvana.minLevel', label: '涅槃门槛等级', min: 1, max: 100, step: 1 }
    ] }
  ];
  // 构建默认值；配置里缺字段的项标记 _missing，渲染时兜底显示且不影响其他项
  SCHEMA.forEach(g => (g.fields || []).forEach(f => {
    f._default = getByPath(f.path);
    f._missing = f._default === undefined;
  }));

  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
  }
  function groupHtml(title, inner) {
    return '<section class="dev-group"><div class="dev-group-title">' + title + '</div>' + inner + '</section>';
  }
  function defaultOf(path) {
    let d;
    SCHEMA.forEach(g => (g.fields || []).forEach(f => { if (f.path === path) d = f._default; }));
    return d;
  }

  /* ---------- Tab 状态 ---------- */
  let activeTab = 'tune';
  function tabBarHtml() {
    const mk = (id, idx, short, full) =>
      '<button class="dev-tab' + (activeTab === id ? ' active' : '') + '" data-tab="' + id + '" title="' + full + '">' +
      '<span class="dev-tab-idx">' + idx + '</span>' + short + '</button>';
    return '<div class="dev-tabs">' +
      mk('tune', '1', '调参', '数值调参') +
      mk('res', '2', '资源', '资源发放') +
      mk('sim', '3', '模拟', '模拟器') +
      mk('fast', '4', '快进', '养成快进') +
      mk('player', '5', '玩家', '玩家管理') +
      mk('stats', '6', '数据', '运营数据') + '</div>';
  }

  /* ============ Tab 1：数值调参 ============ */
  function renderTunePanel() {
    let html = '';
    SCHEMA.forEach(g => {
      if (g.special === 'monsterMult') {
        const v = g.default != null ? g.default : 1;
        html += groupHtml(g.group,
          '<div class="dev-row">' +
            '<div class="dev-row-head"><span class="dev-label">' + g.label + '</span>' +
              '<span class="dev-val" id="val-monsterMult">' + v.toFixed(2) + '</span></div>' +
            '<input type="range" class="dev-range" data-special="monsterMult" min="' + g.min + '" max="' + g.max + '" step="' + g.step + '" value="' + v + '">' +
            '<button class="dev-reset-one btn-mini ghost" data-special="monsterMult" title="复原">↺</button>' +
            '<div class="dev-note">按原值×倍率重写各图怪物数值，拖多次不会叠加失真</div>' +
          '</div>');
        return;
      }
      const rows = g.fields.map(f => {
        let val = getByPath(f.path);
        if (!Number.isFinite(val)) val = Number.isFinite(f._default) ? f._default : (Number.isFinite(f.default) ? f.default : f.min);
        if (f.bool) {
          return '<div class="dev-row" data-path="' + f.path + '">' +
            '<div class="dev-row-head"><span class="dev-label">' + f.label + '</span>' +
              '<label class="dev-switch"><input type="checkbox" data-path="' + f.path + '"' + (val ? ' checked' : '') + '><span class="dev-switch-track"></span></label></div>' +
            '<button class="dev-reset-one btn-mini ghost" data-path="' + f.path + '" title="复原">↺</button>' +
          '</div>';
        }
        return '<div class="dev-row" data-path="' + f.path + '">' +
          '<div class="dev-row-head"><span class="dev-label">' + f.label + '</span>' +
            '<span class="dev-val" id="val-' + f.path + '">' + fmt(val) + '</span></div>' +
          '<input type="range" class="dev-range" data-path="' + f.path + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + val + '">' +
          '<button class="dev-reset-one btn-mini ghost" data-path="' + f.path + '" title="复原">↺</button>' +
          (f.note ? '<div class="dev-note">' + f.note + '</div>' : '') +
        '</div>';
      }).join('');
      html += groupHtml(g.group, rows);
    });
    // 复原 / 导出（放在数值调参面板底部）
    html += '<section class="dev-group"><div class="dev-group-title">配置</div>' +
      '<div class="dev-actions-row">' +
        '<button class="btn-mini ghost" id="dev-reset-all">一键复原全部</button>' +
        '<button class="btn-mini primary" id="dev-export">导出当前配置 JSON</button>' +
      '</div>' +
      '<div class="dev-export-box" id="dev-export-box" style="display:none">' +
        '<div class="dev-export-hint">当前 Config 完整 JSON（复制后手动合并回 config.js）：</div>' +
        '<textarea id="dev-export-text" class="dev-export-text" readonly></textarea>' +
        '<button class="btn-mini primary" id="dev-copy">复制</button>' +
      '</div>' +
    '</section>';
    return html;
  }
  function bindTunePanel() {
    const body = $('dev-body');
    if (!body) return;
    body.querySelectorAll('.dev-range[data-path]').forEach(inp => {
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        setByPath(inp.dataset.path, v);
        const valEl = $('val-' + inp.dataset.path);
        if (valEl) valEl.textContent = fmt(v);
      });
      inp.addEventListener('change', () => { if (UI.renderAll) UI.renderAll(); });
    });
    body.querySelectorAll('.dev-switch input[data-path]').forEach(cb => {
      cb.addEventListener('change', () => { setByPath(cb.dataset.path, cb.checked); });
    });
    body.querySelectorAll('.dev-range[data-special="monsterMult"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const m = Number(inp.value);
        applyMonsterMult(m);
        const el = $('val-monsterMult'); if (el) el.textContent = m.toFixed(2);
      });
    });
    body.querySelectorAll('.dev-reset-one[data-path]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.path;
        const def = defaultOf(p);
        if (def === undefined) return;
        setByPath(p, def);
        const inp = body.querySelector('.dev-range[data-path="' + p + '"]'); if (inp) inp.value = def;
        const valEl = $('val-' + p); if (valEl) valEl.textContent = fmt(def);
        if (UI.renderAll) UI.renderAll();
      });
    });
    body.querySelectorAll('.dev-reset-one[data-special="monsterMult"]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyMonsterMult(1);
        const inp = body.querySelector('.dev-range[data-special="monsterMult"]'); if (inp) inp.value = 1;
        const el = $('val-monsterMult'); if (el) el.textContent = '1.00';
      });
    });
    const resetAll = $('dev-reset-all'); if (resetAll) resetAll.onclick = resetAllFields;
    const exp = $('dev-export'); if (exp) exp.onclick = doExport;
    const copy = $('dev-copy'); if (copy) copy.onclick = copyExport;
  }
  function resetAllFields() {
    SCHEMA.forEach(g => {
      if (g.special === 'monsterMult') { applyMonsterMult(1); return; }
      (g.fields || []).forEach(f => setByPath(f.path, f._default));
    });
    renderBody();
  }
  function doExport() {
    const box = $('dev-export-box'); if (!box) return;
    box.style.display = 'block';
    const txt = $('dev-export-text');
    if (txt) {
      try { txt.value = JSON.stringify(window.Config, null, 2); }
      catch (e) { txt.value = '// 序列化失败：' + (e && e.message); }
    }
  }
  function copyExport() {
    const txt = $('dev-export-text');
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt.value).then(
        () => UI.showToast && UI.showToast('已复制', '当前配置 JSON 已复制到剪贴板'),
        () => UI.showToast && UI.showToast('复制失败', '请手动选中文本框复制')
      );
    } else {
      txt.select();
      try { document.execCommand('copy'); UI.showToast && UI.showToast('已复制', '当前配置 JSON 已复制'); }
      catch (e) { UI.showToast && UI.showToast('复制失败', '请手动选中文本框复制'); }
    }
  }

  /* ============ Tab 2：资源发放 ============ */
  function collectMaterialNames() {
    const names = [], seen = {};
    const add = n => { if (n && !seen[n]) { seen[n] = 1; names.push(n); } };
    const craft = Config.craft || {};
    Object.keys(craft).forEach(k => { if (craft[k] && craft[k].name) add(craft[k].name); });
    const evo = Config.drop && Config.drop.evoMaterialWeights; if (evo) Object.keys(evo).forEach(add);
    if (Config.drop && Config.drop.phoenixName) add(Config.drop.phoenixName);
    if (Config.drop && Config.drop.synthesizeName) add(Config.drop.synthesizeName);
    const am = Config.drop && Config.drop.areaMaterials; if (am) Object.keys(am).forEach(k => { if (am[k] && am[k].name) add(am[k].name); });
    if (Config.pet && Config.pet.expPool && Config.pet.expPool.material) add(Config.pet.expPool.material);
    return names;
  }
  function collectEggSpecies() {
    const sp = (Config.pet && Config.pet.starters) || [];
    return sp.map(s => s.name).filter(Boolean);
  }
  function activePetInfo() {
    const p = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
    if (!p) return '<div class="dev-petinfo warn">未选择出战宠物（先去宠物页选一只）</div>';
    return '<div class="dev-petinfo">当前出战：<b>' + (p.name || '?') + '</b> · Lv.' + (p.level || 1) +
      ' · 成长 ' + (typeof p.growth === 'number' ? p.growth.toFixed(1) : '?') + '</div>';
  }
  function renderResourcePanel() {
    const matOpts = collectMaterialNames().map(n => '<option value="' + n + '">' + n + '</option>').join('');
    const rarOpts = (Config.equipment.rarities || []).map(r => '<option value="' + r.id + '">' + (r.label || r.id) + '</option>').join('');
    const eggOpts = collectEggSpecies().map(n => '<option value="' + n + '">' + n + '</option>').join('');
    let html = '';
    // 发材料
    html += groupHtml('发材料',
      '<div class="dev-row">' +
        '<select class="dev-input" id="res-mat-name">' + matOpts + '</select>' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="res-mat-amt" type="number" min="1" value="10" style="width:90px">' +
          '<button class="btn-mini primary" id="res-mat-go">发放</button>' +
        '</div>' +
        '<div class="dev-note">走 Materials.gain，已登录自动同步云端</div>' +
      '</div>');
    // 发魔石
    html += groupHtml('发魔石',
      '<div class="dev-row">' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="res-gem-amt" type="number" min="1" value="100" style="width:120px">' +
          '<button class="btn-mini primary" id="res-gem-go">发放</button>' +
        '</div>' +
        '<div class="dev-note">走 grant_gems RPC（仅管理员邮箱可调用），替代手动 SQL</div>' +
      '</div>');
    // 造装备
    html += groupHtml('造装备（进背包）',
      '<div class="dev-row">' +
        '<div class="dev-inline">' +
          '<select class="dev-input" id="res-eq-rarity">' + rarOpts + '</select>' +
          '<input class="dev-input" id="res-eq-tier" type="number" min="1" max="17" value="6" title="图档T" style="width:64px">' +
          '<input class="dev-input" id="res-eq-mattier" type="number" min="1" max="5" value="3" title="底材T" style="width:64px">' +
          '<input class="dev-input" id="res-eq-amt" type="number" min="1" max="20" value="1" title="数量" style="width:64px">' +
          '<button class="btn-mini primary" id="res-eq-go">生成</button>' +
        '</div>' +
        '<div class="dev-note">复用 generateEquipment，已鉴定，落云端 equip_items</div>' +
      '</div>');
    // 发蛋
    html += groupHtml('发宠物蛋',
      '<div class="dev-row">' +
        '<div class="dev-inline">' +
          '<select class="dev-input" id="res-egg-name">' + eggOpts + '</select>' +
          '<input class="dev-input" id="res-egg-amt" type="number" min="1" value="1" style="width:64px">' +
          '<button class="btn-mini primary" id="res-egg-go">发放</button>' +
        '</div>' +
        '<div class="dev-note">走 Drop.grantEgg，本地计数 + 云端 pet_egg</div>' +
      '</div>');
    // 给当前宠
    html += groupHtml('给当前出战宠',
      activePetInfo() +
      '<div class="dev-row">' +
        '<div class="dev-row-head"><span class="dev-label">加经验</span></div>' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="res-pet-exp" type="number" min="1" value="1000" style="width:120px">' +
          '<button class="btn-mini primary" id="res-pet-exp-go">加</button>' +
        '</div>' +
      '</div>' +
      '<div class="dev-row">' +
        '<div class="dev-row-head"><span class="dev-label">设等级（1~' + (Config.pet.maxLevel || 100) + '）</span></div>' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="res-pet-lv" type="number" min="1" max="' + (Config.pet.maxLevel || 100) + '" value="1" style="width:90px">' +
          '<button class="btn-mini primary" id="res-pet-lv-go">设</button>' +
        '</div>' +
      '</div>' +
      '<div class="dev-row">' +
        '<div class="dev-row-head"><span class="dev-label">加成长（可负，封顶 ' + (Config.nirvana.maxGrowth || 100) + '）</span></div>' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="res-pet-gr" type="number" step="0.1" value="5" style="width:90px">' +
          '<button class="btn-mini primary" id="res-pet-gr-go">加</button>' +
        '</div>' +
      '</div>');
    return html;
  }
  function bindResourcePanel() {
    const body = $('dev-body');
    if (!body) return;
    const toast = (t, d) => { if (UI.showToast) UI.showToast(t, d); };
    const needPet = () => {
      const p = window.Pet && window.Pet.getActivePet && window.Pet.getActivePet();
      if (!p) { toast('❌ 没有出战宠物', '先去宠物页选一只'); return null; }
      return p;
    };
    const num = (id, d) => { const v = parseFloat($(id) && $(id).value); return Number.isFinite(v) ? v : (d || 0); };

    const matGo = $('res-mat-go');
    if (matGo) matGo.onclick = () => {
      const name = $('res-mat-name') && $('res-mat-name').value;
      const amt = num('res-mat-amt', 1);
      if (!name || !amt) return;
      if (window.Materials) window.Materials.gain(name, amt);
      if (UI.renderAll) UI.renderAll();
      toast('已发放', name + ' ×' + amt);
    };
    const gemGo = $('res-gem-go');
    if (gemGo) gemGo.onclick = async () => {
      const amt = Math.floor(num('res-gem-amt', 0));
      if (amt <= 0) return;
      const S = window.Supabase; if (!S) { toast('❌ 无 Supabase', ''); return; }
      const user = await S.getCurrentUser();
      if (!user) { toast('❌ 请先登录', '魔石要落到账号'); return; }
      const { data, error } = await S.getClient().rpc('grant_gems', { p_user_id: user.id, p_amount: amt, p_reason: 'dev-panel' });
      const res = (typeof data === 'string') ? data : (error ? 'error' : 'ok');
      if (res === 'forbidden') { toast('❌ 无权限', '仅管理员邮箱可发魔石'); return; }
      if (res === 'badamount') { toast('❌ 数量无效', ''); return; }
      if (error) { toast('❌ 发放失败', error.message || String(error)); return; }
      if (UI.refreshShop) await UI.refreshShop(); // 刷新顶栏余额
      if (UI.renderAll) UI.renderAll();
      const w = (S.getMyWallet && await S.getMyWallet()) || {};
      toast('🪙 已发放 ' + amt + ' 魔石', '当前余额 ' + (w.gems || '?'));
    };
    const eqGo = $('res-eq-go');
    if (eqGo) eqGo.onclick = async () => {
      const E = window.Equipment, I = window.Items;
      if (!E || !I) { toast('❌ 装备模块未就绪', ''); return; }
      const rarityId = $('res-eq-rarity') && $('res-eq-rarity').value;
      const rarity = (Config.equipment.rarities || []).find(r => r.id === rarityId) || Config.equipment.rarities[0];
      const tier = Math.max(1, Math.min(17, Math.floor(num('res-eq-tier', 1))));
      const mattier = Math.max(1, Math.min(5, Math.floor(num('res-eq-mattier', 3))));
      const count = Math.max(1, Math.min(20, Math.floor(num('res-eq-amt', 1))));
      let made = 0;
      for (let i = 0; i < count; i++) {
        const eq = E.generateEquipment(rarity, tier, mattier);
        eq.identified = true;
        E.addToInventory(eq);
        const res = await I.saveItem(eq);
        if (res && res.data && res.data.id) eq.cloudId = res.data.id;
        made++;
      }
      if (UI.renderAll) UI.renderAll();
      toast('已生成装备 ×' + made, (rarity.label || rarity.id) + ' · 图档T' + tier + ' · 底材T' + mattier);
    };
    const eggGo = $('res-egg-go');
    if (eggGo) eggGo.onclick = async () => {
      const D = window.Drop;
      if (!D || !D.grantEgg) { toast('❌ 蛋模块未就绪', ''); return; }
      const name = $('res-egg-name') && $('res-egg-name').value;
      const amt = Math.floor(num('res-egg-amt', 1));
      if (!name || !amt) return;
      const r = await D.grantEgg(name, amt);
      if (r && r.ok) { if (UI.renderAll) UI.renderAll(); toast('已发放蛋', name + ' ×' + amt); }
      else toast('❌ 发放失败', (r && r.error) || '');
    };
    const expGo = $('res-pet-exp-go');
    if (expGo) expGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      const amt = Math.floor(num('res-pet-exp', 0));
      if (!amt) return;
      if (window.Pet && window.Pet.grantExp) window.Pet.grantExp(p, amt);
      await savePet(p);
      if (UI.renderAll) UI.renderAll();
      toast('已加经验', '+' + amt + '（' + (p.name || '') + ' Lv.' + p.level + '）');
    };
    const lvGo = $('res-pet-lv-go');
    if (lvGo) lvGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      const max = Config.pet.maxLevel || 100;
      let lv = Math.floor(num('res-pet-lv', 1));
      lv = Math.max(1, Math.min(max, lv));
      p.level = lv; p.exp = 0;
      if (window.Pet && window.Pet.getStats) p.curHp = window.Pet.getStats(p).hp;
      await savePet(p);
      if (UI.renderAll) UI.renderAll();
      toast('已设等级', (p.name || '') + ' → Lv.' + lv);
    };
    const grGo = $('res-pet-gr-go');
    if (grGo) grGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      const max = Config.nirvana.maxGrowth || 100;
      const d = parseFloat($('res-pet-gr') && $('res-pet-gr').value) || 0;
      p.growth = Math.max(0, Math.min(max, (p.growth || 0) + d));
      if (window.Pet && window.Pet.getStats) p.curHp = window.Pet.getStats(p).hp;
      await savePet(p);
      if (UI.renderAll) UI.renderAll();
      toast('已加成长', (p.name || '') + ' 成长 → ' + p.growth.toFixed(1));
    };
  }
  async function savePet(p) {
    const S = window.Supabase;
    if (!S || !S.savePet) return;
    const { data, error } = await S.savePet(p);
    if (error) { if (UI.showToast) UI.showToast('⚠️ 云端存档失败', error.message || String(error)); return; }
    if (data && data.id) p.cloudId = data.id;
  }

  /* ============ Tab 3：掉落 / 战斗模拟器 ============ */
  function ensurePlotly(cb) {
    if (window.Plotly) return cb();
    if (document.querySelector('script[src*="plot.ly"]')) {
      const t = setInterval(() => { if (window.Plotly) { clearInterval(t); cb(); } }, 200);
      setTimeout(() => clearInterval(t), 10000);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.plot.ly/plotly-2.35.2.min.js';
    s.onload = cb; s.onerror = () => cb(); // 离线则走 SVG/文本回退
    document.head.appendChild(s);
  }
  // 按地图档位从野怪池挑一只代表怪（只取 level / eggBaseName 喂给真实掉落与经验公式）
  function buildSimEnemy(areaIdx) {
    const idx = areaIdx | 0;
    const tier = idx + 1;
    const band = tier <= 1 ? [1, 10] : tier === 2 ? [11, 20] : tier === 3 ? [21, 35] : [36, 100];
    const list = (window.EnemyData && window.EnemyData.list) || [];
    const pool = list.filter(e => e.level >= band[0] && e.level <= band[1]);
    const pick = pool.length ? pool[Math.floor(pool.length / 2)] : (list[0] || { eggBaseName: '腐噜兽', level: 6, enemyType: 'normal' });
    const level = Math.max(pick.level, (idx + 1) * 6);
    return { level, eggBaseName: pick.eggBaseName, enemyType: pick.enemyType };
  }
  function renderSimPanel() {
    const areaOpts = (Config.battle.areas || []).map((a, i) => '<option value="' + i + '">' + (a.name || a.id) + '（' + a.id + '）</option>').join('');
    const pet = (window.Pet && window.Pet.getActivePet) ? window.Pet.getActivePet() : null;
    const startLv = pet ? pet.level : 1;
    const startGr = (pet && typeof pet.growth === 'number') ? pet.growth.toFixed(1) : '5';
    const petOpts = ((Config.pet && Config.pet.starters) || []).map(ps => '<option value="' + ps.name + '"' + (ps.name === '腐噕兽' ? ' selected' : '') + '>' + (ps.icon || '') + ' ' + ps.name + '</option>').join('');
    return groupHtml('掉落 / 战斗模拟器',
      '<div class="dev-row"><div class="dev-row-head"><span class="dev-label">模拟地图</span></div>' +
        '<select class="dev-input" id="sim-area">' + areaOpts + '</select></div>' +
      '<div class="dev-row"><div class="dev-row-head"><span class="dev-label">场次 N</span></div>' +
        '<input class="dev-input" id="sim-n" type="number" min="1" max="200000" value="2000" style="width:120px"></div>' +
      '<div class="dev-inline">' +
        '<label class="dev-inline-label">起始等级<input class="dev-input" id="sim-lv" type="number" min="1" value="' + startLv + '" style="width:64px"></label>' +
        '<label class="dev-inline-label">成长<input class="dev-input" id="sim-gr" type="number" step="0.1" value="' + startGr + '" style="width:64px"></label>' +
        '<button class="btn-mini primary" id="sim-run">跑模拟</button>' +
      '</div>' +
      '<div class="dev-note">复用真实 rollReward（dry 无副作用）+ Pet.expFromBattle/grantExp，统计掉落分布与升级曲线</div>' +
      '<div id="sim-summary" class="dev-sim-summary"></div>' +
      '<div id="sim-charts"></div>') +
      '<section class="dev-group"><div class="dev-group-title">强度校验（裸装 / 自定义装备胜率）</div>' +
      '<div class="dev-note">选宠 + 成长 + 装备词条加成，扫图1-10 全部怪池【最差】胜率。穿装 &lt;85% 标红=卡脚；裸装 ≥60% 提示=装备价值弱。</div>' +
      '<div class="dev-inline">' +
        '<label class="dev-inline-label">宠物<select class="dev-input" id="chk-pet">' + petOpts + '</select></label>' +
        '<label class="dev-inline-label">成长<input class="dev-input" id="chk-growth" type="number" step="0.5" min="1" max="30" value="5.5" style="width:56px"></label>' +
        '<label class="dev-inline-label">场次<input class="dev-input" id="chk-n" type="number" min="500" max="10000" step="500" value="2000" style="width:64px"></label>' +
      '</div>' +
      '<div class="dev-note">装备词条（穿装档）：攻%/血%/防% 为乘法，速/命中/闪避/暴击/爆伤为加法。全 0 = 裸装。</div>' +
      '<div class="dev-inline">' +
        '<label class="dev-inline-label">攻+%<input class="dev-input" id="chk-atk" type="number" step="5" min="0" value="30" style="width:52px"></label>' +
        '<label class="dev-inline-label">血+%<input class="dev-input" id="chk-hp" type="number" step="5" min="0" value="8" style="width:52px"></label>' +
        '<label class="dev-inline-label">防+%<input class="dev-input" id="chk-def" type="number" step="5" min="0" value="15" style="width:52px"></label>' +
        '<label class="dev-inline-label">速+<input class="dev-input" id="chk-spd" type="number" min="0" value="0" style="width:52px"></label>' +
        '<label class="dev-inline-label">命中+<input class="dev-input" id="chk-hit" type="number" min="0" value="0" style="width:52px"></label>' +
        '<label class="dev-inline-label">闪避+<input class="dev-input" id="chk-dodge" type="number" min="0" value="0" style="width:52px"></label>' +
        '<label class="dev-inline-label">暴击+%<input class="dev-input" id="chk-crit" type="number" min="0" value="0" style="width:52px"></label>' +
        '<label class="dev-inline-label">爆伤+%<input class="dev-input" id="chk-cdmg" type="number" min="0" value="0" style="width:52px"></label>' +
        '<button class="btn-mini primary" id="chk-run">跑强度校验</button>' +
      '</div>' +
      '<div id="chk-result"></div>' +
      '</section>';
  }
  function bindSimPanel() {
    const body = $('dev-body'); if (!body) return;
    const toast = (t, d) => { if (UI.showToast) UI.showToast(t, d); };
    ensurePlotly(() => {}); // 进 Tab 就开始拉 plotly，跑的时候大概率已就绪；没拉到也有 SVG 回退
    const run = $('sim-run');
    if (run) run.onclick = async () => {
      const areaIdx = Number($('sim-area').value);
      const N = Math.max(1, Math.min(200000, Math.floor(Number($('sim-n').value) || 1)));
      const startLv = Math.max(1, Math.floor(Number($('sim-lv').value) || 1));
      const startGr = Number($('sim-gr').value) || 5;
      run.disabled = true; run.textContent = '模拟中…';
      try {
        const result = await runSim(areaIdx, N, startLv, startGr);
        renderSimResult(result);
      } catch (e) { toast('❌ 模拟出错', e && e.message); }
      finally { run.disabled = false; run.textContent = '跑模拟'; }
    };
    const chkRun = $('chk-run');
    if (chkRun) chkRun.onclick = () => runStrengthCheck();
  }
  async function runSim(areaIdx, N, startLv, startGr) {
    const Pet = window.Pet, Drop = window.Drop, Materials = window.Materials;
    const area = (Config.battle.areas || [])[areaIdx];
    if (!area) return null;
    const enemy = buildSimEnemy(areaIdx);
    const active = Pet.getActivePet();
    let pet;
    if (active) pet = JSON.parse(JSON.stringify(active));
    else pet = Pet.createPet('腐噜兽', '', startGr, 50, 20, 15, 55, '腐噜兽');
    pet.level = startLv; pet.exp = 0; pet.expPool = 0;
    // 防满级时 grantExp 顺手凝晶石污染 Materials：临时换成空操作（单线程，循环内无其他调用）
    const origGain = Materials.gain; Materials.gain = () => ({});
    const counts = { none: 0, material: 0, equipment: 0, egg: 0 };
    const mat = {}, egg = {};
    let totalExp = 0, levelUps = 0; const levelSeries = [];
    const step = Math.max(1, Math.floor(N / 200));
    try {
      for (let i = 0; i < N; i++) {
        const r = await Drop.rollReward(enemy, area, { dry: true });
        counts[r.type] = (counts[r.type] || 0) + 1;
        if (r.type === 'material') mat[r.material] = (mat[r.material] || 0) + (r.qty || 1);
        if (r.type === 'egg') egg[r.baseName] = (egg[r.baseName] || 0) + 1;
        const xp = Pet.expFromBattle(enemy, area);
        totalExp += xp;
        const before = pet.level;
        Pet.grantExp(pet, xp);
        if (pet.level > before) levelUps++;
        if (i % step === 0) levelSeries.push({ battle: i, level: pet.level });
      }
    } finally { Materials.gain = origGain; }
    levelSeries.push({ battle: N - 1, level: pet.level });
    return { counts, mat, egg, totalExp, finalLevel: pet.level, levelUps, levelSeries, N, area };
  }
  /* ---------- 强度校验：扫图1-10，三宠（均衡/重甲/极速）裸装·穿装最差胜率 ---------- */
  function getStrengthSimState(name) {
    const b = Config.battle || {};
    const pet = (Config.pet || {});
    const base = (pet.starters || []).filter(x => x.name === name)[0] || {};
    const prof = (pet.petProfiles && pet.petProfiles[name]) || pet.defaultPetProfile || {};
    const spd = (pet.speeds && pet.speeds[name]) || 80;
    const list = (window.EnemyData && window.EnemyData.list) || [];
    return { b: b, base: base, prof: prof, spd: spd, list: list };
  }
  function strengthPetStats(lv, growth, eq, st) {
    const C = st.base.statCoeff || { hp: 5, atk: 2, def: 1 };
    return {
      hp: Math.round((st.base.baseHp + Math.round(lv * growth * C.hp)) * (eq.hp || 1)),
      atk: Math.round((st.base.baseAtk + Math.round(lv * growth * C.atk)) * (eq.atk || 1)),
      def: Math.round((st.base.baseDef + Math.round(lv * growth * C.def)) * (eq.def || 1)),
      spd: st.spd, hit: st.prof.hit || 90, dodge: st.prof.dodge || 5,
      critRate: (st.prof.critRate || 8) / 100, critDamage: (st.prof.critDamage || 150) / 100, lifesteal: st.prof.lifesteal || 0
    };
  }
  function strengthEnemyStats(enemy, area, lv, st) {
    const b = st.b;
    const diff = area.difficulty || 1.0;
    const base = (b.areaEnemyStats && b.areaEnemyStats[area.id]) || { hp: 320, atk: 72, def: 30 };
    const tm = (area.enemyMult || (b.typeMult && b.typeMult[enemy.enemyType])) || 1.0;
    const lo = area.levelRange[0], hi = area.levelRange[1];
    const mid = (lo + hi) / 2;
    const clampCfg = b.levelScaleClamp || [0.25, 1.6];
    const ratio = Math.max(clampCfg[0], Math.min(clampCfg[1], lv / mid));
    const dodge = enemy.enemyType === 'mutant' ? 12 : enemy.enemyType === 'evolved' ? 8 : 5;
    return {
      hp: Math.round(base.hp * ratio * tm * diff),
      atk: Math.round(base.atk * ratio * tm * diff),
      def: Math.round(base.def * ratio * tm * diff),
      spd: enemy.spd || 50, hit: 90, dodge: dodge,
      critRate: b.critRate || 0.1, critDamage: b.critMultiplier || 1.5, lifesteal: 0
    };
  }
  function strengthHitChance(h, d) { return Math.max(0.05, Math.min(0.95, h / (h + d))); }
  function strengthFight(pet, enemy) {
    let pA = 0, eA = 0, php = pet.hp, ehp = enemy.hp, guard = 0;
    while (php > 0 && ehp > 0 && guard++ < 5000) {
      pA += pet.spd; eA += enemy.spd;
      const pR = pA >= 100, eR = eA >= 100;
      if (pR && eR) { if (pet.spd >= enemy.spd) { pA = 0; pTurn(); eA = 0; eTurn(); } else { eA = 0; eTurn(); pA = 0; pTurn(); } }
      else if (pR) { pA = 0; pTurn(); }
      else if (eR) { eA = 0; eTurn(); }
      if (php <= 0 || ehp <= 0) break;
    }
    return php > 0;
    function pTurn() {
      if (Math.random() < strengthHitChance(pet.hit, enemy.dodge)) {
        let dmg = Math.max(1, pet.atk - enemy.def);
        if (Math.random() < pet.critRate) dmg = Math.floor(dmg * pet.critDamage);
        ehp -= dmg;
        if (pet.lifesteal > 0) php = Math.min(pet.hp, php + Math.floor(dmg * pet.lifesteal));
      }
    }
    function eTurn() {
      if (Math.random() < strengthHitChance(enemy.hit, pet.dodge)) {
        let dmg = Math.max(1, enemy.atk - pet.def);
        if (Math.random() < enemy.critRate) dmg = Math.floor(dmg * enemy.critDamage);
        php -= dmg;
        if (enemy.lifesteal > 0) ehp = Math.min(enemy.hp, ehp + Math.floor(dmg * enemy.lifesteal));
      }
    }
  }
  function strengthWinRate(st, area, enemy, lv, growth, eq, N) {
    let wins = 0;
    const pet = strengthPetStats(lv, growth, eq, st);
    for (let i = 0; i < N; i++) {
      const es = strengthEnemyStats(enemy, area, lv, st);
      if (strengthFight(pet, es)) wins++;
    }
    return wins / N;
  }
  async function runStrengthCheck() {
    const out = $('chk-result'); if (!out) return;
    const growth = Number($('chk-growth').value) || 5.5;
    const N = Math.max(500, Math.min(10000, Math.floor(Number($('chk-n').value) || 2000)));
    const PECS = [
      { name: '腐噜兽', role: '均衡' },
      { name: '瘟熊', role: '重甲' },
      { name: '幽影兔', role: '极速' }
    ];
    const areas = (Config.battle.areas || []).filter(a => a.levelRange[1] <= 60);
    const eq = { hp: 1.08, atk: 1.3, def: 1.15 };   // 参考玩家：成长5.5 + 基础装备（config 设计口径）
    const bareEq = { hp: 1, atk: 1, def: 1 };
    out.innerHTML = '<div class="dev-note">校验中（成长 ' + growth + '，每怪 ' + N + ' 场，' + PECS.length + ' 只宠）…</div>';
    let rows = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px"><thead><tr>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #4a3f28">宠物</th>' +
      '<th style="padding:4px 6px;border-bottom:1px solid #4a3f28">裸装最差</th>' +
      '<th style="padding:4px 6px;border-bottom:1px solid #4a3f28">穿装最差</th>' +
      '<th style="padding:4px 6px;border-bottom:1px solid #4a3f28">判定</th></tr></thead><tbody>';
    let worstAll = 1, worstAllDesc = '';
    for (let pi = 0; pi < PECS.length; pi++) {
      const pec = PECS[pi];
      const st = getStrengthSimState(pec.name);
      if (!st.base.name) { rows += '<tr><td style="padding:4px 6px;text-align:left">' + pec.name + '</td><td colspan="3" style="padding:4px 6px;color:#f87171">未找到数据</td></tr>'; continue; }
      let gW = 1, gAt = '', bW = 1, bAt = '';
      for (let idx = 0; idx < areas.length; idx++) {
        const area = areas[idx];
        const enemies = (st.list || []).filter(en => (area.enemyIds || []).indexOf(en.id) >= 0 &&
          (en.levelRange ? en.levelRange[1] >= area.levelRange[0] && en.levelRange[0] <= area.levelRange[1] : (en.level || 1) >= area.levelRange[0] && (en.level || 1) <= area.levelRange[1]));
        if (!enemies.length) continue;
        const lvs = [area.levelRange[0], area.levelRange[1]];
        for (let ei = 0; ei < enemies.length; ei++) {
          for (let li = 0; li < lvs.length; li++) {
            const g = strengthWinRate(st, area, enemies[ei], lvs[li], growth, eq, N);
            const b = strengthWinRate(st, area, enemies[ei], lvs[li], growth, bareEq, N);
            if (g < gW) { gW = g; gAt = '图' + (idx + 1); }
            if (b < bW) { bW = b; bAt = '图' + (idx + 1); }
          }
        }
      }
      if (gW < worstAll) { worstAll = gW; worstAllDesc = pec.name + '（' + pec.role + '）@' + gAt; }
      const pct = x => (x * 100).toFixed(0) + '%';
      const status = gW >= 0.95 ? '稳过' : gW >= 0.85 ? '有挑战' : '卡脚';
      const color = gW >= 0.95 ? '#4ade80' : gW >= 0.85 ? '#facc15' : '#f87171';
      const note = bW >= 0.60 ? '⚠️ 裸装也能打，装备价值弱' : (bW < 0.30 ? '装备刚需' : '裸装会翻车');
      rows += '<tr><td style="padding:4px 6px;border-bottom:1px solid #2c2517;text-align:left">' + pec.name + '<span style="color:#8a7a5a;font-size:11px">（' + pec.role + ' spd' + st.spd + '）</span></td>' +
        '<td style="padding:4px 6px;border-bottom:1px solid #2c2517">' + pct(bW) + '</td>' +
        '<td style="padding:4px 6px;border-bottom:1px solid #2c2517;color:' + color + '">' + pct(gW) + '</td>' +
        '<td style="padding:4px 6px;border-bottom:1px solid #2c2517;color:' + color + '">' + status + '@' + gAt + ' · ' + note + '</td></tr>';
      await new Promise(r => setTimeout(r, 0));
      out.innerHTML = rows + '</tbody></table>' + '<div class="dev-note">已扫 ' + (pi + 1) + '/' + PECS.length + ' 宠…</div>';
    }
    rows += '</tbody></table>';
    const gColor = worstAll >= 0.95 ? '#4ade80' : worstAll >= 0.85 ? '#facc15' : '#f87171';
    out.innerHTML = rows + '<div style="margin-top:6px;font-size:12px;color:' + gColor + '">最危险宠物：' + worstAllDesc + ' 穿装胜率 ' + (worstAll * 100).toFixed(1) + '% — ' + (worstAll >= 0.95 ? '无卡脚' : worstAll >= 0.85 ? '有挑战但能过' : '存在卡脚，需下调怪强度') + '</div>';
  }
  function renderSimResult(res) {
    if (!res) return;
    const sum = $('sim-summary'); const charts = $('sim-charts');
    if (sum) {
      const estMs = res.N * (Number(Config.battle.nextFightDelay) || 0);
      const estMin = (estMs / 60000).toFixed(1);
      const pct = k => (res.counts[k] / res.N * 100).toFixed(1) + '%';
      sum.innerHTML =
        '<div class="dev-kv"><b>样本</b> ' + res.N + ' 场 · 地图 ' + (res.area.name || res.area.id) + '</div>' +
        '<div class="dev-kv">掉落：无 ' + res.counts.none + '(' + pct('none') + ') · 材料 ' + res.counts.material + '(' + pct('material') + ') · 装备 ' + res.counts.equipment + '(' + pct('equipment') + ') · 蛋 ' + res.counts.egg + '(' + pct('egg') + ')</div>' +
        '<div class="dev-kv">总经验 ' + res.totalExp + ' · 场均 ' + Math.round(res.totalExp / res.N) + ' · 升级 ' + res.levelUps + ' 次 · 终态 Lv.' + res.finalLevel + '</div>' +
        '<div class="dev-kv">预计耗时（按场间隔）≈ ' + estMin + ' 分钟（不含战斗演出）</div>';
    }
    if (charts) {
      charts.innerHTML = '';
      const c1 = barChart('sim-c1', ['无掉落', '材料', '装备', '蛋'], [res.counts.none, res.counts.material, res.counts.equipment, res.counts.egg], '掉落构成');
      const matEntries = Object.entries(res.mat).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const c2 = barChart('sim-c2', matEntries.map(e => e[0]), matEntries.map(e => e[1]), '材料分布（Top12）');
      const xs = res.levelSeries.map(p => p.battle), ys = res.levelSeries.map(p => p.level);
      const c3 = lineChart('sim-c3', xs, ys, '升级曲线（等级 vs 场次）');
      [c1, c2, c3].forEach(c => charts.appendChild(c));
      [c1, c2, c3].forEach(c => { if (c._plot) c._plot(); }); // 元素入 DOM 后再画，避免空白
    }
  }
  function barChart(divId, labels, values, title) {
    const el = document.createElement('div'); el.className = 'dev-chart'; el.id = divId;
    el._plot = () => {
      if (!window.Plotly) return;
      window.Plotly.newPlot(el, [{ x: labels, y: values, type: 'bar', marker: { color: '#b9893f' } }],
        { title: { text: title, font: { color: '#cbb994' } }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#cbb994' }, margin: { t: 34, b: 60, l: 44, r: 12 } }, { displayModeBar: false, responsive: true });
    };
    if (!window.Plotly) {
      const max = Math.max(1, ...values);
      el.innerHTML = '<div class="dev-chart-title">' + title + '</div>' + labels.map((l, i) =>
        '<div class="dev-bar-row"><span class="dev-bar-label">' + l + '</span><span class="dev-bar-track"><span class="dev-bar-fill" style="width:' + (values[i] / max * 100) + '%"></span></span><span class="dev-bar-val">' + values[i] + '</span></div>'
      ).join('');
    }
    return el;
  }
  function lineChart(divId, xs, ys, title) {
    const el = document.createElement('div'); el.className = 'dev-chart'; el.id = divId;
    el._plot = () => {
      if (!window.Plotly) return;
      window.Plotly.newPlot(el, [{ x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: '#b9893f' } }],
        { title: { text: title, font: { color: '#cbb994' } }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#cbb994' }, margin: { t: 34, b: 44, l: 44, r: 12 } }, { displayModeBar: false, responsive: true });
    };
    if (!window.Plotly) {
      el.innerHTML = '<div class="dev-chart-title">' + title + '</div><div class="dev-line-fallback">采样点：' + ys.map((y, i) => 'Lv' + y + '@' + xs[i]).join(' · ') + '</div>';
    }
    return el;
  }

  /* ============ Tab 4：养成快进 + 系统开关 ============ */
  function renderFastPanel() {
    const Pet = window.Pet, Evolve = window.Evolve, Drop = window.Drop, Equipment = window.Equipment;
    const active = (Pet && Pet.getActivePet) ? Pet.getActivePet() : null;
    const pets = (Pet && Pet.getPets) ? Pet.getPets() : [];
    const subOpts = pets.filter(p => !active || p.id !== active.id).map(p => '<option value="' + p.id + '">' + p.name + ' Lv.' + p.level + ' 成长' + (typeof p.growth === 'number' ? p.growth.toFixed(1) : '?') + '</option>').join('');
    const routes = (active && Evolve && Evolve.getEvolutionRoutes) ? Evolve.getEvolutionRoutes(active) : [];
    const routeOpts = routes.map((r, i) => '<option value="' + i + '">' + (r.label || r.to || ('路线' + (i + 1))) + '</option>').join('');
    let html = '';
    html += groupHtml('一键进化（免素材）',
      '<div class="dev-row"><div class="dev-row-head"><span class="dev-label">进化路线</span></div>' +
        '<select class="dev-input" id="fast-evo-route">' + (routeOpts || '<option value="0">（当前形态无可进化路线）</option>') + '</select></div>' +
      '<div class="dev-inline"><button class="btn-mini primary" id="fast-evo-go">进化</button>' +
        '<span class="dev-hint-inline">' + (active ? '当前：' + active.name + ' Lv.' + active.level : '未出战宠物') + '</span></div>');
    html += groupHtml('一键合成（免素材）',
      '<div class="dev-row"><div class="dev-row-head"><span class="dev-label">副素材宠</span></div>' +
        '<select class="dev-input" id="fast-sub">' + (subOpts || '<option value="">（无可用的副宠）</option>') + '</select></div>' +
      '<div class="dev-inline"><button class="btn-mini primary" id="fast-syn-go">合成</button></div>' +
      '<div class="dev-note">消耗合成材料（自动补发），出全新变异宠；两只素材宠消失</div>');
    html += groupHtml('一键涅槃（免素材）',
      '<div class="dev-inline">' +
        '<select class="dev-input" id="fast-sub2" style="flex:1">' + (subOpts || '<option value="">（无可用的副宠）</option>') + '</select>' +
        '<label class="dev-check"><input type="checkbox" id="fast-crystal"> 用凝魂晶石加成</label>' +
        '<button class="btn-mini primary" id="fast-nir-go">涅槃</button></div>' +
      '<div class="dev-note">消耗涅磐兽（自动补发）+ 可选晶石；副宠消失，主宠吸成长并重置等级</div>');
    html += groupHtml('结算明细',
      '<div class="dev-inline"><button class="btn-mini ghost" id="fast-detail-go">刷新明细</button></div>' +
      '<div id="fast-detail" class="dev-detail"></div>');
    html += groupHtml('清档 / 存档',
      '<div class="dev-actions-row">' +
        '<button class="btn-mini ghost" id="fast-clear">清空本地存档</button>' +
        '<button class="btn-mini primary" id="fast-export">导出存档(JSON)</button>' +
      '</div>' +
      '<div class="dev-inline" style="margin-top:8px"><input type="file" id="fast-import-file" accept="application/json" class="dev-file"></div>' +
      '<textarea id="fast-import-text" class="dev-export-text" placeholder="粘贴导出的存档 JSON，或选文件后点导入"></textarea>' +
      '<div class="dev-actions-row" style="margin-top:6px"><button class="btn-mini primary" id="fast-import">导入存档</button></div>' +
      '<div class="dev-note">清档=删本地宠物/材料/蛋/装备+删云端宠物（材料/蛋云端需手动清表）；导入会覆盖本地同名状态</div>');
    html += groupHtml('新手引导',
      '<div class="dev-actions-row">' +
        '<button class="btn-mini primary" id="dev-tour-replay">重播开场总览</button>' +
        '<button class="btn-mini ghost" id="dev-guide-reset">清除引导标记</button>' +
        '<button class="btn-mini ghost" id="dev-pet-dedupe">清理重复教学宠</button>' +
      '</div>' +
      '<div class="dev-note">重播=再放一次压暗聚光引导（战斗/宠物/打造/市集四站）；清除引导标记=删本账号的「看过开场/已开始/跳过/已领」标记并重置引导链，刷新后从 G1 重走（补给按库存补齐，不会重复）；清理重复教学宠=删掉云端里同名的教学副宠（如「泥沼从者」），只留最早一只</div>');
    return html;
  }
  function bindFastPanel() {
    const body = $('dev-body'); if (!body) return;
    const toast = (t, d) => { if (UI.showToast) UI.showToast(t, d); };
    const Pet = window.Pet, Evolve = window.Evolve, Merge = window.Merge, Materials = window.Materials, Drop = window.Drop, Equipment = window.Equipment, Supabase = window.Supabase;
    const needPet = () => {
      const p = Pet.getActivePet();
      if (!p) { toast('❌ 没有出战宠物', '先去宠物页选一只'); return null; }
      return p;
    };
    const isLoggedIn = async () => { const u = Supabase && await Supabase.getCurrentUser(); return !!u; };

    // 新手引导：重播开场总览 / 清除引导标记（反复验证引导链用）
    const tourBtn = $('dev-tour-replay');
    if (tourBtn) tourBtn.onclick = () => {
      if (window.UI && window.UI.replayOpeningTour) {
        window.UI.replayOpeningTour();
        toast('开场总览重播中', '跟着聚光走一遍：战斗 → 宠物 → 打造 → 市集');
      } else {
        toast('❌ 引导引擎未加载', '检查 js/ui/ui-onboarding.js 是否引入');
      }
    };
    const guideReset = $('dev-guide-reset');
    if (guideReset) guideReset.onclick = async () => {
      const u = (UI.getAuthUser && UI.getAuthUser()) || (Supabase && await Supabase.getCurrentUser());
      const who = String((u && (u.email || u.id)) || 'anon').replace(/[^a-zA-Z0-9@._-]/g, '');
      let n = 0;
      try {
        Object.keys(localStorage).forEach(k => {
          if (/^fos_(tour_seen|tutorial_started|guide_skipped|grants_done|blessing_given)/.test(k)
              && (k.indexOf(who) >= 0 || !/_[a-zA-Z0-9@._-]+$/.test(k.slice(k.indexOf('_', 4))))) {
            localStorage.removeItem(k); n++;
          }
        });
      } catch (e) { /* 忽略 */ }
      // 云端标记一并清（本地清+云端不清 = 换不了账号重走引导）
      if (window.Quest && window.Quest.setExtra) {
        try {
          const keys = ['tourSeen', 'tutorialStarted', 'guideSkipped', 'blessingGiven', 'packClaimed'];
          await Promise.all(keys.map(k => window.Quest.setExtra(k, null).catch(() => {})));
        } catch (e) { /* 忽略 */ }
      }
      // 引导链任务完成记录也重置（不清的话云端 completed 还在，G1 起不来）
      if (window.Quest && window.Quest.resetGuideChain) {
        try { window.Quest.resetGuideChain(); } catch (e) { console.warn('[dev] 重置引导链失败', e); }
      }
      toast('已清除 ' + n + ' 条引导标记（含云端）并重置引导链', '刷新页面后从 G1 重走（已发过的奖励不回收）');
    };
    // 清理重复教学副宠：配置 grants 里 type=pet 的名字，同名多只只留最早（云端 loadPets 按 created_at 升序，先到的在前）
    const petDedupe = $('dev-pet-dedupe');
    if (petDedupe) petDedupe.onclick = async () => {
      const T = (Config.tutorialMode && Config.tutorialMode.grants) || [];
      const names = T.filter(g => g.type === 'pet').map(g => g.name).filter(Boolean);
      const pets = (Pet.getPets && Pet.getPets()) || [];
      const seen = {};
      const toDel = [];
      pets.forEach(p => {
        if (!p || names.indexOf(p.name) < 0) return;
        const k = p.name;
        if (seen[k]) toDel.push(p); else seen[k] = 1;
      });
      if (!toDel.length) { toast('没有重复教学宠', '云端同名教学副宠只保留最早一只'); return; }
      if (!window.confirm('删除 ' + toDel.length + ' 只重复教学宠？（' + toDel.map(p => p.name).join('、') + '，保留最早一只）')) return;
      let ok = 0;
      for (const p of toDel) {
        if (p.cloudId && Supabase && Supabase.deletePet) {
          try { await Supabase.deletePet(p.cloudId); } catch (e) { console.warn('[dev] 删除云端重复宠失败', p.cloudId, e); continue; }
        }
        Pet.removePet(p.id);
        ok++;
      }
      if (UI.renderAll) UI.renderAll();
      toast('已清理 ' + ok + ' 只重复教学宠', '保留最早一只');
    };

    const evoGo = $('fast-evo-go');
    if (evoGo) evoGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      if (!(await isLoggedIn())) { toast('❌ 请先登录', '进化要同步云端'); return; }
      if (!p.cloudId) { toast('❌ 宠物未同步云端', '刷新页面后再试'); return; }
      const ri = Number($('fast-evo-route').value);
      const rm = Evolve.getRouteMaterial(p, ri);
      if (rm && rm.name) Materials.gain(rm.name, rm.amount || 1); // 免消耗：先补发所需素材
      const res = await Evolve.evolve(p.id, ri);
      if (res && res.error) { toast('❌ ' + res.error, ''); return; }
      await savePet(p); if (UI.renderAll) UI.renderAll();
      toast('已进化', p.name + ' 成长→' + (typeof p.growth === 'number' ? p.growth.toFixed(1) : '?'));
    };
    const synGo = $('fast-syn-go');
    if (synGo) synGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      const subId = $('fast-sub') && $('fast-sub').value; if (!subId) { toast('❌ 选副素材宠', ''); return; }
      if (!(await isLoggedIn())) { toast('❌ 请先登录', ''); return; }
      const S = Config.synthesize;
      Materials.gain(S.material.name, S.material.amount);
      const res = await Merge.synthesize(p.id, subId);
      if (res && res.error) { toast('❌ ' + res.error, ''); return; }
      if (UI.renderAll) UI.renderAll();
      toast(res && res.mutated ? '✨ 合成成功（变异！）' : '合成成功', (res && res.baby && res.baby.name) || '');
    };
    const nirGo = $('fast-nir-go');
    if (nirGo) nirGo.onclick = async () => {
      const p = needPet(); if (!p) return;
      const subId = $('fast-sub2') && $('fast-sub2').value; if (!subId) { toast('❌ 选副宠', ''); return; }
      if (!(await isLoggedIn())) { toast('❌ 请先登录', ''); return; }
      const M = Config.nirvana;
      Materials.gain(M.material.name, M.material.amount);
      const useC = $('fast-crystal') && $('fast-crystal').checked;
      if (useC && M.crystalBonus) Materials.gain(M.crystalBonus.material, M.crystalBonus.amount);
      const res = await Merge.nirvana(p.id, subId, useC);
      if (res && res.error) { toast('❌ ' + res.error, ''); return; }
      if (UI.renderAll) UI.renderAll();
      toast('涅槃完成', p.name + ' 成长→' + (typeof p.growth === 'number' ? p.growth.toFixed(1) : '?'));
    };
    const detailGo = $('fast-detail-go');
    if (detailGo) detailGo.onclick = () => renderDetail();
    const clearGo = $('fast-clear');
    if (clearGo) clearGo.onclick = () => devClearSave();
    const expGo = $('fast-export');
    if (expGo) expGo.onclick = () => devExportSave();
    const impGo = $('fast-import');
    if (impGo) impGo.onclick = () => devImportSave();
    const fileIn = $('fast-import-file');
    if (fileIn) fileIn.onchange = e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { const t = $('fast-import-text'); if (t) t.value = r.result; };
      r.readAsText(f);
    };
  }
  async function renderDetail() {
    const Pet = window.Pet, Materials = window.Materials, Drop = window.Drop, Equipment = window.Equipment, Supabase = window.Supabase;
    const box = $('fast-detail'); if (!box) return;
    const pets = (Pet.getPets && Pet.getPets()) || [];
    const mats = (Materials.getLocal && Materials.getLocal()) || {};
    const eggs = (Drop.getEggs && Drop.getEggs()) || {};
    const eqs = (Equipment.getInventory && Equipment.getInventory()) || [];
    const eqByR = {};
    eqs.forEach(e => { const r = (Equipment.rarityOf && Equipment.rarityOf(e)) || e.rarity || {}; const id = (r && r.id) || 'unknown'; eqByR[id] = (eqByR[id] || 0) + 1; });
    let html = '<div class="dev-kv"><b>宠物</b> ' + pets.length + ' 只：' + (pets.map(p => p.name + ' Lv.' + p.level + ' 成长' + (typeof p.growth === 'number' ? p.growth.toFixed(1) : '?')).join('、') || '无') + '</div>';
    html += '<div class="dev-kv"><b>材料</b> ' + (Object.keys(mats).length ? Object.entries(mats).map(([k, v]) => k + '×' + v).join('、') : '无') + '</div>';
    html += '<div class="dev-kv"><b>蛋</b> ' + (Object.keys(eggs).length ? Object.entries(eggs).map(([k, v]) => k + '×' + v).join('、') : '无') + '</div>';
    html += '<div class="dev-kv"><b>装备</b> ' + eqs.length + ' 件（' + (Object.entries(eqByR).map(([k, v]) => k + '×' + v).join('、') || '无') + '）</div>';
    let gemTxt = '';
    if (Supabase && Supabase.getMyWallet) { const w = await Supabase.getMyWallet(); gemTxt = ' · 魔石 ' + (w.gems != null ? w.gems : '?'); }
    html += '<div class="dev-kv"><b>账号</b>' + gemTxt + '</div>';
    box.innerHTML = html;
  }
  async function devClearSave() {
    const Pet = window.Pet, Materials = window.Materials, Drop = window.Drop, Equipment = window.Equipment, Supabase = window.Supabase;
    if (!window.confirm('清空本地存档？删除本地宠物/材料/蛋/装备，并删除云端宠物（材料/蛋云端需手动清表）。')) return;
    const pets = (Pet.getPets && Pet.getPets()) || [];
    for (const p of pets) { if (p.cloudId && Supabase && Supabase.deletePet) await Supabase.deletePet(p.cloudId); }
    Pet.clearPets();
    if (Materials.clearAll) await Materials.clearAll();
    if (Drop.clearEggs) Drop.clearEggs();
    if (Equipment.replaceInventory) Equipment.replaceInventory([]);
    if (UI.renderAll) UI.renderAll();
    if (UI.showToast) UI.showToast('已清空本地存档', '');
  }
  function devExportSave() {
    const Pet = window.Pet, Materials = window.Materials, Drop = window.Drop, Equipment = window.Equipment;
    const data = {
      version: 1, exportedAt: new Date().toISOString(),
      pets: (Pet.getPets && Pet.getPets()) || [],
      materials: (Materials.getLocal && Materials.getLocal()) || {},
      eggs: (Drop.getEggs && Drop.getEggs()) || {},
      equipment: (Equipment.getInventory && Equipment.getInventory()) || []
    };
    const text = JSON.stringify(data, null, 2);
    const ta = $('fast-import-text'); if (ta) ta.value = text;
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'forge-save-' + Date.now() + '.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { /* 下载失败无所谓，文本框已有内容 */ }
    if (UI.showToast) UI.showToast('已导出存档', '可下载或复制文本框 JSON');
  }
  async function devImportSave() {
    const Pet = window.Pet, Materials = window.Materials, Drop = window.Drop, Equipment = window.Equipment;
    const ta = $('fast-import-text');
    const text = ta && ta.value; if (!text) { if (UI.showToast) UI.showToast('❌ 先粘贴或选择存档', ''); return; }
    if (!window.confirm('导入会覆盖当前本地存档（宠物/材料/蛋/装备），继续？')) return;
    let data; try { data = JSON.parse(text); } catch (e) { if (UI.showToast) UI.showToast('❌ JSON 解析失败', ''); return; }
    try {
      if (data.materials) for (const [k, v] of Object.entries(data.materials)) Materials.gain(k, v);
      if (data.eggs && Drop.setEggs) Drop.setEggs(data.eggs);
      if (data.equipment && Equipment.replaceInventory) Equipment.replaceInventory(data.equipment);
      if (data.pets && Array.isArray(data.pets)) {
        Pet.clearPets();
        data.pets.forEach(p => Pet.addPet(p));
        if (data.pets[0] && Pet.setActive) Pet.setActive(data.pets[0].id);
      }
      if (UI.renderAll) UI.renderAll();
      if (UI.showToast) UI.showToast('导入完成', '');
    } catch (e) { if (UI.showToast) UI.showToast('❌ 导入出错', e && e.message); }
  }

  /* ============ Tab 5：玩家管理（后台） ============ */
  function renderPlayerPanel() {
    return groupHtml('玩家管理',
      '<div class="dev-row">' +
        '<div class="dev-inline">' +
          '<input class="dev-input" id="ply-search" type="text" placeholder="按昵称或邮箱搜索" style="flex:1">' +
          '<button class="btn-mini primary" id="ply-search-go">搜索</button>' +
          '<button class="btn-mini ghost" id="ply-refresh">刷新</button>' +
        '</div>' +
        '<div class="dev-note">数据来自 admin_list_users / admin_search_users / admin_ban_user / grant_gems / admin_delete_user，仅管理员邮箱可调用。删除=级联清空该账号全部云端数据并删号，不可恢复，管理员主号不可删</div>' +
      '</div>' +
      '<div id="ply-list" class="dev-detail"></div>');
  }
  function bindPlayerPanel() {
    const body = $('dev-body'); if (!body) return;
    const searchGo = $('ply-search-go');
    if (searchGo) searchGo.onclick = () => loadPlayers(($('ply-search') && $('ply-search').value) || '');
    const refresh = $('ply-refresh');
    if (refresh) refresh.onclick = () => loadPlayers('');
    loadPlayers('');
  }
  async function loadPlayers(q) {
    const listEl = $('ply-list'); if (!listEl) return;
    listEl.innerHTML = '<div class="dev-kv">加载中…</div>';
    const S = window.Supabase;
    if (!S || !S.getClient) { listEl.innerHTML = '<div class="dev-kv warn">Supabase 未就绪</div>'; return; }
    try {
      const client = S.getClient();
      const { data, error } = q
        ? await client.rpc('admin_search_users', { q })
        : await client.rpc('admin_list_users');
      if (error) { listEl.innerHTML = '<div class="dev-kv warn">RPC 错误：' + (error.message || String(error)) + '</div>'; return; }
      if (!data || !data.length) { listEl.innerHTML = '<div class="dev-kv">无玩家数据' + (q ? '（未匹配「' + q + '」）' : '') + '</div>'; return; }
      listEl.innerHTML = data.map(playerRow).join('');
      listEl.querySelectorAll('[data-act]').forEach(btn => { btn.onclick = () => playerAct(btn, client); });
    } catch (e) { listEl.innerHTML = '<div class="dev-kv warn">加载失败：' + (e && e.message) + '</div>'; }
  }
  function playerRow(u) {
    const fmt = t => { if (!t) return '—'; try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(t); } };
    const safe = v => String(v == null ? '' : v).replace(/"/g, '&quot;');
    const label = safe(u.nickname || u.email || '?');
    // 删除按钮：管理员主号与「当前登录的自己」都不给删（后端另有 protected/self 兜底），防手滑
    const me = (UI.getAuthUser && UI.getAuthUser()) || {};
    const isAdminRow = !!(u.email && ADMIN.indexOf(u.email) >= 0);
    const isMe = !!(me.id && u.id === me.id);
    const delHtml = (isAdminRow || isMe)
      ? '<button class="btn-mini danger" disabled title="' + (isAdminRow ? '管理员主账号不可删除' : '当前登录账号不能在这里删除') + '">删除</button>'
      : '<button class="btn-mini danger" data-act="del" data-uid="' + u.id + '" data-name="' + label + '">删除</button>';
    return '<div class="dev-player-row">' +
      '<div class="dev-player-main"><span class="dev-player-name">' + label + '</span>' +
        '<span class="dev-player-mail">' + safe(u.email || '') + '</span></div>' +
      '<div class="dev-player-sub">注册 ' + fmt(u.created_at) + ' · 在线 ' + fmt(u.last_seen_at) + '</div>' +
      '<div class="dev-player-ops">' +
        '<span class="dev-val">' + (u.gems != null ? u.gems : 0) + ' 魔石</span>' +
        (u.banned ? '<span class="dev-banned">已封禁</span>' : '') +
        '<button class="btn-mini primary" data-act="gem" data-uid="' + u.id + '" data-name="' + label + '">发魔石</button>' +
        '<button class="btn-mini ghost" data-act="' + (u.banned ? 'unban' : 'ban') + '" data-uid="' + u.id + '" data-name="' + label + '">' + (u.banned ? '解封' : '封禁') + '</button>' +
        delHtml +
      '</div></div>';
  }
  async function playerAct(btn, client) {
    const toast = (t, d) => { if (UI.showToast) UI.showToast(t, d); };
    const uid = btn.dataset.uid, act = btn.dataset.act, name = btn.dataset.name || '?';
    if (act === 'del') {
      // 删号是重操作：两次确认（防手滑），确认文案写明清档范围与重注册提示
      if (!window.confirm('⚠️ 删除账号「' + name + '」？\n将清空该账号全部云端数据（宠物/装备/材料/蛋/挂单/交易记录/任务进度/钱包），并删除账号。此操作不可恢复！')) return;
      if (!window.confirm('再次确认：删除后该邮箱可重新注册新号，重新体验新手引导。仍要删除？')) return;
      btn.disabled = true;
      const { data: rd, error: re } = await client.rpc('admin_delete_user', { p_user_id: uid });
      const res = (typeof rd === 'string') ? rd : (re ? 'error' : 'ok');
      if (res === 'ok') {
        toast('已删除账号', name + ' 的全部云端数据已清空，可重新注册新号体验新手引导');
        // 删除的是当前登录账号（正常不会走到：dev 面板仅管理员可见，管理员号 SQL 拒删）：
        // 兜底清本地 fos_* 并刷新，由启动流程自然回登录页
        const me = UI.getAuthUser && UI.getAuthUser();
        if (me && me.id && me.id === uid) {
          try {
            if (window.Game && window.Game.onLogout) { await window.Game.onLogout(); }
            else if (window.Supabase && window.Supabase.signOut) { await window.Supabase.signOut(); }
          } catch (e) { console.warn('[dev] 删除当前号登出失败', e); }
          try { Object.keys(localStorage).forEach(k => { if (k.indexOf('fos_') === 0) localStorage.removeItem(k); }); } catch (e) { /* 忽略 */ }
          location.reload();
          return;
        }
      }
      else if (res === 'forbidden') toast('无权限', '仅管理员邮箱可删号');
      else if (res === 'protected') toast('不可删除', '管理员主账号受保护');
      else if (res === 'self') toast('不可删除', '不能删除当前登录账号');
      else if (res === 'notfound') toast('账号不存在', '可能已被删除');
      else if (re) toast('删除失败', re.message || String(re));
      else toast('删除失败', String(rd || '未知返回'));
      btn.disabled = false;
      loadPlayers('');
      return;
    }
    if (act === 'gem') {
      const amt = window.prompt('给 ' + name + ' 发魔石（数量）', '100');
      if (amt == null) return;
      const n = Math.floor(Number(amt));
      if (!Number.isFinite(n) || n <= 0) { toast('数量无效', ''); return; }
      const { data: rd, error: re } = await client.rpc('grant_gems', { p_user_id: uid, p_amount: n, p_reason: 'admin-panel' });
      const res = (typeof rd === 'string') ? rd : (re ? 'error' : 'ok');
      if (res === 'ok') toast('已发放', name + ' +' + n + ' 魔石');
      else if (res === 'forbidden') toast('无权限', '仅管理员邮箱可发魔石');
      else if (re) toast('发放失败', re.message || String(re));
      else toast('发放失败', '未知返回');
      loadPlayers('');
    } else {
      const ban = act === 'ban';
      if (!window.confirm((ban ? '封禁' : '解封') + ' ' + name + '？')) return;
      const { data: rd, error: re } = await client.rpc('admin_ban_user', { uid, ban, reason: ban ? '管理员操作' : null });
      if (rd === 'ok') toast(ban ? '已封禁' : '已解封', name);
      else if (rd === 'forbidden') toast('无权限', '');
      else if (re) toast('操作失败', re.message || String(re));
      else toast('操作失败', String(rd || ''));
      loadPlayers('');
    }
  }

  /* ============ Tab 6：运营数据（后台） ============ */
  function renderStatsPanel() {
    return groupHtml('运营数据',
      '<div class="dev-inline"><button class="btn-mini primary" id="stats-refresh">刷新数据</button>' +
        '<span class="dev-hint-inline">admin_stats()：总用户 / 今日新增 / 7日活跃 / 1日活跃 / 封禁 / 魔石流通 / 魔石发放 / 订单 / 商品</span></div>' +
      '<div id="stats-grid" class="dev-stat-grid"></div>');
  }
  function bindStatsPanel() {
    const refresh = $('stats-refresh');
    if (refresh) refresh.onclick = loadStats;
    loadStats();
  }
  async function loadStats() {
    const grid = $('stats-grid'); if (!grid) return;
    grid.innerHTML = '<div class="dev-kv">加载中…</div>';
    const S = window.Supabase;
    if (!S || !S.getClient) { grid.innerHTML = '<div class="dev-kv warn">Supabase 未就绪</div>'; return; }
    try {
      const { data, error } = await S.getClient().rpc('admin_stats');
      if (error) { grid.innerHTML = '<div class="dev-kv warn">RPC 错误：' + (error.message || String(error)) + '</div>'; return; }
      const s = data && data[0];
      if (!s) { grid.innerHTML = '<div class="dev-kv">无数据（可能未执行 migrate_admin_tools.sql 或权限不足）</div>'; return; }
      const items = [
        ['总用户', s.total_users], ['今日新增', s.today_new],
        ['7日活跃', s.active_7d], ['1日活跃', s.active_1d],
        ['封禁数', s.banned_count],
        ['魔石流通', s.total_gems_in_circulation], ['魔石发放', s.total_gems_granted],
        ['订单数', s.orders_count], ['在售商品', s.products_count]
      ];
      grid.innerHTML = items.map(([k, v]) =>
        '<div class="dev-stat-card"><div class="dev-stat-num">' + (v == null ? '—' : v) + '</div><div class="dev-stat-label">' + k + '</div></div>'
      ).join('');
    } catch (e) { grid.innerHTML = '<div class="dev-kv warn">加载失败：' + (e && e.message) + '</div>'; }
  }

  /* ---------- 渲染与 Tab 切换 ---------- */
  function renderBody() {
    const body = $('dev-body');
    if (!body) return;
    let html = tabBarHtml();
    const panels = { tune: renderTunePanel, res: renderResourcePanel, sim: renderSimPanel, fast: renderFastPanel, player: renderPlayerPanel, stats: renderStatsPanel };
    html += (panels[activeTab] || renderTunePanel)();
    body.innerHTML = html;
    body.querySelectorAll('.dev-tab').forEach(t => {
      t.onclick = () => { activeTab = t.dataset.tab; renderBody(); };
    });
    const binders = { tune: bindTunePanel, res: bindResourcePanel, sim: bindSimPanel, fast: bindFastPanel, player: bindPlayerPanel, stats: bindStatsPanel };
    (binders[activeTab] || bindTunePanel)();
  }

  /* ---------- 抽屉开关 ---------- */
  function openDevPanel() {
    if (!isAdmin()) return;
    snapshotAreas();
    renderBody();
    const h = $('dev-panel');
    if (!h) return;
    h.style.display = 'block';
    requestAnimationFrame(() => h.classList.add('is-open'));
  }
  function closeDevPanel() {
    const h = $('dev-panel');
    if (!h) return;
    h.classList.remove('is-open');
    setTimeout(() => { if (!h.classList.contains('is-open')) h.style.display = 'none'; }, 300);
  }

  /* ---------- 入口可见性（仅管理员） ---------- */
  function refreshDevEntry() {
    const btn = $('btn-dev-sidebar');
    if (!btn) return;
    btn.style.display = isAdmin() ? '' : 'none';
  }

  /* ---------- 初始化 ---------- */
  function initDev() {
    if (!UI || !Config) return;
    const _onAuth = UI.onAuthChange;
    UI.onAuthChange = function (logged) {
      if (_onAuth) _onAuth(logged);
      refreshDevEntry();
    };
    const btn = $('btn-dev-sidebar');
    if (btn) btn.onclick = openDevPanel;
    const scrim = $('dev-scrim'); if (scrim) scrim.onclick = closeDevPanel;
    const cancel = $('dev-cancel'); if (cancel) cancel.onclick = closeDevPanel;
    refreshDevEntry();
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', initDev);
  }
})();
