## Rookie Code (Editor Context)

把 VS Code 中"当前聚焦文件/选中行范围"导出给 Rookie Code CLI，用于更准确的上下文感知。

### 安装

在 Open VSX 搜索 `Rookie Code (Editor Context)` 并安装，或下载 `.vsix` 手动安装。

### 配合 Rookie Code CLI

CLI 会自动读取该文件，并在终端输入框下方显示提示（例如：`In foo.ts  L12-L20`），同时也可注入到 prompt 里。

### 设置项

- `rookieCode.editorContext.enabled`：是否启用
- `rookieCode.editorContext.throttleMs`：更新节流（ms）
- `rookieCode.editorContext.includeCaretLine`：无选区时是否把光标行作为 1 行选区导出
- `rookieCode.editorContext.path`：自定义输出路径（留空则使用默认 `~/.rookie-code/editor-context.json`）

### 输出格式

```json
{
  "activeFile": "/abs/path/to/file.ts",
  "selections": [{ "startLine": 10, "endLine": 20 }]
}
```
