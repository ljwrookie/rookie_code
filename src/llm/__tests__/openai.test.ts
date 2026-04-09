import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, ToolDefinition } from '../../types.js';

// --- Mock OpenAI SDK ---

const mockCreate = vi.fn();

// Store mock error classes so we can use them in tests without re-importing
class MockAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
class MockRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
class MockAPIConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'APIConnectionError';
  }
}
class MockBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

vi.mock('openai', () => {
  class OpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };

    static AuthenticationError = MockAuthenticationError;
    static RateLimitError = MockRateLimitError;
    static APIConnectionError = MockAPIConnectionError;
    static BadRequestError = MockBadRequestError;
  }

  return { default: OpenAI };
});

// Import AFTER mock is set up
const { OpenAIProvider } = await import('../openai.js');

// --- Helpers ---

function makeProvider(): InstanceType<typeof OpenAIProvider> {
  return new OpenAIProvider('test-api-key', 'gpt-4o');
}

function defaultParams() {
  return {
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    maxTokens: 1024,
  };
}

// --- Tests ---

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw LLMError when API key is empty', () => {
      expect(() => new OpenAIProvider('', 'gpt-4o')).toThrow('OPENAI_API_KEY is required.');
    });

    it('should create provider with valid API key', () => {
      const provider = new OpenAIProvider('valid-key');
      expect(provider).toBeDefined();
    });
  });

  describe('message format conversion', () => {
    it('should convert simple user string message', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hi', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const provider = makeProvider();
      await provider.complete(defaultParams());

      const call = mockCreate.mock.calls[0] as unknown[];
      const args = call[0] as { messages: Array<{ role: string; content: string }> };
      expect(args.messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should convert assistant message with text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Done', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      });

      const provider = makeProvider();
      const messages: Message[] = [
        { role: 'user', content: 'Do something' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will help.' },
          ],
        },
        { role: 'user', content: 'Thanks' },
      ];

      await provider.complete({ ...defaultParams(), messages });

      const call = mockCreate.mock.calls[0] as unknown[];
      const args = call[0] as { messages: Array<{ role: string; content: string | null }> };
      // system + 3 messages
      expect(args.messages[1]).toEqual({ role: 'user', content: 'Do something' });
      expect(args.messages[2]).toEqual({ role: 'assistant', content: 'I will help.' });
      expect(args.messages[3]).toEqual({ role: 'user', content: 'Thanks' });
    });

    it('should convert assistant message with tool_use blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Done', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 5 },
      });

      const provider = makeProvider();
      const messages: Message[] = [
        { role: 'user', content: 'Read file' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that.' },
            { type: 'tool_use', id: 'call_123', name: 'read_file', input: { path: '/tmp/a.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_123', content: 'file contents', is_error: false },
          ],
        },
      ];

      await provider.complete({ ...defaultParams(), messages });

      const call = mockCreate.mock.calls[0] as unknown[];
      const args = call[0] as {
        messages: Array<{
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          tool_call_id?: string;
        }>;
      };

      // Assistant message should have tool_calls
      const assistantMsg = args.messages[2]!;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Let me read that.');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls![0]).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: '/tmp/a.txt' }),
        },
      });

      // Tool result should become a 'tool' role message
      const toolMsg = args.messages[3]!;
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.tool_call_id).toBe('call_123');
      expect(toolMsg.content).toBe('file contents');
    });
  });

  describe('tool definition conversion', () => {
    it('should convert tool definitions to OpenAI format', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'OK', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const tools: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ];

      const provider = makeProvider();
      await provider.complete({ ...defaultParams(), tools });

      const call = mockCreate.mock.calls[0] as unknown[];
      const args = call[0] as {
        tools: Array<{
          type: string;
          function: { name: string; description: string; parameters: unknown };
        }>;
      };
      expect(args.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ]);
    });

    it('should not include tools when none provided', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'OK', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const provider = makeProvider();
      await provider.complete(defaultParams());

      const call = mockCreate.mock.calls[0] as unknown[];
      const args = call[0] as Record<string, unknown>;
      expect(args['tools']).toBeUndefined();
    });
  });

  describe('complete()', () => {
    it('should return text content from completion', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hello there!', tool_calls: undefined },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const provider = makeProvider();
      const result = await provider.complete(defaultParams());

      expect(result.content).toEqual([{ type: 'text', text: 'Hello there!' }]);
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('should return tool_use content from completion', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"/tmp/test.txt"}',
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 15, completion_tokens: 20 },
      });

      const provider = makeProvider();
      const result = await provider.complete(defaultParams());

      expect(result.content).toEqual([
        {
          type: 'tool_use',
          id: 'call_abc',
          name: 'read_file',
          input: { path: '/tmp/test.txt' },
        },
      ]);
      expect(result.stopReason).toBe('tool_use');
    });

    it('should handle malformed tool call JSON gracefully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_bad',
              type: 'function',
              function: { name: 'test', arguments: '{invalid json' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });

      const provider = makeProvider();
      const result = await provider.complete(defaultParams());

      expect(result.content[0]).toEqual({
        type: 'tool_use',
        id: 'call_bad',
        name: 'test',
        input: { __raw_json: '{invalid json' },
      });
    });
  });

  describe('stop reason mapping', () => {
    it('should map "stop" to "end_turn"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'done', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });
      const result = await makeProvider().complete(defaultParams());
      expect(result.stopReason).toBe('end_turn');
    });

    it('should map "tool_calls" to "tool_use"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });
      const result = await makeProvider().complete(defaultParams());
      expect(result.stopReason).toBe('tool_use');
    });

    it('should map "length" to "max_tokens"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'partial', tool_calls: undefined }, finish_reason: 'length' }],
        usage: { prompt_tokens: 5, completion_tokens: 100 },
      });
      const result = await makeProvider().complete(defaultParams());
      expect(result.stopReason).toBe('max_tokens');
    });
  });

  describe('error classification', () => {
    it('should classify authentication errors', async () => {
      mockCreate.mockRejectedValueOnce(new MockAuthenticationError('bad key'));

      const provider = makeProvider();
      try {
        await provider.complete(defaultParams());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'AUTH');
        expect(err).toHaveProperty('retryable', false);
      }
    });

    it('should classify rate limit errors as retryable', async () => {
      // All 3 retries fail with rate limit
      mockCreate.mockRejectedValue(new MockRateLimitError('rate limited'));

      const provider = makeProvider();
      try {
        await provider.complete(defaultParams());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'RATE_LIMIT');
        expect(err).toHaveProperty('retryable', true);
      }
    }, 30000);

    it('should classify network errors as retryable', async () => {
      mockCreate.mockRejectedValue(new MockAPIConnectionError('network down'));

      const provider = makeProvider();
      try {
        await provider.complete(defaultParams());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'NETWORK');
        expect(err).toHaveProperty('retryable', true);
      }
    }, 30000);

    it('should classify bad request errors as non-retryable', async () => {
      mockCreate.mockRejectedValueOnce(new MockBadRequestError('invalid param'));

      const provider = makeProvider();
      try {
        await provider.complete(defaultParams());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'INVALID_REQUEST');
        expect(err).toHaveProperty('retryable', false);
      }
    });
  });

  describe('stream()', () => {
    it('should yield text_delta events for content', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }], usage: null },
        { choices: [{ delta: { content: ' world' }, finish_reason: null }], usage: null },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(chunks));

      const provider = makeProvider();
      const events = [];
      for await (const event of provider.stream(defaultParams())) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
      expect(events[1]).toEqual({ type: 'text_delta', text: ' world' });

      // Should have message_end at the end
      const endEvent = events.find((e) => e.type === 'message_end');
      expect(endEvent).toBeDefined();
      expect(endEvent!.stopReason).toBe('end_turn');
      expect(endEvent!.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('should handle tool call streaming', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '' },
              }],
            },
            finish_reason: null,
          }],
          usage: null,
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"path"' },
              }],
            },
            finish_reason: null,
          }],
          usage: null,
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: ':"/tmp/a.txt"}' },
              }],
            },
            finish_reason: null,
          }],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: null,
        },
        {
          choices: [],
          usage: { prompt_tokens: 15, completion_tokens: 10 },
        },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(chunks));

      const provider = makeProvider();
      const events = [];
      for await (const event of provider.stream(defaultParams())) {
        events.push(event);
      }

      // tool_use_start
      const startEvent = events.find((e) => e.type === 'tool_use_start');
      expect(startEvent).toBeDefined();
      expect(startEvent!.toolCall).toEqual({ id: 'call_1', name: 'read_file', input: {} });

      // tool_use_delta (should have 2)
      const deltaEvents = events.filter((e) => e.type === 'tool_use_delta');
      expect(deltaEvents.length).toBe(2);

      // tool_use_end with parsed input
      const endToolEvent = events.find((e) => e.type === 'tool_use_end');
      expect(endToolEvent).toBeDefined();
      expect(endToolEvent!.toolCall).toEqual({
        id: 'call_1',
        name: 'read_file',
        input: { path: '/tmp/a.txt' },
      });

      // message_end
      const msgEnd = events.find((e) => e.type === 'message_end');
      expect(msgEnd).toBeDefined();
      expect(msgEnd!.stopReason).toBe('tool_use');
    });

    it('should handle stream errors', async () => {
      mockCreate.mockRejectedValueOnce(new MockAuthenticationError('bad key'));

      const provider = makeProvider();
      try {
        for await (const _event of provider.stream(defaultParams())) {
          void _event;
          // should not reach here
        }
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('code', 'AUTH');
      }
    });
  });
});

// --- Async Iterable Helper ---

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < items.length) {
            return { value: items[index++]!, done: false };
          }
          return { value: undefined, done: true } as IteratorReturnResult<undefined>;
        },
      };
    },
  };
}
