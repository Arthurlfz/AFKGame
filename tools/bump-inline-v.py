# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('V: "20260915c"', 'V: "20260915d"', 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('内联 V -> 20260915d')
