import type { Config } from '../types.js';
import path from 'node:path';
import { HookManager } from '../hooks/manager.js';
import { SessionLogger } from '../observability/session-logger.js';
import { MemoryStore } from '../memory/store.js';
import { MemoryManager } from '../memory/manager.js';
import { SkillManager } from '../skills/manager.js';
import { loadHookPlugins } from '../plugins/loader.js';
import { logger } from '../utils/logger.js';

export interface BuildRuntimeResult {
  hookManager: HookManager;
  sessionLogger: SessionLogger | null;
  memoryStore: MemoryStore;
  memoryManager: MemoryManager;
  skillManager: SkillManager;
}

/**
 * Initialize runtime services: hooks, session logger, memory, skills, and hook plugins.
 */
export async function buildRuntime(config: Config): Promise<BuildRuntimeResult> {
  const workingDir = process.cwd();

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

  // Wire hooks to debug logging
  if (sessionLogger) {
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

  // Initialize skill manager
  const skillsDirsEnv = process.env['ROOKIE_SKILLS_DIRS'] ?? '';
  const skillsDirs = skillsDirsEnv
    ? skillsDirsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : [path.join(workingDir, 'skills')];
  const skillManager = new SkillManager({ directories: skillsDirs });
  await skillManager.init();

  // Initialize shared long-term memory services
  const memoryStore = new MemoryStore({ cwd: workingDir });
  const memoryManager = new MemoryManager(memoryStore);

  return { hookManager, sessionLogger, memoryStore, memoryManager, skillManager };
}
