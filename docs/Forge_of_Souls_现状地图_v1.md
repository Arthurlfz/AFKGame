# Forge of Souls · 现状地图 v1

> 生成：2026-09-03｜目的：把"这游戏现在到底长什么样"一次性讲全。让任何一个人（包括你自己）拿到这张图，就知道：哪里是权威、哪里是冗余、哪里是断的、哪里是烂尾。
> 判断标尺：**代码 = 唯一事实源**（2026-08-31 起所有文档已声明过时，以代码为准）。文档只在能对上代码时才有指导意义。

---

## 一、一句话现状

这个游戏**不是一栋楼，是几层没对齐的楼板叠在一起**：代码跑在 `docs/`，但它的"权威文档"散在 `新demo/`（已过时）、`docs/`（部分过时）、根目录（临时快照）；它的 Supabase 迁移有三套目录；它的测试有两套分叉；它的数值计算全在前端（玩家可改）；它挂在 GitHub 公开仓库上。

---

## 二、目录层：8 个内容目录 + 5 套 Agent 工具链

### 2.1 目录职责表

| 目录 | 是什么 | 状态判定 |
|---|---|---|
| `docs/` | **当前游戏运行源**（index.html / 游戏.html / css / js / assets / supabase / tests） | ✅ 权威（git commit 确认 "docs as official runtime source"） |
| `新demo/` | 早期 demo（agents / design / Mvp / 第1大陆设计 / 游戏数据地图 / 游戏设计理念） | ⚠️ 已过时但**未归档**，还在根目录挂着；Mvp 里还有第三套 Supabase schema |
| `archive/` | 归档（demos / deploy / logs / notes / scripts / _obsolete / _extracts） | ⚠️ 和根 `_obsolete/` 内容重叠 |
| `_obsolete/` | 废弃（gdd_deleted_20260831 / 任务表v1 / 大陆世界观 / 大陆地图规划） | ⚠️ 和 `archive/_obsolete/` 是同一批删除的 GDD，存了两份 |
| `_extracts/` | part1.txt / part2.txt（提取残片） | ❌ 来源不明，疑似废弃 |
| `玩法文档/` | 借鉴来源游戏攻略（docx ×8 + _extracted.txt） | ✅ 参考源（只读），但 `docs/玩法文档/_extracted.txt` 是它的冗余拷贝 |
| `supabase/` | 迁移 SQL ×17（含最新 migrate_security_hardening.sql） | ✅ 最新迁移在此，但注意下面"三套迁移"问题 |
| `tests/` | 测试 ×45 | ⚠️ 与 `docs/tests/`（×47）**分叉**，见 §4 |

### 2.2 三套 Supabase 迁移（互相不统一）

| 位置 | 数量 | 说明 |
|---|---|---|
| `supabase/` | 17 | 最全（含 security_hardening / trait_soulcast / admin_tools / dev_delete_user / equip_identified） |
| `docs/supabase/` | 12 | 缺 5 个最新迁移 |
| `新demo/Mvp/supabase/` | schema_*.sql 多张 | 早期 schema，旧命名体系 |

**断点**：谁按什么顺序应用了哪些迁移、当前线上库停在哪个版本——**没有任何一份记录**。两个 agent 往不同目录写迁移（security_hardening 只进了根 `supabase/`，没进 `docs/supabase/`），下一步谁都会迷失。

### 2.3 五套 Agent 工具链（各带各的记忆）

| 工具链 | 位置 | 内容 |
|---|---|---|
| CodeBuddy | `.codebuddy/` | agents×5 / memory（8-25→9-03 每日）+ MEMORY.md / plans×16（一堆"未完成"）/ skills/forge-of-souls-dev |
| WorkBuddy | `.workbuddy/` | memory（8-21→8-31）+ MEMORY.md / artifacts |
| ZCode | `.zcode/` | plans |
| 新demo agents | `新demo/agents/` | 策划数值 / 系统架构 / 后端 / 前端 / 测试 5 个 .soul |
| 豆包（当前） | — | 本对话 |

**断点**：5 套 agent 各有各的 memory 和 plans，**互相看不到对方记了什么**。这就是"多 agent 幻觉"的物理根源——没有一个人拥有全貌，每个人都在自己的记忆里拼接。

---

## 三、文档层：权威链是断的

### 3.1 各文档状态

