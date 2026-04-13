## Status: DONE_WITH_CONCERNS

## Status Reason
已产出可直接执行的修订版计划，并把所有 Blocking Issues A-E 落成实施约束；非阻塞风险主要集中在 Phase 2 自动沉淀误判与 prompt 预算回归。

## Ready for Execution
- 是，但推荐按 **Phase 1 → Phase 2** 顺序执行。
- **Phase 1（显式长期记忆）** 在完成并通过验收前，不进入 Phase 2（自动沉淀）。

## 推荐执行模式
- **pipeline（推荐）**：本任务存在严格前后依赖，必须先定协议/优先级/预算，再改动态注入，再落命令，再做自动沉淀。

## Plan Summary
- Goal: 在现有 CLI agent 中落地长期记忆机制，支持 `/init` 建立 persona/偏好、`/add-store` 显式维护长期记忆，并在同一 REPL 会话内写入后下一轮立即影响 Agent 行为；随后再保守开启自动沉淀。
- Scope: In = 协议、优先级合并、global/project 持久化、动态 prompt 注入、token budget 计入、`/init`、`/add-store`、自动沉淀规则、测试与回归。Out = UI 管理界面、远程同步、并发安全、性能压测。
- Complexity: High
- Steps: 6

## Context Source
- Input mode: self-discovered + user-provided facts + review feedback
- Intent: 新特性 / 架构性增强
- Key constraints:
  - 必须先修动态注入，再落命令，避免“写入成功但下一轮不生效”。
  - `AgentLoop` 与命令层都必须拿到最新 snapshot，不能只注入 `CommandContext`。
  - project scope 不能直接等同 `process.cwd()`；需定义归一规则。
  - token budget 必须计入 system prompt 与 memory snapshot，而不只计 messages。
  - 自动沉淀不能依赖 `ConversationManager` 作为唯一证据源，避免被 `/clear`、`/compact` 干扰。
  - 适用质量维度：backward compatibility、durability/corruption recovery、privacy-local-data-boundary、prompt-budget correctness。
  - 不适用维度：concurrency safety、performance testing。
- Resolved defaults:
  - 分两阶段执行：**Phase 1 = 显式长期记忆**（`/init` + `/add-store` + 动态注入 + 预算）；**Phase 2 = 自动沉淀**。
  - 长期记忆主存放在用户目录，不进入仓库工作树，避免受 `src/repo/git.ts:76-117` 的 `/undo` 与 checkpoint 影响。
  - project key 使用“仓库根路径 + 远端 URL/仓库标识优先，回退到 realpath hash”的归一规则，而不是直接用 cwd。

## Blocking Issues A-E 解决方案
- **A. `/init` 与 `/add-store` 最小命令协议**
  - `/init --persona "..." --tone "..." --language zh-CN --verbosity concise --collaboration plan-first`
  - `/init` 无参数时进入交互式向导；有参数时走非交互模式，字段缺失则报错。
  - `/add-store set --scope project|global --kind preference|behavior|persona --key <key> --value "..." [--ttl-turns N]`
  - `/add-store delete --id <memoryId>`
  - `/add-store disable --id <memoryId>`
  - `/add-store ignore --id <memoryId> --turns 1`
  - 错误格式：`✖ <command> <ERROR_CODE>: <message>`；成功格式：`✔ <command> <action>: <summary>`；幂等命中返回 `✔ ... unchanged`。
  - 重复写入规则：同 `scope + key + normalized value + source` 视为同一条；manual `set` 相同值 no-op，不同值覆盖并更新时间。
- **B. 优先级 / 冲突合并 / 覆盖关闭规则**
  - 绝对优先级：`current-turn instruction` > `project manual` > `project auto` > `global manual` > `global auto` > `base system prompt`。
  - `/init` 生成的是 `global manual persona/default-preference`。
  - 冲突时先比 scope（project > global），再比 source（manual > auto），最后比 updatedAt（新者覆盖旧者）。
  - `disable` = 永久停用但保留记录；`delete` = 物理删除；`ignore --turns N` = 写入临时抑制态，仅影响未来 N 轮注入。
- **C. 同一 REPL 会话内即时生效验收**
  - 在同一进程/同一 REPL 实例中执行 `/add-store set ...` 或 `/init ...` 后，下一次 `agentLoop.run()` 捕获到的 `provider.stream({ system })` 必须包含新 snapshot；无需重启，无需新建 REPL。
