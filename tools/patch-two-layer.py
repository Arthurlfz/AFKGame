# -*- coding: utf-8 -*-
"""动画立绘两层化：外层 pet-anim-move 管位移+翻转，内层 pet-anim 管帧。
同步 pet-sprites.js 外置 + 游戏.html 内联副本。"""
import io

def patch(path, label):
    s = io.open(path, encoding='utf-8').read()
    old = '''    var node = this.makeAnimNode(anim, 'idle');
    if (!node) return false;
    node.dataset.petName = name;
    el.textContent = '';
    el.appendChild(node);
    return true;'''
    new = '''    var node = this.makeAnimNode(anim, 'idle');
    if (!node) return false;
    node.dataset.petName = name;
    // 两层结构：外层 .pet-anim-move 吃战斗突进位移+翻转，内层 .pet-anim 管逐帧动画/手动控帧。
    // 拆开的原因：showFrame 要停内层帧动画（内联 animation:none），若只有一个节点会连外层位移一起挡住。
    var move = document.createElement('div');
    move.className = 'pet-anim-move';
    move.appendChild(node);
    el.textContent = '';
    el.appendChild(move);
    return true;'''
    assert old in s, label + ': mountAnimated 原文未匹配'
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(label + ': mountAnimated 两层化完成')

patch(r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js', 'pet-sprites.js')
patch(r'D:\Ai\游戏原型\docs\游戏.html', '游戏.html 内联')
