# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\tests\vtest_fun.js'
s = io.open(p, encoding='utf-8').read()
old = "if(data.fights>=5)A(true,`节奏OK：${secPerFight}s/场（speedScale=18 的设计节奏，有来有回不拖沓）`);"
new = ("// 2026-09-15 用户拍板「完整回合演出（出手时双方进度条全停）」→ 挂机效率让位给演出，实测 ≈4 场/60s（15s/场）。\n"
       "//   阈值再降到 3，守「挂机别慢到无感」的下限。\n"
       "if(data.fights>=3)A(true,`节奏OK：${secPerFight}s/场（完整演出节奏，有力量感）`);")
assert old in s, '阈值行未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('vtest_fun 阈值 5->3 ✓')
