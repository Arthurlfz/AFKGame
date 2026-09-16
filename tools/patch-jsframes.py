# -*- coding: utf-8 -*-
"""PetSprites 加 JS 逐帧播放器 playFrames：攻击动画用 setInterval 逐帧驱动 backgroundPosition，
不依赖 CSS steps 动画（豆包内置浏览器对 4096px 大背景图 + steps(16) 兼容不稳 → 用户端不播）。
三处同步：外置 pet-sprites.js / 游戏.html 内联 / anim-check.html。"""
import io, re

def patch_external(path):
    s = io.open(path, encoding='utf-8').read()
    # 1) 在 showFrame 后插入 playFrames
    anchor = """  showFrame: function (node, idx) {
    if (!node) return;
    var a = node.dataset.petName && this.animOf(node.dataset.petName);
    var x = a && (a.attack || a.idle);
    if (!x || !x.sheet || !(x.frames > 1)) return;
    node.style.animation = 'none'; // 停掉自动播放，由演出时序控制帧
    node.style.backgroundPosition = ((idx / (x.frames - 1)) * 100).toFixed(2) + '% 0';
  },"""
    addition = """  showFrame: function (node, idx) {
    if (!node) return;
    var a = node.dataset.petName && this.animOf(node.dataset.petName);
    var x = a && (a.attack || a.idle);
    if (!x || !x.sheet || !(x.frames > 1)) return;
    node.style.animation = 'none'; // 停掉自动播放，由演出时序控制帧
    node.style.backgroundPosition = ((idx / (x.frames - 1)) * 100).toFixed(2) + '% 0';
  },
  // JS 逐帧播放器：不依赖 CSS steps（豆包内置浏览器对大背景图 steps(16) 兼容不稳），
  // 用定时器逐帧切 backgroundPosition，任何浏览器都必然播放；播完停在最后一帧并回调。
  playFrames: function (node, act, onDone) {
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
    assert anchor in s, path + ': showFrame 锚点未匹配'
    s = s.replace(anchor, addition, 1)
    # 2) setAnim 非待机动作走 JS 逐帧
    old_set = """  setAnim: function (node, act) {
    if (!node || !act || node.dataset.anim === act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    node.dataset.anim = act;
    this.paintAnim(node, anim[act]);
    this.restartAnim(node);
  },"""
    new_set = """  setAnim: function (node, act) {
    if (!node || !act || node.dataset.anim === act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧（必播）
    node.dataset.anim = act;
    clearInterval(node.__playTimer);
    this.paintAnim(node, anim[act]);
    this.restartAnim(node);
  },"""
    assert old_set in s, path + ': setAnim 未匹配'
    s = s.replace(old_set, new_set, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(path + ': playFrames 加入 + setAnim 改 JS 逐帧')

patch_external(r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js')

# ---------- 游戏.html 内联（压缩单行） ----------
p2 = r'D:\Ai\游戏原型\docs\游戏.html'
s2 = io.open(p2, encoding='utf-8').read()
old_inline = '''  setAnim:function(node,act){if(!node||!act||node.dataset.anim===act)return;var a=node.dataset.petName&&this.animOf(node.dataset.petName);if(!a||!a[act])return;node.dataset.anim=act;this.paintAnim(node,a[act]);this.restartAnim(node);},'''
new_inline = '''  setAnim:function(node,act){if(!node||!act||node.dataset.anim===act)return;var a=node.dataset.petName&&this.animOf(node.dataset.petName);if(!a||!a[act])return;if(act!=="idle"){this.playFrames(node,act);return;}node.dataset.anim=act;clearInterval(node.__playTimer);this.paintAnim(node,a[act]);this.restartAnim(node);},
  playFrames:function(node,act,onDone){if(!node)return;var anim=node.dataset.petName&&this.animOf(node.dataset.petName);var x=anim&&anim[act];if(!x||!x.sheet||!(x.frames>1)){if(onDone)onDone();return;}node.dataset.anim=act;this.paintAnim(node,x);node.style.animation="none";clearInterval(node.__playTimer);var n=x.frames,i=0,durMs=(parseFloat(x.dur)||1.6)*1000,step=durMs/n;node.style.backgroundPosition="0% 0";node.__playTimer=setInterval(function(){i++;if(i>=n){clearInterval(node.__playTimer);node.style.backgroundPosition="100% 0";if(onDone)onDone();return;}node.style.backgroundPosition=((i/(n-1))*100).toFixed(2)+"% 0";},step);},'''
assert old_inline in s2, '游戏.html 内联 setAnim 未匹配'
s2 = s2.replace(old_inline, new_inline, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('游戏.html 内联: playFrames 加入 + setAnim 改 JS 逐帧')

# ---------- anim-check.html ----------
p3 = r'D:\Ai\游戏原型\docs\anim-check.html'
s3 = io.open(p3, encoding='utf-8').read()
old_ck = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; node.dataset.anim = act; this.paintAnim(node, a[act]); this.restartAnim(node); },'''
new_ck = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; clearInterval(node.__playTimer); this.paintAnim(node, a[act]); this.restartAnim(node); },
  playFrames: function (node, act, onDone) { if (!node) return; var anim = node.dataset.petName && this.animOf(node.dataset.petName); var x = anim && anim[act]; if (!x || !x.sheet || !(x.frames > 1)) { if (onDone) onDone(); return; } node.dataset.anim = act; this.paintAnim(node, x); node.style.animation = "none"; clearInterval(node.__playTimer); var n = x.frames, i = 0, durMs = (parseFloat(x.dur) || 1.6) * 1000, step = durMs / n; node.style.backgroundPosition = "0% 0"; node.__playTimer = setInterval(function () { i++; if (i >= n) { clearInterval(node.__playTimer); node.style.backgroundPosition = "100% 0"; if (onDone) onDone(); return; } node.style.backgroundPosition = ((i / (n - 1)) * 100).toFixed(2) + "% 0"; }, step); },'''
assert old_ck in s3, 'anim-check.html setAnim 未匹配'
s3 = s3.replace(old_ck, new_ck, 1)
io.open(p3, 'w', encoding='utf-8').write(s3)
print('anim-check.html: playFrames 加入 + setAnim 改 JS 逐帧')
