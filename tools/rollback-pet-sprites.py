# -*- coding: utf-8 -*-
import io

p = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s = io.open(p, encoding='utf-8').read()

# 1. mountAnimated 恢复原逻辑
old = '''  mountAnimated: function (el, name) {
    if (!el) return false;
    var anim = this.animOf(name);
    if (!anim || !anim.idle) return false;
    // demo 标记的形态在 ANIM_ENABLED=false 时也放行（其余保持静态立绘）
    if (!this.ANIM_ENABLED && !anim.demo) return false;'''
new = '''  mountAnimated: function (el, name) {
    if (!el || !this.ANIM_ENABLED) return false;
    var anim = this.animOf(name);
    if (!anim || !anim.idle) return false;'''
assert old in s, 'mountAnimated block not found'
s = s.replace(old, new)

# 2. map 恢复
old2 = '"剧毒魔君": "assets/pets/demo-shadowlord/monster-05.png",'
new2 = '"剧毒魔君": "assets/pets/pack5-rotten/monster-05.png",'
assert old2 in s, 'map not found'
s = s.replace(old2, new2)

# 3. avatarMap 恢复
old3 = '"剧毒魔君": "assets/pets/avatars/demo-shadowlord/剧毒魔君.png",'
new3 = '"剧毒魔君": "assets/pets/avatars/pack5-rotten/剧毒魔君.png",'
assert old3 in s, 'avatarMap not found'
s = s.replace(old3, new3)

# 4. animMap 删除 demo 条目
old4 = '''  animMap: {
  "剧毒魔君": {
    idle:   { sheet: "assets/pets/anim/demo-shadowlord/idle.png",   frames: 1, dur: "2s" },
    attack: { sheet: "assets/pets/anim/demo-shadowlord/attack.png", frames: 3, dur: "0.75s" },
    demo: true
  },
'''
new4 = '  animMap: {\n'
assert old4 in s, 'animMap entry not found'
s = s.replace(old4, new4, 1)

# 5. V 恢复
s = s.replace("V: '20260915a',", "V: '20260910a',")

io.open(p, 'w', encoding='utf-8').write(s)
print('pet-sprites.js 已完全回滚')
