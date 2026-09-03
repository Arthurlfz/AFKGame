# 怪物系统 GDD（设计对齐版 · v1.0）

> 文档性质：**设计对齐**产物。以运行源码为唯一事实源，把滞后的设计文档回填对齐到代码现状。
> 源码事实源：`docs/js/pet/enemy-data.js`、`docs/js/core/config.js`、`docs/js/core/battle.js`、`docs/js/ui/ui-battle.js`、`docs/js/core/drop.js`、`docs/js/pet/pet.js`
> 配套测试：`docs/tests/vtest_enemy_level.js` / `vtest_enemy_balance.js` / `vtest_drop_tier.js` / `vtest_tier_rarity.js`

---

## ⚠️ 头号发现（必须回传主理人）

**怪物名录：设计文档 ≠ 代码，以代码为准。**

- 《游戏设计理念，所有Agent必须阅读.md》§6 怪物名录写的是：`腐噜兽/骨虫/毒蟾/血蝠/石甲兽/瘟疫犬/幽影蛇/骨刺兽/血牙狼/腐尸魔/冥火鸦/瘟甲卫`（6 个等级段各 2 种）。
- 代码实际（`enemy-data.js` + `config.js` 的 `areas.enemyIds`）的野怪是 **18 只**，且每只带 `normal / evolved / mutant` 三型结构，名字全部复用 8 只基宠（血狐/骨狼/幽影兔/瘟熊/毒沼蛙/尸犬/疫毛兽/腐噜兽）及其进化/变异形态。
- **结论：设计理念 §6 旧名录已作废。** 本 GDD 第 4 章采用代码实际名录与三型结构。

**次重要发现（同样源代码与滞后文档冲突，见第 4 章标红项）：**
1. 「新手保护第 1 图 difficulty=0.6」——数据地图 v1 §9 标注为"已落地"，但 `config.areas` 全部 10 图 `difficulty: 1.0`（含 corrupted-forest）。代码里**未实现 0.6**。
2. 怪物掉落稀有度：悬浮提示展示的 `rarityWeights`（白/蓝/金 %）**只是展示字段**，实际掉率由 `enemy.lootTier`（low/mid/high）在 `drop.js` 决定，二者数值体系不一致。
3. 怪物经验公式：悬浮提示需求文档给的是 `round((level×5 + maxHp×0.1) × _diff)`，但代码 `ui-battle.js` 实际调用 `Pet.expRange`（`config.exp` 的 `4 × level^1.0 × diff`），二者数值完全不同。

---

## 1. 系统定位与目标

怪物是「挂机 → 掉落 → 交易」核心循环的**内容供给方与节奏控制器**，在游戏中的角色：

1. **挂机对象**：纯自动战斗的对手（行动条回合制、减法伤害、攻速=速度）。怪物是"死靶子"——数值由所在地图 + 类型固定算出，不随玩家成长实时倒推（2026-08-30 用户拍板定死，见 `config.battle.areaEnemyStats` 注释）。
2. **掉落来源**：怪物胜利后概率产出**装备 / 宠物蛋 / 材料（涅磐兽、合成之石、打造石、进化素材、图专属材料）**，驱动养成与交易循环。
3. **经验来源**：怪物等级钳进地图等级段，决定单场经验，强制玩家随等级往高级图推进（图的推进感来源）。
4. **交易燃料的产地标签**：怪物掉落的蛋 = 对应基宠（孵化为 8 只基宠之一），掉落的装备按地图档位生成，最终进入真实玩家市场。怪物本身**不进入交易市场**（只掉"产物"，不掉"怪"）。

**三型结构服务于核心 G 点（捡漏 / 追求稀有）**：变异怪（mutant）掉金装概率最高，是玩家挂机最想偶遇的"好怪"；进化怪次之；普通怪为日常经验/材料来源。这层梯度直接对应《游戏设计理念》§3 玩家 G 点。

---

## 2. 核心机制与规则

