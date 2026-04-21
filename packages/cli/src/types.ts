// ============================================================
// Core Types for Rookie Code Agent
// ============================================================

// --- LLM Message Types ---

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

// Discriminated union for content blocks
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

// --- Tool Types ---

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

// --- LLM Overrides (from CLI args) ---

export interface LLMOverrides {
  provider?: 'anthropic' | 'openai';
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

// --- Config Types ---

export interface Config {
  llm: {
    provider: 'anthropic' | 'openai';
    model: string;
    apiKey: string;
    baseURL?: string;
    maxTokens: number;
    temperature: number;
  };
  agent: {
    maxIterations: number;
    tokenBudget: number;
  };
  security: {
    allowedCommands: string[];
    blockedPaths: string[];
    requireConfirmation: boolean;
  };
  editor: {
    /** Require user confirmation before applying fuzzy edits (safe default). */
    confirmFuzzyEdits: boolean;
    /** Confirm high-risk edits/creates even when not fuzzy (recommended). */
    confirmHighRiskEdits: boolean;
    /** If a single change touches more than this many lines, require confirmation. */
    maxAutoEditLines: number;
  };
  editorContext: {
    /** Inject editor state (active file / selection snippet) into the system prompt. */
    enabled: boolean;
    /** Max snippet lines to include (after surrounding lines / merging ranges). */
    maxSnippetLines: number;
    /** Include N surrounding lines around each selection. */
    surroundingLines: number;
  };
  repoContext: {
    /** Inject a lightweight repo overview into system prompt. */
    enabled: boolean;
    /** Maximum number of files to include in the repo overview. */
    maxFiles: number;
  };
  observability: {
    /** Write debug session logs to disk (JSONL). */
    enabled: boolean;
    /** Optional directory for logs. Defaults to <cwd>/.rookie-code/logs */
    logDir?: string;
  };
}

// --- Agent Types ---

export type AgentState =
  | 'thinking'
  | 'tool_calling'
  | 'observing'
  | 'done'
  | 'error';

export interface AgentEvent {
  type:
    | 'text_delta'
    | 'tool_call'
    | 'tool_result'
    | 'response'
    | 'error'
    | 'agent_start'
    | 'agent_end'
    | 'llm_usage'
    | 'notification';
  data: unknown;
  /** Agent nesting depth. Top-level agent = 0. */
  depth?: number;
}