- **D. 自动记忆来源 / 阈值 / 过滤 / 反自我强化**
  - 允许来源：仅 `userInput`、显式命令参数、持久化操作确认结果；**禁止**从 assistant 文本、assistant 自总结、`ConversationManager.summaryPrefix`、tool 结果中直接提炼长期记忆。
  - 触发阈值：满足以下之一才可沉淀：
    1. 用户出现长期偏好标记（例如“以后/默认/始终/记住/不要再”）；
    2. 语义相近的用户纠错在独立 turn 中累计 ≥ 2 次。
  - 敏感过滤：拒绝持久化密钥、令牌、账号、绝对私密路径、一次性 ticket 内容、代码片段、tool 原始输出。
  - 反自我强化：同一候选记忆若仅被 assistant 复述而未再次被用户确认，不增加 evidenceCount。
- **E. Prompt 注入预算 / 裁剪 / 回退**
  - 总预算计算改为：`countTokens(systemPromptBase + renderedMemory) + countMessagesTokens(messages)`。
  - memory section 上限：`min(600 tokens, floor(tokenBudget * 0.15))`；若未配置 tokenBudget，则采用固定 memory cap 400 tokens。
  - 裁剪顺序：先删 disabled/ignored，再去重，再按优先级排序，仅保留高优先级短句；先裁 auto，再裁 global，再裁低优先级 project。
  - 超限回退：若裁剪后仍超限，则仅保留 persona 摘要 + top manual memories；若仍超限，整段 memory section 省略，并记录 warning，不阻塞本轮执行。

## Steps
### Step 1: 固化长期记忆协议、优先级与项目归一规则（Phase 1）

**What:** 先定义长期记忆域模型与运行时契约，再开始编码。新增独立 memory contract/type 层，明确 record schema、命令协议、冲突合并、覆盖/删除/临时忽略、project scope 归一规则与损坏恢复策略。project scope 必须优先基于仓库根标识，而不是直接把不同 `process.cwd()` 视为不同项目；非 git 目录再回退到 `realpath(process.cwd())` hash。建议新增 `src/memory/types.ts`（或等价 contract 模块）和 `src/memory/store.ts`，把 schema/serialization/repair 放在一起，避免协议散落在 REPL 与 Agent 中。
**Agent:** deep-executor
**References:** `src/cli/commands.ts:13-25`; `src/cli/commands.ts:195-208`; `src/index.ts:48-73`; `src/repo/git.ts:76-117`; `src/agent/conversation.ts:11-99`; `src/utils/tokens.ts:45-63`
**MUST NOT:** 不要先写命令 handler 再倒推协议；不要把不同 cwd 直接映射成不同项目；不要把长期记忆放进仓库目录；不要把自动沉淀规则混进 `ConversationManager`。
**Verify:** 产出可测试 contract：
  - 非交互 `/init`、`/add-store` 的入参/错误/成功/幂等规则被单元测试固定；
  - project key 对“同仓库不同子目录”产生同一标识，对“不同仓库/非仓库目录”产生不同标识；
  - store 读取损坏文件时能 fallback 到空快照并保留 `.corrupt` 备份或等价恢复记录。
**Parallel:** 必须最先完成；Step 2-6 全部依赖此步。

### Step 2: 先改 AgentLoop 动态注入链路与 prompt-budget 统计（Phase 1）

**What:** 取消 `src/agent/loop.ts:29-32` 对完整 `systemPrompt` 的一次性缓存做法，改为缓存“基础 system prompt 模板”或 builder 参数，在每次 `run()` / `streamLLMResponse()` 前动态读取 memory snapshot 并重新渲染 system prompt。新增 `src/memory/manager.ts` 负责 snapshot 组装、优先级排序、冲突合并、预算裁剪与 fallback。同步修改 token budget 逻辑：system prompt 与 memory section 必须纳入预算，而不只统计 `messages`。这一改动必须先落地，确保后续命令写入能在下一轮即时生效。
**Agent:** deep-executor
**References:** `src/agent/loop.ts:21-33`; `src/agent/loop.ts:57-75`; `src/agent/loop.ts:151-165`; `src/agent/system-prompt.ts:4-53`; `src/utils/tokens.ts:10-63`
**MUST NOT:** 不要继续缓存包含 memory 的最终字符串；不要把 raw JSON store 直接拼进 prompt；不要忽略 system prompt token；不要让 budget 超限时直接报 fatal error。
**Verify:** `src/agent/__tests__/loop.test.ts` 新增断言：
  - mock provider 捕获到的 `system` 每轮都基于最新 snapshot；
  - 写入一条 memory 后，同一 REPL/同一 AgentLoop 的下一轮请求 `system` 发生变化；
  - 超出 memory cap 时裁剪顺序正确；
  - memory section 被省略时仍能正常调用 provider。
**Parallel:** 必须先于 Step 4；完成后 Step 3 可并行接入。

### Step 3: 打通共享 memory service 启动链路，确保 Agent 与命令读同一最新快照（Phase 1）

