import { buildConfig } from './bootstrap/config.js';
import { createProvider } from './bootstrap/provider.js';
import { buildToolRegistry } from './bootstrap/tools.js';
import { buildRuntime } from './bootstrap/runtime.js';
import { startRepl } from './bootstrap/repl.js';

async function main(): Promise<void> {
  const { config } = buildConfig();
  const provider = createProvider(config);
  const { hookManager, sessionLogger, memoryManager, skillManager } = await buildRuntime(config);
  const { tools, mcpManager, ui, setRepl } = await buildToolRegistry({
    config,
    provider,
    hookManager,
    sessionLogger,
  });
  await startRepl({
    config,
    provider,
    tools,
    hookManager,
    sessionLogger,
    memoryManager,
    mcpManager,
    skillManager,
    ui,
    setRepl,
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
