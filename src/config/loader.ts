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
  // Load .env from current working directory
  const envPath = path.join(process.cwd(), '.env');
  
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    // Write a default .env if it doesn't exist
    const defaultEnvContent = `# LLM Configuration
# ANTHROPIC_API_KEY=your_anthropic_key
# OPENAI_API_KEY=your_openai_key

# Custom Models Configuration (JSON format)
# Example:
# CUSTOM_MODELS=[{"name":"ep-20260119234417-bhr7d","provider":"openai","baseURL":"https://ark-cn-beijing.bytedance.net/api/v3"}]

# ARK API Key
ARK_API_KEY=a0fa13e7-fa19-4023-b69f-868172ec65e0
`;
    try {
      fs.writeFileSync(envPath, defaultEnvContent);
    } catch (err) {
      console.warn(`Failed to write default .env file: ${err}`);
    }
    // Load again just in case
    dotenv.config({ path: envPath });
  }

  const apiKey =
    overrides.apiKey ??
    process.env['ARK_API_KEY'] ??
    process.env['ANTHROPIC_API_KEY'] ??
    process.env['OPENAI_API_KEY'] ??
    '';

  const provider: Config['llm']['provider'] =
    overrides.provider ??
    ((process.env['OPENAI_API_KEY'] || process.env['ARK_API_KEY']) && !process.env['ANTHROPIC_API_KEY']
      ? 'openai'
      : 'anthropic');

  let model = overrides.model ?? (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_MODEL);
  let baseURL = overrides.baseURL;

  // Parse CUSTOM_MODELS from environment
  if (process.env.CUSTOM_MODELS) {
    try {
      const customModels = JSON.parse(process.env.CUSTOM_MODELS);
      if (Array.isArray(customModels)) {
        const matchedModel = customModels.find(m => m.name === model);
        if (matchedModel) {
          if (matchedModel.provider) {
             // TS is strict about literal types here, ignore for now as we just overwrite it below or we enforce type
             (overrides as any).provider = matchedModel.provider;
          }
          if (matchedModel.baseURL) baseURL = matchedModel.baseURL;
        } else if (customModels.length > 0 && !overrides.model) {
           // If a custom model is configured but we didn't explicitly request one, maybe default to the first custom one?
           // The user requested to be able to switch in CLI, so CLI arg goes to overrides.model.
        }
      }
    } catch (e) {
      console.warn("Failed to parse CUSTOM_MODELS from .env", e);
    }
  }

  // Also support a direct ARK integration for the user's specific use case
  if (model === 'ep-20260119234417-bhr7d') {
      baseURL = baseURL ?? "https://ark-cn-beijing.bytedance.net/api/v3";
      // ensure we use openai provider for this ark model
      (overrides as any).provider = 'openai';
  }


  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      provider: (overrides as any).provider ?? provider,
      model,
      apiKey,
      baseURL,
      ...overrides,
    },
  };
}