**What:** 在 `src/index.ts:60-73` 初始化单个 memory service / manager 实例，同时注入给 `AgentLoop` 与 `REPL`；`REPL` 再把它放入 `CommandContext`，确保 slash 命令写入后 `AgentLoop` 下一轮可直接读取同一服务实例上的最新 snapshot，而不是靠 REPL 私有缓存。这里还要补上持久化主目录解析、global/project scope 选择、store reload/refresh 策略，以及 corruption recovery 的用户可见提示。
**Agent:** executor
**References:** `src/index.ts:16-74`; `src/cli/repl.ts:95-115`; `src/cli/repl.ts:149-159`; `src/cli/commands.ts:13-18`; `src/agent/loop.ts:39-75`
**MUST NOT:** 不要只把 memory 注入 `CommandContext`；不要让 `AgentLoop` 持有启动时快照副本；不要把长期记忆生命周期绑定到 `ConversationManager.clear/compact`；不要污染现有 `workingDirectory = process.cwd()` 语义。
**Verify:** 新增 wiring 级测试：
  - `REPL.executeCommand('/add-store ...')` 后，同一 `AgentLoop` 后续 `run()` 可见最新 snapshot；
  - `/clear`、`/compact` 后 memory service 的持久化数据不变；
  - store 文件不出现在 git 工作树，`/undo` 不会回滚长期记忆。
**Parallel:** 依赖 Step 1-2；完成后 Step 4 才能联调即时生效。

### Step 4: 落地 `/init` 与 `/add-store`，完成显式长期记忆闭环（Phase 1）

**What:** 在现有 slash 命令体系中新增 `/init` 与 `/add-store`，严格遵守 Step 1 约定的最小协议，并兼容 `src/cli/commands.ts:195-208` 的“只切一次空格”解析方式——命令名之外的整段参数由各自 handler 内部解析。`/init` 支持交互式与 flag 模式，落 global manual persona/default preferences；`/add-store` 支持 `set/delete/disable/ignore` 四种动作，默认 `scope=project`，支持显式 `--scope global`。实现幂等响应、结构化错误码和“写入成功但无变化”的 no-op 输出。
**Agent:** executor
**References:** `src/cli/commands.ts:22-208`; `src/cli/repl.ts:23-27`; `src/cli/repl.ts:151-159`; `src/agent/conversation.ts:32-99`
**MUST NOT:** 不要重写整个 command parser；不要新增第三个命令去完成 B 中的删除/忽略能力；不要要求用户重启进程或执行 `/clear` 才让记忆生效；不要让 `/help`、tab 补全、未知命令处理回归。
**Verify:** `src/cli/__tests__/commands.test.ts` 覆盖：
  - `/help` 列出新命令；
  - `/init` flag 模式成功、参数缺失时报 `ERROR_CODE`、重复执行相同配置返回 `unchanged`；
  - `/add-store set/delete/disable/ignore` 全路径成功；
  - 默认 project scope 与显式 global scope 正确；
  - **同一 REPL 会话** 执行写入命令后，下一轮 agent 请求行为发生变化（可通过捕获 provider `system` 或响应 stub 验证）。
**Parallel:** 依赖 Step 2-3；完成即构成 **Phase 1 ready**。

### Step 5: 在 REPL 回合边界追加保守自动沉淀，不依赖短期会话摘要（Phase 2）

**What:** 仅在 Phase 1 通过后实现自动沉淀。于 `src/cli/repl.ts` agent 成功回合末尾追加 `memoryManager.maybePromoteFromTurn(...)`，输入只使用“当前 userInput、本轮 assistant output、独立持久化 evidence log / candidate store”，不把 `ConversationManager.summaryPrefix` 当长期证据来源。引入 candidate/evidence 结构用于跨 `/clear`、`/compact` 保留纠错计数；满足长期标记或重复阈值后，才 upsert 为 auto memory。自动记忆必须默认可被 manual 覆盖，并且永远低于 manual 优先级。
**Agent:** deep-executor
**References:** `src/cli/repl.ts:185-218`; `src/agent/conversation.ts:11-99`; `src/cli/commands.ts:42-178`
**MUST NOT:** 不要从 assistant 自己的复述、总结、tool 输出或 compact summary 中提炼长期记忆；不要把单次 ticket/一次性上下文沉淀进 store；不要因为 `/clear` 丢失纠错 evidence；不要自动覆盖 manual memory。
**Verify:** `src/memory/__tests__/manager.test.ts` 覆盖：
  - 含“以后/默认/记住/不要再”的 user turn 可直接入候选；
  - 仅 assistant 复述不会增 evidence；
  - 相近用户纠错需独立 turn ≥ 2 次才提升为 auto memory；
  - secrets/path/code-snippet 样本被过滤；
  - manual/project memory 与 current-turn 指令冲突时，auto memory 不得胜出。
**Parallel:** 严格依赖 Step 4；不得与 Phase 1 并行推进。

### Step 6: 做分阶段验收、回归与质量维度补强（Phase 1 + Phase 2）

