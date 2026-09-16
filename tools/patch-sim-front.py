# -*- coding: utf-8 -*-
"""同步第三份战核副本 docs/js/core/battle-sim.mjs（前端参考版）到与 supabase 服务器版一致：
冻结双方 + BATTLE_FREEZE_MS=1500"""
import io

p = r'D:\Ai\游戏原型\docs\js\core\battle-sim.mjs'
s = io.open(p, encoding='utf-8').read()

# 1) 常量
old_c = "  const hitAt = 320, backMs = 300;"
new_c = ("  const hitAt = 320, backMs = 300;\n"
         "  // 回合制演出冻结时长（ms）：出手后双方行动条全停，演出完再跑。与前端 battle.js BATTLE_FREEZE_MS 同值。\n"
         "  const BATTLE_FREEZE_MS = 1500;")
assert old_c in s, '前端副本常量锚点未匹配'
s = s.replace(old_c, new_c, 1)

# 2) 冻结双方
old_f = """    // 冻结出手方（hitAt+backMs）
    freeze[attacker] = true;
    freezeUntil[attacker] = t + hitAt + backMs;"""
new_f = """    // 冻结双方（BATTLE_FREEZE_MS）：演出期间双方行动条全停（与前端 battle.js 同规则）
    freeze.pet = true;
    freeze.enemy = true;
    freezeUntil.pet = t + BATTLE_FREEZE_MS;
    freezeUntil.enemy = t + BATTLE_FREEZE_MS;"""
assert old_f in s, '前端副本冻结段未匹配'
s = s.replace(old_f, new_f, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('docs/js/core/battle-sim.mjs: 冻结双方 + BATTLE_FREEZE_MS=1500 ✓')

# 校验两份副本一致
import subprocess
r = subprocess.run(['node', 'tests/vtest_sim_sync.js'], cwd=r'D:\Ai\游戏原型\docs', capture_output=True, text=True)
print(r.stdout[-500:] if r.stdout else r.stderr[-500:])
