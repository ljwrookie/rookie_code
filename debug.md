# Debug Session

Status: [OPEN]

## Symptom
- REPL 输入回车后直接消失
- 没有看到用户输入回显
- 也没有看到 Agent 输出或工具输出

## Hypotheses
1. REPL 在 prompt 完成后没有重新回显提交内容，导致输入看起来被吞掉。
2. `@inquirer` prompt 与 `Renderer` 混用不同输出流，导致终端渲染互相覆盖。
3. 请求已发出，但 `AgentLoop` / `Renderer` 没有收到或没有渲染任何事件。
4. spinner 启动后没有被可见地停止或刷新，造成“无输出”的假象。

## Instrumentation Plan
- 记录 prompt 提交值
- 记录 agent run 的开始/结束/异常
- 记录 renderer 收到的事件类型与文本长度
- 对比 `stdout` / `stderr` 写入路径

## Evidence
- `trae-debug-log-rookie-cli.ndjson` 首条日志显示 `repl:prompt_submitted` 的 `rawLength=0`、`trimmedLength=0`。
- 说明回车提交时，`replPrompt()` 返回的是空字符串，因此 REPL 命中 `if (!userInput) continue;`，后续 Agent Loop 根本没有执行。

## Analysis
- 已基本排除 “Renderer 没输出” 作为首因。
- 当前最可能根因是 `createPrompt` 的回车分支使用 `readline.line` 取值时拿到了被清空的 buffer，而非用户已输入内容。
- 次要体验问题是 prompt 完成后没有重新回显用户输入，视觉上更像“输入被吞掉”。