# -*- coding: utf-8 -*-
"""PetSprites 加 showFrame（手动控帧）+ 版本号同步"""
import io

# ---------- pet-sprites.js 外置 ----------
p1 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s1 = io.open(p1, encoding='utf-8').read()

if 'showFrame: function' in s1:
    print('pet-sprites.js showFrame 已存在')
else:
    old1 = '''  setAnim: function (node, act) {'''
    new1 = '''  // 手动控帧（赛尔号式攻击演出用）：把动画立绘停在指定帧，供攻击四段式逐帧切换
  showFrame: function (node, idx) {
    if (!node) return;
    var a = node.dataset.petName && this.animOf(node.dataset.petName);
    var x = a && (a.attack || a.idle);
    if (!x || !x.sheet || !(x.frames > 1)) return;
    node.style.animation = 'none'; // 停掉自动播放，由演出时序控制帧
    node.style.backgroundPosition = ((idx / (x.frames - 1)) * 100).toFixed(2) + '% 0';
  },
  setAnim: function (node, act) {'''
    assert old1 in s1, 'setAnim not found in pet-sprites.js'
    s1 = s1.replace(old1, new1, 1)
    print('pet-sprites.js + showFrame')

if "V: '20260915c'" in s1:
    print('pet-sprites.js V 已最新')
else:
    s1 = s1.replace("V: '20260915b',", "V: '20260915c',", 1)
    print('pet-sprites.js V -> 20260915c')
io.open(p1, 'w', encoding='utf-8').write(s1)

# ---------- 游戏.html 内联副本 ----------
p2 = r'D:\Ai\游戏原型\docs\游戏.html'
s2 = io.open(p2, encoding='utf-8').read()

if 'showFrame: function' in s2:
    print('内联 showFrame 已存在')
else:
    old2 = '  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; node.dataset.anim = act; this.paintAnim(node, a[act]); this.restartAnim(node); },'
    new2 = ('  showFrame: function (node, idx) { if (!node) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); var x = a && (a.attack || a.idle); if (!x || !x.sheet || !(x.frames > 1)) return; node.style.animation = "none"; node.style.backgroundPosition = ((idx / (x.frames - 1)) * 100).toFixed(2) + "% 0"; },\n'
            '  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; node.dataset.anim = act; this.paintAnim(node, a[act]); this.restartAnim(node); },')
    assert old2 in s2, 'inline setAnim not found'
    s2 = s2.replace(old2, new2, 1)
    print('内联 + showFrame')

s2 = s2.replace('V: "20260915b"', 'V: "20260915c"', 1)
print('内联 V -> 20260915c')

# ui-battle.js 版本 bump
s2 = s2.replace('ui-battle.js?v=20260914reveal1', 'ui-battle.js?v=20260915anim1', 1)
print('ui-battle.js?v -> 20260915anim1')

io.open(p2, 'w', encoding='utf-8').write(s2)
print('游戏.html 完成')
