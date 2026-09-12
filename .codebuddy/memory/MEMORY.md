# MEMORY — Forge of Souls（2026-09-12 精简版）

> 只放**会变的事实 / 状态 / 决策** + **可复用教训**。流程规范在 skill，别两处维护。
> 当日细节看 `YYYY-MM-DD.md`；审计全文 `docs/代码审计_2026-09-11.md`；墓碑清单 `docs/墓碑代码审计_2026-09-12.md`。

## 1. 项目坐标
- 暗黑风「挂机养宠 + 宠物/装备真实交易」网页游戏。英文名 Forge of Souls，**别译「灵魂熔炉」**。
- 运行源 `docs/`：`docs/js/`（core / ui / pet / equipment + 每系统一目录）；页面 `docs/游戏.html`；CSS 序 vars → design-tokens → app → game → ui-polish。旧骨架 `新demo/` 不开发。
- 循环：挂机 → 材料 → 合成/进化/涅槃 → 打造 → P2P 市场。三爽点：**掉宝/鉴定 > 市场捡漏 > 成长跳变**。不学氪金分层/品级/五行。
- **图 1-10 覆盖 Lv1-60**（`Config.level.maxLevel=60`；17 图是历史残留）。`PROJECT_CONSTITUTION.md` = 拍板账本，头号红项 = **服务端权威**。
- 📌 **入口文件**：`AGENTS.md`（AI 每会话自动读，含六条红线）+ `00-项目导航.md`（Obsidian 首页，含「不许翻的拍板」与「曾经推翻过自己」清单）。改任一个前先确认没跟宪法打架。
- ⚠️ 根 `js` 是 Junction → `docs/js`，会消失。重建：`New-Item -ItemType Junction -Path 'd:/Ai/游戏原型/js' -Target 'd:/Ai/游戏原型/docs/js'`。

## 2. 用户偏好（铁律）
- ⭐ **第一原则写代码**：先问「本质要解决什么、有无更根本解法」再选方案；不顺惯性打补丁/堆抽象/加兼容层。
- ⭐ **不要过度堵住**：收紧类改动**先列全量消费方**逐条判，选**最小作用域**。判据「失败会丢资产吗？」会→拦，「只是没同步上」→不拦。波及面大用 opt-in。
- 一文件一职责；新系统拆独立文件（`trial/`、`tower/`）；数值拆该系统 config。旧代码不回头重构。
- 大白话短句，禁术语堆砌/吹捧。复杂修复分批做。**数值/规则定死**（`areaEnemyStats` 固定表），不引动态难度。
- 宠物图标走立绘/头像，**不回退 emoji**（fallback = 头像 → 立绘 → 空）。

## 3. Git / 并发会话
- 每批改动前 commit+push 当安全点；**只 add 自己改的路径**（`git add -A` 出过事故）；提交前看 `git status --short` 有无意外 `D`。git 不主动 push。
- 🔴 push 被掐 → `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin main`。配套多文件提交必须一起推，推前 `git log --oneline @{u}..HEAD`。
- ⚠️ **多会话并发写同一工作区**：共享文件（`config.js`/`游戏.html`/`battle.js`/`pet*.js`）**改前必须重读**；`?v=` 会互相覆盖；测试在**加载阶段**集体报错先怀疑别人改到一半。
- ✅ 2026-09-13 起 `.codebuddy/memory/` **放行入库**（`skills/`/`agents/` 仍忽略）→ AI 记忆终于有版本历史。验证：`git status -uall .codebuddy` 应恰好 20 个文件。
- 🔴 **gitignore 父子目录陷阱**：`.codebuddy/**` + `!.codebuddy/memory/` **无效** —— 父目录一旦被排除，其中内容无法 re-include（`git check-ignore` 会误报成"命中放行规则"）。可用写法是 `.codebuddy/*` + `!.codebuddy/memory/` + `!.codebuddy/memory/**`。**判生效必须看 `git status`，不能看 check-ignore。**
- ⚠️ **「没接/没做」必须现场核代码，不许引记忆**。取证用 PowerShell `Select-String` 复检；按行号删码后 `node --check`（**对 0 字节文件也通过**，须校验行数/字节）。`??` 新增文件也要看。

