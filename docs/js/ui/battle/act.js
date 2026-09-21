/* ============================================================
 * ui/ui-battle-act.js —— 唯一职责：战斗页【出手与命中演出】（节奏 / 冲刺 / 受击形变 / 飘字）。
 * 从 ui-battle.js 迁出（2026-09-21，一个文件一个职责）。
 *
 * 对外（照旧挂在 UI 上，调用方 battle.js / idle-bridge.js 不用改）：
 *   UI.animateAttack(attacker, holdMs)      返回"命中时刻"（ms）：前摇结束 + 冲到对方脸上
 *   UI.attackRecoverMs()                    上一次出手的后摇归位时长（行动条冻结要用它）
 *   UI.animateHit(target, isCrit)           受击形变（hit / crit-hit）
 *   UI.showDamage(target, dmg, type, label) 伤害/暴击/吸血实际生效那一刻 → 转飘字 + 命中特效
 *   UI.showFloatingText(target, text, type, opts)  飘字（供其它表现层单独调用）
 *
 * 依赖：`UI.$` / `UI.escapeHtml`、`window.PetSprites`（逐帧立绘 animOf/setAnim）、
 *      `StageFx()`（暴击全屏反馈）、`window.HitFx`（命中墨爆，**可选模块**，一律判存在）。
 * ⚠️ 一律**用时取**（`window.StageFx` / `window.HitFx`）：测试 harness 的清单顺序里它们可能排在本模块之后。
 * ⚠️ 命中特效（脚底墨爆）的实现**不在本文件**：播放器 = `js/fx/hit-fx.js`、样式 = `css/fx.css`；
 *    本文件只负责"什么时机播"（见 showDamage 里那一行）。
 * ============================================================ */
