# MEMORY — 永夜灵市 / Evernight Bazaar

> **只放「不记住会出事」的红线与易错事实。** 流程规范在 `AGENTS.md` + 4 个 skill，别两处维护。
> 🔴 **体积预算 ≈ 11KB**：实测 >13KB 注入就被截断（§ 后半全丢）。收尾顺手精简，细节滚进当天 `YYYY-MM-DD.md`。
> 入口：`AGENTS.md`（AI 必读）/ `00-项目导航.md`（人）/ `PROJECT_CONSTITUTION.md`（拍板账本）/ `docs/代码审计_2026-09-11.md`。

## 1 坐标
- 暗黑风「挂机养宠 + 宠物/装备真实交易」网页游戏，名 **永夜灵市 / Evernight Bazaar**；⛔ 旧名 `Soulforge`/`Forge of Souls` 已废弃（含 Soul/Forge 组合禁用）。
- 循环：挂机→材料→合成/进化/涅槃→打造→P2P 市场。三爽点 **掉宝/鉴定 > 市场捡漏 > 成长跳变**。不学氪金分层/品级/五行。
- 运行源 `docs/`（`js/` + `游戏.html`；CSS 序 vars→design-tokens→app→game→ui-polish）。`新demo/` 不开发。图 1-10 覆盖 Lv1-60（maxLevel=60）。
- ⚠️ 根 `js` 是 Junction → `docs/js`，丢了重建：`New-Item -ItemType Junction -Path 'd:/Ai/游戏原型/js' -Target 'd:/Ai/游戏原型/docs/js'`。
- 治理四件套（**不新建第 5 份**）：宪法/导航/AGENTS/任务单；冲突立刻对齐。⭐ 病因=决策前后打架，解药=宪法给人 + AGENTS 给 AI + `vtest_*` 让代码自己拦。

## 2 用户铁律
- 🔴 用户是策划出身、不自认懂代码：⛔ **禁止把技术选型抛给他**；✅ 自己做完判断，只汇报「怎么做/代价/影响」；**他管内容手感优先级，我管实现风险取舍并负全责**。
- ⭐ 项目观：玩法已定型，目标是**丰富它、变好玩**；⛔ 不许提议重构/大重写。做法 = 不让债扩大 + 力气花在好玩上。
- ⭐ 第一原则：先问本质要解决什么、有无更根本解法；**不打补丁、不堆抽象、不加兼容层**。
- ⭐ 不要过度堵住：收紧类改动先列全量消费方，选**最小作用域**；判据「失败会丢资产吗？」。
- ⭐ **「再建一个」默认答案是不建**（同一逻辑两份、只有一份对 = 头号病因）。一文件一职责；旧代码不回头重构；复杂修复分批；数值定死不引动态难度。
- 宠物图标走立绘/头像，不回退 emoji。⭐ 知识必须有载体（只在对话里答过 = 没有）。禁令类拍板必须全仓扫描确认。

## 3 Git / 并发
- 改前 commit+push 当安全点；**只 add 自己改的路径**（`git add -A` 出过事故）；提交前看 `git status --short` 有无意外 `D`。不主动 push。push 被掐 → `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin main`。
- ⚠️ 多会话并发写同一工作区：共享文件（config.js / 游戏.html / battle.js / pet*.js / ui-*.js / game.css）**改前必重读**；`?v=` 会互相覆盖；测试在加载阶段集体报错先怀疑别人改到一半；别把别人的改动算成自己的。
- 🔴 远端 `Arthurlfz/AFKGame` 是 public + GitHub Pages → ⛔ **永不转私有**。部署 = Pages 发布 main 的 `/docs`。**写 memory 避开明文邮箱/密钥**。
- 🔴 gitignore 陷阱：用 `.codebuddy/*` + `!.codebuddy/memory/` + `!.codebuddy/memory/**`（`.codebuddy/**` 写法无效）；判生效看 `git status`，不看 check-ignore。
- ⚠️ `git status` 中文路径转成八进制 → `git status --short -- "docs/游戏.html"`。⚠️「没接/没做」必须现场核代码取证。⚠️ PowerShell `Set-Content` 会被拦 → 用编辑工具或 node 写。

