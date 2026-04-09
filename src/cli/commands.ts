/**
 * Slash command system for the REPL.
 *
 * Supports /help, /clear, /undo, /diff, /status, /compact, /tokens, /exit.
 */

import chalk from 'chalk';
import type { ConversationManager } from '../agent/conversation.js';
import type { GitOperations } from '../repo/git.js';
import type { LLMProvider } from '../llm/provider.js';
import { summarizeWithLLM, trimToFit } from '../agent/context.js';

export interface CommandContext {
  conversation: ConversationManager;
  git: GitOperations;
  provider: LLMProvider;
  workingDirectory: string;
}

export type CommandResult = 'exit' | 'handled' | 'unknown';

interface CommandDef {
  name: string;
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>;
}

const commands: CommandDef[] = [
  {
    name: '/help',
    description: 'Show available commands',
    handler: async () => {
      console.error(chalk.bold('\nAvailable commands:'));
      for (const cmd of commands) {
        console.error(chalk.cyan(`  ${cmd.name.padEnd(12)}`), chalk.gray(`— ${cmd.description}`));
      }
      console.error('');
      return 'handled';
    },
  },
  {
    name: '/clear',
    description: 'Clear conversation history',
    handler: async (_args, ctx) => {
      ctx.conversation.clear();
      console.error(chalk.green('✔ Conversation history cleared.\n'));
      return 'handled';
    },
  },
  {
    name: '/undo',
    description: 'Undo last file edit (git checkpoint rollback)',
    handler: async (_args, ctx) => {
      try {
        const isRepo = await ctx.git.isGitRepo();
        if (!isRepo) {
          console.error(chalk.yellow('⚠ Not in a git repository. Cannot undo.\n'));
          return 'handled';
        }
        const success = await ctx.git.undoLastCheckpoint();
        if (success) {
          console.error(chalk.green('✔ Reverted to previous checkpoint.\n'));
        } else {
          console.error(chalk.yellow('⚠ No checkpoint found to undo.\n'));
        }
      } catch (err) {
        console.error(chalk.red(`✖ Undo failed: ${err instanceof Error ? err.message : String(err)}\n`));
      }
      return 'handled';
    },
  },
  {
    name: '/diff',
    description: 'Show current git diff',
    handler: async (_args, ctx) => {
      try {
        const isRepo = await ctx.git.isGitRepo();
        if (!isRepo) {
          console.error(chalk.yellow('⚠ Not in a git repository.\n'));
          return 'handled';
        }
        const diff = await ctx.git.getDiff();
        if (diff.trim()) {
          console.error(chalk.bold('\nUnstaged changes:'));
          console.error(diff);
        } else {
          console.error(chalk.gray('No unstaged changes.\n'));
        }
        const staged = await ctx.git.getDiff({ staged: true });
        if (staged.trim()) {
          console.error(chalk.bold('\nStaged changes:'));
          console.error(staged);
        }
      } catch (err) {
        console.error(chalk.red(`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`));
      }
      return 'handled';
    },
  },
  {
    name: '/status',
    description: 'Show git status',
    handler: async (_args, ctx) => {
      try {
        const isRepo = await ctx.git.isGitRepo();
        if (!isRepo) {
          console.error(chalk.yellow('⚠ Not in a git repository.\n'));
          return 'handled';
        }
        const branch = await ctx.git.getCurrentBranch();
        const status = await ctx.git.getStatus();
        console.error(chalk.bold(`\nBranch: ${branch}`));
        if (status.trim()) {
          console.error(status);
        } else {
          console.error(chalk.gray('Working tree clean.\n'));
        }
      } catch (err) {
        console.error(chalk.red(`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`));
      }
      return 'handled';
    },
  },
  {
    name: '/compact',
    description: 'Compress conversation history to save tokens',
    handler: async (_args, ctx) => {
      const tokensBefore = ctx.conversation.estimateTokens();
      const messages = ctx.conversation.getRawMessages();

      if (messages.length < 4) {
        console.error(chalk.yellow('⚠ Conversation too short to compact.\n'));
        return 'handled';
      }

      try {
        console.error(chalk.gray('Compacting conversation...'));

        // Use LLM to summarize
        const oldMessages = messages.slice(0, -4); // Keep last 2 rounds
        const recentMessages = messages.slice(-4);

        const summary = await summarizeWithLLM(oldMessages, ctx.provider);
        ctx.conversation.compact(summary, recentMessages);

        const tokensAfter = ctx.conversation.estimateTokens();
        console.error(
          chalk.green(`✔ Compacted: ${tokensBefore} → ${tokensAfter} tokens `) +
          chalk.gray(`(saved ${tokensBefore - tokensAfter})\n`),
        );
      } catch (err) {
        // Fallback: use local summary
        const result = trimToFit(messages, Math.floor(tokensBefore * 0.5), 3);
        if (result.summary) {
          ctx.conversation.compact(result.summary, result.messages);
          console.error(chalk.green('✔ Compacted (local summary).\n'));
        } else {
          console.error(chalk.red(`✖ Compact failed: ${err instanceof Error ? err.message : String(err)}\n`));
        }
      }
      return 'handled';
    },
  },
  {
    name: '/tokens',
    description: 'Show current token usage',
    handler: async (_args, ctx) => {
      const tokens = ctx.conversation.estimateTokens();
      const msgCount = ctx.conversation.length;
      console.error(chalk.bold(`\nToken usage: ~${tokens} tokens`));
      console.error(chalk.gray(`Messages: ${msgCount}`));
      const summary = ctx.conversation.getSummary();
      if (summary) {
        console.error(chalk.gray(`Has summary: yes (${summary.length} chars)`));
      }
      console.error('');
      return 'handled';
    },
  },
  {
    name: '/exit',
    description: 'Exit the agent',
    handler: async () => 'exit',
  },
  {
    name: '/quit',
    description: 'Exit the agent',
    handler: async () => 'exit',
  },
];

/**
 * Execute a slash command.
 */
export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  const spaceIndex = input.indexOf(' ');
  const cmdName = spaceIndex === -1 ? input : input.substring(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : input.substring(spaceIndex + 1).trim();

  const cmd = commands.find(c => c.name === cmdName);
  if (!cmd) {
    console.error(
      chalk.yellow(`Unknown command: ${cmdName}. Type /help for available commands.\n`),
    );
    return 'unknown';
  }

  return cmd.handler(args, ctx);
}
