/**
 * Slash command system for the REPL.
 *
 * Supports /help, /clear, /undo, /diff, /status, /compact, /tokens, /init, /add-store, /exit.
 */

import { input as promptInput } from '@inquirer/prompts';
import chalk from 'chalk';
import type { ConversationManager } from '../agent/conversation.js';
import { summarizeWithLLM, trimToFit } from '../agent/context.js';
import type { LLMProvider } from '../llm/provider.js';
import type { MemoryManager } from '../memory/manager.js';
import type { MemoryIgnoreInput, MemoryKind, MemoryRecord, MemoryScope, MemoryScopeInput, MemoryUpsertInput } from '../memory/types.js';
import type { GitOperations } from '../repo/git.js';
import type { McpManager } from '../mcp/manager.js';

const INIT_DEFAULTS = {
  tone: 'balanced',
  language: 'zh-CN',
  verbosity: 'concise',
  collaboration: 'plan-first',
} as const;

type AddStoreKind = 'preference' | 'behavior' | 'persona';

export interface CommandPrompts {
  input(options: { message: string; defaultValue?: string }): Promise<string>;
}

export interface CommandContext {
  conversation: ConversationManager;
  git: GitOperations;
  provider: LLMProvider;
  workingDirectory: string;
  memoryManager?: MemoryManager;
  prompts?: CommandPrompts;
  mcpManager?: McpManager;
}

export type CommandResult = 'exit' | 'handled' | 'unknown';

interface CommandDef {
  name: string;
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>;
}

interface ParsedFlags {
  flags: Map<string, string>;
  positionals: string[];
}

interface InitValues {
  persona: string;
  tone: string;
  language: string;
  verbosity: string;
  collaboration: string;
}

interface ParsedManualMemorySet {
  scope: MemoryScopeInput;
  logicalKind: AddStoreKind;
  key: string;
  value: string;
}

interface CommandActionResult {
  action: string;
  summary: string;
}

class CommandUsageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandUsageError';
  }
}