**What:** 补齐 memory/CLI/agent 测试，按两个阶段分别验收。Phase 1 验证显式长期记忆闭环与 prompt-budget correctness；Phase 2 再验证自动沉淀。覆盖 durability/corruption recovery、privacy-local-data-boundary、backward compatibility。若需要新增文件，优先限于 `src/memory/*` 与相关测试，不扩展到额外文档或配置系统重构。
**Agent:** executor
**References:** `vitest.config.ts:4-13`; `src/agent/__tests__/loop.test.ts:76-260`; `src/agent/__tests__/conversation.test.ts:6-68`; `src/index.ts:60-73`; `src/repo/git.ts:76-117`
**MUST NOT:** 不要把“人工冒烟成功”当成唯一验收；不要把并发安全/性能测试纳入本次范围；不要因为 CLI 现有缺测就跳过新命令自动化覆盖。
**Verify:**
  - Phase 1：`pnpm test:run`、`pnpm lint`、`pnpm build` 通过；
  - Phase 1：显式写入后下一轮立即生效；memory 不受 `/clear` `/compact` `/undo` 影响；预算计算含 system prompt；
  - Phase 2：自动沉淀阈值、敏感过滤、反自我强化规则全部通过测试。
**Parallel:** 最终收尾；等待 Step 4/5 完成后统一执行。

## Acceptance Criteria
- **Phase 1（必须先达成）**
  - `/init` 可创建 global manual persona/default preferences，并在同一 REPL 会话内下一轮立即影响 Agent。
  - `/add-store` 支持 `set/delete/disable/ignore`，默认 project scope，支持 global scope，且写入后下一轮立即生效。
  - `AgentLoop` 每轮都读取最新 memory snapshot；不再依赖构造时缓存的最终 system prompt。
  - prompt-budget 统计覆盖 `system prompt + rendered memory + messages`；超限按既定裁剪/回退执行，不导致本轮失败。
  - project scope 归一规则能把“同仓库不同 cwd”映射到同一 project，不同项目映射到不同 project。
  - memory 文件不进入仓库工作树，`git status` 无新增，`/undo` 无法回滚长期记忆。
  - `/clear`、`/compact` 只影响 `ConversationManager` 短期上下文，不影响长期记忆持久层。
- **Phase 2（在 Phase 1 通过后）**
  - 自动沉淀只接受允许来源，满足长期标记或重复阈值后才提升为 auto memory。
  - assistant 自总结、tool 结果、summaryPrefix 不会被当成长期记忆来源。
  - 敏感信息、一次性任务上下文、代码片段不会入库也不会进入 prompt memory section。

## Necessary New Files
- `src/memory/store.ts`：必要。当前仓库没有长期记忆持久化层，必须新增以承接 schema、scope、durability/corruption recovery。
- `src/memory/manager.ts`：必要。动态 prompt 注入、优先级合并、预算裁剪、自动沉淀不能散落在 `loop.ts` / `repl.ts` / `commands.ts`。
- `src/memory/types.ts`（或等价 contract 文件）：必要。A/B/E 的协议、record schema、action/result code 若不集中定义，命令层和 agent 层会产生不一致。
- `src/memory/__tests__/store.test.ts`：必要。验证 scope 归一、损坏恢复、外部持久化不污染 git。
- `src/memory/__tests__/manager.test.ts`：必要。验证优先级、预算裁剪、自动沉淀与敏感过滤。
- `src/cli/__tests__/commands.test.ts`：必要。`vitest.config.ts:4-13` 显示 CLI 几乎无覆盖，本次核心能力直接落在命令层，不能缺测。

## Remaining Risks
- Phase 2 自动沉淀仍可能出现“偏好误提取”或“纠错聚类过宽”风险，因此必须在 Phase 1 验收通过后再启用。
- prompt-budget 改造会触及 AgentLoop 的主路径；若测试只验证消息不验证 `provider.stream({ system })`，极易漏掉回归。
- project 归一规则若过度依赖 git remote，在无远端仓库场景需要稳定回退方案；实现时要同时覆盖 git/非 git 场景。

## Assumptions
- 当前需求面向单用户本地 CLI，不要求跨设备同步。
- 可接受长期记忆只存储高层偏好/纠错，不保存原始对话全文。
- 若 Phase 1 验收失败，Phase 2 自动沉淀自动顺延，不做并行开发。

## Saved To
- `.omc/plans/long-term-memory-plan.md`

## Next Steps
- 该计划 **ready for execution**。
- 推荐执行顺序：Step 1 → Step 2 → Step 3 → Step 4（完成 Phase 1 验收）→ Step 5 → Step 6。
- 若进入实施，请按 `pipeline` 模式执行，并在 **Step 4 完成后先做一次中途验收**，确认“同一会话写入后下一轮立刻生效”再继续 Phase 2。
