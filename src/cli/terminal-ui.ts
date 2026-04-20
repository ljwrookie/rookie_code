import chalk from 'chalk';
import type { AgentEvent, ToolResult } from '../types.js';
import { countTokens } from '../utils/tokens.js';
import { registerActiveUI } from './active-ui.js';

type StatsProvider = () => {
  totalHistoryTokens: number;
  windowBaseTokens: number;
  tokenBudget?: number;
  queueSize: number;
  busy: boolean;
};

type Handlers = {
  onSubmit: (text: string) => void;
  onExit: () => void;
  onAbort: () => void;
};

export type CompletionItem = { name: string; description: string };
export type CompletionProvider = (input: string) => CompletionItem[];

const ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  altScreenOn: '\x1b[?1049h',
  altScreenOff: '\x1b[?1049l',
  wrapOff: '\x1b[?7l',
  wrapOn: '\x1b[?7h',
  // Alternate scroll keeps click selection behavior untouched while allowing wheel
  // to act as up/down scrolling in many terminals when alt screen is active.
  altScrollOn: '\x1b[?1007h',
  altScrollOff: '\x1b[?1007l',
};

export class TerminalUI {
  private transcript: string[] = [];
  private streamText = '';
  private pendingInputs: string[] = [];
  private activeInput: string | null = null;

  private welcome: { provider?: string; model?: string } = {};
  private inputValue = '';
  private cursor = 0;
  private scrollOffset = 0;

  private paused = false;
  private started = false;
  private needsRender = false;
  private inputBuf = '';
  private decoder = new TextDecoder('utf-8');

  private completionProvider: CompletionProvider | null = null;
  private activeCompletionIdx = 0;
  private completionScroll = 0;
  private lastCompletionKey = '';

  constructor(
    private statsProvider: StatsProvider,
    private handlers: Handlers,
  ) {}

  setWelcomeInfo(info: { provider?: string; model?: string }): void {
    this.welcome = { ...this.welcome, ...info };
  }

  setQueueState(state: { activeInput: string | null; pendingInputs: string[] }): void {
    this.activeInput = state.activeInput;
    this.pendingInputs = [...state.pendingInputs];
    this.scheduleRender();
  }

