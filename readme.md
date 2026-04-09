# rookie-code

一个基于 LLM 的 CLI 代码智能体，通过自然语言交互完成代码阅读、编辑、搜索和终端操作。灵感来自 Claude Code。

```
$ rookie-code
🤖 rookie-code v0.1.0
  Type your request, or /exit to quit.

> 帮我把 src/utils/math.ts 中的 fibonacci 函数改成迭代实现，然后跑一下测试

  ⚡ read_file path: "src/utils/math.ts"
  ✔ read_file: function fibonacci(n: number): number { if (n <= 1) return n; ...
  ⚡ edit_file path: "src/utils/math.ts", old_string: "function fibonacci..."
  ✔ edit_file: File edited: src/utils/math.ts
  ⚡ shell_exec command: "pnpm test"
  ✔ shell_exec: Tests: 12 passed

已将递归实现改为迭代实现，所有测试通过。
```

## 特性

- **自然语言驱动** — 用中文或英文描述你想做什么，Agent 自动调用工具完成
- **7 个内置工具** — 文件读写、代码编辑、代码搜索、目录浏览、终端命令执行
- **模糊匹配编辑** — 容忍 LLM 输出中的空白/缩进差异，带幻觉检测防护
- **流式输出** — 实时展示 LLM 思考过程和工具调用
- **Git Checkpoint** — 每次编辑前自动创建 git checkpoint，支持 `/undo` 一键回退
- **安全沙箱** — 命令白名单、危险模式检测、路径遍历保护、敏感环境变量隔离
- **对话管理** — 滑动窗口 token 预算控制，支持 `/compact` 压缩历史
- **88 个单元测试** — 覆盖核心模块

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm（推荐）

### 安装

```bash
git clone https://github.com/ljwrookie/rookie_code.git
cd rookie_code
pnpm install
pnpm build
```

### 配置 API Key

```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

### 运行

```bash
# 直接运行
node dist/index.js

# 或全局链接后使用
pnpm link --global
rookie-code
```

## 内置工具

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件内容，支持 offset/limit 分段读取 |
| `edit_file` | 搜索替换编辑，支持模糊匹配，自动生成 diff |
| `write_file` | 创建新文件 |
| `shell_exec` | 执行终端命令（带安全沙箱） |
| `search_code` | 基于正则的代码搜索（使用 `grep`） |
| `list_files` | 递归列出目录结构 |

## 斜杠命令

| 命令 | 功能 |
|------|------|
| `/help` | 显示可用命令列表 |
| `/clear` | 清空对话历史 |
| `/undo` | 回退最近一次文件编辑（git checkpoint 回滚） |
| `/diff` | 显示当前 git diff |
| `/status` | 显示 git status |
| `/compact` | 压缩对话历史以节省 token |
| `/tokens` | 显示当前 token 用量 |
| `/exit` | 退出 |

## 架构

```
src/
├── index.ts                    # CLI 入口
├── types.ts                    # 核心类型定义
│
├── llm/                        # LLM 提供商抽象
│   ├── provider.ts             # LLMProvider 接口
│   ├── anthropic.ts            # Anthropic Claude 实现（流式）
│   └── errors.ts               # 错误分类与重试
│
├── agent/                      # 智能体核心
│   ├── loop.ts                 # Agent Loop: think → tool_call → observe → repeat
│   ├── system-prompt.ts        # 系统提示词构建
│   ├── conversation.ts         # 对话历史管理
│   └── context.ts              # 滑动窗口 token 预算控制
│
├── tools/                      # 工具系统
│   ├── base.ts                 # Tool 接口
│   ├── registry.ts             # 工具注册表
│   ├── read-file.ts            # 文件读取
│   ├── edit-file.ts            # 文件编辑（集成模糊匹配引擎）
│   ├── write-file.ts           # 文件创建
│   ├── shell-exec.ts           # 终端命令执行
│   ├── search-code.ts          # 代码搜索
│   └── list-files.ts           # 目录列表
│
├── editor/                     # 编辑引擎
│   ├── search-replace.ts       # 搜索替换核心算法
│   ├── fuzzy-match.ts          # 模糊匹配（4 策略 + 幻觉防护）
│   └── diff-display.ts         # 彩色 diff 输出
│
├── repo/                       # Git 操作
│   └── git.ts                  # Checkpoint 创建/回滚/列表
│
├── security/                   # 安全沙箱
│   └── sandbox.ts              # 命令白名单、危险模式检测、路径保护
│
├── cli/                        # 终端界面
│   ├── repl.ts                 # 交互式 REPL
│   ├── renderer.ts             # 流式渲染器
│   ├── commands.ts             # 斜杠命令系统
│   └── confirm.ts              # 用户确认对话框
│
├── config/                     # 配置
│   ├── loader.ts               # 配置加载（环境变量 + 默认值）
│   └── defaults.ts             # 默认配置
│
└── utils/                      # 工具函数
    ├── tokens.ts               # Token 计数（js-tiktoken）
    ├── truncate.ts             # 文本截断
    └── logger.ts               # 日志
```

### 核心循环

```
用户输入 → Agent Loop → LLM (Claude) → 文本输出 / 工具调用
                ↑                              ↓
                └──── 工具执行结果 ←── Tool Registry
```

Agent Loop 在每轮迭代中：
1. 将对话历史发送给 LLM（流式）
2. 收集 LLM 的文本输出和工具调用请求
3. 执行工具调用，收集结果
4. 将结果追加到历史，进入下一轮
5. 直到 LLM 不再请求工具调用，或达到最大迭代次数

### 模糊匹配引擎

当 LLM 产生的 `old_string` 无法精确匹配时，按优先级尝试：

1. **忽略行尾空白** — 去除每行末尾空格后重新匹配
2. **忽略缩进差异** — tabs vs spaces、不同缩进宽度
3. **忽略空行差异** — 跳过空行后匹配非空行序列
4. **Levenshtein 滑动窗口** — 逐行计算编辑距离，找最相似的代码段

每次模糊匹配都要通过**幻觉防护**：
- 行数差异不超过 ±2 行
- 首行和末行锚点相似度 > 0.9

### 安全模型

- **命令白名单**: `cat`, `ls`, `git`, `node`, `pnpm` 等安全命令直接执行
- **危险模式检测**: 拦截 `rm -rf /`、命令注入（`$()`、反引号）等
- **路径保护**: 禁止访问工作目录外的文件，阻止 `/etc`, `~/.ssh` 等敏感路径
- **环境变量隔离**: 子进程中自动剥离 `ANTHROPIC_API_KEY` 等敏感变量

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（监听变更自动构建）
pnpm dev

# 运行测试
pnpm test

# 单次运行测试
pnpm test:run

# 类型检查
pnpm lint

# 构建
pnpm build
```

## 技术栈

- **TypeScript 6** + **ESM** — 纯 ESM 模块
- **Anthropic SDK** — Claude API 流式调用
- **js-tiktoken** — 精确 token 计数
- **diff** — Unified diff 生成
- **chalk** — 终端彩色输出
- **tsup** — 极速打包
- **vitest** — 测试框架

## License

MIT
