<h1 align="center">
  <img src="./assets/logo.svg" alt="Rookie Code Logo" width="800">
</h1>

<p align="center">
  <b>一个基于 LLM 的终端代码智能体，通过自然语言交互完成代码阅读、编辑、搜索和终端操作，支持长期记忆。</b>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg" alt="Node.js"></a>
  <a href="https://github.com/ljwrookie/rookie_code/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Language-TypeScript-blue.svg" alt="TypeScript"></a>
</p>

---

## 🌟 特性 (Features)

- 🗣 **自然语言驱动** — 用中文或英文描述你想做什么，Agent 自动规划并调用内置工具完成工作。
- 🧠 **长期记忆 (Long-Term Memory)** — 支持跨对话的长期记忆，利用 `/init` 和 `/add-store` 等指令持久化项目的关键规范、TODO、和结构信息，并在对话中自动注入，保持上下文连贯。
- 🛠 **丰富工具生态** — 包含文件读写、代码模糊编辑、代码搜索 (grep)、目录浏览、带沙箱的终端命令执行、**多 Agent 协作**、**技能扩展**等工具。
- 🧩 **Skill 技能系统** — 支持挂载独立技能模块，通过 `/omc` 入口统一路由任务，实现功能扩展与任务专业化处理。
- 🧑‍🤝‍🧑 **多 Agent 协作** — 支持委派子任务给独立子 Agent（`agent` 工具），或并行启动多个 Agent 执行独立任务（`multiagent` 工具），高效处理复杂任务。
- 🪄 **模糊匹配编辑** — 容忍 LLM 输出中的空白和缩进差异，提供防幻觉安全检查。
- ⚡ **流式输出** — 实时展示 LLM 的思考过程 (Think) 与工具调用日志。
- 🔄 **Git Checkpoint** — 每次修改文件前自动创建 git checkpoint，支持 `/undo` 一键安全回滚。
- 🛡 **安全沙箱** — 命令白名单、危险模式检测、路径遍历保护、敏感环境变量隔离。
- 📊 **对话与 Token 管理** — 动态 Token 预算控制（滑动窗口算法），支持 `/compact` 压缩历史记录。

## 🚀 快速开始 (Quick Start)

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

### 3. 配置 API Key

支持 OpenAI (含兼容的第三方端点) 与 Anthropic。请在环境中设置：

```bash
# 使用 Anthropic Claude
export ANTHROPIC_API_KEY=your-anthropic-key-here

# 使用 OpenAI
export OPENAI_API_KEY=your-openai-key-here
```

### 4. 运行

```bash
# 直接运行
node dist/index.js

# 或全局链接后作为系统命令使用
pnpm link --global
rookie-code
```

## 🛠 内置工具 (Built-in Tools)

| 工具名称       | 功能描述 |
|--------------|---------|
| `read_file`  | 读取指定文件内容，支持 `offset`/`limit` 分段读取以节省上下文。 |
| `edit_file`  | 执行代码的搜索替换编辑，支持模糊匹配，自动打印高亮 diff。 |
| `write_file` | 创建并写入新文件。 |
| `shell_exec` | 执行终端命令（如 npm install, pytest 等），并在安全沙箱内运行。 |
| `search_code`| 基于正则表达式进行代码级搜索。 |
| `list_files` | 递归列出项目内的目录结构。 |
| `agent`      | 将子任务委派给一个独立的子 Agent，适用于复杂子任务的分解处理。 |
| `multiagent` | 并行启动多个子 Agent 执行相互独立的任务，高效完成多维度工作。 |

## 💬 斜杠命令 (Slash Commands)

进入 `rookie-code` 的 REPL 后，你可以直接输入自然语言，也可以使用以下指令管理对话状态：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令列表。 |
| `/init` | 扫描项目结构，初始化长期记忆（Long-Term Memory），创建项目知识快照。 |
| `/add-store` | 手动添加信息到长期记忆存储中（支持 KV 对、Scope 等）。 |
| `/undo` | 回退最近一次的文件编辑操作（基于 Git Checkpoint）。 |
| `/clear` | 清空当前的对话历史，释放 Token 占用。 |
| `/diff` | 显示工作区当前的 Git Diff 变化。 |
| `/status` | 打印当前 Git 仓库状态。 |
| `/compact` | 使用智能截断压缩对话历史以节省上下文空间。 |
| `/tokens` | 显示当前 Token 使用量和 Budget。 |
| `/exit` | 退出程序。 |

## 🏗 架构设计 (Architecture)

```
src/
├── index.ts                    # CLI 入口
├── llm/                        # LLM 抽象层 (OpenAI / Anthropic 支持)
├── agent/                      # 智能体核心循环 (Think → Action → Observe)
├── memory/                     # 长期记忆管理 (Snapshot, Budget, Store)
├── tools/                      # 工具系统与执行器
│   └── agents.ts               # 多 Agent 协作工具
├── skills/                     # Skill 技能系统与管理器
├── editor/                     # 带有模糊匹配的防幻觉代码编辑引擎
├── repo/                       # Git Checkpoint 机制
├── security/                   # 安全隔离沙箱
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

# 运行所有测试 (包含 80+ 核心模块测试用例)
pnpm test

# 静态类型检查
pnpm lint
```

## 🧩 Skill 技能系统

Skill 是可扩展的功能模块，通过 `/omc` 入口统一路由任务，实现专业化任务处理。每个 Skill 包含独立的逻辑和工作流，支持:

- 任务路由与意图分析
- 复杂工作流编排
- 专业化领域处理
- 并行与协作任务管理

### 内置 Skill

- **omc**: 统一任务路由中心，自动分析用户意图并分发到合适的处理流程

### 开发自定义 Skill

在项目中创建 `skills/<skill-name>/SKILL.md` 文件，遵循特定格式定义 Skill 元数据和处理逻辑。

## 📄 许可证 (License)

本项目采用 [MIT License](LICENSE) 协议。
