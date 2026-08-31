# 宠物系统 GDD（正式设计文档 · v1.0）

> **事实源声明**：本文档以 `docs/js/` 下运行代码为唯一事实源，设计文档《游戏设计理念，所有Agent必须阅读.md》《游戏数据地图 v1.md》《第1大陆完整设计 v1.md》仅作参考。凡代码与设计文档冲突处，**以代码为准**，并在 §3/§8 与文末「关键发现」中显式标注。
>
> 涉及文件：`pet/pet.js`、`pet/pet_merge.js`、`pet/pet_evolve.js`、`pet/enemy-data.js`、`core/config.js`、`core/pet-sprites.js`、`ui/ui-pet.js`、`ui/ui-codex.js`、`core/drop.js` 及 `tests/vtest_evolution*.js`、`vtest_mutation.js`、`vtest_egg.js`、`vtest_pet_balance.js`、`vtest_pet_anim.js`。

---

## 1. 系统定位与目标

**一句话**：宠物是玩家挂机养成与真实交易的核心资产，提供「进化 / 涅槃 / 合成 / 孵化」四条成长路线，让玩家追求高成长值、稀有「·异变」形态与形态收集，并在真实玩家中倒卖宠物。

**玩家动机 / 核心 G 点**：
- **求而不得感**：开出高成长值宠物、或合成出「·异变」变异宠时的惊喜（代码 `synthesize.mutation.chance = 0.5`，合成是变异宠主来源）。
- **收集与成长**：8 基宠 → 3 阶进化链（共 16 个互不重复的终极形态）的形态收集满足感；成长值从 ~5 经涅槃滚到软上限 100。
- **交易驱动**：宠物可上架真实玩家市场（材料计价、可捡漏），养成与交易形成闭环。

**设计支柱（与全局一致）**：
1. **养成为主体**：宠物是交易标的与挂机伙伴，养成靠四条路线而非一次性数值。
2. **全拉平可用**：8 只基宠同养成下净推进极差 ≤ 1.35×，无废宠、无独大（见 §4 平衡承诺与 `vtest_pet_balance.js`）。
3. **净推进优先**：数值平衡守的是「净推进（含回血停机）」，而非裸 DPS。

---

## 2. 核心机制与规则

宠物系统由 **进化 / 涅槃 / 合成 / 孵化 / 出战** 五个机制组成，全部为「纯前端 + 云端存档」机制，复用 `pet` 实体（不新增表/字段）。

### 2.1 属性计算（统一公式）
- **裸属性**（成长/等级参与）：
  - `hp = baseHp + round(Lv × growth × C.hp)`
  - `atk = baseAtk + round(Lv × growth × C.atk)`
  - `def = baseDef + round(Lv × growth × C.def)`
  - 系数 `C` = 按宠物 `lineId`（来源基宠）查 `Config.pet.starters[].statCoeff`；进化体/变异宠/合成宠继承来源基宠的系数，保证一条线风格统一；查不到用全局兜底 `Config.pet.statCoeff = {hp:5, atk:2, def:1}`。
- **速度**（成长/等级**不参与**）：`spd = Config.pet.speeds[lineId] + 装备速度加成`。进化/变异/合成不改变速度档，`·异变` 后缀去除后回退到来源基宠速度；终极形态名不在表里时按形态名反查根源基宠速度。
- **总属性**（装备加成）：`裸属性 ×(1+装备百分比) + 装备固定值`；机制属性（命中/闪避为固定数值，暴击/暴伤/吸血为百分比）来自 `petProfiles[lineId]` + 装备加成。
- **等级上限** `Config.pet.maxLevel = 60`；经验曲线见 `config.exp`（产出与需求同量纲）。
- **持久血量**：`curHp` 跨场战斗延续，非战斗按 `Config.regen.hpPerSecRatio = 0.2`（每秒回 20% 上限）自动恢复；升级/进化/涅槃后回满。

### 2.2 进化（Evolve.evolve）
- **路线结构（代码实测）**：8 基宠各有 **2 条 Lv.10 首段路线**（共 16 首段形态）；每条首段路线后续各 1 段 Lv.25、1 段 Lv.40，形成 **3 阶进化链**，16 条链的终极形态（第3阶）互不重复。
- **进化次数上限** `maxEvolveTimes = 10`：
  - 第 1~3 次：走进化树（Lv10 → Lv25 → Lv40 三段门槛）；
  - 第 4~10 次：形态到头后由 `getEvolutionRoutes` 返回「继续进化（成长+）」占位路线（`keepForm=true`，形态/名字不变，仅涨成长）。
