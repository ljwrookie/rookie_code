import type { ToolDefinition, ToolResult } from '../types.js';
import type { HookManager } from '../hooks/manager.js';

export interface ToolExecutionContext {
  /** Abort signal for cancelling ongoing work (e.g. Ctrl+C) */
  signal?: AbortSignal;
  /** Current agent nesting depth. Top-level agent = 0. */
  depth: number;
  /** Hook manager for triggering hooks inside tools */
  hookManager?: HookManager;
}

/**
 * Tool interface — all tools must implement this.
 */
export interface Tool {
  /** Tool definition for LLM (name, description, input_schema) */
  definition: ToolDefinition;

  /** Execute the tool with given input */
  execute(input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * Execute the tool with extra runtime context (optional).
   * Prefer implementing this when you need abort/depth.
   */
  executeWithContext?(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
}
