export type HookEvent =
  | 'before_execute_command'
  | 'after_execute_command'
  | 'before_agent_run'
  | 'after_agent_run'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'post_tool_use_failure'
  | 'user_prompt_submit'
  | 'stop'
  | 'subagent_start'
  | 'subagent_stop'
  | 'session_start'
  | 'session_end'
  | 'pre_compact'
  | 'post_compact'
  | 'notification'
  | 'permission_request';

export type HookResult<T> = T | void;

export type BeforeExecuteCommandHook = (args: {
  input: string;
}) => HookResult<{ input?: string; bypass?: boolean }>;

export type AfterExecuteCommandHook = (args: {
  input: string;
  result: 'exit' | 'handled' | 'unknown';
}) => HookResult<void>;

export type BeforeAgentRunHook = (args: {
  input: string;
}) => HookResult<{ input?: string }>;

export type AfterAgentRunHook = (args: {
  input: string;
}) => HookResult<void>;

export type PreToolUseHook = (args: { tool_input: any }) => HookResult<void>;
export type PostToolUseHook = (args: { tool_input: any; tool_response: any }) => HookResult<void>;
export type PostToolUseFailureHook = (args: { tool_input: any; error: Error | unknown }) => HookResult<void>;
export type UserPromptSubmitHook = (args: { prompt: string }) => HookResult<void>;
export type StopHook = () => HookResult<void>;
export type SubagentStartHook = (args: { agent_id: string; agent_type: string }) => HookResult<void>;
export type SubagentStopHook = (args: { agent_id: string; agent_type: string }) => HookResult<void>;
export type SessionStartHook = (args: { source: 'startup' | 'resume' | 'clear' }) => HookResult<void>;
export type SessionEndHook = (args: { reason: 'clear' | 'resume' | 'prompt_input_exit' | 'other' }) => HookResult<void>;
export type PreCompactHook = () => HookResult<void>;
export type PostCompactHook = (args: { compact_summary: string }) => HookResult<void>;
export type NotificationHook = (args: { title: string; message: string; notification_type: string }) => HookResult<void>;
export type PermissionRequestHook = (args: { tool_input: any }) => HookResult<void>;

type HookFn =
  | BeforeExecuteCommandHook
  | AfterExecuteCommandHook
  | BeforeAgentRunHook
  | AfterAgentRunHook
  | PreToolUseHook
  | PostToolUseHook
  | PostToolUseFailureHook
  | UserPromptSubmitHook
  | StopHook
  | SubagentStartHook
  | SubagentStopHook
  | SessionStartHook
  | SessionEndHook
  | PreCompactHook
  | PostCompactHook
  | NotificationHook
  | PermissionRequestHook;

export class HookManager {
  private hooks = new Map<HookEvent, HookFn[]>();

  on(event: 'before_execute_command', fn: BeforeExecuteCommandHook): void;
  on(event: 'after_execute_command', fn: AfterExecuteCommandHook): void;
  on(event: 'before_agent_run', fn: BeforeAgentRunHook): void;
  on(event: 'after_agent_run', fn: AfterAgentRunHook): void;
  on(event: 'pre_tool_use', fn: PreToolUseHook): void;
  on(event: 'post_tool_use', fn: PostToolUseHook): void;
  on(event: 'post_tool_use_failure', fn: PostToolUseFailureHook): void;
  on(event: 'user_prompt_submit', fn: UserPromptSubmitHook): void;
  on(event: 'stop', fn: StopHook): void;
  on(event: 'subagent_start', fn: SubagentStartHook): void;
  on(event: 'subagent_stop', fn: SubagentStopHook): void;
  on(event: 'session_start', fn: SessionStartHook): void;
  on(event: 'session_end', fn: SessionEndHook): void;
  on(event: 'pre_compact', fn: PreCompactHook): void;
  on(event: 'post_compact', fn: PostCompactHook): void;
  on(event: 'notification', fn: NotificationHook): void;
  on(event: 'permission_request', fn: PermissionRequestHook): void;
  on(event: HookEvent, fn: HookFn): void {
    const list = this.hooks.get(event) ?? [];
    list.push(fn);
    this.hooks.set(event, list);
  }