### 2.1 怪物等级段（按地图，非按宠物）
- 第一大陆 10 张图，每图 6 级一档：`图1[1,6] → 图10[55,60]`，承载 1–60 级（`config.battle.areas` 各 `levelRange`）。
- **怪物等级 = 玩家等级钳进地图等级段**：`怪等级 = clamp(玩家等级, 图下限, 图上限)`（`battle.js` `rollEnemyLevel`）。图决定"范围"，玩家等级决定"范围内取值"，到边界即停。
  - 图段内：怪等级 = 玩家等级。
  - 超出上限：取图上限（Lv60 打图1 只出 Lv6 怪，图与图不再等价）。
  - 低于下限：取图下限（Lv1 进图10 出 Lv55 怪，图是硬门槛，必输但允许硬闯）。

### 2.2 怪物三型：`normal / evolved / mutant`
- 来源：`enemy-data.js` 每只为 `enemyType`，`battle.js` 按 `config.battle.typeMult` 乘算强度：
  - `normal` 1.0 / `evolved` 1.1 / `mutant` 1.2（血/攻/防整体系数）。
- **普通宠、进化宠、变异宠都可当野怪**（对齐设计理念 §6 意图）：代码里 `normal` 是基宠本体，`evolved` 是进化形态，`mutant` 是变异形态（命名带「·异变」后缀）。
- **变异怪掉金装概率最高**：实际由 `lootTier: 'high'`（见 4.4）决定，变异怪全部挂在 high 档 → 装备掉落直接出金；同时其展示权重 `rarityWeights.gold` 也最高（55%~60%）。

### 2.3 掉落规则（野怪 → 产物）
- **宠物蛋**：所有可捕捉怪都掉蛋，蛋品种 = 该怪 `eggBaseName`（基础宠名，如 血牙狐→血狐蛋、血狐·异变→血狐蛋）。孵化出的始终是**基础宠**（养成靠进化/合成，蛋不直接给高阶形态）。只有未配 `eggBaseName` 的杂兵怪不掉蛋（当前已无此类怪）。
- **装备**：掉落概率 `config.drop.equipmentChance = 0.015`，稀有度由 `enemy.lootTier` 决定（见 4.4），基底 = 当前图档 × 随机底材 T 阶。
- **材料**：涅磐兽 / 合成之石 / 四色打造石 / 进化素材（按图档递进）/ 图专属材料，均为**独立概率**掉落，不挤占装备/蛋掉率。

### 2.4 属性构成（运行时）
怪物的最终属性由 `battle.js scaleEnemyStats` 现算：
- **血/攻/防** = `areaEnemyStats[图id]` 基准 × `ratio(等级/图中点, 0.25~1.6)` × `typeMult(类型)` × `difficulty(图)`。
- **速度** = 怪自身 `spd`（`enemy-data.js` 固定，不参与等级缩放）。
- **命中/闪避/暴击/暴伤/吸血**：命中恒 90；闪避随类型 `normal 5 / evolved 8 / mutant 12`；暴击 10%、暴伤 1.5 倍、吸血 0（均取 `config.battle` 默认）。
- **成长 `growth`**：设成 `area.recGrowth`（每图推荐成长档），但当前不参与怪物自身数值计算（数值来自 areaEnemyStats），属预留/展示字段。

### 2.5 难度乘子 `difficulty`
- 每图可带 `difficulty`（怪物属性整体乘子），接入 `scaleEnemyStats`。
- **现状：全部 10 图 `difficulty: 1.0`**（含第 1 图 corrupted-forest）。新手保护不靠降难度，而靠等级钳制 + `ratio` 下限 0.25（见 4.3）。

---

## 3. 数据模型

### 3.1 怪物实体字段（对齐 `enemy-data.js` + `scaleEnemyStats`）

怪物是**纯前端配置**（`window.EnemyData.list`），**不落任何数据库表**（与数据地图 v1「纯机制不新增表」原则一致；数据地图 v1 当前甚至没有怪物实体表，见 3.3）。

