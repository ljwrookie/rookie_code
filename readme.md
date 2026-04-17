<p align="center">
  <img src="./assets/logo.svg" alt="Rookie Code" width="560" />
</p>

<p align="center">
  <b>一个基于 LLM 的终端代码智能体，通过自然语言交互完成代码阅读、编辑、搜索和终端操作，支持长期记忆。</b>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg" alt="Node.js"></a>
  <a href="https://github.com/ljwrookie/rookie_code/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Language-TypeScript-blue.svg" alt="TypeScript"></a>
</p>

---

## 🌟 特性（Features）

- 🗣 **自然语言驱动** — 用中文或英文描述你想做什么，Agent 自动规划并调用工具完成工作。
- 🧠 **长期记忆 (Long-Term Memory)** — 支持跨对话的长期记忆，利用 `/init` 和 `/add-store` 等指令持久化项目的关键规范、TODO、和结构信息，并在对话中自动注入，保持上下文连贯。
- 🛠 **丰富工具生态** — 包含文件读写、代码模糊编辑、代码搜索 (grep)、目录浏览、带沙箱的终端命令执行、**多 Agent 协作**、**技能扩展**等工具。
- 🧩 **Skills 挂载** — 支持从本地目录挂载独立 Skill（`skills/<name>/SKILL.md`），通过 `/<skill>` 直接作为入口执行，并支持 `/skills` / `/skill <name>` 查看。
- 🧑‍🤝‍🧑 **多 Agent（agent / multiagent / orchestrate）** — 支持委派子任务给独立子 Agent（`agent`），并行启动多个 Agent（`multiagent`），以及 Planner/Worker 编排（`orchestrate`）。
- 🪝 **Hooks 机制** — 提供可扩展钩子点（命令前后、Agent Run 前后），便于做路由、拦截、注入上下文等扩展。
- 🔌 **MCP（Model Context Protocol）** — 支持从工作目录的 `.mcp.json` 连接 MCP Server，并把其 tools 挂载进工具系统（自动命名为 `mcp_<server>__<tool>`）。
- 🪄 **模糊匹配编辑 + 变更确认** — 容忍 LLM 输出中的空白和缩进差异；当发生 fuzzy match 或高风险改动时，会在写入前展示 diff 并要求确认。
- ⚡ **流式输出** — 实时展示 LLM 的思考过程 (Think) 与工具调用日志。
- 🔄 **Git Checkpoint（stash 快照）** — 每次 Agent Run 前若工作区有未提交改动，会创建 stash 快照；支持 `/undo`、`/checkpoint ...` 安全回滚/管理。
- 🛡 **安全沙箱** — 命令白名单、危险模式检测、路径遍历保护（含 symlink 绕过防护）、敏感环境变量隔离。
- 🧪 **工具入参校验（zod）** — 对工具参数做 schema 校验，减少 LLM 幻觉参数导致的异常。
- 🧯 **Prompt 注入防护（基础版）** — 工具输出会被标记为“不可信数据”，并做简单注入特征检测，避免把输出当成指令执行。
- 📊 **对话与 Token 管理** — 动态 Token 预算控制（滑动窗口算法），支持 `/compact` 压缩历史记录。
- 🧾 **Debug 日志（可观测性）** — `--debug` 会将会话关键事件（命令、工具调用/结果、权限确认等）写入 JSONL 日志文件。

## 🚀 快速开始（Quick Start）

### 1. 环境要求

