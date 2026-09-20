# MEMORY — 永夜灵市 / Evernight Bazaar

> 🔴 **本文件每轮会话都会被自动注入，所以只放「不读就会犯错」的红线。**
> ⭐ **结构（2026-09-14 立）**：细节按主题拆到 `topics/`，**动某个模块之前先读对应文件**（见文末索引表）。
> 流程规范在 `AGENTS.md` + 4 个 skill，别两处维护。
> 入口：`AGENTS.md`（AI）/ `00-项目导航.md`（人）/ `PROJECT_CONSTITUTION.md`（拍板账本）/ `docs/代码审计_2026-09-11.md`。
> ⭐ **写记忆前先问两句**：「不记住会出事吗？」「是每轮都必须知道吗？」
> 都答"是" → 写这里；否则 → 写当天 `YYYY-MM-DD.md` 或 `topics/`。**别往这里堆。**
> ⚠️ **蒸馏旧日志时也别写这里**：`YYYY-MM-DD.md`（30 天以上）要蒸馏进 **`topics/<主题>.md`**，
> 本文件**永远只留红线**。否则它会长回去，又开始每轮撞上限、每轮现压。**这就是 2026-09-14 重构掉的那个坑。**

---

## 1 坐标
- 暗黑风「挂机养宠 + 宠物/装备真实交易」网页游戏 = **永夜灵市 / Evernight Bazaar**；⛔ 旧名 `Soulforge`/`Forge of Souls` 废弃（含 Soul/Forge 组合禁用）。
- 循环 挂机→材料→合成/进化/涅槃→打造→P2P 市场；三爽点 **掉宝/鉴定 > 市场捡漏 > 成长跳变**；不学氪金分层/品级/五行。
- 运行源 `docs/`（`js/` + `游戏.html`，CSS 加载顺序见 `forge-of-souls-dev` skill）；`新demo/` 不开发；图 1-10 = Lv1-60。
- ⚠️ 根 `js` 是 Junction → `docs/js`，丢了重建：`New-Item -ItemType Junction -Path 'd:/Ai/游戏原型/js' -Target 'd:/Ai/游戏原型/docs/js'`。
- 治理四件套（**不新建第 5 份**）：宪法 / 导航 / AGENTS / 任务单；解药 = 宪法给人 + AGENTS 给 AI + `vtest_*` 让代码拦。

## 2 用户铁律
- 🔴 用户是策划出身、不自认懂代码：⛔ 禁止把技术选型抛给他；✅ 自己判断完只汇报「怎么做 / 代价 / 影响」。**他管内容手感，我管实现风险并负全责**。
- 🔴 **用户自称 vibe-coder，明确说过「我看不懂」「你觉得我看得懂吗」**（2026-09-14）→ ⛔ **禁自造比喻、禁术语堆叠**。
  案例：主 agent 把「装备% 只作用于底座」这条规则私自命名为「**刹车**」，用户直接看不懂并问「我的主要目的是什么」。
  ✅ **正确说法用游戏里的话**：「**装备上写着攻击 +8%，实际只加 13 点**」。**汇报要短**——他懵的时候长篇是负担。
- 🔴 **他要的是「就这么办」的方案，不是选项菜单。** 用户 2026-09-14 原话点破：「**你们到最后面其实都不能给我一个很满意得答复**」——
  因为主 agent 连续几轮都用「A 还是 B？你定」收尾 = **把设计责任推回给他**。⭐ 规矩：**每次汇报必须带【我推荐的完整方案】+ 理由 + 代价**；
  他当然可否决，但**不该要求他先设计**。（只在他真的给不出手感的少数点上，才把问题缩成一个明确二选一。）
