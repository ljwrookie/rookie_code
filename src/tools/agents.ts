import type { Tool } from './base.js';
import type { ToolDefinition, ToolResult, Message, AgentEvent } from '../types.js';
import type { ToolRegistry } from './registry.js';
import type { LLMProvider } from '../llm/provider.js';
import type { ToolExecutionContext } from './base.js';
import { AgentLoop } from '../agent/loop.js';

type AgentToolCommonOptions = {
  provider: LLMProvider;
  parentRegistry: ToolRegistry;
  workingDirectory: string;
  onEvent?: (event: AgentEvent) => void;
  maxAgentDepth?: number;
  defaultMaxIterations?: number;
  defaultTokenBudget?: number;
};

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const i = Math.floor(value);
  return i > 0 ? i : fallback;
}

function clampNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const i = Math.floor(value);
  return i >= 0 ? i : fallback;
}

function extractFinalAssistantText(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return '';

  if (typeof lastAssistant.content === 'string') {
    return lastAssistant.content;
  }

  const text = lastAssistant.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  return text;
}

export class AgentTool implements Tool {
  definition: ToolDefinition = {
    name: 'agent',
    description:
      '将子任务委派给一个独立的子 agent（独立对话历史与循环），并返回子 agent 的最终输出。' +
      ' 适用于复杂子任务（例如：定位多个文件、写测试、总结调查结果）。',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '要交给子 agent 执行的任务描述。',
        },
        system_prompt: {
          type: 'string',
          description: '可选：对子 agent 的额外约束/角色描述（会拼接到 task 前）。',
        },
        max_iterations: {
          type: 'number',
          description: '可选：子 agent 最大工具迭代次数（正整数）。',
        },
        token_budget: {
          type: 'number',
          description: '可选：子 agent token 预算（正整数）。',
        },
      },
      required: ['task'],
    },
  };

  constructor(private options: AgentToolCommonOptions) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(input, { depth: 0 });
  }

  async executeWithContext(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const task = String(input['task'] ?? '');
    const systemPrompt = typeof input['system_prompt'] === 'string' ? input['system_prompt'] : undefined;

    if (!task.trim()) {
      return { tool_use_id: '', content: '参数错误：`task` 不能为空。', is_error: true };
    }

    const parentDepth = clampNonNegativeInt(ctx.depth, 0);
    const childDepth = parentDepth + 1;
    const maxAgentDepth = this.options.maxAgentDepth ?? 3;

    if (childDepth > maxAgentDepth) {
      return {
        tool_use_id: '',
        content: `已达到最大 agent 嵌套深度（max=${maxAgentDepth}）。无法继续派生。`,
        is_error: true,
      };
    }

    this.options.onEvent?.({
      type: 'agent_start',
      depth: childDepth,
      data: { mode: 'agent', task },
    });

    const restricted = childDepth >= maxAgentDepth;
    const childRegistry = restricted
      ? this.options.parentRegistry.createRestricted(['agent', 'multiagent'])
      : this.options.parentRegistry;

    const maxIterations = clampPositiveInt(input['max_iterations'], this.options.defaultMaxIterations ?? 15);
    const tokenBudget = clampPositiveInt(input['token_budget'], this.options.defaultTokenBudget ?? 40_000);

    const childLoop = new AgentLoop(this.options.provider, childRegistry, {
      maxIterations,
      tokenBudget,
      workingDirectory: this.options.workingDirectory,
      depth: childDepth,
      onEvent: (event) => this.options.onEvent?.(event),
    });

    const effectiveTask = systemPrompt ? `[System Prompt]\n${systemPrompt}\n\n[Task]\n${task}` : task;

    try {
      const messages = await childLoop.run(effectiveTask, [], ctx.signal);
      const text = extractFinalAssistantText(messages);

      this.options.onEvent?.({
        type: 'agent_end',
        depth: childDepth,
        data: { mode: 'agent', ok: true },
      });

      return {
        tool_use_id: '',
        content: text || '(子 agent 完成，但未返回文本输出)',
        is_error: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      this.options.onEvent?.({
        type: 'agent_end',
        depth: childDepth,
        data: { mode: 'agent', ok: false, error: msg },
      });

      return { tool_use_id: '', content: `子 agent 执行失败：${msg}`, is_error: true };
    }
  }
}

