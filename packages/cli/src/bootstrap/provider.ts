import type { Config } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import { AnthropicProvider } from '../llm/anthropic.js';
import { OpenAIProvider } from '../llm/openai.js';

/**
 * Initialize the LLM provider based on config.
 * Validates API key presence before creating the provider.
 */
export function createProvider(config: Config): LLMProvider {
  // Validate API key
  if (!config.llm.apiKey) {
    const envVar = config.llm.provider === 'openai' ? 'OPENAI_API_KEY or ARK_API_KEY' : 'ANTHROPIC_API_KEY';
    console.error(
      `Error: ${envVar} environment variable is not set.\n` +
      `Set it in your .env file or with: export ${envVar}=your-key-here`,
    );
    process.exit(1);
  }

  return config.llm.provider === 'openai'
    ? new OpenAIProvider(config.llm.apiKey, config.llm.model, config.llm.baseURL)
    : new AnthropicProvider(config.llm.apiKey, config.llm.model, config.llm.baseURL);
}