export const commands: CommandDef[] = [
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

        const oldMessages = messages.slice(0, -4);
        const recentMessages = messages.slice(-4);

        const summary = await summarizeWithLLM(oldMessages, ctx.provider);
        ctx.conversation.compact(summary, recentMessages);

        const tokensAfter = ctx.conversation.estimateTokens();
        console.error(
          chalk.green(`✔ Compacted: ${tokensBefore} → ${tokensAfter} tokens `) +
            chalk.gray(`(saved ${tokensBefore - tokensAfter})\n`),
        );
      } catch (err) {
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
    name: '/mcp',
    description: 'Show MCP servers/tools loaded from .mcp.json',
    handler: async (_args, ctx) => {
      const mcp = ctx.mcpManager;
      if (!mcp) {
        console.error(chalk.gray('MCP: disabled.\n'));
        return 'handled';
      }

      const servers = mcp.listServers();
      const tools = mcp.listMountedTools();

      if (servers.length === 0) {
        console.error(chalk.gray('MCP: no servers connected (missing or empty .mcp.json).\n'));
        return 'handled';
      }

      console.error(chalk.bold('\nMCP servers:'));
      for (const s of servers) {
        console.error(chalk.cyan(`  ${s.name}`), chalk.gray(`(${s.transport}), tools=${s.toolCount}`));
      }

      console.error(chalk.bold('\nMounted MCP tools:'));
      if (tools.length === 0) {
        console.error(chalk.gray('  (none)'));
      } else {
        for (const t of tools) {
          console.error(chalk.gray(`  - ${t}`));
        }
      }
      console.error('');
      return 'handled';
    },
  },
  {
    name: '/init',
    description: 'Initialize long-term memory defaults',
    handler: async (args, ctx) => {
      const command = '/init';
      try {
        const manager = requireMemoryManager(ctx, command);
        const values = args.trim()
          ? parseInitArgs(args)
          : await runInitWizard(manager, ctx.prompts ?? defaultCommandPrompts);
        const result = await applyInitValues(manager, values);
        printCommandSuccess(command, result.action, result.summary);
      } catch (error) {
        printCommandError(command, error);
      }
      return 'handled';
    },
  },
  {
    name: '/add-store',
    description: 'Manage manual long-term memory entries',
    handler: async (args, ctx) => {
      const command = '/add-store';
      try {
        const manager = requireMemoryManager(ctx, command);
        const action = parseAddStoreAction(args);
        let result: CommandActionResult;

        switch (action) {
          case 'set':
            result = await handleAddStoreSet(manager, args);
            break;
          case 'delete':
            result = await handleAddStoreDelete(manager, args);
            break;
          case 'disable':
            result = await handleAddStoreDisable(manager, args);
            break;
          case 'ignore':
            result = await handleAddStoreIgnore(manager, args);
            break;
          default:
            throw new CommandUsageError('UNKNOWN_ACTION', `Unsupported action: ${action}`);
        }

        printCommandSuccess(command, result.action, result.summary);
      } catch (error) {
        printCommandError(command, error);
      }
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

const defaultCommandPrompts: CommandPrompts = {
  async input(options) {
    return promptInput({
      message: options.message,
      default: options.defaultValue,
    });
  },
};

function requireMemoryManager(ctx: CommandContext, commandName: string): MemoryManager {
  if (!ctx.memoryManager) {
    throw new CommandUsageError('MEMORY_UNAVAILABLE', `${commandName} requires a configured memory manager.`);
  }

  return ctx.memoryManager;
}

function printCommandSuccess(commandName: string, action: string, summary: string): void {
  console.error(`✔ ${commandName} ${action}: ${summary}`);
}

function printCommandError(commandName: string, error: unknown): void {
  if (error instanceof CommandUsageError) {
    console.error(`✖ ${commandName} ${error.code}: ${error.message}`);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`✖ ${commandName} INTERNAL_ERROR: ${message}`);
}

function parseInitArgs(args: string): InitValues {
  const parsed = parseFlags(args, new Set(['persona', 'tone', 'language', 'verbosity', 'collaboration']));
  ensureNoPositionals(parsed.positionals);

  const persona = normalizeRequiredValue(
    requireFlag(parsed.flags, 'persona', 'Persona is required in non-interactive mode.'),
    'Persona is required in non-interactive mode.',
  );
  return {
    persona,
    tone: valueOrDefault(parsed.flags.get('tone'), INIT_DEFAULTS.tone),
    language: valueOrDefault(parsed.flags.get('language'), INIT_DEFAULTS.language),
    verbosity: valueOrDefault(parsed.flags.get('verbosity'), INIT_DEFAULTS.verbosity),
    collaboration: valueOrDefault(parsed.flags.get('collaboration'), INIT_DEFAULTS.collaboration),
  };
}

async function runInitWizard(manager: MemoryManager, prompts: CommandPrompts): Promise<InitValues> {
  const [personaRecord, toneRecord, languageRecord, verbosityRecord, collaborationRecord] = await Promise.all([
    manager.get('global', { key: 'persona', kind: 'summary' }),
    manager.get('global', { key: 'tone', kind: 'preference' }),
    manager.get('global', { key: 'language', kind: 'preference' }),
    manager.get('global', { key: 'verbosity', kind: 'preference' }),
    manager.get('global', { key: 'collaboration', kind: 'preference' }),
  ]);

  const persona = normalizeRequiredValue(
    await prompts.input({
      message: 'Persona',
      defaultValue: personaRecord?.value,
    }),
    'Persona is required.',
  );

  const tone = normalizeOptionalValue(
    await prompts.input({
      message: 'Tone',
      defaultValue: toneRecord?.value ?? INIT_DEFAULTS.tone,
    }),
    INIT_DEFAULTS.tone,
  );
  const language = normalizeOptionalValue(
    await prompts.input({
      message: 'Language',
      defaultValue: languageRecord?.value ?? INIT_DEFAULTS.language,
    }),
    INIT_DEFAULTS.language,
  );
  const verbosity = normalizeOptionalValue(
    await prompts.input({
      message: 'Verbosity',
      defaultValue: verbosityRecord?.value ?? INIT_DEFAULTS.verbosity,
    }),
    INIT_DEFAULTS.verbosity,
  );
  const collaboration = normalizeOptionalValue(
    await prompts.input({
      message: 'Collaboration',
      defaultValue: collaborationRecord?.value ?? INIT_DEFAULTS.collaboration,
    }),
    INIT_DEFAULTS.collaboration,
  );

  return {
    persona,
    tone,
    language,
    verbosity,
    collaboration,
  };
}

async function applyInitValues(manager: MemoryManager, values: InitValues): Promise<CommandActionResult> {
  const operations: Array<{ logicalKind: AddStoreKind; scope: MemoryScopeInput; key: string; value: string }> = [
    { logicalKind: 'persona', scope: 'global', key: 'persona', value: values.persona },
    { logicalKind: 'preference', scope: 'global', key: 'tone', value: values.tone },
    { logicalKind: 'preference', scope: 'global', key: 'language', value: values.language },
    { logicalKind: 'preference', scope: 'global', key: 'verbosity', value: values.verbosity },
    { logicalKind: 'preference', scope: 'global', key: 'collaboration', value: values.collaboration },
  ];

  let changedCount = 0;
  let unchangedCount = 0;

  for (const operation of operations) {
    const result = await upsertManualMemory(manager, operation);
    if (result.action === 'unchanged') {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }
  }

  if (changedCount === 0) {
    return {
      action: 'unchanged',
      summary: `global persona and default preferences already match existing memory (${unchangedCount} unchanged).`,
    };
  }

  return {
    action: 'set',
    summary: `saved global persona and default preferences (${changedCount} changed, ${unchangedCount} unchanged).`,
  };
}

function parseAddStoreAction(args: string): 'set' | 'delete' | 'disable' | 'ignore' {
  const tokens = tokenizeArgs(args);
  const action = tokens[0];

  if (!action) {
    throw new CommandUsageError('MISSING_ARGUMENT', 'Action is required. Use set, delete, disable, or ignore.');
  }

  if (action !== 'set' && action !== 'delete' && action !== 'disable' && action !== 'ignore') {
    throw new CommandUsageError('UNKNOWN_ACTION', `Unsupported action: ${action}`);
  }

  return action;
}

async function handleAddStoreSet(manager: MemoryManager, args: string): Promise<CommandActionResult> {
  const tokens = tokenizeArgs(args);
  const parsed = parseTokensToFlags(tokens.slice(1), new Set(['scope', 'kind', 'key', 'value']));
  ensureNoPositionals(parsed.positionals);

  const kind = parseAddStoreKind(requireFlag(parsed.flags, 'kind', '--kind is required for set.'));
  const key = normalizeRequiredValue(requireFlag(parsed.flags, 'key', '--key is required for set.'), '--key must not be empty.');
  const value = normalizeRequiredValue(requireFlag(parsed.flags, 'value', '--value is required for set.'), '--value must not be empty.');
  const scope = parseScope(parsed.flags.get('scope') ?? 'project');

  const result = await upsertManualMemory(manager, {
    scope,
    logicalKind: kind,
    key,
    value,
  });

  return {
    action: result.action,
    summary: `${describeScope(result.record.scope)} ${kind} ${key} (${result.record.id}) ${result.action === 'unchanged' ? 'already matches existing memory' : 'saved'}.`,
  };
}

async function handleAddStoreDelete(manager: MemoryManager, args: string): Promise<CommandActionResult> {
  const parsed = parseAddStoreMutationArgs(args, new Set(['id']));
  const record = await findRecordById(manager, requireFlag(parsed.flags, 'id', '--id is required for delete.'));
  if (!record) {
    throw new CommandUsageError('MEMORY_NOT_FOUND', 'No memory record found for the provided id.');
  }

  if (record.status === 'deleted') {
    return {
      action: 'unchanged',
      summary: `${describeMemoryRecord(record)} is already deleted.`,
    };
  }

  await manager.delete(record.scope, { id: record.id });
  return {
    action: 'delete',
    summary: `deleted ${describeMemoryRecord(record)}.`,
  };
}

async function handleAddStoreDisable(manager: MemoryManager, args: string): Promise<CommandActionResult> {
  const parsed = parseAddStoreMutationArgs(args, new Set(['id']));
  const record = await findRecordById(manager, requireFlag(parsed.flags, 'id', '--id is required for disable.'));
  if (!record) {
    throw new CommandUsageError('MEMORY_NOT_FOUND', 'No memory record found for the provided id.');
  }
  if (record.status === 'deleted') {
    throw new CommandUsageError('INVALID_STATE', 'Deleted memory cannot be disabled.');
  }
  if (record.status === 'disabled') {
    return {
      action: 'unchanged',
      summary: `${describeMemoryRecord(record)} is already disabled.`,
    };
  }

  await manager.disable(record.scope, { id: record.id });
  return {
    action: 'disable',
    summary: `disabled ${describeMemoryRecord(record)}.`,
  };
}

async function handleAddStoreIgnore(manager: MemoryManager, args: string): Promise<CommandActionResult> {
  const parsed = parseAddStoreMutationArgs(args, new Set(['id', 'turns']));
  const record = await findRecordById(manager, requireFlag(parsed.flags, 'id', '--id is required for ignore.'));
  if (!record) {
    throw new CommandUsageError('MEMORY_NOT_FOUND', 'No memory record found for the provided id.');
  }
  if (record.status === 'deleted') {
    throw new CommandUsageError('INVALID_STATE', 'Deleted memory cannot be ignored.');
  }

  const turns = parsePositiveInteger(requireFlag(parsed.flags, 'turns', '--turns is required for ignore.'), '--turns must be a positive integer.');
  const ignoreUntilTurn = manager.getCurrentTurn() + turns;

  if (record.status === 'ignored' && record.ignoreUntilTurn === ignoreUntilTurn) {
    return {
      action: 'unchanged',
      summary: `${describeMemoryRecord(record)} is already ignored for the next ${turns} turn(s).`,
    };
  }

  const input: MemoryIgnoreInput = { ignoreUntilTurn };
  await manager.ignore(record.scope, { id: record.id }, input);
  return {
    action: 'ignore',
    summary: `ignored ${describeMemoryRecord(record)} for the next ${turns} turn(s).`,
  };
}

async function upsertManualMemory(
  manager: MemoryManager,
  input: ParsedManualMemorySet,
): Promise<{ action: 'set' | 'unchanged'; record: MemoryRecord }> {
  const normalized = toMemoryUpsertInput(input);
  const existing = await manager.get(normalized.scope, {
    key: normalized.key,
    kind: normalized.kind,
  });

  if (existing && isIdempotentMatch(existing, normalized)) {
    return {
      action: 'unchanged',
      record: existing,
    };
  }

  const record = await manager.set(normalized);
  return {
    action: 'set',
    record,
  };
}

function toMemoryUpsertInput(input: ParsedManualMemorySet): MemoryUpsertInput {
  const mapping = mapLogicalKind(input.logicalKind);
  return {
    scope: input.scope,
    source: 'manual',
    kind: mapping.kind,
    key: input.key,
    value: input.value,
    status: 'active',
    priority: mapping.priority,
  };
}

function mapLogicalKind(logicalKind: AddStoreKind): { kind: MemoryKind; priority: number } {
  switch (logicalKind) {
    case 'persona':
      return { kind: 'summary', priority: 100 };
    case 'behavior':
      return { kind: 'instruction', priority: 80 };
    case 'preference':
      return { kind: 'preference', priority: 60 };
    default:
      throw new CommandUsageError('INVALID_KIND', `Unsupported memory kind: ${logicalKind}`);
  }
}

function parseAddStoreKind(value: string): AddStoreKind {
  if (value === 'preference' || value === 'behavior' || value === 'persona') {
    return value;
  }

  throw new CommandUsageError('INVALID_KIND', 'Supported kinds are preference, behavior, and persona.');
}

function parseScope(value: string): MemoryScopeInput {
  if (value === 'global' || value === 'project') {
    return value;
  }

  throw new CommandUsageError('INVALID_SCOPE', 'Supported scopes are project and global.');
}

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CommandUsageError('INVALID_TURNS', message);
  }

  return parsed;
}