| 字段 | 来源 | 类型 | 说明 | 运行时是否参与计算 |
|------|------|------|------|------|
| `id` | enemy-data | string | 野怪唯一 id（`wild-*`） | 是（地图 `enemyIds` 引用） |
| `name` | enemy-data | string | 显示名（普通用基宠名；变异带「·异变」） | 是（展示/蛋名） |
| `icon` | enemy-data | string(emoji) | 立绘回退图标 | 是（展示） |
| `level` | enemy-data | int | 目录等级（6/9/14…） | **否（被 `rollEnemyLevel` 覆盖）**，仅 `getAreaEnemyPool` 的 `levelRange` 兜底用到 |
| `spd` | enemy-data | int | 速度（决定出手频率） | 是（不缩放） |
| `rarityWeights` | enemy-data | {white,blue,gold} | 掉落品质**展示**权重（%） | **否（仅悬浮提示展示）**，实际掉率走 `lootTier` |
| `lootTier` | enemy-data | 'low'/'mid'/'high' | **实际掉落稀有度档** | 是（`drop.js pickDropRarity`） |
| `levelRange` | enemy-data | [min,max] | 该怪适合的等级段（池筛选用） | 是（`getAreaEnemyPool` 与图段重叠判定） |
| `weight` | enemy-data | int | 同图内抽怪权重 | 是（`pickWeighted`） |
| `eggBaseName` | enemy-data | string | 掉落宠物蛋的品种（基础宠名） | 是（`drop.js getEnemyEggBase`） |
| `enemyType` | enemy-data | 'normal'/'evolved'/'mutant' | 怪物类型 | 是（`typeMult` × 强度、`dodge` 档、UI 标签） |
| `hp/atk/def` | 运行时算 | int | `areaEnemyStats × ratio × typeMult × difficulty` | 是（战斗） |
| `maxHp` | 运行时算 | int | = 初始 `hp` | 是 |
| `critRate/critDamage/hit/dodge/lifesteal` | 运行时填 | num | 机制属性（见 2.4） | 是（伤害结算） |
| `growth` | 运行时填 | int | = `area.recGrowth` | 否（预留） |
| `_diff` | 运行时填 | num | = `area.difficulty` | 是（展示 + 经验乘子） |

### 3.2 怪物实体关系
- 18 只野怪的 `eggBaseName` 收敛到 **8 个基础宠**（= `config.pet.starters` 的 8 只）：腐噜兽、血狐、骨狼、幽影兔、瘟熊、毒沼蛙、尸犬、疫毛兽。
- 不是每只基宠都有三型：腐噜兽只有 normal；瘟熊有 normal+mutant（无 evolved 敌怪）；血狐/骨狼/幽影兔/尸犬/疫毛兽/毒沼蛙有 normal+evolved（部分还有 mutant）。见 4.1 明细。

### 3.3 需回填「游戏数据地图 v1」的字段/说明变更（**本 Agent 不改该文件，仅列待办**）
1. **新增怪物实体说明**：数据地图 v1 无怪物实体表。建议补一句"怪物为纯前端配置（`enemy-data.js`），不落库表；字段见本 GDD §3.1"。
2. **§9 新手保护 0.6 冲突**：数据地图 v1 §9 写"corrupted-forest difficulty: 0.6 已落地"，但代码 `config.areas` 全图 `difficulty: 1.0`。需回填澄清：0.6 是否已废弃（当前新手保护由 ratio 下限 0.25 实现），或由主理人拍板补回 0.6。
3. **设计理念 §6 名录作废**：旧 12 种名录（骨虫/毒蟾/血蝠…）整体替换为代码实际 18 只 / 三型（本 GDD §4.1）。
4. **掉落稀有度口径**：明确"实际掉率由 `enemy.lootTier` 决定；`rarityWeights` 仅为悬浮提示展示字段，不参与 `drop.js` 计算"——避免后人误以为两个体系联动。

---

## 4. 数值与平衡现状

### 4.1 代码实际怪物名录（权威，18 只 / 三型）

按 `enemy-data.js` 档位（档位对应 `config.areas` 的图段）：

