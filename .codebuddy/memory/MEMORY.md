# MEMORY — 永夜灵市 / Evernight Bazaar（2026-09-13 精简版）

> 只放**会变的事实 / 状态 / 决策** + **可复用教训**；**流程规范在 skill，别两处维护。**
> ⚠️ 本文件有注入上限，超了会被截断 → **定期精简**，细节滚进当天 `YYYY-MM-DD.md`。
> 入口：`AGENTS.md`（AI 每会话必读）/ `00-项目导航.md`（人入口）/ 审计 `docs/代码审计_2026-09-11.md` / 墓碑 `docs/墓碑代码审计_2026-09-12.md`。

## 1 项目坐标与治理
- 暗黑风「挂机养宠 + 宠物/装备真实交易」网页游戏。**游戏名：永夜灵市 / Evernight Bazaar**（2026-09-13 定名）。
  ⛔ **旧名 `Forge of Souls` / `Soulforge` 已废弃**（是上个项目继承来的，用户明确不喜欢，含 Soul/Forge 的组合一律不许再用）。
- 运行源 `docs/`：`js/`（core/ui/pet/equipment + 每系统一目录如 `trial/`、`tower/`）；页面 `docs/游戏.html`；CSS 序 vars → design-tokens → app → game → ui-polish。`新demo/` 不开发。
- 循环：挂机 → 材料 → 合成/进化/涅槃 → 打造 → P2P 市场。三爽点：**掉宝/鉴定 > 市场捡漏 > 成长跳变**。不学氪金分层/品级/五行。
- **图 1-10 覆盖 Lv1-60**（`Config.level.maxLevel=60`；17 图是历史残留）。⚠️ 根 `js` 是 Junction → `docs/js`，会消失，重建：`New-Item -ItemType Junction -Path 'd:/Ai/游戏原型/js' -Target 'd:/Ai/游戏原型/docs/js'`。
- 📌 **治理四件套**（新流程往这里塞，**不新建第 5 份**）：`PROJECT_CONSTITUTION.md`（权威账本）/ `00-项目导航.md`（拍过的板 + 七步流程）/ `AGENTS.md`（AI 必读）/ `docs/任务单/`（派活边界 + 验收）。**发现几份文档说法冲突，立刻对齐**（09-13 宪法与导航页结论写反过）。
- ⭐ 用户自曝痛点：**决策前后打架（"左脑攻击右脑"）**。根因不是缺文档（250KB 设计文档 + 735KB 记忆都在睡），是**缺"让文档生效"的机制** → 三层通道：宪法给人看 / `AGENTS.md` 给 AI 每会话读 / `vtest_*` 让代码自己拦。

## 2 用户偏好（铁律）

- 🔴 **用户是策划出身，不自认懂代码**（2026-09-13 自述"我就是一个策划，真的关于代码的事情我其实不懂得"）。
  他说的「说人话／没看懂」是**真看不懂**，不是不耐烦 —— 我此前一直拿技术选项问他，属于失职。
  ⛔ **禁止把技术选型抛给他决策**（"加 CHECK 还是收 RPC""要不要 filter-repo"一律不许问）。
  ✅ 正确姿势：**自己先做完技术判断**，只汇报「我打算怎么做 / 不做代价多大 / 会影响什么」，
  让他用**游戏语言**回答（"这个手感要不要""先做哪个"）。
  📌 分工：**他管游戏内容、玩法手感、优先级；我管技术实现、风险评估、取舍理由 + 为此负全责。**
- 🔴 **用户明确不喜欢旧英文名 `Forge of Souls`，其任何变体（Soulforge / Soul / Forge）一律不许再推荐**
  （2026-09-13，他已经不耐烦地说过两次："英文名是上个项目带来的"→ 我仍推了 Soulforge → 被训）。
  ⭐ **教训：他说"X 不要"时，要真的从候选里删干净，别推马甲版。**
  ✅ **2026-09-13 已定名：《永夜灵市》/ Evernight Bazaar**（到第 4 版才对，commit `76359e4`）。
  ⭐ **起名硬要求（用三版否决换来的）**：**必须同时体现「放置 + 宠物 + 交易」三要素**；宠物统一用「灵」字；字数不限。
  ❌ 我的失败路径：v1 只有暗黑+交易（缺放置/宠物）→ v2 推 `Soulforge`（=旧名马甲，被训"说了多少遍"）
  → v3 补了「兽」但没用他指定的「灵」。
  ⭐ 教训：**他给的约束要逐条用上**，尤其"X 不要"必须从候选里删干净，别推马甲版。
  ⚠️ 「放置/挂机/宠物」在中文游戏圈是负面标签（≈劣质页游）→ **用意象藏进去**：
  永夜（=暗黑 + 一直跑=挂机）、灵（=宠物）、市（=交易）。