function isIdempotentMatch(record: MemoryRecord, input: MemoryUpsertInput): boolean {
  return record.source === input.source
    && record.status === (input.status ?? 'active')
    && record.value === input.value
    && (record.priority === (input.priority ?? record.priority));
}

async function findRecordById(manager: MemoryManager, id: string): Promise<MemoryRecord | null> {
  const normalizedId = normalizeRequiredValue(id, '--id must not be empty.');
  const [projectRecords, globalRecords] = await Promise.all([
    manager.list('project'),
    manager.list('global'),
  ]);

  return [...projectRecords, ...globalRecords].find((record) => record.id === normalizedId) ?? null;
}

function describeMemoryRecord(record: MemoryRecord): string {
  return `${describeScope(record.scope)} ${logicalKindFromRecord(record)} ${record.key} (${record.id})`;
}

function logicalKindFromRecord(record: MemoryRecord): AddStoreKind {
  if (record.kind === 'summary') {
    return 'persona';
  }
  if (record.kind === 'instruction') {
    return 'behavior';
  }
  return 'preference';
}

function describeScope(scope: MemoryScope): string {
  return scope.level === 'project' ? 'project' : 'global';
}

function parseAddStoreMutationArgs(args: string, allowedFlags: Set<string>): ParsedFlags {
  const tokens = tokenizeArgs(args);
  if (tokens.length === 0) {
    throw new CommandUsageError('MISSING_ARGUMENT', 'Action is required.');
  }

  return parseTokensToFlags(tokens.slice(1), allowedFlags);
}