- **规则**：100% 成功；**等级不变**；成长值 `+(growthBoost = 0.1~0.2)`；名字变为进化体；进化次数 +1；同步云端（name/growth/evolve_times）。
- **素材分档**（按已进化次数）：1~3 次 = `进化素材`，4~6 次 = `精粹进化素材`，7~10 次 = `传说进化素材`（每次消耗 ×1）。
- **前置**：已登录、已云端建档（`cloudId`）、不在售、等级 ≥ 该段 `minLevel`、对应素材足够。

### 2.3 涅槃（Merge.nirvana，旧 `Merge.merge` 别名）
- **效果**：主宠保留，吸收副宠成长；副宠消失；主宠**等级重置为 1**、进化次数清零、转生次数 `rebornCount +1`；突破成长上限。
- **吸收公式**（纯函数 `calcNirvanaGrowth`，与 UI 预览同源）：
  ```
  lvBonus  = 1 + max(0, 副宠.level − 40) × levelBonus(0.01)      // 副宠练得越高越值钱
  ratio    = 副宠.growth < 主宠.growth × subGrowthRatio(0.5) ? lowGrowthPenalty(0.2) : 1
  capRatio = 主宠.growth ≥ growthCap(60) ? capRatio(0.5) : 1
  absorb   = 副宠.growth × absorbRatio(0.5) × lvBonus × ratio × capRatio
  if 主宠.growth ≥ maxGrowth(100): absorb = 0                      // 软上限：仅重置等级
  新成长   = round((主宠.growth + absorb) × 10) / 10
  ```
- **消耗**：`涅磐兽 ×1`；`minLevel = 40`（主副均须 ≥40）。
- **前置**：双方 ≥40 级、已登录、已建档、不在售、**未穿装备**、材料足够。

### 2.4 合成（Merge.synthesize → 出「·异变」变异宠）
- **概率变异**：`mutation.chance = 0.5` 触发变异。
  - **变异成功**：新宠名 = `主宠名 + ·异变`；成长 = `主×mainW(0.6) + 副×subW(0.4) + randInt(growthBonus[1,3])`。
  - **变异失败**：新宠名 = `主宠名`（无后缀，继承主宠形态）；成长 = `主×0.6 + 副×0.4`（无加成）。
  - 已带 `·异变` 的主宠不再叠加后缀。
- **消耗与状态**：两只素材宠**都消失**；新宠等级回 1、经验清零；`lineId` 继承主宠（系数/速度/profile 继承）；消耗 `合成之石 ×1`；`minLevel = 40`。
- **前置**：双方 ≥40 级、已登录、已建档、不在售、**未穿装备**、材料足够。

### 2.5 孵化（Drop.hatchEgg）
- **掉落**：每只野怪按 `eggBaseName` 决定蛋品种；进化/变异怪掉落其**根源基宠**的蛋（如 `血牙狐` → `血狐蛋`），孵化始终为基础形态，不直接给高阶形态。
- **孵化**：消耗一颗该品种蛋 → `createBaby(baseName)` 定向生成对应基础宠（成长 `babyGrowth = 3~8` 随机）→ 自动设为出战 → 云端建档 + 云端标记该蛋已孵化。
- **前置**：需登录（未登录不能孵化）。

### 2.6 出战（Pet.setActive / Pet.setActive）
- 出战宠物由 `activePetId` 持有；云端 `is_active` 持久化，刷新后还原。
- 新玩家从 8 基宠选 1（`PET_POOL`）；老存档的 `莱姆` 仅作兼容，不再作为新号初始宠。
- **上架中的宠物不可设为出战**（防挂单快照与实物不一致，见 `pet.js setActive` 校验）。
- 出战宠物被移除（如合成/涅槃消耗）时，自动切到第一只并同步 `is_active`。

---

## 3. 数据模型