(function () {
  'use strict';

  const UI = window.UI;
  const { $ } = UI;
  const StageFx = () => window.StageFx;

  const DASH_MIN = 0.24, DASH_MAX = 0.6; // 秒：太近别一闪而过，太远也别拖沓
  /* 出手节奏按角色类型区分。挂机玩家不一定盯着血条，但能感觉到"这只抬手慢、收招沉"= 不好惹，
   * 类型辨识度就是靠这个建立的，光靠体型大一圈不够。
   *   charge = 前摇(ms)：抬手蓄力，越长越有威胁感，也给玩家反应时间
   *   speed  = 冲刺速度(px/s)：见下方"速度恒定"说明
   *   back   = 后摇(秒)：收招回位，越长显得越笨重
   * 前摇/后摇以 CSS 变量注入（--dash-charge / --dash-back），CSS 里不再写死时长。 */
  const PACE = {
    pet:     { charge: 160, speed: 1800, back: 0.30 },
    normal:  { charge: 140, speed: 1950, back: 0.26 }, // 路边小怪：快、轻、收招利索
    evolved: { charge: 200, speed: 1700, back: 0.36 }, // 进化体：沉稳
    mutant:  { charge: 300, speed: 1450, back: 0.52 }  // 变异体：抬手慢、收招沉
  };
  // 敌人的类型从战斗状态里读；我方固定走 pet 档
  function paceOf(attacker) {
    if (attacker !== 'enemy') return PACE.pet;
    const st = window.Battle && window.Battle.state;
    const type = st && st.enemy && st.enemy.enemyType;
    return PACE[type] || PACE.normal;
  }
  // 返回冲刺时长（毫秒）；量不到距离时返回 0（调用方按 0 处理）
  function setDashDistance(icon, foe, attacker, speed) {
    if (!icon || !foe) return 0;
    const a = icon.getBoundingClientRect(), b = foe.getBoundingClientRect();
    if (!a.width || !b.width) return 0; // 未开战时敌方不可见（尺寸 0），此时不冲
    // 冲进对方容器 40%：立绘是透明 PNG，角色本体只占中间约 78%（两边各留 11%），
    // 只按容器边缘对齐的话，视觉上角色本体离对方还差一截，看着像半路刹车。
    const OVERLAP = 0.4;
    const toRight = attacker === 'pet';
    const gap = toRight
      ? (b.left + b.width * OVERLAP) - a.right
      : (b.right - b.width * OVERLAP) - a.left;
    // 只朝对手方向冲：我方恒为非负，敌方恒为非正，避免布局异常时冲反
    const dist = toRight ? Math.max(0, gap) : Math.min(0, gap);
    const dur = Math.min(DASH_MAX, Math.max(DASH_MIN, Math.abs(dist) / speed));
    icon.style.setProperty('--dash-x', Math.round(dist) + 'px');
    icon.style.setProperty('--dash-out', dur.toFixed(3) + 's');
    return Math.round(dur * 1000);
  }
  /* 上一次出手演出的「后摇归位」时长（毫秒）。
   * battle.js 拿它决定行动条冻结多久 —— 命中不等于演完，立绘还得收招回位，
   * 这段时间行动条继续走的话，会出现"人还在半路、下一次出手已经开始蓄力"的错位。 */
  let lastBackMs = 0;
  function attackRecoverMs() { return lastBackMs; }

  function animateAttack(attacker, holdMs) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const foe = attacker === 'pet' ? $('enemy-icon') : $('pet-icon');
    if (!icon) { lastBackMs = 0; return 0; }
    const pace = paceOf(attacker);
    holdMs = holdMs || 0;
    /* 「滞空挥爪」时长 = 逐帧攻击素材自己的时长：冲到脸上后**停住挥完再退**。
     * 静态立绘没有"挥爪"这个过程 ⇒ 滞空 0，行为与以前完全一致（不影响到没有动画的宠/怪）。 */
    const node = icon.querySelector ? icon.querySelector('.pet-anim') : null;
    const anim = (node && window.PetSprites && window.PetSprites.animOf) ? window.PetSprites.animOf(node.dataset.petName) : null;
    const atkDurMs = (anim && anim.attack && parseFloat(anim.attack.dur))
      ? Math.round(parseFloat(anim.attack.dur) * 1000) : 0;
    /* 归位时长必须把【滞空】算进去：battle.js / idle-bridge 拿它冻结行动条。
     * 漏掉的话会出现注释里警告过的错位——"人还贴在怪脸上，下一手已经在原地蓄力"。
     * ⚠️ 托管挂机的行动条定速会「扣掉冻结开销」（idle-bridge 的 costOf），所以挂机模式下
     *    这笔滞空不影响出刀数，只是把每刀重新铺在时间轴上。 */
    lastBackMs = Math.round(pace.back * 1000) + holdMs + atkDurMs;
    const dashMs = setDashDistance(icon, foe, attacker, pace.speed);
    icon.style.setProperty('--dash-charge', (pace.charge / 1000).toFixed(3) + 's');
    icon.style.setProperty('--dash-back', pace.back.toFixed(3) + 's');
    // 滞空：CSS 把"回退"动画往后推这么久 ⇒ 冲到脸上先停住挥完，再退回来
    icon.style.setProperty('--dash-hold', (atkDurMs / 1000).toFixed(3) + 's');
    /* 前摇（蓄力压扁）→ 扑击（冲到对方脸上）→ 滞空挥爪 → 后摇（收招回位）。
     * 连击时必须先摘掉旧 class 并强制重排：同名 class 的 CSS 动画不会自己重播，
     * 不重排的话第二次出手会丢掉前摇动作，只剩一段位移。 */
    clearTimeout(icon.__chargeT);
    clearTimeout(icon.__attackT);
    icon.classList.remove('charging', 'attacking');
    void icon.offsetWidth;
    icon.classList.add('charging');
    icon.__chargeT = setTimeout(() => {
      icon.classList.remove('charging');
      icon.classList.add('attacking');
      icon.__attackT = setTimeout(() => icon.classList.remove('attacking'),
        dashMs + holdMs + atkDurMs + pace.back * 1000);
    }, pace.charge);
    /* 逐帧动画立绘：攻击帧必须等【冲到对方脸上】才播。
     * 🔴 2026-09-21 用户要求："跑到怪物脸上之后才播放出手动作"、"停在怪脸上挥完再退" ——
     *    起手就播的话，玩家看到的是"在原地挥爪子、爪子打在空气里"，冲刺位移成了白演。
     * 时刻 = 前摇 + 冲刺（就是本函数最后 return 的"命中时刻"，与伤害结算同一刻度，不另算一份）；
     * "退回原位"由上面的 --dash-hold 推到挥完之后 ⇒ 观感 = 冲过去 → 在脸上挥完 → 再退。 */
    if (node && window.PetSprites && window.PetSprites.setAnim && atkDurMs) {
      const contactMs = pace.charge + dashMs;
      clearTimeout(icon.__animAtkT);
      clearTimeout(icon.__animBackT);
      icon.__animAtkT = setTimeout(() => {
        if (!node.isConnected) return;
        window.PetSprites.setAnim(node, 'attack');
        // 挥完（+一点停留）再切回待机；时长同样取素材自己的 dur，不写死
        icon.__animBackT = setTimeout(() => {
          if (node.isConnected) window.PetSprites.setAnim(node, 'idle');
        }, atkDurMs + 120);
      }, contactMs);
    }
    // 命中时刻（前摇结束 + 冲到对方脸上）：伤害结算与受击特效都对齐这一刻，
    // 由调用方决定怎么用，表现层不写死——前摇按类型、冲刺按距离，都是变的。
    return pace.charge + dashMs;
  }

  function animateHit(target, isCrit) {
    const icon = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    if (!icon) return;
    clearTimeout(icon.__hitT);
    icon.classList.remove('hit', 'crit-hit');
    // 连续挨打时，同名 class 的 CSS 动画不会自己重播，必须摘掉 → 强制重排 → 再挂上
    void icon.offsetWidth;
    const cls = isCrit ? 'crit-hit' : 'hit';
    icon.classList.add(cls);
    icon.__hitT = setTimeout(() => icon.classList.remove('hit', 'crit-hit'), isCrit ? 440 : 320);
  }

  // 战斗飘字：在目标头像上方弹带类型标签的数字（攻击：-X / 暴击：-X / 吸血：+X）
  // 普通白 / 暴击亮红大20% / 吸血暗绿侧边；同一目标同时最多 3 个，超出延迟 120ms 排队；
  // 淡入 → 上飘 → 淡出 0.8s 后自动移除。只做表现，不参与任何战斗计算。
  const floatActive = new WeakMap();
  const FLOAT_LABEL = { normal: '攻击', skill: '技能', crit: '暴击', lifesteal: '吸血', miss: '闪避' };
  function showFloatingText(target, text, type, opts) {
    const host = target === 'pet' ? $('pet-icon') : $('enemy-icon');
    if (!host) return;
    const active = floatActive.get(host) || 0;
    if (active >= 3) {
      setTimeout(() => showFloatingText(target, text, type, opts), 120);
      return;
    }
    floatActive.set(host, active + 1);
    const el = document.createElement('div');
    el.className = 'fs-float ' + (type || 'normal') + (opts && opts.side === 'right' ? ' side-right' : '');
    const label = (opts && opts.label) || FLOAT_LABEL[type] || '攻击';
    const sign = type === 'lifesteal' ? '+' : type === 'miss' ? '' : '-';
    el.textContent = type === 'miss' ? label : `${label}：${sign}${text}`;
    host.appendChild(el);
    setTimeout(() => {
      el.remove();
      floatActive.set(host, Math.max(0, (floatActive.get(host) || 1) - 1));
    }, 850);
  }

  // battle.js 结算时调用（伤害/暴击/吸血实际生效那一刻）→ 转飘字；业务计算零改动
  function showDamage(target, damage, type, label) {
    if (type === 'crit') {
      StageFx().flash('stage-shake', 300); // 暴击：舞台震屏
      StageFx().flash('crit-impact', 400); // 暴击：屏幕边缘红脉冲
    }
    // 命中才有痕迹：闪避（miss）与吸血回血（lifesteal，飘在出手者身上）都不播
    // ⚠️ 判存在是必须的：约 30 个测试 harness 只加载 ui-battle.js 系列、没加载 js/fx/hit-fx.js（可选模块写法）
    if (type !== 'miss' && type !== 'lifesteal' && window.HitFx) window.HitFx.play(target);
    // label：自定义飘字标签（如主动技能名"腐蚀喷吐：-1500"）；吸血固定右侧错位
    showFloatingText(target, damage, type || 'normal', type === 'lifesteal' ? { side: 'right' } : (label ? { label: label } : null));
  }

  UI.animateAttack = animateAttack;
  UI.attackRecoverMs = attackRecoverMs;
  UI.animateHit = animateHit;
  UI.showDamage = showDamage;
  UI.showFloatingText = showFloatingText;
})();