  setCompletionProvider(provider: CompletionProvider | null): void {
    this.completionProvider = provider;
    this.activeCompletionIdx = 0;
    this.completionScroll = 0;
    this.lastCompletionKey = '';
    this.scheduleRender();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Use alternate screen buffer so the UI does not pollute scrollback.
    // Disable line wrapping to avoid cursor/box misalignment.
    process.stdout.write(ANSI.altScreenOn + ANSI.wrapOff + ANSI.altScrollOn);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }
    process.stdin.on('data', this.onData);
    process.stdout.on('resize', this.onResize);
    registerActiveUI(this);
    this.render();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.paused = false;
    process.stdin.off('data', this.onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    this.clearScreen();
    process.stdout.write(ANSI.home + ANSI.showCursor);
    process.stdout.write(ANSI.altScrollOff + ANSI.wrapOn + ANSI.altScreenOff);
    process.stdout.off('resize', this.onResize);
    registerActiveUI(null);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    process.stdout.write(ANSI.showCursor);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Some prompt libraries (e.g. @inquirer/prompts) pause stdin when they finish.
    // A paused stdin does not keep the event loop alive, so the CLI may exit right
    // after the prompt completes. Ensure stdin is flowing again.
    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.setRawMode(true);
    }
    this.scheduleRender();
  }

  suspendForPrompt(): void {
    if (!this.started) return;
    this.pause();
    // Prompts expect cooked mode; also reduces interference with key handling.
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    this.clearScreen();
    process.stdout.write(ANSI.home + ANSI.showCursor + ANSI.wrapOn);
  }

  resumeFromPrompt(): void {
    if (!this.started) return;
    process.stdout.write(ANSI.wrapOff);
    this.resume();
  }

  appendLine(line: string): void {
    this.flushStream();
    // Allow callers to pass multi-line strings; keep transcript line-based.
    for (const l of String(line).split('\n')) {
      this.transcript.push(l);
    }
    this.trimTranscript();
    this.scheduleRender();
  }

  appendTextDelta(delta: string): void {
    this.streamText += delta;
    this.scheduleRender();
  }

  renderWelcome(): void {
    // Make welcome part of the transcript so it scrolls away as output grows.
    const cols = Math.max(20, (process.stdout.columns ?? 80) - 2);
    const bigLogo = [
      '  ____              _    _          ____          _      ',
      ' |  _ \\ ___   ___ | | _(_) ___    / ___|___   __| | ___ ',
      " | |_) / _ \\ / _ \\| |/ / |/ _ \\  | |   / _ \\ / _` |/ _ \\",
      ' |  _ < (_) | (_) |   <| |  __/  | |__| (_) | (_| |  __/',
      ' |_| \\_\\___/ \\___/|_|\\_\\_|\\___|   \\____\\___/ \\__,_|\\___|',
    ];
    const smallLogo = [
      'Rookie Code',
    ];

    const logoLines = cols >= 72 ? bigLogo : smallLogo;
    for (const line of logoLines) {
      this.appendLine(chalk.cyan(sliceByColumns(line, 0, cols)));
    }
    this.appendLine(chalk.cyan.bold('Rookie Code'));
    if (this.welcome.provider || this.welcome.model) {
      const p = this.welcome.provider ? `provider=${this.welcome.provider}` : null;
      const m = this.welcome.model ? `model=${this.welcome.model}` : null;
      this.appendLine(chalk.gray(`LLM: ${(p && m) ? `${p}, ${m}` : (p ?? m ?? '')}`));
    }
    this.appendLine(chalk.gray('使用提示：'));
    this.appendLine(chalk.gray('- 回车：发送（执行中会进入队列）'));
    this.appendLine(chalk.gray('- Ctrl+J：插入换行（输入框内用 ↩ 显示）'));
    this.appendLine(chalk.gray('- Ctrl+C：运行中取消；空闲时退出'));
    this.appendLine('');
  }

  handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta':
        if (typeof event.data === 'string') this.appendTextDelta(event.data);
        break;
      case 'tool_call': {
        this.flushStream();
        const tc = event.data as { name: string; input?: Record<string, unknown> };
        const depth = event.depth ?? 0;
        const indent = '  '.repeat(Math.max(0, depth));
        const summary = summarizeInput(tc.input ?? {});
        this.appendLine(indent + chalk.yellow('⚙ ') + chalk.yellow.bold(tc.name) + chalk.gray(` ${summary}`));
        break;
      }
      case 'tool_result': {
        this.flushStream();
        const tr = event.data as { name: string; result: ToolResult };
        const depth = event.depth ?? 0;
        const indent = '  '.repeat(Math.max(0, depth));
        if (tr.result.is_error) {
          this.appendLine(indent + chalk.red('✖ ') + chalk.red(tr.name) + chalk.gray(': ') + chalk.red(tr.result.content));
        } else {
          this.appendLine(indent + chalk.green('✔ ') + chalk.green(tr.name));
        }
        break;
      }
      case 'agent_start': {
        this.flushStream();
        const depth = event.depth ?? 0;
        const indent = '  '.repeat(Math.max(0, depth));
        const data = event.data as any;
        const mode = typeof data?.mode === 'string' ? data.mode : 'agent';
        const task = typeof data?.task === 'string' ? data.task : '';
        this.appendLine(indent + chalk.cyan('↳ ') + chalk.cyan.bold(mode) + chalk.gray(task ? `: ${task}` : ''));
        break;
      }
      case 'agent_end': {
        this.flushStream();
        const depth = event.depth ?? 0;
        const indent = '  '.repeat(Math.max(0, depth));
        const data = event.data as any;
        const mode = typeof data?.mode === 'string' ? data.mode : 'agent';
        const ok = data?.ok !== false;
        this.appendLine(indent + (ok ? chalk.cyan('↲ ') + chalk.cyan.bold(mode) + chalk.gray(' done') : chalk.red('↲ ') + chalk.red.bold(mode) + chalk.red(' failed')));
        break;
      }
      case 'notification': {
        this.flushStream();
        const notif = event.data as { title: string; message: string; notification_type: string };
        const color = notif.notification_type === 'error' ? chalk.red : notif.notification_type === 'warning' ? chalk.yellow : chalk.cyan;
        this.appendLine(color('🔔 ') + color.bold(notif.title) + chalk.gray(` ${notif.message}`));
        break;
      }
      case 'error': {
        this.flushStream();
        const err = event.data as Error;
        this.appendLine(chalk.red('✖ Error: ') + (err?.message ?? String(err)));
        break;
      }
      default:
        break;
    }
  }

  private onResize = (): void => {
    this.scheduleRender();
  };

  private onData = (chunk: Buffer): void => {
    const s = this.decoder.decode(chunk, { stream: true });
    if (this.paused) return;
    this.inputBuf += s;
    if (this.inputBuf.length > 8192) this.inputBuf = this.inputBuf.slice(-4096);
    this.consumeInputBuffer();
  };

  private consumeInputBuffer(): void {
    while (this.inputBuf.length > 0) {
      // Mouse SGR (legacy fallback): ESC [ < 64 ; x ; y M  (wheel up) / 65 (wheel down)
      const mouse = this.inputBuf.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])/);
      if (mouse) {
        const code = Number.parseInt(mouse[1] ?? '', 10);
        if (code === 64) this.scrollOffset = Math.min(this.scrollOffset + 3, 10_000);
        if (code === 65) this.scrollOffset = Math.max(this.scrollOffset - 3, 0);
        this.inputBuf = this.inputBuf.slice(mouse[0].length);
        this.scheduleRender();
        continue;
      }

      // Escape sequences (arrows, page up/down, delete, alt+arrows)
      if (this.inputBuf.startsWith('\x1b')) {
        // Arrow keys in "application cursor" mode: ESC O A/B/C/D (common in some terminals)
        const appArrow = this.inputBuf.match(/^\x1bO([ABCD])/);
        if (appArrow) {
          const dir = appArrow[1];
          if (dir === 'A') this.scrollOffset = Math.min(this.scrollOffset + 2, 10_000);
          if (dir === 'B') this.scrollOffset = Math.max(this.scrollOffset - 2, 0);
          if (dir === 'C') this.cursor = Math.min(this.inputValue.length, this.cursor + 1);
          if (dir === 'D') this.cursor = Math.max(0, this.cursor - 1);
          this.inputBuf = this.inputBuf.slice(appArrow[0].length);
          this.scheduleRender();
          continue;
        }

        // Modified arrow keys: ESC [ 1 ; <mod> A/B/C/D (e.g. Shift/Ctrl)
        // We treat modified Left/Right as normal cursor moves, and Up/Down as scroll.
        const modArrow = this.inputBuf.match(/^\x1b\[(?:1;(\d+))([ABCD])/);
        if (modArrow) {
          const dir = modArrow[2];
          if (dir === 'A') this.scrollOffset = Math.min(this.scrollOffset + 2, 10_000);
          if (dir === 'B') this.scrollOffset = Math.max(this.scrollOffset - 2, 0);
          if (dir === 'C') this.cursor = Math.min(this.inputValue.length, this.cursor + 1);
          if (dir === 'D') this.cursor = Math.max(0, this.cursor - 1);
          this.inputBuf = this.inputBuf.slice(modArrow[0].length);
          this.scheduleRender();
          continue;
        }

        // Alt+Up/Down: ESC [ 1 ; 3 A/B
        const altArrow = this.inputBuf.match(/^\x1b\[(\d+);3([ABCD])/);
        if (altArrow) {
          const dir = altArrow[2];
          if (dir === 'A') this.scrollOffset = Math.min(this.scrollOffset + 2, 10_000);
          if (dir === 'B') this.scrollOffset = Math.max(this.scrollOffset - 2, 0);
          this.inputBuf = this.inputBuf.slice(altArrow[0].length);
          this.scheduleRender();
          continue;
        }

        // Arrow keys: ESC [ A/B/C/D
        const arrow = this.inputBuf.match(/^\x1b\[([ABCD])/);
        if (arrow) {
          const dir = arrow[1];
          const completions = this.getCompletions();
          if ((dir === 'A' || dir === 'B') && completions.length > 0) {
            if (dir === 'A') this.activeCompletionIdx = this.activeCompletionIdx > 0 ? this.activeCompletionIdx - 1 : completions.length - 1;
            else this.activeCompletionIdx = this.activeCompletionIdx < completions.length - 1 ? this.activeCompletionIdx + 1 : 0;
            this.ensureCompletionVisible(completions.length);
          } else {
            if (dir === 'A') this.scrollOffset = Math.min(this.scrollOffset + 2, 10_000);
            if (dir === 'B') this.scrollOffset = Math.max(this.scrollOffset - 2, 0);
            if (dir === 'C') this.cursor = Math.min(this.inputValue.length, this.cursor + 1);
            if (dir === 'D') this.cursor = Math.max(0, this.cursor - 1);
          }
          this.inputBuf = this.inputBuf.slice(arrow[0].length);
          this.scheduleRender();
          continue;
        }

        // PageUp/PageDown: ESC [ 5~ / 6~
        const page = this.inputBuf.match(/^\x1b\[(5|6)~/);
        if (page) {
          if (page[1] === '5') this.scrollOffset = Math.min(this.scrollOffset + 10, 10_000);
          else this.scrollOffset = Math.max(this.scrollOffset - 10, 0);
          this.inputBuf = this.inputBuf.slice(page[0].length);
          this.scheduleRender();
          continue;
        }

        // Delete: ESC [ 3~
        if (this.inputBuf.startsWith('\x1b[3~')) {
          if (this.cursor < this.inputValue.length) {
            this.inputValue = this.inputValue.slice(0, this.cursor) + this.inputValue.slice(this.cursor + 1);
            this.activeCompletionIdx = 0;
          }
          this.inputBuf = this.inputBuf.slice(4);
          this.scheduleRender();
          continue;
        }

        // Home/End: ESC [ H/F
        const hf = this.inputBuf.match(/^\x1b\[([HF])/);
        if (hf) {
          if (hf[1] === 'H') this.cursor = 0;
          else this.cursor = this.inputValue.length;
          this.inputBuf = this.inputBuf.slice(hf[0].length);
          this.scheduleRender();
          continue;
        }

        // Unrecognized ESC sequence: consume the whole control sequence to avoid
        // leaking bytes like O/B/A into the input buffer on trackpad scroll.
        const unknownEsc = this.inputBuf.match(/^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)/);
        if (unknownEsc) this.inputBuf = this.inputBuf.slice(unknownEsc[0].length);
        else this.inputBuf = this.inputBuf.slice(1);
        continue;
      }

      const ch = this.inputBuf[0]!;
      // Ctrl+C
      if (ch === '\x03') {
        const { busy } = this.statsProvider();
        if (busy) this.handlers.onAbort();
        else this.handlers.onExit();
        this.inputBuf = this.inputBuf.slice(1);
        continue;
      }
      // Enter
      if (ch === '\r') {
        const trimmed = this.inputValue.trimEnd();
        if (trimmed) {
          if (trimmed.endsWith('\\')) {
            const idx = trimmed.lastIndexOf('\\');
            const before = this.inputValue.slice(0, idx);
            const after = this.inputValue.slice(idx + 1);
            this.inputValue = before + '\n' + after;
            this.cursor = Math.min(this.cursor, this.inputValue.length);
          } else {
            const submitted = this.inputValue;
            this.inputValue = '';
            this.cursor = 0;
            this.handlers.onSubmit(submitted);
          }
        } else {
          this.inputValue = '';
          this.cursor = 0;
        }
        this.inputBuf = this.inputBuf.slice(1);
        this.scheduleRender();
        continue;
      }
      // Tab
      if (ch === '\t') {
        const completions = this.getCompletions();
        if (completions.length > 0) {
          const selected = completions[this.activeCompletionIdx];
          if (selected?.name) {
            this.inputValue = selected.name + ' ';
            this.cursor = this.inputValue.length;
          }
        }
        this.inputBuf = this.inputBuf.slice(1);
        this.scheduleRender();
        continue;
      }
      // Backspace
      if (ch === '\x7f') {
        if (this.cursor > 0) {
          this.inputValue = this.inputValue.slice(0, this.cursor - 1) + this.inputValue.slice(this.cursor);
          this.cursor -= 1;
          this.activeCompletionIdx = 0;
          this.completionScroll = 0;
        }
        this.inputBuf = this.inputBuf.slice(1);
        this.scheduleRender();
        continue;
      }
      // Ctrl+J (LF)
      if (ch === '\x0a') {
        this.insertText('\n');
        this.inputBuf = this.inputBuf.slice(1);
        continue;
      }

      // Regular character. (We consume one JS code unit; decoder ensures complete UTF-8)
      this.insertText(ch);
      this.inputBuf = this.inputBuf.slice(1);
    }
  }

  private insertText(text: string): void {
    this.inputValue = this.inputValue.slice(0, this.cursor) + text + this.inputValue.slice(this.cursor);
    this.cursor += text.length;
    this.activeCompletionIdx = 0;
    this.completionScroll = 0;
    this.scheduleRender();
  }

  private flushStream(): void {
    if (!this.streamText) return;
    const lines = this.streamText.split('\n');
    for (const l of lines) this.transcript.push(l);
    this.streamText = '';
    this.trimTranscript();
  }

  private trimTranscript(): void {
    // Keep memory bounded
    if (this.transcript.length > 5000) {
      this.transcript = this.transcript.slice(-4000);
    }
  }

  private scheduleRender(): void {
    if (this.needsRender) return;
    this.needsRender = true;
    setTimeout(() => {
      this.needsRender = false;
      this.render();
    }, 16);
  }

  private clearScreen(): void {
    process.stdout.write(ANSI.clear + ANSI.home);
  }

  private render(): void {
    if (!this.started || this.paused) return;

    const cols = process.stdout.columns ?? 100;
    const rows = process.stdout.rows ?? 30;
    // Avoid terminal auto-wrap issues by never printing a full-width line.
    // We leave the last terminal column unused.
    const printCols = Math.max(20, cols - 1);
    const headerHeight = 0;
    const footerLines = 2;
    const completions = this.getCompletions();
    const completionLines = Math.min(6, completions.length);
    const pendingView = this.renderPendingInputs(printCols);
    const pendingLines = pendingView.length;
    const boxWidth = Math.max(20, printCols);
    const box = this.renderInputBox(boxWidth);
    const boxLines = box.length;

    const reserved = headerHeight + boxLines + footerLines + completionLines + pendingLines;
    const outHeight = Math.max(3, rows - reserved);

    const stats = this.statsProvider();
    const inputTokens = countTokens(this.inputValue);
    const totalTokens = stats.totalHistoryTokens + 4 + inputTokens;
    const windowTokens = stats.windowBaseTokens + 4 + inputTokens;
    const pct = stats.tokenBudget ? Math.round((windowTokens / stats.tokenBudget) * 100) : null;

    const footer1 = chalk.gray('\\ 续行 · / 命令 · Ctrl+C 取消');
    const pctStr = pct == null ? '' : `${pct}%`;
    const pctColor = pct == null ? chalk.gray : pct >= 90 ? chalk.red : pct >= 75 ? chalk.yellow : chalk.green;
    const footer2 = stats.tokenBudget
      ? chalk.gray(`Tokens 总量 ${totalTokens} · 上下文 ${windowTokens}/${stats.tokenBudget}（${pctColor(pctStr)}） · 队列 ${stats.queueSize}${stats.busy ? chalk.yellow(' · 运行中') : ''}`)
      : chalk.gray(`Tokens 总量 ${totalTokens} · 上下文 ${windowTokens} · 队列 ${stats.queueSize}${stats.busy ? chalk.yellow(' · 运行中') : ''}`);

    const outputLines = this.buildOutputLines(printCols, outHeight);

    const completionView = this.renderCompletions(printCols, completions);

    const screen: string[] = [];
    for (const l of outputLines) screen.push(padToCols(l, printCols));
    for (const l of pendingView) screen.push(padToCols(l, printCols));
    for (const l of completionView) screen.push(padToCols(l, printCols));
    for (const l of box) screen.push(padToCols(l, printCols));
    screen.push(padToCols(footer1, printCols));
    screen.push(padToCols(footer2, printCols));
    // Ensure we always fill the terminal height so cursor math stays stable.
    while (screen.length < rows) screen.push('');
    if (screen.length > rows) screen.length = rows;

    process.stdout.write(ANSI.hideCursor);
    this.clearScreen();
    process.stdout.write(screen.join('\n'));

    // Place cursor inside the input box content line.
    const cursorPos = this.getCursorPositionInBox(printCols, rows, boxWidth, completionLines, boxLines);
    process.stdout.write(`\x1b[${cursorPos.row};${cursorPos.col}H`);
    process.stdout.write(ANSI.showCursor);
  }

  private buildOutputLines(cols: number, outHeight: number): string[] {
    const all = [...this.transcript];
    if (this.streamText) {
      all.push(...this.streamText.split('\n'));
    }
    const wrapped: string[] = [];
    for (const line of all) {
      wrapped.push(...wrapAnsi(line, cols));
    }

    const maxScroll = Math.max(0, wrapped.length - outHeight);
    if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

    const startFromEnd = Math.max(0, wrapped.length - outHeight - this.scrollOffset);
    const slice = wrapped.slice(startFromEnd, startFromEnd + outHeight);
    while (slice.length < outHeight) slice.unshift('');
    return slice.map((l) => l.padEnd(Math.max(0, cols - visibleLen(l))) + '');
  }

  private renderInputBox(cols: number): string[] {
    const w = Math.max(20, cols);
    const inner = w - 2;
    const top = '╭' + '─'.repeat(inner) + '╮';
    const bottom = '╰' + '─'.repeat(inner) + '╯';
    const prompt = '> ';

    const inputLayout = this.buildInputLayout(inner, prompt, 6);
    const lines: string[] = [top];

    for (let i = 0; i < inputLayout.visibleLines.length; i++) {
      const line = inputLayout.visibleLines[i]!;
      const prefix = i === 0 ? prompt : ' '.repeat(prompt.length);
      const pad = ' '.repeat(Math.max(0, inner - stringWidth(prefix + line)));
      lines.push('│' + prefix + line + pad + '│');
    }

    lines.push(bottom);
    return lines;
  }

  private getCompletions(): CompletionItem[] {
    const key = `${this.inputValue}#${this.cursor}`;
    if (key !== this.lastCompletionKey) {
      this.lastCompletionKey = key;
      // Reset selection whenever input changes.
      this.activeCompletionIdx = 0;
      this.completionScroll = 0;
    }
    if (!this.completionProvider) return [];
    try {
      const list = this.completionProvider(this.inputValue) ?? [];
      if (list.length === 0) return [];
      if (this.activeCompletionIdx >= list.length) this.activeCompletionIdx = 0;
      this.ensureCompletionVisible(list.length);
      return list;
    } catch {
      return [];
    }
  }

  private renderPendingInputs(cols: number): string[] {
    const lines: string[] = [];
    if (this.activeInput) {
      lines.push(chalk.yellow('处理中'));
      lines.push(chalk.yellow('› ') + sliceByColumns(this.activeInput.replace(/\n/g, ' ↩ '), 0, Math.max(0, cols - 2)));
    }
    if (this.pendingInputs.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(chalk.gray(`待处理队列（${this.pendingInputs.length}）`));
      for (const input of this.pendingInputs.slice(0, 3)) {
        lines.push(chalk.cyan('… ') + sliceByColumns(input.replace(/\n/g, ' ↩ '), 0, Math.max(0, cols - 2)));
      }
      if (this.pendingInputs.length > 3) {
        lines.push(chalk.gray(`... 还有 ${this.pendingInputs.length - 3} 条`));
      }
    }
    return lines;
  }

  private renderCompletions(cols: number, list: CompletionItem[]): string[] {
    if (list.length === 0) return [];
    const max = Math.min(6, list.length);
    const lines: string[] = [];
    const start = Math.min(this.completionScroll, Math.max(0, list.length - max));
    const end = Math.min(list.length, start + max);
    for (let i = start; i < end; i++) {
      const item = list[i]!;
      const active = i === this.activeCompletionIdx;
      const prefix = active ? chalk.cyan('❯') : ' ';
      const name = active ? chalk.cyan(item.name) : item.name;
      const desc = chalk.gray(item.description);
      const line = `${prefix} ${name}  ${desc}`;
      lines.push(sliceByColumns(line, 0, cols));
    }
    return lines;
  }

  private ensureCompletionVisible(total: number): void {
    const max = 6;
    if (total <= max) {
      this.completionScroll = 0;
      return;
    }
    if (this.activeCompletionIdx < this.completionScroll) {
      this.completionScroll = this.activeCompletionIdx;
    } else if (this.activeCompletionIdx >= this.completionScroll + max) {
      this.completionScroll = this.activeCompletionIdx - max + 1;
    }
    const maxScroll = Math.max(0, total - max);
    if (this.completionScroll > maxScroll) this.completionScroll = maxScroll;
  }

  private getCursorPositionInBox(cols: number, rows: number, boxWidth: number, completionLines: number, boxLines: number): { row: number; col: number } {
    // Anchor cursor from the bottom so it stays correct even if some terminals wrap lines unexpectedly.
    const footerLines = 2;
    const inputLayout = this.buildInputLayout(Math.max(20, boxWidth) - 2, '> ', 6);
    const row = rows - footerLines - boxLines - completionLines + 1 + inputLayout.cursorRow;
    const col = 2 + inputLayout.cursorCol;
    return { row, col: Math.min(col, cols) };
  }

  private buildInputLayout(inner: number, prompt: string, maxVisibleRows: number): {
    visibleLines: string[];
    cursorRow: number;
    cursorCol: number;
  } {
    const available = Math.max(1, inner - prompt.length);
    const wrapped = wrapInputForBox(this.inputValue, available, this.cursor);
    const total = wrapped.lines.length;
    const cursorRowAbsolute = wrapped.cursorRow;
    const visibleCount = Math.min(maxVisibleRows, Math.max(1, total));
    const start = Math.min(
      Math.max(0, cursorRowAbsolute - Math.floor(visibleCount * 0.6)),
      Math.max(0, total - visibleCount),
    );
    const end = Math.min(total, start + visibleCount);
    const visibleLines = wrapped.lines.slice(start, end);
    const cursorRow = Math.min(visibleLines.length, Math.max(1, cursorRowAbsolute - start + 1));
    // `wrapped.cursorCol` is 0-based within the wrapped line. Terminal cursor positions
    // are 1-based, but we convert to absolute coordinates in `getCursorPositionInBox`.
    // Keep this value as a 0-based offset from the start of the box's inner area.
    const cursorCol = prompt.length + wrapped.cursorCol;
    return { visibleLines, cursorRow, cursorCol };
  }
}

function wrapInputForBox(value: string, maxCols: number, cursor: number): { lines: string[]; cursorRow: number; cursorCol: number } {
  const lines: string[] = [''];
  let row = 0;
  let col = 0;
  let cursorRow = 0;
  let cursorCol = 0;

  const markCursor = (index: number): void => {
    if (index === cursor) {
      cursorRow = row;
      cursorCol = col;
    }
  };

  markCursor(0);
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '\n') {
      row += 1;
      lines.push('');
      col = 0;
      markCursor(i + 1);
      continue;
    }

    const w = stringWidth(ch);
    if (col + w > maxCols) {
      row += 1;
      lines.push('');
      col = 0;
    }

    lines[row] += ch;
    col += w;
    markCursor(i + 1);
  }

  return { lines, cursorRow, cursorCol };
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > 60) {
      parts.push(`${key}: "${value.slice(0, 57)}..."`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join(', ');
}

function visibleLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function wrapAnsi(line: string, cols: number): string[] {
  if (cols <= 0) return [''];
  const raw = stripAnsi(line);
  if (stringWidth(raw) <= cols) return [line];

  // Best-effort wrapping: strip ANSI for width calc, but keep original as plain.
  // To avoid complex ANSI reflow, we wrap the stripped text.
  const out: string[] = [];
  let offset = 0;
  while (offset < stringWidth(raw)) {
    out.push(sliceByColumns(raw, offset, cols));
    offset += cols;
  }
  return out;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function padToCols(s: string, cols: number): string {
  const len = stringWidth(s);
  if (len >= cols) return s.slice(0, cols);
  return s + ' '.repeat(cols - len);
}

function stringWidth(input: string): number {
  const s = stripAnsi(input);
  let width = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    width += wcwidth(code);
  }
  return width;
}

function sliceByColumns(input: string, startCols: number, maxCols: number): string {
  if (maxCols <= 0) return '';
  const s = stripAnsi(input);
  let cols = 0;
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const w = wcwidth(code);
    const next = cols + w;
    if (next <= startCols) {
      cols = next;
      continue;
    }
    if (cols >= startCols + maxCols) break;
    if (cols + w > startCols + maxCols) break;
    out += ch;
    cols += w;
  }
  return out;
}

function wcwidth(codePoint: number): number {
  // control chars
  if (codePoint === 0) return 0;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;

  // combining marks
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return 0;
  }

  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

// Borrowed (simplified) from sindresorhus/is-fullwidth-code-point.
function isFullWidthCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f || // Hangul Jamo
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) || // CJK ...
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical forms
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK Compatibility Forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || // Emoji
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) {
    return true;
  }
  return false;
}