### 3.1 宠物实体（代码 `pet.js` `createPet` / `petFromRow`）
本地宠物对象字段（运行时）：
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 本地自增 uid |
| `name` | string | 形态名（含进化体/·异变后缀） |
| `icon` | string | emoji 图标 |
| `level` / `exp` | int | 等级 / 经验 |
| `growth` | number | 成长值（核心养成维度） |
| `evolveTimes` | int | 已进化次数（0~10） |
| `rebornCount` | int | 转生（涅槃）累计次数 |
| `lineId` | string | 来源基宠名（决定 statCoeff / 速度档 / profile 继承） |
| `baseHp` / `baseAtk` / `baseDef` | number | 基础值（非当前属性） |
| `baseSpd` | number | 速度基础值（仅存档/展示；战斗速度查 speeds 表） |
| `curHp` | number | 持久血量（跨场延续） |
| `cloudId` | string\|null | 云端 `pets.id`（上架/存档用） |
| `equipment` | object | 12 部位 → 装备对象/null |

### 3.2 云端 `pets` 表列（由 `petFromRow` 反推）
`id, owner_id, name, growth, level, exp, evolve_times, reborn_count, hp(=baseHp), attack(=baseAtk), defense(=baseDef), speed(=baseSpd), cur_hp, is_active, equipment(部位→cloudId 映射)`。

### 3.3 云端 `pet_egg` 表列（由 `drop.js` 反推）
`id, owner_id, egg_type(品种=基础宠名), status(未孵化/已孵化), pet_id(孵化后关联新宠物)`。

### 3.4 ⚠️ 需回填《游戏数据地图 v1.md》的字段变更（仅列出，由主理人统一合并，**本文不修改数据地图文件**）
> 数据地图 §2（pet）与代码严重脱节，需补充/修正：

1. **补充缺失字段**：`pet` 实体当前缺 `icon`、`exp`、`evolve_times`、`reborn_count`、`lineId`、`baseHp/baseAtk/baseDef`、`baseSpd`、`curHp`、`cloudId`、`equipment(12槽)`。
2. **修正语义冲突（重要）**：数据地图把 `hp/attack/defense/speed` 当作「当前属性列」，但代码里这些列存的是**基础值**（`baseHp/baseAtk/baseDef/baseSpd`），当前属性由公式实时计算**不落库**；真正落库的血量是 `cur_hp`。建议在数据地图加注：`hp/attack/defense/speed = 基础值`，并新增 `cur_hp`（持久血量）。
3. **补充进化/转生计数列**：`pet` 需新增 `evolve_times`（进化次数）、`reborn_count`（转生次数）。
4. **补充恐龙蛋品种列**：`pet_egg` 需新增 `egg_type`（品种，基础宠名），并明确 `pet_id` 孵化后回写。
5. **材料类型不全（与宠物系统交叉）**：数据地图 §4 `material.type` 仅列 `强化石/祝福石/涅磐兽`，缺宠物系统相关材料 `合成之石`、`进化素材/精粹进化素材/传说进化素材`、`宠物蛋`。此条涉及材料实体，建议与地图/怪物 Agent 协商后一并补（本 Agent 不擅自动）。
6. **进化配置键名不一致**：数据地图 §9 写成 `config.pet.evolution.routes`，代码实际为 `config.pet.evolution.tree`；建议统一为 `tree`。

---

## 4. 数值与平衡现状（代码实测）

### 4.1 8 基宠基础数值（Config.pet.starters + petProfiles + speeds）
| 基宠 | baseHp | baseAtk | baseDef | statCoeff(hp/atk/def) | 速度 | 定位(profile) | 暴击/暴伤/命中/闪避/吸血 |
|------|-------:|--------:|--------:|----------------------:|-----:|--------------|--------------------------|
| 腐噜兽 | 110 | 22 | 11 | 4.9 / 2.38 / 1.02 | 80 | 均衡快刷 | 8 /145/90/5/0 |
| 血狐 | 85 | 30 | 8 | 3.22 / 2.22 / 0.92 | 96 | 暴击爆发 | 18 /190/92/5/0 |
| 瘟熊 | 160 | 18 | 18 | 5.7 / 2.42 / 1.12 | 70 | 重甲稳刷 | 5 /135/95/2/4 |
| 疫毛兽 | 95 | 26 | 9 | 4.0 / 2.28 / 0.96 | 92 | 敏捷输出 | 9 /150/92/8/0 |
| 骨狼 | 105 | 25 | 10 | 4.3 / 2.24 / 0.99 | 88 | 攻击均衡 | 11 /160/92/5/2 |
| 毒沼蛙 | 130 | 20 | 14 | 5.2 / 2.36 / 1.08 | 75 | 耐久输出 | 6 /140/95/8/3 |
| 尸犬 | 120 | 21 | 13 | 4.6 / 2.25 / 1.05 | 84 | 稳定快刷 | 8 /150/90/6/3 |
| 幽影兔 | 70 | 24 | 7 | 3.35 / 2.34 / 0.90 | 100 | 极速连击 | 4 /130/88/12/0 |