function parseFlags(args: string, allowedFlags: Set<string>): ParsedFlags {
  return parseTokensToFlags(tokenizeArgs(args), allowedFlags);
}

function parseTokensToFlags(tokens: string[], allowedFlags: Set<string>): ParsedFlags {
  const flags = new Map<string, string>();
  const positionals: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? '';

    if (!token.startsWith('--')) {
      positionals.push(token);
      index += 1;
      continue;
    }

    const equalsIndex = token.indexOf('=');
    const rawName = equalsIndex === -1 ? token.slice(2) : token.slice(2, equalsIndex);
    if (!rawName) {
      throw new CommandUsageError('INVALID_ARGUMENT', 'Flag name cannot be empty.');
    }
    if (!allowedFlags.has(rawName)) {
      throw new CommandUsageError('INVALID_ARGUMENT', `Unknown flag: --${rawName}`);
    }
    if (flags.has(rawName)) {
      throw new CommandUsageError('INVALID_ARGUMENT', `Duplicate flag: --${rawName}`);
    }

    if (equalsIndex !== -1) {
      flags.set(rawName, token.slice(equalsIndex + 1));
      index += 1;
      continue;
    }

    const nextToken = tokens[index + 1];
    if (nextToken == null || nextToken.startsWith('--')) {
      throw new CommandUsageError('MISSING_ARGUMENT', `Flag --${rawName} requires a value.`);
    }

    flags.set(rawName, nextToken);
    index += 2;
  }

  return { flags, positionals };
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new CommandUsageError('INVALID_ARGUMENT', 'Unterminated quoted value.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function ensureNoPositionals(positionals: string[]): void {
  if (positionals.length > 0) {
    throw new CommandUsageError('INVALID_ARGUMENT', `Unexpected positional arguments: ${positionals.join(' ')}`);
  }
}

function requireFlag(flags: Map<string, string>, name: string, message: string): string {
  const value = flags.get(name);
  if (value == null) {
    throw new CommandUsageError('MISSING_ARGUMENT', message);
  }
  return value;
}

function normalizeRequiredValue(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CommandUsageError('MISSING_ARGUMENT', message);
  }
  return normalized;
}

function normalizeOptionalValue(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized || fallback;
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  if (value == null) {
    return fallback;
  }

  return normalizeOptionalValue(value, fallback);
}
