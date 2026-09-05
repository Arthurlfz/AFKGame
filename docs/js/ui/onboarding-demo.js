/* ============================================================
 * js/ui/onboarding-demo.js —— 引导系统视觉 Demo 的交互脚本
 * 2026-09-03：只驱动 onboarding-demo.html，验证引擎与叙事内容。
 * 台词为草稿占位（接入 config.js 后可在 config 里改）。
 * 依赖：ui-onboarding.js、design-tokens.css、ui-onboarding.css、onboarding-demo.css
 * ============================================================ */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- NPC 引路人（内联水墨 SVG 立绘，无外部依赖） ---------- */
  const NPCAVATAR =
    '<svg viewBox="0 0 120 150" width="92" height="115" role="img" aria-label="引路人">' +
    '<defs>' +
    '<linearGradient id="obg-cloak" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#33443f"/><stop offset="1" stop-color="#0b0e0f"/>' +
    '</linearGradient>' +
    '<radialGradient id="obg-moon" cx=".42" cy=".34" r=".95">' +
    '<stop offset="0" stop-color="rgb(216 209 189 / .55)"/><stop offset="1" stop-color="rgb(216 209 189 / 0)"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect width="120" height="150" fill="rgb(0 0 0 / .14)"/>' +
    '<circle cx="60" cy="58" r="34" fill="url(#obg-moon)" opacity=".9"/>' +
    '<circle cx="60" cy="52" r="15" fill="#141a1a"/>' +
    '<path d="M42 40c-6 8-9 18-6 30 1 5 3 8 5 10l10-6c-2-5-3-12-2-18 1-5 2-9 5-12-3 1-7 1-12-4z" fill="#1d2524"/>' +
    '<path d="M47 38c-2 5-3 11-1 18 0 2 0 3 1 4 1 2 2 3 3 5 2 2 3 5 3 8v4h18v-4c0-3 1-6 3-8 1-2 2-3 3-5 1-1 1-2 1-4 2-7 1-13-1-18-2 4-6 6-10 6s-8-2-10-6z" fill="url(#obg-cloak)" stroke="#4d615b" stroke-width="1"/>' +
    '<path d="M45 39l-3-4M75 39l3-4" stroke="#7c8d86" stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="56" cy="50" r="1.4" fill="#e0c77d"/><circle cx="64" cy="50" r="1.4" fill="#e0c77d"/>' +
    '<path d="M57 56h6M54 61c2 2 4 2 6 2s4 0 6-2" stroke="#b89b59" stroke-width="1.3" fill="none" opacity=".85"/>' +
    '<path d="M84 6v128" stroke="#b89b59" stroke-width="3" stroke-linecap="round" opacity=".75"/>' +
    '<circle cx="84" cy="132" r="4" fill="none" stroke="#b89b59" stroke-width="1.5"/>' +
    '<path d="M40 62c-2 4-3 10-2 17 1 8 3 13 6 17l6-7c-3-4-4-9-4-15 0-5 1-9 3-12z" fill="#26312f" opacity=".9"/>' +
    '</svg>';

  /* ---------- 引导任务链（台词草稿：接入 config 后可改） ---------- */
  const TASKS = [
    { g: 'G1', name: '引路人的馈赠', type: '领资粮', page: 'pet', target: '#pet-card',
      cta: '领取资粮', boost: 10,
      npc: '腐土虽是你的战场，但蜕变不该靠苦熬。这份资粮，助你直抵进化之境。',
      hint: '点主按钮，看经验包把出战魂兽直升 Lv10。',
      reward: ['进化素材×1', '蓝装×1'] },
    { g: 'G2', name: '初次蜕变', type: '进化', page: 'pet', target: '.pet-tab[data-pet-tab="evolve"]', tab: 'evolve',
      cta: '去进化',
      npc: '形态蜕变、属性跃升——这是养成的第一个跳变。越过此境，你的魂兽才真正属于你。',
      hint: '宠物页 · 进化栏：等级已达标，点「进化」完成蜕变。',
      reward: ['神圣石×1'] },
    { g: 'G3', name: '披甲上阵', type: '穿装备', page: 'pet', target: '.pet-tab[data-pet-tab="equip"]', tab: 'equip',
      cta: '去穿装备',
      npc: '蜕变之后仍需甲胄护身，战力才扎实。披上残甲，别让它静静躺在背包蒙尘。',
      hint: '宠物页 · 装备栏：把一件装备穿到出战魂兽身上。',
      reward: ['重铸石×1'] },
    { g: 'G4', name: '亲手淬炼', type: '打造', page: 'equip', target: '#btn-craft',
      cta: '去打造',
      npc: '掉落终有尽时。学会亲手锻造，你的战力便不再仰仗天命。',
      hint: '打造页：点「打造 1 件装备」，产出你自己的护身甲。',
      reward: ['增缀石×1'] },
    { g: 'G5', name: '化废为宝', type: '分解', page: 'equip', target: '#btn-salvage',
      cta: '去分解',
      npc: '废品并非无用。拆了回炉成打造石，养成的循环才真正闭合。',
      hint: '打造页：点「一键分解废品」，把多余装备拆回材料。',
      reward: ['宠物蛋×1'] },
    { g: 'G6', name: '孵化新生命', type: '孵化', page: 'pet', target: '.pet-tab[data-pet-tab="egg"]', tab: 'egg',
      cta: '去孵化',
      npc: '战场不该只容一只孤魂。孵化这颗蛋，让副宠为你并肩而战。',
      hint: '宠物页 · 宠物蛋栏：孵化 1 颗蛋，得到你的第二只魂兽。',
      reward: ['合成之石×1'] },
    { g: 'G7', name: '融合之力', type: '合成', page: 'pet', target: '.pet-tab[data-pet-tab="synth"]', tab: 'synth',
      cta: '去合成', boost: 40,
      npc: '魂兽之间亦有高下。主宠融副宠、继承其特质，向更上一层蜕变。',
      hint: '宠物页 · 合成栏：Lv40 已达标（经验包顶入），主宠融合副宠。',
      reward: ['涅磐兽×1', '副宠'] },
    { g: 'G8', name: '初入市集', type: '上架', page: 'market', target: '#btn-list',
      cta: '去上架',
      npc: '你亲手锻造之物，可换他人之资。市集之上，强者互通有无。',
      hint: '市集页：上架 1 件装备，进入真实玩家交易。',
      reward: ['资源包'] },
    { g: 'G9', name: '浴火涅槃', type: '涅槃', page: 'pet', target: '.pet-tab[data-pet-tab="merge"]', tab: 'merge',
      cta: '去涅槃', boost: 60,
      npc: 'Lv60 —— 燃尽旧躯，于灰烬中重塑真形。这是魂兽的毕业之礼，仅此一次。',
      hint: '宠物页 · 涅槃栏：Lv60 已达标（经验包顶入）＋ 涅磐兽就位。',
      reward: ['毕业礼包（账号仅一次）'] },
    { g: 'G10', name: '魂铸传承', type: '魂铸', page: 'equip', target: '#btn-soulcast',
      cta: '去魂铸', isNormal: true,
      npc: '特质可铸入装备，世代相传。毕业之后，仍有可走的更深之路。',
      hint: '打造页 · 魂铸：把魂兽特质铸进装备（毕业后普通任务，非引导段）。',
      reward: ['毕业深研'] }
  ];
  const GUIDE_COUNT = 9; // G1~G9 属引导段；G10 是毕业后普通任务

  /* ---------- 开场总览 tour（spotlight 走四个核心系统） ---------- */
  const TOUR = [
    { target: '#core-battle', title: '第一站 · 战场',
      npc: '怪物横行的腐土，是你魂兽变强的资粮。厮杀可得经验与残甲——可蜕变，不该靠苦熬。' },
    { target: '#pet-card', title: '第二站 · 魂兽',
      npc: '资料页藏着它的一切：血统、特质，以及那扇通往更强形态的进化之门。' },
    { target: '#btn-craft', title: '第三站 · 魂铸工坊',
      npc: '神兵不只出自掉落。这座铁砧，能把废品炼成护身之甲、把特质铸成传承。' },
    { target: '#btn-list', title: '第四站 · 市集',
      npc: '当你足够强大，多余的造物可挂上市集，与天下魂师交换所需之物。' },
    { target: '#demo-guide', title: '引路长明',
      npc: '此后每一步，我都写在顶部引导条上。从资粮到涅槃，变强之路，我们一步步走。',
      cta: '开始历练' }
  ];

  /* ---------- demo 状态 ---------- */
  let cur = 0;               // 当前引导索引（G1 为 0）
  let done = new Set();      // 已演示完成的任务（g 字符串）
  let petLv = 1;             // 出战魂兽等级（示意）
  let petTab = 'profile';
  let skip = false;
  let battleTimer = null;

  /* ---------- 小工具 ---------- */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'demo-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    window.setTimeout(function () { t.remove(); }, 2400);
  }
  function gotoPage(page) {
    $$('.sb-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.page === page); });
    $$('.page').forEach(function (s) { s.classList.toggle('on', s.dataset.page === page); });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const NPC_OPTS = { npcName: '引路人', npcTitle: '魂兽向导', npcAvatar: NPCAVATAR };

  /* ---------- 宠物等级刷新（示意） ---------- */
  function nextGate() {
    if (petLv < 10) return 10;
    if (petLv < 40) return 40;
    if (petLv < 60) return 60;
    return 100;
  }
  function refreshPet() {
    const lv = $('pet-lv'), xp = $('pet-xp'), top = $('pb-lv-top'), next = $('pet-next');
    if (lv) lv.textContent = petLv;
    if (top) top.textContent = 'Lv' + petLv;
    if (xp) {
      const seg = nextGate();
      xp.style.width = (petLv >= seg ? 100 : petLv < 10 ? Math.min(100, petLv * 10) : 14) + '%';
    }
    if (next) {
      next.textContent = petLv < 10 ? 'Lv10 · 需进化素材×1（引导经验包已备）'
        : petLv < 40 ? 'Lv40 · 合成主宠门槛（进入 G7 前经验包顶入）'
        : petLv < 60 ? 'Lv60 · 涅槃门槛（进入 G9 前经验包顶入）'
        : '已抵达毕业之境，可向更高探索';
    }
    // 宠物蛋/合成/涅槃 pane 动态提示
    if (petTab === 'synth' || petTab === 'merge' || petTab === 'egg' || petTab === 'evolve') renderPane();
  }
  function boostPet(toLv, silent) {
    if (petLv >= toLv) return;
    petLv = toLv;
    refreshPet();
    if (!silent) toast('引导经验包生效：出战魂兽 直升 Lv' + toLv + '（不靠刷怪）');
  }

  /* ---------- 宠物页 tab 与 pane ---------- */
  const PANE = {
    profile: '<div class="pane-empty">（资料）血统：浑浊 · 特质：泥沼之息。幼年腐噜兽，亲近腐土的泥与雾。</div>',
    evolve: '<div class="pane-note">进化至「腐壳兽」：需要 <b>Lv10</b> ＋ 进化素材×1（素材已备）。</div>' +
      '<div class="pane-cta"><div class="mrow">下阶：腐壳兽 · 属性跃升 60%</div>' +
      '<button class="g-btn" id="btn-evolve" type="button">进化</button></div>',
    equip: '<div class="pane-note">把怪物掉落的残甲穿到魂兽身上（G3 指引入口）。</div>' +
      '<div class="pane-grid">' +
      '<div class="slot">头<br>空</div><div class="slot">身<br>空</div><div class="slot">爪<br>空</div>' +
      '<div class="slot">饰<br>空</div><div class="slot">尾<br>空</div></div>',
    synth: '<div class="pane-note">主宠融合副宠，继承其特质（需要 <b>Lv40</b> ＋ 副宠）。</div>' +
      '<div class="pane-cta"><div class="mrow">主宠 腐噜兽 ＋ 副宠（经验包已把主宠顶到门槛）</div>' +
      '<button class="g-btn" id="btn-synth" type="button">合成</button></div>',
    egg: '<div class="pane-note">孵化 1 颗蛋，得到你的第二只魂兽（G6 指引入口）。</div>' +
      '<div class="pane-cta"><div class="mrow">背包：腐噜兽蛋 ×1</div>' +
      '<button class="g-btn" id="btn-egg" type="button">孵化</button></div>',
    merge: '<div class="pane-note">Lv60 燃尽旧躯、重塑真形（需要 <b>Lv60</b> ＋ 涅磐兽×1）。</div>' +
      '<div class="pane-cta"><div class="mrow">涅磐兽 ×1 · 已就位</div>' +
      '<button class="g-btn" id="btn-nirvana" type="button">涅槃</button></div>'
  };
  function renderPane() {
    const pane = $('pet-pane');
    if (!pane) return;
    pane.innerHTML = PANE[petTab] || PANE.profile;
    const synthBtn = $('btn-synth');
    if (synthBtn) synthBtn.disabled = petLv < 40;
    const nirBtn = $('btn-nirvana');
    if (nirBtn) nirBtn.disabled = petLv < 60;
    const evBtn = $('btn-evolve');
    if (evBtn) evBtn.disabled = petLv < 10;
    $$('.pet-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.petTab === petTab); });
  }
  function activatePetTab(tab) {
    petTab = tab;
    renderPane();
  }
  function currentTab() { return petTab; }

  /* ---------- 右侧任务链渲染 ---------- */
  function guideIndex() {
    for (let i = 0; i < GUIDE_COUNT; i++) {
      if (!done.has(TASKS[i].g)) return i;
    }
    return -1; // 引导段全部完成
  }
  function renderChain() {
    const wrap = $('q-list');
    if (!wrap) return;
    const gidx = guideIndex();
    wrap.innerHTML = TASKS.map(function (t) {
      const isGuide = !t.isNormal;
      const cls = [
        'q-item',
        done.has(t.g) ? 'done' : '',
        gidx === TASKS.indexOf(t) ? 'on' : ''
      ].filter(Boolean).join(' ');
      const boostChip = t.boost ? '<span class="q-chip q-chip--boost">资粮 →Lv' + t.boost + '</span>' : '';
      const rewardChip = '<span class="q-chip q-chip--reward">🎁 ' + t.reward.join(' · ') + '</span>';
      const doneChip = done.has(t.g) ? '<span class="q-chip q-chip--done">✓ 已演示</span>' : '';
      const okBtn = (!t.isNormal && gidx === TASKS.indexOf(t) && !done.has(t.g))
        ? '<span class="q-ok" data-i="' + TASKS.indexOf(t) + '">✓ 演示完成</span>' : '';
      return '<div class="' + cls + '" data-i="' + TASKS.indexOf(t) + '">' +
        '<div class="q-row1"><span class="q-gid">' + t.g + '</span>' +
        '<span class="q-name">' + esc(t.name) + '</span>' +
        '<span class="q-type">' + esc(t.type) + (isGuide ? '' : ' · 普通') + '</span></div>' +
        '<div class="q-npc">' + esc(t.npc) + '</div>' +
        '<div class="q-meta">' + boostChip + rewardChip + doneChip + okBtn + '</div>' +
        '</div>';
    }).join('');

    $$('.q-item', wrap).forEach(function (it) {
      it.addEventListener('click', function (e) {
        if (e.target.closest('.q-ok')) return;
        previewTask(Number(it.dataset.i));
      });
    });
    $$('.q-ok', wrap).forEach(function (ok) {
      ok.addEventListener('click', function (e) {
        e.stopPropagation();
        markDone(Number(ok.dataset.i));
      });
    });
  }
  function renderGuide() {
    const title = $('dg-title'), hint = $('dg-hint'), boost = $('dg-boost'), go = $('dg-go');
    if (!title) return;
    if (skip) { title.textContent = '（引导已跳过）'; hint.textContent = '接入后：跳过不打毕业礼包标记。'; boost.style.display = 'none'; go.textContent = '再看一遍开场'; return; }
    const i = guideIndex();
    if (i < 0) {
      title.textContent = '引导完成 · 毕业礼包已入账';
      hint.textContent = 'G10 魂铸为毕业后普通任务，可自由进行。';
      boost.style.display = 'none';
      go.textContent = '再看一遍开场';
      return;
    }
    const t = TASKS[i];
    title.textContent = t.g + ' ' + t.name;
    hint.textContent = '目标：' + t.hint;
    boost.style.display = t.boost ? '' : 'none';
    boost.textContent = t.boost ? '资粮 Lv' + t.boost : '';
    go.textContent = t.cta + ' →';
  }

  /* ---------- 预览一条任务（hotspot / spotlight） ---------- */
  function previewTask(i) {
    const t = TASKS[i];
    gotoPage(t.page);
    if (t.tab) activatePetTab(t.tab);
    // 等级门槛：进入任务前经验包直接顶（G2 前 Lv10 / G7 前 Lv40 / G9 前 Lv60）
    if (t.boost && petLv < t.boost) boostPet(t.boost, true);
    window.setTimeout(function () {
      const isG1 = t.g === 'G1';
      if (isG1) {
        Onboarding.spotlight(t.target, Object.assign({}, NPC_OPTS, {
          title: t.g + ' · ' + t.name,
          npc: t.npc,
          cta: t.cta + ' → 直升 Lv10',
          onNext: function () {
            boostPet(10);
            if (i === guideIndex()) markDone(i);
            return true;
          }
        }));
      } else {
        Onboarding.hotspot(t.target, Object.assign({}, NPC_OPTS, {
          title: t.g + ' · ' + t.name,
          npc: t.npc
        }));
      }
    }, 60);
  }
  function markDone(i) {
    const t = TASKS[i];
    if (t.boost && petLv < t.boost) boostPet(t.boost, true);
    done.add(t.g);
    Onboarding.clear();
    toast('已完成「' + t.name + '」（演示推进）');
    renderChain();
    renderGuide();
  }

  /* ---------- 开场总览 ---------- */
  function playTour() {
    Onboarding.startTour(TOUR.map(function (s) {
      return Object.assign({}, s, NPC_OPTS);
    }), {
      onDone: function () { toast('开场总览结束 —— 引导正式启动：先领资粮 → 直升 Lv10'); renderGuide(); },
      onSkip: function () { toast('已跳过开场总览（接入后按跳过引导处理）'); }
    });
  }

  /* ---------- 战斗页假日志 ---------- */
  function toggleBattle() {
    const btn = $('btn-battle');
    if (battleTimer) {
      window.clearInterval(battleTimer);
      battleTimer = null;
      btn.textContent = '开始自动战斗';
      logLine('战斗停止。腐土重归寂静。');
      return;
    }
    btn.textContent = '停止自动战斗';
    logLine('进入战斗：腐土小径 · 经验 ×6（引导加速，可手动祝福）');
    battleTimer = window.setInterval(function () {
      logLine('击败 腐甲兽 ×1 · 获得 残甲(白)、打造石×1');
    }, 1400);
  }
  function logLine(txt) {
    const log = $('battle-log');
    if (!log) return;
    const d = document.createElement('div');
    d.textContent = txt;
    log.insertBefore(d, log.firstChild);
    while (log.children.length > 8) log.lastChild.remove();
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $$('.sb-btn').forEach(function (b) {
      b.addEventListener('click', function () { gotoPage(b.dataset.page); });
    });
    $$('.pet-tab').forEach(function (b) {
      b.addEventListener('click', function () { activatePetTab(b.dataset.petTab); });
    });
    $$('.map-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        $$('.map-chip').forEach(function (x) { x.classList.remove('on'); });
        c.classList.add('on');
      });
    });
    $('btn-tour').addEventListener('click', playTour);
    $('btn-spot').addEventListener('click', function () {
      const i = guideIndex();
      if (i < 0) { toast('引导已走完，试试开场 Tour'); return; }
      previewTask(i);
    });
    $('btn-clear').addEventListener('click', function () { Onboarding.clear(); });
    $('dg-go').addEventListener('click', function () {
      const i = guideIndex();
      if (i < 0) { playTour(); return; }
      previewTask(i);
    });
    $('dg-skip').addEventListener('click', function () {
      skip = true;
      Onboarding.clear();
      toast('跳过引导（接入后：不发毕业礼包）');
      renderChain();
      renderGuide();
    });
    $('btn-battle').addEventListener('click', toggleBattle);
    // 伪页面内"真实操作"按钮（演示点击时自动关闭 hotspot 的效果）
    ['btn-evolve', 'btn-synth', 'btn-egg', 'btn-nirvana', 'btn-craft', 'btn-salvage', 'btn-soulcast', 'btn-list'].forEach(function (id) {
      const b = $(id);
      if (!b) return;
      b.addEventListener('click', function () {
        if (id === 'btn-evolve' && petLv < 10) { toast('还需 Lv10 —— 引导资粮会把等级顶上去'); return; }
        if (id === 'btn-synth' && petLv < 40) { toast('合成需 Lv40 —— 进入 G7 前经验包顶入'); return; }
        if (id === 'btn-nirvana' && petLv < 60) { toast('涅槃需 Lv60 —— 进入 G9 前经验包顶入'); return; }
        toast('（演示）成功完成：' + b.textContent);
      });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    bind();
    renderChain();
    renderGuide();
    renderPane();
    refreshPet();
    if (window.Onboarding) Onboarding.clear();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