- 全局兜底 `statCoeff = {hp:5, atk:2, def:1}`；默认 profile = 均衡型（暴击8/暴伤150/命中90/闪避5/吸血0）。
- 速度带已收窄至 **70~100（差距 1.43×）**；旧版 30~110（3.67×）是「只有兔子能用」的根因（`vtest_pet_balance.js` 守 `≤1.5×`）。

### 4.2 四条路线核心参数
| 参数 | 进化 | 涅槃 | 合成 |
|------|------|------|------|
| 门槛 | 首段 Lv10 / 二段 Lv25 / 三段 Lv40 | 双方 ≥40 | 双方 ≥40 |
| 次数上限 | 10（4~10 为占位成长+） | 无硬上限（软上限成长 100） | 无上限 |
| 成长变化 | +0.1~0.2 | 吸副×0.5×(1+(副Lv−40)×0.01)，分水岭/下限打折 | 主×0.6+副×0.4 + 变异[1,3] |
| 消耗 | 进化素材×1（按次数分 3 档） | 涅磐兽 ×1 | 合成之石 ×1 |
| 等级 | 不变 | 重置 1 | 新宠 1 |
| 形态 | 换形态 | 不变 | 主名+·异变（50%）或主名 |

- **涅槃细项**：`absorbRatio=0.5`、`levelBonus=0.01`、`subGrowthRatio=0.5`、`lowGrowthPenalty=0.2`、`growthCap=60`、`capRatio=0.5`、`maxGrowth=100`、`resetLevel=true`（全部 `Config.nirvana`）。
- **合成细项**：`mainW=0.6`、`subW=0.4`、`mutation.chance=0.5`、`growthBonus=[1,3]`（全部 `Config.synthesize`）。
- **孵化**：`babyGrowth=[3,8]`；掉率 `eggChance=0.015`（≈5 颗/小时）。
- **通用**：`maxLevel=60`、`regen.hpPerSecRatio=0.2`；进化素材掉率三档均 `0.03`，按图递进（`areaEvolutionTiers`：图1 普通 / 图2~4 普通+精粹 / 图5 三档 / 图6+ 精粹+传说）。
- `涅磐兽` 独立掉率 `phoenixChance=0.002`；`合成之石` 独立掉率 `synthesizeChance=0.03`。

### 4.3 平衡承诺（由 `vtest_pet_balance.js` 守护）
1. 8 只基宠全等级段净推进（含回血停机）差异 **≤ 1.35×**；
2. **无废宠**：任何宠在任何图都不会打不过（单场净掉血 < 满血）；
3. **立住 trade-off**：速度越快 → 单场掉血占比越高、连打场数越少（快脆慢肉）；
4. **无独大**：不存在碾压其余的宠物。

### 4.4 🔴 待定 / 需主理人拍板的数值（标红）
- **🔴 进化门槛冲突**：代码首段进化为 **Lv.10**，但《数据地图 v1》§9 与《设计理念》§5.2 均写「**30 级后可进化**」。当前代码实际为 **Lv10/25/40**。→ 需主理人确认以哪份为准（文档滞后 or 代码待改）。
- **🔴 系数冲突**：《设计理念》§5.2 写系数为「生命 20 / 攻击 5 / 防御 3 / 速度 1」，代码实测每只宠系数约 3~6（全局兜底 5/2/1），文档数值约为代码 **4 倍**，明显滞后。→ 建议更新设计理念系数描述（见 §8 关键发现）。
- **🔴 合成材料冲突**：《设计理念》§5.2 写合成「消耗 1 个涅磐兽」，代码实测消耗 **合成之石 ×1**。→ 以代码为准，文档需更正。
- **🔴 合成产物名冲突**：《设计理念》§5.2 称合成「产出全新宠物（不沿用主宠名字）」，代码实测新宠**继承主宠名**（+·异变 后缀）。→ 以代码为准。
- **待定**：宠物蛋掉率 0.015（≈5 颗/小时）是否过低（设计理念称孵化是普通宠主来源，但已被砍；任务链发蛋补）。是否需上调。
- **待定**：合成变异概率 0.5 是否合理（设计理念未给数字）。
- **待定**：成长软上限 100 在 60 级封顶 + 涅槃等级重置下是否可达。

