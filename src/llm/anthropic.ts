import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMProviderParams,
  LLMResponse,
  StreamEvent,
} from './provider.js';
import type { Message, ContentBlock } from '../types.js';
import { LLMError } from './errors.js';
import { logger } from '../utils/logger.js';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

/**
 * Convert our Message format to Anthropic's message format.
 */
function toAnthropicMessages(
  messages: Message[],
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role as 'user' | 'assistant', content: msg.content };
    }

    const blocks: Anthropic.ContentBlockParam[] = msg.content.map(
      (block: ContentBlock) => {
        switch (block.type) {
          case 'text':
            return { type: 'text' as const, text: block.text };
          case 'tool_use':
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          case 'tool_result':
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
        }
      },
    );

    return {
      role: msg.role as 'user' | 'assistant',
      content: blocks,
    };
  });
}

/**
 * Convert Anthropic tool definition format.
 */
function toAnthropicTools(
  tools: LLMProviderParams['tools'],
): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));
}

/**
 * Classify Anthropic errors into LLMError.
 */
function classifyError(err: unknown): LLMError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new LLMError(
      'Invalid API key. Set ANTHROPIC_API_KEY environment variable.',
      'AUTH',
      false,
      err,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LLMError('Rate limited by Anthropic API.', 'RATE_LIMIT', true, err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError('Network error connecting to Anthropic.', 'NETWORK', true, err);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new LLMError(
      `Invalid request: ${err.message}`,
      'INVALID_REQUEST',
      false,
      err,
    );
  }
  if (err instanceof Error) {
    return new LLMError(err.message, 'UNKNOWN', false, err);
  }
  return new LLMError(String(err), 'UNKNOWN', false);
}

/**
 * Sleep with abort support.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    if (!apiKey) {
      throw new LLMError(
        'ANTHROPIC_API_KEY is required.',
        'AUTH',
        false,
      );
    }
    this.client = new Anthropic({ apiKey, baseURL });
    this.model = model ?? 'claude-sonnet-4-20250514';
  }

  async complete(params: LLMProviderParams): Promise<LLMResponse> {
    const { system, messages, tools, maxTokens = 8192, signal } = params;
    let lastError: LLMError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: maxTokens,
            system,
            messages: toAnthropicMessages(messages),
            tools: toAnthropicTools(tools),
          },
          { signal: signal as AbortSignal | undefined },
        );

        const content: ContentBlock[] = response.content
          .filter((block) => block.type === 'text' || block.type === 'tool_use')
          .map((block) => {
            if (block.type === 'text') {
              return { type: 'text' as const, text: block.text };
            }
            // tool_use — narrow the type explicitly
            const toolBlock = block as Anthropic.ToolUseBlock;
            return {
              type: 'tool_use' as const,
              id: toolBlock.id,
              name: toolBlock.name,
              input: toolBlock.input as Record<string, unknown>,
            };
          });

        return {
          content,
          stopReason: response.stop_reason ?? 'end_turn',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = classifyError(err);
        if (!lastError.retryable || attempt === MAX_RETRIES - 1) throw lastError;
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.warn(`LLM request failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`);
        await sleep(delay, signal);
      }
    }

    throw lastError ?? new LLMError('Unknown error', 'UNKNOWN', false);
  }

  async *stream(params: LLMProviderParams): AsyncIterable<StreamEvent> {
    const { system, messages, tools, maxTokens = 8192, signal } = params;

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let streamHandle: ReturnType<typeof this.client.messages.stream>;

    try {
      streamHandle = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: toAnthropicMessages(messages),
          tools: toAnthropicTools(tools),
        },
        { signal: signal as AbortSignal | undefined },
      );
    } catch (err) {
      throw classifyError(err);
    }

    // Track current tool_use state for incremental JSON assembly
    let currentToolId = '';
    let currentToolName = '';
    let jsonAccumulator = '';

    // Track usage
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of streamHandle) {
        // Handle abort
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              currentToolId = block.id;
              currentToolName = block.name;
              jsonAccumulator = '';
              yield { type: 'tool_use_start', toolCall: { id: block.id, name: block.name, input: {} } };
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              jsonAccumulator += delta.partial_json;
              yield { type: 'tool_use_delta' };
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId) {
              let input: Record<string, unknown> = {};
              try {
                if (jsonAccumulator) {
                  input = JSON.parse(jsonAccumulator) as Record<string, unknown>;
                }
              } catch {
                // Malformed JSON — will be handled by the agent loop
                input = { __raw_json: jsonAccumulator };
              }
              yield {
                type: 'tool_use_end',
                toolCall: { id: currentToolId, name: currentToolName, input },
              };
              currentToolId = '';
              currentToolName = '';
              jsonAccumulator = '';
            }
            break;
          }

          case 'message_start': {
            if (event.message?.usage) {
              inputTokens = event.message.usage.input_tokens;
            }
            break;
          }

          case 'message_delta': {
            const md = event as unknown as { usage?: { output_tokens: number } };
            if (md.usage) {
              outputTokens = md.usage.output_tokens;
            }
            break;
          }

          case 'message_stop': {
            // Get final message to determine stop reason
            const finalMessage = await streamHandle.finalMessage();
            yield {
              type: 'message_end',
              stopReason: (finalMessage.stop_reason ?? 'end_turn') as StreamEvent['stopReason'],
              usage: { inputTokens, outputTokens: outputTokens || finalMessage.usage.output_tokens },
            };
            break;
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw classifyError(err);
    }
  }
}