  async emitBeforeExecuteCommand(input: string): Promise<{ input: string; bypass: boolean }> {
    const fns = (this.hooks.get('before_execute_command') ?? []) as BeforeExecuteCommandHook[];
    let current = input;
    for (const fn of fns) {
      const out = await fn({ input: current });
      if (out?.input != null) current = out.input;
      if (out?.bypass) return { input: current, bypass: true };
    }
    return { input: current, bypass: false };
  }

  async emitAfterExecuteCommand(input: string, result: 'exit' | 'handled' | 'unknown'): Promise<void> {
    const fns = (this.hooks.get('after_execute_command') ?? []) as AfterExecuteCommandHook[];
    for (const fn of fns) {
      await fn({ input, result });
    }
  }

  async emitBeforeAgentRun(input: string): Promise<string> {
    const fns = (this.hooks.get('before_agent_run') ?? []) as BeforeAgentRunHook[];
    let current = input;
    for (const fn of fns) {
      const out = await fn({ input: current });
      if (out?.input != null) current = out.input;
    }
    return current;
  }

  async emitAfterAgentRun(input: string): Promise<void> {
    const fns = (this.hooks.get('after_agent_run') ?? []) as AfterAgentRunHook[];
    for (const fn of fns) {
      await fn({ input });
    }
  }

  async emitPreToolUse(tool_input: any): Promise<void> {
    const fns = (this.hooks.get('pre_tool_use') ?? []) as PreToolUseHook[];
    for (const fn of fns) await fn({ tool_input });
  }

  async emitPostToolUse(tool_input: any, tool_response: any): Promise<void> {
    const fns = (this.hooks.get('post_tool_use') ?? []) as PostToolUseHook[];
    for (const fn of fns) await fn({ tool_input, tool_response });
  }

  async emitPostToolUseFailure(tool_input: any, error: Error | unknown): Promise<void> {
    const fns = (this.hooks.get('post_tool_use_failure') ?? []) as PostToolUseFailureHook[];
    for (const fn of fns) await fn({ tool_input, error });
  }

  async emitUserPromptSubmit(prompt: string): Promise<void> {
    const fns = (this.hooks.get('user_prompt_submit') ?? []) as UserPromptSubmitHook[];
    for (const fn of fns) await fn({ prompt });
  }

  async emitStop(): Promise<void> {
    const fns = (this.hooks.get('stop') ?? []) as StopHook[];
    for (const fn of fns) await fn();
  }

  async emitSubagentStart(agent_id: string, agent_type: string): Promise<void> {
    const fns = (this.hooks.get('subagent_start') ?? []) as SubagentStartHook[];
    for (const fn of fns) await fn({ agent_id, agent_type });
  }

  async emitSubagentStop(agent_id: string, agent_type: string): Promise<void> {
    const fns = (this.hooks.get('subagent_stop') ?? []) as SubagentStopHook[];
    for (const fn of fns) await fn({ agent_id, agent_type });
  }

  async emitSessionStart(source: 'startup' | 'resume' | 'clear'): Promise<void> {
    const fns = (this.hooks.get('session_start') ?? []) as SessionStartHook[];
    for (const fn of fns) await fn({ source });
  }

  async emitSessionEnd(reason: 'clear' | 'resume' | 'prompt_input_exit' | 'other'): Promise<void> {
    const fns = (this.hooks.get('session_end') ?? []) as SessionEndHook[];
    for (const fn of fns) await fn({ reason });
  }

  async emitPreCompact(): Promise<void> {
    const fns = (this.hooks.get('pre_compact') ?? []) as PreCompactHook[];
    for (const fn of fns) await fn();
  }

  async emitPostCompact(compact_summary: string): Promise<void> {
    const fns = (this.hooks.get('post_compact') ?? []) as PostCompactHook[];
    for (const fn of fns) await fn({ compact_summary });
  }

  async emitNotification(title: string, message: string, notification_type: string): Promise<void> {
    const fns = (this.hooks.get('notification') ?? []) as NotificationHook[];
    for (const fn of fns) await fn({ title, message, notification_type });
  }

  async emitPermissionRequest(tool_input: any): Promise<void> {
    const fns = (this.hooks.get('permission_request') ?? []) as PermissionRequestHook[];
    for (const fn of fns) await fn({ tool_input });
  }
}
