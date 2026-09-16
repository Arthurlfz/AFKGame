# -*- coding: utf-8 -*-
"""Meowa 16 帧攻击动画接入：animMap 指向 attack16 + animateAttack 改自动播放"""
import io

def patch_animmap(path, label, inline=False):
    s = io.open(path, encoding='utf-8').read()
    if inline:
        old = '"墨渊魔君":{idle:{sheet:"assets/pets/anim/pack9-moyuan/idle.png",frames:1,dur:"2s"},attack:{sheet:"assets/pets/anim/pack9-moyuan/attack6.png",frames:6,dur:"1.2s"},demo:true}'
        new = '"墨渊魔君":{idle:{sheet:"assets/pets/anim/pack9-moyuan/idle.png",frames:1,dur:"2s"},attack:{sheet:"assets/pets/anim/pack9-moyuan/attack16.png",frames:16,dur:"1.6s"},demo:true}'
    else:
        old = '''  "墨渊魔君": {
    idle:   { sheet: "assets/pets/anim/pack9-moyuan/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/pack9-moyuan/attack6.png", frames: 6, dur: "1.2s" },
    demo: true
  }'''
        new = '''  "墨渊魔君": {
    idle:   { sheet: "assets/pets/anim/pack9-moyuan/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/pack9-moyuan/attack16.png", frames: 16, dur: "1.6s" },
    demo: true
  }'''
    assert old in s, label + ': animMap 未匹配'
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(label + ': attack -> attack16 (16帧 1.6s)')

patch_animmap(r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js', 'pet-sprites.js')
patch_animmap(r'D:\Ai\游戏原型\docs\游戏.html', '游戏.html 内联', inline=True)

# ---------- animateAttack：自动播放版 ----------
p2 = r'D:\Ai\游戏原型\docs\js\ui\ui-battle.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = '''    const node = icon && icon.querySelector('.pet-anim');
    const show = (f) => { if (node && PetSprites && PetSprites.showFrame) PetSprites.showFrame(node, f); };
    // 阶段1：蓄力停顿（帧1/2：蓄力起手 → 蓄力最深）
    icon.classList.add('charging');
    show(0);
    icon.__chargeT = setTimeout(() => {
      // 阶段2：冲刺到对方脸上（帧3/4：挥出 → 全伸）
      icon.classList.remove('charging');
      icon.classList.add('attacking');
      show(2);
      icon.__attackT = setTimeout(() => {
        // 阶段3：命中定格（帧5，停留 HIT_HOLD 让伤害数字读得清）
        show(4);
        icon.__hitT = setTimeout(() => {
          // 阶段4：收招回位（帧6 收招，dash-back 播完后摘 class + 回待机帧）
          show(5);
          icon.__backT = setTimeout(() => {
            icon.classList.remove('attacking');
            if (node && PetSprites && PetSprites.setAnim) PetSprites.setAnim(node, 'idle');
          }, pace.back * 1000);
        }, HIT_HOLD);
      }, dashMs);
    }, pace.charge);'''
new2 = '''    const node = icon && icon.querySelector('.pet-anim');
    // 有逐帧动画立绘：整段攻击动画自动播放（素材自带蓄力/挥击/特效/收招，16帧 1.6s），
    // CSS 突进只负责跨屏位移，动画内的动作与特效是视觉主角。
    if (node && PetSprites && PetSprites.setAnim) {
      PetSprites.setAnim(node, 'attack');
      const animTotal = pace.charge + dashMs + HIT_HOLD + pace.back * 1000 + 120;
      setTimeout(() => { if (node.isConnected) PetSprites.setAnim(node, 'idle'); }, animTotal);
    }
    // 阶段1：蓄力停顿（动画播到蓄力段）
    icon.classList.add('charging');
    icon.__chargeT = setTimeout(() => {
      // 阶段2：冲刺到对方脸上（动画播到发力/释放段）
      icon.classList.remove('charging');
      icon.classList.add('attacking');
      icon.__attackT = setTimeout(() => {
        // 阶段3：命中定格（动画正好播到命中特效段，停留让伤害数字读得清）
        icon.__hitT = setTimeout(() => {
          // 阶段4：收招回位（dash-back 播完摘 class；动画自己收尾）
          icon.__backT = setTimeout(() => icon.classList.remove('attacking'), pace.back * 1000);
        }, HIT_HOLD);
      }, dashMs);
    }, pace.charge);'''
assert old2 in s2, 'ui-battle.js 手动帧段未匹配'
s2 = s2.replace(old2, new2, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('ui-battle.js: 攻击动画改自动播放（16帧）')
