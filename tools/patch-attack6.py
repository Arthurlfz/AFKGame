# -*- coding: utf-8 -*-
"""攻击 3 帧 → 6 帧接入：animMap 指向 attack6.png + 演出帧索引更新 + pet-anim-move 待机呼吸"""
import io

# ---------- 1. animMap：墨渊魔君 attack 3帧 -> 6帧（外置 + 内联） ----------
def patch_animmap(path, label, inline=False):
    s = io.open(path, encoding='utf-8').read()
    if inline:
        old = '"墨渊魔君":{idle:{sheet:"assets/pets/anim/pack9-moyuan/idle.png",frames:1,dur:"2s"},attack:{sheet:"assets/pets/anim/pack9-moyuan/attack.png",frames:3,dur:"0.75s"},demo:true}'
        new = '"墨渊魔君":{idle:{sheet:"assets/pets/anim/pack9-moyuan/idle.png",frames:1,dur:"2s"},attack:{sheet:"assets/pets/anim/pack9-moyuan/attack6.png",frames:6,dur:"1.2s"},demo:true}'
    else:
        old = '''  "墨渊魔君": {
    idle:   { sheet: "assets/pets/anim/pack9-moyuan/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/pack9-moyuan/attack.png", frames: 3, dur: "0.75s" },
    demo: true
  }'''
        new = '''  "墨渊魔君": {
    idle:   { sheet: "assets/pets/anim/pack9-moyuan/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/pack9-moyuan/attack6.png", frames: 6, dur: "1.2s" },
    demo: true
  }'''
    assert old in s, label + ': animMap 未匹配'
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(label + ': attack 3帧 -> 6帧')

patch_animmap(r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js', 'pet-sprites.js')
patch_animmap(r'D:\Ai\游戏原型\docs\游戏.html', '游戏.html 内联', inline=True)

# ---------- 2. ui-battle.js：show 帧索引对齐 6 帧（蓄力0 / 挥出2 / 命中4 / 收招5） ----------
p2 = r'D:\Ai\游戏原型\docs\js\ui\ui-battle.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = '''    // 阶段1：蓄力停顿（帧1）
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
    }, pace.charge);'''
new2 = '''    // 阶段1：蓄力停顿（帧1/2：蓄力起手 → 蓄力最深）
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
assert old2 in s2, 'ui-battle.js 帧索引段未匹配'
s2 = s2.replace(old2, new2, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('ui-battle.js: 帧索引对齐 6 帧（0/2/4/5）')

# ---------- 3. game.css：.pet-anim-move 待机呼吸（浮沉） ----------
p3 = r'D:\Ai\游戏原型\docs\css\game.css'
s3 = io.open(p3, encoding='utf-8').read()
old3 = '''.pet-anim-move {
  display:block; width:100%; height:100%;
}'''
new3 = '''.pet-anim-move {
  display:block; width:100%; height:100%;
  /* 待机呼吸：动画立绘单帧时靠外层浮沉给"活物感"（与帧动画/突进位移不冲突：animation 会被 charging/attacking 规则覆盖） */
  animation: pet-idle-float 2.6s ease-in-out infinite;
}
@keyframes pet-idle-float {
  0%,100% { transform:translateY(0); }
  50%     { transform:translateY(-1.5%); }
}'''
assert old3 in s3, 'game.css .pet-anim-move 未匹配'
s3 = s3.replace(old3, new3, 1)
io.open(p3, 'w', encoding='utf-8').write(s3)
print('game.css: pet-anim-move 待机呼吸')