| 档位（图） | id | 名称 | enemyType | spd | lootTier | rarityWeights(白/蓝/金) | eggBaseName | levelRange |
|---|---|---|---|---|---|---|---|---|
| 图1 [1,10] | wild-rotten | 腐噜兽 | normal | 55 | low | 80/18/2 | 腐噜兽 | [1,10] |
| 图1 [1,10] | wild-bloodfox | 血狐 | normal | 95 | low | 75/22/3 | 血狐 | [1,10] |
| 图2 [11,20] | wild-bonewolf | 骨狼 | normal | 75 | mid | 60/35/5 | 骨狼 | [11,20] |
| 图2 [11,20] | wild-shadowrabbit | 幽影兔 | normal | 110 | mid | 55/38/7 | 幽影兔 | [11,20] |
| 图2 [11,20] | wild-plaguebear | 瘟熊 | normal | 30 | mid | 50/42/8 | 瘟熊 | [11,20] |
| 图2 [11,20] | wild-bogfrog | 毒沼蛙 | normal | 45 | mid | 52/40/8 | 毒沼蛙 | [11,20] |
| 图2 [11,20] | wild-corpsehound | 尸犬 | normal | 65 | mid | 55/38/7 | 尸犬 | [11,20] |
| 图2 [11,20] | wild-plaguecat | 疫毛兽 | normal | 85 | mid | 58/36/6 | 疫毛兽 | [11,20] |
| 图3/4 [21,35] | wild-bloodfang-fox | 血牙狐 | evolved | 95 | high | 25/50/25 | 血狐 | [21,35] |
| 图3/4 [21,35] | wild-netherfrost-wolf | 冥霜狼 | evolved | 75 | high | 20/45/35 | 骨狼 | [21,35] |
| 图3/4 [21,35] | wild-withermaw | 尸牙犬 | evolved | 65 | high | 22/48/30 | 尸犬 | [21,35] |
| 图3/4 [21,35] | wild-blightspine | 疫刺兽 | evolved | 85 | high | 22/48/30 | 疫毛兽 | [21,35] |
| 图3/4 [21,35] | wild-umbra-rabbit | 影刃兔 | evolved | 110 | high | 18/42/40 | 幽影兔 | [21,35] |
| 图3/4 [21,35] | wild-bog-king | 毒沼王 | evolved | 45 | high | 18/42/40 | 毒沼蛙 | [21,35] |
| 图5/6+ [36,60] | wild-bloodfox-mutant | 血狐·异变 | mutant | 95 | high | 10/35/55 | 血狐 | [36,60] |
| 图5/6+ [36,60] | wild-bonewolf-mutant | 骨狼·异变 | mutant | 75 | high | 10/35/55 | 骨狼 | [36,60] |
| 图5/6+ [36,60] | wild-shadowrabbit-mutant | 幽影兔·异变 | mutant | 110 | high | 8/32/60 | 幽影兔 | [36,60] |
| 图5/6+ [36,60] | wild-plaguebear-mutant | 瘟熊·异变 | mutant | 30 | high | 10/30/60 | 瘟熊 | [36,60] |

> 与图段映射见 §6.1（`config.areas[*].enemyIds`）。注意：变异怪目前只有血狐/骨狼/幽影兔/瘟熊 4 种，且仅出现在图6–图10。

### 4.2 怪物属性公式 `scaleEnemyStats`（代码原文，已落地）
```
base = Config.battle.areaEnemyStats[area.id]        // 每图固定基准（按图中点等级校准）
tm   = Config.battle.typeMult[enemy.enemyType]       // normal1.0/evolved1.1/mutant1.2
[lo,hi] = area.levelRange;  mid = (lo+hi)/2
ratio  = clamp(level / mid, 0.25, 1.6)              // level = 钳制后的怪等级
diff   = area.difficulty || 1.0
hp  = round(base.hp  * ratio * tm * diff)
def = round(base.def * ratio * tm * diff)
atk = round(base.atk * ratio * tm * diff)
spd = enemy.spd
```
- `areaEnemyStats` 基准（10 图，按图中点校准）：图1 238/54/20 → 图10 2641/510/226（详见 `config.battle.areaEnemyStats`）。
- 例：图1 腐噜兽（normal，diff1.0）在玩家 Lv1 时 ratio=clamp(1/3.5,.25,1.6)=0.286 → hp≈68 / atk≈15 / def≈6（新手友好）；玩家 Lv6（图1 上限）时 ratio=1.6 → hp≈381 / atk≈86 / def≈32。

