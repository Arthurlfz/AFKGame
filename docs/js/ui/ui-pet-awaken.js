/* ============================================================
 * ui-pet-awaken.js —— 宠物页「觉醒」tab（2026-09-10 v2 觉醒改版）
 * 觉醒 = 永久标记（pet.awakened）：宠物页用「觉醒石」激活，与等级无关，
 *       涅槃/转生不清除。觉醒加成 = 主动技能伤害+20% + 血统线定位加成（Config.awakenBonus）。
 * 觉醒石来源：任务「觉醒之路」（图 1~10 区域材料 ×888 求和，可反复交）。
 * 门槛：必须是终形态（名字在 activeSkills 表 / 神级宠查对应线终形态）——
 *       觉醒加成挂在主动技能上，非终形态宠没有技能，觉醒无意义。
 * 落盘：pets.awaken_trait = '1'（复用旧列，缺列时 savePet 容错剔除）。
 * ============================================================ */
(function () {
  'use strict';
  const UI = window.UI;
  const { escapeHtml, showToast, addLog } = UI;
  const Config = window.Config;
  const Materials = window.Materials;
  const PetSprites = window.PetSprites;
  const PetUI = window.PetUI || {};
  const iconHtml = PetUI.iconHtml || (n => escapeHtml(n));

  const STONE = '觉醒石';
  let awakenMainId = null;
  let inFlight = false;   // 觉醒提交闸门（连点防重入）

  /* 觉醒目标技能：与 pet.js getAwakenState 同一套名字解析（变异剥后缀 / 神级宠查 sprite 名） */
  function awakenTargetSkill(pet) {
    const skills = (Config.pet && Config.pet.evolution && Config.pet.evolution.activeSkills) || {};
    let base = String(pet.name || '').replace(/·异变$/, '');
    if (window.Pet.isGodPet && window.Pet.isGodPet(pet)) {
      const sp = window.Pet.spriteNameOf ? window.Pet.spriteNameOf(pet) : null;
      if (sp) base = sp;
    }
    return skills[base] || null;
  }

  /* 觉醒任务（觉醒之路）进度：10 种区域材料每种 888，取最短板 */
  function awakenQuestInfo() {
    const q = (Config.drop.quests || []).find(x => x.id === 'awaken_road');
    if (!q || !Array.isArray(q.matList)) return null;
    const have = q.matList.reduce((min, n) => Math.min(min, Materials.getQuantity(n)), Infinity) || 0;
    return { need: q.need, have, matList: q.matList, done: have >= q.need };
  }

  function petList() {
    return (window.Pet.getPets ? window.Pet.getPets() : []).filter(p => p.awakened || awakenTargetSkill(p));
  }

  /* 材料 → 出产地图名（觉醒之路要的是"图 1~10 各一种区域材料"，
   * 玩家真正需要知道的是"去哪张图刷"，所以列表上要给出地图名 —— 从 config 反查，不在页面里写死。 */
  function areaOfMaterial(name) {
    const D = Config.drop || {};
    const AM = D.areaMaterials || {};
    const AREAS = D.areas || [];
    for (const id in AM) {
      if (AM[id] && AM[id].name === name) {
        const a = AREAS.find(x => x.id === id);
        return a ? a.name : '';
      }
    }
    return '';
  }
  /* 10 种材料各自的进度网格（V2 §5-2：5 列 × 2 行，每格 = 图标 + 名称 + 进度条 + 数字）。
   * 原来只有一句"每种 2 / 100"取最短板，玩家看不出差在哪一格、也不知道去哪刷。 */
  function questMatGridHtml(quest) {
    if (!quest) return '<div class="lg-empty-hint">任务「觉醒之路」未配置</div>';
    const ICONS = (window.UI && window.UI.MAT_ICONS) || {};
    return '<div class="lg-mats5">' + quest.matList.map(n => {
      const have = Number(Materials.getQuantity(n)) || 0;
      const area = areaOfMaterial(n);
      const ok = have >= quest.need;
      return '<div class="lg-mat' + (ok ? ' is-ok' : '') + '" title="' + (area ? area + ' 掉落' : '') + '">'
        + '<div class="lg-mat-top"><span class="lg-mat-ico">' + (ICONS[n] || '') + '</span>'
        +   '<span class="lg-mat-name">' + escapeHtml(n) + '</span></div>'
        + PetUI.barHtml(have, quest.need, ok ? 'is-ok' : '')
        + '<span class="lg-mat-num">' + PetUI.fmtNum(have) + ' / ' + PetUI.fmtNum(quest.need) + (area ? ' · ' + escapeHtml(area) : '') + '</span>'
        + '</div>';
    }).join('') + '</div>';
  }
  // 总进度 / 最短板两行（V2 §5-3）在 V3 收尾时删掉：
  //   ① 「最短板」的数字与下面任务条里的「觉醒之路 · 任务进度」是**同一个数**（间隔不到 100px）；
  //   ② 「总进度」（十种材料求和）不是任务的完成判据，摆出来只会让玩家以为"凑个总数也行"。
  //   ⇒ 这里只留一句规则说明（§4：同一信息全页最多两处 / 规则类不进正文）。
  function questTotalHtml(quest) {
    if (!quest) return '';
    return '<div class="quest-total-hint">任务按「每一种都够」判定，看的是最短板 —— 数字在下面任务条里</div>';
  }
  function syncAwakenSteps(pet, skill, aw, stoneHave) {
    PetUI.stepsInto(document.getElementById('awaken-steps'), [
      { label: '选魂兽', state: pet ? 'done' : 'cur' },
      { label: '凑齐觉醒石', state: !pet ? 'todo' : (stoneHave >= 1 ? 'done' : 'cur') },
      { label: '确认觉醒', state: (pet && skill && !aw && stoneHave >= 1) ? 'cur' : 'todo' }
    ]);
  }
  /* 底部 CTA 栏（V3 §6：四页同位置/同尺寸/同样式）。
   * 按钮**常驻**（不可用时置灰），原因排在按钮左边 —— 原来是 `cb.innerHTML = ''` 直接消失。 */
  function renderAwakenCtaIdle(why) {
    const cb = document.getElementById('awaken-confirm');
    if (!cb) return;
    cb.innerHTML = (why ? '<div class="lg-cta-why is-bad">' + escapeHtml(why) + '</div>' : '')
      + '<button type="button" class="lg-cta" id="btn-awaken-go" disabled>确认觉醒</button>';
  }

  /* ---------- 渲染 ---------- */
  function renderAwakenTab() {
    const list = document.getElementById('awaken-pet-list');
    const detail = document.getElementById('awaken-detail');
    if (!list || !detail) return;

    /* 左：魂兽名录 —— 统一卡片（5 个 tab 同一套）。
     * **列出全部宠物**：没到终形态 / 已觉醒的置灰 + 写明原因，玩家一眼看出自己离觉醒差什么。 */
    const all = (window.Pet.getPets ? window.Pet.getPets() : []);
    PetUI.renderList(list, all, {
      selectedId: awakenMainId,
      lockOf: (p) => {
        if (p.awakened) return '已觉醒 · 永久生效（不用再点）';
        if (!awakenTargetSkill(p)) return '还没到终形态 · 先在「进化」页进化到终阶';
        return null;
      },
      extraOf: (p) => (p.awakened ? '<span class="lg-on">已觉醒 · 永久生效</span>' : ''),
      onPick: (p) => { awakenMainId = p.id; UI.renderAll(); },
      emptyHtml: '还没有宠物：先去「背包 · 素材蛋」孵化一只'
    });

    /* 右：觉醒详情 */
    const pet = all.find(p => p.id === awakenMainId) || null;
    const stoneHave = Materials.getQuantity(STONE);
    const quest = awakenQuestInfo();
    const pct = Math.round((Config.awakenSkillDamage != null ? Config.awakenSkillDamage : 0.2) * 100);
    // 底部 CTA 栏里的按钮容器（V2 §5-4：CTA 与其它三个 tab 同栏）
    const cb = document.getElementById('awaken-confirm');
    if (cb) cb.innerHTML = '';

    /* 没选宠：画三步图解 + 石头来源（原来是「← 先在左侧选一只魂兽」一行字，等于空白）。 */
    if (!pet) {
      detail.innerHTML = '<div class="lg-box">'
        + '<div class="lg-head">觉醒 · 三步</div>'
        + '<div class="lg-flow">'
        +   '<div><div class="fh">选魂兽</div><div class="fd">必须已经是<b>终形态</b>（Lv60 那一阶）</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">凑觉醒石 ×1</div><div class="fd">交任务「觉醒之路」可得，可反复交</div></div>'
        +   '<span class="lg-arrow">→</span>'
        +   '<div><div class="fh">永久觉醒</div><div class="fd">主动技能伤害 +' + pct + '%，涅槃/转生都清不掉</div></div>'
        + '</div>'
        + '<div class="lg-warn lg-warn--calm">' + escapeHtml((UI.petTabGate && UI.petTabGate('awaken')) || '还差：终形态魂兽 + 觉醒石') + '</div>'
        + '</div>';
      syncAwakenSteps(null, null, null, stoneHave);
      renderAwakenCtaIdle('先在左侧选一只魂兽');
      return;
    }

    const skill = awakenTargetSkill(pet);
    const aw = window.Pet.getAwakenState ? window.Pet.getAwakenState(pet) : null;
    const STAT_CN = { hp: '生命', atk: '攻击', def: '防御', spd: '速度', crit: '暴击率', critDamage: '暴击伤害', hit: '命中', dodge: '闪避', lifesteal: '吸血', pen: '穿透', dmgBonus: '伤害加成', dr: '受伤减免' };
    const bonusTxt = (aw && aw.bonus && aw.bonus.stat != null)
      ? (STAT_CN[aw.bonus.stat] || aw.bonus.stat) + '+' + aw.bonus.value + (aw.bonus.stat === 'spd' ? '' : '%') : '';
    /* 核心收益做视觉焦点（技能图标 + 大字 +20%）——这是玩家做这一整套的唯一理由，不该埋在小字里。 */
    const focusCard = (skillName, lvTxt, isDone) => '<div class="lg-focus">'
      + '<div class="fi">✦</div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div class="fk">' + (isDone ? '已激活 · 永久生效' : '觉醒后 · 永久生效') + '</div>'
      +   '<div class="fv">' + escapeHtml(skillName || '主动技能') + '</div>'
      +   '<div class="hint" style="font-size:var(--fs-2xs)">' + escapeHtml(lvTxt || '') + '</div>'
      + '</div>'
      + '<div class="fg">+' + pct + '%</div>'
      + '</div>';

    /* 已觉醒：状态卡（永久生效的收益摆最上面） */
    if (aw) {
      detail.innerHTML = focusCard(aw.skillName, pet.name + ' · Lv.' + pet.level + ' · 涅槃 / 转生都不会清掉', true)
        + '<div class="preview-bar" style="margin-top:8px">'
        +   '<div class="pv"><div class="k">状态</div><div class="v"><span class="awaken-badge">已觉醒 · 永久</span></div></div>'
        +   '<div class="pv"><div class="k">技能伤害</div><div class="v">+' + Math.round((aw.damage || 0) * 100) + '%</div></div>'
        +   (bonusTxt ? '<div class="pv"><div class="k">血统加成</div><div class="v">' + escapeHtml(bonusTxt) + '</div></div>' : '')
        + '</div>'
        + detailsHtml();
      syncAwakenSteps(pet, skill, aw, stoneHave);
      renderAwakenCtaIdle('这只已经觉醒过了 · 永久生效，不用再点');
      return;
    }

    /* 未到终形态：说明 + 去进化（一个按钮，不是一行字） */
    if (!skill) {
      detail.innerHTML = '<div class="lg-box">'
        + '<div class="lg-head">为什么不能觉醒</div>'
        + '<div><b>' + escapeHtml(pet.name) + '</b> 还没到终形态 —— 觉醒加成挂在主动技能上，非终形态的宠物没有技能，觉醒了也没用。</div>'
        + '<div class="lg-warn lg-warn--calm">终形态 = Lv.60 的那一阶（5 阶走完），去「进化」页进化到终阶再回来</div>'
        + '<div class="pn-actions"><button type="button" class="lg-cta lg-cta--ghost" id="btn-awaken-to-evolve">去进化 →</button></div>'
        + '</div>';
      const toEvolve = document.getElementById('btn-awaken-to-evolve');
      if (toEvolve) toEvolve.onclick = () => {
        const tab = document.querySelector('.pet-tab[data-pet-tab="evolve"]');
        if (tab) tab.click();
      };
      syncAwakenSteps(pet, skill, aw, stoneHave);
      renderAwakenCtaIdle('还没到终形态 · 先在「进化」页练到终阶');
      return;
    }

    /* 可觉醒（V2 §5 右区四块）：
     * ① 焦点卡 160px（收益）   ② 材料进度网格 5×2   ③ 觉醒之路任务条（大按钮）   ④ 详细规则折叠
     * CTA「确认觉醒」不在这里 —— 在底部 CTA 栏（与其它三页同位置）。 */
    const canDo = stoneHave >= 1;
    const questNeed = quest ? quest.need : 0;
    const questLine = quest
      ? '<button type="button" class="lg-cta" id="btn-awaken-quest">去做「觉醒之路」任务 →</button>'
      : '<div class="lg-warn lg-warn--calm">任务「觉醒之路」未配置</div>';
    /* V3 §4 文字减负：这句原来是手拼的（"从 X% 概率打出 Y% 伤害 · 提升 +Z%"），
     * 改读 PetUI.skillEffectLine（**技能效果的唯一一处拼法**，进化页也在用）。 */
    detail.innerHTML = focusCard(skill.name, '觉醒后 ' + (PetUI.skillEffectLine ? PetUI.skillEffectLine(skill) : ''), false)
      + '<div class="preview-bar">'
      +   '<div class="pv"><div class="k">觉醒石</div><div class="v">' + PetUI.fmtNum(stoneHave) + ' / 1<small>' + (canDo ? '可以觉醒' : '还缺 1 颗') + '</small></div></div>'
      +   (bonusTxt ? '<div class="pv"><div class="k">觉醒后血统加成</div><div class="v">' + escapeHtml(bonusTxt) + '</div></div>' : '')
      + '</div>'
      + '<div><div class="lg-head">觉醒石怎么来 · 材料进度'
      +   '<span class="hint">图 1~10 的区域材料各 ' + PetUI.fmtNum(questNeed) + ' 个，可反复交</span></div>'
      +   questMatGridHtml(quest)
      +   questTotalHtml(quest) + '</div>'
      + '<div class="lg-taskbar">'
      +   '<div class="lg-taskbar-info"><div class="k">觉醒之路 · 任务进度</div>'
      +     '<div class="v">' + PetUI.fmtNum(quest ? quest.have : 0) + ' / ' + PetUI.fmtNum(questNeed) + '</div></div>'
      +   questLine
      + '</div>'
      + detailsHtml();
    const qBtn = document.getElementById('btn-awaken-quest');
    if (qBtn) {
      qBtn.onclick = () => {
        // 直接打开任务面板并定位到「觉醒之路」（openQuestPanel 支持传任务 id）
        if (UI.openQuestPanel) UI.openQuestPanel('awaken_road');
      };
    }
    syncAwakenSteps(pet, skill, aw, stoneHave);
    if (cb) {
      /* V3 §6：原因排在按钮左边；按钮文案与另外三页同构（「确认 XX」）——
       * 宠物名在这页出现了五六处，再塞进按钮只会把它撑长、还挤掉"确认"这个动作词。 */
      cb.innerHTML = (canDo ? '' : '<div class="lg-cta-why is-bad">缺少' + STONE + '：先去交任务「觉醒之路」</div>')
        + '<button type="button" class="lg-cta" id="btn-awaken-go"' + (canDo ? '' : ' disabled') + '>'
        + '确认觉醒（消耗 ' + STONE + ' ×1）</button>';
    }
    const go = cb ? cb.querySelector('#btn-awaken-go') : null;
    if (go) {
      go.disabled = !canDo;
      go.onclick = () => {
        if (!canDo) { showToast('无法觉醒', '还缺 1 颗' + STONE); return; }
        // 消耗 1 颗觉醒石且不返还 —— 按项目的不可逆操作口径，先确认再执行
        PetUI.confirmIrreversible({
          title: '✦ 确认觉醒',
          okLabel: '确认觉醒',
          fallbackText: '确认觉醒？会消耗 1 颗' + STONE + '（不返还）。',
          bodyHtml: '<div class="salvage-detail">'
            + '<div>魂兽：<b>' + escapeHtml(pet.name) + '</b>（Lv.' + pet.level + '）</div>'
            + '<div>消耗：<b>' + STONE + ' ×1</b>（持有 ' + stoneHave + '）</div>'
            + '<div>结果：<b>' + escapeHtml(skill.name) + '</b> 伤害 <b>+' + pct + '%</b>，永久生效</div>'
            + (bonusTxt ? '<div>同时获得血统加成：<b>' + escapeHtml(bonusTxt) + '</b></div>' : '')
            + '<div class="salvage-warn">' + STONE + ' 消耗后不返还（觉醒本身永久保留，涅槃 / 转生都不会清掉）。</div>'
            + '</div>',
          onOk: () => doAwaken(pet, go)
        });
      };
    }
  }

  // 详细规则：默认收起（规则说明不该占屏幕；要看的人点一下就有）
  function detailsHtml() {
    return '<details class="lg-details"><summary>详细规则</summary><div class="lg-doc">'
      + '<div>· 觉醒<b>永久生效</b>：涅槃 / 转生都不会清除，等级回 Lv.1 也不失效。</div>'
      + '<div>· 觉醒消耗 <b>1 颗' + STONE + '</b>，<b>不会返还</b>。</div>'
      + '<div>· 加成挂在<b>主动技能</b>上（伤害 +' + Math.round((Config.awakenSkillDamage != null ? Config.awakenSkillDamage : 0.2) * 100) + '%），'
      + '另按血统线给一条属性加成（见上方「觉醒后血统加成」）。</div>'
      + '<div>· 只有<b>终形态</b>魂兽能觉醒（非终形态没有主动技能，觉醒了也没用）。</div>'
      + '<div>· 每只宠只能觉醒一次，觉醒后不会再出现在可觉醒列表里。</div>'
      + '</div></details>';
  }

  /* ---------- 觉醒动作：先扣石 → 本地生效 → 云端落盘（失败全量回退） ---------- */
  async function doAwaken(pet, btn) {
    if (inFlight) return;
    inFlight = true;
    if (btn) btn.disabled = true;
    try {
      const spent = await Materials.spend(STONE, 1);
      if (!spent.ok) {
        showToast(spent.error || `${STONE}扣减失败`);
        return;
      }
      pet.awakened = true;
      if (pet.cloudId && window.Supabase && window.Supabase.updatePet) {
        const { error } = await window.Supabase.updatePet(pet.cloudId, { awaken_trait: '1' });
        if (error) {
          pet.awakened = false;
          await Materials.gain(STONE, 1);   // 云端写失败 → 石头退回，本地回退
          showToast('⚠️ 觉醒云端保存失败，已回退：' + (error.message || '未知错误'));
          UI.renderAll();
          return;
        }
      }
      const aw = window.Pet.getAwakenState ? window.Pet.getAwakenState(pet) : null;
      addLog(`<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg>「${pet.name}」觉醒成功：${aw ? aw.skillName : '主动技能'} 伤害+${Math.round((aw ? aw.damage : 0.2) * 100)}%，永久生效！`);
      UI.renderAll();
    } catch (e) {
      // 任何异常都要把按钮放回来，别让玩家以为功能坏了
      showToast('觉醒失败：' + (e && e.message || '未知错误'));
    } finally {
      inFlight = false;
      if (btn) btn.disabled = false;
      renderAwakenTab();
    }
  }

  UI.renderAwakenTab = renderAwakenTab;
})();
