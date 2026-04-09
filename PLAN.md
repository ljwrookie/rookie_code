# Rookie Code — Implementation Plan

> CLI-based Code Agent (类 Claude Code) 从零到一实现计划
> Generated: 2026-04-09 | Repo: ljwrookie/rookie_code

---

## Table of Contents

- [Overview](#overview)
- [Phase 0.0 — Project Scaffolding](#phase-00--project-scaffolding)
- [Phase 0.1 — Minimal Agent Loop (E2E Demo)](#phase-01--minimal-agent-loop-e2e-demo)
- [Phase 0.2 — Full Tool Suite](#phase-02--full-tool-suite)
- [Phase 0.3 — Edit Engine & Git Safety](#phase-03--edit-engine--git-safety)
- [Phase 0.4 — Context Intelligence](#phase-04--context-intelligence)
- [Phase 0.5 — Experience Polish](#phase-05--experience-polish)
- [Appendix: Key Algorithms](#appendix-key-algorithms)

---

## Overview

### Goal
构建一个命令行代码 Agent 工具（类似 Claude Code / Aider），支持：
- 通过自然语言与 LLM 交互来读取、编辑、搜索代码
- Agent Loop 自动决策工具调用
- 安全的命令执行沙箱
- 流式渲染 + 优秀的终端交互体验

### Architecture: 7-Layer Model
```
Layer 7: CLI Interactive Shell (REPL)
Layer 6: Conversation Manager (message history, context trimming, token budget)
Layer 5: Agent Loop (think → tool_call → observe → loop)
Layer 4: Tool Registry (file_edit, shell_exec, search, etc.)
Layer 3: Code Edit Engine (search-replace / diff)
Layer 2: LLM Provider Abstraction (multi-model, streaming, retry)
Layer 1: Security / Sandbox (command whitelist, file permissions, confirmation)
```

### Tech Stack
| Category | Choice |
|----------|--------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript 5.x (strict) |
| Build | tsup |
| LLM Primary | Anthropic SDK (@anthropic-ai/sdk) |
| LLM Secondary | OpenAI SDK (openai) |
| Token Counting | js-tiktoken (cl100k_base) ⚠️ REVISED |
| Code Parsing | web-tree-sitter (Phase 0.4) |
| Testing | vitest |
| Package Manager | pnpm |

### Implementation Priority
**最快到达 E2E Demo** → Phase 0.0 + 0.1 是关键路径，目标是 Phase 0.1 结束后即可 `npx rookie-code` 启动并完成一次完整的 "读取文件 → LLM 分析 → 编辑文件" 循环。

---

## Phase 0.0 — Project Scaffolding

### Step 0.0.1: Initialize pnpm + TypeScript + ESM Project

**What:** 初始化项目骨架，配置 pnpm、TypeScript、ESM、tsup 构建。

**Files to create:**
```
package.json
tsconfig.json
tsup.config.ts
.gitignore
.npmrc
src/index.ts          # 最小入口: console.log("rookie-code")
```

**Detailed Actions:**

1. **package.json** — 核心配置:
   ```json
   {
     "name": "rookie-code",
     "version": "0.1.0",
     "type": "module",
     "bin": { "rookie-code": "./dist/index.js" },
     "scripts": {
       "build": "tsup",
       "dev": "tsup --watch",
       "start": "node dist/index.js",
       "test": "vitest",
       "lint": "tsc --noEmit"
     },
     "engines": { "node": ">=20.0.0" }
   }
   ```

2. **tsconfig.json** — Strict ESM:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "outDir": "dist",
       "rootDir": "src",
       "declaration": true,
       "sourceMap": true,
       "resolveJsonModule": true,
       "forceConsistentCasingInFileNames": true,
       "noUncheckedIndexedAccess": true,
       "noUnusedLocals": true,
       "noUnusedParameters": true
     },
     "include": ["src"],
     "exclude": ["node_modules", "dist"]
   }
   ```

3. **tsup.config.ts**:
   ```typescript
   import { defineConfig } from 'tsup';
   export default defineConfig({
     entry: ['src/index.ts'],
     format: ['esm'],
     target: 'node20',
     dts: true,
     sourcemap: true,
     clean: true,
     banner: { js: '#!/usr/bin/env node' },
   });
   ```

4. **src/index.ts** — 最小入口:
   ```typescript
   console.log('rookie-code v0.1.0');
   ```

5. **.gitignore**:
   ```
   node_modules/
   dist/
   .env
   .env.local
   *.log
   log/
   ```

**Dependencies to install:**
```bash
pnpm add -D typescript tsup vitest @types/node
```

**Acceptance Criteria:**
- [ ] `pnpm build` 成功，生成 `dist/index.js`
- [ ] `node dist/index.js` 输出 "rookie-code v0.1.0"
- [ ] `pnpm lint` (tsc --noEmit) 通过零错误
- [ ] `chmod +x dist/index.js && ./dist/index.js` 可直接运行（shebang 生效）

**Dependencies:** None (first step)

---

### Step 0.0.2: Create Directory Structure + Utility Foundations

**What:** 创建完整的 `src/` 目录骨架，以及基础工具模块（logger、token counter、types）。

**Files to create:**
```
src/types.ts              # 全局类型定义
src/utils/logger.ts       # 日志工具 (支持 verbose/quiet 模式)
src/utils/tokens.ts       # Token 计数 (tiktoken-lite 或近似算法)
src/utils/truncate.ts     # 智能截断
src/config/defaults.ts    # 默认配置常量
src/config/loader.ts      # 配置加载器 (stub, 后续完善)
```

**Detailed Actions:**

1. **src/types.ts** — 核心类型:
   ```typescript
   // --- LLM Types ---
   export interface Message {
     role: 'user' | 'assistant' | 'system';
     content: string | ContentBlock[];
   }

   // ⚠️ REVISED: Use discriminated union instead of single interface with optional fields
   export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

   export interface TextBlock {
     type: 'text';
     text: string;
   }

   export interface ToolUseBlock {
     type: 'tool_use';
     id: string;
     name: string;
     input: Record<string, unknown>;
   }

   export interface ToolResultBlock {
     type: 'tool_result';
     tool_use_id: string;
     content: string;
     is_error: boolean;
   }

   // --- Tool Types ---
   export interface ToolDefinition {
     name: string;
     description: string;
     input_schema: Record<string, unknown>;  // JSON Schema
   }

   export interface ToolCall {
     id: string;
     name: string;
     input: Record<string, unknown>;
   }

   export interface ToolResult {
     tool_use_id: string;
     content: string;
     is_error: boolean;
   }

   // --- Config Types ---
   export interface Config {
     llm: {
       provider: 'anthropic' | 'openai';
       model: string;
       apiKey: string;
       maxTokens: number;
       temperature: number;
     };
     agent: {
       maxIterations: number;
       tokenBudget: number;
     };
     security: {
       allowedCommands: string[];
       blockedPaths: string[];
       requireConfirmation: boolean;
     };
   }

   // --- Agent Types ---
   export type AgentState = 'thinking' | 'tool_calling' | 'observing' | 'done' | 'error';

   export interface AgentEvent {
     type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
     data: unknown;
   }
   ```

2. **src/utils/logger.ts** — 最小日志:
   ```typescript
   // 支持 verbose/normal/quiet 三个级别
   // 使用 chalk 着色 (dependency: chalk)
   // 方法: info(), warn(), error(), debug(), tool()
   ```

3. **src/utils/tokens.ts** — ⚠️ REVISED: Token 精确计数 (使用 js-tiktoken):
   ```typescript
   // 使用 js-tiktoken 的 cl100k_base 编码进行精确 token 计数
   // 替代原先的 "~4 chars per token" 近似算法
   import { encodingForModel } from 'js-tiktoken';
   const enc = encodingForModel('cl100k_base');

   export function countTokens(text: string): number {
     return enc.encode(text).length;
   }
   export function estimateTokens(text: string): number {
     return countTokens(text);
   }
   export function isWithinBudget(messages: Message[], budget: number): boolean;
   ```

4. **src/config/defaults.ts** — 默认值:
   ```typescript
   export const DEFAULT_CONFIG: Config = {
     llm: {
       provider: 'anthropic',
       model: 'claude-sonnet-4-20250514',
       apiKey: '',  // from env
       maxTokens: 4096,
       temperature: 0,
     },
     agent: {
       maxIterations: 30,
       tokenBudget: 100_000,
     },
     security: {
       allowedCommands: ['cat', 'ls', 'find', 'grep', 'rg', 'git', 'node', 'npm', 'pnpm', 'npx'],
       blockedPaths: ['/etc', '/usr', '/System', '~/.ssh'],  // ⚠️ REVISED: 实现时用 os.homedir() + '/.ssh'
       requireConfirmation: true,
     },
   };
   ```

**Dependencies to install:**
```bash
pnpm add chalk js-tiktoken
```

**Acceptance Criteria:**
- [ ] `pnpm lint` 通过 — 所有类型文件无错误
- [ ] `import { DEFAULT_CONFIG } from './config/defaults.js'` 可正常导入
- [ ] logger 输出 info/warn/error 各有颜色区分
- [ ] ⚠️ REVISED: `ContentBlock` 使用 discriminated union，TypeScript 可在 switch(block.type) 中正确窄化类型
- [ ] ⚠️ REVISED: `countTokens("hello world")` 返回精确 token 数（与 OpenAI tokenizer 结果一致），误差率 < 1%
- [ ] ⚠️ REVISED: `estimateTokens` 对中英文混合文本的准确度验证 (对比 tiktoken Python 版结果)

**Dependencies:** Step 0.0.1

---

## Phase 0.1 — Minimal Agent Loop (E2E Demo)

> **目标**: Phase 0.1 结束后，用户可以启动 REPL，输入自然语言指令，Agent 能调用 `read_file` 读取文件，调用 `edit_file` 编辑文件，并流式输出 LLM 回复。

### Step 0.1.1: LLM Provider — Anthropic Implementation

**What:** 实现 LLM Provider 抽象层和 Anthropic 具体实现（含流式输出）。

**Files to create:**
```
src/llm/provider.ts       # Provider 接口定义
src/llm/anthropic.ts       # Anthropic 实现
src/llm/errors.ts          # LLM 错误处理
```

**Detailed Actions:**

1. **src/llm/provider.ts** — Provider 接口:
   ```typescript
   import { Message, ToolDefinition, ContentBlock } from '../types.js';

   export interface StreamEvent {
     type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end' | 'error';
     // text_delta
     text?: string;
     // tool_use
     toolCall?: { id: string; name: string; input: Record<string, unknown> };
     // message_end
     stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
     usage?: { inputTokens: number; outputTokens: number };
   }

   export interface LLMProvider {
     /** Non-streaming completion */
     complete(params: {
       system: string;
       messages: Message[];
       tools?: ToolDefinition[];
       maxTokens?: number;
       signal?: AbortSignal;  // ⚠️ REVISED: AbortSignal support
     }): Promise<{ content: ContentBlock[]; stopReason: string; usage: { inputTokens: number; outputTokens: number } }>;

     /** Streaming completion — returns AsyncIterable of events */
     stream(params: {
       system: string;
       messages: Message[];
       tools?: ToolDefinition[];
       maxTokens?: number;
       signal?: AbortSignal;  // ⚠️ REVISED: AbortSignal support
     }): AsyncIterable<StreamEvent>;
   }
   ```

2. **src/llm/anthropic.ts** — Anthropic 实现:
   - 使用 `@anthropic-ai/sdk`
   - `complete()`: 使用 `client.messages.create()` 非流式
   - `stream()`: 使用 `client.messages.stream()` 返回 SSE 事件
   - 错误处理: rate limit → 指数退避重试 (最多 3 次), auth error → 明确提示, network error → 重试
   - **关键**: 流式响应中 tool_use 块的增量 JSON 解析（Anthropic 以 `input_json_delta` 方式返回工具参数）

3. **src/llm/errors.ts** — 错误封装:
   ```typescript
   export class LLMError extends Error {
     constructor(
       message: string,
       public code: 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'INVALID_REQUEST' | 'UNKNOWN',
       public retryable: boolean,
       public cause?: Error,
     ) { super(message); }
   }
   ```

**Dependencies to install:**
```bash
pnpm add @anthropic-ai/sdk
```

**Acceptance Criteria:**
- [ ] 单元测试: mock Anthropic SDK，验证 `complete()` 返回正确结构
- [ ] 单元测试: mock 流式响应，验证 `stream()` yield 正确的 StreamEvent 序列
- [ ] 集成烟测 (手动): 设置 `ANTHROPIC_API_KEY` env，发送 "Hello" 获得回复
- [ ] 错误场景: 无 API key → 抛出 `LLMError { code: 'AUTH' }`

**Test file:** `src/llm/__tests__/anthropic.test.ts`

**Dependencies:** Step 0.0.2

---

### Step 0.1.2: Tool Registry + read_file / edit_file Tools

**What:** 实现工具注册中心和前两个核心工具。

**Files to create:**
```
src/tools/registry.ts       # Tool 注册与查找
src/tools/base.ts           # Tool 基类/接口
src/tools/read-file.ts      # 读取文件工具
src/tools/edit-file.ts      # 编辑文件工具 (基础版 search-replace)
src/tools/write-file.ts     # 写入新文件工具
```

**Detailed Actions:**

1. **src/tools/base.ts** — Tool 接口:
   ```typescript
   import { ToolDefinition, ToolResult } from '../types.js';

   export interface Tool {
     definition: ToolDefinition;
     execute(input: Record<string, unknown>): Promise<ToolResult>;
   }
   ```

2. **src/tools/registry.ts** — 注册中心:
   ```typescript
   export class ToolRegistry {
     private tools = new Map<string, Tool>();

     register(tool: Tool): void;
     get(name: string): Tool | undefined;
     getAll(): Tool[];
     getDefinitions(): ToolDefinition[];  // 给 LLM 的 tools 参数
   }
   ```

3. **src/tools/read-file.ts** — 读取文件:
   - **Tool Name**: `read_file`
   - **Input**: `{ path: string, offset?: number, limit?: number }`
   - **Behavior**:
     - 路径安全检查 (不能越出 working directory)
     - 读取文件内容，附带行号 (格式: `  1 | line content`)
     - 大文件自动截断 (默认 2000 行)，提示用户使用 offset/limit
     - 二进制文件检测 → 返回 "(binary file, N bytes)"
   - **Output**: 文件内容字符串 (含行号)

4. **src/tools/edit-file.ts** — 编辑文件 (基础版):
   - **Tool Name**: `edit_file`
   - **Input**: `{ path: string, old_string: string, new_string: string }`
   - **Behavior**:
     - `old_string` 为空 + 文件不存在 → 创建新文件
     - `old_string` 不为空 → 必须在文件中找到**精确匹配**（Phase 0.1 不做模糊匹配）
     - 匹配不唯一 → 返回错误，要求更多上下文
     - 成功编辑后返回 diff 预览
   - **MUST NOT**: 静默覆盖不匹配的内容

5. **src/tools/write-file.ts** — 写入新文件:
   - **Tool Name**: `write_file`
   - **Input**: `{ path: string, content: string }`
   - **Behavior**: 创建目录（如需）→ 写入文件
   - 如果文件已存在 → 返回错误，提示使用 `edit_file`

**Acceptance Criteria:**
- [ ] `read_file` 测试: 读取已知文件 → 返回内容含行号
- [ ] `read_file` 测试: 路径穿越 (`../../etc/passwd`) → 返回 is_error
- [ ] `edit_file` 测试: 精确匹配替换 → 文件内容正确更新
- [ ] `edit_file` 测试: old_string 未找到 → 返回 is_error + 提示
- [ ] `edit_file` 测试: old_string 匹配多处 → 返回 is_error + 提示
- [ ] `write_file` 测试: 新建文件成功，已存在文件报错
- [ ] `ToolRegistry` 测试: 注册+查找+getDefinitions 完整流程

**Test file:** `src/tools/__tests__/registry.test.ts`, `src/tools/__tests__/read-file.test.ts`, `src/tools/__tests__/edit-file.test.ts`

**Dependencies:** Step 0.0.2

---

### Step 0.1.3: Core Agent Loop

**What:** 实现 think → tool_call → observe 核心循环。这是整个系统的心脏。

**Files to create:**
```
src/agent/loop.ts           # 核心 Agent 循环
src/agent/system-prompt.ts  # 系统 Prompt 模板
```

**Detailed Actions:**

1. **src/agent/loop.ts** — 核心循环:
   ```typescript
   export class AgentLoop {
     constructor(
       private provider: LLMProvider,
       private tools: ToolRegistry,
       private options: { maxIterations: number; tokenBudget?: number; onEvent?: (event: AgentEvent) => void },
     ) {}

     // ⚠️ REVISED: Add signal parameter for AbortSignal support
     async run(userMessage: string, history: Message[], signal?: AbortSignal): Promise<Message[]> {
       // 1. 构建 messages: [...history, { role: 'user', content: userMessage }]
       // 2. Loop:
       //    a. 调用 LLM (stream)
       //    b. 收集完整响应
       //    c. 发送 AgentEvent('thinking', text) 或 AgentEvent('tool_call', toolCall)
       //    d. 如果 stopReason === 'end_turn' → 完成，返回
       //    e. 如果 stopReason === 'tool_use':
       //       - 从响应中提取所有 tool_use blocks
       //       - 对每个 tool_use: 查找 tool → execute → 收集 ToolResult
       //       - 发送 AgentEvent('tool_result', result)
       //       - 将 assistant message + tool results 追加到 messages
       //       - iteration++ → 如果 >= maxIterations → 强制终止
       //       - 继续循环
     }
   }
   ```

   **关键设计决策:**
   - 流式输出: 在 loop 内部消费 `provider.stream()`，边收到 text_delta 边通过 `onEvent` 回调给 REPL
   - 工具调用: 等待完整的 tool_use block（tool name + input JSON 完整）再执行
   - 并行工具调用: Anthropic 可能在一次回复中返回多个 tool_use blocks → **串行执行**（V1 简化）
   - Max iteration guard: 超过 `maxIterations` → 追加 system message "You've reached the maximum number of iterations" → 最后一次 LLM 调用不带 tools

   **⚠️ REVISED: LLM Invalid Tool Call 防御性处理:**
   在 Agent Loop 执行工具调用时，必须处理以下三种异常情况：
   ```typescript
   // 在 tool_use block 处理逻辑中:
   function executeToolCall(toolUseBlock: ToolUseBlock, registry: ToolRegistry): ToolResult {
     // 1. Malformed JSON in tool_use input
     //    如果 LLM 返回的 input JSON 解析失败:
     //    → return { tool_use_id, is_error: true, content: "Invalid JSON in tool arguments: <parse error>" }

     // 2. Unknown tool name
     const tool = registry.get(toolUseBlock.name);
     if (!tool) {
       const available = registry.getAll().map(t => t.definition.name).join(', ');
       return { tool_use_id: toolUseBlock.id, is_error: true,
         content: `Unknown tool: "${toolUseBlock.name}". Available tools: [${available}]` };
     }

     // 3. Missing required parameters (validate against input_schema)
     const missing = validateRequiredParams(tool.definition.input_schema, toolUseBlock.input);
     if (missing.length > 0) {
       return { tool_use_id: toolUseBlock.id, is_error: true,
         content: `Missing required parameter(s): ${missing.join(', ')}` };
     }

     // 4. Normal execution
     return tool.execute(toolUseBlock.input);
   }
   ```
   这些错误 ToolResult 会被回传给 LLM，让它有机会自我修正。

   **⚠️ REVISED: Token Budget Safety Valve (NON-BLOCKING #10):**
   在每次 LLM 调用前，执行简单的 token 检查：
   ```typescript
   // 在 loop 的每次迭代开头:
   const currentTokens = estimateTokens(JSON.stringify(messages));
   if (currentTokens > options.tokenBudget * 0.9) {
     // 强制终止循环，返回已有结果 + 警告
     messages.push({ role: 'assistant', content: '[Token budget nearly exhausted, stopping.]' });
     break;
   }
   ```

2. **src/agent/system-prompt.ts** — 系统 Prompt:
   ```typescript
   export function buildSystemPrompt(params: {
     workingDirectory: string;
     availableTools: string[];  // tool names
   }): string {
     // 参考 Claude Code 的 system prompt 设计:
     // - 角色定义: "You are a coding assistant..."
     // - 工作目录上下文
     // - Tool 使用指南 (何时用哪个 tool)
     // - 编辑规范 (search-replace 格式要求)
     // - 安全规范
   }
   ```

**Acceptance Criteria:**
- [ ] 单元测试: mock LLM 返回纯文本 → AgentLoop 返回单条 assistant message
- [ ] 单元测试: mock LLM 返回 tool_use → AgentLoop 执行工具 → 继续循环 → LLM 返回最终文本
- [ ] 单元测试: mock LLM 不断返回 tool_use → 达到 maxIterations → 循环终止
- [ ] 单元测试: 工具执行出错 → ToolResult.is_error=true → LLM 收到错误信息并尝试修正
- [ ] onEvent 回调被正确触发 (thinking, tool_call, tool_result, response)
- [ ] ⚠️ REVISED: 单元测试: mock LLM 返回 malformed JSON in tool_use input → 返回 is_error ToolResult 含 "Invalid JSON" 消息 → LLM 继续循环
- [ ] ⚠️ REVISED: 单元测试: mock LLM 返回 unknown tool name → 返回 is_error ToolResult 含 "Unknown tool: xxx. Available: [...]" → LLM 自我修正
- [ ] ⚠️ REVISED: 单元测试: mock LLM 返回 tool_use 缺少 required param → 返回 is_error ToolResult 含 "Missing required param: path" → LLM 自我修正
- [ ] ⚠️ REVISED: 单元测试: messages token 超出 90% budget → 循环强制终止

**Test file:** `src/agent/__tests__/loop.test.ts`

**Dependencies:** Step 0.1.1, Step 0.1.2

---

### Step 0.1.4: Minimal REPL Shell

**What:** 实现基于 Node.js readline 的交互式 REPL，支持流式输出。

**Files to create:**
```
src/cli/repl.ts             # REPL 主循环
src/cli/renderer.ts         # 流式渲染 (Markdown → terminal)
src/index.ts                # 更新入口，集成所有组件
```

**Detailed Actions:**

1. **src/cli/repl.ts** — REPL:
   ```typescript
   export class REPL {
     constructor(
       private agentLoop: AgentLoop,
       private renderer: Renderer,
     ) {}

     async start(): Promise<void> {
       // 1. 打印 welcome message
       // 2. readline.createInterface()
       // 3. Loop:
       //    a. prompt ">" 等待用户输入
       //    b. 空行 → 跳过
       //    c. /exit, /quit → 退出
       //    d. 否则 → agentLoop.run(input, history)
       //       - 通过 onEvent 回调流式渲染
       //    e. 更新 history
     }
   }
   ```

   **REPL 特性 (V1 最小集):**
   - 多行输入: 以 `\` 结尾时继续输入下一行
   - ⚠️ REVISED: 中断: Ctrl+C → REPL 创建 AbortController，将 signal 传递给 `agentLoop.run(input, history, signal)`，Ctrl+C 时调用 `controller.abort()`
   - ⚠️ REVISED: 每次用户输入时新建 AbortController，确保 signal 贯穿 AgentLoop → LLMProvider.stream() 完整调用链
   - 退出: Ctrl+D 或 `/exit`
   - 历史: 基础 readline 历史（上下箭头）

2. **src/cli/renderer.ts** — 最小渲染器:
   ```typescript
   export class Renderer {
     /** 流式渲染 text delta (直接 process.stdout.write) */
     renderTextDelta(text: string): void;

     /** 渲染工具调用 (tool name + input summary) */
     renderToolCall(name: string, input: Record<string, unknown>): void;

     /** 渲染工具结果 (truncated preview) */
     renderToolResult(result: ToolResult): void;

     /** 渲染错误 */
     renderError(error: Error): void;
   }
   ```

   **V1 渲染策略:**
   - text delta: 直接 `process.stdout.write()` (无 Markdown 渲染)
   - tool call: `chalk.blue('⚡ Tool: read_file') + chalk.gray(JSON.stringify(input))`
   - tool result: 截断到 5 行预览

3. **src/index.ts** — 集成入口:
   ```typescript
   #!/usr/bin/env node
   import { AnthropicProvider } from './llm/anthropic.js';
   import { ToolRegistry } from './tools/registry.js';
   import { ReadFileTool } from './tools/read-file.js';
   import { EditFileTool } from './tools/edit-file.js';
   import { WriteFileTool } from './tools/write-file.js';
   import { AgentLoop } from './agent/loop.js';
   import { REPL } from './cli/repl.js';

   async function main() {
     const apiKey = process.env.ANTHROPIC_API_KEY;
     if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

     const provider = new AnthropicProvider(apiKey);
     const tools = new ToolRegistry();
     tools.register(new ReadFileTool(process.cwd()));
     tools.register(new EditFileTool(process.cwd()));
     tools.register(new WriteFileTool(process.cwd()));

     const agent = new AgentLoop(provider, tools, { maxIterations: 30 });
     const repl = new REPL(agent);
     await repl.start();
   }

   main().catch(console.error);
   ```

**Acceptance Criteria:**
- [ ] `pnpm build && ANTHROPIC_API_KEY=xxx node dist/index.js` → 进入 REPL
- [ ] 输入 "Hello" → LLM 回复流式显示
- [ ] 输入 "Read the file package.json" → Agent 调用 read_file → 显示文件内容 → LLM 总结
- [ ] 输入 "Add a description field to package.json" → Agent 调用 edit_file → 文件被修改
- [ ] Ctrl+C → 中断当前请求（不退出）
- [ ] `/exit` → 退出

**Test file:** ⚠️ REVISED: `src/agent/__tests__/e2e-agent.test.ts` — Mock-based 集成测试:
```typescript
// Mock-based E2E integration test for Phase 0.1
// 不依赖真实 LLM API，使用 mock LLM provider
describe('Agent E2E (mock)', () => {
  it('should complete a read → analyze → edit cycle', async () => {
    // 1. 创建 mock LLM provider，按顺序返回:
    //    - 第1次调用: tool_use(read_file, { path: "test.ts" })
    //    - 第2次调用: tool_use(edit_file, { path: "test.ts", old_string: "...", new_string: "..." })
    //    - 第3次调用: text("Done! I've updated the file.")
    // 2. 创建真实 ToolRegistry + 真实 read_file/edit_file (操作 temp dir)
    // 3. 创建 AgentLoop，运行 "Refactor test.ts"
    // 4. 验证: tool call 序列正确 (read_file → edit_file)
    // 5. 验证: 文件内容被正确修改
    // 6. 验证: 最终 assistant message 包含完成信息
  });

  it('should handle tool errors gracefully in the loop', async () => {
    // Mock LLM 返回 tool_use 读取不存在的文件
    // → read_file 返回 is_error
    // → Mock LLM 收到错误后返回修正的 tool_use
    // → 验证循环正确处理错误恢复
  });
});
```

**Dependencies:** Step 0.1.3

---

### 🏁 Phase 0.1 Milestone Verification

```bash
# 构建
pnpm build

# 启动 (需要 ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-ant-xxx node dist/index.js

# 测试对话:
> Read the file package.json and tell me about this project
# 期望: Agent 调用 read_file, 读取 package.json, LLM 描述项目

> Create a new file src/hello.ts with a function that prints "Hello World"
# 期望: Agent 调用 write_file, 创建文件

> Add a parameter "name" to the hello function in src/hello.ts
# 期望: Agent 调用 read_file 读取, 然后 edit_file 修改

# 全量测试
pnpm test
```

---

## Phase 0.2 — Full Tool Suite

### Step 0.2.1: shell_exec Tool with Security Layer

**What:** 实现命令执行工具，包含安全确认机制。

**Files to create:**
```
src/tools/shell-exec.ts     # 命令执行工具
src/cli/confirm.ts          # 用户确认交互
src/security/sandbox.ts     # 安全策略检查
```

**Detailed Actions:**

1. **src/tools/shell-exec.ts** — shell_exec:
   - **Tool Name**: `shell_exec`
   - **Input**: `{ command: string, timeout?: number }`
   - **Behavior**:
     - 解析命令 → 提取可执行文件名
     - 检查 allowedCommands 白名单
     - 不在白名单 → 调用 `confirm.ts` 请求用户确认
     - ⚠️ REVISED: 使用 `child_process.spawn(command, { shell: true })` 而非 `execFile`
       - 原因: LLM 生成的是完整 shell 命令字符串（含管道、重定向等），`execFile` 不支持
       - 安全性改为依赖 **输入验证** 而非 `execFile` 的参数隔离:
         1. 白名单检查: 从命令字符串中提取首个可执行文件名，匹配 allowedCommands
         2. 危险模式检测: 拒绝 `$(...)`, `` `...` ``, `; rm`, `&& rm` 等明显危险模式
         3. 非白名单命令必须经过用户确认
     - timeout 默认 120s (⚠️ REVISED: 从 30s 增加到 120s, NON-BLOCKING #9)
     - 输出截断 (>100KB → 截断 + 提示)
     - ⚠️ REVISED (NON-BLOCKING #11): Tool Result 大小限制 — 超过 100KB 的输出按以下策略截断:
       - 保留前 50KB + 末尾 10KB
       - 中间插入 `[... truncated ${N} bytes ...]`
     - stderr 合并到输出

2. **src/security/sandbox.ts** — 安全检查:
   ```typescript
   export class Sandbox {
     constructor(private config: Config['security']) {}

     /** 检查命令是否被允许 */
     checkCommand(command: string): 'allowed' | 'needs_confirmation' | 'blocked';

     /** 检查文件路径是否在允许范围内 */
     // ⚠️ REVISED (NON-BLOCKING #8): 添加 symlink 解析
     checkPath(path: string, workingDir: string): boolean;
     // 实现: 先 fs.realpathSync(path) 解析 symlink，再做边界检查
     // 防止 symlink 绕过路径限制
   }
   ```

   **⚠️ REVISED (NON-BLOCKING #8): 额外安全增强:**
   - **Symlink 解析**: 所有路径检查前先调用 `fs.realpath()` 解析软链接
   - **环境变量清洗**: shell_exec 执行时，剥离敏感环境变量 (ANTHROPIC_API_KEY, OPENAI_API_KEY 等)，防止泄露
   - **`~/.ssh` 路径修复**: 使用 `os.homedir()` 替代硬编码 `~`，即 `path.join(os.homedir(), '.ssh')`
   - **网络风险提示**: 白名单中的 `node`, `npx` 可发起网络请求，在安全文档中注明此风险

3. **src/cli/confirm.ts** — 确认交互:
   ```typescript
   export async function confirm(message: string): Promise<boolean>;
   // 显示: "⚠️ Allow: rm -rf node_modules? [y/N]"
   // 默认 N (安全优先)
   ```

**Acceptance Criteria:**
- [ ] 测试: `shell_exec({ command: "ls -la" })` → 返回目录列表
- [ ] 测试: `shell_exec({ command: "rm -rf /" })` → 触发确认 → 用户拒绝 → 返回 is_error
- [ ] 测试: 命令超时 → 返回 timeout 错误
- [ ] 测试: 路径安全检查 → 越界路径被拒绝

**Dependencies:** Step 0.1.4

---

### Step 0.2.2: search_code + list_files Tools

**What:** 实现代码搜索和文件列表工具。

**Files to create:**
```
src/tools/search-code.ts    # ripgrep 封装
src/tools/list-files.ts     # 文件列表 (glob)
```

**Detailed Actions:**

1. **src/tools/search-code.ts** — search_code:
   - **Tool Name**: `search_code`
   - **Input**: `{ pattern: string, path?: string, include?: string, maxResults?: number }`
   - **Behavior**:
     - 优先使用 `rg` (ripgrep)，不可用时 fallback 到 `grep -rn`
     - 尊重 `.gitignore`
     - 输出格式: `file:line:content`
     - 最多返回 50 个结果
   - ⚠️ REVISED: **实现**: 直接调用 `child_process.spawn('rg', [...args])` 内部实现
     - **不**通过 `shell_exec` 工具间接调用，避免触发用户确认 UI
     - 直接构造 rg 参数数组: `['--line-number', '--color=never', pattern, path]`
     - 这是一个只读操作，不需要安全确认

2. **src/tools/list-files.ts** — list_files:
   - **Tool Name**: `list_files`
   - **Input**: `{ path?: string, recursive?: boolean, pattern?: string }`
   - **Behavior**:
     - 使用 `fs.readdir` (recursive) 或 glob
     - 尊重 `.gitignore` (使用 `git ls-files` 如果在 git repo 中)
     - 大目录截断 (>500 entries)
     - 显示文件大小

**Acceptance Criteria:**
- [ ] `search_code({ pattern: "import" })` → 返回匹配结果
- [ ] `list_files({ recursive: true })` → 返回项目文件树
- [ ] 结果正确尊重 .gitignore

**Dependencies:** Step 0.2.1

---

### Step 0.2.3: Register All Tools + E2E Integration

**What:** 将所有工具注册到 Agent Loop，更新 system prompt。

**Files to modify:**
```
src/index.ts                # 注册新工具
src/agent/system-prompt.ts  # 更新 prompt, 加入新工具指南
```

**Acceptance Criteria:**
- [ ] E2E: "Find all TypeScript files in this project" → Agent 使用 list_files
- [ ] E2E: "Search for the word 'import' in all files" → Agent 使用 search_code
- [ ] E2E: "Run the tests" → Agent 使用 shell_exec 执行 pnpm test
- [ ] E2E: "Install lodash" → 触发安全确认

**Dependencies:** Step 0.2.2

---

### 🏁 Phase 0.2 Milestone Verification

```bash
pnpm test  # 所有单元测试通过

# E2E 场景: 让 Agent 自行完成一个开发任务
> Create a new utility function in src/utils/math.ts that computes fibonacci numbers, then write a test for it, then run the test
# 期望: Agent 完成 write_file → write_file (test) → shell_exec (pnpm test) 完整流程
```

---

## Phase 0.3 — Edit Engine & Git Safety

### Step 0.3.1: Search-Replace Engine with Fuzzy Matching

**What:** 实现高质量的 search-replace 编辑引擎，支持模糊匹配。

**Files to create:**
```
src/editor/search-replace.ts  # 核心搜索替换算法
src/editor/fuzzy-match.ts     # 模糊匹配 (处理 LLM 输出的微小差异)
src/editor/diff-display.ts    # Diff 显示
```

**Detailed Actions:**

1. **src/editor/search-replace.ts** — 核心算法:
   ```typescript
   export interface SearchReplaceResult {
     success: boolean;
     newContent?: string;
     matchCount: number;
     matchPosition?: { line: number; column: number };
     error?: string;
     usedFuzzyMatch: boolean;
   }

   export function searchReplace(params: {
     content: string;
     oldString: string;
     newString: string;
     fuzzyThreshold?: number;  // 0-1, default 0.95
   }): SearchReplaceResult;
   ```

   **算法流程:**
   1. 精确匹配 → 如果唯一命中，直接替换
   2. 精确匹配多个 → 返回错误 + 所有匹配位置
   3. 精确匹配零个 → 尝试模糊匹配
   4. 模糊匹配: 忽略空白差异 → 忽略缩进差异 → Levenshtein 距离
   5. 模糊匹配命中 → 替换 + 标记 `usedFuzzyMatch`

2. **src/editor/fuzzy-match.ts** — 模糊匹配策略:
   ```typescript
   export function fuzzyFind(content: string, target: string, threshold: number): {
     found: boolean;
     position: number;
     matchedText: string;
     similarity: number;
   };
   ```

   **匹配策略 (优先级递减):**
   1. 忽略行尾空白
   2. 忽略缩进差异（tabs vs spaces, 不同缩进宽度）
   3. 忽略空行差异
   4. 逐行 Levenshtein + 滑动窗口

   **⚠️ REVISED: Hallucination Guards (防幻觉保护):**
   模糊匹配必须通过以下所有 guard 才可应用:
   ```typescript
   function validateFuzzyMatch(matchedText: string, target: string): { valid: boolean; reason?: string } {
     const matchedLines = matchedText.split('\n').filter(l => l.trim());
     const targetLines = target.split('\n').filter(l => l.trim());

     // Guard 1: Line-count guard — 行数差异不得超过 2
     if (Math.abs(matchedLines.length - targetLines.length) > 2) {
       return { valid: false, reason: `Line count mismatch: matched ${matchedLines.length} vs target ${targetLines.length}` };
     }

     // Guard 2: First/last line anchor — 首尾非空行必须近似精确匹配 (similarity > 0.9)
     const firstMatch = similarity(matchedLines[0], targetLines[0]);
     const lastMatch = similarity(matchedLines.at(-1)!, targetLines.at(-1)!);
     if (firstMatch < 0.9 || lastMatch < 0.9) {
       return { valid: false, reason: 'First or last line anchor mismatch' };
     }

     return { valid: true };
   }
   ```

   **⚠️ REVISED: 模糊匹配需用户确认:**
   当模糊匹配成功且通过 guard 验证时，仍需通过 AgentEvent 通知 REPL 层，请求用户确认:
   - 显示 diff 预览: 原始匹配文本 vs target 文本
   - 提示: "Fuzzy match found (similarity: 0.96). Apply? [Y/n]"
   - 用户拒绝 → 返回 ToolResult { is_error: true, content: "User rejected fuzzy match" }

3. **src/editor/diff-display.ts** — Diff 渲染:
   - 使用 `diff` npm 包生成 unified diff
   - 使用 chalk 着色: 绿色(+), 红色(-), 灰色(context)
   - 显示文件名 + 行号

**Dependencies to install:**
```bash
pnpm add diff
pnpm add -D @types/diff
```

**Acceptance Criteria:**
- [ ] 精确匹配: 唯一命中 → 替换成功
- [ ] 精确匹配: 多个命中 → 返回错误 + 所有位置
- [ ] 模糊匹配: LLM 漏了一个空格 → 仍然匹配成功
- [ ] 模糊匹配: LLM 的缩进不对 (tabs vs spaces) → 仍然匹配成功
- [ ] 模糊匹配: 完全不同的内容 → 不匹配，返回错误
- [ ] Diff 显示: 清晰的彩色 unified diff
- [ ] ⚠️ REVISED: Hallucination Guard — 行数差异 > 2 的模糊匹配被拒绝
- [ ] ⚠️ REVISED: Hallucination Guard — 首行或末行锚点不匹配时模糊匹配被拒绝
- [ ] ⚠️ REVISED: 模糊匹配触发用户确认流程，用户拒绝时返回 is_error

**Test file:** `src/editor/__tests__/search-replace.test.ts` (至少 15 个测试用例)

**Dependencies:** Step 0.1.2 (替换 edit-file 中的基础实现)

---

### Step 0.3.2: Git Operations + Checkpoint System

**What:** 实现 Git 操作封装和自动 checkpoint 机制。

**Files to create:**
```
src/repo/git.ts             # Git 操作封装
```

**Files to modify:**
```
src/agent/loop.ts           # Agent Loop 中集成 checkpoint
src/tools/edit-file.ts      # 编辑前创建 checkpoint
```

**Detailed Actions:**

1. **src/repo/git.ts** — Git 封装:
   ```typescript
   export class GitOperations {
     constructor(private workingDir: string) {}

     /** 检查是否在 git repo 中 */
     isGitRepo(): Promise<boolean>;

     /** 获取当前分支 */
     getCurrentBranch(): Promise<string>;

     /** 获取 git status */
     getStatus(): Promise<string>;

     /** 获取 diff (staged / unstaged / specific file) */
     getDiff(options?: { staged?: boolean; file?: string }): Promise<string>;

     /** 创建 checkpoint commit */
     createCheckpoint(message: string): Promise<string>;  // returns commit hash

     /** 回退到 checkpoint */
     revertToCheckpoint(commitHash: string): Promise<void>;

     /** 列出最近的 checkpoints */
     listCheckpoints(limit?: number): Promise<{ hash: string; message: string; date: string }[]>;
   }
   ```

   **Checkpoint 策略:**
   - 每次 edit_file 执行前，如果有未提交的变更 → 自动 `git stash` 或创建 checkpoint commit
   - Checkpoint commit message: `[rookie-code checkpoint] before edit: {file_path}`
   - 用户可通过 `/undo` 命令回退到最近的 checkpoint

**Acceptance Criteria:**
- [ ] `isGitRepo()` 在 git repo 中返回 true
- [ ] `createCheckpoint()` 创建 checkpoint commit
- [ ] `revertToCheckpoint()` 成功回退
- [ ] Agent Loop 中，edit_file 执行前自动创建 checkpoint

**Dependencies:** Step 0.1.3, Step 0.3.1

---

### Step 0.3.3: Upgrade edit_file to Use New Engine

**What:** 将 edit_file 工具升级为使用模糊匹配引擎 + diff 显示 + Git checkpoint。

**Files to modify:**
```
src/tools/edit-file.ts      # 集成 search-replace engine + git checkpoint
src/cli/renderer.ts         # 添加 diff 渲染
```

**Acceptance Criteria:**
- [ ] edit_file 使用模糊匹配引擎
- [ ] 编辑后显示彩色 diff
- [ ] 编辑前自动创建 git checkpoint
- [ ] E2E: LLM 产生的轻微格式差异 → 模糊匹配成功编辑

**Dependencies:** Step 0.3.1, Step 0.3.2

---

### 🏁 Phase 0.3 Milestone Verification

```bash
pnpm test  # 重点关注 editor/ 下的测试

# E2E 场景:
> Refactor the function X in src/Y.ts to use async/await instead of callbacks
# 期望: Agent 读取 → 理解 → edit_file (模糊匹配成功) → 显示 diff

# Checkpoint 验证:
> /undo
# 期望: 回退到编辑前的状态
```

---

## Phase 0.4 — Context Intelligence

### Step 0.4.1: Conversation History + Token Budget

**What:** 实现对话历史管理和 token 预算控制。

**Files to create:**
```
src/agent/conversation.ts   # 对话历史管理
src/agent/context.ts        # 上下文窗口管理
```

**Detailed Actions:**

1. **src/agent/conversation.ts** — 对话历史:
   ```typescript
   export class ConversationManager {
     private messages: Message[] = [];
     private summaries: string[] = [];

     /** 添加消息 */
     addMessage(message: Message): void;

     /** 获取当前消息列表 (可能经过压缩) */
     getMessages(tokenBudget: number): Message[];

     /** 清空历史 */
     clear(): void;

     /** 获取当前 token 用量估算 */
     estimateTokens(): number;
   }
   ```

2. **src/agent/context.ts** — 上下文窗口:
   ```typescript
   export class ContextManager {
     /** 滑动窗口策略: 保留 system + 最近 N 轮 + 摘要 */
     trimToFit(params: {
       messages: Message[];
       tokenBudget: number;
       preserveRecent: number;  // 保留最近 N 轮
     }): Message[];

     /** 生成历史摘要 (让 LLM 总结过去的对话) */
     summarize(messages: Message[], provider: LLMProvider): Promise<string>;
   }
   ```

   **滑动窗口算法:**
   1. 计算所有消息的 token 总量
   2. 如果超预算:
      a. 保留 system message
      b. 保留最近 `preserveRecent` 轮对话
      c. 将中间的旧消息压缩为摘要
      d. 摘要作为 system message 的附加段落

**Acceptance Criteria:**
- [ ] 100 轮对话后仍在 token 预算内
- [ ] 摘要保留了关键上下文 (手动验证)
- [ ] 最近对话完整保留，不被截断

**Dependencies:** Step 0.1.3

---

### Step 0.4.2: RepoMap (Tree-sitter)

**What:** 实现基于 tree-sitter 的代码仓库地图，帮助 LLM 了解项目结构。

**Files to create:**
```
src/repo/repomap.ts         # RepoMap 生成器
```

**Dependencies to install:**
```bash
pnpm add web-tree-sitter
# 需要下载 language .wasm 文件 (typescript, javascript, python, go, rust, etc.)
```

**Detailed Actions:**

1. **src/repo/repomap.ts**:
   ```typescript
   export class RepoMap {
     /** 生成仓库地图: 文件列表 + 每个文件的关键符号 (函数/类/接口) */
     async generate(rootDir: string, options?: {
       maxFiles?: number;
       languages?: string[];
     }): Promise<string>;  // 返回格式化的文本

     /** 为单个文件生成符号摘要 */
     async getFileSymbols(filePath: string): Promise<{
       functions: string[];
       classes: string[];
       interfaces: string[];
       exports: string[];
     }>;
   }
   ```

   **RepoMap 输出格式:**
   ```
   src/agent/loop.ts
   ├── class AgentLoop
   │   ├── constructor(provider, tools, options)
   │   └── async run(userMessage, history): Message[]
   src/tools/registry.ts
   ├── class ToolRegistry
   │   ├── register(tool): void
   │   └── getDefinitions(): ToolDefinition[]
   ```

   **策略:**
   - 首次对话时自动生成 RepoMap，作为 system prompt 的一部分
   - 大仓库 (>200 文件) → 只展示 top-level + 最近修改的文件
   - 缓存: 基于 git hash，文件没变就不重新解析

**Acceptance Criteria:**
- [ ] TypeScript 项目 → 正确提取 class, function, interface
- [ ] 输出 token 量可控 (<2000 tokens for a medium project)
- [ ] 大仓库不超时 (<5s for 500 files)

**Dependencies:** Step 0.0.2

---

### Step 0.4.3: Integrate Context Intelligence into Agent Loop

**What:** 将 ConversationManager、ContextManager、RepoMap 集成到 Agent Loop。

**Files to modify:**
```
src/agent/loop.ts           # 集成 conversation + context
src/agent/system-prompt.ts  # 加入 RepoMap
src/index.ts                # 初始化新组件
```

**Acceptance Criteria:**
- [ ] 长对话 (>20轮) 不会 token 溢出
- [ ] system prompt 包含 RepoMap
- [ ] 对话摘要在旧消息被裁剪时自动生成

**Dependencies:** Step 0.4.1, Step 0.4.2

---

### 🏁 Phase 0.4 Milestone Verification

```bash
pnpm test

# E2E: 长对话测试
# 进行 20+ 轮对话，验证不会因 token 超限而失败
# 验证早期对话的关键信息在摘要中被保留
```

---

## Phase 0.5 — Experience Polish

### Step 0.5.1: Streaming Markdown Rendering

**What:** 升级渲染器，支持流式 Markdown 渲染（代码块高亮、列表、标题等）。

**Files to modify:**
```
src/cli/renderer.ts         # 升级为 Markdown 渲染
```

**Dependencies to install:**
```bash
pnpm add marked marked-terminal
```

**Detailed Actions:**
- 流式 Markdown: 使用 buffer 策略，收集到完整的 block (段落/代码块/列表项) 后渲染
- 代码块: 检测语言 → 语法高亮 (可选: `cli-highlight` 包)
- 思考过程: 在可折叠区域显示（或灰色低亮度）
- Spinner: 等待 LLM 时显示加载动画

**Acceptance Criteria:**
- [ ] 代码块正确渲染 (缩进 + 高亮)
- [ ] 流式输出不闪烁
- [ ] 工具调用有清晰的视觉区分

**Dependencies:** Step 0.1.4

---

### Step 0.5.2: Slash Command System

**What:** 实现 `/command` 系统。

**Files to create:**
```
src/cli/commands.ts         # 命令注册 + 执行
```

**Commands to implement:**
| Command | Action |
|---------|--------|
| `/help` | 显示可用命令列表 |
| `/clear` | 清空对话历史 |
| `/undo` | 回退最近一次文件编辑 (git checkout) |
| `/diff` | 显示自 Agent 开始以来的所有变更 |
| `/status` | 显示 git status |
| `/model [name]` | 切换模型 |
| `/compact` | 手动触发对话压缩 |
| `/tokens` | 显示当前 token 用量 |
| `/exit` | 退出 |

**Acceptance Criteria:**
- [ ] 所有命令可用且行为正确
- [ ] `/help` 显示完整命令列表
- [ ] `/undo` 成功回退文件变更
- [ ] 未知命令 → 友好提示

**Dependencies:** Step 0.3.2 (for /undo), Step 0.4.1 (for /compact, /tokens)

---

### Step 0.5.3: Config System

**What:** 实现完整的配置系统（环境变量 + 配置文件 + CLI 参数）。

**Files to modify:**
```
src/config/loader.ts        # 完善配置加载
src/index.ts                # CLI 参数解析
```

**Config priority (高 → 低):**
1. CLI 参数 (`--model claude-sonnet-4-20250514`)
2. 环境变量 (`ANTHROPIC_API_KEY`)
3. 项目配置文件 (`.rookie-code.json` in project root)
4. 用户配置文件 (`~/.rookie-code/config.json`)
5. 默认值

**CLI 参数:**
```
rookie-code [options]
  --model, -m     LLM model name
  --provider, -p  LLM provider (anthropic/openai)
  --verbose, -v   Verbose logging
  --no-confirm    Skip confirmation prompts
  --max-tokens    Max tokens per response
```

**Acceptance Criteria:**
- [ ] `rookie-code --model gpt-4o --provider openai` → 使用 OpenAI
- [ ] `.rookie-code.json` 中的配置被正确加载
- [ ] CLI 参数覆盖配置文件

**Dependencies:** Step 0.0.2

---

### Step 0.5.4: OpenAI Provider Implementation

**What:** 实现 OpenAI LLM Provider。

**Files to create:**
```
src/llm/openai.ts           # OpenAI 实现
```

**Dependencies to install:**
```bash
pnpm add openai
```

**Detailed Actions:**
- 实现与 Anthropic 相同的 `LLMProvider` 接口
- OpenAI 的 tool_call 格式不同 (function calling)，需要转换
- 流式: 使用 OpenAI streaming API
- 注意: OpenAI 返回 tool_call 时，JSON 是增量的，需要拼接

**Acceptance Criteria:**
- [ ] `OPENAI_API_KEY=xxx rookie-code --provider openai` → 正常工作
- [ ] 工具调用在 OpenAI 模型下正常运行
- [ ] 流式输出正常

**Dependencies:** Step 0.1.1

---

### Step 0.5.5: Error Handling, Edge Cases, Polish

**What:** 全面的错误处理和边界情况修复。

**Areas to address:**
1. **网络断连**: LLM 调用中断 → 优雅恢复，不丢失对话历史
2. **大文件**: read_file 读取 100MB 文件 → 截断 + 警告
3. **二进制文件**: 检测并拒绝 edit_file 操作
4. **空目录**: list_files 在空目录 → 友好提示
5. **权限错误**: 无权限读写 → 清晰错误消息
6. **Ctrl+C**: 中断 LLM 调用但不中断 tool 执行
7. **Graceful shutdown**: 退出时确保文件操作完成

**Acceptance Criteria:**
- [ ] 所有已知边界情况有测试覆盖
- [ ] 无 unhandled promise rejection
- [ ] 无 uncaught exception crash

**Dependencies:** All previous steps

---

### 🏁 Phase 0.5 Milestone Verification

```bash
pnpm test  # 全量测试通过
pnpm build

# 完整 E2E 测试:
rookie-code --model claude-sonnet-4-20250514

> /help                    # 命令系统
> /tokens                  # Token 统计
> Read all TypeScript files and suggest improvements
> Implement the suggested changes
> /diff                    # 查看变更
> /undo                    # 撤销
> /compact                 # 压缩对话
> /exit
```

---

## Appendix: Key Algorithms

### A. Search-Replace Fuzzy Matching Algorithm

```
Input: content (file content), target (old_string), threshold (0.95)

1. EXACT MATCH:
   matches = findAll(content, target)
   if matches.length === 1 → return match
   if matches.length > 1 → return Error("multiple matches")

2. WHITESPACE-NORMALIZED MATCH:
   normalizedContent = collapseWhitespace(content)
   normalizedTarget = collapseWhitespace(target)
   matches = findAll(normalizedContent, normalizedTarget)
   if matches.length === 1 → map back to original → return

3. INDENT-AGNOSTIC MATCH:
   contentLines = content.split('\n').map(stripLeadingWhitespace)
   targetLines = target.split('\n').map(stripLeadingWhitespace)
   matches = slidingWindowMatch(contentLines, targetLines)
   if matches.length === 1 → return with original indentation preserved

4. LEVENSHTEIN SLIDING WINDOW:
   windowSize = target.split('\n').length
   for each window of windowSize lines in content:
     similarity = 1 - levenshtein(window, target) / max(window.length, target.length)
     if similarity >= threshold → candidate
   return best candidate if similarity >= threshold

5. ⚠️ REVISED: HALLUCINATION GUARDS (applied to fuzzy match candidates):
   a. LINE-COUNT GUARD: |candidate.lines - target.lines| <= 2
   b. ANCHOR GUARD: first non-empty line similarity >= 0.9
                     last non-empty line similarity >= 0.9
   c. If any guard fails → reject candidate, return "no match"
   d. If guards pass → prompt user confirmation before applying
```

### B. Token Budget Sliding Window

```
Input: messages[], tokenBudget, preserveRecent

1. Calculate totalTokens = sum(estimateTokens(msg) for msg in messages)
2. If totalTokens <= tokenBudget → return messages as-is

3. systemMsg = messages[0]  // always keep
4. recentMsgs = messages.slice(-preserveRecent * 2)  // keep recent N turns
5. middleMsgs = messages.slice(1, -preserveRecent * 2)

6. summary = await LLM.summarize(middleMsgs)
7. summaryMsg = { role: 'system', content: `Previous conversation summary:\n${summary}` }

8. return [systemMsg, summaryMsg, ...recentMsgs]
```

### C. Agent Loop State Machine

```
          ┌──────────────┐
          │              │
  User ──>│   THINKING   │──> stopReason='end_turn' ──> DONE ──> User
  Input   │   (LLM call) │
          │              │
          └──────┬───────┘
                 │
          stopReason='tool_use'
                 │
                 v
          ┌──────────────┐
          │ TOOL_CALLING  │──> Execute tools
          │              │──> Collect results
          └──────┬───────┘
                 │
                 v
          ┌──────────────┐
          │  OBSERVING    │──> Append results to messages
          │              │──> iteration++ check
          └──────┬───────┘
                 │
                 │ iteration < max
                 │
                 v
          ┌──────────────┐
          │   THINKING    │ (loop back)
          └──────────────┘
```

---

## Implementation Order Summary

```
Step 0.0.1  Project Scaffolding        ─┐
Step 0.0.2  Types + Utilities          ─┤ Week 1
                                        │
Step 0.1.1  Anthropic Provider         ─┤
Step 0.1.2  Tool Registry + R/W Tools  ─┤ Week 1-2
Step 0.1.3  Agent Loop                 ─┤
Step 0.1.4  REPL Shell                 ─┘ ← 🏁 E2E Demo
                                        
Step 0.2.1  shell_exec + Security      ─┐
Step 0.2.2  search_code + list_files   ─┤ Week 2-3
Step 0.2.3  Full Integration           ─┘ ← 🏁 Full Tools
                                        
Step 0.3.1  Fuzzy Search-Replace       ─┐
Step 0.3.2  Git Checkpoint             ─┤ Week 3-4
Step 0.3.3  Edit Engine Upgrade        ─┘ ← 🏁 Edit Engine
                                        
Step 0.4.1  Conversation + Token Mgmt  ─┐
Step 0.4.2  RepoMap (tree-sitter)      ─┤ Week 4-5
Step 0.4.3  Context Integration        ─┘ ← 🏁 Context Intelligence
                                        
Step 0.5.1  Markdown Rendering         ─┐
Step 0.5.2  Slash Commands             ─┤
Step 0.5.3  Config System              ─┤ Week 5-6
Step 0.5.4  OpenAI Provider            ─┤
Step 0.5.5  Error Handling + Polish    ─┘ ← 🏁 V0.1 Release
```

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| 模糊匹配质量差，导致 LLM 编辑失败 | High | 大量测试用例 + 保守阈值 (0.95) + ⚠️ REVISED: hallucination guards (行数/锚点) + 用户确认 |
| Token 超限导致对话断裂 | Medium | 积极的 sliding window + 及时摘要 + ⚠️ REVISED: js-tiktoken 精确计数 + token budget safety valve |
| Anthropic API 变更 | Low | Provider 抽象层隔离 |
| 命令执行安全事故 | High | 白名单 + 确认 + git checkpoint + ⚠️ REVISED: 输入验证替代 execFile + 环境变量清洗 + symlink 解析 |
| tree-sitter WASM 兼容性 | Medium | 延迟到 Phase 0.4, 可降级为正则解析 |
| ⚠️ REVISED: LLM 返回无效工具调用 (幻觉 tool name / 错误 JSON) | Medium | 防御性错误处理 (malformed JSON / unknown tool / missing params) → 返回 is_error 让 LLM 自我修正 |
| ⚠️ REVISED: shell spawn 安全风险 (使用 shell:true) | Medium | 危险模式检测 + 白名单 + 用户确认 + 环境变量清洗 |
| ⚠️ REVISED: 网络数据泄露 (node/npx 可发网络请求) | Low | 文档标注风险 + 后续版本考虑网络沙箱 |

---

*End of Plan*
