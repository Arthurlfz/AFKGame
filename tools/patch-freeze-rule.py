# -*- coding: utf-8 -*-
"""回合制演出冻结规则（前后端同源常量）：
- 冻结时长统一为 BATTLE_FREEZE_MS = 1500（演出：蓄力500+冲刺~300+命中定格400+回位~300）
- 前端 battle.js 与服务器 battle-sim.mjs 必须同步改，否则 vtest_server_sim 场次不一致"""
import io

# ---------- battle.js ----------
p = r'D:\Ai\游戏原型\docs\js\core\battle.js'
s = io.open(p, encoding='utf-8').read()

# 1) 常量：放在 freeze 声明附近（L37-38）
old_c = "  const freeze = { pet: false, enemy: false };\n  const unfreezeTimer = { pet: null, enemy: null };"
new_c = ("  /* 回合制演出冻结时长（ms）：一次出手 = 前摇+冲刺+命中定格+后摇，演出期间双方行动条全停。\n"
         "   * ⚠️ 必须与服务器模拟器 supabase/functions/_shared/battle-sim.mjs 的 BATTLE_FREEZE_MS 保持同值\n"
         "   * （2026-09-15 用户要求：宠物冲到怪物脸上 → 双方进度条暂停 → 出手 → 受击/伤害 → 回位 → 进度条再跑）*/\n"
         "  const BATTLE_FREEZE_MS = 1500;\n"
         "  const freeze = { pet: false, enemy: false };\n  const unfreezeTimer = { pet: null, enemy: null };")
assert old_c in s, 'battle.js 常量锚点未匹配'
s = s.replace(old_c, new_c, 1)

# 2) freezeAction 调用改固定常量（不再依赖表现层 hitAt/backMs）
old_f = "    const skillAnimMs = 0; freezeAction(isPet ? 'pet' : 'enemy', hitAt + backMs + skillAnimMs);"
new_f = "    const skillAnimMs = 0; freezeAction(isPet ? 'pet' : 'enemy', BATTLE_FREEZE_MS);"
assert old_f in s, 'battle.js freezeAction 调用未匹配'
s = s.replace(old_f, new_f, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('battle.js: BATTLE_FREEZE_MS=1500 + freezeAction 固定时长 ✓')

# ---------- battle-sim.mjs ----------
p2 = r'D:\Ai\游戏原型\supabase\functions\_shared\battle-sim.mjs'
s2 = io.open(p2, encoding='utf-8').read()

# 1) 常量
old_c2 = "  const hitAt = 320, backMs = 300;"
new_c2 = ("  const hitAt = 320, backMs = 300;\n"
          "  // 回合制演出冻结时长（ms）：出手后双方行动条全停，演出完再跑。与前端 battle.js BATTLE_FREEZE_MS 同值。\n"
          "  const BATTLE_FREEZE_MS = 1500;")
assert old_c2 in s2, 'battle-sim 常量锚点未匹配'
s2 = s2.replace(old_c2, new_c2, 1)

# 2) 冻结双方（原：只冻结出手方）
old_f2 = """    // 冻结出手方（hitAt+backMs）
    freeze[attacker] = true;
    freezeUntil[attacker] = t + hitAt + backMs;"""
new_f2 = """    // 冻结双方（BATTLE_FREEZE_MS）：演出期间双方行动条全停（与前端 battle.js 同规则）
    freeze.pet = true;
    freeze.enemy = true;
    freezeUntil.pet = t + BATTLE_FREEZE_MS;
    freezeUntil.enemy = t + BATTLE_FREEZE_MS;"""
assert old_f2 in s2, 'battle-sim 冻结段未匹配'
s2 = s2.replace(old_f2, new_f2, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('battle-sim.mjs: 冻结双方 + BATTLE_FREEZE_MS=1500 ✓')
