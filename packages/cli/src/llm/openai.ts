import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import type {
  LLMProvider,
  LLMProviderParams,
  LLMResponse,
  StreamEvent,
} from './provider.js';
import type { Message, ContentBlock, ToolDefinition } from '../types.js';
import { LLMError } from './errors.js';
import { logger } from '../utils/logger.js';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

// --- Format Conversion Helpers ---

/**
 * Convert our Message[] to OpenAI ChatCompletionMessageParam[].
 *
 * Key mapping rules:
 * - user + string content  → { role: 'user', content }
 * - assistant + ContentBlock[] with text/tool_use → assistant message with optional tool_calls
 * - user + ContentBlock[] containing tool_result → one { role: 'tool' } message per result
 */
function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      continue;
    }

    // ContentBlock[] — handle by role
    if (msg.role === 'assistant') {
      const textParts = msg.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text);
      const toolUses = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
      );

      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null,
        ...(toolUses.length > 0 && {
          tool_calls: toolUses.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        }),
      };
      result.push(assistantMsg);
    } else {
      // user role with ContentBlock[] — may contain tool_result blocks and text blocks
      const toolResults = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
      );
      const textParts = msg.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text);

      // Emit tool results as individual 'tool' messages
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }

      // If there are also text blocks in the user message, add a user message
      if (textParts.length > 0) {
        result.push({ role: 'user', content: textParts.join('') });
      }
    }
  }

  return result;
}

/**
 * Convert our ToolDefinition[] to OpenAI ChatCompletionTool[].
 */
function toOpenAITools(tools: ToolDefinition[] | undefined): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/**
 * Map OpenAI finish_reason to our stop reason.
 */
function mapStopReason(finishReason: string | null): 'end_turn' | 'tool_use' | 'max_tokens' {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

// --- Error Classification ---

/**
 * Classify OpenAI SDK errors into LLMError.
 */
function classifyError(err: unknown): LLMError {
  if (err instanceof OpenAI.AuthenticationError) {
    return new LLMError(
      'Invalid API key. Set OPENAI_API_KEY environment variable.',
      'AUTH',
      false,
      err,
    );
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new LLMError('Rate limited by OpenAI API.', 'RATE_LIMIT', true, err);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new LLMError('Network error connecting to OpenAI.', 'NETWORK', true, err);
  }
  if (err instanceof OpenAI.BadRequestError) {
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

// --- Retry Helper ---

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
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

// --- Provider Implementation ---

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    if (!apiKey) {
      throw new LLMError('OPENAI_API_KEY is required.', 'AUTH', false);
    }
    // OpenAI client ignores baseURL if it is undefined, but if passed empty string it might error
    this.client = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
    this.model = model ?? 'gpt-4o';
  }

  async complete(params: LLMProviderParams): Promise<LLMResponse> {
    const { system, messages, tools, maxTokens = 8192, signal } = params;
    let lastError: LLMError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const openaiMessages: ChatCompletionMessageParam[] = [
          { role: 'system', content: system },
          ...toOpenAIMessages(messages),
        ];

        const openaiTools = toOpenAITools(tools);

        const response = await this.client.chat.completions.create(
          {
            model: this.model,
            max_tokens: maxTokens,
            messages: openaiMessages,
            ...(openaiTools && { tools: openaiTools }),
          },
          { signal: signal as AbortSignal | undefined },
        );

        const choice = response.choices[0];
        if (!choice) {
          throw new LLMError('No choices in OpenAI response', 'UNKNOWN', false);
        }

        const content: ContentBlock[] = [];

        // Extract text content
        if (choice.message.content) {
          content.push({ type: 'text', text: choice.message.content });
        }

        // Extract tool calls
        if (choice.message.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            if (tc.type !== 'function') continue;
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              input = { __raw_json: tc.function.arguments };
            }
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
        }

        return {
          content,
          stopReason: mapStopReason(choice.finish_reason),
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = classifyError(err);
        if (!lastError.retryable || attempt === MAX_RETRIES - 1) throw lastError;
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.warn(
          `LLM request failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`,
        );
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

    const openaiMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...toOpenAIMessages(messages),
    ];

    const openaiTools = toOpenAITools(tools);

    let streamResponse: AsyncIterable<ChatCompletionChunk>;

    try {
      streamResponse = await this.client.chat.completions.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          messages: openaiMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...(openaiTools && { tools: openaiTools }),
        },
        { signal: signal as AbortSignal | undefined },
      );
    } catch (err) {
      throw classifyError(err);
    }

    // Track tool call state for incremental JSON assembly
    const toolCallAccumulators = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    // Track usage
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: StreamEvent['stopReason'] = 'end_turn';

    try {
      for await (const chunk of streamResponse) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const choice = chunk.choices[0];

        // Handle usage-only chunks (final chunk with stream_options.include_usage)
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }

        if (!choice) continue;

        const delta = choice.delta;

        // Text content delta
        if (delta.content) {
          yield { type: 'text_delta', text: delta.content };
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            let acc = toolCallAccumulators.get(idx);

            if (!acc) {
              // New tool call starting
              acc = {
                id: tcDelta.id ?? '',
                name: tcDelta.function?.name ?? '',
                arguments: '',
              };
              toolCallAccumulators.set(idx, acc);
              yield {
                type: 'tool_use_start',
                toolCall: { id: acc.id, name: acc.name, input: {} },
              };
            }

            // Accumulate function arguments
            if (tcDelta.function?.arguments) {
              acc.arguments += tcDelta.function.arguments;
              yield { type: 'tool_use_delta' };
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          stopReason = mapStopReason(choice.finish_reason);

          // If finished with tool_calls, emit tool_use_end for each accumulated tool
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            for (const [, acc] of toolCallAccumulators) {
              let input: Record<string, unknown> = {};
              try {
                if (acc.arguments) {
                  input = JSON.parse(acc.arguments) as Record<string, unknown>;
                }
              } catch {
                input = { __raw_json: acc.arguments };
              }
              yield {
                type: 'tool_use_end',
                toolCall: { id: acc.id, name: acc.name, input },
              };
            }
            toolCallAccumulators.clear();
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw classifyError(err);
    }

    // Emit final message_end event
    yield {
      type: 'message_end',
      stopReason,
      usage: { inputTokens, outputTokens },
    };
  }
}
