import type { Tool } from './base.js';
import type { ToolDefinition } from '../types.js';

/**
 * Central registry for all available tools.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool */
  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Get tool definitions for LLM API (tools parameter) */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => t.definition);
  }

  /** Get all tool names */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
