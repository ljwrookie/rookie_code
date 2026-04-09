import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import type { AgentLoop } from '../agent/loop.js';
import type { LLMProvider } from '../llm/provider.js';
import { ConversationManager } from '../agent/conversation.js';
import { GitOperations } from '../repo/git.js';
import { Renderer } from './renderer.js';
import { executeCommand, type CommandContext } from './commands.js';

export interface REPLOptions {
  provider: LLMProvider;
  workingDirectory: string;
}

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
    this.renderer = new Renderer();
    this.commandCtx = {
      conversation: this.conversation,
      git: this.git,
      provider: options.provider,
      workingDirectory: options.workingDirectory,
    };
  }

  async start(): Promise<void> {
    this.renderer.renderWelcome();

    const rl = readline.createInterface({ input, output, terminal: true });

    // Handle Ctrl+C: abort current request, don't exit
    process.on('SIGINT', () => {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.renderer.endStream();
        console.error(chalk.yellow('\n⚠ Request cancelled.'));
        rl.prompt();
      } else {
        // No active request — exit
        console.error(chalk.gray('\nBye!'));
        rl.close();
        process.exit(0);
      }
    });

    rl.setPrompt(chalk.bold.green('> '));

    while (true) {
      rl.prompt();
      let userInput: string;
      try {
        const line = await rl.question('');
        userInput = line.trim();
      } catch {
        // EOF or readline closed
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
          const continuation = await rl.question(chalk.gray('... '));
          fullInput += continuation;
        } catch {
          break;
        }
      }

      // Run agent loop
      this.abortController = new AbortController();
      try {
        // Auto-checkpoint before running agent (if in git repo)
        await this.maybeCheckpoint();

        const history = this.conversation.getMessages();
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

    rl.close();
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
