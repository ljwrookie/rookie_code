import * as vscode from 'vscode';
import os from 'node:os';
import path from 'node:path';

type SelectionRange = { startLine: number; endLine: number };
type EditorContext = { activeFile?: string; selections?: SelectionRange[] };

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const i = Math.floor(value);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function computeSelections(editor: vscode.TextEditor, includeCaretLine: boolean): SelectionRange[] {
  const out: SelectionRange[] = [];
  for (const sel of editor.selections) {
    // VS Code uses 0-based line indexes; Rookie Code expects 1-based, inclusive.
    const a = sel.start.line;
    const b = sel.end.line;
    const start = Math.min(a, b) + 1;
    const end = Math.max(a, b) + 1;

    if (!includeCaretLine && sel.isEmpty) continue;
    out.push({ startLine: start, endLine: end });
  }
  return out;
}

async function writeEditorContext(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor) return;

  const cfg = vscode.workspace.getConfiguration('rookieCode');
  const enabled = cfg.get<boolean>('editorContext.enabled', true);
  if (!enabled) return;

  const includeCaretLine = cfg.get<boolean>('editorContext.includeCaretLine', false);
  const configuredPath = (cfg.get<string>('editorContext.path') ?? '').trim();

  const targetFilePath = configuredPath || path.join(os.homedir(), '.rookie-code', 'editor-context.json');
  const dir = vscode.Uri.file(path.dirname(targetFilePath));
  const file = vscode.Uri.file(targetFilePath);
  const editorPath = editor.document.uri.fsPath;
  const targetPath = file.fsPath;
  // If user opens the context file itself, do not overwrite it; otherwise VS Code may
  // treat it as replaced and close/reload the editor tab, which feels broken.
  if (editorPath === targetPath) return;

  const payload: EditorContext = {
    activeFile: editor.document.uri.fsPath,
    selections: computeSelections(editor, includeCaretLine),
  };

  const bytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  await vscode.workspace.fs.createDirectory(dir);

  // Write in-place instead of tmp+rename.
  // tmp+rename can cause VS Code to close the tab when the file is open.
  await vscode.workspace.fs.writeFile(file, bytes);
}

export function activate(context: vscode.ExtensionContext): void {
  let timer: NodeJS.Timeout | undefined;

  const schedule = (editor: vscode.TextEditor | undefined) => {
    const cfg = vscode.workspace.getConfiguration('rookieCode');
    const throttleMs = clampInt(cfg.get<number>('editorContext.throttleMs', 80), 80, 0, 2000);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void writeEditorContext(editor), throttleMs);
  };

  schedule(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => schedule(editor)),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => schedule(e.textEditor)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => schedule(vscode.window.activeTextEditor)),
  );
}

export function deactivate(): void {}
