# -*- coding: utf-8 -*-
import io

# 1) 游戏版本 bump h -> i
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('game.css?v=20260915anim6', 'game.css?v=20260915anim7', 1)
s = s.replace('ui-battle.js?v=20260915anim4', 'ui-battle.js?v=20260915anim5', 1)
s = s.replace('V: "20260915h"', 'V: "20260915i"', 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('游戏.html: css anim7 / ui-battle anim5 / V 20260915i')
p2 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s2 = io.open(p2, encoding='utf-8').read()
s2 = s2.replace("V: '20260915h'", "V: '20260915i'", 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('pet-sprites.js V -> 20260915i')

# 2) 测试桩补 rAF
pt = r'D:\Ai\游戏原型\docs\tests\vtest_pet_anim.js'
st = io.open(pt, encoding='utf-8').read()
old = 'const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, navigator: {},'
new = 'const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, navigator: {},'
assert old in st, '测试桩 ctx 未匹配'
st = st.replace(old, new, 1)
io.open(pt, 'w', encoding='utf-8').write(st)
print('vtest_pet_anim.js 测试桩补 rAF ✓')
