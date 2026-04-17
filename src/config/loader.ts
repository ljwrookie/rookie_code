import type { Config } from '../types.js';
import { DEFAULT_CONFIG, DEFAULT_OPENAI_MODEL, DEFAULT_MODEL } from './defaults.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Load configuration from env vars, project config, and CLI args.
 * Priority: CLI args > env vars > project config > user config > defaults.
 */
export function loadConfig(overrides: Partial<Config['llm']> = {}): Config {
  // Load .env from current working directory (do NOT create or modify it).
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    // Still load process.env (noop for missing file). This keeps the function side-effect free.
    dotenv.config();
  }

  let apiKey =
    overrides.apiKey ??
    process.env['ARK_API_KEY'] ??
    process.env['ANTHROPIC_API_KEY'] ??
    process.env['OPENAI_API_KEY'] ??
    '';

  let provider: Config['llm']['provider'] =
    overrides.provider ??
    ((process.env['OPENAI_API_KEY'] || process.env['ARK_API_KEY']) && !process.env['ANTHROPIC_API_KEY']
      ? 'openai'
      : 'anthropic');

  let model = overrides.model ?? (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_MODEL);
  let baseURL = overrides.baseURL;

  // Parse CUSTOM_MODELS from environment
  if (process.env.CUSTOM_MODELS) {
    try {
      const customModels: unknown = JSON.parse(process.env.CUSTOM_MODELS);
      if (Array.isArray(customModels)) {
        const matchedModel = customModels.find((m: any) => m && m.name === model);
        if (matchedModel) {
          const p = matchedModel.provider;
          if (p === 'openai' || p === 'anthropic') {
            // Only apply if user didn't force provider via CLI overrides.
            if (!overrides.provider) provider = p;
          }
          if (typeof matchedModel.baseURL === 'string' && matchedModel.baseURL.trim()) {
            if (!overrides.baseURL) baseURL = matchedModel.baseURL.trim();
          }

          // Note: apiKey is selected from ARK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY (or CLI overrides).
          // Keep CUSTOM_MODELS focused on provider/baseURL mapping to avoid leaking secrets into JSON.
        }
      }
    } catch (e) {
      console.warn('Failed to parse CUSTOM_MODELS from .env', e);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      provider,
      model,
      apiKey,
      baseURL,
      ...overrides,
    },
  };
}