- [Node.js](https://nodejs.org/) >= 20.0.0
- pnpm（推荐）

### 2. 安装

```bash
git clone https://github.com/ljwrookie/rookie_code.git
cd rookie_code
pnpm install
pnpm build
```

### 3. 配置 API Key / 模型

支持 OpenAI（含兼容的第三方端点）与 Anthropic。请在环境中设置（任选其一）：

```bash
# 使用 Anthropic Claude
export ANTHROPIC_API_KEY=your-anthropic-key-here

# 使用 OpenAI
export OPENAI_API_KEY=your-openai-key-here

#（可选）Ark / OpenAI 兼容端点（如果你用的是 ARK / 其他 OpenAI 兼容网关）
export ARK_API_KEY=your-ark-key-here
```

可通过 CLI 参数覆盖模型 / provider / baseURL：

```bash
# 例如：指定模型
rookie-code -m gpt-4o

# 例如：指定 OpenAI provider + 自定义 baseURL（OpenAI 兼容网关）
rookie-code --provider openai --base-url https://example.com/v1 -m my-model
```

### 4. 运行

```bash
# 直接运行
node dist/index.js

# 或全局链接后作为系统命令使用
pnpm link --global
rookie-code
```

### 5. 可选环境变量

```bash
# Skills 扫描目录（多个用逗号分隔）
export ROOKIE_SKILLS_DIRS="/path/to/skills1,/path/to/skills2"

# 多 Agent 配置
export ROOKIE_MAX_AGENT_DEPTH=3
export ROOKIE_MAX_PARALLEL_AGENTS=5

#（可选）自定义模型映射（JSON 数组）。
# 当 `-m/--model` 指定的模型命中该表时，将自动使用对应 provider/baseURL（用于 OpenAI 兼容网关/ARK 等）。
export CUSTOM_MODELS='[{"name":"ep-20260331185940-dfhcg","provider":"openai","baseURL":"https://ark-cn-beijing.bytedance.net/api/v3"}]'
```

### 6. CLI 参数速查

```bash
rookie-code \
  --model <name> \
  --provider <openai|anthropic> \
  --base-url <url> \
  --no-confirm \
  --no-confirm-fuzzy-edits \
  --no-confirm-high-risk-edits \
  --max-auto-edit-lines <N> \
  --max-iterations <N> \
  --token-budget <N> \
  --no-repo-context \
  --repo-max-files <N> \
  --debug \
  --log-dir <dir> \
  --verbose
```

## 🛠 内置工具 (Built-in Tools)

| 工具名称       | 功能描述 |
|--------------|---------|
| `read_file`  | 读取指定文件内容，支持 `offset`/`limit` 分段读取以节省上下文。 |
| `edit_file`  | 执行代码搜索替换编辑，支持模糊匹配；fuzzy 或高风险变更会在写入前要求确认。 |
| `write_file` | 创建并写入新文件；高风险创建会在写入前要求确认。 |
| `shell_exec` | 执行终端命令（如 npm install, pytest 等），并在安全沙箱内运行。 |
| `search_code`| 基于正则表达式进行代码级搜索。 |
| `list_files` | 递归列出项目内的目录结构。 |
| `ask_user`   | 在执行过程中向用户提问/选择（用于澄清需求或决策）。 |
| `agent`      | 将子任务委派给一个独立的子 Agent，适用于复杂子任务的分解处理。 |
| `multiagent` | 并行启动多个子 Agent 执行相互独立的任务，高效完成多维度工作。 |
| `orchestrate`| Planner/Worker 编排：自动拆分任务、并行执行并汇总结果。 |

> 备注：在实现层面，`agent` / `multiagent` 是“工具（tool）”能力（对应多 agent：agent/multiagent）。它们会启动独立的 AgentLoop，使用独立对话历史与工具迭代，并最终把结果回传给主 Agent。

## 💬 斜杠命令 (Slash Commands)

进入 `rookie-code` 的 REPL 后，你可以直接输入自然语言，也可以使用以下指令管理对话状态：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令列表。 |
| `/skills` | 列出已挂载的 Skills（例如 `/omc`）。 |
| `/skill <name>` | 查看某个 Skill 的内容与来源路径。 |
| `/mcp` | 显示从 `.mcp.json` 加载到的 MCP servers 与已挂载的 MCP tools。 |
| `/init` | 扫描项目结构，初始化长期记忆（Long-Term Memory），创建项目知识快照。 |
| `/add-store` | 手动添加信息到长期记忆存储中（支持 KV 对、Scope 等）。 |
| `/undo` | 回退最近一次的文件编辑操作（基于 Git Checkpoint）。 |
| `/checkpoint` | 管理 checkpoint（stash 快照）：list/save/apply/undo。 |
| `/git` | Git 辅助命令：add/commit/restore/stash。 |
| `/clear` | 清空当前的对话历史，释放 Token 占用。 |
| `/diff` | 显示工作区当前的 Git Diff 变化。 |
| `/status` | 打印当前 Git 仓库状态。 |
| `/compact` | 使用智能截断压缩对话历史以节省上下文空间。 |
| `/tokens` | 显示当前 Token 使用量和 Budget。 |
| `/exit` | 退出程序。 |
| `/quit` | 退出程序。 |

## 🏗 架构设计 (Architecture)

```
src/
├── index.ts                    # CLI 入口
├── llm/                        # LLM 抽象层 (OpenAI / Anthropic 支持)
├── agent/                      # 智能体核心循环 (Think → Action → Observe)
├── mcp/                        # MCP 客户端：加载 .mcp.json、连接 server、挂载 tools
├── memory/                     # 长期记忆管理 (Snapshot, Budget, Store)
├── tools/                      # 工具系统与执行器
│   └── agents.ts               # 多 Agent 协作工具
│   └── orchestrate.ts          # Planner/Worker 编排工具
├── skills/                     # Skill 技能系统与管理器
├── hooks/                      # Hooks：命令与 Agent Run 的前/后钩子
├── editor/                     # 带有模糊匹配的防幻觉代码编辑引擎
├── repo/                       # Git Checkpoint 机制
├── security/                   # 安全隔离沙箱
├── observability/              # Debug 会话日志（JSONL）
└── cli/                        # REPL、斜杠命令解析与终端流式渲染
```

### 核心工作流

1. 用户输入自然语言或触发斜杠指令。
2. **Memory Manager** 组装项目级长期记忆与 System Prompt，并进行 Token 裁剪。
3. **Agent Loop** 发送完整上下文到 LLM（流式）。
4. 解析 LLM 响应，提取其规划与对应的 `Tool Calls`。
5. 安全沙箱验证后，执行具体工具，将结果回调到对话历史。
6. Agent 自动分析执行结果，如有必要则进行下一轮 Loop。

## 👨‍💻 开发指南 (Development)

```bash
# 启动开发模式，监听文件更改并自动编译
pnpm dev

# 运行测试
pnpm test

# 静态类型检查
pnpm lint
```

## 🧩 Skill 技能系统

Skill 是可扩展的功能模块，可通过 `/<skill>` 作为入口执行（例如 `/find-skills ...`）。
在 REPL 中：

- 输入 `/skills` 查看已挂载的技能
- 输入 `/<skill>`（例如 `/find-skills react testing`）会被当作 Skill 入口，注入 Skill 内容并交给主 Agent 执行
- 输入 `/skill <name>` 可查看该 Skill 的正文与来源路径

Skill 发现与安装也可以借助生态工具（例如 `npx skills`）。本仓库内 `skills/` 目录支持放置 repo-local skills。

- 任务路由与意图分析
- 复杂工作流编排
- 专业化领域处理
- 并行与协作任务管理

### 内置 Skill

- **find-skills**: 帮你在 skills 生态中搜索/安装合适的技能（见 `skills/find-skills/SKILL.md`）

### 开发自定义 Skill

在项目中创建 `skills/<skill-name>/SKILL.md` 文件，文件头部可选 YAML Frontmatter（用于 name/description/type），正文为该 Skill 的工作指令。例如：

```md
---
name: my-skill
description: Do something specialized
type: workflow
---

# My Skill

这里写该 Skill 的“最高优先级工作指令”。
```

---

## 🪝 Hooks 机制

Hook 用于在 REPL/AgentLoop 的关键节点做拦截、改写输入、记录日志或触发外部系统。事件与入参以 `src/hooks/manager.ts` 为准。

| Hook 事件 | 触发时机 | 入参 | 返回值/用途 |
|---|---|---|---|
| `session_start` | REPL 启动/clear/resume 时 | `{ source: 'startup' | 'resume' | 'clear' }` | 用于记录会话开始、初始化外部状态 |
| `session_end` | REPL 结束/clear/resume/退出输入时 | `{ reason: 'clear' \| 'resume' \| 'prompt_input_exit' \| 'other' }` | 用于记录会话结束、落盘日志 |
| `before_execute_command` | 执行 `/xxx` 斜杠命令前 | `{ input: string }` | 可返回 `{ input?, bypass? }`：重写命令/拦截命令 |
| `after_execute_command` | 执行 `/xxx` 斜杠命令后 | `{ input: string, result: 'exit' \| 'handled' \| 'unknown' }` | 记录命令结果、统计 |
| `before_agent_run` | 普通输入/Skill 入口进入 AgentLoop 前 | `{ input: string }` | 可返回 `{ input? }`：为本次请求注入前缀或改写输入 |
| `after_agent_run` | AgentLoop 完成后 | `{ input: string }` | 记录本次请求完成、触发后处理 |
| `user_prompt_submit` | 用户输入提交后（进入执行流前） | `{ prompt: string }` | 统一埋点、审计、关键词拦截 |
| `pre_tool_use` | 每次工具执行前 | `{ tool_input: any }` | 记录工具调用、实现“dry-run/审批”等 |
| `post_tool_use` | 工具执行成功后 | `{ tool_input: any, tool_response: any }` | 记录结果、提取结构化指标 |
| `post_tool_use_failure` | 工具执行失败后 | `{ tool_input: any, error: Error \| unknown }` | 记录错误与失败原因 |
| `permission_request` | 需要用户授权时（例如 `shell_exec` 询问确认） | `{ tool_input: any }` | 用于接入外部审批/弹窗 |
| `notification` | Agent 发出通知事件时 | `{ title: string, message: string, notification_type: string }` | 将通知转发到 UI/IM |
| `subagent_start` | 子 agent 启动时 | `{ agent_id: string, agent_type: string }` | 记录并行任务开始 |
| `subagent_stop` | 子 agent 结束时 | `{ agent_id: string, agent_type: string }` | 记录并行任务结束 |
| `pre_compact` | `/compact` 开始前 | `{}` | 记录压缩开始 |
| `post_compact` | `/compact` 完成后 | `{ compact_summary: string }` | 记录压缩结果 |
| `stop` | 用户中断（Ctrl+C）时 | `{}` | 清理资源/中断外部请求 |

示例（注册 hooks）：

```ts
import { HookManager } from './src/hooks/manager.js';

const hooks = new HookManager();

hooks.on('before_execute_command', ({ input }) => {
  if (input === '/ping') return { input: '/help' };
});

hooks.on('pre_tool_use', async ({ tool_input }) => {
  // tool_input: { name, input }
  console.error('[tool]', tool_input.name);
});

hooks.on('permission_request', async ({ tool_input }) => {
  // 例如：将 shell_exec 的授权请求转发到外部系统
  // await notifyApprover(tool_input);
});
```

## 🔌 MCP（Model Context Protocol）

本项目会在启动时读取当前工作目录下的 `.mcp.json`（若不存在则自动禁用 MCP），并尝试连接其中配置的 MCP servers；连接成功后会将 MCP tools 挂载到工具系统中。

### `.mcp.json` 示例

```json
{
  "mcpServers": {
    "my_stdio_server": {
      "command": "npx",
      "args": ["-y", "@my-org/my-mcp-server"],
      "env": {"FOO": "bar"}
    },
    "my_sse_server": {
      "url": "http://localhost:3000/sse",
      "headers": {"Authorization": "Bearer <token>"}
    }
  }
}
```

### MCP 工具命名规则

为避免与内置工具冲突，挂载后的工具名会被命名为：

```
mcp_<serverName>__<toolName>
```

在 REPL 中可使用 `/mcp` 查看已连接的 servers 与已挂载 tools。

## 📄 许可证 (License)

本项目采用 [MIT License](LICENSE) 协议。
