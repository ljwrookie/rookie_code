import fs from 'node:fs/promises';
import path from 'node:path';

export type McpServerConfig =
  | {
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      transport: 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export interface McpConfig {
  /**
   * Key = server name.
   */
  servers: Record<string, McpServerConfig>;
  /**
   * Where it was loaded from.
   */
  sourcePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') return undefined;
    out.push(v);
  }
  return out;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') return undefined;
    out[k] = v;
  }
  return out;
}

/**
 * Load MCP config from `.mcp.json` in the working directory.
 *
 * Supported shape (Forge-style):
 * {
 *   "mcpServers": {
 *     "serverA": { "command": "npx", "args": ["-y", "..."], "env": { "K":"V" } },
 *     "serverB": { "url": "http://localhost:3000/sse" }
 *   }
 * }
 */
export async function loadMcpConfig(cwd: string): Promise<McpConfig | null> {
  const sourcePath = path.join(cwd, '.mcp.json');

  try {
    const raw = await fs.readFile(sourcePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const serversNode = parsed['mcpServers'];
    if (!isRecord(serversNode)) return null;

    const servers: Record<string, McpServerConfig> = {};

    for (const [serverName, cfg] of Object.entries(serversNode)) {
      if (!isRecord(cfg)) continue;

      // stdio transport
      const command = cfg['command'];
      if (typeof command === 'string' && command.trim()) {
        const args = parseStringArray(cfg['args']);
        const env = parseStringRecord(cfg['env']);
        const serverCwd = typeof cfg['cwd'] === 'string' ? cfg['cwd'] : undefined;
        servers[serverName] = {
          transport: 'stdio',
          command,
          ...(args ? { args } : {}),
          ...(env ? { env } : {}),
          ...(serverCwd ? { cwd: serverCwd } : {}),
        };
        continue;
      }

      // sse transport
      const url = cfg['url'];
      if (typeof url === 'string' && url.trim()) {
        const headers = parseStringRecord(cfg['headers']);
        servers[serverName] = {
          transport: 'sse',
          url,
          ...(headers ? { headers } : {}),
        };
        continue;
      }
    }

    return { servers, sourcePath };
  } catch (err: any) {
    // Missing config is fine (MCP disabled by default).
    if (err?.code === 'ENOENT') return null;
    // Invalid JSON or read errors: treat as disabled, caller can report.
    return null;
  }
}

