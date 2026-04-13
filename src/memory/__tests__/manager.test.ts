import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentLoop } from '../../agent/loop.js';
import { buildSystemPrompt } from '../../agent/system-prompt.js';
import type { LLMProvider, LLMProviderParams, LLMResponse, StreamEvent } from '../../llm/provider.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { Tool } from '../../tools/base.js';
import type { Message, ToolResult } from '../../types.js';
import { countMessagesTokens, countPromptTokens, countTokens } from '../../utils/tokens.js';
import { MemoryManager, type MemoryStoreReader } from '../manager.js';
import { MemoryStore } from '../store.js';
import type { MemoryRecord, MemoryScopeInput, MemoryStatus } from '../types.js';

let tempRoot: string;
let repoDir: string;
let baseDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-memory-manager-test-'));
  repoDir = path.join(tempRoot, 'repo');
  baseDir = path.join(tempRoot, 'memory-home');

  await fs.mkdir(repoDir, { recursive: true });
  await fs.mkdir(baseDir, { recursive: true });
  run('git init', repoDir);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('MemoryManager', () => {
  it('returns no memory section when snapshot is empty', async () => {
    const manager = new MemoryManager(createStoreReader([], []));
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const result = await manager.buildPromptSection({
      baseSystemPrompt: 'Base system prompt',
      messages,
      tokenBudget: 1000,
    });

    expect(result.memorySection).toBeNull();
    expect(result.memoryTokens).toBe(0);
    expect(result.fallbackMode).toBe('none');
    expect(result.snapshot.global).toEqual([]);
    expect(result.snapshot.project).toEqual([]);
  });

  it('dynamically injects the latest memory into AgentLoop system prompts', async () => {
    let projectRecords: MemoryRecord[] = [];
    const systems: string[] = [];
    const provider = createProviderWithSystems(systems);
    const registry = new ToolRegistry();

    registry.register(createTool('refresh_memory', async () => {
      projectRecords = [
        createRecord({
          scope: 'project',
          source: 'manual',
          kind: 'instruction',
          key: 'diff-style',
          value: 'Keep diffs minimal and targeted.',
          priority: 20,
        }),
      ];

      return {
        tool_use_id: '',
        content: 'memory updated',
        is_error: false,
      };
    }));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 3,
      workingDirectory: '/tmp/project',
      tokenBudget: 4000,
      memoryManager: new MemoryManager({
        async list(scope: MemoryScopeInput, options?: { status?: MemoryStatus | MemoryStatus[] }) {
          const records = scope === 'global' ? [] : projectRecords;
          return filterByStatus(records, options?.status);
        },
      }),
    });

    await loop.run('refresh memory', []);

    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain('## Long-term Memory');
    expect(systems[1]).toContain('## Long-term Memory');
    expect(systems[1]).toContain('Project Instruction — diff-style: Keep diffs minimal and targeted.');
  });

  it('renders concise memory text and counts system prompt tokens together with messages', async () => {
    const projectRecords = [
      createRecord({
        scope: 'project',
        source: 'manual',
        kind: 'instruction',
        key: 'patching',
        value: 'Prefer apply_patch for multi-line edits.',
        priority: 30,
      }),
      createRecord({
        scope: 'project',
        source: 'auto',
        kind: 'fact',
        key: 'repo-root',
        value: 'The repository root is stable.',
        priority: 5,
      }),
      createRecord({
        scope: 'project',
        source: 'manual',
        kind: 'instruction',
        key: 'patching',
        value: 'Prefer apply_patch for multi-line edits.',
        priority: 10,
      }),
      createRecord({
        scope: 'project',
        source: 'manual',
        kind: 'note',
        key: 'ignored-note',
        value: 'This should stay hidden.',
        status: 'ignored',
        ignoreUntilTurn: 99,
      }),
    ];
    const manager = new MemoryManager(createStoreReader([], projectRecords), {
      getCurrentTurn: () => 4,
    });
    const messages: Message[] = [{ role: 'user', content: 'show me context' }];
    const baseSystemPrompt = buildSystemPrompt({
      workingDirectory: '/tmp/project',
      availableTools: ['read_file'],
    });

    const result = await manager.buildPromptSection({
      baseSystemPrompt,
      messages,
      tokenBudget: 4000,
    });
    const finalSystemPrompt = buildSystemPrompt({
      workingDirectory: '/tmp/project',
      availableTools: ['read_file'],
      memorySection: result.memorySection,
    });

    expect(result.fallbackMode).toBe('full');
    expect(result.memorySection).toContain('## Long-term Memory');
    expect(result.memorySection).toContain('Project Instruction — patching: Prefer apply_patch for multi-line edits.');
    expect(result.memorySection).toContain('Project Fact — repo-root: The repository root is stable.');
    expect(result.memorySection).not.toContain('ignored-note');
    expect(result.memorySection).not.toContain('{');
    expect(countPromptTokens({ system: finalSystemPrompt, messages })).toBe(
      countTokens(finalSystemPrompt) + countMessagesTokens(messages),
    );
  });

  it('falls back to persona summary plus top manual and omits memory when even fallback exceeds budget', async () => {
    const records = [
      createRecord({
        scope: 'global',
        source: 'manual',
        kind: 'summary',
        key: 'persona',
        value: 'Be concise and prefer minimal diffs.',
        priority: 40,
      }),
      createRecord({
        scope: 'project',
        source: 'manual',
        kind: 'instruction',
        key: 'huge-manual',
        value: repeatWords('oversized manual memory', 24),
        priority: 100,
      }),
      createRecord({
        scope: 'project',
        source: 'manual',
        kind: 'instruction',
        key: 'top-manual',
        value: 'Use small, reviewable patches.',
        priority: 10,
      }),
      createRecord({
        scope: 'project',
        source: 'auto',
        kind: 'fact',
        key: 'huge-auto',
        value: repeatWords('large auto memory', 24),
        priority: 1,
      }),
    ];
    const manager = new MemoryManager(createStoreReader([], records));
    const baseSystemPrompt = 'Base prompt';
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    const fallbackResult = await manager.buildPromptSection({
      baseSystemPrompt,
      messages,
      tokenBudget: 360,
    });

    expect(fallbackResult.fallbackMode).toBe('manual_only');
    expect(fallbackResult.memorySection).toContain('### Persona Summary');
    expect(fallbackResult.memorySection).toContain('Be concise and prefer minimal diffs.');
    expect(fallbackResult.memorySection).toContain('top-manual: Use small, reviewable patches.');
    expect(fallbackResult.memorySection).not.toContain('huge-auto');
    expect(fallbackResult.memorySection).not.toContain('huge-manual');

    const omittedResult = await manager.buildPromptSection({
      baseSystemPrompt,
      messages,
      tokenBudget: 40,
    });

    expect(omittedResult.fallbackMode).toBe('omitted');
    expect(omittedResult.memorySection).toBeNull();
  });

  it('promotes direct long-term statements immediately and exposes them in the next prompt', async () => {
    const manager = createPersistentManager();

    const result = await manager.captureAutoMemory({
      userInput: '以后都用中文回复。',
      turn: 1,
      scope: 'project',
    });

    expect(result.observed).toBe(1);
    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]?.status).toBe('active');

    const prompt = await manager.buildPromptSection({
      baseSystemPrompt: 'Base system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      tokenBudget: 2000,
      currentTurn: 2,
    });

    expect(prompt.memorySection).toContain('### Auto Memory');
    expect(prompt.memorySection).toContain('Project Preference — language: zh-CN');
  });

  it('requires repeated non-direct corrections across persisted turns before promotion', async () => {
    const manager1 = createPersistentManager();

    const firstCapture = await manager1.captureAutoMemory({
      userInput: '请用中文回复',
      turn: 1,
      scope: 'project',
    });

    expect(firstCapture.observed).toBe(1);
    expect(firstCapture.promoted).toHaveLength(0);
    const firstRecord = await manager1.get('project', { key: 'language', kind: 'preference' });
    expect(firstRecord?.status).toBe('candidate');
    expect(firstRecord?.evidenceTurns).toEqual([1]);

    const firstPrompt = await manager1.buildPromptSection({
      baseSystemPrompt: 'Base system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      tokenBudget: 2000,
      currentTurn: 1,
    });
    expect(firstPrompt.memorySection).toBeNull();

    const manager2 = createPersistentManager();
    const secondCapture = await manager2.captureAutoMemory({
      userInput: '请用中文回复',
      turn: 2,
      scope: 'project',
    });

    expect(secondCapture.promoted).toHaveLength(1);
    expect(secondCapture.promoted[0]?.status).toBe('active');

    const promoted = await manager2.get('project', { key: 'language', kind: 'preference' });
    expect(promoted?.status).toBe('active');
    expect(promoted?.evidenceCount).toBe(2);
    expect(promoted?.evidenceTurns).toEqual([1, 2]);

    const secondPrompt = await manager2.buildPromptSection({
      baseSystemPrompt: 'Base system prompt',
      messages: [{ role: 'user', content: 'hello again' }],
      tokenBudget: 2000,
      currentTurn: 3,
    });
    expect(secondPrompt.memorySection).toContain('Project Preference — language: zh-CN');
  });

  it('filters sensitive, transient, and code-like sentences before auto capture', async () => {
    const manager = createPersistentManager();

    const result = await manager.captureAutoMemory({
      userInput: [
        '以后记住我的 token 是 sk-abcdefghijklmnopqrst。',
        'TT123456 这个 ticket 只要今天处理。',
        'const apiKey = "secret";',
      ].join('\n'),
      turn: 1,
      scope: 'project',
    });

    expect(result.observed).toBe(0);
    expect(result.stored).toHaveLength(0);
    expect(await manager.list('project')).toEqual([]);
  });

  it('never overrides conflicting manual memory during auto capture', async () => {
    const manager = createPersistentManager();

    await manager.set({
      scope: 'project',
      source: 'manual',
      kind: 'preference',
      key: 'language',
      value: 'en-US',
      priority: 90,
      evidenceCount: 0,
      status: 'active',
    });

    const result = await manager.captureAutoMemory({
      userInput: '以后都用中文回复。',
      turn: 1,
      scope: 'project',
    });

    expect(result.promoted).toHaveLength(0);
    expect(result.protectedManual).toHaveLength(1);

    const manualRecord = await manager.get('project', { key: 'language', kind: 'preference' });
    expect(manualRecord?.source).toBe('manual');
    expect(manualRecord?.value).toBe('en-US');
    expect(manualRecord?.evidenceCount).toBe(0);
    expect(await manager.list('project')).toHaveLength(1);
  });
});

