import { parseArgs } from 'node:util';
import type { Config, LLMOverrides } from '../types.js';
import { loadConfig } from '../config/loader.js';
import { setLogLevel } from '../utils/logger.js';

/** Parsed CLI args and the built config. */
export interface BuildConfigResult {
  config: Config;
  values: Record<string, unknown>;
}

/** CLI option definitions shared with parseArgs. */
const CLI_OPTIONS = {
  model: { type: 'string', short: 'm' },
  provider: { type: 'string', short: 'p' },
  'base-url': { type: 'string' },
  'no-confirm': { type: 'boolean' },
  debug: { type: 'boolean' },
  'log-dir': { type: 'string' },
  verbose: { type: 'boolean', short: 'v' },
  'no-repo-context': { type: 'boolean' },
  'repo-max-files': { type: 'string' },
  'no-confirm-fuzzy-edits': { type: 'boolean' },
  'no-confirm-high-risk-edits': { type: 'boolean' },
  'max-auto-edit-lines': { type: 'string' },
  'max-iterations': { type: 'string' },
  'token-budget': { type: 'string' },
} as const;

/**
 * Parse CLI arguments, load config, apply CLI overrides, and return
 * the final config along with the raw parsed values.
 */
export function buildConfig(): BuildConfigResult {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: CLI_OPTIONS,
    strict: false,
  });

  const llmOverrides: LLMOverrides = {};
  if (values.model) llmOverrides.model = values.model as string;
  if (values.provider && (values.provider === 'openai' || values.provider === 'anthropic')) {
    llmOverrides.provider = values.provider as 'openai' | 'anthropic';
  }
  if (values['base-url']) llmOverrides.baseURL = values['base-url'] as string;

  const config = loadConfig(llmOverrides);

  if (values.verbose) {
    setLogLevel('verbose');
  }

  if (values['no-confirm']) {
    config.security.requireConfirmation = false;
  }
  if (values['no-repo-context']) {
    config.repoContext.enabled = false;
  }
  if (values['repo-max-files']) {
    const parsed = Number.parseInt(values['repo-max-files'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.repoContext.maxFiles = Math.min(parsed, 500);
    }
  }
  if (values['no-confirm-fuzzy-edits']) {
    config.editor.confirmFuzzyEdits = false;
  }
  if (values['no-confirm-high-risk-edits']) {
    config.editor.confirmHighRiskEdits = false;
  }
  if (values['max-auto-edit-lines']) {
    const parsed = Number.parseInt(values['max-auto-edit-lines'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.editor.maxAutoEditLines = Math.min(parsed, 10_000);
    }
  }

  if (values.debug) {
    config.observability.enabled = true;
    if (values['log-dir']) {
      config.observability.logDir = values['log-dir'] as string;
    }
  }

  // Apply agent CLI overrides that are not part of loadConfig()
  if (values['max-iterations']) {
    const parsed = Number.parseInt(values['max-iterations'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.agent.maxIterations = Math.min(parsed, 200);
    }
  }
  if (values['token-budget']) {
    const parsed = Number.parseInt(values['token-budget'] as string, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.agent.tokenBudget = Math.min(parsed, 500_000);
    }
  }

  return { config, values };
}
