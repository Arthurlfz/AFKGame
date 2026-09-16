# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\anim-check.html'
s = io.open(p, encoding='utf-8').read()

old_set = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; node.dataset.anim = act; this.paintAnim(node, a[act]); this.restartAnim(node); },'''
new_set = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },
  playFrames: function (node, act, onDone) { if (!node) return; var anim = node.dataset.petName && this.animOf(node.dataset.petName); var x = anim && anim[act]; if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; } node.dataset.anim = act; this.paintAnim(node, x); node.style.animation = "none"; if (node.__raf) cancelAnimationFrame(node.__raf); var n = x.frames, durMs = (parseFloat(x.dur) || 1.6) * 1000, start = null; node.style.backgroundPosition = "0% 0"; var step = function (ts) { if (start === null) start = ts; var p = (ts - start) / durMs; if (p >= 1) { node.style.backgroundPosition = "100% 0"; node.__raf = null; if (onDone) onDone(); return; } var idx = Math.min(n - 1, Math.floor(p * n)); node.style.backgroundPosition = ((idx / (n - 1)) * 100).toFixed(2) + "% 0"; node.__raf = requestAnimationFrame(step); }; node.__raf = requestAnimationFrame(step); },'''
assert old_set in s, 'anim-check setAnim 未匹配'
s = s.replace(old_set, new_set, 1)

old_v = '  V: "20260915g",'
new_v = '  V: "20260915i",'
assert old_v in s, 'anim-check V 未匹配'
s = s.replace(old_v, new_v, 1)

old_h = '<h3>墨渊魔君 · 16帧攻击动画实测（不登录、不连服务器，不影响你的游戏）</h3>'
new_h = ('<h3>墨渊魔君 · 16帧攻击动画实测（不登录、不连服务器，不影响你的游戏）</h3>\n'
         '<div style="color:#ffcf6b;font-size:13px;margin-bottom:6px;">版本徽标：v20260915i（rAF 帧同步播放器）—— 这里如果不是 i，说明页面是旧缓存，请 Ctrl+F5 强刷</div>')
assert old_h in s, 'anim-check h3 未匹配'
s = s.replace(old_h, new_h, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('anim-check.html: rAF 播放器 + 版本徽标 v20260915i ✓')
