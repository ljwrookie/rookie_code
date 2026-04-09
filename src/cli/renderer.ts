import chalk from 'chalk';
import type { ToolResult, AgentEvent } from '../types.js';

/**
 * Minimal streaming renderer for terminal output.
 * Renders LLM text deltas, tool calls, and tool results.
 */
export class Renderer {
  private isStreaming = false;

  /** Render a text delta (streaming token) */
  renderTextDelta(text: string): void {
    if (!this.isStreaming) {
      this.isStreaming = true;
    }
    process.stdout.write(text);
  }

  /** End the current streaming text block */
  endStream(): void {
    if (this.isStreaming) {
      process.stdout.write('\n');
      this.isStreaming = false;
    }
  }

  /** Render a tool call notification */
  renderToolCall(name: string, input: Record<string, unknown>): void {
    this.endStream();
    const inputSummary = this.summarizeInput(input);
    console.error(
      chalk.yellow('  ⚙  ') +
      chalk.yellow.bold(name) +
      chalk.gray(` ${inputSummary}`),
    );
  }

  /** Render a tool result */
  renderToolResult(name: string, result: ToolResult): void {
    if (result.is_error) {
      console.error(
        chalk.red('  ✖  ') +
        chalk.red(name) +
        chalk.gray(': ') +
        chalk.red(this.truncateForDisplay(result.content, 200)),
      );
    } else {
      const preview = this.truncateForDisplay(result.content, 150);
      console.error(
        chalk.green('  ✔  ') +
        chalk.green(name) +
        chalk.gray(': ') +
        chalk.gray(preview),
      );
    }
  }

  /** Render an error */
  renderError(error: Error): void {
    this.endStream();
    console.error(chalk.red('\n  ✖  Error: ') + error.message);
  }

  /** Render welcome message */
  renderWelcome(): void {
    const logo = `
  ____              _    _          ____          _      
 |  _ \\ ___   ___ | | _(_) ___    / ___|___   __| | ___ 
 | |_) / _ \\ / _ \\| |/ / |/ _ \\  | |   / _ \\ / _\` |/ _ \\
 |  _ < (_) | (_) |   <| |  __/  | |__| (_) | (_| |  __/
 |_| \\_\\___/ \\___/|_|\\_\\_|\\___|   \\____\\___/ \\__,_|\\___|
`;
    console.error(chalk.cyan.bold(logo));
    console.error(chalk.white.bold('  Welcome to Rookie Code v0.1.0 🤖\n'));

    console.error(chalk.gray('  💡 Tips:'));
    console.error(chalk.gray('  • Type your request and press ') + chalk.white('Enter') + chalk.gray(' to execute.'));
    console.error(chalk.gray('  • Use ') + chalk.white('\\') + chalk.gray(' at the end of a line for multi-line input.'));
    console.error(chalk.gray('  • Type ') + chalk.white('/help') + chalk.gray(' to see available commands (e.g., /undo, /clear).'));
    console.error(chalk.gray('  • Type ') + chalk.white('/exit') + chalk.gray(' to quit the application.\n'));
  }

  /** Handle an agent event */
  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.renderTextDelta(event.data as string);
        break;

      case 'tool_call': {
        const tc = event.data as { id: string; name: string; input?: Record<string, unknown> };
        this.renderToolCall(tc.name, tc.input ?? {});
        break;
      }

      case 'tool_result': {
        const tr = event.data as { name: string; result: ToolResult };
        this.renderToolResult(tr.name, tr.result);
        break;
      }

      case 'error':
        this.renderError(event.data as Error);
        break;
    }
  }

  private summarizeInput(input: Record<string, unknown>): string {
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

  private truncateForDisplay(text: string, maxLen: number): string {
    const singleLine = text.replace(/\n/g, ' ').trim();
    if (singleLine.length <= maxLen) return singleLine;
    return singleLine.slice(0, maxLen - 3) + '...';
  }
}
