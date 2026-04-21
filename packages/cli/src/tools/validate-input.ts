import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

type JsonSchema =
  | {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    }
  | Record<string, unknown>;

type ZodBuildResult =
  | { ok: true; schema: z.ZodTypeAny }
  | { ok: false; reason: string };

export function validateToolInput(def: ToolDefinition, input: Record<string, unknown>): {
  ok: true;
} | {
  ok: false;
  message: string;
} {
  const built = buildZodFromJsonSchema(def.input_schema as JsonSchema);
  if (!built.ok) {
    // Keep compatibility: if we can't interpret the schema, don't block tool execution.
    return { ok: true };
  }

  const parsed = built.schema.safeParse(input);
  if (parsed.success) return { ok: true };

  const issues = parsed.error.issues
    .slice(0, 12)
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)';
      return `- ${path}: ${i.message}`;
    })
    .join('\n');

  return {
    ok: false,
    message:
      `Tool input validation failed for "${def.name}".\n` +
      `Please fix the arguments and try again.\n` +
      `\nIssues:\n${issues}`,
  };
}

function buildZodFromJsonSchema(schema: JsonSchema): ZodBuildResult {
  const anySchema = schema as any;
  if (!anySchema || typeof anySchema !== 'object') {
    return { ok: false, reason: 'schema is not an object' };
  }

  if (anySchema.type !== 'object') {
    return { ok: false, reason: 'only object schemas are supported' };
  }

  const properties: Record<string, unknown> = anySchema.properties ?? {};
  if (!properties || typeof properties !== 'object') {
    return { ok: false, reason: 'properties missing' };
  }

  const required = new Set<string>(Array.isArray(anySchema.required) ? anySchema.required : []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchemaRaw] of Object.entries(properties)) {
    const propSchema = buildZodForProperty(propSchemaRaw);
    if (!propSchema.ok) {
      return { ok: false, reason: `unsupported property schema for "${key}": ${propSchema.reason}` };
    }
    shape[key] = required.has(key) ? propSchema.schema : propSchema.schema.optional();
  }

  return { ok: true, schema: z.object(shape).passthrough() };
}

function buildZodForProperty(propSchemaRaw: unknown): ZodBuildResult {
  const s = propSchemaRaw as any;
  if (!s || typeof s !== 'object') return { ok: false, reason: 'property schema is not an object' };

  // enum
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const values = s.enum.filter((v: unknown) => typeof v === 'string') as string[];
    if (values.length === s.enum.length) {
      return { ok: true, schema: z.enum(values as [string, ...string[]]) };
    }
    // fall back to a literal union for mixed enums
    return { ok: true, schema: z.union(s.enum.map((v: any) => z.literal(v)) as [z.ZodTypeAny, ...z.ZodTypeAny[]]) };
  }

  const t = s.type;
  if (t === 'string') return { ok: true, schema: z.string() };
  if (t === 'boolean') return { ok: true, schema: z.boolean() };
  if (t === 'number') return { ok: true, schema: z.number() };
  if (t === 'integer') return { ok: true, schema: z.number().int() };

  if (t === 'array') {
    const items = s.items;
    if (!items) return { ok: false, reason: 'array items missing' };
    const itemSchema = buildZodForProperty(items);
    if (!itemSchema.ok) return itemSchema;
    return { ok: true, schema: z.array(itemSchema.schema) };
  }

  if (t === 'object') {
    // Nested object schemas: support same subset.
    return buildZodFromJsonSchema(s as JsonSchema);
  }

  return { ok: false, reason: `unsupported type "${String(t)}"` };
}

