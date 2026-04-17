import type { Config } from '../types.js';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

export const DEFAULT_CONFIG: Config = {
  llm: {
    provider: 'anthropic',
    model: DEFAULT_MODEL,
    apiKey: '', // loaded from env
    maxTokens: 8192,
    temperature: 0,
  },
  agent: {
    maxIterations: 30,
    tokenBudget: 100_000,
  },
  security: {
    allowedCommands: [
      'cat',
      'ls',
      'find',
      'grep',
      'rg',
      'git',
      'node',
      'npm',
      'pnpm',
      'npx',
      'echo',
      'head',
      'tail',
      'wc',
      'sort',
      'uniq',
      'pwd',
      'which',
      'whoami',
      'date',
    ],
    blockedPaths: [
      '/etc',
      '/usr',
      '/System',
      path.join(os.homedir(), '.ssh'),
      path.join(os.homedir(), '.gnupg'),
    ],
    requireConfirmation: true,
  },
  editor: {
    confirmFuzzyEdits: true,
    confirmHighRiskEdits: true,
    maxAutoEditLines: 200,
  },
  repoContext: {
    enabled: true,
    maxFiles: 120,
  },
  observability: {
    enabled: false,
  },
};
