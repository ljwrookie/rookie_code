import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../../agent/loop.js';
import { ConversationManager } from '../../agent/conversation.js';
import { executeCommand, commands, type CommandContext, type CommandPrompts } from '../commands.js';
import { GitOperations } from '../../repo/git.js';
import type { LLMProvider, LLMProviderParams, LLMResponse, StreamEvent } from '../../llm/provider.js';
import { MemoryManager } from '../../memory/manager.js';
import { MemoryStore } from '../../memory/store.js';
import { ToolRegistry } from '../../tools/registry.js';

let tempRoot: string;
let repoDir: string;
let baseDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-commands-test-'));
  repoDir = path.join(tempRoot, 'repo');
  baseDir = path.join(tempRoot, 'memory-home');

  await fs.mkdir(repoDir, { recursive: true });
  await fs.mkdir(baseDir, { recursive: true });
  run('git init', repoDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('slash memory commands', () => {
  it('shows /init and /add-store in help and completion source', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = createCommandContext(createMemoryManager());

    await executeCommand('/help', context);

    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('/init');
    expect(output).toContain('/add-store');
    expect(commands.some((command) => command.name === '/init')).toBe(true);
    expect(commands.some((command) => command.name === '/add-store')).toBe(true);
  });

  it('keeps unknown command handling unchanged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = createCommandContext(createMemoryManager());

    const result = await executeCommand('/does-not-exist', context);

    expect(result).toBe('unknown');
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Unknown command: /does-not-exist. Type /help for available commands.');
  });

  it('supports /init non-interactive mode and returns unchanged on idempotent replay', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const memoryManager = createMemoryManager();
    const context = createCommandContext(memoryManager);

    await executeCommand(
      '/init --persona "Senior coding partner" --tone calm --language zh-CN --verbosity concise --collaboration plan-first',
      context,
    );

    const globalRecords = await memoryManager.list('global');
    const byKey = new Map(globalRecords.map((record) => [`${record.kind}:${record.key}`, record]));
    expect(byKey.get('summary:persona')?.value).toBe('Senior coding partner');
    expect(byKey.get('preference:tone')?.value).toBe('calm');
    expect(byKey.get('preference:language')?.value).toBe('zh-CN');
    expect(byKey.get('preference:verbosity')?.value).toBe('concise');
    expect(byKey.get('preference:collaboration')?.value).toBe('plan-first');

    await executeCommand(
      '/init --persona "Senior coding partner" --tone calm --language zh-CN --verbosity concise --collaboration plan-first',
      context,
    );

    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('✔ /init set:');
    expect(output).toContain('✔ /init unchanged:');
  });

  it('supports /init wizard mode through injected prompts', async () => {
    const memoryManager = createMemoryManager();
    const prompts = createPromptStub([
      'Helpful reviewer',
      'warm',
      'en-US',
      'detailed',
      'pairing',
    ]);
    const context = createCommandContext(memoryManager, prompts);

    await executeCommand('/init', context);

    const globalRecords = await memoryManager.list('global');
    const byKey = new Map(globalRecords.map((record) => [`${record.kind}:${record.key}`, record.value]));
    expect(byKey.get('summary:persona')).toBe('Helpful reviewer');
    expect(byKey.get('preference:tone')).toBe('warm');
    expect(byKey.get('preference:language')).toBe('en-US');
    expect(byKey.get('preference:verbosity')).toBe('detailed');
    expect(byKey.get('preference:collaboration')).toBe('pairing');
  });

  it('makes shared memory immediately visible to the next agent run in the same session', async () => {
    const systems: string[] = [];
    const provider = createSystemCapturingProvider(systems);
    const memoryManager = createMemoryManager();
    const context = createCommandContext(memoryManager, undefined, provider);
    const agent = new AgentLoop(provider, new ToolRegistry(), {
      maxIterations: 2,
      workingDirectory: repoDir,
      memoryManager,
    });

    await executeCommand(
      '/init --persona "Be concise and pragmatic" --tone calm --language zh-CN --verbosity concise --collaboration plan-first',
      context,
    );
    memoryManager.advanceTurn();
    await agent.run('first turn', []);

    await executeCommand(
      '/add-store set --kind behavior --key patching --value "Prefer small, reviewable patches."',
      context,
    );
    memoryManager.advanceTurn();
    await agent.run('second turn', []);

    expect(systems[0]).toContain('### Persona Summary');
    expect(systems[0]).toContain('Be concise and pragmatic');
    expect(systems[1]).toContain('Project Instruction — patching: Prefer small, reviewable patches.');
  });

  it('supports add-store set/delete/disable/ignore and formats validation errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const memoryManager = createMemoryManager();
    const context = createCommandContext(memoryManager);

    await executeCommand('/add-store set --kind preference --key tone --value concise', context);
    const toneRecord = await memoryManager.get('project', { key: 'tone', kind: 'preference' });
    expect(toneRecord?.status).toBe('active');

    await executeCommand(`/add-store ignore --id ${toneRecord?.id ?? ''} --turns 1`, context);
    const ignoredTone = await memoryManager.get('project', { key: 'tone', kind: 'preference' });
    expect(ignoredTone?.status).toBe('ignored');
    expect(ignoredTone?.ignoreUntilTurn).toBe(1);

    await executeCommand(`/add-store ignore --id ${toneRecord?.id ?? ''} --turns 1`, context);

    await executeCommand('/add-store set --kind behavior --key patching --value "Use apply_patch for multi-line edits."', context);
    const patchingRecord = await memoryManager.get('project', { key: 'patching', kind: 'instruction' });
    await executeCommand(`/add-store disable --id ${patchingRecord?.id ?? ''}`, context);
    const disabledRecord = await memoryManager.get('project', { key: 'patching', kind: 'instruction' });
    expect(disabledRecord?.status).toBe('disabled');

    await executeCommand('/add-store set --scope global --kind persona --key coach --value "Act as an expert code coach."', context);
    const personaRecord = await memoryManager.get('global', { key: 'coach', kind: 'summary' });
    await executeCommand(`/add-store delete --id ${personaRecord?.id ?? ''}`, context);
    const deletedRecord = await memoryManager.get('global', { key: 'coach', kind: 'summary' });
    expect(deletedRecord?.status).toBe('deleted');

    await executeCommand('/add-store set --kind invalid --key foo --value bar', context);

    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('✔ /add-store set:');
    expect(output).toContain('✔ /add-store ignore:');
    expect(output).toContain('✔ /add-store unchanged:');
    expect(output).toContain('✔ /add-store disable:');
    expect(output).toContain('✔ /add-store delete:');
    expect(output).toContain('✖ /add-store INVALID_KIND:');
  });
});