## 4. 浮层 / 弹层 / CSS
- **战斗页期间浮层必须挂 body 层**（`.tab-page{display:none}` 时 fixed 逃不出祖先）。`updateBattleArea` 开头用 `BattleSession.is('trial'|'tower')` 早退，**别用 `Battle.state.mode`**。表现层 catch 不能静默。
- 可拖拽窗口（`UI.makeDraggable`）**只用 left/top**：禁「left:0/top:0 + translate3d」混合、禁 `!important transform`；开窗前清内联 left/top/transform。
- CSS：① 半透明色用 `--x-rgb` 空格分隔 + `rgb(var(--x-rgb) / .3)`；② `background` 简写里别用 var() 当背景色，拆 `background-color` + `background-image`；③ 可复用组件样式挂元素自己身上；④ hover transform 建 stacking context，带浮层卡片 hover 要 `z-index:1`；⑤ **禁补丁式修复**（存量 131 处 `!important` 不动，新增别写）；⑥ 🔴 批量加第二上下文**禁止前缀字符串替换**（ee372c9 事故），逐条写完整选择器。

## 5. 云端 / JS 工程约定
- ⭐ **Supabase ref = `asklogeayzlqpeejuvjj`**，见 `docs/js/core/supabase.js:15`，**用时从那儿抄**。
- EF 部署：`$env:SUPABASE_ACCESS_TOKEN='...'; npx supabase functions deploy <name> --project-ref asklogeayzlqpeejuvjj`。
- 🔴 `Supabase.savePet` 是无条件 INSERT；更新一律 `updatePet(cloudId,{...})`。**建档确认成功前不许删素材/扣材料**；删素材宠**先删云端成功才删本地**。
- 🔴 PostgREST 只认【表级】`has_table_privilege`（保护某列要用独立表 > 触发器 > RLS with-check）。
- 🔴 jsonb 参数**永远传对象/数组**，不要 `JSON.stringify`（读回是字符串、静默失效）。
- 🔴 加/改 RPC 参数前先 `drop function if exists f(旧签名)`（否则 300/命中旧版）。
- ⚠️ 「本地先行 + 云同步失败回滚」：失败会二次渲染，失败原因必须可见；回滚要还原**全部**本地改动。
- 结果区节点（整块 `innerHTML=`）**一律现查再写**。
- 🔴 改 JS/CSS 必升 `游戏.html` 对应 `?v=`（逐个 replace_in_file，别写 PS 批量脚本会被拦）。`ui-codex.js` 文案**禁 `—`/`–`**；百科页签恰好 8 个不能加。
- `.gitignore` 的 `js/` 写 `/js/`。同名覆盖是隐形依赖：`ui-pet.js` 之后加载的 `ui-pet-evolve/merge/synth.js` 才是浏览器真跑的。

## 6. 游戏定调
- 没有第一/第二幕，一条连续进度。**任务链一环套一环**；新手引导不许卡手。守关 Boss 是服务端权威稀有事件，**引导/任务不许拿它当条件**。
- 美术：古典水墨山水 + 羊皮纸做旧；墨黑灰白为主，暗紫/锈红/病绿点缀，几乎不用亮金。主城：等距城寨 + 6 建筑热区；战斗页常驻底部窄条。

