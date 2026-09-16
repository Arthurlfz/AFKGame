# -*- coding: utf-8 -*-
"""完整回退 2026-09-15「冻结双方演出」改动（用户否决）：
- battle.js：freezeAction 恢复只冻出手方 + 表现层时长（hitAt+backMs），删 BATTLE_FREEZE_MS
- pet-sprites.js / 游戏.html 内联：setAnim 恢复幂等守卫
- battle-sim.mjs 两份：恢复只冻出手方 + hitAt+backMs，删 BATTLE_FREEZE_MS
- 版本戳：battle.js/global.js -> mech9，PetSprites V -> 20260915m（回退版标记，强制刷新）"""
import io

def w(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)
    print('✓', p)

# ---------- battle.js ----------
p = r'D:\Ai\游戏原型\docs\js\core\battle.js'
s = io.open(p, encoding='utf-8').read()

old_c = """  /* 回合制演出冻结时长（ms）：一次出手 = 前摇+冲刺+命中定格+后摇，演出期间双方行动条全停。
   * ⚠️ 必须与服务器模拟器 supabase/functions/_shared/battle-sim.mjs 的 BATTLE_FREEZE_MS 保持同值
   * （2026-09-15 用户要求：宠物冲到怪物脸上 → 双方进度条暂停 → 出手 → 受击/伤害 → 回位 → 进度条再跑）*/
  const BATTLE_FREEZE_MS = 1500;
  const freeze = { pet: false, enemy: false };"""
new_c = """  const freeze = { pet: false, enemy: false };"""
assert old_c in s, 'battle.js 常量块未匹配'
s = s.replace(old_c, new_c, 1)

old_f = """  // 冻结双方的行动条 ms 毫秒（= 这一次出手的完整演出时长：前摇+冲刺+命中+后摇）。
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
new_f = """  // 冻结某一方的行动条 ms 毫秒（= 它这一次出手的完整演出时长），到点自动解冻
  function freezeAction(side, ms) {
    clearTimeout(unfreezeTimer[side]);
    if (!(ms > 0)) return;
    freeze[side] = true;
    unfreezeTimer[side] = setTimeout(() => { freeze[side] = false; unfreezeTimer[side] = null; }, ms);
  }"""
assert old_f in s, 'battle.js freezeAction 未匹配'
s = s.replace(old_f, new_f, 1)

old_call = "    const skillAnimMs = 0; freezeAction(isPet ? 'pet' : 'enemy', BATTLE_FREEZE_MS);"
new_call = "    const skillAnimMs = 0; freezeAction(isPet ? 'pet' : 'enemy', hitAt + backMs + skillAnimMs);"
assert old_call in s, 'battle.js freezeAction 调用未匹配'
s = s.replace(old_call, new_call, 1)

s = s.replace('js/core/battle.js?v=20260915mech8', 'js/core/battle.js?v=20260915mech9', 1) if 'battle.js?v=20260915mech8' not in s else s
w(p, s)

# ---------- pet-sprites.js ----------
p2 = r'D:\Ai\游戏原型\docs\js\core\pet-sprites.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = """  setAnim: function (node, act) {
    if (!node || !act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧，且每次调用都重播（连续攻击不被吞）
    if (node.dataset.anim === act) return; // 只有 idle 幂等（图已切回待机）
    node.dataset.anim = act;"""
new2 = """  setAnim: function (node, act) {
    if (!node || !act || node.dataset.anim === act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    if (act !== 'idle') { this.playFrames(node, act); return; } // 攻击等动作走 JS 逐帧（必播）
    node.dataset.anim = act;"""
assert old2 in s2, 'pet-sprites.js setAnim 未匹配'
s2 = s2.replace(old2, new2, 1)
s2 = s2.replace("V: '20260915l'", "V: '20260915m'", 1)
w(p2, s2)

# ---------- 游戏.html（内联 setAnim + 版本戳） ----------
p3 = r'D:\Ai\游戏原型\docs\游戏.html'
s3 = io.open(p3, encoding='utf-8').read()
old3 = '''  setAnim: function (node, act) { if (!node || !act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } if (node.dataset.anim === act) return; node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },'''
new3 = '''  setAnim: function (node, act) { if (!node || !act || node.dataset.anim === act) return; var a = node.dataset.petName && this.animOf(node.dataset.petName); if (!a || !a[act]) return; if (act !== "idle") { this.playFrames(node, act); return; } node.dataset.anim = act; if (node.__raf) cancelAnimationFrame(node.__raf); this.paintAnim(node, a[act]); this.restartAnim(node); },'''
assert old3 in s3, '游戏.html 内联 setAnim 未匹配'
s3 = s3.replace(old3, new3, 1)
s3 = s3.replace('js/core/battle-sim.global.js?v=20260915mech8', 'js/core/battle-sim.global.js?v=20260915mech9', 1)
s3 = s3.replace('V: "20260915l"', 'V: "20260915m"', 1)
w(p3, s3)

# ---------- battle-sim.mjs ×2 ----------
for p4 in [r'D:\Ai\游戏原型\docs\js\core\battle-sim.mjs',
           r'D:\Ai\游戏原型\supabase\functions\_shared\battle-sim.mjs']:
    s4 = io.open(p4, encoding='utf-8').read()
    old_c4 = """  const hitAt = 320, backMs = 300;
  // 回合制演出冻结时长（ms）：出手后双方行动条全停，演出完再跑。与前端 battle.js BATTLE_FREEZE_MS 同值。
  const BATTLE_FREEZE_MS = 1500;"""
    new_c4 = "  const hitAt = 320, backMs = 300;"
    assert old_c4 in s4, p4 + ' 常量未匹配'
    s4 = s4.replace(old_c4, new_c4, 1)
    old_f4 = """    // 冻结双方（BATTLE_FREEZE_MS）：演出期间双方行动条全停（与前端 battle.js 同规则）
    freeze.pet = true;
    freeze.enemy = true;
    freezeUntil.pet = t + BATTLE_FREEZE_MS;
    freezeUntil.enemy = t + BATTLE_FREEZE_MS;"""
    new_f4 = """    // 冻结出手方（hitAt+backMs）
    freeze[attacker] = true;
    freezeUntil[attacker] = t + hitAt + backMs;"""
    assert old_f4 in s4, p4 + ' 冻结段未匹配'
    s4 = s4.replace(old_f4, new_f4, 1)
    w(p4, s4)

print('回退完成，待重生 global.js + 回退测试/宪法/版本')
