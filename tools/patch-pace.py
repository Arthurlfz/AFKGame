# -*- coding: utf-8 -*-
"""节奏对齐 16 帧动画：PACE.pet charge 220→500（蓄力走完动画蓄力段，出手时正好到发力帧）；
HIT_HOLD 300→400（冲到怪物面前停住释放能量斩）。敌方 PACE 不动（保"变异体前摇更长"断言）。"""
import io
p = r'D:\Ai\游戏原型\docs\js\ui\ui-battle.js'
s = io.open(p, encoding='utf-8').read()
old1 = "    pet:     { charge: 220, speed: 1800, back: 0.30 },"
new1 = "    pet:     { charge: 500, speed: 1800, back: 0.30 }, // 我方：蓄力走完动画蓄力段（16帧~0.6s），出手时动画正好到发力帧"
assert old1 in s, 'PACE.pet 未匹配'
s = s.replace(old1, new1, 1)
old2 = "    const HIT_HOLD = 300; // 命中定格（毫秒）：帧3停留，让玩家看清出手帧和伤害数字（压到挂机效率基准内）"
new2 = "    const HIT_HOLD = 400; // 命中定格（毫秒）：冲到怪物面前停住释放能量斩（动画 1.6s 的释放段），让玩家看清出手和伤害"
assert old2 in s, 'HIT_HOLD 未匹配'
s = s.replace(old2, new2, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ui-battle.js: pet charge 500 / HIT_HOLD 400 ✓')