## 7. 已落地系统
- **进化 5 阶**（Lv10/25/40/60）；涅槃清 `evolveTimes` 保留形态。⭐ `evolve_times = evolveStage − 1`；**上限判定只认 `nextStageOf` 为 null**；终阶只收传说 ×1；extra 与主素材同名按合并总量判定/扣款。
- **技能**：16 主动自动技 = 血统固有技 + 阶段分档（`config.evolution.skillTierScale`）；变异宠剥「·异变」继承；涅槃档位不退。
- **装备**：12 部位；稀有度 = 词缀条数（1白/2蓝/3+金）；**词缀 T 阶 = PoE 模式**（`affixIlvlGates`/`affixTierWeights`）；未鉴定拦截打造；5 种打造通货 + 魂铸独立 tab。锁定石**只保一次打造**，收口 `equipment_craft.js#expireLock`，须早于 `Items.updateCloudItem`。
- **掉落**：单池一场一抽（`Config.drop.pool`）。⭐ **speedScale=18**：改节奏只动这一个数。
- **副本** `trial/`：三路线×20 层，血量跨层累计。**通天塔** `tower/`：30 层×5 怪，Lv60→120 会放技能；塔底材恒 T1。
- **背包**：三连屏（筛选|装备|素材蛋），手持鉴定 + 拖拽分解 + Ctrl 快分解。

## 8. 关键模块
### 挂机回放层 `core/idle-bridge.js`
- **服务器唯一模拟器 + 先记账后放片**：`battle-settle` 预结算当场入账，客户端只回放。**客户端兜底不许保留发奖能力**（静默双倍入口）。
- 🔴 演出血条 showHp ≠ 真账 endHp；showHp 只在空场/非回血等待时对齐真账。
- 🔴 时间戳一律 `performance.now()`；混 `Date.now()` 冷却永不成立 → 剧本停摆。**布尔锁 + 网络请求必须自带超时**。排障 `IdleBridge.getDebugState()` + `__battleLog` + `?debugidle=1`。

### 登录会话（两层互斥）
- 同浏览器多标签：`core/auth-session.js` + `ui-session-guard.js`；BroadcastChannel `fos-auth`；claim 收口 `main.js startGameRuntime()`；被顶掉 `handoff()` 保留挂机会话。
- 跨设备互踢：`core/server-session.js` + `user_sessions` 表（3 RPC）。⭐ login（`p_kick_others=true`）与 resume（false）分开，**绝不复活**。踢人只认服务端明确 revoked/banned。
- 🔴 事件 payload 里「状态」与「原因文案」必须分开。未做：找回密码/改密/验证码/设备管理。

### 战斗页占用权 `core/battle-session.js`
一套 DOM 一个实例：野图(10)/副本(20)/塔(20) 共用。`claim(kind)` 拿不到就别进（不耗门票）；终局 `release(kind)`；被抢占方订阅 `onChange` 收尾。

### 任务系统（领取记录服务端权威）
- ⭐ 领取记录在**独立表 `quest_claims(user_id, claim_key)`**，客户端零写权限，唯一入口 `complete_quest(qid, period_key)`。旧 `quest_progress.claimed` 列方案**已废**（全表 403）。
- 键：一次性 `qid`／日常 `qid@当天`／周常 `qid@本周一`。⚠️ `repeatable` 不参与占位。
- ⚠️ **只有 `ALREADY_CLAIMED` 才拒绝**；网络错误/未登录降级放行 + 留痕。顺序：扣材料（可退）→ 占位（不可退）→ 发奖（失败不回滚）。
- 🔴 **服务端记录必须回灌本地显示**（09-12 事故）：`Supabase.fetchQuestClaims()` + `quest.js applyServerClaims()` 在 `loadCloudProgress` 里补显示（**先 `ensureDailyReset()` 清水位再回灌**；周期归属按任务自己的 `reset` 判）。ALREADY_CLAIMED 分支**不许 unmarkFinished**。
- ⭐ 通用教训：**判定事实搬服务端后，本地那份副本就成了「显示状态」**，必须有回灌通道，否则「看得见点不动」。
- 一级分类 `kind` 唯一权威 = `core/quest-config.js` 的 `KIND_META`。**可重复条目必须归 loop/daily/exchange**。
- ✅ 守值 `vtest_quest_config.js`（11 条断言）改任务表必跑。**兑换三铁律**（`vtest_quest.js` 守）：① 必须硬上限，禁 repeatable；② 受控高价值物每周 1 次且量远低于正常来源；③ 不拿稀缺换稀缺。
- ✅ trial/tower 已接上报（`{mode:'max'}`）。系列任务每章 6 环 + 章宝箱第 7 环，**全量 182 条**。
- 资源缺口（Lv25~55）：涅槃丹/强化丹B/天仙玉露/锁定石/塔重置卡。扩充方案 `docs/Forge_of_Souls_任务扩充_v1.md`（**未落地**）。

