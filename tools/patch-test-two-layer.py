# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\tests\vtest_pet_anim.js'
s = io.open(p, encoding='utf-8').read()
old = "const anim = host.children[0];\nA(!!anim && anim.className === 'pet-anim', '挂载产物的类名是 .pet-anim');"
new = "const anim = host.querySelector('.pet-anim');\nA(!!anim && anim.className === 'pet-anim', '挂载产物含 .pet-anim（内层管逐帧）');\nconst move = host.children[0];\nA(!!move && move.className === 'pet-anim-move', '外层是 .pet-anim-move（管突进位移，两层拆开让手动控帧不挡位移）');"
assert old in s, '未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('测试断言已更新')
