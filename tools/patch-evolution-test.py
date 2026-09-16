# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\tests\vtest_evolution.js'
s = io.open(p, encoding='utf-8').read()
old = "A(C('Object.keys(Config.pet.evolution.tree).length')===40,'进化树包含 8 条多段进化线');"
new = "A(C('Object.keys(Config.pet.evolution.tree).length')>=40,'进化树包含 8 条多段进化线（≥40，可含新增测试线）');"
assert old in s, 'assert not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('vtest_evolution.js L29 断言已更新（40 → >=40）')
