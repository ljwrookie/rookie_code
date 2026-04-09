import { AnthropicProvider } from './llm/anthropic.js';
import { OpenAIProvider } from './llm/openai.js';
import { ToolRegistry } from './tools/registry.js';
import { ReadFileTool } from './tools/read-file.js';
import { EditFileTool } from './tools/edit-file.js';
import { WriteFileTool } from './tools/write-file.js';
import { ShellExecTool } from './tools/shell-exec.js';
import { SearchCodeTool } from './tools/search-code.js';
import { ListFilesTool } from './tools/list-files.js';
import { AgentLoop } from './agent/loop.js';
import { REPL } from './cli/repl.js';
import { Renderer } from './cli/renderer.js';
import { loadConfig } from './config/loader.js';
import { parseArgs } from 'node:util';

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: {
        type: 'string',
        short: 'm',
      },
    },
    strict: false,
  });

  const config = loadConfig(values.model ? { model: values.model } : {});

  // Validate API key
  if (!config.llm.apiKey) {
    const envVar = config.llm.provider === 'openai' 
      ? (config.llm.model === 'ep-20260119234417-bhr7d' ? 'ARK_API_KEY' : 'OPENAI_API_KEY') 
      : 'ANTHROPIC_API_KEY';
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
  tools.register(new EditFileTool(workingDir));
  tools.register(new WriteFileTool(workingDir));
  tools.register(new ShellExecTool(workingDir, config.security.requireConfirmation));
  tools.register(new SearchCodeTool(workingDir));
  tools.register(new ListFilesTool(workingDir));

  // Initialize renderer for streaming output
  const renderer = new Renderer();

  // Initialize agent loop
  const agent = new AgentLoop(provider, tools, {
    maxIterations: config.agent.maxIterations,
    tokenBudget: config.agent.tokenBudget,
    workingDirectory: workingDir,
    onEvent: (event) => renderer.handleEvent(event),
  });

  // Start REPL with full context
  const repl = new REPL(agent, {
    provider,
    workingDirectory: workingDir,
  });
  await repl.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