function createPersistentManager(): MemoryManager {
  return new MemoryManager(new MemoryStore({ cwd: repoDir, baseDir }));
}

function createStoreReader(globalRecords: MemoryRecord[], projectRecords: MemoryRecord[]): MemoryStoreReader {
  return {
    async list(scope: MemoryScopeInput, options?: { status?: MemoryStatus | MemoryStatus[] }) {
      const records = scope === 'global' ? globalRecords : projectRecords;
      return filterByStatus(records, options?.status);
    },
  };
}

function filterByStatus(
  records: MemoryRecord[],
  status?: MemoryStatus | MemoryStatus[],
): MemoryRecord[] {
  if (!status) {
    return [...records];
  }

  const statuses = new Set(Array.isArray(status) ? status : [status]);
  return records.filter((record) => statuses.has(record.status));
}

function createProviderWithSystems(systems: string[]): LLMProvider {
  let callIndex = 0;

  return {
    async complete(_params: LLMProviderParams): Promise<LLMResponse> {
      throw new Error('complete() not expected in this test');
    },

    async *stream(params: LLMProviderParams): AsyncIterable<StreamEvent> {
      systems.push(params.system);
      const responseIndex = callIndex++;

      if (responseIndex === 0) {
        yield { type: 'tool_use_start', toolCall: { id: 'tool-1', name: 'refresh_memory', input: {} } };
        yield { type: 'tool_use_end', toolCall: { id: 'tool-1', name: 'refresh_memory', input: {} } };
        yield {
          type: 'message_end',
          stopReason: 'tool_use',
          usage: { inputTokens: 100, outputTokens: 20 },
        };
        return;
      }

      yield { type: 'text_delta', text: 'done' };
      yield {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
}

function createTool(
  name: string,
  execute: (input: Record<string, unknown>) => Promise<ToolResult>,
): Tool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute,
  };
}

function createRecord(input: {
  scope: 'global' | 'project';
  source: 'manual' | 'auto';
  kind: 'fact' | 'instruction' | 'preference' | 'summary' | 'note';
  key: string;
  value: string;
  priority?: number;
  status?: 'active' | 'disabled' | 'ignored' | 'deleted';
  ignoreUntilTurn?: number | null;
}): MemoryRecord {
  return {
    id: `${input.scope}-${input.key}-${input.source}`,
    scope: input.scope === 'global'
      ? { level: 'global' }
      : { level: 'project', projectKey: 'test-project' },
    source: input.source,
    kind: input.kind,
    key: input.key,
    value: input.value,
    status: input.status ?? 'active',
    priority: input.priority ?? 0,
    evidenceCount: 0,
    createdAt: '2026-04-09T00:00:00.000Z',
    updatedAt: '2026-04-09T00:00:00.000Z',
    ignoreUntilTurn: input.ignoreUntilTurn ?? null,
  };
}

function repeatWords(fragment: string, times: number): string {
  return Array.from({ length: times }, () => fragment).join(' ');
}

function run(command: string, cwd: string): void {
  execSync(command, {
    cwd,
    stdio: 'pipe',
  });
}
