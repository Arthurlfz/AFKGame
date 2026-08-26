# Forge of Souls · 多 AI 帮手（Agents）说明

这 5 个 `.soul.md` 文件，就是 5 个 AI 帮手的「岗位说明书」。
模型分配：**策划 / 架构用 DeepSeek，后端 / 前端 / 测试用 GPT-5.6（中转站）**。

## 文件清单
| 文件 | 角色 | 模型 |
|---|---|---|
| `01-策划数值.soul.md` | 想清楚要做什么、定数值 | DeepSeek |
| `02-系统架构.soul.md` | 模块 / 数据库 / 接口设计 | DeepSeek |
| `03-后端.soul.md` | 写 Supabase SQL / RPC | GPT-5.6 |
| `04-前端.soul.md` | 写网页界面 | GPT-5.6 |
| `05-测试.soul.md` | 删档自测、回归 | GPT-5.6 |

## 怎么用（两种办法）

**办法 A：贴进 CodeBuddy 自定义 Agent（推荐）**
1. 打开 CodeBuddy「智能工作流 / 高级功能 → 创建 Agent」
2. 把对应 `.soul.md` 的全文，粘进 Agent 的「指令 / 系统提示」框
3. 模型选择处，策划 / 架构选 DeepSeek，其余三个选 GPT-5.6（中转站那个自定义模型）
4. 建 5 个，分别起名：策划、架构、后端、前端、测试

**办法 B：直接让我（助手）按 soul 干活**
你不下 CodeBuddy 自定义 Agent 也没关系。你只要跟我说「按计划，让后端助手写 XXX」，
我就读对应的 `.soul.md`，照里面的角色和规矩去干。

## 协作顺序
策划 → 架构 →（后端 ‖ 前端 并行）→ 测试 → 问题回灌策划，循环。

## 公共必读（所有帮手都认这几个文件为唯一事实源）
- `游戏设计理念，所有Agent必须阅读.md`
- `游戏数据地图 v1.md`
- `策划必须阅读！.txt`
- `Mvp/` 现有代码

> 注意：GPT-5.6 是走中转站，需要在 CodeBuddy「自定义模型（API 接入）」
> 填你 relay 的 base_url + key（配置在 `~/.workbuddy/models.json`）后才能选到。
