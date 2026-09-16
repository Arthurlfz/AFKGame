# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\tests\vtest_pet_anim.js'
s = io.open(p, encoding='utf-8').read()
old = """const anim = host.querySelector('.pet-anim');
A(!!anim && anim.className === 'pet-anim', '挂载产物含 .pet-anim（内层管逐帧）');
const move = host.children[0];
A(!!move && move.className === 'pet-anim-move', '外层是 .pet-anim-move（管突进位移，两层拆开让手动控帧不挡位移）');"""
new = """const move = host.children[0];
A(!!move && move.className === 'pet-anim-move', '外层是 .pet-anim-move（管突进位移，两层拆开让手动控帧不挡位移）');
const anim = move && move.children[0];
A(!!anim && anim.className === 'pet-anim', '内层是 .pet-anim（管逐帧）');"""
assert old in s, '未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('测试断言改为两层访问')