## 4 云端约定
- Supabase ref `asklogeayzlqpeejuvjj`（`core/supabase.js`）。EF 部署：`npx -y supabase functions deploy <name>`。🔴 **EF 不会自动部署** → 改了 `supabase/functions/**` 收尾必须提醒用户部署，否则等于没上线。
- 🔴 `savePet` 是无条件 INSERT；**更新一律 `updatePet(cloudId,{...})`**。**建档确认成功前不许删素材/扣材料**；删素材宠先删云端成功才删本地。
- 🔴 PostgREST 只认表级权限。jsonb 参数传对象/数组，别 `JSON.stringify`。改 RPC 参数前先 `drop function if exists` 旧签名。
- ⚠️ 「本地先行 + 云失败回滚」：失败原因必须可见；回滚还原**全部**本地改动；结果区节点（整块 `innerHTML=`）一律现查再写。
- 🔴 改 JS/CSS 必升 `游戏.html` 对应 `?v=`（逐个改，别写批量脚本）。`.gitignore` 的 `js/` 要写 `/js/`。同名覆盖是隐形依赖（`ui-pet-evolve/merge/synth.js` 在 `ui-pet.js` 之后加载的才是真跑的）。

## 5 游戏定调与消息中心
- 无第一/第二幕，一条连续进度；任务链一环套一环，新手引导不许卡手。守关 Boss 是服务端权威稀有事件，引导/任务不许拿它当条件。
- 美术：古典水墨山水 + 羊皮纸做旧；墨黑灰白为主，暗紫/锈红/病绿点缀，几乎不用亮金。
- 消息中心 `ui/ui-console.js`：3 频道 **世界(social)/系统(system)/掉落(loot)**；5 个内嵌 console（世界地图/主城/战斗/宠物页）+ 底部抽屉**共享同一份 history**（上限 100 条）与同一个 `activeTab`（默认世界）。⚠️ `addLog`/`showToast` 把分类**写死 system** → **频道归属由调用方负责**。

## 6 易错数值/规则
- `evolve_times = evolveStage − 1`；进化上限只认 `nextStageOf` 为 null；进化**不改等级**；终阶只收传说×1；涅槃清 `evolveTimes`/`cultivateUsed`、等级回 1、保留形态。
- 技能 = **16 个主动自动技**（期望提升压在 +13~18%）；变异宠剥「·异变」继承本体技能，涅槃不退档。
- 稀有度 = 词缀条数（1白/2蓝/3+金）；锁定石**只保一次打造**；掉落**单池一场一抽**；⭐ **speedScale=18 是节奏总闸**（一次出手 ≈ 10×18/速度 秒）。
- 装备战力真值：12 金装真造 200 套中位 = 暴击 47.8%/暴伤 203%/命中 134/闪避 50/吸血 16.8%/速度 127/穿透 38；**战力大头是机制属性**（攻血防约 1%）。校准一律 `Equipment.generateEquipment` 真造，禁用代理点数。

## 7 关键模块不变量
**挂机层 `core/idle-bridge.js`**：架构 = **服务器唯一模拟器 + 先记账后放片**（`battle-settle` 预结算当场入账，客户端只回放）；客户端不许保留发奖能力。
- 🔴 托管期间本地 `pet.level/exp` 是**演出预演值** → 一律不许写 level/exp；改宠物的操作（进化/合成/涅槃/改数值）走 `IdleBridge.duringPetEdit(fn)`。启动挂机唯一入口 `Game.startIdleAt`。
- 🔴 只有玩家主动操作才该停挂机；会话丢了走 `recoverSession()` 自愈；停机必须带原因（禁无参 `stopLocal()`）。演出血条 ≠ 真账 endHp；时间戳一律 `performance.now()`；布尔锁+网络请求必须自带超时。⭐「谁占的画面只准谁交还」（`BattleSession.release(kind)` 无身份校验 = 雷，各持 `pageClaimed`）。
- 节奏：30 秒窗 ≈ 3 场；单次补账上限 200 场 ≈ 43 分钟；EF 补账上限 8h，游标按"真正算掉的时间"推进。排障 `IdleBridge.getDebugState()` + `__battleLog` + `?debugidle=1`。

**登录会话（两层互斥）**：同浏览器多标签 = `core/auth-session.js` + `ui-session-guard.js`；跨设备互踢 = `core/server-session.js` + `user_sessions`（login 的 `p_kick_others=true` 与 resume 分开、**绝不复活**；踢人只认服务端 revoked/banned；**网络失败一律不踢**）。payload 里「状态」与「原因文案」必须分开。未做：找回密码/改密/验证码/设备管理。