- ⭐ 玩法已定型 → 目标是**丰富它、变好玩**，⛔ 不许提议重构 / 大重写；第一原则：先问本质要解决什么、有无更根本解法，不打补丁 / 不堆抽象 / 不加兼容层。收紧类改动先列全量消费方、选最小作用域（判据「失败会丢资产吗？」）。
- ⭐ **「再建一个」默认不建**（同一逻辑两份 = 头号病因）；一文件一职责；旧代码不回头重构；复杂修复分批；数值定死不引动态难度。
- 🔴 **2026-09-21 用户再次点名：「你写的代码很多都是一个文件管理很多事情是吧」** —— 这条铁律 2026-09-10 就立了，**是 AI 没执行**：
  它持续把**新功能追加**进最大的既有文件（`ui-battle.js` 1115 行 / `idle-bridge.js` 1434 行 / `game.css` 4735 行），
  却给别的模块建过单职责文件（`battle-session.js`、`trial/`、`tower/`）⇒ **不一致 = 图省事**。
  ⭐ 规矩：**新功能一律新建文件**（如"命中特效"该在 `docs/js/fx/hit-fx.js`，不是塞进 `ui-battle.js`）；
  原文件只准改"它自己那件事"。旧代码不回头重构，抽离**分批**做、每批带 `npm run check`。
  ⚠️ 抽离的固定代价（每次都要付）：`游戏.html` 加载顺序 + `?v=`、测试 harness 的加载清单、**按文件路径断言的守值**（如 `vtest_pet_anim.js` 第 10 节）。
- 🔴 **图标一律用 `docs/assets/ui/ic_*.png`（水墨 PNG）或立绘，禁 emoji** ——「用 emoji 当图标」2026-09-20 被用户点名「太廉价」（商店 9 件商品）；写图标字段前先 `ls docs/assets/ui`。⭐ 知识必须有载体（只在对话里答过 = 没有）；禁令类拍板必须全仓扫描确认。
- 🔴 **改 UI 显示前先 grep 出「用户实际看到的那段 HTML 是谁生成的」** —— 同一信息常有两套渲染路径（如聊天：`renderChatMessage` 拼的 html vs `chatMsgHtml` 用结构化字段重拼），**改错那条不会报错、只会"怎么改都没效果"**（2026-09-20 名牌连改三轮的真因：消息列表走的是后者，且 structured 里没存 uid）。
- 🔴 **用户会盯"你有没有走 skill"**：动 config / 数值 → 先 `fos-balance`；改 UI → 还要走 `ardot-design-generator` 的设计规范（见 `AGENTS.md` §八）；交付前 → `fos-verify` §7 自查。别凭记忆干活。
- 🔴🔴 **看不到就直说"看不到"**：模型可能读不了图（用户截图）。⛔ 别据他一句话就宣称"我从你图里看到…"——2026-09-21 我就这么干过，把"每格是完整的狐"当成事实，方向错了整整两轮。✅ 正确姿势：先**真的用 `read_file` 读那张图**（⚠️ 2026-09-21 晚实测：本会话模型**能读图**，我当时却一直声称"看不到"并让用户描述，被用户点醒）→ 真读不了才让他一句话描述 → 或**自己用数据取证**（解码像素、量包围盒）。**能算的就别问、能看的就别编。**
- 🔴 **用户不要子 agent**（2026-09-21 原话：「**别用子agent了你自己跑**」）⇒ 实现/写测试/排障这类活**主 agent 自己动手**，
  别再派 subagent（他会觉得在等、也看不到中间过程）。

