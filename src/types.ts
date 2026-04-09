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
}

// --- Agent Types ---

export type AgentState =
  | 'thinking'
  | 'tool_calling'
  | 'observing'
  | 'done'
  | 'error';

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'response' | 'error';
  data: unknown;
}
