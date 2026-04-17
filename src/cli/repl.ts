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
import type { SkillManager } from '../skills/manager.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionLogger } from '../observability/session-logger.js';

type CompletionEntry = { name: string; description: string };

let completionEntries: CompletionEntry[] = commands.map((c) => ({
  name: c.name,
  description: c.description,
}));

function refreshCompletionEntries(skillManager?: SkillManager): void {
  const base: CompletionEntry[] = commands.map((c) => ({ name: c.name, description: c.description }));
  const skills = skillManager?.list() ?? [];
  const skillEntries: CompletionEntry[] = skills.map((s) => ({
    name: `/${s.name}`,
    description: s.description ? `Skill — ${s.description}` : 'Skill',
  }));

  completionEntries = [...base, ...skillEntries];
}

export interface REPLOptions {
  provider: LLMProvider;
  workingDirectory: string;
  memoryManager: MemoryManager;
  renderer?: Renderer;
  mcpManager?: McpManager;
  skillManager?: SkillManager;
  hookManager?: HookManager;
  sessionLogger?: SessionLogger;
}

const replPrompt = createPrompt<string, { message: string }>((config, done) => {
  const [value, setValue] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [isDone, setIsDone] = useState(false);

  const isCommand = value.startsWith('/');
  const hasSpace = value.includes(' ');
  const suggestions = (isCommand && !hasSpace)
    ? completionEntries.filter(c => c.name.startsWith(value))
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
  private sessionLogger?: SessionLogger;

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
      skillManager: options.skillManager,
      hookManager: options.hookManager,
    };

    this.sessionLogger = options.sessionLogger;

    refreshCompletionEntries(options.skillManager);
  }

  private buildSkillInvocation(input: string): string | null {
    const manager = this.commandCtx.skillManager;
    if (!manager) return null;
    if (!input.startsWith('/')) return null;

    const space = input.indexOf(' ');
    const rawName = (space === -1 ? input.slice(1) : input.slice(1, space)).trim();
    const args = (space === -1 ? '' : input.slice(space + 1)).trim();
    if (!rawName) return null;

    const skill = manager.get(rawName);
    if (!skill) return null;

    const meta = [
      `name: ${skill.name}`,
      skill.type ? `type: ${skill.type}` : null,
      skill.description ? `description: ${skill.description}` : null,
      `source: ${skill.sourcePath}`,
    ].filter(Boolean).join('\n');

    return [
      `你正在使用一个可挂载 Skill：${skill.name}`,
      `请将下方 SKILL 内容视为本次请求的“最高优先级工作指令”。`,
      `如果 SKILL 与系统提示冲突，优先遵循 SKILL 的硬性约束（Hard constraints）。`,
      `\n<<SKILL_META>>\n${meta}\n<</SKILL_META>>`,
      `\n<<SKILL>>\n${skill.content}\n<</SKILL>>`,
      `\n<<USER_INPUT>>\n${args || '(no extra args)'}\n<</USER_INPUT>>`,
    ].join('\n');
  }

  async start(): Promise<void> {
    this.renderer.renderWelcome();
    if (this.commandCtx.hookManager) {
      await this.commandCtx.hookManager.emitSessionStart('startup');
    }

    // Handle Ctrl+C: abort current request, don't exit
    process.on('SIGINT', () => {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.renderer.endStream();
        console.error(chalk.yellow('\n⚠ Request cancelled.'));
      } else {
        // No active request — exit
        if (this.commandCtx.hookManager) {
          this.commandCtx.hookManager.emitSessionEnd('other').catch(() => {});
        }
        console.error(chalk.gray('\nBye!'));
        process.exit(0);
      }
    });

    while (true) {
      let userInput: string;
      try {
        const line = await replPrompt({
          message: chalk.cyan.bold('❯ '),
        });
        userInput = line.trim();
      } catch (err: any) {
        if (err.name === 'ExitPromptError') {
          if (this.commandCtx.hookManager) {
            await this.commandCtx.hookManager.emitSessionEnd('prompt_input_exit');
          }
          console.error(chalk.gray('\nBye!'));
          break;
        }
        if (this.commandCtx.hookManager) {
          await this.commandCtx.hookManager.emitSessionEnd('other');
        }
        break;
      }

      if (!userInput) continue;
      await this.sessionLogger?.log('user_input', { input: userInput });

      // Handle slash commands
      if (userInput.startsWith('/')) {
        const hooks = this.commandCtx.hookManager;
        const before = hooks ? await hooks.emitBeforeExecuteCommand(userInput) : { input: userInput, bypass: false };
        userInput = before.input;

        const result = before.bypass ? 'handled' : await executeCommand(userInput, this.commandCtx);
        if (hooks) {
          await hooks.emitAfterExecuteCommand(userInput, result);
        }
        await this.sessionLogger?.log('slash_command', { input: userInput, result });
        if (result === 'exit') {
          console.error(chalk.gray('Bye!'));
          break;
        }

        if (result === 'handled') {
          continue;
        }

        // Fallback: treat unknown slash command as a skill entrypoint `/<skill>`
        const skillInput = this.buildSkillInvocation(userInput);
        if (skillInput) {
          userInput = skillInput;
          // fall through to agent execution
        } else {
          continue;
        }
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
        const hooks = this.commandCtx.hookManager;
        if (hooks) {
          fullInput = await hooks.emitBeforeAgentRun(fullInput);
        }
        const updatedHistory = await this.agentLoop.run(
          fullInput,
          history,
          this.abortController.signal,
        );
        if (hooks) {
          await hooks.emitAfterAgentRun(fullInput);
        }

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