## 3 Git / 并发
- 改前 commit + push 当安全点；**只 add 自己改的路径**（`git add -A` 出过事故）；提交前看 `git status --short` 有无意外 `D`；不主动 push。push 被掐 → `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin main`。
- ⚠️ 多会话并发：共享文件（`config.js` / `游戏.html` / `battle.js` / `pet*.js` / `ui-*.js` / `game.css`）**改前必重读**；`?v=` 会互相覆盖；测试集体加载报错先怀疑别人改到一半；别把别人的改动算成自己的。
- 🔴 远端 `Arthurlfz/AFKGame` public + GitHub Pages → ⛔ **永不转私有**；部署 = Pages 发 main 的 `/docs`；**memory 避开明文邮箱 / 密钥**。
- 🔴 gitignore 陷阱：`.codebuddy/*` + `!.codebuddy/memory/` + `!.codebuddy/memory/**`（`.codebuddy/**` 无效）；看 `git status` 判生效。⚠️ 中文路径变八进制 → `git status --short -- "docs/游戏.html"`。⚠️ PowerShell `Set-Content` 会被拦 → 用编辑工具 / node 写。🔴 **新建任何文件（尤其工具/脚本）后先 `git check-ignore -v <path>`** —— 2026-09-21 往被忽略的 `tools/` 里放了 `serve.js`，而 `启动游戏.bat` 正指向它 ⇒ 本地能跑、别人 clone 就是启动失败（同"线上 404"那类病：**本地全绿 ≠ 别人那边有**）。已把规则收窄为 `tools/test-out/`。
- 🔴 **核实"线上是不是我刚推的"：只信线上文件内容，不信时间戳**（`Last-Modified`/`pushed_at` 都返陈旧值）：先 `git ls-remote --heads origin main`，再抓线上文件搜特征串。⚠️ 抓含 `%` 的 URL 会被 shell 吞字符（挑不含 `%` 的路径）；本机 Node fetch TLS 不过，用 `Invoke-WebRequest`。
- 🔴🔴 **别让用户"换个端口 / 清缓存"试**（2026-09-21 亲手制造事故）：本项目 143 个 js/css + 几百张图，而原 `启动游戏.bat` 用的是**单线程** `python -m http.server`。换端口 = 缓存清零 + 全量重拉 = **服务器被击穿**（实测 27~46 个资源 `ECONNREFUSED`，其中就有 `battle.js`/`idle-bridge.js`/`ui-battle.js`）→ 一次造出"挂机不跑 + 立绘不显示"等**一批看起来互不相关**的 bug。已修：新增 `tools/serve.js`（Node 并发 + no-store）并让 `启动游戏.bat` 改用它（8030）。要文件失效**只升单个 `?v=`**，别动整个 origin。⭐ 症状学：**多个不相关功能同时坏 → 先怀疑"代码没加载全"**。

## 4 云端红线
- Supabase ref `asklogeayzlqpeejuvjj`（`core/supabase.js`）；EF 部署 `npx -y supabase functions deploy <name>`；🔴 **EF 不会自动部署** → 改了 `supabase/functions/**` 收尾必须提醒用户。
- ⭐ **AI 可以直接执行数据库 DDL**（2026-09-16 验证）：调 `invoke_integration(id:"supabase", type:"database")` 连上后，
  用 `supabase_execute_sql` 就能跑建表/加列/加约束（多语句用分号隔开也能一次执行）。
  ⇒ **别再让用户手动去 Dashboard 跑迁移了**（旧记录"AI 执行不了"已过时）。
- ⭐ **EF 部署也不需要交互式 `supabase login`**（2026-09-16 起，已实测）：PAT 落在项目根 `.env` 的 `SUPABASE_ACCESS_TOKEN`
  （⚠️ `.gitignore:41` 已忽略、`git ls-files .env` 为空 → 安全；⛔ 别把 token 写到别处，也别回显）：
  `$env:SUPABASE_ACCESS_TOKEN = (Select-String -Path .env -Pattern '^SUPABASE_ACCESS_TOKEN=').Line -replace '^SUPABASE_ACCESS_TOKEN=',''`
  → `npx -y supabase functions deploy <name> --project-ref asklogeayzlqpeejuvjj`。
  ⚠️ ref 是 **20 位**（`asklogeayzlqpeejuvjj`），从 `docs/js/core/supabase.js:15` 抄，别凭记忆（曾少写 `pee` 报 Invalid project ref）。
  ⚠️ **用户给过一次凭据就该落盘到约定位置** —— 09-11 那次"会话内联不落盘"，换会话就丢，用户白给一次。
