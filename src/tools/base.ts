import type { ToolDefinition, ToolResult } from '../types.js';

/**
 * Tool interface — all tools must implement this.
 */
export interface Tool {
  /** Tool definition for LLM (name, description, input_schema) */
  definition: ToolDefinition;

  /** Execute the tool with given input */
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
