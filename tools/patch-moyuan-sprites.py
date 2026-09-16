# -*- coding: utf-8 -*-
"""pet-sprites.js：加墨渊线 4 形态立绘/头像映射 + 墨渊魔君攻击动画"""
import io

p = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s = io.open(p, encoding='utf-8').read()

# 1. 版本号
if "V: '20260915b'" in s:
    print('V 已是最新')
else:
    old_v = "V: '20260910a',"
    assert old_v in s, 'V not found'
    s = s.replace(old_v, "V: '20260915b',", 1)
    print('V -> 20260915b')

# 2. map：加 4 形态立绘（插在 map 开头）
if '"墨灵": "assets/pets/pack9-moyuan/墨灵.png"' in s:
    print('map 已存在')
else:
    old_m = '  map:\n  {\n'
    new_m = '''  map: {
  "墨灵": "assets/pets/pack9-moyuan/墨灵.png",
  "墨影": "assets/pets/pack9-moyuan/墨影.png",
  "墨煞": "assets/pets/pack9-moyuan/墨煞.png",
  "墨渊魔君": "assets/pets/pack9-moyuan/墨渊魔君.png",
'''
    assert old_m in s, 'map open not found'
    s = s.replace(old_m, new_m, 1)
    print('map + 墨渊线 4 形态')

# 3. animMap：墨渊魔君 demo 动画（idle 单帧 + attack 3帧）
if '"墨渊魔君": {' in s:
    print('animMap 已存在')
else:
    old_a = '  animMap: {\n'
    new_a = '''  animMap: {
  "墨渊魔君": {
    idle:   { sheet: "assets/pets/anim/pack9-moyuan/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/pack9-moyuan/attack.png", frames: 3, dur: "0.75s" },
    demo: true
  },
'''
    assert old_a in s, 'animMap open not found'
    s = s.replace(old_a, new_a, 1)
    print('animMap + 墨渊魔君（idle 单帧 + attack 3帧 demo）')

# 4. avatarMap：加 4 形态头像
if '"墨灵": "assets/pets/avatars/pack9-moyuan/墨灵.png"' in s:
    print('avatarMap 已存在')
else:
    old_av = '  avatarMap: {\n'
    new_av = '''  avatarMap: {
  "墨灵": "assets/pets/avatars/pack9-moyuan/墨灵.png",
  "墨影": "assets/pets/avatars/pack9-moyuan/墨影.png",
  "墨煞": "assets/pets/avatars/pack9-moyuan/墨煞.png",
  "墨渊魔君": "assets/pets/avatars/pack9-moyuan/墨渊魔君.png",
'''
    assert old_av in s, 'avatarMap open not found'
    s = s.replace(old_av, new_av, 1)
    print('avatarMap + 墨渊线 4 形态')

io.open(p, 'w', encoding='utf-8').write(s)
print('pet-sprites.js 完成')
