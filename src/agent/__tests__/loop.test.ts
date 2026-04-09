import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../loop.js';
import type { LLMProvider, LLMProviderParams, LLMResponse, StreamEvent } from '../../llm/provider.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { Tool } from '../../tools/base.js';
import type { ToolResult, AgentEvent } from '../../types.js';

// --- Mock Helpers ---

function createMockTool(name: string, handler?: (input: Record<string, unknown>) => Promise<ToolResult>): Tool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    },
    execute: handler ?? (async () => ({
      tool_use_id: '',
      content: `${name} result`,
      is_error: false,
    })),
  };
}

/**
 * Create a mock LLM provider that returns predetermined responses.
 * Each call to stream() consumes the next response in the queue.
 */
function createMockProvider(responses: Array<{
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason?: string;
}>): LLMProvider {
  let callIndex = 0;

  return {
    async complete(_params: LLMProviderParams): Promise<LLMResponse> {
      throw new Error('complete() not expected in these tests');
    },

    async *stream(_params: LLMProviderParams): AsyncIterable<StreamEvent> {
      const response = responses[callIndex++];
      if (!response) throw new Error('No more mock responses');

      // Emit text
      if (response.text) {
        yield { type: 'text_delta', text: response.text };
      }

      // Emit tool calls
      if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          yield { type: 'tool_use_start', toolCall: { id: tc.id, name: tc.name, input: {} } };
          yield { type: 'tool_use_end', toolCall: tc };
        }
      }

      // Emit message end
      yield {
        type: 'message_end',
        stopReason: (response.stopReason ?? (response.toolCalls ? 'tool_use' : 'end_turn')) as StreamEvent['stopReason'],
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

// --- Tests ---

describe('AgentLoop', () => {
  it('should return assistant message for pure text response', async () => {
    const provider = createMockProvider([
      { text: 'Hello! How can I help you?', stopReason: 'end_turn' },
    ]);
    const registry = new ToolRegistry();
    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Hello', []);

    // Should have: user message + assistant message
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.role).toBe('assistant');
  });

  it('should execute tool calls and continue the loop', async () => {
    const provider = createMockProvider([
      // First response: call read_file
      {
        text: 'Let me read that file.',
        toolCalls: [{ id: 'tc1', name: 'read_file', input: { path: 'test.ts' } }],
        stopReason: 'tool_use',
      },
      // Second response: final text after getting tool result
      { text: 'The file contains test code.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Read test.ts', []);

    // user → assistant(tool_use) → user(tool_result) → assistant(text)
    expect(messages).toHaveLength(4);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[2]!.role).toBe('user'); // tool result
    expect(messages[3]!.role).toBe('assistant');
  });

  it('should terminate at maxIterations', async () => {
    // Provider always returns tool_use — loop should stop at maxIterations
    const responses = Array.from({ length: 5 }, (_, i) => ({
      toolCalls: [{ id: `tc${i}`, name: 'read_file', input: { path: 'test.ts' } }],
      stopReason: 'tool_use' as const,
    }));
    // Final summarization call
    responses.push({ text: 'I was stopped due to iteration limit.', stopReason: 'end_turn', toolCalls: undefined } as unknown as typeof responses[0]);

    const provider = createMockProvider(responses);
    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 3,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Do something', []);

    // Should have stopped and added a summary
    const lastMsg = messages[messages.length - 1]!;
    expect(lastMsg.role).toBe('assistant');
  });

  it('should handle tool execution errors gracefully', async () => {
    const provider = createMockProvider([
      {
        toolCalls: [{ id: 'tc1', name: 'read_file', input: { path: 'nonexistent.ts' } }],
        stopReason: 'tool_use',
      },
      { text: 'The file does not exist, let me try something else.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file', async () => ({
      tool_use_id: '',
      content: 'Error: file not found',
      is_error: true,
    })));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Read a file', []);

    // Tool result should be in messages
    const toolResultMsg = messages[2]!;
    expect(toolResultMsg.role).toBe('user');
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
    const blocks = toolResultMsg.content as Array<{ type: string; is_error: boolean }>;
    expect(blocks[0]!.is_error).toBe(true);
  });

  it('should emit events through onEvent callback', async () => {
    const events: AgentEvent[] = [];
    const provider = createMockProvider([
      {
        text: 'Let me check.',
        toolCalls: [{ id: 'tc1', name: 'read_file', input: { path: 'f.ts' } }],
        stopReason: 'tool_use',
      },
      { text: 'Done.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
      onEvent: (event) => events.push(event),
    });

    await loop.run('Hello', []);

    const types = events.map((e) => e.type);
    expect(types).toContain('text_delta');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
  });

  // --- REVISED: Error recovery tests ---

  it('should handle unknown tool name gracefully', async () => {
    const provider = createMockProvider([
      {
        toolCalls: [{ id: 'tc1', name: 'nonexistent_tool', input: { path: 'x' } }],
        stopReason: 'tool_use',
      },
      { text: 'Sorry, let me use the right tool.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Do something', []);

    // Tool result should indicate unknown tool
    const toolResultMsg = messages[2]!;
    const blocks = toolResultMsg.content as Array<{ type: string; content: string; is_error: boolean }>;
    expect(blocks[0]!.is_error).toBe(true);
    expect(blocks[0]!.content).toContain('Unknown tool');
    expect(blocks[0]!.content).toContain('read_file');
  });

  it('should handle missing required parameters', async () => {
    const provider = createMockProvider([
      {
        toolCalls: [{ id: 'tc1', name: 'read_file', input: {} }], // missing 'path'
        stopReason: 'tool_use',
      },
      { text: 'Let me fix that.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Read file', []);

    const toolResultMsg = messages[2]!;
    const blocks = toolResultMsg.content as Array<{ type: string; content: string; is_error: boolean }>;
    expect(blocks[0]!.is_error).toBe(true);
    expect(blocks[0]!.content).toContain('Missing required parameter');
    expect(blocks[0]!.content).toContain('path');
  });

  it('should handle malformed JSON in tool input', async () => {
    const provider = createMockProvider([
      {
        toolCalls: [{ id: 'tc1', name: 'read_file', input: { __raw_json: '{invalid json' } }],
        stopReason: 'tool_use',
      },
      { text: 'Let me retry.', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();
    registry.register(createMockTool('read_file'));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Read file', []);

    const toolResultMsg = messages[2]!;
    const blocks = toolResultMsg.content as Array<{ type: string; content: string; is_error: boolean }>;
    expect(blocks[0]!.is_error).toBe(true);
    expect(blocks[0]!.content).toContain('Invalid JSON');
  });

  it('should stop when token budget is nearly exhausted', async () => {
    const provider = createMockProvider([
      // This should not even be called due to budget check
      { text: 'response', stopReason: 'end_turn' },
    ]);

    const registry = new ToolRegistry();

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      tokenBudget: 1, // Extremely low budget
      workingDirectory: '/tmp',
    });

    const messages = await loop.run('Hello', []);

    // Should have stopped due to budget
    const lastMsg = messages[messages.length - 1]!;
    expect(typeof lastMsg.content).toBe('string');
    expect(lastMsg.content as string).toContain('Token budget');
  });
});
