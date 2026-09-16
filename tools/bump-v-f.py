# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('game.css?v=20260915anim3', 'game.css?v=20260915anim4', 1)
s = s.replace('ui-battle.js?v=20260915anim1', 'ui-battle.js?v=20260915anim2', 1)
s = s.replace('V: "20260915e"', 'V: "20260915f"', 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('游戏.html: css anim4 / ui-battle anim2 / V 20260915f')
p2 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s2 = io.open(p2, encoding='utf-8').read()
s2 = s2.replace("V: '20260915e'", "V: '20260915f'", 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('pet-sprites.js V -> 20260915f')
