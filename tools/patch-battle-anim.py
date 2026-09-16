# -*- coding: utf-8 -*-
"""动画表现重构：ui-battle.js 攻击四段式（蓄力停帧→冲刺→命中定格→回位）"""
import io

p = r'D:\Ai\游戏原型\docs\js\ui\ui-battle.js'
s = io.open(p, encoding='utf-8').read()

# ---- 1. PACE.pet 蓄力停顿 160 → 380ms（让玩家看清出手前摇）----
old1 = "    pet:     { charge: 160, speed: 1800, back: 0.30 }, // 路边小怪：快、轻、收招利索"
new1 = "    pet:     { charge: 380, speed: 1800, back: 0.30 }, // 蓄力停顿拉长：让玩家看清出手帧（2026-09-15 赛尔号式）"
if old1 in s:
    s = s.replace(old1, new1, 1)
    print('PACE.pet.charge 160 -> 380')
else:
    print('⚠️ PACE.pet 行未匹配，跳过（注释可能不同）')
    # 尝试宽松匹配
    import re
    m = re.search(r"pet:\s*\{ charge: \d+, speed: 1800, back: [\d.]+\s*\}", s)
    if m:
        s = s.replace(m.group(0), "pet:     { charge: 380, speed: 1800, back: 0.30 }", 1)
        print('PACE.pet 宽松匹配替换成功')

# ---- 2. animateAttack 整段重构 ----
old2 = '''  function animateAttack(attacker, holdMs) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const foe = attacker === 'pet' ? $('enemy-icon') : $('pet-icon');
    if (!icon) { lastBackMs = 0; return 0; }
    const pace = paceOf(attacker);
    holdMs = holdMs || 0; lastBackMs = Math.round(pace.back * 1000) + holdMs;
    const dashMs = setDashDistance(icon, foe, attacker, pace.speed);
    icon.style.setProperty('--dash-charge', (pace.charge / 1000).toFixed(3) + 's');
    icon.style.setProperty('--dash-back', pace.back.toFixed(3) + 's');
    /* 前摇（蓄力压扁）→ 扑击（冲到对方脸上）→ 后摇（收招回位）。
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
      icon.__attackT = setTimeout(() => icon.classList.remove('attacking'), dashMs + holdMs + pace.back * 1000);
    }, pace.charge);
    // 逐帧动画立绘：有攻击帧则切换播一遍（无则维持现有 CSS 突进+刀光）
    const node = icon && icon.querySelector('.pet-anim');
    if (node && PetSprites && PetSprites.setAnim) {
      PetSprites.setAnim(node, 'attack');
      setTimeout(() => { if (node.isConnected) PetSprites.setAnim(node, 'idle'); }, 850);
    }
    // 命中时刻（前摇结束 + 冲到对方脸上）：伤害结算与受击特效都对齐这一刻，
    // 由调用方决定怎么用，表现层不写死——前摇按类型、冲刺按距离，都是变的。
    return pace.charge + dashMs;
  }'''
new2 = '''  function animateAttack(attacker, holdMs) {
    const icon = attacker === 'pet' ? $('pet-icon') : $('enemy-icon');
    const foe = attacker === 'pet' ? $('enemy-icon') : $('pet-icon');
    if (!icon) { lastBackMs = 0; return 0; }
    const pace = paceOf(attacker);
    holdMs = holdMs || 0;
    const HIT_HOLD = 450; // 命中定格（毫秒）：帧3停留，让玩家看清出手帧和伤害数字
    lastBackMs = Math.round(pace.back * 1000) + holdMs + HIT_HOLD;
    const dashMs = setDashDistance(icon, foe, attacker, pace.speed);
    icon.style.setProperty('--dash-charge', (pace.charge / 1000).toFixed(3) + 's');
    icon.style.setProperty('--dash-back', pace.back.toFixed(3) + 's');
    icon.style.setProperty('--dash-hold', (HIT_HOLD / 1000).toFixed(3) + 's'); // 命中定格期间停在对方脸上，再收招回位
    /* 赛尔号式四段演出（逐帧动画立绘）：
     * 蓄力停顿(帧1) → 冲刺到脸前(帧2) → 命中定格(帧3) → 收招回位(idle)。
     * 连击必须先摘旧 class 并强制重排：同名 class 的 CSS 动画不会自己重播，
     * 不重排的话第二次出手会丢掉前摇动作，只剩一段位移。 */
    clearTimeout(icon.__chargeT);
    clearTimeout(icon.__attackT);
    clearTimeout(icon.__hitT);
    clearTimeout(icon.__backT);
    icon.classList.remove('charging', 'attacking');
    void icon.offsetWidth;
    const node = icon && icon.querySelector('.pet-anim');
    const show = (f) => { if (node && PetSprites && PetSprites.showFrame) PetSprites.showFrame(node, f); };
    // 阶段1：蓄力停顿（帧1）
    icon.classList.add('charging');
    show(0);
    icon.__chargeT = setTimeout(() => {
      // 阶段2：冲刺到对方脸上（帧2 挥出）
      icon.classList.remove('charging');
      icon.classList.add('attacking');
      show(1);
      icon.__attackT = setTimeout(() => {
        // 阶段3：命中定格（帧3，停留 HIT_HOLD 让伤害数字读得清）
        show(2);
        icon.__hitT = setTimeout(() => {
          // 阶段4：收招回位（dash-back 播完后摘 class + 回待机帧）
          icon.__backT = setTimeout(() => {
            icon.classList.remove('attacking');
            if (node && PetSprites && PetSprites.setAnim) PetSprites.setAnim(node, 'idle');
          }, pace.back * 1000);
        }, HIT_HOLD);
      }, dashMs);
    }, pace.charge);
    // 命中时刻（前摇结束 + 冲到对方脸上）：伤害结算与受击特效都对齐这一刻，
    // 由调用方决定怎么用，表现层不写死——前摇按类型、冲刺按距离，都是变的。
    return pace.charge + dashMs;
  }'''
assert old2 in s, 'animateAttack 原文未匹配'
s = s.replace(old2, new2, 1)
print('animateAttack 已重构为四段式')

io.open(p, 'w', encoding='utf-8').write(s)
print('ui-battle.js 完成')