### 交易行
- 通货 = 材料以物易物；税每满 8 收 1 卖家承担（改税率**须同步 `migrate_material_trade.sql` 两处常量**）。
- 文件 `core/market.js`/`market_bot.js`（20 persona，昵称不落库）/ `ui-market*.js` ×4。已落地：筛选、参考价+捡漏、分页、**挂单额度 `quotaGuard()` 已下沉四个 listXxx**、税后预览、离线成交汇总、材料可交易。
- ⭐ 上架收款物从 `Config.trade.materials` 派生。绑定层（不可交易，有测试守）：凝魂晶石/试炼门票/塔重置卡/经验包/觉醒石。

### 装备战力真值（难度校准必读）
12 金装真造 200 套中位：暴击 47.8%/暴伤 203%/命中 134/闪避 50/吸血 16.8%/速度 127/穿透 38。**战力大头是机制属性，攻血防约 1%**。🔴 校准一律 `Equipment.generateEquipment` 真造，禁用代理点数。

## 9. 用户待办 / 未决
- ✅ **魔石已开通为「便利货币」**（09-12 拍板）：`Config.shop.enabled=true`；只卖便利不卖数值，现仅 `perk_listing_5`（挂单额度 +5 / 20 魔石 / 限购 2）。
  - ⭐ 为何只有这一样：背包/宠物/离线上限**全不存在**、也没改名功能 → 卖扩容＝先造限制再卖解除，不做。**便利商品应从玩家真实抱怨里长出来**。
  - 收款通道**仍关**（无官方支付 SDK，不做个人码）。魔石来源只有：卡密 `redeem_code`、管理员 `grant_gems`（仅 `776492620@qq.com`）。
  - `user_perks` 表（`listing_slots` CHECK 0~10）+ `get_my_perks` RPC；RLS 只有 SELECT，写入只走 `spend_gems`。客户端 `Market.refreshPerks/getPerks` + `listQuota()`，加载点 `main.js restoreAllCloudData`。
- 🔴 **部署配置未重配**：`netlify.toml`/`wrangler.toml` publish 仍指 `新demo/Mvp/原型代码`，需改指 `docs/`；`docs/_headers`·`_redirects` 已删（`git show 996ccf9^:docs/_redirects` 取回）。
- 未决：① 塔重置卡获取断链 ② `add_material` 无限刷限制 ③ 战斗/掉落客户端权威 → 付费前搬服务端 ④ 删号 cascade 冷静期 ⑤ 聊天显示名=邮箱前缀泄露隐私 ⑥ 背包/宠物无上限、聊天无限频 ⑦ 副本 19 个空隙回血漏洞修不修待点头。
- **通天塔服务端权威 EF = ⏸️ 暂停**。未落地：B-2 发奖事务化、B-3 RLS 收口 pets/equip_items/pet_egg。美术缺口见 `2026-09-03.md`。待清理一次性脚本：`sim_tower_balance.js`、`probe_gear_panel.js`。