### 4.3 新手保护现状（**⚠️待定 / 与文档冲突**）
- **数据地图 v1 §9 标注**：「仅第 1 张图 corrupted-forest `difficulty: 0.6` 已落地」。
- **代码实际**：`config.battle.areas` 全部 10 图（含 corrupted-forest）`difficulty: 1.0`。**0.6 难度乘子未实现。**
- **当前新手保护实际机制**（替代 0.6）：`rollEnemyLevel` 把怪等级钳进图段 + `ratio` 下限 0.25。Lv1 进图1 时怪强度 = 图基准 × 0.25，极弱，配合减法伤害下怪攻击低于玩家防御 → 几乎不掉血，能稳定开战升级（`vtest_enemy_level` 用例 4 已守）。
- **待主理人拍板**：0.6 是已被 2026-08-30 重做废弃，还是需补回 `config.areas`？本 GDD 按代码现状（全 1.0）描述，但把 0.6 列为待定回填项（见 §3.3-2）。

### 4.4 掉落品质权重 `rarityWeights` vs 实际掉率 `lootTier`（**⚠️待定 / 设计债**）
- **悬浮提示展示**（`ui-battle.js` `renderEnemyTip`）：读 `enemy.rarityWeights` 显示"白 X% · 蓝 Y% · 金 Z%"。
- **实际掉率**（`drop.js` `pickDropRarity`）：完全由 `enemy.lootTier` 决定，分三桶：
  - `high` → 必出**金**；
  - `mid` → 75% 蓝 / 25% 白；
  - `low` → 85% 白 / 15% 蓝（**不出金**）。
  - 另：装备"掉落稀有度"词缀可把稀有度升一档（白→蓝→金）。
- **冲突**：两者数值体系不一致。`rarityWeights` 显示的金概率（如 腐噜兽 gold 2%、影刃兔 gold 40%）与实际掉率（腐噜兽 low→0 金、影刃兔 high→100% 金）严重不符。**`rarityWeights` 当前仅作展示，不参与 `drop.js` 任何计算。**
- **影响**：玩家看到的"掉落品质"与实际掉落逻辑脱节，可能误导刷图预期。
- **待定**：① 二选一——要么让 `drop.js` 改用 `rarityWeights` 加权抽稀有度（需改 `pickDropRarity`），要么把悬浮提示改为展示 `lootTier` 实际概率（或明确标注"参考概率"）；② 数据地图补口径说明（见 §3.3-4）。

### 4.5 经验公式（**⚠️待定 / 需求文档公式已过时**）
- **代码实际**（`pet.js` `expBase`/`expFromBattle`/`expRange`，悬浮提示 `ui-battle.js` 调用 `Pet.expRange`）：
  ```
  expBase   = Config.exp.perWinCoef × 怪物等级^perWinExponent × 区域difficulty × rate
            = 4 × level^1.0 × diff × 1.0          // perWinCoef=4, perWinExponent=1.0, rate=1.0
  实发      = round(expBase × (1 ± perWinJitter=0.25))，保底 perWinMin=1
  ```
  - 例：图1 Lv3.5（中点）→ 14/场（区间 [11,18]）；图1 Lv6 上限 → 24/场（区间 [18,30]）。
- **需求文档《战斗界面-怪物悬浮提示需求.md》§1.5 给的公式**：`round((enemy.level × 5 + enemy.maxHp × 0.1) × enemy._diff)`。
  - 例：同 Lv3.5 图1（怪 maxHp≈238）→ (17.5 + 23.8) = 41.3，与代码 14 差 3 倍，且随 maxHp 放大。
- **结论**：需求文档的经验公式**已过时、未被代码采用**。悬浮提示实现走 `Pet.expRange`（同源实发），"看到=拿到"。需求文档该条公式应作废。

