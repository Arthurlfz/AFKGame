# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\tests\vtest_pet_anim.js'
s = io.open(p, encoding='utf-8').read()
old = """PS.setAnim(anim, 'attack');
A(restarts === 1 && anim.dataset.anim === 'attack', '切到 attack 会换图并重播');
PS.setAnim(anim, 'attack');
A(restarts === 1, '重复切同一动作不重启动画（避免攻击途中被重置）');
PS.setAnim(anim, 'idle');
A(restarts === 2 && /idle/.test(anim.style.backgroundImage), '切回 idle 换回 idle 图并重播');"""
new = """PS.setAnim(anim, 'attack');
A(/attack/.test(anim.style.backgroundImage) && anim.dataset.anim === 'attack',
  '切到 attack 会换图并 JS 逐帧播放（playFrames，不依赖 CSS steps）');
PS.setAnim(anim, 'attack');
A(/attack/.test(anim.style.backgroundImage), '重复切同一动作不重启动画（JS 播放器幂等）');
PS.setAnim(anim, 'idle');
A(restarts === 1 && /idle/.test(anim.style.backgroundImage), '切回 idle 换回 idle 图并重播');"""
assert old in s, '断言段未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('vtest_pet_anim.js 断言已更新')