- ⭐ **用户的项目观（2026-09-13）**：**玩法已定型，不再追求新系统**，目标是"在现有基础上丰富它、让它好玩、让别人喜欢玩"。
  → 提建议一律朝「丰富 / 手感 / 反馈」发力。⛔ **不许提议重构或大规模重写** —— 他自认"中间失控了"，
  但游戏能跑、能给朋友玩 = 这笔债的收益已经兑现；重构会停掉全部进度且收益不高。
  正确做法是「**不再让债扩大**」（今天那套工具链就是为此）+「把力气花在变好玩上」。
- ⭐ **第一原则**：先问「本质要解决什么、有无更根本解法」；不顺惯性打补丁/堆抽象/加兼容层。
- ⭐ **不要过度堵住**：收紧类改动**先列全量消费方**逐条判，选**最小作用域**。判据「失败会丢资产吗？」会→拦，「只是没同步上」→不拦。
- ⭐ **「再建一个」默认答案是不建**（「同一逻辑两份、只有一份对」是本项目头号病因）。
- 一文件一职责；新系统拆独立文件；数值拆该系统 config；旧代码不回头重构。大白话短句，禁术语堆砌/吹捧；复杂修复分批做；数值/规则定死（`areaEnemyStats`），不引动态难度。
- 宠物图标走立绘/头像，**不回退 emoji**（fallback = 头像 → 立绘 → 空）。
- ⭐ **知识必须有载体**：只在对话里答过的结论等于没有（09-13 用户连着两轮问「流程是什么」）。
- ⭐ **禁令类拍板必须全仓扫描确认**：「文档里写了禁令」≠「代码遵守了禁令」—— 宪法明写别译「灵魂熔炉」，`游戏.html` 登录页大标题却一直违规挂着（09-13 已改）。

## 3 Git / 仓库 / 并发
- 每批改动前 commit+push 当安全点；**只 add 自己改的路径**；提交前看 `git status --short` 有无意外 `D`。git 不主动 push。🔴 push 被掐 → `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin main`。
- ⚠️ **多会话并发写同一工作区**：共享文件（`config.js`/`游戏.html`/`battle.js`/`pet*.js`/`ui-common.js`/`game.css`）**改前必须重读**；`?v=` 会互相覆盖；测试在**加载阶段**集体报错先怀疑别人改到一半。
- 🔴 **远端 `Arthurlfz/AFKGame` 是 public 且开着 GitHub Pages** → ⛔ **永远不要转私有**（免费账户私有仓不支持 Pages，一转游戏下线）。实际部署 = **Pages 发布 main 的 `/docs`**；根目录无 `.github/`（零 CI）；仓库约 117MB。`netlify.toml`/`wrangler.toml` 未启用（发布目录已改对为 `docs`；⭐ 留 `wrangler.toml` = 将来私有化唯一免费出路）。
  - ⚠️ 已推上 public 的 735KB memory 含管理员邮箱/project ref，**git 历史里删不掉**（要 `git filter-repo`）。**以后写 memory 避开明文邮箱/密钥。**
  - ⭐ **「让知识入库」和「知识里有没有隐私」是两件事**。顺带教训：**修复方案如果会砸掉线上服务，就不是方案**（我曾建议转私有，差点让 Pages 下线）。
