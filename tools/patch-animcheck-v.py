# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\anim-check.html'
s = io.open(p, encoding='utf-8').read()
s = s.replace('版本徽标：v20260915i', '版本徽标：v20260915l')
s = s.replace('V: "20260915i"', 'V: "20260915l"')
io.open(p, 'w', encoding='utf-8').write(s)
print('anim-check V -> 20260915l')