**战斗页占用权 `core/battle-session.js`**：一套 DOM 一个实例，野图/副本/塔共用；`claim(kind)` 拿不到就别进（不耗门票），终局 `release(kind)`。

**任务系统**：领取记录在独立表 `quest_claims(user_id, claim_key)`，唯一入口 `complete_quest(qid, period_key)`；键 = 一次性 `qid` / 日常 `qid@当天` / 周常 `qid@本周一`；⚠️ **只有 `ALREADY_CLAIMED` 才拒绝**；顺序 = 扣材料→占位→发奖。🔴 **服务端记录必须回灌本地显示**，否则「看得见点不动」。`kind` 权威 = `core/quest-config.js#KIND_META`（182 条）。

**交易行**：通货 = 材料以物易物；税每满 8 收 1 卖家承担（改税率须同步 `migrate_material_trade.sql` 两处）。`core/market.js` + `market_bot.js`（20 persona，昵称不落库）+ `ui-market*.js`×4。上架收款物从 `Config.trade.materials` 派生；绑定层有测试守。

## 8 未决 / 待办
- ✅ 魔石 = 便利货币（`Config.shop.enabled=true`，只卖便利不卖数值）。收款通道仍关。来源：卡密 `redeem_code`、管理员 `grant_gems`。
- 🔴 未决：① 塔重置卡获取断链 ② `add_material` 无限刷限制 ③ 打造/进化/定价/副本/塔仍是客户端权威 → **收真钱前必须搬完** ④ 删号冷静期 ⑤ 聊天显示名=邮箱前缀泄露隐私 ⑥ 背包/宠物无上限、聊天无限频 ⑦ 副本 19 空隙回血漏洞。
- 通天塔服务端权威 ⏸️ 暂停（未落地：塔整局模拟 / `tower-run` EF / `migrate_tower.sql` / 客户端切权威源）。

## 9 审计沉淀（可复用）
- ⭐ 两个系统性病因：①「注释说 A、代码做 B」→ **拿注释/文档当意图源反查代码**是最高性价比审计手法；②「同一逻辑复制两三遍、只有一份对」。
- ⭐ RLS 只控行归属、不控列/值。已收 `materials`/`profiles`；未收 `pets`/`equip_items`/`pet_egg`（施工图 `docs/资产表收口调研_2026-09-13.md`，**别重摸**）→ 现在 revoke 会当场挂掉打造/进化/涅槃/穿戴/掉蛋；加 CHECK 拦不住 `level=60` = 假的安全感。
- ⭐ **不可逆操作必须排最后**（nirvana 血泪）：快照（traits **深拷贝**）→ 更新主宠（可逆）→ 成功才删副宠。
- ⭐ **先付费后给货**：扣费排在「确认能发货」之后；容易退的先扣；扣不动整单放弃 + 退回已扣，**绝不「只 log 继续」**；记账成功但发货失败必须有玩家可见提示。
- ⭐ `Materials.gain` 只入队（4 秒后才上报），发奖/退款后要自己 `flushMaterials()`。
- ⭐ 测试四戒：输入按被测函数真实收到的结构造；新护栏必做**变异测试**验证会红；极端状态同节复原；用绝对值断言。

## 10 测试 / 真实登录验证
- 🔴 命令与基线**以 `AGENTS.md` 为准**（唯一一份）。`cd docs && npm run check`；全量约 2.6 分钟；`run_all.js` 只跑 `vtest_*`。
- 真实登录态验证：anon key 打 `/auth/v1/signup` 建一次性账号（邮箱确认关着）→ token 打 REST/RPC → `supabase_execute_sql` 删 `auth.users` 清理。本地起服务用 `Start-Process python -m http.server`（别前台跑，会阻塞）。工具改库若报 Unauthorized，退路 = 管理 API `POST /v1/projects/{ref}/database/query`（`sbp_` 令牌**绝不入库**）。
- 两条「看着像我们代码」的报错：`VM<数字>:行` = 浏览器扩展注入；`ERR_CACHE_READ_FAILURE` = 缓存损坏（清缓存/换端口）。

## 技能索引（流程类知识在这里，别抄进 MEMORY）
`forge-of-souls-dev` 总纲（目录/CSS/云端多步/偏好）｜`fos-balance` 改数值｜`fos-verify` 测试与排障｜`fos-cloud` Supabase 表/RPC/迁移/EF
