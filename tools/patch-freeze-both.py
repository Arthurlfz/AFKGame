# -*- coding: utf-8 -*-
"""1) battle.js freezeAction 改为冻结双方行动条（赛尔号式回合演出：出手方演出时对方也停，演出完一起恢复）；
2) pet-sprites.js setAnim：attack 不幂等（每次调用都重播，修连续攻击被吞），idle 保持幂等。"""
import io

# ---------- battle.js ----------
p = r'D:\Ai\游戏原型\docs\js\core\battle.js'
s = io.open(p, encoding='utf-8').read()
old = """  // 冻结某一方的行动条 ms 毫秒（= 它这一次出手的完整演出时长），到点自动解冻
  function freezeAction(side, ms) {
    clearTimeout(unfreezeTimer[side]);
    if (!(ms > 0)) return;
    freeze[side] = true;
    unfreezeTimer[side] = setTimeout(() => { freeze[side] = false; unfreezeTimer[side] = null; }, ms);
  }"""
new = """  // 冻结双方的行动条 ms 毫秒（= 这一次出手的完整演出时长：前摇+冲刺+命中+后摇）。
  // 赛尔号式回合演出：出手方演出时对方的行动条也暂停（双方进度条全部冻结），演出完一起恢复。
  // 2026-09-15 用户要求：宠物冲到怪物脸上 → 双方进度条全暂停 → 宠物出手 → 受击/伤害 → 回位 → 进度条再跑。
  function freezeAction(side, ms) {
    clearTimeout(unfreezeTimer.pet);
    clearTimeout(unfreezeTimer.enemy);
    if (!(ms > 0)) return;
    freeze.pet = true;
    freeze.enemy = true;
    unfreezeTimer.pet = setTimeout(() => { freeze.pet = false; unfreezeTimer.pet = null; }, ms);
    unfreezeTimer.enemy = setTimeout(() => { freeze.enemy = false; unfreezeTimer.enemy = null; }, ms);
  }"""
assert old in s, 'battle.js freezeAction 未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('battle.js: freezeAction 冻结双方 ✓')

# ---------- pet-sprites.js 外置 ----------
p2 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = """  setAnim: function (node, act) {
    if (!node || !act || node.dataset.anim === act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧（必播）
    node.dataset.anim = act;
    if (node.__raf) cancelAnimationFrame(node.__raf);
    this.paintAnim(node, anim[act]);
    this.restartAnim(node);
  },"""
new2 = """  setAnim: function (node, act) {
    if (!node || !act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧，且每次调用都重播（连续攻击不被吞）
    if (node.dataset.anim === act) return; // 只有 idle 幂等（图已切回待机）
    node.dataset.anim = act;
    if (node.__raf) cancelAnimationFrame(node.__raf);
    this.paintAnim(node, anim[act]);
    this.restartAnim(node);
  },"""
assert old2 in s2, 'pet-sprites.js setAnim 未匹配'
s2 = s2.replace(old2, new2, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('pet-sprites.js: setAnim attack 不幂等 ✓')

# ---------- 游戏.html 内联 ----------
p3 = r'D:\Ai\游戏原型\docs\游戏.html'
s3 = io.open(p3, encoding='utf-8').read()
old3 = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },'''
new3 = '''  setAnim: function (node, act) { if (!node || !act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } if (node.dataset.anim === act) return; node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },'''
assert old3 in s3, '游戏.html 内联 setAnim 未匹配'
s3 = s3.replace(old3, new3, 1)
io.open(p3, 'w', encoding='utf-8').write(s3)
print('游戏.html 内联: setAnim attack 不幂等 ✓')
