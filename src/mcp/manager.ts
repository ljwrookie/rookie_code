import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { logger } from '../utils/logger.js';
import type { ToolRegistry } from '../tools/registry.js';
import { loadMcpConfig, type McpConfig, type McpServerConfig } from './config.js';
import { McpMountedTool } from './tool.js';

type ConnectedServer = {
  name: string;
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: {
      type: 'object';
      properties?: Record<string, object>;
      required?: string[];
    };
  }>;
};

export class McpManager {
  private config: McpConfig | null = null;
  private servers: ConnectedServer[] = [];
  private mountedToolNames: string[] = [];

  constructor(
    private cwd: string,
    private clientInfo: { name: string; version: string } = { name: 'rookie-code', version: '0.1.0' },
  ) {}

  /**
   * Load `.mcp.json` and connect to all configured servers.
   * If the file doesn't exist, MCP stays disabled.
   */
  async init(): Promise<void> {
    this.config = await loadMcpConfig(this.cwd);
    if (!this.config || Object.keys(this.config.servers).length === 0) {
      return;
    }
    await this.connectAll(this.config);
  }

  /**
   * Mount (register) all MCP tools into the provided ToolRegistry.
   */
  mountTools(registry: ToolRegistry): { mounted: number; servers: number } {
    // Unmount previously mounted MCP tools (best-effort).
    for (const name of this.mountedToolNames) {
      registry.unregister(name);
    }
    this.mountedToolNames = [];

    let mounted = 0;
    for (const server of this.servers) {
      for (const tool of server.tools) {
        const mountedName = this.makeMountedToolName(server.name, tool.name, registry);
        registry.register(new McpMountedTool(server.client, server.name, tool, mountedName));
        this.mountedToolNames.push(mountedName);
        mounted++;
      }
    }
    return { mounted, servers: this.servers.length };
  }

  listServers(): Array<{ name: string; transport: McpServerConfig['transport']; toolCount: number }> {
    return this.servers.map((s) => ({ name: s.name, transport: s.config.transport, toolCount: s.tools.length }));
  }

  listMountedTools(): string[] {
    return [...this.mountedToolNames];
  }

  private async connectAll(config: McpConfig): Promise<void> {
    // Close any existing connections first.
    await this.closeAll();
    this.servers = [];

    for (const [name, serverCfg] of Object.entries(config.servers)) {
      try {
        const { client, transport } = this.createClientAndTransport(serverCfg);
        await client.connect(transport);
        const listed = await client.listTools();
        const tools = (listed.tools ?? []) as ConnectedServer['tools'];
        this.servers.push({ name, config: serverCfg, client, transport, tools });
        logger.success(`MCP connected: ${name} (${serverCfg.transport}), tools=${tools.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`MCP connect failed: ${name} (${serverCfg.transport}): ${msg}`);
      }
    }
  }

  private createClientAndTransport(cfg: McpServerConfig): { client: Client; transport: Transport } {
    const client = new Client(this.clientInfo, { capabilities: {} });

    if (cfg.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        // inherit stderr so users can see server errors
        stderr: 'inherit',
      });
      return { client, transport };
    }

    const url = new URL(cfg.url);
    const transport = new SSEClientTransport(url, {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
    return { client, transport };
  }

  private makeMountedToolName(serverName: string, toolName: string, registry: ToolRegistry): string {
    // Always namespace to avoid collisions with built-in tools.
    const base = `mcp_${serverName}__${toolName}`.replace(/[^\w:.-]/g, '_');
    if (!registry.has(base)) return base;
    // Extremely unlikely, but make it deterministic if collision happens.
    let i = 2;
    while (registry.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }

  private async closeAll(): Promise<void> {
    const toClose = this.servers.map((s) => s.transport.close().catch(() => undefined));
    await Promise.all(toClose);
  }
}
