import type { Config } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionLogger } from '../observability/session-logger.js';
import type { MemoryManager } from '../memory/manager.js';
import type { McpManager } from '../mcp/manager.js';
import type { SkillManager } from '../skills/manager.js';
import type { TerminalUI } from '../cli/terminal-ui.js';
import { AgentLoop } from '../agent/loop.js';
import { REPL } from '../cli/repl.js';

export interface StartReplParams {
  config: Config;
  provider: LLMProvider;
  tools: ToolRegistry;
  hookManager: HookManager;
  sessionLogger: SessionLogger | null;
  memoryManager: MemoryManager;
  mcpManager: McpManager;
  skillManager: SkillManager;
  ui: TerminalUI;
  setRepl: (repl: REPL) => void;
}

/**
 * Initialize AgentLoop and REPL, then start the interactive session.
 */
export async function startRepl(params: StartReplParams): Promise<void> {
  const {
    config, provider, tools, hookManager, sessionLogger,
    memoryManager, mcpManager, skillManager, ui, setRepl,
  } = params;
  const workingDir = process.cwd();

  // Initialize agent loop
  const agent = new AgentLoop(provider, tools, {
    maxIterations: config.agent.maxIterations,
    tokenBudget: config.agent.tokenBudget,
    workingDirectory: workingDir,
    onEvent: (event) => {
      ui.handleAgentEvent(event);
      void sessionLogger?.logAgentEvent(event);
      if (event.type === 'notification') {
        const notif = event.data as { title: string; message: string; notification_type: string };
        hookManager.emitNotification(notif.title, notif.message, notif.notification_type).catch(() => {});
      }
    },
    memoryManager,
    hookManager,
    depth: 0,
    repoContext: config.repoContext,
  });

  // Start REPL with full context
  const repl = new REPL(agent, {
    provider,
    workingDirectory: workingDir,
    memoryManager,
    ui,
    mcpManager,
    skillManager,
    hookManager,
    sessionLogger: sessionLogger ?? undefined,
  });

  // Wire REPL reference back to UI (for token stats, completion, etc.)
  setRepl(repl);
  ui.setCompletionProvider((text) => repl.getCompletions(text));

  await repl.start();
}
