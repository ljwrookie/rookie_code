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

  /** Unregister a tool by name (no-op if not found) */
  unregister(name: string): void {
    this.tools.delete(name);
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

  /**
   * Create a restricted copy of this registry, excluding specific tool names.
   * Useful for sub-agents to prevent recursive agent spawning.
   */
  createRestricted(excludeNames: string[]): ToolRegistry {
    const restricted = new ToolRegistry();
    const exclude = new Set(excludeNames);
    for (const tool of this.getAll()) {
      if (exclude.has(tool.definition.name)) continue;
      restricted.register(tool);
    }
    return restricted;
  }
}
