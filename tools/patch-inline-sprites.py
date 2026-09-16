# -*- coding: utf-8 -*-
"""同步墨渊线到 游戏.html 的 PetSprites 内联副本"""
import io

p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()

# 1. mountAnimated 放行 demo（内联副本格式，双引号）
old1 = 'mountAnimated: function (el, n) { if (!el || !this.ANIM_ENABLED) return false; var a = this.animOf(n); if (!a || !a.idle) return false;'
new1 = 'mountAnimated: function (el, n) { if (!el) return false; var a = this.animOf(n); if (!a || !a.idle) return false; if (!this.ANIM_ENABLED && !a.demo) return false;'
assert old1 in s, 'inline mountAnimated not found'
s = s.replace(old1, new1, 1)
print('内联 mountAnimated 放行 demo')

# 2. map 加墨渊4形态（插在 map 开头）
old2 = 'map: {"腐噜兽":"assets/pets/pack0-base/monster-00.png"'
new2 = ('map: {"墨灵":"assets/pets/pack9-moyuan/墨灵.png","墨影":"assets/pets/pack9-moyuan/墨影.png",'
        '"墨煞":"assets/pets/pack9-moyuan/墨煞.png","墨渊魔君":"assets/pets/pack9-moyuan/墨渊魔君.png",'
        '"腐噜兽":"assets/pets/pack0-base/monster-00.png"')
assert old2 in s, 'inline map not found'
s = s.replace(old2, new2, 1)
print('内联 map + 墨渊4形态')

# 3. animMap 加墨渊魔君（插在 animMap 开头）
old3 = 'animMap: {"影刃兔":{idle:{sheet:"assets/pets/anim/pack3-shadowrabbit/monster-00-idle.png"'
new3 = ('animMap: {"墨渊魔君":{idle:{sheet:"assets/pets/anim/pack9-moyuan/idle.png",frames:1,dur:"2s"},'
        'attack:{sheet:"assets/pets/anim/pack9-moyuan/attack.png",frames:3,dur:"0.75s"},demo:true},'
        '"影刃兔":{idle:{sheet:"assets/pets/anim/pack3-shadowrabbit/monster-00-idle.png"')
assert old3 in s, 'inline animMap not found'
s = s.replace(old3, new3, 1)
print('内联 animMap + 墨渊魔君')

# 4. avatarMap 加墨渊4形态（插在 avatarMap 开头）
old4 = 'avatarMap: {"腐噜兽":"assets/pets/avatars/pack0-base/腐噜兽.png"'
new4 = ('avatarMap: {"墨灵":"assets/pets/avatars/pack9-moyuan/墨灵.png","墨影":"assets/pets/avatars/pack9-moyuan/墨影.png",'
        '"墨煞":"assets/pets/avatars/pack9-moyuan/墨煞.png","墨渊魔君":"assets/pets/avatars/pack9-moyuan/墨渊魔君.png",'
        '"腐噜兽":"assets/pets/avatars/pack0-base/腐噜兽.png"')
assert old4 in s, 'inline avatarMap not found'
s = s.replace(old4, new4, 1)
print('内联 avatarMap + 墨渊4形态')

io.open(p, 'w', encoding='utf-8').write(s)
print('游戏.html 内联副本同步完成')