### 4.6 设计待办"怪物等级系统需重做"——现状回应
- **设计理念 §12 待办**明列「怪物等级系统：需要重做」。
- **代码现状：该功能已完成（2026-08-30 用户拍板）**。具体落地：
  - 每图 `levelRange` + `recGrowth`（`config.battle.areas`）；
  - `rollEnemyLevel` 钳进图段（含上限/下限/段内逻辑）；
  - `scaleEnemyStats` 等级缩放（ratio 0.25~1.6）+ 类型乘子 + 难度乘子；
  - `config.exp` 经验产出与需求同量纲（`needBase×lv^1.3` vs `4×lv×diff`，指数差 0.3 控节奏）；
  - `vtest_enemy_level.js` / `vtest_enemy_balance.js` 已守护 5 + 6 条承诺。
- **建议**：该项待办应标记为"已实现/已过时"，从 §12 移除或改为"怪物等级系统已完成，待补充 Boss/剧情怪"。

### 4.7 待定项汇总（标红）
| # | 待定项 | 现状 | 建议动作 |
|---|---|---|---|
| D1 | 新手保护 difficulty 0.6 是否废弃 | 代码全图 1.0，文档称已落地 0.6 | 主理人拍板：补回 0.6 或更新文档删除该说法 |
| D2 | `rarityWeights` 展示 vs `lootTier` 实际掉率不一致 | 展示体系与掉率体系脱钩 | 二选一统一（改 drop.js 或改悬浮提示口径）+ 数据地图补说明 |
| D3 | 经验公式需求文档版过时 | 代码用 `Pet.expRange`，文档写 `lvl×5+maxHp×0.1` | 文档 §1.5 公式作废 |
| D4 | 设计待办"怪物等级系统需重做" | 代码已实现 | 待办标记已实现 |
| D5 | 变异怪仅 4 种、覆盖图6–10 | 腐噜兽/毒沼蛙/尸犬/疫毛兽无 mutant 敌怪 | 确认是有意设计还是待补 |

---

## 5. 界面与交互流程

引用 `ui-battle.js` 的**敌方怪物悬浮提示**（`#enemy-tip`，鼠标悬停 `#enemy-icon` / `#enemy-icon-name` 触发）。

### 5.1 显示字段（已落地，对齐需求文档"全加"结论）
| 分组 | 字段 | 数据来源 | 实时刷新 |
|---|---|---|---|
| 标题 | 名称 / `Lv.X` / 类型标签（普通/进化/变异） | `enemy.name` / `enemy.level` / `enemy.enemyType` | 换场全量 |
| 基础属性 | 生命 当前/上限、攻击、防御、速度 | `enemy.hp`/`maxHp`/`atk`/`def`/`spd` | **生命每 tick 实时**（随 `updateBars`） |
| 战斗属性 | 暴击、暴伤、命中、闪避、吸血 | `enemy.critRate` 等 | 本场不变 |
| 掉落信息 | 地图难度 `×X.XX`、经验 `+X`、掉落品质 白/蓝/金% | `enemy._diff` / `Pet.expRange` / `enemy.rarityWeights` | 本场不变 |

### 5.2 交互与边界（已落地）
- **触发**：`mouseenter` 显示、`mouseleave` 隐藏；固定位置（立绘左侧偏上，超左缘翻到右侧），不跟鼠标。
- **实现钩子**：`resetBattle()` 调 `renderEnemyTip` 全量刷新（换场重算）；`updateBars()` 只更新"生命 当前/上限"。
- **边界**：① 战斗未开始 `state.enemy` 为 null → 不弹；② 换场 `beginFight` 重算 `state.enemy` → 提示框无缝切新怪；③ 战斗中切出战宠不影响怪数据，提示框不变。

### 5.3 与第 4 章冲突的界面说明（**⚠️待定，同源 D2/D3**）
- 悬浮提示的"掉落品质 白X%/蓝Y%/金Z%"读的是 `rarityWeights`（**展示值**，见 4.4），与实际掉率（`lootTier`）不符——玩家可能误判。建议改为展示 `lootTier` 真实概率或标注"参考概率"。
- 悬浮提示的"经验 +X"走 `Pet.expRange`（**与实发同源**，正确），与需求文档 §1.5 的过时公式不同（4.5）。实现是对的，文档公式应作废。

---

## 6. 模块依赖与接口