## 10. 代码审计沉淀（2026-09-11 / 09-12）
- ⭐ **两个系统性病因**：①「注释说 A、代码做 B」→ **拿注释当意图源反查代码**是最高性价比审计手法；②「同一逻辑复制两三遍、只有一份对」。
- ⭐ **用线上数据反推代码**：不看注释看实际存了什么（`select jsonb_typeof(col), count(*)`）。
- ⭐ RLS 只控行归属不控列/值；资产表无 CHECK/触发器 → 登录玩家 REST `PATCH` 能改自己数据。✅ 已收 `materials`、`profiles`（列级）；❌ 未收 `pets`/`equip_items`/`pet_egg`/`quest_progress`/`*_listings`。⚠️ `pets.level` CHECK 是 1~99 不是 60。
- ⭐ **不可逆操作必须排最后**（nirvana 血泪）：快照（traits **深拷贝**）→ 更新主宠（可逆）→ 成功才删副宠；道具要一起退。
- ⭐ **「先付费后给货」：扣费排在「确认能发货」之后**；扣不动整单放弃 + 退回已扣，**绝不「只 log 继续」**。顺序：**容易退的先扣，难退的后扣**。**钱已收，货就算成交**。
- ⭐ 「记账成功 + 发货失败」必须有玩家可见提示；「宁可少拿不可重发」不变但要如实说。
- ⭐ **`Materials.gain` 只入队（4 秒后才上报）**，发奖/退款后要自己 `flushMaterials()`（塔/副本 `finish` 各加一次）。
- ⭐ 一个字段同时服务「业务计算」和「存储上限」时，截断放后者那一侧（`logDetail.slice(-100)` 曾吞掉落）。
- ⭐ **测试**：输入按被测函数真实收到的结构造；新护栏必做**变异测试**验证会红；断言「被 await 了」要让被等的明显慢于其它；造出的极端状态**必须同节复原**；用绝对值断言「今日次数」。
- ⭐ **墓碑代码审计法**：零出现=可删；排除 IIFE 命名函数/`constructor`/tests 引用/动态拼接类名 4 类误报；🔴 `core/config.js` 数值禁引用计数清理（多处 `Config[k]` 动态读）。
- ⚠️ 子代理扫代码：行号可信、**后果描述必须主代理复核**。node 测试用桩、桩里没有 RLS → 收权限过头抓不到，须真实登录态复验。
- 基线 **67~73**（稳定红 5 + flaky 3：`enemy_balance`/`tier_rarity`/`botbuy`）。判 flaky：单独连跑 3~4 次全过。迁移脚本**不幂等**，危险脚本已加「🔴 禁止重放」头注释。

## 11. ⭐ 真实登录态端到端验证（方法可复用）
- ① anon key 调 `POST /auth/v1/signup` 建一次性账号（**邮箱确认关着**，直接返回 `access_token`）；② 用 token 打 REST/RPC；③ `supabase_execute_sql` 执行 `delete from auth.users where email=...` 清理（FK cascade）。
- 线上探测守卫：`Invoke-WebRequest .../rest/v1/rpc/<fn>` + 不存在 UUID → 传 `notfound` 说明没调 guard。
- 本地起服务别直接跑（会阻塞）：`Start-Process python -ArgumentList '-m','http.server','8030' -WorkingDirectory 'd:\Ai\游戏原型\docs' -WindowStyle Hidden`。改库优先走 **Supabase 集成工具**（`supabase_execute_sql`），不需 PAT。
- 两条「看着像我们代码」其实不是的报错：① `VM<数字>:行` 栈 = 浏览器扩展注入（无痕验证）；② 一堆 `net::ERR_CACHE_READ_FAILURE` = 浏览器磁盘缓存损坏（清缓存/换端口）。

## 技能索引（流程类知识在这里，不重复写进 MEMORY）
| 技能 | 管什么 |
|---|---|
| `forge-of-souls-dev` | 总纲：目录结构、CSS 铁律、云端多步操作、用户偏好 |
| `fos-balance` | 改数值/调平衡：config 定位 + 联动文件 + 守值测试 |
| `fos-verify` | 跑测试、浏览器验证、挂机/战斗排障 |
| `fos-cloud` | Supabase 建表改表、RPC、迁移脚本、EF 部署 |
