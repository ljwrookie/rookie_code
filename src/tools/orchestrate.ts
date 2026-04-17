import { z } from 'zod';
import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult, Message } from '../types.js';
import type { ToolRegistry } from './registry.js';
import type { LLMProvider } from '../llm/provider.js';
import type { ToolExecutionContext } from './base.js';
import { AgentLoop } from '../agent/loop.js';
import type { HookManager } from '../hooks/manager.js';

type OrchestrateOptions = {
  provider: LLMProvider;
  parentRegistry: ToolRegistry;
  workingDirectory: string;
  hookManager?: HookManager;
  maxAgentDepth?: number;
  defaultMaxIterations?: number;
  defaultTokenBudget?: number;
  maxParallel?: number;
};

const PlanSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().min(1).optional(),
      task: z.string().min(1),
      system_prompt: z.string().min(1).optional(),
    }),
  ).min(1),
});

function extractFinalAssistantText(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return '';
  if (typeof lastAssistant.content === 'string') return lastAssistant.content;
  return lastAssistant.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

export class OrchestrateTool implements Tool {
  definition: ToolDefinition = {
    name: 'orchestrate',
    description:
      'Planner/worker 编排：先生成任务分解（JSON），再并行运行多个子 agent，最后汇总输出。' +
      ' 适用于跨模块的大任务。',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '要完成的总体目标。' },
        workers: { type: 'number', description: '并行 worker 数量（默认 3）。' },
        max_iterations: { type: 'number', description: '每个 worker 的最大迭代次数。' },
        token_budget: { type: 'number', description: '每个 worker 的 token 预算。' },
        plan_only: { type: 'boolean', description: '只输出任务分解，不运行 worker。' },
      },
      required: ['goal'],
    },
  };

  constructor(private options: OrchestrateOptions) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(input, { depth: 0 });
  }

  async executeWithContext(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const goal = String(input['goal'] ?? '').trim();
    if (!goal) return { tool_use_id: '', content: '参数错误：`goal` 不能为空。', is_error: true };

    const workers = clampInt(input['workers'], 3, 1, this.options.maxParallel ?? 5);
    const maxIterations = clampInt(input['max_iterations'], this.options.defaultMaxIterations ?? 15, 1, 200);
    const tokenBudget = clampInt(input['token_budget'], this.options.defaultTokenBudget ?? 40_000, 1, 500_000);
    const planOnly = Boolean(input['plan_only']);

    const parentDepth = clampInt(ctx.depth, 0, 0, 1000);
    const childDepth = parentDepth + 1;
    const maxAgentDepth = this.options.maxAgentDepth ?? 3;
    if (childDepth > maxAgentDepth) {
      return { tool_use_id: '', content: `已达到最大 agent 嵌套深度（max=${maxAgentDepth}）。`, is_error: true };
    }

    const plan = await this.buildPlan(goal, workers, ctx.signal);
    if (!plan.ok) return { tool_use_id: '', content: plan.error, is_error: true };

    if (planOnly) {
      return { tool_use_id: '', content: JSON.stringify(plan.value, null, 2), is_error: false };
    }

    const restricted = childDepth >= maxAgentDepth;
    const baseRegistry = restricted
      ? this.options.parentRegistry.createRestricted(['agent', 'multiagent', 'orchestrate'])
      : this.options.parentRegistry;

    const tasks = plan.value.tasks.slice(0, workers);
    const runs = tasks.map(async (t, index) => {
      const id = (t.id?.trim() ? t.id.trim() : String(index + 1));
      const effectiveTask = t.system_prompt
        ? `[System Prompt]\n${t.system_prompt}\n\n[Task]\n${t.task}`
        : t.task;

      const loop = new AgentLoop(this.options.provider, baseRegistry, {
        maxIterations,
        tokenBudget,
        workingDirectory: this.options.workingDirectory,
        depth: childDepth,
        hookManager: this.options.hookManager,
      });

      const subagentId = `orchestrate_${childDepth}_${id}`;
      if (this.options.hookManager) {
        await this.options.hookManager.emitSubagentStart(subagentId, 'orchestrate');
      }
      try {
        const messages = await loop.run(effectiveTask, [], ctx.signal);
        const text = extractFinalAssistantText(messages);
        if (this.options.hookManager) {
          await this.options.hookManager.emitSubagentStop(subagentId, 'orchestrate');
        }
        return { id, ok: true as const, output: text };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (this.options.hookManager) {
          await this.options.hookManager.emitSubagentStop(subagentId, 'orchestrate');
        }
        return { id, ok: false as const, error: msg, output: '' };
      }
    });

    const results = await Promise.all(runs);
    const summary = await this.summarize(goal, plan.value, results, ctx.signal);

    return {
      tool_use_id: '',
      content: `${summary}\n\n---\n\n${JSON.stringify({ plan: plan.value, results }, null, 2)}`,
      is_error: results.some((r) => !r.ok),
    };
  }

  private async buildPlan(goal: string, workers: number, signal?: AbortSignal): Promise<
    { ok: true; value: z.infer<typeof PlanSchema> } | { ok: false; error: string }
  > {
    const system =
      'You are a planner. Output ONLY valid JSON. No markdown. No extra text.\n' +
      'Schema: { "tasks": [ { "id"?: string, "task": string, "system_prompt"?: string } ] }\n' +
      'Constraints: tasks must be independent, non-overlapping, and actionable for a code agent.';

    const user =
      `Goal:\n${goal}\n\n` +
      `Workers: ${workers}\n` +
      `Return 1..${workers} tasks.`;

    const resp = await this.options.provider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      tools: undefined,
      signal,
    });

    const text = extractFinalAssistantText([{ role: 'assistant', content: resp.content } as any]);
    const jsonText = typeof text === 'string' ? text.trim() : '';
    try {
      const parsed = JSON.parse(jsonText);
      const validated = PlanSchema.safeParse(parsed);
      if (!validated.success) {
        return { ok: false, error: `Planner output schema invalid: ${validated.error.message}` };
      }
      return { ok: true, value: validated.data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Planner output is not valid JSON: ${msg}` };
    }
  }

  private async summarize(
    goal: string,
    plan: z.infer<typeof PlanSchema>,
    results: Array<{ id: string; ok: boolean; output: string; error?: string }>,
    signal?: AbortSignal,
  ): Promise<string> {
    const system =
      'You are a coordinator. Summarize the worker results concisely. ' +
      'State what is done, what failed, and the next concrete steps.';
    const user = [
      `Goal:\n${goal}`,
      `Plan:\n${JSON.stringify(plan, null, 2)}`,
      `Results:\n${JSON.stringify(results, null, 2)}`,
    ].join('\n\n');

    const resp = await this.options.provider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      tools: undefined,
      signal,
    });
    return extractFinalAssistantText([{ role: 'assistant', content: resp.content } as any]) || '(no summary)';
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const i = Math.floor(value);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

