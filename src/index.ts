import { AnthropicProvider } from './llm/anthropic.js';
import { OpenAIProvider } from './llm/openai.js';
import { ToolRegistry } from './tools/registry.js';
import { ReadFileTool } from './tools/read-file.js';
import { EditFileTool } from './tools/edit-file.js';
import { WriteFileTool } from './tools/write-file.js';
import { ShellExecTool } from './tools/shell-exec.js';
import { SearchCodeTool } from './tools/search-code.js';
import { ListFilesTool } from './tools/list-files.js';
import { AskUserTool } from './tools/ask-user.js';
import { AgentTool, MultiAgentTool } from './tools/agents.js';
import { OrchestrateTool } from './tools/orchestrate.js';
import { AgentLoop } from './agent/loop.js';
import { REPL } from './cli/repl.js';
import { Renderer } from './cli/renderer.js';
import { loadConfig } from './config/loader.js';
import { MemoryManager } from './memory/manager.js';
import { MemoryStore } from './memory/store.js';
import { parseArgs } from 'node:util';
import { McpManager } from './mcp/manager.js';
import { SkillManager } from './skills/manager.js';
import os from 'node:os';
import path from 'node:path';
import { HookManager } from './hooks/manager.js';
import { SessionLogger } from './observability/session-logger.js';
import { logger, setLogLevel } from './utils/logger.js';
import { loadHookPlugins } from './plugins/loader.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: {
        type: 'string',
        short: 'm',
      },
      provider: {
        type: 'string',
        short: 'p',
      },
      'base-url': {
        type: 'string',
      },
      'no-confirm': {
        type: 'boolean',
      },
      debug: {
        type: 'boolean',
      },
      'log-dir': {
        type: 'string',
      },
      verbose: {
        type: 'boolean',
        short: 'v',
      },
      'no-repo-context': {
        type: 'boolean',
      },
      'repo-max-files': {
        type: 'string',
      },
      'no-confirm-fuzzy-edits': {
        type: 'boolean',
      },
      'no-confirm-high-risk-edits': {
        type: 'boolean',
      },
      'max-auto-edit-lines': {
        type: 'string',
      },
      'max-iterations': {
        type: 'string',
      },
      'token-budget': {
        type: 'string',
      },
    },
    strict: false,
  });

  const llmOverrides: any = {};
  if (values.model) llmOverrides.model = values.model as string;
  if (values.provider && (values.provider === 'openai' || values.provider === 'anthropic')) {
    llmOverrides.provider = values.provider as 'openai' | 'anthropic';
  }
  if (values['base-url']) llmOverrides.baseURL = values['base-url'] as string;

  const config = loadConfig(llmOverrides);

  if (values.verbose) {
    setLogLevel('verbose');
  }

  if (values['no-confirm']) {
    config.security.requireConfirmation = false;
  }
  if (values['no-repo-context']) {
    config.repoContext.enabled = false;
  }
  if (values['repo-max-files']) {
    const parsed = Number.parseInt(values['repo-max-files'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.repoContext.maxFiles = Math.min(parsed, 500);
    }
  }
  if (values['no-confirm-fuzzy-edits']) {
    config.editor.confirmFuzzyEdits = false;
  }
  if (values['no-confirm-high-risk-edits']) {
    config.editor.confirmHighRiskEdits = false;
  }
  if (values['max-auto-edit-lines']) {
    const parsed = Number.parseInt(values['max-auto-edit-lines'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.editor.maxAutoEditLines = Math.min(parsed, 10_000);
    }
  }

  if (values.debug) {
    config.observability.enabled = true;
    if (values['log-dir']) {
      config.observability.logDir = values['log-dir'] as string;
    }
  }

  // Validate API key
  if (!config.llm.apiKey) {
    const envVar = config.llm.provider === 'openai' ? 'OPENAI_API_KEY or ARK_API_KEY' : 'ANTHROPIC_API_KEY';
    console.error(
      `Error: ${envVar} environment variable is not set.\n` +
      `Set it in your .env file or with: export ${envVar}=your-key-here`,
    );
    process.exit(1);
  }

  // Initialize LLM provider
  const provider = config.llm.provider === 'openai'
    ? new OpenAIProvider(config.llm.apiKey, config.llm.model, config.llm.baseURL)
    : new AnthropicProvider(config.llm.apiKey, config.llm.model, config.llm.baseURL);

  // Initialize tools
  const workingDir = process.cwd();
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

  // Optional: mount MCP tools from `.mcp.json` (if present)
  const mcpManager = new McpManager(workingDir);
  await mcpManager.init();
  mcpManager.mountTools(tools);

  // Initialize renderer for streaming output
  const renderer = new Renderer();

  // Initialize skill manager (optional)
  const skillsDirsEnv = process.env['ROOKIE_SKILLS_DIRS'] ?? '';
  const skillsDirs = skillsDirsEnv
    ? skillsDirsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : [
      // Default: coco/oh-my-code skills on macOS (if present)
      path.join(os.homedir(), 'Library', 'Caches', 'coco', 'plugins', 'oh-my-code', 'skills'),
      // Optional: repo-local skills directory
      path.join(workingDir, 'skills'),
    ];
  const skillManager = new SkillManager({ directories: skillsDirs });
  await skillManager.init();

  const hookManager = new HookManager();
  const sessionLogger = config.observability.enabled
    ? new SessionLogger({ cwd: workingDir, logDir: config.observability.logDir })
    : null;
  if (sessionLogger) {
    await sessionLogger.log('session_start', { cwd: workingDir, argv: process.argv.slice(2) });
    logger.success(`Debug log: ${sessionLogger.getLogFilePath()}`);
  }

  // Load hook plugins before wiring built-in hook handlers.
  await loadHookPlugins({ cwd: workingDir, hooks: hookManager });

  // Apply agent CLI overrides that are not part of loadConfig()
  if (values['max-iterations']) {
    const parsed = Number.parseInt(values['max-iterations'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.agent.maxIterations = Math.min(parsed, 200);
    }
  }
  if (values['token-budget']) {
    const parsed = Number.parseInt(values['token-budget'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.agent.tokenBudget = Math.min(parsed, 500_000);
    }
  }

  if (sessionLogger) {
    // Wire hooks to debug logging (avoid noisy text deltas; keep tool-level visibility).
    hookManager.on('pre_tool_use', async ({ tool_input }) => {
      await sessionLogger.log('pre_tool_use', tool_input);
    });
    hookManager.on('post_tool_use', async ({ tool_input, tool_response }) => {
      await sessionLogger.log('post_tool_use', { tool_input, tool_response });
    });
    hookManager.on('post_tool_use_failure', async ({ tool_input, error }) => {
      await sessionLogger.log('post_tool_use_failure', { tool_input, error: String(error) });
    });
    hookManager.on('permission_request', async ({ tool_input }) => {
      await sessionLogger.log('permission_request', tool_input);
    });
    hookManager.on('session_end', async ({ reason }) => {
      await sessionLogger.log('session_end', { reason });
    });
  }

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
      renderer.handleEvent(event);
      void sessionLogger?.logAgentEvent(event);
      if (event.type === 'notification') {
        const notif = event.data as { title: string; message: string; notification_type: string };
        hookManager.emitNotification(notif.title, notif.message, notif.notification_type).catch(() => {});
      }
    },
    maxAgentDepth,
  }));
  tools.register(new MultiAgentTool({
    provider,
    parentRegistry: tools,
    workingDirectory: workingDir,
    onEvent: (event) => {
      renderer.handleEvent(event);
      void sessionLogger?.logAgentEvent(event);
      if (event.type === 'notification') {
        const notif = event.data as { title: string; message: string; notification_type: string };
        hookManager.emitNotification(notif.title, notif.message, notif.notification_type).catch(() => {});
      }
    },
    maxAgentDepth,
    maxParallelAgents,
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
  }));

  // Initialize shared long-term memory services
  const memoryStore = new MemoryStore({ cwd: workingDir });
  const memoryManager = new MemoryManager(memoryStore);

  // Initialize agent loop
  const agent = new AgentLoop(provider, tools, {
    maxIterations: config.agent.maxIterations,
    tokenBudget: config.agent.tokenBudget,
    workingDirectory: workingDir,
    onEvent: (event) => {
      renderer.handleEvent(event);
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
    renderer,
    mcpManager,
    skillManager,
    hookManager,
    sessionLogger: sessionLogger ?? undefined,
  });
  await repl.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