- ✅ 2026-09-13 起 `.codebuddy/memory/` 放行入库（`skills/`/`agents/` 仍忽略）。🔴 **gitignore 父子目录陷阱**：`.codebuddy/**` + `!.codebuddy/memory/` **无效**；可用 `.codebuddy/*` + `!.codebuddy/memory/` + `!.codebuddy/memory/**`。**判生效看 `git status`，不看 check-ignore。**
- 🔴 `git status` 中文路径转义成八进制 → 用 `git status --short -- "docs/游戏.html"`。⚠️ **「没接/没做」必须现场核代码，不许引记忆**（`Select-String` 取证）；按行号删码后 `node --check`（**对 0 字节文件也通过**，须校验行数/字节）。
- ⚠️ PowerShell `Set-Content` 会被拦 → 写文件用工具或 `node fs.writeFileSync(…,'utf8')`。⚠️ Obsidian：`.codebuddy/memory/` **不能**进 `userIgnoreFilters`（否则双链全断），只排除 `docs/assets` 等重目录。

## 4 派活 / 任务单（`docs/任务单/`）
- **派活四问**：① 边界干净吗（列得出"允许碰哪些文件"吗）② 动数据库吗（会 → **全局串行，一次一个**）③ 验收能自动判定吗（不能 = 薛定谔的活）④ 撞不撞共享文件（撞 → 串行）。
- `_模板.md` 的 **「🔴 边界」是一级字段，必填**；干完在「六、结果」写清改了什么 + **什么没做完**。
- ⭐ **并行最大隐性成本不是冲突，是口径漂移**（数字错一眼看出，**结论反了看十遍发现不了**）。值钱的是「总管」= 拆活/划边界/定验收，不是并行本身。

## 5 浮层 / CSS
- **战斗页期间浮层必须挂 body 层**（`.tab-page{display:none}` 时 fixed 逃不出祖先）。`updateBattleArea` 开头用 `BattleSession.is('trial'|'tower')` 早退，**别用 `Battle.state.mode`**。表现层 catch 不能静默。
- 可拖拽窗口（`UI.makeDraggable`）**只用 left/top**：禁「left:0/top:0 + translate3d」混合、禁 `!important transform`。
- CSS 铁律（详见 `forge-of-souls-dev` skill）：半透明用 `rgb(var(--x-rgb) / .3)`；`background` 简写别用 var() 当背景色；组件样式挂元素自己身上；带浮层卡片 hover 要 `z-index:1`；**禁补丁式修复**（存量 131 处 `!important` 不动，新增别写）；🔴 批量加第二上下文**禁止前缀字符串替换**（ee372c9 事故）。

## 6 云端 / JS 工程约定
- ⭐ **Supabase ref = `asklogeayzlqpeejuvjj`**（`docs/js/core/supabase.js:15`，用时从那儿抄）。EF 部署：`$env:SUPABASE_ACCESS_TOKEN='...'; npx supabase functions deploy <name> --project-ref asklogeayzlqpeejuvjj`。
- 🔴 `Supabase.savePet` 是无条件 INSERT；更新一律 `updatePet(cloudId,{...})`。**建档确认成功前不许删素材/扣材料**；删素材宠**先删云端成功才删本地**。
- 🔴 PostgREST 只认【表级】`has_table_privilege`（保护某列用独立表 > 触发器 > RLS with-check）。🔴 jsonb 参数**永远传对象/数组**，不要 `JSON.stringify`。🔴 加/改 RPC 参数前先 `drop function if exists f(旧签名)`。
- ⚠️ 「本地先行 + 云同步失败回滚」：失败原因必须可见；回滚要还原**全部**本地改动；结果区节点（整块 `innerHTML=`）**一律现查再写**。
- 🔴 改 JS/CSS 必升 `游戏.html` 对应 `?v=`（逐个 replace_in_file，别写 PS 批量脚本）。改 `<title>`/文案不需要升 `?v=`（但要强刷）。`ui-codex.js` 文案**禁 `—`/`–`**；百科页签恰好 8 个。
- `.gitignore` 的 `js/` 写 `/js/`。同名覆盖是隐形依赖：`ui-pet.js` 之后加载的 `ui-pet-evolve/merge/synth.js` 才是浏览器真跑的。

