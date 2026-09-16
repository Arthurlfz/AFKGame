# -*- coding: utf-8 -*-
"""playFrames 从 setInterval 改 requestAnimationFrame（帧同步驱动，豆包内置浏览器最可靠）；
anim-check.html 加版本徽标。三处同步。"""
import io

def patch_ext(path, label):
    s = io.open(path, encoding='utf-8').read()
    old = """  playFrames: function (node, act, onDone) {
    if (!node) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    var x = anim && anim[act];
    if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; }
    node.dataset.anim = act;
    this.paintAnim(node, x);
    node.style.animation = 'none';
    clearInterval(node.__playTimer);
    var n = x.frames, i = 0;
    var durMs = (parseFloat(x.dur) || 1.6) * 1000;
    var step = durMs / n;
    node.style.backgroundPosition = '0% 0';
    node.__playTimer = setInterval(function () {
      i++;
      if (i >= n) {
        clearInterval(node.__playTimer);
        node.style.backgroundPosition = '100% 0';
        if (onDone) onDone();
        return;
      }
      node.style.backgroundPosition = ((i / (n - 1)) * 100).toFixed(2) + '% 0';
    }, step);
  },"""
    new = """  playFrames: function (node, act, onDone) {
    if (!node) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    var x = anim && anim[act];
    if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; }
    node.dataset.anim = act;
    this.paintAnim(node, x);
    node.style.animation = 'none';
    if (node.__raf) cancelAnimationFrame(node.__raf);
    var n = x.frames, durMs = (parseFloat(x.dur) || 1.6) * 1000, start = null;
    node.style.backgroundPosition = '0% 0';
    var step = function (ts) {
      if (start === null) start = ts;
      var p = (ts - start) / durMs;
      if (p >= 1) {
        node.style.backgroundPosition = '100% 0';
        node.__raf = null;
        if (onDone) onDone();
        return;
      }
      var idx = Math.min(n - 1, Math.floor(p * n));
      node.style.backgroundPosition = ((idx / (n - 1)) * 100).toFixed(2) + '% 0';
      node.__raf = requestAnimationFrame(step);
    };
    node.__raf = requestAnimationFrame(step);
  },"""
    assert old in s, label + ': playFrames 未匹配'
    s = s.replace(old, new, 1)
    # setAnim 里 clearInterval 改 cancelAnimationFrame
    old2 = "    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧（必播）\n    node.dataset.anim = act;\n    clearInterval(node.__playTimer);"
    new2 = "    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧（必播）\n    node.dataset.anim = act;\n    if (node.__raf) cancelAnimationFrame(node.__raf);"
    assert old2 in s, label + ': setAnim clear 未匹配'
    s = s.replace(old2, new2, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(label + ': playFrames 改 rAF ✓')

patch_ext(r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js', 'pet-sprites.js')

# ---------- 游戏.html 内联 ----------
p2 = r'D:\Ai\游戏原型\docs\游戏.html'
s2 = io.open(p2, encoding='utf-8').read()
old_in = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; clearInterval(node.__playTimer); this.paintAnim(node, a[act]); this.restartAnim(node); },
  playFrames: function (node, act, onDone) { if (!node) return; var anim = node.dataset.petName && this.animOf(node.dataset.petName); var x = anim && anim[act]; if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; } node.dataset.anim = act; this.paintAnim(node, x); node.style.animation = "none"; clearInterval(node.__playTimer); var n = x.frames, i = 0, durMs = (parseFloat(x.dur) || 1.6) * 1000, step = durMs / n; node.style.backgroundPosition = "0% 0"; node.__playTimer = setInterval(function () { i++; if (i >= n) { clearInterval(node.__playTimer); node.style.backgroundPosition = "100% 0"; if (onDone) onDone(); return; } node.style.backgroundPosition = ((i / (n - 1)) * 100).toFixed(2) + "% 0"; }, step); },'''
new_in = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },
  playFrames: function (node, act, onDone) { if (!node) return; var anim = node.dataset.petName && this.animOf(node.dataset.petName); var x = anim && anim[act]; if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; } node.dataset.anim = act; this.paintAnim(node, x); node.style.animation = "none"; if (node.__raf) cancelAnimationFrame(node.__raf); var n = x.frames, durMs = (parseFloat(x.dur) || 1.6) * 1000, start = null; node.style.backgroundPosition = "0% 0"; var step = function (ts) { if (start === null) start = ts; var p = (ts - start) / durMs; if (p >= 1) { node.style.backgroundPosition = "100% 0"; node.__raf = null; if (onDone) onDone(); return; } var idx = Math.min(n - 1, Math.floor(p * n)); node.style.backgroundPosition = ((idx / (n - 1)) * 100).toFixed(2) + "% 0"; node.__raf = requestAnimationFrame(step); }; node.__raf = requestAnimationFrame(step); },'''
assert old_in in s2, '游戏.html 内联 playFrames 未匹配'
s2 = s2.replace(old_in, new_in, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('游戏.html 内联: playFrames 改 rAF ✓')