- 🔴 `savePet` 是无条件 INSERT，更新一律 `updatePet(cloudId,{...})`；**建档确认成功前不许删素材 / 扣材料**；删素材宠先删云端成功再删本地。
- 🔴 PostgREST **只认表级权限**；jsonb 参数传对象 / 数组别 `JSON.stringify`；改 RPC 参数先 `drop function if exists` 旧签名。
- ⚠️「本地先行 + 云失败回滚」：失败原因必须可见、回滚还原**全部**本地改动；整块 `innerHTML=` 的结果区一律现查再写。
- 🔴 改 JS / CSS 必升 `游戏.html` 对应 `?v=`（逐个改，别批量脚本）；`.gitignore` 的 `js/` 要写 `/js/`；同名覆盖是隐形依赖（`ui-pet-evolve/merge/synth.js` 在 `ui-pet.js` 之后加载的才生效）。
- 🔴🔴 **`PetSprites` 只有【`游戏.html` 里那份内联】在跑**：`js/core/pet-sprites.js` **没被 `<script src>` 加载**（当年为绕开加载/缓存问题整份内联进去了）⇒ 改 js 那份**必须同步内联副本**，否则「改了等于没改，而且 `npm run check` 还全绿」（测试读的是 js 那份）——2026-09-21 为此白折腾三轮（内联 animation 表还停在 `frames:1` 的占位版，画面恒为静帧）。守值已加：`vtest_pet_anim` 逐字段比对两份 `animMap` + **在 vm 里直接执行内联副本**断言产物。**动任何 PetSprites 字段（map/avatarMap/animMap）前后都要问一句"内联那份同步了吗"**。

## 5 每次都要知道的未决红线
- 🔴 **打造 / 进化 / 定价 / 副本 / 塔仍是客户端权威** → **收真钱前必须搬完**（完整清单见 `PROJECT_CONSTITUTION.md` §三）。
- 通天塔服务端权威 ⏸️ 暂停（未落地，详见宪法 §三 #6）。

## 6 细节去哪读（⭐ 动之前先读，别凭这条索引就开工）
| 要干的活 | 先读 | 里面有什么 |
|---|---|---|
| 改数值 / 装备 / 材料 / 掉落 / 经验 | `.codebuddy/memory/topics/数值与规则.md` | 进化/技能/稀有度/吸血实测/材料元数据/mat-wiki/易错写法 |
| **改数值面板 / 加可调项 / 云端发布 / 「这个数该改哪」** | `.codebuddy/memory/topics/数值管理入口.md` | 三个改数入口 / 面板声明式结构 / **云端配置真实生效范围** / 三条一致性测试 / 形态树遍历坑 |
| 挂机 / 登录会话 / 战斗页 / 任务 / 交易行 / 消息中心 | `.codebuddy/memory/topics/模块不变量.md` | 每个核心模块的不可破坏约定 |
| 改 UI / CSS / 加浮层 / 美术定调 | `.codebuddy/memory/topics/UI与玩法约定.md` | z-index 层级表 / CSS 老坑 / 定调与美术 / 消息中心频道 |
| 跑测试 / 排障 / 真机验证 | `.codebuddy/memory/topics/测试与验证.md` | 基线口径 / flaky 名单 / 免登录验 UI / 测试桩陷阱 |
| 审计 / 动资产 / 不可逆操作 / 迁移 | `.codebuddy/memory/topics/审计与教训.md` | 两个系统性病因 / RLS 现状 / 先扣后发顺序 / 测试四戒 |
| 「这个还没做吧？」/ 上线前还有啥 | `.codebuddy/memory/topics/未决与待办.md` | 零散未决项（权威清单在宪法 §三） |
| 设计长线 / 数值基调 / 装备体系 / 「别人怎么做」 | `.codebuddy/memory/topics/竞品参考-口袋精灵2.md` | 口袋精灵2 一手手册：**分段阻尼公式** / 装备 % 乘基础属性 / 速度用比值 / 命中用门槛 / 11 个装备维度 / 月增长标尺 |

## 技能索引（流程类知识在这里，别抄进 MEMORY）
`forge-of-souls-dev` 总纲（目录 / CSS / **战斗页表现层：动画·特效的写法与坑** / 云端多步 / 偏好）｜`fos-balance` 改数值｜`fos-verify` 测试与排障｜`fos-cloud` Supabase 表 / RPC / 迁移 / EF
｜**`绘图skill` 出图/出视频的正式通道**（中转站画布 + MCP：桥在 17371、网页必须开着并点过「连接」、
用 `node tools/canvas-cli.js list|schema|call` 调；含**九格→帧条**素材产出链；⛔ meowa 线用户已叫停）
