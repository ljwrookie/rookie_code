import type { Tool } from '../tools/base.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
  };
};

function renderMcpToolResult(result: any): { text: string; isError: boolean } {
  // MCP CallToolResult per SDK: { content: ContentBlock[], structuredContent?, isError? }
  const isError = Boolean(result?.isError);

  // Some servers might return compatibility shape { toolResult: unknown }
  if (result && 'toolResult' in result) {
    return {
      text: typeof result.toolResult === 'string' ? result.toolResult : JSON.stringify(result.toolResult, null, 2),
      isError,
    };
  }

  const parts: string[] = [];
  const content = Array.isArray(result?.content) ? result.content : [];

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      parts.push(String(block.text ?? ''));
      continue;
    }
    if (block.type === 'resource' && block.resource) {
      const r = block.resource as any;
      const uri = typeof r.uri === 'string' ? r.uri : '';
      if (typeof r.text === 'string') {
        parts.push(`[resource:${uri}]\n${r.text}`);
      } else if (typeof r.blob === 'string') {
        parts.push(`[resource:${uri}] (blob, mime=${String(r.mimeType ?? '')}, bytes≈${r.blob.length})`);
      } else {
        parts.push(`[resource:${uri}]`);
      }
      continue;
    }
    if (block.type === 'resource_link') {
      const uri = typeof block.uri === 'string' ? block.uri : '';
      const name = typeof block.name === 'string' ? block.name : '';
      parts.push(`[resource_link] ${name} ${uri}`.trim());
      continue;
    }
    if (block.type === 'image' || block.type === 'audio') {
      parts.push(`[${block.type}] mime=${String(block.mimeType ?? '')} bytes≈${String(block.data ?? '').length}`);
      continue;
    }
  }

  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    parts.push('\n[structuredContent]\n' + JSON.stringify(result.structuredContent, null, 2));
  }

  const text = parts.join('\n').trim();
  return { text: text || '(empty MCP tool result)', isError };
}

export class McpMountedTool implements Tool {
  definition: ToolDefinition;

  constructor(
    private client: Client,
    private serverName: string,
    private tool: McpToolInfo,
    public mountedName: string,
  ) {
    this.definition = {
      name: mountedName,
      description: `[MCP:${serverName}] ${tool.description ?? ''}`.trim(),
      input_schema: {
        type: 'object',
        properties: (tool.inputSchema?.properties ?? {}) as unknown as Record<string, unknown>,
        ...(tool.inputSchema?.required ? { required: tool.inputSchema.required } : {}),
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.client.callTool({
        name: this.tool.name,
        arguments: input,
      });
      const rendered = renderMcpToolResult(result);
      return { tool_use_id: '', content: rendered.text, is_error: rendered.isError };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { tool_use_id: '', content: `MCP tool error (${this.serverName}:${this.tool.name}): ${msg}`, is_error: true };
    }
  }
}

