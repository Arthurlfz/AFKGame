# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('js/core/battle.js?v=20260915mech7', 'js/core/battle.js?v=20260915mech8', 1)
s = s.replace('V: "20260915k"', 'V: "20260915l"', 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('游戏.html: battle mech8 / V 20260915l')
p2 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s2 = io.open(p2, encoding='utf-8').read()
s2 = s2.replace("V: '20260915k'", "V: '20260915l'", 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('pet-sprites.js V -> 20260915l')
