import { z } from 'zod';

/**
 * Zod schema for validating the full Config object.
 * Ensures "fail fast on bad config" — any invalid value will be caught
 * at load time with a clear error message.
 */
export const ConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().min(1, 'Model name must be a non-empty string'),
    apiKey: z.string('API key must be a string (can be empty — will be caught later)'),
    baseURL: z.string().optional(),
    maxTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
  }),
  agent: z.object({
    maxIterations: z.number().int().positive('maxIterations must be a positive integer'),
    tokenBudget: z.number().int().positive('tokenBudget must be a positive integer'),
  }),
  security: z.object({
    allowedCommands: z.array(z.string()),
    blockedPaths: z.array(z.string()),
    requireConfirmation: z.boolean(),
  }),
  editor: z.object({
    confirmFuzzyEdits: z.boolean(),
    confirmHighRiskEdits: z.boolean(),
    maxAutoEditLines: z.number().int().positive('maxAutoEditLines must be a positive integer'),
  }),
  repoContext: z.object({
    enabled: z.boolean(),
    maxFiles: z.number().int().positive(),
  }),
  observability: z.object({
    enabled: z.boolean(),
    logDir: z.string().optional(),
  }),
});

/**
 * Validate a config object against the zod schema.
 * Throws a descriptive error listing all validation issues.
 */
export function validateConfig(config: unknown): asserts config is z.infer<typeof ConfigSchema> {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return `  - ${path ? `${path}: ` : ''}${issue.message}`;
      })
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }
}
