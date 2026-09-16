# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()

# 1) setAnim 改：非 idle 走 JS 逐帧
old_set = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; node.dataset.anim = act; this.paintAnim(node, a[act]); this.restartAnim(node); },'''
new_set = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; clearInterval(node.__playTimer); this.paintAnim(node, a[act]); this.restartAnim(node); },
  playFrames: function (node, act, onDone) { if (!node) return; var anim = node.dataset.petName && this.animOf(node.dataset.petName); var x = anim && anim[act]; if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; } node.dataset.anim = act; this.paintAnim(node, x); node.style.animation = "none"; clearInterval(node.__playTimer); var n = x.frames, i = 0, durMs = (parseFloat(x.dur) || 1.6) * 1000, step = durMs / n; node.style.backgroundPosition = "0% 0"; node.__playTimer = setInterval(function () { i++; if (i >= n) { clearInterval(node.__playTimer); node.style.backgroundPosition = "100% 0"; if (onDone) onDone(); return; } node.style.backgroundPosition = ((i / (n - 1)) * 100).toFixed(2) + "% 0"; }, step); },'''
assert old_set in s, '内联 setAnim 未匹配'
s = s.replace(old_set, new_set, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('游戏.html 内联: playFrames + setAnim 改 JS 逐帧 ✓')
