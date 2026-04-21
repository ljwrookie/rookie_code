## Rookie Code

一个基于 LLM 的终端代码智能体（CLI），支持代码阅读、编辑、搜索、命令执行，以及多 Agent 协作。

### 安装

```bash
npm i -g rookie-code
```

### 运行

```bash
rookie-code
```

### 配置模型提供方

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

### 编辑器上下文（可选）

如果你配合 [Rookie Code VS Code 扩展](https://open-vsx.org/extension/rookie/rookie-code-vscode) 使用，它会把当前聚焦文件/选中行写入 `~/.rookie-code/editor-context.json`，
CLI 会自动读取并在 prompt/UI 中展示提示。

如需自定义路径：

```bash
export ROOKIE_EDITOR_CONTEXT_PATH="/abs/path/to/editor-context.json"
```
