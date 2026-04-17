import type { LLMProvider } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Message, ContentBlock, ToolUseBlock, ToolResult, AgentEvent } from '../types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { countPromptTokens } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';
import type { MemoryManager } from '../memory/manager.js';
import { validateToolInput } from '../tools/validate-input.js';
import type { Config } from '../types.js';
import { buildRepoOverview } from '../repo/overview.js';
import { wrapToolOutputForLLM } from '../security/prompt-injection.js';
import type { HookManager } from '../hooks/manager.js';

export interface AgentLoopOptions {
  maxIterations: number;
  tokenBudget?: number;
  workingDirectory: string;
  onEvent?: (event: AgentEvent) => void;
  memoryManager?: MemoryManager;
  hookManager?: HookManager;
  /** Agent nesting depth. Top-level agent = 0. */
  depth?: number;
  repoContext?: Config['repoContext'];
}

/**
 * Core Agent Loop: think → tool_call → observe → repeat
 *
 * This is the heart of the code agent. It manages the conversation
 * between the user, the LLM, and the tool system.
 */
export class AgentLoop {
  private cachedRepoSection: string | null = null;

  constructor(
    private provider: LLMProvider,
    private tools: ToolRegistry,
    private options: AgentLoopOptions,
  ) {}

  /**
   * Run the agent loop for a single user message.
   * Returns the updated message history.
   */
  async run(
    userMessage: string,
    history: Message[],
    signal?: AbortSignal,
  ): Promise<Message[]> {
    if (this.options.hookManager) {
      await this.options.hookManager.emitUserPromptSubmit(userMessage);
    }

    const messages: Message[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    let iteration = 0;

    while (iteration < this.options.maxIterations) {
      // Check abort
      if (signal?.aborted) {
        if (this.options.hookManager) await this.options.hookManager.emitStop();
        throw new DOMException('Aborted', 'AbortError');
      }

      // Token budget safety valve
      const promptState = await this.preparePromptState(messages);
      if (this.options.tokenBudget) {
        if (promptState.totalTokens > this.options.tokenBudget * 0.9) {
          logger.warn('Token budget nearly exhausted, stopping agent loop.');
          messages.push({
            role: 'assistant',
            content: '[Token budget nearly exhausted. Please start a new conversation or use /compact to compress history.]',
          });
          break;
        }
      }

      // Call LLM with streaming
      const { content, stopReason, usage } = await this.streamLLMResponse(
        promptState.systemPrompt,
        messages,
        signal,
      );

      // Add assistant message to history
      messages.push({ role: 'assistant', content });
      if (usage) {
        this.emit({
          type: 'llm_usage',
          data: usage,
        });
      }

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
      const toolResultsPromises = toolUseBlocks.map(async (toolUse) => {
        if (signal?.aborted) {
          if (this.options.hookManager) await this.options.hookManager.emitStop();
          throw new DOMException('Aborted', 'AbortError');
        }

        this.emit({
          type: 'tool_call',
          data: { id: toolUse.id, name: toolUse.name, input: toolUse.input },
        });

        if (this.options.hookManager) {
          await this.options.hookManager.emitPreToolUse({ name: toolUse.name, input: toolUse.input });
        }

        const result = await this.executeToolCall(toolUse, signal);

        if (this.options.hookManager) {
          if (result.is_error) {
            await this.options.hookManager.emitPostToolUseFailure({ name: toolUse.name, input: toolUse.input }, result.content);
          } else {
            await this.options.hookManager.emitPostToolUse({ name: toolUse.name, input: toolUse.input }, result.content);
          }
        }

        this.emit({
          type: 'tool_result',
          data: { name: toolUse.name, result },
        });

        const wrapped = wrapToolOutputForLLM({ toolName: toolUse.name, content: result.content });
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: wrapped.wrapped,
          is_error: result.is_error,
        };
      });

      const toolResults: ContentBlock[] = await Promise.all(toolResultsPromises);

      // Add tool results as a user message (Anthropic convention)
      messages.push({ role: 'user', content: toolResults });

      iteration++;
    }

    // Max iteration guard
    if (iteration >= this.options.maxIterations) {
      logger.warn(`Reached maximum iterations (${this.options.maxIterations}). Stopping.`);
      // One final call without tools to let LLM summarize
      const summaryMessages = [
        ...messages,
        {
          role: 'user' as const,
          content: `You've reached the maximum number of tool call iterations (${this.options.maxIterations}). Please summarize what you've accomplished and what remains to be done.`,
        },
      ];
      const promptState = await this.preparePromptState(summaryMessages);
      const { content } = await this.streamLLMResponse(
        promptState.systemPrompt,
        summaryMessages,
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
    systemPrompt: string,
    messages: Message[],
    signal?: AbortSignal,
    includeTools: boolean = true,
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const contentBlocks: ContentBlock[] = [];
    let currentText = '';
    let stopReason = 'end_turn';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    const stream = this.provider.stream({
      system: systemPrompt,
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
          if (event.usage) {
            usage = { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens };
          }
          break;
        }
      }
    }

    // Flush remaining text
    if (currentText) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    return { content: contentBlocks, stopReason, usage };
  }

  private async preparePromptState(messages: Message[]): Promise<{
    systemPrompt: string;
    totalTokens: number;
  }> {
    const baseSystemPrompt = buildSystemPrompt({
      workingDirectory: this.options.workingDirectory,
      availableTools: this.tools.getNames(),
    });

    let memorySection: string | null = null;
    if (this.options.memoryManager) {
      try {
        const memoryPrompt = await this.options.memoryManager.buildPromptSection({
          baseSystemPrompt,
          messages,
          tokenBudget: this.options.tokenBudget,
        });
        memorySection = memoryPrompt.memorySection;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to build memory prompt section: ${message}`);
      }
    }

    let repoSection: string | null = null;
    const repoCfg = this.options.repoContext;
    if (repoCfg?.enabled) {
      try {
        if (this.cachedRepoSection == null) {
          this.cachedRepoSection = await buildRepoOverview({
            rootDir: this.options.workingDirectory,
            maxFiles: repoCfg.maxFiles,
          });
        }
        repoSection = this.cachedRepoSection;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to build repo overview: ${message}`);
      }
    }

    const systemPrompt = buildSystemPrompt({
      workingDirectory: this.options.workingDirectory,
      availableTools: this.tools.getNames(),
      memorySection,
      repoSection,
    });

    return {
      systemPrompt,
      totalTokens: countPromptTokens({ system: systemPrompt, messages }),
    };
  }

  /**
   * Execute a tool call with defensive error handling.
   * Handles: malformed JSON, unknown tool, missing params.
   */
  private async executeToolCall(toolUse: ToolUseBlock, signal?: AbortSignal): Promise<ToolResult> {
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
    {
      const validated = validateToolInput(tool.definition, toolUse.input);
      if (!validated.ok) {
        return {
          tool_use_id: toolUse.id,
          content: validated.message,
          is_error: true,
        };
      }
    }

    // 4. Execute the tool
    try {
      const depth = this.options.depth ?? 0;
      const result = tool.executeWithContext
        ? await tool.executeWithContext(toolUse.input, { signal, depth, hookManager: this.options.hookManager })
        : await tool.execute(toolUse.input);
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
    const depth = this.options.depth ?? 0;
    if (event.depth == null) {
      this.options.onEvent?.({ ...event, depth });
      return;
    }
    this.options.onEvent?.(event);
  }
}