---

## 5. 界面与交互流程

引用 `ui/ui-pet.js` 与 `ui/ui-codex.js` 现有实现（**本文不修 UI，仅描述**）。

### 5.1 宠物页（ui-pet.js）
多 Tab 结构（顶部 `pet-tabs` 切换 `pet-tab-pane`）：
- **资料 Tab**：出战宠物面板（`renderPetPanel`），含属性（含装备加成）、等级/成长/进化次数/转生次数；大头像优先逐帧动画立绘，无则回退头像（`PetSprites.mountAnimated/mountAvatar`）。
- **装备 Tab**：`renderEquipSlots` 12 槽沿立绘四边环绕；`renderPetEquipInv` 换装背包（按部位/稀有度/底材T/词缀T/词缀类型筛选），悬停看属性面板。
- **进化 Tab**：`renderEvolveTab` → `renderEvolveStage` → `renderEvolvePreview` 三段式（选主宠 → 选方向 → 预览确认）。预览阶段把成长加成**定死进 state（evolvePreview.boost）**，确认时原样传给 `Evolve.evolve`，做到「所见即所得」，避免 `renderAll` 每秒重建冲掉预览。
- **涅槃 Tab**：`renderMergeTab` 三段式（选主宠 → 选副宠 → 预览确认），调 `Merge.nirvana`。
- **合成 Tab**：`renderSynthTab` 三段式（选主素材 → 选副素材 → 预览确认），调 `Merge.synthesize`，预览含变异概率 `mutPct`。
- **宠物蛋 Tab**：`renderEggPanel` 按品种展示（每种蛋一张卡：品种名 + 数量 + 孵化按钮），调 `Drop.hatchEgg`，孵化后自动出战并弹窗。

**出战列表**：`renderPetList` 卡片显示「出战」徽章，点击切换出战（上架中宠物拦截并提示取回）。

### 5.2 百科页（ui-codex.js）
`renderCodex` 懒渲染 8 板块，其中「宠物」「变强 4 条路」直接动态读取 `Config` 数值（`buildPet` / `buildGrowth`），**禁止写死第二份数值**（config.js 是唯一数值源）。规则陈述「是什么、多少」，不出现玩法建议。

### 5.3 宠物立绘（pet-sprites.js）
- `pathOf/avatarOf/animOf` 按形态名取立绘/头像/动画；`·异变` 后缀自动回退基础形态素材。
- `ANIM_ENABLED = false`（当前帧间是 AI 重绘非连贯动作，播放即闪烁，故关停），全部形态走静态立绘 + CSS 连贯动作（呼吸/受击/冲刺）。数据保留 `animMap`，拿到真正连贯 spritesheet 后改回 `true` 即可。

---

## 6. 模块依赖与接口

### 6.1 本系统内部模块
- `pet/pet.js`（窗口 `Pet`）：数据模型、属性计算、经验/升级、持久血量、随机婴儿、云端行↔对象。
- `pet/pet_merge.js`（窗口 `Merge`）：`nirvana` / `synthesize` / `merge`(别名) / `getMergeCandidates` / `canMerge` / `calcNirvanaGrowth` / `calcSynthesizeGrowth`。
- `pet/pet_evolve.js`（窗口 `Evolve`）：`evolve` / `getEvolutionRoutes` / `hasRoute` / `canEvolve` / `getEvoTier` / `getRouteMaterial`。
- `pet/enemy-data.js`（窗口 `EnemyData`）：野怪池（含 `eggBaseName` 蛋映射），本系统**只读取蛋映射**，不负责进化/合成/变异逻辑。