function createMemoryManager(): MemoryManager {
  const store = new MemoryStore({ cwd: repoDir, baseDir });
  return new MemoryManager(store);
}

function createCommandContext(
  memoryManager: MemoryManager,
  prompts?: CommandPrompts,
  provider: LLMProvider = createNoopProvider(),
): CommandContext {
  return {
    conversation: new ConversationManager(),
    git: new GitOperations(repoDir),
    provider,
    workingDirectory: repoDir,
    memoryManager,
    prompts,
  };
}

function createPromptStub(answers: string[]): CommandPrompts {
  let index = 0;
  return {
    async input() {
      const answer = answers[index];
      index += 1;
      return answer ?? '';
    },
  };
}

function createNoopProvider(): LLMProvider {
  return createSystemCapturingProvider([]);
}

function createSystemCapturingProvider(systems: string[]): LLMProvider {
  return {
    async complete(_params: LLMProviderParams): Promise<LLMResponse> {
      throw new Error('complete() not expected in commands tests');
    },

    async *stream(params: LLMProviderParams): AsyncIterable<StreamEvent> {
      systems.push(params.system);
      yield { type: 'text_delta', text: 'ok' };
      yield {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
}

function run(command: string, cwd: string): void {
  execSync(command, {
    cwd,
    stdio: 'pipe',
  });
}