## 7 游戏定调
- 没有第一/第二幕，一条连续进度。**任务链一环套一环**；新手引导不许卡手。守关 Boss 是服务端权威稀有事件，**引导/任务不许拿它当条件**。
- 美术：古典水墨山水 + 羊皮纸做旧；墨黑灰白为主，暗紫/锈红/病绿点缀，几乎不用亮金。主城等距城寨 + 6 建筑热区；战斗页常驻底部窄条。

## 8 已落地系统（清单见导航页，这里只存容易记错的判定细节）
- ⭐ `evolve_times = evolveStage − 1`；**进化上限判定只认 `nextStageOf` 为 null**；终阶只收传说 ×1；涅槃清 `evolveTimes` 保留形态。
- ⭐ 技能档位按 `config.evolution.skillTierScale` 分档，变异宠剥「·异变」继承，**涅槃不退档**（被动方案已废）。
- ⭐ 稀有度 = 词缀条数（1白/2蓝/3+金）；锁定石**只保一次打造**，收口 `equipment_craft.js#expireLock`；掉落**单池一场一抽**，⭐ **speedScale=18** 是节奏总闸。

## 9 关键模块
**挂机回放层 `core/idle-bridge.js`**：**服务器唯一模拟器 + 先记账后放片**（`battle-settle` 预结算当场入账，客户端只回放）；**客户端兜底不许保留发奖能力**。🔴 演出血条 showHp ≠ 真账 endHp，只在空场/非回血等待时对齐。🔴 时间戳一律 `performance.now()`（混 `Date.now()` → 冷却永不成立、剧本停摆）；**布尔锁 + 网络请求必须自带超时**。排障 `IdleBridge.getDebugState()` + `__battleLog` + `?debugidle=1`。

**登录会话（两层互斥）**：同浏览器多标签 = `core/auth-session.js` + `ui-session-guard.js`（BroadcastChannel `fos-auth`，claim 收口 `main.js startGameRuntime()`，被顶掉 `handoff()` 保留挂机）；跨设备互踢 = `core/server-session.js` + `user_sessions`（⭐ login 的 `p_kick_others=true` 与 resume 分开，**绝不复活**；踢人只认服务端 revoked/banned）。🔴 事件 payload 里「状态」与「原因文案」必须分开。未做：找回密码/改密/验证码/设备管理。

**战斗页占用权 `core/battle-session.js`**：一套 DOM 一个实例，野图(10)/副本(20)/塔(20) 共用；`claim(kind)` 拿不到就别进（不耗门票），终局 `release(kind)`，被抢占方订阅 `onChange` 收尾。

**任务系统（领取记录服务端权威）**：⭐ 记录在独立表 `quest_claims(user_id, claim_key)`，客户端零写权限，唯一入口 `complete_quest(qid, period_key)`；旧 `quest_progress.claimed` 列方案**已废**（全表 403）。键：一次性 `qid`／日常 `qid@当天`／周常 `qid@本周一`；⚠️ `repeatable` 不参与占位。⚠️ **只有 `ALREADY_CLAIMED` 才拒绝**，网络错误/未登录降级放行 + 留痕；顺序：扣材料（可退）→ 占位（不可退）→ 发奖（失败不回滚）。🔴 **服务端记录必须回灌本地显示**（09-12 事故）：`fetchQuestClaims()` + `applyServerClaims()` 在 `loadCloudProgress` 里补显示（**先 `ensureDailyReset()` 清水位**）；ALREADY_CLAIMED **不许 unmarkFinished**。⭐ 通用教训：**判定事实搬服务端后，本地那份副本就成了「显示状态」**，没有回灌通道就会「看得见点不动」。
- 一级分类 `kind` 唯一权威 = `core/quest-config.js` 的 `KIND_META`；**可重复条目必须归 loop/daily/exchange**。✅ 守值 `vtest_quest_config.js`（11 断言）；**兑换三铁律**：硬上限禁 repeatable / 受控高价物每周 1 次且远低于正常来源 / 不拿稀缺换稀缺。全量 182 条（每章 6 环 + 章宝箱第 7 环）。资源缺口（Lv25~55）：涅槃丹/强化丹B/天仙玉露/锁定石/塔重置卡；扩充方案 `docs/Forge_of_Souls_任务扩充_v1.md`（**未落地**）。

