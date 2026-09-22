# UI / CSS 与玩法约定

> 入口：`MEMORY.md`｜**改 UI、加浮层、改 CSS 前先读本文件。**改 UI 还要走 skill（见 `AGENTS.md` §八）：
> `forge-of-souls-dev`（CSS 铁律）+ `ardot-design-generator` 的 `rules/style-guide.md` 与 `skills/ardot-design-assistant/references/guidelines-code.md`。
> 本文件按需读取，不占每轮注入预算 —— 有新事实直接往下加。

## 定调
- **无第一 / 第二幕，一条连续进度**；任务链一环套一环、新手引导不许卡手；
  守关 Boss 是**服务端权威稀有事件**，引导 / 任务不许拿它当条件。
- 美术：**古典水墨山水 + 羊皮纸做旧**；墨黑灰白为主，暗紫 / 锈红 / 病绿点缀，**几乎不用亮金**。

## z-index / 层叠
- 🔴 **唯一权威 = `game.css` 顶部「层级表」注释**（100 浮窗 / 200+ 模态 / 300 tooltip / 500 系统级）。
  **加浮层先挑档，别自己编数字**；也别给 `.tab-page` 写 `display`（ID 选择器会碾压 `.tab-page{display:none}`，页面切换直接失效）。
- ⭐ **CSS 老坑（已踩两次）**：
  1. 父容器缺 `height:100%` → 子级 `flex:1` **失效**（症状是"XX 不见了"，其实是内容把底部顶出可视区）。
  2. **hover 才出现的按钮必须 `position:absolute`**，放流内一出现就顶动布局。
  3. 简写 `background` 里别用 `var()` 当颜色（会被当成第二层图 → 颜色拿不到）。
- 🔴 **禁止补丁式修复**：`!important` 覆盖、负 margin 硬拉、写死数值怼上去 —— 一律停手回去找根因。
  同一块样式堆了多层还带 `!important` 时，**先删旧层再加新层**，否则新样式根本压不过。

## 数据面板做法（设计规范要点）
- 数据面板**不要给每个数字套盒子**：用分组 / 分隔线 / 字重分层；盒子应是**一组一个**（分组容器），不是一个数字一个。
- **最多 1 个强调色**；禁纯黑、禁霓虹外发光（用内边框 / 带色阴影）；禁硬编码颜色，一律用 `design-tokens.css` 的 token。
- 改设计→代码：用**项目已有 token**、**更新现有组件而不是新建**、**不许破坏既有功能**。
- 玩家文案**禁破折号**（`—`/`–`），守值 `vtest_codex.js` 会抓。

## ⭐ 消息中心 / 富文本通道的 HTML 规矩（2026-09-17 用户实机抓 bug 后立）
**通道口径**（`ui-common.js:99` 注释是权威）：`UI.consoleLog(cat, html)` / `UI.addLog(text)` /
`UI.showToast(title, msg)` **全是富文本、内部不转义** —— 所以全项目 16 处调用直接把 `<svg class="eic">`
当图标传进去，是**对的**。⛔ 别给这些函数加 escapeHtml（加了图标就整段变源码文本）。
⇒ **调用方负责安全**：拼进来的玩家可控内容（昵称 / 宠物名 / 装备名）自己先 `escapeHtml`。

🔴 **反过来的坑（塔踩过，2026-09-17）**：**自己再包一层 `esc(整串)` 会把图标一起转义**。
`tower/ui-tower-battle.js` 的 `logEpic(text)` 就是 `${esc(text)}`，而 3 个调用方把 `<svg>` 拼进了 text
⇒ 玩家在消息中心看到 `<svg class="eic" viewBox="0 0 24 24" …>` 一坨源码，**像游戏坏了**（用户实机发现）。
✅ 正确写法：**图标与文案分开传，只有文案进 esc** ——
`logEpic(icon, text)` → `'<span class="tw-epic">' + (icon||'') + esc(text) + '</span>'`（同 `logLootLoot`）。
⚠️ 守值：`vtest_tower_ui.js` 第 ⑤ 节 —— 桩掉 consoleLog 收 html，断言**没有 `&lt;svg`** 且**真有 `<svg`**。

## 🔴 showToast 不是浮层提示（2026-09-21 内测实测定案）
`UI.showToast` **只是往消息中心写一行字**（底部聊天弹窗 / 页面内嵌 console）。而内嵌 console 只挂在
**世界地图/主城/战斗/宠物页**四个下半区——**市集/商店/背包浮窗等场景根本没有内嵌 console**，
弹窗还开着时消息也全被弹窗挡住 ⇒ 玩家正盯着操作的地方，永远看不到"提示"，感知 = "点了没反应"
（内测清单 🟠4 购买失败没反馈、🟠16 任务提交没反馈都是这个根因）。
⇒ **规矩：关键操作的成败反馈必须"就地"显示在玩家正看着的界面里**
（弹窗开着 → 错误行写进弹窗，参照 `ui-market.js` openBuyConfirm 的 `.buy-confirm-error`）；
showToast/消息中心那份照写，供事后回看，但**不能当唯一反馈**。
（写新播报函数时照抄这个模式；凡是"图标 + 动态文字"的通道都适用。）

## 🔴 CSS 两个常踩的结构坑（2026-09-22 宠物页 V2 重构实测）
1. **`grid-area` 命名线会泄漏**：只要父级曾用 `grid-template-areas: "a b c"` + 子项 `grid-area: b`，
   把三列下移到**新的** grid 容器后，那些 `grid-area` 仍生效 —— 新网格会凭空多出几列、行高错乱
   （实测：三列变五列、中间那格被压成 34px）。⇒ 重构布局时**把旧命名网格整套删掉**，
   不要在新容器上打补丁（子项上的 `grid-area` 就是地雷）。
2. **`.tab-page.active` 是 `display:block`、高度 auto** ⇒ 页内所有 `height:100%` 静默失效，
   表现是"内容撑不满 + 容器出现空滚"。任何"撑满整屏"的页面前，先给页容器**确定高度**
   （`#app:has(#tab-X.active) #tab-X { height: 100% }`），再谈 flex 撑满。
   配套：`display:flex/grid` 只准写在 `.active` 上（写宽选择器会碾压 `.tab-page{display:none}`，项目红线）。
3. **`!important` 会锁死后续调尺寸**：`game.css` 里给头像写 `width:180px !important` 后，
   任何新布局都改不动它。改布局时**优先删旧的 `!important`**，别加新的去对抗。