| 文档 | 位置 | 判定 |
|---|---|---|
| `AI假人经济系统策划_v1.md` | `docs/` | ✅ 当前权威（AI 经济） |
| `宠物特质与魂铸系统·实施提示词.md` | `docs/` | ✅ 当前权威（魂铸），但 §必读文件引用了过时的 `新demo/游戏数据地图 v1.md` 当"唯一数据基准" → **断点** |
| `数据库与付费系统完整设计 v1.md` | `docs/` | ✅ 正式 |
| `装备打造多样性方案_v3.md` | `docs/` | ✅ 正式（v3） |
| `系统整合与新手指南策划.md` | `docs/` | ✅ 正式 |
| `系统整合_full_tmp.md` | 根目录 | ⚠️ **临时全量快照，已与正式文档分叉**（md5 不同），名字带 tmp 却放在根目录 |
| `游戏数据地图 v1.md` | `新demo/` | ⚠️ 已标"过时，以代码为准"，但被魂铸文档引用 |
| `游戏设计理念，所有Agent必须阅读.md` | `新demo/` | ⚠️ 已标过时，名字却叫"必须阅读" |
| `玩法文档/_extracted.txt` | `docs/` + 根 | ⚠️ 两份 md5 完全相同（冗余拷贝） |
| `策划必须阅读！.txt` | `新demo/` | ⚠️ 过时区里的"必须阅读" |

### 3.2 根目录散落杂物（应清理或归档）

- demo html ×4：`city-demo.html` / `identify-demo.html` / `market-cascade-demo.html` / `_preview_market.html`
- python 脚本 ×2：`bump_versions.py` / `_extract_docx.py`
- 截图 ×2：`_game_screenshot.jpeg` / `_game_screenshot2.jpeg`
- 垃圾 ×2：`_html`（0 字节）/ `新建文本文档.txt`（61 字节）
- 部署配置：`netlify.toml` / `wrangler.toml`（这两个有用，但应在 docs/ 或明确位置）

---

## 四、测试层：两套分叉的"真相"

| 目录 | js 数 | 独有 | 说明 |
|---|---|---|---|
| `tests/`（根） | 45 | vtest_awaken_mutant / craft_page / task12_ui / trait_soulcast | 旧版，共享的 41 个文件内容已过时 |
| `docs/tests/` | 47 | dbg / sample_ai_market / cascade_market / egg_listings_rls / security_guard / trade_records_rls | 当前版本（含最新安全测试） |

**断点**：两个目录共享 41 个同名测试但**内容不同**（vstub、marketbot 的 md5 对不上）。**一个 agent 跑根 tests/ 全绿、另一个跑 docs/tests/ 挂了——两边都没错，验证的是两套东西。** 这就是"多 agent 互相踩"最阴险的形式：连"测试是否通过"都无法达成共识。

---

## 五、代码信任边界：只有一层真权威

按"数值在哪算"划分：

### 5.1 服务端 RPC 权威层（玩家改不了）——极少
- `add_material` / `spend_material`：材料增扣（刚加，含 60s 限流 1000/次上限 5000）
- `bot_buy_equip` / `bot_buy_pet`：AI 市场购买（含三层守卫）
- 其他少量 RPC

**问题**：这些 RPC 只校验"登录/身份/限流"，**不校验数值来源**。`add_material(p_name, p_amount=999)`——服务端不知道这 999 该不该存在，玩家改前端掉落逻辑后报合法数量即可通过。

### 5.2 前端装饰层（玩家开 DevTools 就能改）——几乎全部
- 掉落 roll：`drop.js`（玩家改概率/数量）
- 打造/重铸/剥离/分解/魂铸：`equipment_craft.js` / `salvage.js`（改成本/结果）
- 进化/合成/融合/涅槃：`pet.js` / `pet_merge.js` / `pet_evolve.js`（改成长/结果/消耗）
- 市场定价与 AI 行为：`market_bot.js` / `market.js`（改价格/库存）
- 材料、宠物、装备数据：前端本地直接改后提交

### 5.3 结论
**这个游戏目前是"客户端权威"：规则的裁决权在玩家浏览器里。** RLS（刚配）+ RPC（刚收口）能防"外人直连数据库"和"脚本风暴"，但**防不了"真人玩家改前端后合法提交"**——也就是你自己说的"前端就能改游戏进程"。要堵住，必须把"数值计算"搬服务端（服务端权威），这是比 AI 经济大一个量级的工程。

---

## 六、Git：混乱的记录仪 + 公开仓库

- 远程：`github.com/Arthurlfz/AFKGame.git`（**公开仓库**，main 分支已 push）
- 近期提交实录（每条都是一次"救火"）：
  - `5513ff3` 撤下误传的临时文件/归档/demo，补 .gitignore（本地保留）
  - `9748a79` 大量 UI 打磨与新手引导改动(含临时文件清理)
  - `ee372c9` 重建宠物特质/魂铸/觉醒系统并修复回滚连带损坏
  - `31c1b99` 存档：恢复被回滚的市场重构与被删文件
  - `c56764f` docs: clarify docs as official runtime source
- **解读**：回滚互相踩 → 系统损坏/文件被删 → 重建/恢复 → 误传临时文件 → 撤下 → 连"哪个是官方代码源"都要用 commit 声明。公开仓库 + 前端可改 + 未完成的 RLS = 一栋没地基的楼，敞开门挂网上。

---

## 七、断点清单（按严重度排序）

