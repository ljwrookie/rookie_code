import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentEvent } from '../types.js';

type LogRecord = {
  ts: string;
  sessionId: string;
  type: string;
  data: unknown;
};

export class SessionLogger {
  private readonly sessionId: string;
  private readonly filePath: string;

  constructor(params: { cwd: string; logDir?: string }) {
    this.sessionId = crypto.randomUUID();
    const dir = params.logDir?.trim()
      ? path.resolve(params.cwd, params.logDir.trim())
      : path.join(params.cwd, '.rookie-code', 'logs');
    const fileName = `session-${new Date().toISOString().replace(/[:.]/g, '-')}-${this.sessionId}.jsonl`;
    this.filePath = path.join(dir, fileName);
  }

  getLogFilePath(): string {
    return this.filePath;
  }

  async log(type: string, data: unknown): Promise<void> {
    const rec: LogRecord = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      type,
      data,
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(rec) + '\n', 'utf8');
  }

  /**
   * Log an agent event. Skips noisy streaming tokens by default.
   */
  async logAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'text_delta') return;
    await this.log('agent_event', event);
  }
}