### 6.1 怪物 ↔ 地图生成（`config.areas.enemyIds` → `enemy-data.js`）
- 地图通过 `Config.battle.areas[*].enemyIds` 引用 `enemy-data.js` 的 `id` 列表决定"这张图刷哪些怪"。
- 运行时 `battle.js getAreaEnemyPool(area)`：取 `enemy-data.list` 中 `id ∈ area.enemyIds` **且** `levelRange` 与图 `levelRange` 重叠的怪，组成该图怪池；`pickWeighted` 按 `weight` 抽一只。
- 当前每图怪池（代码实际）：

| 图 id | 名称 | levelRange | enemyIds（数量） | 类型构成 |
|---|---|---|---|---|
| corrupted-forest | 枯荣之地 | [1,6] | wild-rotten, wild-bloodfox (2) | normal×2 |
| plague-swamp | 泣腐泥沼 | [7,12] | +wild-plaguebear, wild-bogfrog (4) | normal×4 |
| shadow-mountains | 白骨旷野 | [13,18] | +wild-bonewolf, wild-shadowrabbit, wild-corpsehound, wild-plaguecat (6) | normal×6 |
| bone-wastes | 幽影迷境 | [19,24] | wild-bloodfang-fox, wild-netherfrost-wolf, wild-withermaw, wild-blightspine, wild-umbra-rabbit, wild-bog-king (6) | evolved×6 |
| blood-rift | 血潮裂谷 | [25,30] | 同上 6 只 evolved (6) | evolved×6 |
| echo-cliffs | 回响崖 | [31,36] | wild-bog-king, wild-umbra-rabbit + 4 mutant (6) | evolved×2 + mutant×4 |
| rotfen-bog | 腐沼泽 | [37,42] | 4 mutant + wild-bog-king, wild-umbra-rabbit (6) | mutant×4 + evolved×2 |
| ember-hollow | 余烬渊 | [43,48] | 同 rotfen-bog (6) | mutant×4 + evolved×2 |
| soul-abyss | 魂渊 | [49,54] | 同 rotfen-bog (6) | mutant×4 + evolved×2 |
| blight-heart | 腐变之源 | [55,60] | 同 rotfen-bog (6) | mutant×4 + evolved×2 |

> 注意：`config.areas` 顺序即等级（blight-heart 为最终图，第10位，2026-08-30 用户拍板）。改 `enemyIds` / 图顺序须同步 `areaEnemyStats` / worldmap / 主线任务等级。

### 6.2 怪物 ↔ 掉落 / 交易
- 怪物本身**不进市场**；只通过 `drop.js rollReward` 产出"产物"（装备/蛋/材料）再进入交易循环。
- 装备 → `Equipment.generateEquipment(rarity, areaTier, matTier)`（areaTier = 图序号+1，见 `vtest_drop_tier` 守护 10 图对齐）→ 写入 `Items` → 可上架交易。
- 蛋 → `Drop.getEnemyEggBase` 取 `eggBaseName` → 孵化出基宠（`Pet.createBaby`）→ 基宠可上架交易（`Market`）。
- 材料 → `Materials.gain` 累加，多数为可交易材料（`config.trade.materials`）。

### 6.3 怪物 ↔ 经验
- `Pet.expFromBattle(enemy, area)` / `Pet.expRange(enemy, area)` 以 `enemy.level`（= 钳制后等级）与 `area.difficulty` 为输入，保证"经验跟图走、被图上限封顶"（见 `vtest_enemy_level` 用例 5）。

---

## 7. 边界与"不做"项