type MultiAgentOptions = AgentToolCommonOptions & {
  maxParallelAgents?: number;
};

type MultiAgentTask = {
  id?: string;
  task: string;
  system_prompt?: string;
  max_iterations?: number;
  token_budget?: number;
};

export class MultiAgentTool implements Tool {
  definition: ToolDefinition = {
    name: 'multiagent',
    description:
      '并行启动多个子 agent 执行多个相互独立的任务，并汇总返回结果（JSON）。' +
      ' 适用于并行探索/分析（例如：分别检查不同模块）。',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '要并行执行的任务数组。每项：{ id?, task, system_prompt?, max_iterations?, token_budget? }',
        },
      },
      required: ['tasks'],
    },
  };

  constructor(private options: MultiAgentOptions) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(input, { depth: 0 });
  }

  async executeWithContext(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tasksRaw = input['tasks'];
    if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
      return { tool_use_id: '', content: '参数错误：`tasks` 必须是非空数组。', is_error: true };
    }

    const maxParallel = this.options.maxParallelAgents ?? 5;
    if (tasksRaw.length > maxParallel) {
      return {
        tool_use_id: '',
        content: `参数错误：tasks 数量超出并行上限（max=${maxParallel}）。`,
        is_error: true,
      };
    }

    const parentDepth = clampNonNegativeInt(ctx.depth, 0);
    const childDepth = parentDepth + 1;
    const maxAgentDepth = this.options.maxAgentDepth ?? 3;
    if (childDepth > maxAgentDepth) {
      return {
        tool_use_id: '',
        content: `已达到最大 agent 嵌套深度（max=${maxAgentDepth}）。无法继续派生。`,
        is_error: true,
      };
    }

    this.options.onEvent?.({
      type: 'agent_start',
      depth: childDepth,
      data: { mode: 'multiagent', count: tasksRaw.length },
    });

    const restricted = childDepth >= maxAgentDepth;
    const baseRegistry = restricted
      ? this.options.parentRegistry.createRestricted(['agent', 'multiagent'])
      : this.options.parentRegistry;

    const tasks: MultiAgentTask[] = tasksRaw.map((t) => (t as MultiAgentTask));

    const runs = tasks.map(async (t, index) => {
      const id = (typeof t.id === 'string' && t.id.trim()) ? t.id.trim() : String(index + 1);
      const task = typeof t.task === 'string' ? t.task : '';
      const systemPrompt = typeof t.system_prompt === 'string' ? t.system_prompt : undefined;

      if (!task.trim()) {
        return { id, ok: false, error: 'task 不能为空', output: '' };
      }

      const maxIterations = clampPositiveInt(t.max_iterations, this.options.defaultMaxIterations ?? 15);
      const tokenBudget = clampPositiveInt(t.token_budget, this.options.defaultTokenBudget ?? 40_000);
      const loop = new AgentLoop(this.options.provider, baseRegistry, {
        maxIterations,
        tokenBudget,
        workingDirectory: this.options.workingDirectory,
        depth: childDepth,
        onEvent: (event) => this.options.onEvent?.(event),
      });

      const effectiveTask = systemPrompt ? `[System Prompt]\n${systemPrompt}\n\n[Task]\n${task}` : task;

      try {
        const messages = await loop.run(effectiveTask, [], ctx.signal);
        const text = extractFinalAssistantText(messages);
        return { id, ok: true, output: text };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { id, ok: false, error: msg, output: '' };
      }
    });

    try {
      const results = await Promise.all(runs);
      this.options.onEvent?.({
        type: 'agent_end',
        depth: childDepth,
        data: { mode: 'multiagent', ok: true },
      });
      return { tool_use_id: '', content: JSON.stringify({ results }, null, 2), is_error: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.options.onEvent?.({
        type: 'agent_end',
        depth: childDepth,
        data: { mode: 'multiagent', ok: false, error: msg },
      });
      return { tool_use_id: '', content: `multiagent 执行失败：${msg}`, is_error: true };
    }
  }
}

