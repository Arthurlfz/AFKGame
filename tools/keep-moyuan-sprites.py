# -*- coding: utf-8 -*-
"""回退后单独保留墨灵进化线立绘映射（用户拍板方向，非战斗画面）：
- pet-sprites.js：map/avatarMap 加墨灵 4 条；V 升 20260915n
- 游戏.html：no-cache meta + 内联 PetSprites map/avatarMap 加墨灵 4 条；V 升 20260915n
animMap 不加（墨渊魔君回到静态立绘 + CSS 突进演出 = 会话前方式）"""
import io

# ---------- pet-sprites.js ----------
p = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s = io.open(p, encoding='utf-8').read()

old_map = '  "腐噜兽": "assets/pets/pack0-base/monster-00.png",'
new_map = ('  "墨灵": "assets/pets/pack9-moyuan/墨灵.png",\n'
           '  "墨影": "assets/pets/pack9-moyuan/墨影.png",\n'
           '  "墨煞": "assets/pets/pack9-moyuan/墨煞.png",\n'
           '  "墨渊魔君": "assets/pets/pack9-moyuan/墨渊魔君.png",\n'
           + old_map)
assert s.count(old_map) == 1, 'pet-sprites map 锚点不唯一'
s = s.replace(old_map, new_map, 1)

old_av = '  avatarMap: {\n  "腐噜兽": "assets/pets/avatars/pack0-base/腐噜兽.png",'
new_av = ('  avatarMap: {\n'
          '  "墨灵": "assets/pets/avatars/pack9-moyuan/墨灵.png",\n'
          '  "墨影": "assets/pets/avatars/pack9-moyuan/墨影.png",\n'
          '  "墨煞": "assets/pets/avatars/pack9-moyuan/墨煞.png",\n'
          '  "墨渊魔君": "assets/pets/avatars/pack9-moyuan/墨渊魔君.png",\n'
          + '  "腐噜兽": "assets/pets/avatars/pack0-base/腐噜兽.png",')
assert old_av in s, 'pet-sprites avatarMap 锚点未匹配'
s = s.replace(old_av, new_av, 1)

old_v = "  V: '20260910a',"
assert old_v in s, 'pet-sprites V 未匹配'
s = s.replace(old_v, "  V: '20260915n',", 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('✓ pet-sprites.js 墨灵立绘加回 + V=20260915n')

# ---------- 游戏.html ----------
p2 = r'D:\Ai\游戏原型\docs\游戏.html'
s2 = io.open(p2, encoding='utf-8').read()

# no-cache meta（防"改了看不到"历史坑）
old_meta = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
new_meta = old_meta + '\n<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n<meta http-equiv="Pragma" content="no-cache">\n<meta http-equiv="Expires" content="0">'
assert old_meta in s2, '游戏.html meta 未匹配'
s2 = s2.replace(old_meta, new_meta, 1)

# 内联 PetSprites：V + map + avatarMap（一行 JSON 式，锚点取 HEAD 版内联的开头）
old_v2 = '  V: "20260910a",'
assert old_v2 in s2, '游戏.html 内联 V 未匹配'
s2 = s2.replace(old_v2, '  V: "20260915n",', 1)

old_map2 = '"腐噜兽":"assets/pets/pack0-base/monster-00.png"'
assert old_map2 in s2, '游戏.html 内联 map 锚点未匹配'
s2 = s2.replace(old_map2, '"墨灵":"assets/pets/pack9-moyuan/墨灵.png","墨影":"assets/pets/pack9-moyuan/墨影.png","墨煞":"assets/pets/pack9-moyuan/墨煞.png","墨渊魔君":"assets/pets/pack9-moyuan/墨渊魔君.png","腐噜兽":"assets/pets/pack0-base/monster-00.png"', 1)

old_av2 = '"腐噜兽":"assets/pets/avatars/pack0-base/腐噜兽.png"'
assert old_av2 in s2, '游戏.html 内联 avatarMap 锚点未匹配'
s2 = s2.replace(old_av2, '"墨灵":"assets/pets/avatars/pack9-moyuan/墨灵.png","墨影":"assets/pets/avatars/pack9-moyuan/墨影.png","墨煞":"assets/pets/avatars/pack9-moyuan/墨煞.png","墨渊魔君":"assets/pets/avatars/pack9-moyuan/墨渊魔君.png","腐噜兽":"assets/pets/avatars/pack0-base/腐噜兽.png"', 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('✓ 游戏.html no-cache + 内联墨灵立绘 + V=20260915n')
