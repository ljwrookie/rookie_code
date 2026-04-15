import { input } from '@inquirer/prompts';
import { createPrompt, useState, useKeypress, isEnterKey, isUpKey, isDownKey } from '@inquirer/core';
import type { InquirerReadline } from '@inquirer/type';
import chalk from 'chalk';
import type { AgentLoop } from '../agent/loop.js';
import type { LLMProvider } from '../llm/provider.js';
import { ConversationManager } from '../agent/conversation.js';
import type { MemoryManager } from '../memory/manager.js';
import { GitOperations } from '../repo/git.js';
import { Renderer } from './renderer.js';
import { executeCommand, commands, type CommandContext } from './commands.js';
import type { McpManager } from '../mcp/manager.js';

export interface REPLOptions {
  provider: LLMProvider;
  workingDirectory: string;
  memoryManager: MemoryManager;
  renderer?: Renderer;
  mcpManager?: McpManager;
}

const replPrompt = createPrompt<string, { message: string }>((config, done) => {
  const [value, setValue] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [isDone, setIsDone] = useState(false);

  const isCommand = value.startsWith('/');
  const hasSpace = value.includes(' ');
  const suggestions = (isCommand && !hasSpace)
    ? commands.filter(c => c.name.startsWith(value))
    : [];

  useKeypress((key, rl) => {
    const readline = rl as InquirerReadline & { cursor: number };

    if (isEnterKey(key)) {
      const submitted = value || readline.line;
      setValue(submitted);
      setIsDone(true);
      done(submitted);
    } else if (key.name === 'tab') {
      if (suggestions.length > 0) {
        const suggestion = suggestions[activeIdx]?.name;
        if (suggestion) {
          readline.line = suggestion + ' ';
          readline.cursor = readline.line.length;
          setValue(readline.line);
          setActiveIdx(0);
        }
      }
    } else if (key.name === 'up' || isUpKey(key)) {
      if (suggestions.length > 0) {
        setActiveIdx(activeIdx > 0 ? activeIdx - 1 : suggestions.length - 1);
      }
    } else if (key.name === 'down' || isDownKey(key)) {
      if (suggestions.length > 0) {
        setActiveIdx(activeIdx < suggestions.length - 1 ? activeIdx + 1 : 0);
      }
    } else {
      if (value !== readline.line) {
        setValue(readline.line);
        setActiveIdx(0);
      }
    }
  });

  const message = config.message;
  let formattedValue = value;
  
  if (isDone) {
    return `${message}${value}\n`;
  }

  if (suggestions.length > 0 && activeIdx < suggestions.length) {
    const suggestion = suggestions[activeIdx]?.name;
    if (suggestion && suggestion.startsWith(value)) {
      const hint = suggestion.slice(value.length);
      formattedValue = value + chalk.gray(hint);
    }
  }

  let output = `${message}${formattedValue}`;

  if (suggestions.length > 0 && !hasSpace) {
    const list = suggestions.map((s, i) => {
      const prefix = i === activeIdx ? chalk.cyan('❯') : ' ';
      const name = i === activeIdx ? chalk.cyan(s.name) : s.name;
      return `${prefix} ${name}  ${chalk.gray(s.description)}`;
    }).join('\n');
    return [output, list];
  }

  return output;
});

/**
 * Interactive REPL for the code agent.
 */
export class REPL {
  private conversation: ConversationManager;
  private git: GitOperations;
  private renderer: Renderer;
  private abortController: AbortController | null = null;
  private commandCtx: CommandContext;

  constructor(
    private agentLoop: AgentLoop,
    options: REPLOptions,
  ) {
    this.conversation = new ConversationManager();
    this.git = new GitOperations(options.workingDirectory);
    this.renderer = options.renderer ?? new Renderer();
    this.commandCtx = {
      conversation: this.conversation,
      git: this.git,
      provider: options.provider,
      workingDirectory: options.workingDirectory,
      memoryManager: options.memoryManager,
      mcpManager: options.mcpManager,
    };
  }

  async start(): Promise<void> {
    this.renderer.renderWelcome();

    // Handle Ctrl+C: abort current request, don't exit
    process.on('SIGINT', () => {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.renderer.endStream();
        console.error(chalk.yellow('\n⚠ Request cancelled.'));
      } else {
        // No active request — exit
        console.error(chalk.gray('\nBye!'));
        process.exit(0);
      }
    });

    while (true) {
      let userInput: string;
      try {
        const line = await replPrompt({
          message: chalk.green.bold('rookie ') + chalk.cyan.bold('❯ '),
        });
        userInput = line.trim();
      } catch (err: any) {
        if (err.name === 'ExitPromptError') {
          console.error(chalk.gray('\nBye!'));
          break;
        }
        break;
      }

      if (!userInput) continue;

      // Handle slash commands
      if (userInput.startsWith('/')) {
        const result = await executeCommand(userInput, this.commandCtx);
        if (result === 'exit') {
          console.error(chalk.gray('Bye!'));
          break;
        }
        continue;
      }

      // Handle multi-line input (lines ending with \)
      let fullInput = userInput;
      while (fullInput.endsWith('\\')) {
        fullInput = fullInput.slice(0, -1) + '\n';
        try {
          const continuation = await input({
            message: chalk.cyan.bold('       ❯ '),
            transformer: (value: string, { isFinal }) => {
              return isFinal ? value : value;
            },
            theme: {
              prefix: ''
            }
          });
          fullInput += continuation;
          console.error(chalk.cyan.bold('       ❯ ') + continuation);
        } catch (err: any) {
          if (err.name === 'ExitPromptError') {
            break;
          }
          break;
        }
      }

      // Run agent loop
      this.abortController = new AbortController();
      try {
        // Auto-checkpoint before running agent (if in git repo)
        await this.maybeCheckpoint();

        this.renderer.startThinking();
        const history = this.conversation.getMessages();
        const turn = this.commandCtx.memoryManager?.advanceTurn();
        const updatedHistory = await this.agentLoop.run(
          fullInput,
          history,
          this.abortController.signal,
        );

        // Update conversation with new messages
        // The agent returns the full history including the user message and responses
        // We need to extract only the new messages added during this run
        const newMessages = updatedHistory.slice(history.length);
        this.conversation.addMessages(newMessages);
        if (turn != null) {
          await this.commandCtx.memoryManager?.captureAutoMemory({
            userInput: fullInput,
            turn,
            scope: 'project',
          });
        }

        this.renderer.endStream();
        console.error(''); // blank line after response
      } catch (err) {
        this.renderer.endStream();
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Already handled by SIGINT handler
        } else if (err instanceof Error) {
          this.renderer.renderError(err);
        } else {
          console.error(chalk.red(`Error: ${String(err)}`));
        }
      } finally {
        this.abortController = null;
      }
    }
  }

  /**
   * Create a git checkpoint if there are uncommitted changes.
   */
  private async maybeCheckpoint(): Promise<void> {
    try {
      const isRepo = await this.git.isGitRepo();
      if (!isRepo) return;

      const hasChanges = await this.git.hasUncommittedChanges();
      if (hasChanges) {
        await this.git.createCheckpoint('before agent run');
      }
    } catch {
      // Non-fatal: checkpoint failure shouldn't block the agent
    }
  }
}
