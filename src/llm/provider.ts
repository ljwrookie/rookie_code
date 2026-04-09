import type { Message, ToolDefinition, ContentBlock } from '../types.js';

// --- Stream Event Types ---

export interface StreamEvent {
  type:
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'message_end'
    | 'error';
  /** Incremental text (for text_delta) */
  text?: string;
  /** Tool call info (populated at tool_use_end with complete input) */
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  /** Stop reason (for message_end) */
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  /** Token usage (for message_end) */
  usage?: { inputTokens: number; outputTokens: number };
}

// --- LLM Provider Interface ---

export interface LLMProviderParams {
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** Non-streaming completion */
  complete(params: LLMProviderParams): Promise<LLMResponse>;

  /** Streaming completion — returns AsyncIterable of events */
  stream(params: LLMProviderParams): AsyncIterable<StreamEvent>;
}