**交易行**：通货 = 材料以物易物；税每满 8 收 1 卖家承担（改税率须同步 `migrate_material_trade.sql` 两处常量）。`core/market.js` / `market_bot.js`（20 persona，昵称不落库）/ `ui-market*.js` ×4。挂单额度 `quotaGuard()` 已下沉四个 `listXxx`。⭐ 上架收款物从 `Config.trade.materials` 派生；绑定层（不可交易，有测试守）：凝魂晶石/试炼门票/塔重置卡/经验包/觉醒石。

**装备战力真值（难度校准必读）**：12 金装真造 200 套中位——暴击 47.8%/暴伤 203%/命中 134/闪避 50/吸血 16.8%/速度 127/穿透 38；**战力大头是机制属性，攻血防约 1%**。🔴 校准一律 `Equipment.generateEquipment` 真造，禁用代理点数。

## 10 用户待办 / 未决
- ✅ **魔石 = 便利货币**（09-12 拍板）：`Config.shop.enabled=true`；只卖便利不卖数值，现仅 `perk_listing_5`（挂单额度 +5 / 20 魔石 / 限购 2）。⭐ 为何只有这一样：背包/宠物/离线上限**全不存在**、也没改名功能 → 卖扩容＝先造限制再卖解除；**便利商品应从玩家真实抱怨里长出来**。收款通道**仍关**（无官方支付 SDK，不做个人码）；魔石来源：卡密 `redeem_code`、管理员 `grant_gems`（仅 `776492620@qq.com`）。`user_perks` 表 + `get_my_perks` RPC；RLS 只有 SELECT，写入只走 `spend_gems`。
- 🔴 未决：① 塔重置卡获取断链 ② `add_material` 无限刷限制 ③ 战斗/掉落以外（打造/进化/定价/副本/塔）仍是客户端权威 → **收真钱前必须搬完** ④ 删号 cascade 冷静期 ⑤ 聊天显示名=邮箱前缀泄露隐私 ⑥ 背包/宠物无上限、聊天无限频 ⑦ 副本 19 个空隙回血漏洞修不修待点头。
- **通天塔服务端权威 EF = ⏸️ 暂停**。未落地：B-2 发奖事务化、B-3 RLS 收口 `pets`/`equip_items`/`pet_egg`。待清理一次性脚本：`sim_tower_balance.js`、`probe_gear_panel.js`。

## 11 代码审计沉淀
- ⭐ **两个系统性病因**：①「注释说 A、代码做 B」→ **拿注释/文档当意图源反查代码**是最高性价比审计手法；②「同一逻辑复制两三遍、只有一份对」。
- ⭐ **拿「文档里的陈述」当断言去代码里证伪**（宪法两条结论写反就是这么抓到的）；**用线上数据反推代码**：不看注释看实际存了什么。
- ⭐ RLS 只控行归属不控列/值；资产表无 CHECK/触发器 → 登录玩家 REST `PATCH` 能改自己数据。✅ 已收 `materials`、`profiles`；❌ 未收 `pets`/`equip_items`/`pet_egg`。
- 🔴 **别再提议给这三张表加 CHECK 收口** —— 施工图见 `docs/资产表收口调研_2026-09-13.md`，要点：
  ① **它们的 RLS 是开着的**（Dashboard 配的，仓库 grep 不到）→ 用 `pg_class.relrowsecurity` 核实，别靠搜仓库；
  ② 全部写操作由客户端直连 REST、**零 RPC 覆盖** → 现在 revoke 会当场挂掉打造/进化/涅槃/穿脱装备/掉蛋；
  ③ 需先建 8 个服务端函数（`create_pet`/`update_pet`/`create_item`/`update_item`/…）才能收；
  ④ ⭐ **加 CHECK 只能拦 `level=99999`，拦不住 `level=60`（合法值）= 假的安全感**，用户已据此拍板不做过渡；
  ⑤ 单点风险 `pets.equipment` jsonb 无归属校验 → 可塞他人装备 id（侵害他人资产）；
  ⑥ 加约束一律 `not valid`（历史脏数据会让整条 DDL 失败）。
  ⚠️ `pets.level` **至今零约束**（Config maxLevel=60 没落到库），现有 CHECK 实际只有 `growth 1~100`。