### 6.2 依赖的外部系统/文件
- `core/config.js`：全部数值唯一源。
- `core/pet-sprites.js`：立绘/头像/动画资源映射。
- `core/drop.js`（窗口 `Drop`）：`hatchEgg` / `rollReward`（蛋与材料掉落）。
- `core/materials.js`（窗口 `Materials`）：材料计数与扣减（`getQuantity/spend/gain`）。
- `core/market.js`（窗口 `Market`）：`isListed` 在售校验（进化/涅槃/合成/出战前置）。
- `core/supabase.js`（窗口 `Supabase`）：云端存档/上架/删除宠物、蛋消费。
- `ui/ui-pet.js` / `ui/ui-codex.js`：界面。
- 战斗系统（`core/battle.js`）：读取 `Pet.getStats` 作为出战属性；`expFromBattle` 给经验；`scaleEnemyStats` 用 `EnemyData` 算野怪属性。
- 任务系统（`core/quest.js`）：进化/涅槃/合成/孵化成功时 `Quest.reportType('evolve'/'nirvana'/'synth'/'hatch')`。

### 6.3 对外暴露 API（供其他系统调用）
`Pet.{getActivePet,setActive,getStats,createBaby,...}`、`Merge.{nirvana,synthesize,merge}`、`Evolve.evolve`、`Drop.hatchEgg`。**不碰**：怪物属性生成、地图难度、市场买/卖实现（属地图/怪物/市场 Agent 范围）。

---

## 7. 边界与「不做」项（MVP 边界）

### 7.1 全局 MVP 边界（依《设计理念》§9）
不做 ARPG、不做天赋树、不做技能系统、不做剧情、不做公会、不做复杂经济/赛季/付费。

### 7.2 宠物系统当前边界
- **不做技能/天赋**：变异宠仅继承定位/属性（来源基宠的 statCoeff+速度+profile），**不额外带技能**。
- **合成 ≠ 繁殖**：合成产全新变异宠并消耗两只素材，不是「配对繁殖」；无宠物性别/性格/繁育。
- **形态速度固定**：进化/变异/合成不改变速度档（速度按来源基宠固定），不做「进化加移速」。
- **必须登录养成**：进化/涅槃/合成/孵化均要求已登录并云端建档，离线不可养成（防存档不一致）。
- **进化链深度**：当前每基宠 2 首段 × (Lv25 × Lv40) 共 3 阶；第 4~10 次进化仅为成长+占位，不做新形态。
- **蛋只给基础形态**：进化宠/变异宠不能直接孵化获得（设计理念 §5.2 一致）。

---

## 8. 验收标准与测试点

以下用例均可由 quality-lead 通过现有 `vtest_*` 脚本直接执行（位于 `docs/tests/`，以 `node vtest_xxx.js` 运行，需同目录 `vstub.js` 与 `../js/vendor/supabase.min.js`）。

### 8.1 进化（vtest_evolution.js / vtest_evolution_true_fork.js）
- [ ] 开局基宠覆盖 8 只；进化树 `tree` 含 8 条多段线，`maxEvolveTimes=10`，通用素材名 `进化素材`。
- [ ] 8 只基宠均有 2 条 **Lv.10** 首段路线；进化树含 **Lv.25 / Lv40** 后续门槛。
- [ ] 进化体速度继承来源基宠（如 `腐沼兽` 速度 = `speed['腐噜兽']`、`影刃兔` = `speed['幽影兔']`）。
- [ ] Lv.5 基宠 `canEvolve=false`；Lv.10 可进化。
- [ ] 进化成功：次数+1、成长提升、名字变化、等级不变、素材扣除、云端同步。
- [ ] 多段链 Lv10→25→40 实际执行可达终点；终点后仅「继续进化（成长+）」占位。
- [ ] 真分叉专项：16 条三段分支全部解析成功、终极形态互不重复、每段 minLevel 严格 10/25/40、不同分支得不同终极宠。
- [ ] 失败用例：素材不足 / 等级不足 / 次数满(10) → 进化失败并正确提示。
- [ ] 进化素材接入 `Drop.rollReward` 掉落。

