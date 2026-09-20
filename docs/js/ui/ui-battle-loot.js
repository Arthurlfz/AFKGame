/* ============================================================
 * ui/ui-battle-loot.js —— 唯一职责：掉落「播报 + 演出」（掉了什么、飞进包、要不要弹横幅）。
 * 从 ui-battle.js 迁出（2026-09-21，一个文件一个职责）。
 *
 * 对外（照旧挂在 UI 上，调用方不用改）：
 *   UI.showLoot(reward)     main.js 每次结算后调用；reward.type ∈ none/material/equipment/egg，一场最多一件
 *   UI.lootTierOf(name)     档位 1~3；世界地图的「掉落预览」复用同一套（不另抄一份名单 = 不出现第二份事实源）
 *
 * 依赖：`Config`（`drop.lootTiers` 与 `trade.materials` 两个唯一事实源）、
 *      `UI.escapeHtml / consoleLog / switchPage`、`window.StageFx`（横幅 / 舞台闪光 / 屏幕脉冲）、
 *      `window.Tips`（金装提示，可选）。
 * ⚠️ 消费者一律**用时取**（`window.StageFx`）：测试 harness 的清单顺序里它可能排在本模块之后。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const Config = window.Config;
  const esc = (s) => (UI.escapeHtml ? UI.escapeHtml(s) : String(s));
  const $ = (id) => (UI.$ ? UI.$(id) : (document.getElementById ? document.getElementById(id) : null));
  const StageFx = () => window.StageFx;

  /* ---------- 掉落播报（main.js 编排后调用；只显示掉落物品，不显示战斗过程） ----------
   * 挂机没有「地上的东西」可以踩（不像别的游戏能走过去捡），所以掉宝的信息只能落在消息控制台里——
   * 于是靠【字号 + 字重 + 辉光】把三档拉开，档位表在 config.js 的 `drop.lootTiers`。
   * 判据：越难出 / 越关键，字越大越亮；**日常材料不套档位 class = 不提亮**（提亮一切等于没提亮）。
   * 颜色不在这里定：装备沿用白/蓝/金三档稀有度色，宠物蛋走 .loot-egg 幽蓝。 */
  function lootTierOf(name) {
    const t = (Config && Config.drop && Config.drop.lootTiers) ? Config.drop.lootTiers[name] : 0;
    return Number(t) || 1;
  }

  /* ---------- 掉落演出（2026-09-16）----------
   * 挂机没有"地上的东西"可捡，掉落的反馈原本只有聊天框里一行字 —— 玩家挂机一小时，
   * 最容易错过的恰恰是"刚掉了好东西"。所以补两层：
   *   ① 飞入：东西从怪身上飞进顶栏背包（眼睛会跟着走，知道它进包了）
   *   ② 横幅：只有稀有档（tier3 / 金装 / 蛋）才出。普通材料不打扰 —— 天天出就等于没出。
   * ⚠️ 纯表现：拿不到坐标 / 不在战斗页时一律静默跳过，绝不影响结算。
   *
   * 🔴 起点必须【逐个候选验 rect】（2026-09-16 首次上线后用户反馈"没看到飞"的真因）：
   *   掉落播报发生在每场结算之后，而那一刻 `#enemy-fighter` 正好被 idle-bridge
   *   收成 display:none（它要等飘字播完再收起，下一只怪上台才恢复）。
   *   display:none 的元素 **querySelector 照样能取到**，只是 rect 全 0 ——
   *   所以"取到元素就用"会让每一次掉落都拿不到起点，飞入永远不出现。
   *   这里的规矩：取到 → 验 rect → 不行就换下一个候选；全都不行才当作"战斗页不在前台"。 */
  function rectOf(sel) {
    const el = document.querySelector(sel);
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return (r.width && r.height) ? r : null;
  }
  function lootOrigin() {
    // ① 怪身上（东西是从它身上掉的）
    const av = rectOf('#tab-battle .fighter-enemy .stage-avatar');
    if (av) return { x: av.left + av.width / 2, y: av.top + av.height * 0.42 };
    // ② 怪被收起 / 换场空档 → 退回舞台右侧：那本来就是怪站的位置
    const stage = rectOf('#tab-battle .battle-stage');
    if (stage) return { x: stage.left + stage.width * 0.72, y: stage.top + stage.height * 0.52 };
    return null; // 战斗页不在前台：不飞（免得别的页面莫名飘东西）
  }
  function flyToBag(text, kind) {
    if (typeof document === 'undefined' || !document.body) return;
    // 玩家自己在设置里关了动画 → 尊重，不飞
    if (document.body.classList && document.body.classList.contains('rm-anim')) return;
    const bag = $('topbar-bag');
    const from = lootOrigin();
    if (!bag || !from || !bag.getBoundingClientRect) return;
    const to = bag.getBoundingClientRect();
    if (!to.width) return;
    // 兜底信号：背包图标自己亮一下（飞行物万一没被注意到，"进包了"这件事也不会丢）
    if (bag.classList) {
      bag.classList.remove('bag-pulse');
      void bag.offsetWidth;
      bag.classList.add('bag-pulse');
      setTimeout(() => bag.classList.remove('bag-pulse'), 480);
    }
    const el = document.createElement('div');
    el.className = 'loot-fly' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    document.body.appendChild(el);
    const dx = (to.left + to.width / 2) - from.x;
    const dy = (to.top + to.height / 2) - from.y;
    /* 用 Web Animations 而不是 transition：元素刚插进 DOM 就改 transform 时，
     * 浏览器可能还没算过初始样式 → transition 不生效，东西直接闪到终点（看着就像"没飞"）。
     * WAAPI 由 JS 直接给时长，不受这个时序影响。老浏览器退回 transition。 */
    if (el.animate) {
      el.animate(
        [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
         { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.72)', opacity: .15 }],
        { duration: 620, easing: 'cubic-bezier(.35,0,.25,1)', fill: 'forwards' }
      );
    } else {
      const go = () => {
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.72)';
        el.style.opacity = '.15';
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(go); else setTimeout(go, 16);
    }
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 720);
  }

  /* 材料名 → 用途配色 class：现读 Config.trade.materials（那里是材料名的唯一定义处），
   * **不在这里另抄一份名单** —— 抄了就是第二份事实源，改了材料表忘了改这儿就静默失效。
   * 分工：**字号 = 稀有度（lootTiers），颜色 = 用途（这里）**，两者不重叠。
   * 区域材料（枯荣种荚等）不进 trade.materials → 拿不到类别 → 不上色（用户 2026-09-13：无所谓）。 */
  let matCatMap = null;
  function matClassOf(name) {
    if (!matCatMap) {
      matCatMap = Object.create(null);
      const list = (Config && Config.trade && Config.trade.materials) || [];
      for (const m of list) if (m && m.name && m.category) matCatMap[m.name] = m.category;
    }
    const c = matCatMap[name];
    if (c === 'evo') return 'loot-c-evo';     // 进化系 · 病绿
    if (c === 'stone') return 'loot-c-stone'; // 打造 / 功能石 · 暗紫
    return '';                                 // 腐印、区域材料等：不上色（靠档位字号区分）
  }
  /* 🔴 档位 class 与颜色 class **必须在同一个 span 上**：顶档的流光靠 `currentColor` 取色，
   * 拆成两层（外层档位、内层颜色）的话，外层取到的是继承色而不是装备/材料的颜色 → 金装会变成默认色。 */
  function addLootEntry(html, tier, colorCls) {
    if (!UI.consoleLog) return;
    const t = Math.max(1, Math.min(3, Number(tier) || 1));
    // 档位 class 用通用的 hi2 / hi3（不是 loot-t*）：鉴定揭晓、打造出 T1、地图掉落预览都要复用同一套
    const cls = [colorCls || '', t > 1 ? 'hi' + t : ''].filter(Boolean).join(' ');
    // 掉落消息统一进消息控制台（loot 分类）；时间戳与滚动由控制台负责
    UI.consoleLog('loot', cls ? '<span class="' + cls + '">' + html + '</span>' : html);
  }

  function showLoot(reward) {
    // 改法一·单池：reward.type ∈ none/material/equipment/egg，一场最多一件。
    // 仍只保留掉落日志记录（不引入 toast / 中间弹窗）；金装/蛋保留全屏光效。
    if (!reward || reward.type === 'none') return;
    if (reward.type === 'material') {
      const name = reward.material, qty = reward.qty || 1;
      addLootEntry(`${esc(name)} ×${qty}`, lootTierOf(name), matClassOf(name));
      flyToBag(`${name} ×${qty}`, matClassOf(name) === 'loot-c-evo' ? 'is-evo' : '');
      if (lootTierOf(name) >= 3) {
        StageFx().banner('loot-banner', [{ c: 'lb-k', t: '稀有掉落' }, { c: 'lb-n', t: name }, { c: 'lb-s', t: '×' + qty }, { c: 'lb-line', t: '' }]);
      }
      return;
    }
    if (reward.type === 'equipment') {
      const r = reward.eq.rarity;
      const q = r.id === 'gold' ? 'fs-q--gold' : (r.id === 'blue' ? 'fs-q--blue' : 'fs-q--white');
      addLootEntry(`${r.label}·${esc(reward.eq.name)}`,
        r.id === 'gold' ? 3 : (r.id === 'blue' ? 2 : 1), 'loot-q ' + q);
      if (r.id === 'gold') {
        StageFx().flash('loot-flash-gold', 900); // 金装：全屏金光扫过
        StageFx().goldPulse(); // 金装：屏幕边缘金色脉冲
        if (window.Tips) Tips.show('gold_pulse', '✨ 金装提醒', '出金装时屏幕边缘会闪金光');
        const banner = StageFx().banner('loot-banner', [
          { c: 'lb-k', t: '稀有掉落' },
          { c: 'lb-n', t: reward.eq.name },
          { c: 'lb-s', t: r.label },
          { c: 'lb-action', t: '去背包鉴定 →' },
          { c: 'lb-line', t: '' }
        ], 5000);
        if (banner) {
          const act = banner.querySelector('.lb-action');
          if (act) act.style.cursor = 'pointer';
          banner.addEventListener('click', (e) => {
            if (e.target === act || (act && act.contains(e.target))) {
              if (UI.switchPage) UI.switchPage('bag');
            }
          });
        }
      } else {
        flyToBag(`${r.label}·${reward.eq.name}`, r.id === 'blue' ? 'is-blue' : '');
      }
      return;
    }
    if (reward.type === 'egg') {
      addLootEntry('宠物蛋 ×1（孵化去「背包 → 宠物蛋」）', 3, 'loot-egg');
      StageFx().flash('loot-flash-blue', 900); // 宠物蛋：幽蓝光扫过
      StageFx().banner('loot-banner is-blue', [{ c: 'lb-k', t: '稀有掉落' }, { c: 'lb-n', t: '宠物蛋' }, { c: 'lb-s', t: '孵化去「背包 → 宠物蛋」' }, { c: 'lb-line', t: '' }]);
      return;
    }
  }

  UI.showLoot = showLoot;
  UI.lootTierOf = lootTierOf;
})();
