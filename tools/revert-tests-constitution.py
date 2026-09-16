# -*- coding: utf-8 -*-
"""回退测试基准与宪法记录（配合战斗冻结回退）：
- vtest_fun 阈值 3 -> 5（恢复）
- vtest_enemy_level 等待 25s -> 15s（恢复）
- PROJECT_CONSTITUTION.md：删 I 节、恢复 L294 的 620ms 原文
- anim-check.html V l -> m"""
import io

# fun 阈值
p = r'D:\Ai\游戏原型\docs\tests\vtest_fun.js'
s = io.open(p, encoding='utf-8').read()
old = """// 2026-09-15 用户拍板「完整回合演出（出手时双方进度条全停）」→ 挂机效率让位给演出，实测 ≈4 场/60s（15s/场）。
//   阈值再降到 3，守「挂机别慢到无感」的下限。
if(data.fights>=3)A(true,`节奏OK：${secPerFight}s/场（完整演出节奏，有力量感）`);"""
new = "if(data.fights>=5)A(true,`节奏OK：${secPerFight}s/场（speedScale=18 的设计节奏，有来有回不拖沓）`);"
assert old in s, 'fun 阈值未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('✓ vtest_fun 阈值恢复 5')

# enemy_level 等待
p2 = r'D:\Ai\游戏原型\docs\tests\vtest_enemy_level.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = "    await S(25000); // 完整回合演出（出手双方全停）后 Lv1 打图1 单场约 12~18s，等 25 秒够稳定打 1~2 场"
new2 = "    await S(15000); // 图1 单场约 5~7 秒，等 15 秒够打 2 场"
assert old2 in s2, 'enemy_level 等待未匹配'
s2 = s2.replace(old2, new2, 1)
io.open(p2, 'w', encoding='utf-8').write(s2)
print('✓ vtest_enemy_level 等待恢复 15s')

# 宪法：删 I 节 + 恢复 L294
p3 = r'D:\Ai\游戏原型\PROJECT_CONSTITUTION.md'
s3 = io.open(p3, encoding='utf-8').read()
old3 = """### I. 战斗演出冻结（2026-09-15 用户拍板）

> **演出 = 完整回合制**：宠物冲到怪物脸上 → **双方进度条全部暂停** → 宠物出手播技能 → 受击/伤害 → 回位 → 双方进度条一起恢复。
> **推翻** 2026-09-09 立的红线「只冻结出手方、对手照跑」（当时怕全场冻结把节奏拖成一半）。
> 本次拍板后实测：60s 挂机从 ~9 场掉到 ~4 场（用户接受，演出优先于挂机效率）。

- **BATTLE_FREEZE_MS = 1500**（前摇 500 + 冲刺 ~300 + 命中定格 400 + 后摇 ~300）——**三份战核必须同值**：
  `docs/js/core/battle.js`、`docs/js/core/battle-sim.mjs`（前端参考版）、`supabase/functions/_shared/battle-sim.mjs`（服务器运行版）→ `battle-sim.global.js` 由 `node build-sim-global.js` 从 mjs 生成。
- 冻结语义：`freeze.pet = freeze.enemy = true`，各一个 1500ms 定时器一起解冻（`freezeAction`）。
- 服务器模拟器同规则（每出手冻结双方 1500）→ vtest_server_sim / vtest_sim_sync 已绿。
- **测试基准同步更新**（挂机变慢是新常态，不是回归）：
  - `vtest_action_freeze` 语义重写：同时满条 → 先出的一方冻双方，另一方满条等待（不吞回合），演出完补出。
  - `vtest_fun` 效率阈值 5 → 3 场/60s（实测 ~4 场）。
  - `vtest_enemy_level` 等待 15s → 25s（Lv1 开荒单场约 12~18s）。

---

## 三、上线前必做清单（未完成项）"""
new3 = """## 三、上线前必做清单（未完成项）"""
assert old3 in s3, '宪法 I 节未匹配'
s3 = s3.replace(old3, new3, 1)

old3b = "- **速度用「相对比值」**（我速/敌速 → 伤害 ×0.1~×1.65）→ 永不失效；本项目的速度是绝对出手频率、且被 **1500ms 冻结双方压制**（2026-09-15 拍板，旧「620ms 只冻出手方」已作废，见 II 节 I）。"
new3b = "- **速度用「相对比值」**（我速/敌速 → 伤害 ×0.1~×1.65）→ 永不失效；本项目的速度是绝对出手频率、且被 620ms 固定冻结压制。"
assert old3b in s3, '宪法 L294 未匹配'
s3 = s3.replace(old3b, new3b, 1)
io.open(p3, 'w', encoding='utf-8').write(s3)
print('✓ 宪法 I 节删除 + L294 恢复')

# anim-check V
p4 = r'D:\Ai\游戏原型\docs\anim-check.html'
s4 = io.open(p4, encoding='utf-8').read()
s4 = s4.replace('版本徽标：v20260915l', '版本徽标：v20260915m')
s4 = s4.replace('V: "20260915l"', 'V: "20260915m"')
io.open(p4, 'w', encoding='utf-8').write(s4)
print('✓ anim-check V -> m')