| # | 断点 | 严重度 | 一句话 |
|---|---|---|---|
| 1 | **客户端权威**：掉落/打造/进化/定价全在前端，玩家可改 | 🔴 致命 | 游戏规则不在你手里，推广即被拆 |
| 2 | **三套 Supabase 迁移**：谁应用了哪些、当前库停在哪，无记录 | 🔴 致命 | 数据层无法复现/回滚/上线 |
| 3 | **两套分叉测试**：根 tests/ vs docs/tests/ 内容不同 | 🟠 高 | agent 之间"测试是否通过"无法共识 |
| 4 | **文档权威链断裂**：魂铸文档引用已过时的"数据地图"当基准 | 🟠 高 | agent 会照着过时文档改，越改越乱 |
| 5 | **5 套 Agent 工具链各带记忆**：互相看不到 | 🟠 高 | 多 agent 幻觉的物理根源 |
| 6 | **双份文档**：整合_full_tmp 已分叉、玩法文档 extracted 重复 | 🟡 中 | 谁真谁假要人肉判断 |
| 7 | **根目录杂物**：demo/脚本/截图/0字节文件未归档 | 🟡 中 | 污染 git，已发生过误传 |
| 8 | **新demo 过时未归档**，还挂着"必须阅读" | 🟡 中 | 误导 agent |

---

---

## 八、2026-09-03 清理记录（已执行）

### 8.1 唯一化结果（旧目录全部进 `archive/`，未硬删）

| 清理项 | 动作 | 结果 |
|---|---|---|
| 根目录杂物 | `_html`(0字节) 删除；demo html×4、脚本×2、截图×2、便签、`系统整合_full_tmp.md`、`备忘录` → `archive/` | 根目录只剩项目内容 |
| 测试目录 | 根 `tests/`(45，含魂铸/打造/任务12 UI 4 个独有测试) → `archive/tests_fork/`；4 个独有测试合并进 `docs/tests/` 并 **4/4 PASS** | `docs/tests/` 为唯一测试源 |
| Supabase 迁移 | `docs/supabase/`(12) → `archive/supabase_docs_dup/`；3 个"不同"文件确认仅行尾差异、内容一致 | 根 `supabase/`(17) 为唯一迁移源 |
| 玩法文档 | 根 `玩法文档/` → `archive/玩法文档_dup/` | `docs/玩法文档/` 唯一 |
| 废弃区 | 根 `_obsolete/` → `archive/_obsolete_root_dup/` | `archive/_obsolete/` 唯一 |
| 新demo | `新demo/`(含 assets 素材183张——已确认 docs 有全部同名副本、agents、Mvp/supabase) → `archive/新demo_legacy/` | docs 资源不受影响 |
| 文档断链 | 魂铸实施文档 5 处"数据地图=唯一基准"引用 → 改为"config.js 为唯一数值源" | 断链已修 |

### 8.2 新发现：docs/tests/ 本身有 12 个既有失败测试

跑全部 47 个 vtest：**35 PASS / 12 FAIL**。核心测试（marketbot / botbuy / evolution / trait_soulcast / bugfix / regression_c1）全绿，确认清理零破坏。12 个失败是**代码演进后测试未同步**的既有问题（如 `UI.renderSellArea is not a function`——市场卖东西 UI 重构后，bag/egg/shop 等测试没跟上）：

`vtest_bag / vtest_deep / vtest_deep2 / vtest_egg / vtest_enemy_level / vtest_equip_compare / vtest_equip_persist / vtest_exp_traderef / vtest_fun / vtest_newbie / vtest_quest / vtest_shop`

> 这本身说明：**测试套件的"健康度"比想象的低**。不止是"两套分叉"，连唯一的 `docs/tests/` 里也有 1/4 是挂的。

### 8.3 未处理（等你拍板）

- **git 工作区**：清理产生大量 `D`（删除/移动）+ 另一个 agent 的 RLS 改动未提交。要不要 commit、怎么 commit，你来定。
- **`.mcp.json`**（Godot 本地 MCP 配置）保留在根目录，未动。
- **12 个失败测试**：修还是不修、什么时候修，待定（可作为单独任务）。
- **服务端权威**：你便签上写着"上线前必须做"，仍是最大待决项。


## 九、下一步建议（三选一，不要全做）

1. **止血（本周）**：统一测试目录（删分叉，docs/tests/ 为唯一）、归拢三套迁移（supabase/ 为唯一 + 写迁移日志）、删根目录杂物、文档标注"以代码为准"。
2. **立账本（本周）**：把上面这张图 + 所有"已拍板决策"收敛成一份 `PROJECT_CONSTITUTION.md`，让所有 agent 开工前先读它。
3. **打地基（长期）**：决定"客户端权威 → 服务端权威"是否要做、做到哪一层。**这是唯一能让你"有底气推广"的改动**，但代价是重写数值结算层。
