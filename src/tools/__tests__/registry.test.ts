import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../registry.js';
import type { Tool } from '../base.js';
import type { ToolResult } from '../../types.js';

function createMockTool(name: string): Tool {
  return {
    definition: {
      name,
      description: `Mock tool ${name}`,
      input_schema: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
    },
    async execute(): Promise<ToolResult> {
      return { tool_use_id: '', content: `${name} executed`, is_error: false };
    },
  };
}

describe('ToolRegistry', () => {
  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    const tool = createMockTool('test_tool');
    registry.register(tool);

    expect(registry.get('test_tool')).toBe(tool);
    expect(registry.has('test_tool')).toBe(true);
  });

  it('should return undefined for unknown tools', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should list all tools', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('tool_a'));
    registry.register(createMockTool('tool_b'));

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getNames()).toEqual(['tool_a', 'tool_b']);
  });

  it('should return tool definitions for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('tool_a'));

    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe('tool_a');
    expect(defs[0]!.input_schema).toBeDefined();
  });
});