### 8.2 合成 / 涅槃（vtest_mutation.js）
- [ ] 合成变异（`Math.random=0.01` 命中）：`mutated=true`，名=`主·异变`，成长=主×0.6+副×0.4+1，等级回1、双素材消失、云端建档。
- [ ] 合成未中（`0.5`）：`mutated=false`，名=主宠名（无后缀），成长=主×0.6+副×0.4。
- [ ] 已带 `·异变` 主宠不再叠加后缀。
- [ ] 涅槃：主宠吸副成长、不变异不改名、进化次数清零、转生+1、等级重置1、副宠消失。
- [ ] 副宠等级加成（Lv50 → 吸收×(1+10×0.01)）。
- [ ] 副宠成长不足下限（<主×0.5）→ 吸收打 0.2 折。
- [ ] 60 成长分水岭 → 吸收减半；软上限 100 → 成长不再涨仅重置等级。
- [ ] `Merge.merge` 别名走涅槃语义（无变异）。
- [ ] 变异概率配置 `Config.synthesize.mutation.chance === 0.5`。

### 8.3 宠物蛋（vtest_egg.js）
- [ ] `makeEggName` 品种+「蛋」，已带「蛋」字不重复拼（不出现「宠物蛋蛋」），null 兜底「宠物蛋」。
- [ ] 刷新后按品种恢复（`{血狐:1, 骨狼:2}` 不丢品种）；总数正确；不退化出「宠物蛋」通用品种。
- [ ] 孵化指定品种只扣该品种；云端标记已孵化；旧数据（egg_type=null）也能孵化不「复活」。
- [ ] 登出本地蛋清空（不串号）；`main.js` 用 `setEggs` 按品种恢复、`drop.js` 已删 `setEggCount`。

### 8.4 平衡（vtest_pet_balance.js）
- [ ] 10 张图数量；装备图档/底材档/敌人数值/材料/素材档与 10 图对齐；每图 6 级首尾相接；每图有可用野怪。
- [ ] 8 只宠全等级段（成长 5.5 与 7 两档）净推进极差 **≤ 1.35×**、无死亡、trade-off 成立（快宠单场掉血占比更高）。
- [ ] 速度带 `70~100`，差距 ≤ 1.5×。

### 8.5 立绘动画（vtest_pet_anim.js，改 pet-sprites.js/game.css 时必过）
- [ ] `ANIM_ENABLED=false`；有动画素材形态挂载成功且图 URL 走 `background-image`（非 `--as` 自定义属性）。
- [ ] `steps=帧数`、位移总量=帧数×100%；animMap 素材为单行帧图；`·异变` 后缀回退基础形态动画。
- [ ] 静态立绘 CSS 动作（呼吸/受击/冲刺三段/我方翻转走 `--flip`/命中特效两层）齐全且 transform 以 translate 开头。

---

## 附：关键发现（文档 vs 代码冲突汇总，供主理人决策）

| # | 冲突点 | 设计文档说法 | 代码现状（事实） | 建议 |
|---|--------|--------------|------------------|------|
| 1 | 进化门槛 | 30 级后可进化 | 首段 Lv.10 / 二段 Lv.25 / 三段 Lv40 | 主理人确认以哪份为准 |
| 2 | 属性系数 | 生命20/攻击5/防御3/速度1 | 每只宠约 3~6（全局兜底 5/2/1） | 更新设计理念系数 |
| 3 | 合成材料 | 消耗 1 个涅磐兽 | 消耗 合成之石 ×1 | 以代码为准，改文档 |
| 4 | 合成产物名 | 不沿用主宠名字 | 继承主宠名（+·异变） | 以代码为准，改文档 |
| 5 | 进化体数量 | 共 16 种进化体 | 16 首段 + 16 二段 + 16 三段 = 48 命名形态（3 阶链） | 文档低估树深度，建议重述为「每基宠 2 首段路线，全链 3 阶共 16 终极形态」 |
| 6 | 配置键名 | `evolution.routes` | `evolution.tree` | 统一为 tree |
| 7 | 数据地图 pet 字段 | 仅 id/owner/name/growth/level/hp/atk/def/spd/is_active | 缺 icon/exp/evolveTimes/rebornCount/lineId/base*/curHp/cloudId/equipment；且 hp/atk/def/spd 实为**基础值**，当前属性不算入库 | 按 §3.4 回填 |
| 8 | 材料类型 | 仅 强化石/祝福石/涅磐兽 | 还含 合成之石、进化素材三档、宠物蛋 | 与地图/怪物 Agent 协商补 |

> 注：本文档未修改任何 `.js`/`.sql` 代码，也未直接修改 `游戏数据地图 v1.md`；所有字段回填建议集中在 §3.4，由主理人统一合并，避免与另两个 Agent 冲突。
