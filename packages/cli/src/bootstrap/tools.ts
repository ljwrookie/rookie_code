import type { Config } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionLogger } from '../observability/session-logger.js';
import { ToolRegistry } from '../tools/registry.js';
import { ReadFileTool } from '../tools/read-file.js';
import { EditFileTool } from '../tools/edit-file.js';
import { WriteFileTool } from '../tools/write-file.js';
import { ShellExecTool } from '../tools/shell-exec.js';
import { SearchCodeTool } from '../tools/search-code.js';
import { ListFilesTool } from '../tools/list-files.js';
import { AskUserTool } from '../tools/ask-user.js';
import { AgentTool, MultiAgentTool } from '../tools/agents.js';
import { OrchestrateTool } from '../tools/orchestrate.js';
import { McpManager } from '../mcp/manager.js';
import { TerminalUI } from '../cli/terminal-ui.js';
import type { REPL } from '../cli/repl.js';
import path from 'node:path';
import { getPrimaryEditorContextPath, loadEditorContext } from '../editor/editor-context.js';
import fs from 'node:fs';

export interface BuildToolRegistryParams {
  config: Config;
  provider: LLMProvider;
  hookManager: HookManager;
  sessionLogger: SessionLogger | null;
}

export interface BuildToolRegistryResult {
  tools: ToolRegistry;
  mcpManager: McpManager;
  ui: TerminalUI;
  /** Setter to wire up REPL reference after it's created. */
  setRepl: (repl: REPL) => void;
}

/**
 * Register all built-in tools, MCP tools, and agent tools.
 * Also creates the TerminalUI (needed by agent tools' onEvent callbacks).
 * Returns the tool registry, MCP manager, and UI.
 */
export async function buildToolRegistry(params: BuildToolRegistryParams): Promise<BuildToolRegistryResult> {
  const { config, provider, hookManager, sessionLogger } = params;
  const workingDir = process.cwd();

  // Create UI early — agent tools need it for onEvent callbacks.
  let replRef: REPL | null = null;
  const setRepl = (repl: REPL) => { replRef = repl; };

  const ui = new TerminalUI(
    () => ({
      totalHistoryTokens: replRef?.getTotalHistoryTokens() ?? 0,
      windowBaseTokens: replRef?.getWindowBaseTokens() ?? 0,
      tokenBudget: replRef?.getTokenBudget(),
      queueSize: replRef?.getQueueSize() ?? 0,
      busy: replRef?.isBusy() ?? false,
    }),
    {
      onSubmit: (text) => replRef?.enqueueInput(text),
      onExit: () => replRef?.exit('other'),
      onAbort: () => replRef?.abortCurrent(),
    },
  );
  ui.setWelcomeInfo({ provider: config.llm.provider, model: config.llm.model });
  let cachedHint: string | null = null;
  const computeHint = (): string | null => {
    const ctx = loadEditorContext(workingDir);
    if (!ctx?.activeFile) return null;
    const activeAbs = ctx.activeFile;
    const rel = path.isAbsolute(activeAbs) ? path.relative(workingDir, activeAbs) : activeAbs;
    const sels = ctx.selections ?? [];
    if (sels.length === 0) return `In ${rel}`;
    const first = sels[0]!;
    const single = sels.length === 1 && first.startLine === first.endLine;
    const range = single ? `L${first.startLine}` : `L${first.startLine}-L${first.endLine}`;
    const extra = sels.length > 1 ? ` (+${sels.length - 1})` : '';
    return `In ${rel}  ${range}${extra}`;
  };
  const refreshHint = (): void => {
    cachedHint = computeHint();
    ui.invalidate();
  };
  ui.setBottomHintProvider(() => cachedHint);
  refreshHint();

  // Refresh hint immediately when the editor context file changes.
  const ctxFile = getPrimaryEditorContextPath(workingDir);
  try {
    // Watch directory so it also works when the file is created later.
    const dir = path.dirname(ctxFile);
    const base = path.basename(ctxFile);
    fs.watch(dir, { persistent: false }, (_evt, filename) => {
      if (!filename || filename === base) refreshHint();
    });
  } catch {
    // Ignore if the file doesn't exist yet; the hint will appear once created and UI rerenders.
  }

  // Register basic tools
  const tools = new ToolRegistry();
  tools.register(new ReadFileTool(workingDir));
  tools.register(new EditFileTool(workingDir, {
    confirmFuzzyEdits: config.editor.confirmFuzzyEdits,
    confirmHighRiskEdits: config.editor.confirmHighRiskEdits,
    maxAutoEditLines: config.editor.maxAutoEditLines,
  }));
  tools.register(new WriteFileTool(workingDir, {
    confirmHighRiskEdits: config.editor.confirmHighRiskEdits,
    maxAutoEditLines: config.editor.maxAutoEditLines,
  }));
  tools.register(new ShellExecTool(workingDir, config.security, config.security.requireConfirmation));
  tools.register(new SearchCodeTool(workingDir));
  tools.register(new ListFilesTool(workingDir));
  tools.register(new AskUserTool());

  // Mount MCP tools from `.mcp.json` (if present)
  const mcpManager = new McpManager(workingDir);
  await mcpManager.init();
  mcpManager.mountTools(tools);

  // Read agent env config
  const readEnvInt = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const maxAgentDepth = readEnvInt('ROOKIE_MAX_AGENT_DEPTH', 3);
  const maxParallelAgents = readEnvInt('ROOKIE_MAX_PARALLEL_AGENTS', 5);

  // Register multi-agent tools (agent / multiagent)
  tools.register(new AgentTool({
    provider,
    parentRegistry: tools,
    workingDirectory: workingDir,
    onEvent: (event) => {
      ui.handleAgentEvent(event);
      void sessionLogger?.logAgentEvent(event);
      if (event.type === 'notification') {
        const notif = event.data as { title: string; message: string; notification_type: string };
        hookManager.emitNotification(notif.title, notif.message, notif.notification_type).catch(() => {});
      }
    },
    maxAgentDepth,
    editorContext: config.editorContext,
  }));
  tools.register(new MultiAgentTool({
    provider,
    parentRegistry: tools,
    workingDirectory: workingDir,
    onEvent: (event) => {
      ui.handleAgentEvent(event);
      void sessionLogger?.logAgentEvent(event);
      if (event.type === 'notification') {
        const notif = event.data as { title: string; message: string; notification_type: string };
        hookManager.emitNotification(notif.title, notif.message, notif.notification_type).catch(() => {});
      }
    },
    maxAgentDepth,
    maxParallelAgents,
    editorContext: config.editorContext,
  }));
  tools.register(new OrchestrateTool({
    provider,
    parentRegistry: tools,
    workingDirectory: workingDir,
    hookManager,
    maxAgentDepth,
    defaultMaxIterations: 15,
    defaultTokenBudget: 40_000,
    maxParallel: maxParallelAgents,
    editorContext: config.editorContext,
  }));

  return { tools, mcpManager, ui, setRepl };
}