- **怪物无独立数据库表**：纯前端 `enemy-data.js` 配置，不落 `pets`/`equipments` 等任何表（与数据地图 v1「纯机制不新增表」一致）。
- **怪物数值不由玩家成长倒推**：定死 `areaEnemyStats` + 等级缩放，怪是"死靶子"（用户拍板，避免"3.5 刀"设计意图失效）。
- **`rarityWeights` 不参与掉率**：仅展示（见 4.4 / D2）。
- **无 `enemy.level` 运行时意义**：字段被 `rollEnemyLevel` 覆盖，仅库内 `levelRange` 兜底用。
- **杂兵怪（无 `eggBaseName`）已移除**：当前 18 只全部有 `eggBaseName`，不会退化成"无掉落"。
- **不做 Boss / 剧情怪 / 技能怪**：当前全部为同类自动战斗野怪，无特殊机制（契合设计理念 §9 不做项）。
- **不新增怪物专属经济/赛季**：怪物只产出通用养成物与材料。
- **进化/变异敌怪不掉自身高阶形态蛋**：只掉对应基宠蛋（蛋→养成→进化/合成）。

---

## 8. 验收标准与测试点

### 8.1 每图怪物分布（对照 §6.1）
- [ ] 10 张图 `enemyIds` 均能解析到 `enemy-data.js` 存在的 id（无悬空引用）。
- [ ] 每图怪的 `levelRange` 与图 `levelRange` 重叠（`getAreaEnemyPool` 不返回空池）。
- [ ] 低图（图1–3）出 normal、中图（图4–5）出 evolved、高图（图6–10）含 mutant，类型梯度成立。
- [ ] `config.areas` 顺序 = 等级顺序（blight-heart 第10位为最终图）。

### 8.2 三型掉落差异（对照 §2.2 / §4.4）
- [ ] `typeMult` 生效：同图同级 mutant 血/攻/防 > evolved > normal（1.2 > 1.1 > 1.0）。【`vtest_enemy_balance` 用例 3 守护】
- [ ] 变异怪 `lootTier:'high'` → 装备掉落实际出金（与悬浮提示金概率最高的定位一致）。
- [ ] **【D2 验收】** 悬浮提示展示的"掉落品质%"应与实际 `lootTier` 掉率口径一致（当前不一致，需先修 D2 再验）。

### 8.3 等级段平衡（对照 §2.1 / §4.2 / §4.6）
- [ ] 怪等级 = clamp(玩家等级, 图下限, 图上限)：段内相等、超上限取上限、低于下限取下限。【`vtest_enemy_level` 用例 1/2/3 守护】
- [ ] Lv1 进图1 能稳定开战并升级（新手保护生效）。【`vtest_enemy_level` 用例 4】
- [ ] 经验随图封顶，不随玩家等级无限涨。【`vtest_enemy_level` 用例 5】
- [ ] 裸装正常玩家（成长 5.5）全图 3~6 刀、穿装备 3~4.5 刀、变异怪更硬、成长翻倍可碾压（≤2 刀）。【`vtest_enemy_balance` 全用例守护】
- [ ] 装备图档与 10 图对齐（图N→areaTier=N，不被钳回 6）。【`vtest_drop_tier` 守护】
- [ ] T1 词缀稀缺性底线（金装 T1≈2%，白/蓝抽不到 T1）。【`vtest_tier_rarity` 守护】

### 8.4 引用测试清单
- `docs/tests/vtest_enemy_level.js` — 怪物等级钳进图段（5 用例）。
- `docs/tests/vtest_enemy_balance.js` — 怪物数值/类型分层/碾压（6 用例）。
- `docs/tests/vtest_drop_tier.js` — 装备图档与 10 图对齐（4 用例）。
- `docs/tests/vtest_tier_rarity.js` — T 阶稀缺性与重铸防回归（4 用例）。

### 8.5 需在 D1–D5 解决后才能关闭的验收项
- D2（rarityWeights/lootTier 统一）解决前，§8.2 第三条验收暂不通过。
- D1（0.6 新手保护）拍板后，§8.3 第二条的"保护机制描述"需据最终结论定稿。
- D4（怪物等级系统待办）关闭后，§12 待办应同步更新。

---

> **最后重申头号发现**：设计理念 §6 怪物旧名录（腐噜兽/骨虫/毒蟾/血蝠/石甲兽/瘟疫犬/幽影蛇/骨刺兽/血牙狼/腐尸魔/冥火鸦/瘟甲卫）与代码不符，**已作废**；以本 GDD §4.1 的代码实际 18 只 / 三型名录为准。其余 D1–D5 为代码与滞后文档的次级冲突，待主理人统一回填。