- ⭐ **不可逆操作必须排最后**（nirvana 血泪）：快照（traits **深拷贝**）→ 更新主宠（可逆）→ 成功才删副宠；道具要一起退。
- ⭐ **「先付费后给货」**：扣费排在「确认能发货」之后；顺序**容易退的先扣、难退的后扣**；扣不动整单放弃 + 退回已扣，**绝不「只 log 继续」**；**钱已收，货就算成交**；「记账成功 + 发货失败」必须有玩家可见提示（「宁可少拿不可重发」不变但要如实说）。
- ⭐ **`Materials.gain` 只入队（4 秒后才上报）**，发奖/退款后要自己 `flushMaterials()`。一个字段同时服务「业务计算」和「存储上限」时，截断放后者那侧（`logDetail.slice(-100)` 曾吞掉落）。
- ⭐ **测试四戒**：输入按被测函数真实收到的结构造；新护栏必做**变异测试**验证会红；造出的极端状态**必须同节复原**；用绝对值断言「今日次数」。
- ⭐ **墓碑代码审计法**：零出现=可删；排除 IIFE 命名函数/`constructor`/tests 引用/动态拼接类名 4 类误报；🔴 `core/config.js` 数值禁引用计数清理（多处 `Config[k]` 动态读）。
- ⚠️ 子代理扫代码：行号可信、**后果描述必须主代理复核**；node 测试用桩、桩里没有 RLS → 权限问题抓不到，须真实登录态复验。

## 12 测试 / 回归（工具链 09-13 建成）
- `cd docs && npm run check`（75 个 vtest + **自动对比 `tests/baseline.json`**，直接说「有没有新搞红的」）；`npm test`（只跑）/ `npm run test:v`（详情）/ `npm run baseline`（**仅确认健康时**存新基线）/ `npm run serve`。
- ✅ **基线 70 通过 / 5 失败（约 2.6 分钟）**。存量红 5（不是你的锅）：`action_freeze` / `boss`(D4) / `bugfix`(emoji 断言过期) / `equip_score` / `pet_skill`；flaky 2：`enemy_balance` / `botbuy`（报红先单独连跑 3~4 次全绿才算真回归）。
- `run_all.js` 只跑 `vtest_*`（75），另有 9 个非 vtest 脚本（`sim_*`/`probe_*`）不在回归内。全量最慢 `vtest_fun.js` 61s。
- ⭐ 给工具加「初始化/引导」模式时，**先问「它第一次跑时依赖的东西存在吗」**（`diff_baseline --save` 曾因读文件排在 SAVE 分支前而 ENOENT 死锁）。
- 🔜 **待做（未拍板）**：把最容易反复横跳的拍板固化成守值 vtest，让「推翻」代码会拦 —— 高发区：技能方案（被动→主动已翻过一次）、商店不卖数值、不做可交易经验包、等级上限 60。样例已有 `vtest_shop.js` 静态扫描「禁止卖数值」。

## 13 ⭐ 真实登录态端到端验证（方法可复用）
- ① anon key 调 `POST /auth/v1/signup` 建一次性账号（**邮箱确认关着**，直接返回 `access_token`）；② 用 token 打 REST/RPC；③ `supabase_execute_sql` 执行 `delete from auth.users where email=...` 清理（FK cascade）。
- 本地起服务别直接跑（会阻塞）：`Start-Process python -ArgumentList '-m','http.server','8030' -WorkingDirectory 'd:\Ai\游戏原型\docs' -WindowStyle Hidden`。改库优先走 **Supabase 集成工具**（`supabase_execute_sql`），不需 PAT。
- 两条「看着像我们代码」其实不是的报错：① `VM<数字>:行` 栈 = 浏览器扩展注入；② 一堆 `net::ERR_CACHE_READ_FAILURE` = 浏览器磁盘缓存损坏（清缓存/换端口）。

## 技能索引（流程类知识在这里，别抄进 MEMORY）
`forge-of-souls-dev` 总纲（目录/CSS/云端多步/偏好）｜`fos-balance` 改数值｜`fos-verify` 测试与排障｜`fos-cloud` Supabase 表/RPC/迁移/EF
