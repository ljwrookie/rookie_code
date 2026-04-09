import type { LLMProvider } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Message, ContentBlock, ToolUseBlock, ToolResult, AgentEvent } from '../types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { countMessagesTokens } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';

export interface AgentLoopOptions {
  maxIterations: number;
  tokenBudget?: number;
  workingDirectory: string;
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Core Agent Loop: think → tool_call → observe → repeat
 *
 * This is the heart of the code agent. It manages the conversation
 * between the user, the LLM, and the tool system.
 */
export class AgentLoop {
  private systemPrompt: string;

  constructor(
    private provider: LLMProvider,
    private tools: ToolRegistry,
    private options: AgentLoopOptions,
  ) {
    this.systemPrompt = buildSystemPrompt({
      workingDirectory: options.workingDirectory,
      availableTools: tools.getNames(),
    });
  }

  /**
   * Run the agent loop for a single user message.
   * Returns the updated message history.
   */
  async run(
    userMessage: string,
    history: Message[],
    signal?: AbortSignal,
  ): Promise<Message[]> {
    const messages: Message[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    let iteration = 0;

    while (iteration < this.options.maxIterations) {
      // Check abort
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Token budget safety valve
      if (this.options.tokenBudget) {
        const currentTokens = countMessagesTokens(messages);
        if (currentTokens > this.options.tokenBudget * 0.9) {
          logger.warn('Token budget nearly exhausted, stopping agent loop.');
          messages.push({
            role: 'assistant',
            content: '[Token budget nearly exhausted. Please start a new conversation or use /compact to compress history.]',
          });
          break;
        }
      }

      // Call LLM with streaming
      const { content, stopReason } = await this.streamLLMResponse(
        messages,
        signal,
      );

      // Add assistant message to history
      messages.push({ role: 'assistant', content });

      // If no tool calls, we're done
      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        break;
      }

      // Extract tool_use blocks
      const toolUseBlocks = content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        break;
      }

      // Execute tools and collect results
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const result = await this.executeToolCall(toolUse);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.is_error,
        });

        this.emit({
          type: 'tool_result',
          data: { name: toolUse.name, result },
        });
      }

      // Add tool results as a user message (Anthropic convention)
      messages.push({ role: 'user', content: toolResults });

      iteration++;
    }

    // Max iteration guard
    if (iteration >= this.options.maxIterations) {
      logger.warn(`Reached maximum iterations (${this.options.maxIterations}). Stopping.`);
      // One final call without tools to let LLM summarize
      const { content } = await this.streamLLMResponse(
        [
          ...messages,
          {
            role: 'user',
            content: `You've reached the maximum number of tool call iterations (${this.options.maxIterations}). Please summarize what you've accomplished and what remains to be done.`,
          },
        ],
        signal,
        false, // no tools
      );
      messages.push({ role: 'assistant', content });
    }

    return messages;
  }

  /**
   * Stream LLM response, emitting events and collecting content blocks.
   */
  private async streamLLMResponse(
    messages: Message[],
    signal?: AbortSignal,
    includeTools: boolean = true,
  ): Promise<{ content: ContentBlock[]; stopReason: string }> {
    const contentBlocks: ContentBlock[] = [];
    let currentText = '';
    let stopReason = 'end_turn';

    const stream = this.provider.stream({
      system: this.systemPrompt,
      messages,
      tools: includeTools ? this.tools.getDefinitions() : undefined,
      signal,
    });

    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          currentText += event.text ?? '';
          this.emit({ type: 'text_delta', data: event.text });
          break;
        }

        case 'tool_use_start': {
          // Flush accumulated text as a text block
          if (currentText) {
            contentBlocks.push({ type: 'text', text: currentText });
            currentText = '';
          }
          if (event.toolCall) {
            this.emit({
              type: 'tool_call',
              data: { id: event.toolCall.id, name: event.toolCall.name },
            });
          }
          break;
        }

        case 'tool_use_end': {
          if (event.toolCall) {
            contentBlocks.push({
              type: 'tool_use',
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input,
            });
          }
          break;
        }

        case 'message_end': {
          stopReason = event.stopReason ?? 'end_turn';
          break;
        }
      }
    }

    // Flush remaining text
    if (currentText) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    return { content: contentBlocks, stopReason };
  }

  /**
   * Execute a tool call with defensive error handling.
   * Handles: malformed JSON, unknown tool, missing params.
   */
  private async executeToolCall(toolUse: ToolUseBlock): Promise<ToolResult> {
    // 1. Check for malformed JSON (from streaming assembly)
    if (toolUse.input && '__raw_json' in toolUse.input) {
      return {
        tool_use_id: toolUse.id,
        content: `Invalid JSON in tool arguments: ${String(toolUse.input['__raw_json'])}. Please try the tool call again with valid JSON.`,
        is_error: true,
      };
    }

    // 2. Check if tool exists
    const tool = this.tools.get(toolUse.name);
    if (!tool) {
      const available = this.tools.getNames().join(', ');
      return {
        tool_use_id: toolUse.id,
        content: `Unknown tool: "${toolUse.name}". Available tools: [${available}]`,
        is_error: true,
      };
    }

    // 3. Validate required parameters
    const schema = tool.definition.input_schema;
    if (schema.required) {
      const missing = schema.required.filter(
        (param) => !(param in toolUse.input),
      );
      if (missing.length > 0) {
        return {
          tool_use_id: toolUse.id,
          content: `Missing required parameter(s): ${missing.join(', ')}. Tool "${toolUse.name}" requires: ${schema.required.join(', ')}`,
          is_error: true,
        };
      }
    }

    // 4. Execute the tool
    try {
      const result = await tool.execute(toolUse.input);
      // Set the correct tool_use_id
      return { ...result, tool_use_id: toolUse.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: toolUse.id,
        content: `Tool execution error: ${msg}`,
        is_error: true,
      };
    }
  }

  private emit(event: AgentEvent): void {
    this.options.onEvent?.(event);
  }
}
