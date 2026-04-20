<p align="center">
  <img src="./assets/logo.svg" alt="Rookie Code" width="560" />
</p>

<p align="center">
  <b>一个基于 LLM 的终端代码智能体，通过自然语言完成代码阅读、编辑、搜索、命令执行，以及多 Agent 协作。</b>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg" alt="Node.js"></a>
  <a href="https://github.com/ljwrookie/rookie_code/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Language-TypeScript-blue.svg" alt="TypeScript"></a>
</p>

---

## 项目状态

> Experimental / Early-stage project
>
> 本项目仍处于快速迭代阶段，接口、命令和默认行为可能继续调整。

---

## 当前能力

- 自然语言驱动的 CLI code agent
- 流式输出与交互式 Terminal UI
- 文件读取、精确编辑、新文件创建
- Shell 命令执行与确认机制
- 代码搜索与目录浏览
- 多 Agent 工具：`agent`、`multiagent`、`orchestrate`
- MCP tools 挂载
- Skills 系统
- Hooks / 插件扩展
- 长期记忆与仓库概览注入
- Prompt injection 基础防护与告警
- 调试日志与 token 预算展示

## 最近对齐后的行为说明

- 如果同时存在 `ANTHROPIC_API_KEY` 和 OpenAI/ARK key，默认优先使用 **Anthropic**。
- `edit_file` 现在**只用于编辑已有文件**；创建新文件请使用 `write_file`。
- 不再在每次 Agent Run 前自动创建 git checkpoint。
- 命中 prompt injection 特征的工具输出，会在 UI 中显示 warning 通知。

## 快速开始

### 1. 环境要求

- [Node.js](https://nodejs.org/) >= 20
- npm 或 pnpm

### 2. 安装

```bash
git clone https://github.com/ljwrookie/rookie_code.git
cd rookie_code
npm install
npm run build
```

### 3. 配置模型提供方

支持 Anthropic 与 OpenAI 兼容接口。

```bash
# Anthropic
export ANTHROPIC_API_KEY=your-anthropic-key

# OpenAI
export OPENAI_API_KEY=your-openai-key

# ARK / OpenAI-compatible gateway
export ARK_API_KEY=your-ark-key
```

可通过 CLI 参数覆盖：

```bash
rookie-code --provider anthropic -m claude-sonnet-4-6
rookie-code --provider openai --base-url https://example.com/v1 -m gpt-4o
```

### 4. 运行

```bash
npm run build
node dist/index.js
```

或：

```bash
npm link
rookie-code
```

## 脚本

```bash
npm run build      # tsup
npm run dev        # tsup --watch
npm run test       # vitest
npm run test:run   # vitest run
npm run lint       # tsc --noEmit
```

## CLI 参数

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

## 环境变量

```bash
export ROOKIE_SKILLS_DIRS="/path/to/skills1,/path/to/skills2"
export ROOKIE_MAX_AGENT_DEPTH=3
export ROOKIE_MAX_PARALLEL_AGENTS=5
export CUSTOM_MODELS='[{"name":"my-model","provider":"openai","baseURL":"https://example.com/v1"}]'
```

## 内置工具

| 工具 | 说明 |
|---|---|
| `read_file` | 读取文件内容，支持 `offset` / `limit` |
| `edit_file` | 编辑已有文件，基于 `old_string` / `new_string` 做替换 |
| `write_file` | 创建新文件并写入内容 |
| `shell_exec` | 执行 shell 命令，必要时要求确认 |
| `search_code` | 代码搜索 |
| `list_files` | 浏览项目目录 |
| `ask_user` | 向用户提问或澄清 |
| `agent` | 启动单个子 Agent |
| `multiagent` | 并行启动多个子 Agent |
| `orchestrate` | Planner / Worker 编排 |

## 常用斜杠命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/skills` | 查看已加载技能 |
| `/skill <name>` | 查看某个 skill 的内容 |
| `/mcp` | 查看 MCP servers 与 tools |
| `/init` | 初始化项目记忆 |
| `/add-store` | 写入长期记忆存储 |
| `/undo` | 回退最近一次 checkpoint 恢复 |
| `/checkpoint` | 管理 checkpoint |
| `/git` | Git 辅助命令 |
| `/clear` | 清空当前对话 |
| `/diff` | 查看当前改动 |
| `/status` | 查看仓库状态 |
| `/compact` | 压缩历史对话 |
| `/tokens` | 查看 token 使用情况 |
| `/exit` `/quit` | 退出 |

## 架构概览

当前入口已经拆分为 bootstrap 分层：

- `src/index.ts`：主入口
- `src/bootstrap/config.ts`：CLI 参数解析与配置组装
- `src/bootstrap/provider.ts`：LLM provider 初始化
- `src/bootstrap/runtime.ts`：hooks / memory / skills / observability 初始化
- `src/bootstrap/tools.ts`：内置 tools、MCP tools、Agent tools、Terminal UI 装配
- `src/bootstrap/repl.ts`：AgentLoop 与 REPL 启动

核心模块：

- `src/agent/loop.ts`：Agent 主循环
- `src/cli/repl.ts`：交互式 REPL
- `src/cli/terminal-ui.ts`：终端 UI
- `src/tools/*`：工具系统
- `src/hooks/manager.ts`：Hook 管理
- `src/memory/*`：长期记忆
- `src/mcp/*`：MCP 集成
- `src/security/*`：路径校验、命令防护、prompt injection 包装

## 技能系统

Skills 可以放在项目内 `skills/` 目录，或通过 `ROOKIE_SKILLS_DIRS` 指定额外目录。

在 REPL 中：

- `/skills` 查看可用 skills
- `/skill <name>` 查看 skill 内容
- `/<skill-name> ...` 直接把该 skill 作为入口执行

## Hooks 与插件

启动时会加载以下位置的插件：

- `rookie.plugins.mjs`
- `.rookie-code/plugins/*.mjs`

你可以在插件里通过 `hooks.on(...)` 注册：

- `before_execute_command`
- `after_execute_command`
- `before_agent_run`
- `after_agent_run`
- `pre_tool_use`
- `post_tool_use`
- `post_tool_use_failure`
- `permission_request`
- `notification`
- `subagent_start`
- `subagent_stop`
- `session_start`
- `session_end`
- `pre_compact`
- `post_compact`
- `user_prompt_submit`
- `stop`

## MCP

如果工作目录下存在 `.mcp.json`，启动时会自动加载并挂载其中的 MCP tools。

示例：

```json
{
  "mcpServers": {
    "my_stdio_server": {
      "command": "npx",
      "args": ["-y", "@my-org/my-mcp-server"]
    }
  }
}
```

## 开发说明

推荐检查命令：

```bash
npm run lint
npm run test:run
```

## License

[MIT](LICENSE)
