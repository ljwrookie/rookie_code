import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop } from '../loop.js';
import type { LLMProvider, LLMProviderParams, LLMResponse, StreamEvent } from '../../llm/provider.js';
import { ToolRegistry } from '../../tools/registry.js';
import { ReadFileTool } from '../../tools/read-file.js';
import { EditFileTool } from '../../tools/edit-file.js';
import { WriteFileTool } from '../../tools/write-file.js';
import type { AgentEvent } from '../../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * E2E integration test using mock LLM provider but real tools.
 */

function createSequentialMockProvider(
  responses: Array<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    stopReason?: string;
  }>,
): LLMProvider {
  let callIndex = 0;
  return {
    async complete(): Promise<LLMResponse> {
      throw new Error('Not used');
    },
    async *stream(_params: LLMProviderParams): AsyncIterable<StreamEvent> {
      const response = responses[callIndex++];
      if (!response) throw new Error(`No more mock responses (call #${callIndex})`);

      if (response.text) {
        yield { type: 'text_delta', text: response.text };
      }
      if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          yield { type: 'tool_use_start', toolCall: { id: tc.id, name: tc.name, input: {} } };
          yield { type: 'tool_use_end', toolCall: tc };
        }
      }
      yield {
        type: 'message_end',
        stopReason: (response.stopReason ?? (response.toolCalls ? 'tool_use' : 'end_turn')) as StreamEvent['stopReason'],
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

describe('Agent E2E (mock)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-e2e-'));
    // Create a test file
    await fs.writeFile(
      path.join(tmpDir, 'test.ts'),
      'function greet() {\n  return "hello";\n}\n',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should complete a read → analyze → edit cycle', async () => {
    const events: AgentEvent[] = [];

    const provider = createSequentialMockProvider([
      // Step 1: LLM decides to read the file
      {
        toolCalls: [{
          id: 'tc1',
          name: 'read_file',
          input: { path: 'test.ts' },
        }],
        stopReason: 'tool_use',
      },
      // Step 2: LLM decides to edit the file
      {
        toolCalls: [{
          id: 'tc2',
          name: 'edit_file',
          input: {
            path: 'test.ts',
            old_string: 'return "hello";',
            new_string: 'return "hello, world!";',
          },
        }],
        stopReason: 'tool_use',
      },
      // Step 3: LLM responds with completion message
      {
        text: 'Done! I\'ve updated the greet function to return "hello, world!".',
        stopReason: 'end_turn',
      },
    ]);

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool(tmpDir));
    registry.register(new EditFileTool(tmpDir));
    registry.register(new WriteFileTool(tmpDir));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: tmpDir,
      onEvent: (e) => events.push(e),
    });

    const messages = await loop.run('Update the greet function to say hello world', []);

    // Verify message flow:
    // [0] user message
    // [1] assistant (tool_use: read_file)
    // [2] user (tool_result)
    // [3] assistant (tool_use: edit_file)
    // [4] user (tool_result)
    // [5] assistant (text response)
    expect(messages.length).toBe(6);
    expect(messages[0]!.role).toBe('user');
    expect(messages[5]!.role).toBe('assistant');

    // Verify file was actually modified
    const finalContent = await fs.readFile(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(finalContent).toContain('hello, world!');
    expect(finalContent).not.toContain('"hello"');

    // Verify events were emitted
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('tool_call');
    expect(eventTypes).toContain('tool_result');
    expect(eventTypes).toContain('text_delta');
  });

  it('should handle tool errors gracefully in the loop', async () => {
    const provider = createSequentialMockProvider([
      // Step 1: LLM tries to read a non-existent file
      {
        toolCalls: [{
          id: 'tc1',
          name: 'read_file',
          input: { path: 'nonexistent.ts' },
        }],
        stopReason: 'tool_use',
      },
      // Step 2: LLM handles the error and reads the correct file
      {
        toolCalls: [{
          id: 'tc2',
          name: 'read_file',
          input: { path: 'test.ts' },
        }],
        stopReason: 'tool_use',
      },
      // Step 3: LLM summarizes
      {
        text: 'Found the file after correcting the path.',
        stopReason: 'end_turn',
      },
    ]);

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool(tmpDir));
    registry.register(new EditFileTool(tmpDir));

    const loop = new AgentLoop(provider, registry, {
      maxIterations: 10,
      workingDirectory: tmpDir,
    });

    const messages = await loop.run('Read the file', []);

    // Verify first tool result is an error
    const firstToolResult = messages[2]!;
    expect(Array.isArray(firstToolResult.content)).toBe(true);
    const blocks = firstToolResult.content as Array<{ type: string; is_error: boolean }>;
    expect(blocks[0]!.is_error).toBe(true);

    // Verify second tool call succeeded
    const secondToolResult = messages[4]!;
    const blocks2 = secondToolResult.content as Array<{ type: string; is_error: boolean; content: string }>;
    expect(blocks2[0]!.is_error).toBe(false);
    expect(blocks2[0]!.content).toContain('greet');

    // Verify loop completed successfully
    const lastMsg = messages[messages.length - 1]!;
    expect(lastMsg.role).toBe('assistant');
  });
});
