import chalk from 'chalk';
import type { AgentLoop } from '../agent/loop.js';
import type { LLMProvider } from '../llm/provider.js';
import { ConversationManager } from '../agent/conversation.js';
import type { MemoryManager } from '../memory/manager.js';
import { GitOperations } from '../repo/git.js';
import { executeCommand, commands, type CommandContext } from './commands.js';
import type { McpManager } from '../mcp/manager.js';
import type { SkillManager } from '../skills/manager.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionLogger } from '../observability/session-logger.js';
import type { TerminalUI } from './terminal-ui.js';
import type { CompletionItem } from './terminal-ui.js';
import { withUiPaused } from './active-ui.js';

export interface REPLOptions {
  provider: LLMProvider;
  workingDirectory: string;
  memoryManager: MemoryManager;
  ui: TerminalUI;
  mcpManager?: McpManager;
  skillManager?: SkillManager;
  hookManager?: HookManager;
  sessionLogger?: SessionLogger;
}

/**
 * Interactive REPL for the code agent.
 */
export class REPL {
  private conversation: ConversationManager;
  private git: GitOperations;
  private ui: TerminalUI;
  private abortController: AbortController | null = null;
  private commandCtx: CommandContext;
  private sessionLogger?: SessionLogger;
  private queue: string[] = [];
  private processing = false;
  private activeInput: string | null = null;
  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;
  private windowBaseTokens = 0;

  constructor(
    private agentLoop: AgentLoop,
    options: REPLOptions,
  ) {
    this.conversation = new ConversationManager();
    this.git = new GitOperations(options.workingDirectory);
    this.ui = options.ui;
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

    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
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
    this.ui.start();
    this.ui.renderWelcome();
    if (this.commandCtx.hookManager) {
      await this.commandCtx.hookManager.emitSessionStart('startup');
    }
    await this.refreshWindowBaseTokens();
    return this.exitPromise;
  }

  getCompletions(currentInput: string): CompletionItem[] {
    const value = currentInput.trimStart();
    if (!value.startsWith('/')) return [];
    if (value.includes(' ')) return [];

    const entries: CompletionItem[] = [];
    for (const c of commands) {
      if (c.name.startsWith(value)) {
        entries.push({ name: c.name, description: c.description });
      }
    }

    const skills = this.commandCtx.skillManager?.list() ?? [];
    for (const s of skills) {
      const name = `/${s.name}`;
      if (name.startsWith(value)) {
        entries.push({ name, description: s.description ? `Skill — ${s.description}` : 'Skill' });
      }
    }

    return entries.slice(0, 20);
  }

  enqueueInput(text: string): void {
    const input = text.trim();
    if (!input) return;
    this.queue.push(input);
    this.ui.setQueueState({ activeInput: this.activeInput, pendingInputs: this.queue });
    void this.sessionLogger?.log('user_input', { input });
    void this.processQueue();
  }

  abortCurrent(): void {
    this.abortController?.abort();
  }

  exit(reason: 'other' | 'prompt_input_exit' = 'other'): void {
    void this.commandCtx.hookManager?.emitSessionEnd(reason);
    this.ui.stop();
    this.resolveExit();
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveInput(): string | null {
    return this.activeInput;
  }

  getPendingInputs(): string[] {
    return [...this.queue];
  }

  isBusy(): boolean {
    return this.abortController != null;
  }

  getTotalHistoryTokens(): number {
    return this.conversation.estimateTokens();
  }

  getWindowBaseTokens(): number {
    return this.windowBaseTokens;
  }

  getTokenBudget(): number | undefined {
    return this.agentLoop.getTokenBudget();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const input = this.queue.shift()!;
        this.activeInput = input;
        this.ui.setQueueState({ activeInput: this.activeInput, pendingInputs: this.queue });
        this.ui.appendLine(chalk.cyan.bold('❯ ') + input.replace(/\n/g, '\\n'));
        await this.handleOneInput(input);
        this.activeInput = null;
        this.ui.setQueueState({ activeInput: null, pendingInputs: this.queue });
      }
    } finally {
      this.processing = false;
    }
  }

  private async handleOneInput(userInput: string): Promise<void> {
    await this.refreshWindowBaseTokens();

    // Slash commands
    if (userInput.startsWith('/')) {
      const hooks = this.commandCtx.hookManager;
      const before = hooks ? await hooks.emitBeforeExecuteCommand(userInput) : { input: userInput, bypass: false };
      userInput = before.input;

      const result = before.bypass
        ? 'handled'
        : await this.runWithCapturedOutput(() => executeCommand(userInput, this.commandCtx));
      if (hooks) {
        await hooks.emitAfterExecuteCommand(userInput, result);
      }
      await this.sessionLogger?.log('slash_command', { input: userInput, result });
      if (result === 'exit') {
        this.exit('other');
        return;
      }
      if (result === 'handled') return;

      // Fallback: treat unknown slash command as a skill entrypoint
      const skillInput = this.buildSkillInvocation(userInput);
      if (skillInput) {
        userInput = skillInput;
      } else {
        return;
      }
    }

    this.abortController = new AbortController();
    try {
      await this.refreshWindowBaseTokens();

      const hooks = this.commandCtx.hookManager;
      if (hooks) {
        userInput = await hooks.emitBeforeAgentRun(userInput);
      }

      const history = this.conversation.getMessages();
      const turn = this.commandCtx.memoryManager?.advanceTurn();
      const updatedHistory = await this.agentLoop.run(
        userInput,
        history,
        this.abortController.signal,
      );
      if (hooks) {
        await hooks.emitAfterAgentRun(userInput);
      }

      const newMessages = updatedHistory.slice(history.length);
      this.conversation.addMessages(newMessages);
      await this.refreshWindowBaseTokens();
      if (turn != null) {
        await this.commandCtx.memoryManager?.captureAutoMemory({
          userInput,
          turn,
          scope: 'project',
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.ui.appendLine(chalk.yellow('⚠ 已取消当前请求'));
      } else if (err instanceof Error) {
        this.ui.appendLine(chalk.red(`✖ Error: ${err.message}`));
      } else {
        this.ui.appendLine(chalk.red(`✖ Error: ${String(err)}`));
      }
    } finally {
      this.abortController = null;
      this.ui.appendLine('');
    }
  }

  /**
   * Some slash commands print directly to stdout/stderr (console.error/log).
   * In TUI mode that would overwrite the input box. Capture output and append
   * it to the transcript instead.
   */
  private async runWithCapturedOutput<T>(fn: () => Promise<T>): Promise<T> {
    let buffer = '';
    const writeOut = (chunk: any): boolean => {
      buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    };

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    let result!: T;
    await withUiPaused(async () => {
      (process.stdout as any).write = writeOut;
      (process.stderr as any).write = writeOut;
      try {
        result = await fn();
      } finally {
        (process.stdout as any).write = origStdoutWrite;
        (process.stderr as any).write = origStderrWrite;
      }
    });

    const text = buffer.trimEnd();
    if (text) {
      for (const line of text.split('\n')) {
        const l = line.replace(/\r$/, '');
        if (l.trim().length === 0) continue;
        this.ui.appendLine(l);
      }
      this.ui.appendLine('');
    }

    return result;
  }

  private async refreshWindowBaseTokens(): Promise<void> {
    try {
      const history = this.conversation.getMessages();
      const tokenState = await this.agentLoop.estimatePromptTokens(history);
      this.windowBaseTokens = tokenState.totalTokens;
    } catch {
      // Non-fatal: UI can keep stale stats
    }
  }
}
