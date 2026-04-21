/**
 * Context window management with sliding window + summarization.
 *
 * Strategy:
 * 1. Count total tokens across all messages
 * 2. If over budget:
 *    a. Keep the most recent N conversation rounds
 *    b. Summarize older messages into a compact summary
 *    c. Summary is prepended to the context
 */

import type { Message, ContentBlock } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import { countMessagesTokens, countTokens } from '../utils/tokens.js';

export interface TrimResult {
  messages: Message[];
  summary?: string;
  trimmedCount: number;
}

/**
 * Trim messages to fit within a token budget using sliding window.
 *
 * @param messages - Full message history
 * @param tokenBudget - Maximum tokens allowed
 * @param preserveRecent - Number of recent message *pairs* (user+assistant) to always keep
 * @returns Trimmed messages and optional summary of removed messages
 */
export function trimToFit(
  messages: Message[],
  tokenBudget: number,
  preserveRecent: number = 5,
): TrimResult {
  const totalTokens = countMessagesTokens(messages);

  // If within budget, return as-is
  if (totalTokens <= tokenBudget) {
    return { messages: [...messages], trimmedCount: 0 };
  }

  // Calculate how many messages to keep from the end.
  // A "round" is typically a user message + assistant response.
  const recentCount = Math.min(preserveRecent * 2, messages.length);
  const recentMessages = messages.slice(-recentCount);
  const recentTokens = countMessagesTokens(recentMessages);

  // If even recent messages exceed budget, keep as many as we can
  if (recentTokens > tokenBudget) {
    // Keep trimming from the front of recent messages
    let trimmed = [...recentMessages];
    while (countMessagesTokens(trimmed) > tokenBudget && trimmed.length > 2) {
      trimmed = trimmed.slice(2); // Remove oldest pair
    }
    return {
      messages: trimmed,
      trimmedCount: messages.length - trimmed.length,
    };
  }

  const oldMessages = messages.slice(0, -recentCount);
  const summary = generateLocalSummary(oldMessages);

  // Budget for summary: whatever's left after recent messages
  const summaryBudget = tokenBudget - recentTokens;
  const truncatedSummary = truncateSummaryToFit(summary, summaryBudget);

  return {
    messages: recentMessages,
    summary: truncatedSummary,
    trimmedCount: oldMessages.length,
  };
}

/**
 * Generate a summary of messages by asking the LLM.
 * Used for the /compact command.
 */
export async function summarizeWithLLM(
  messages: Message[],
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<string> {
  const messagesText = messages
    .map(m => {
      const content = typeof m.content === 'string'
        ? m.content
        : formatContentBlocks(m.content);
      return `[${m.role}]: ${content}`;
    })
    .join('\n\n');

  // Ask LLM to summarize
  const summaryMessages: Message[] = [
    {
      role: 'user',
      content:
        'Please provide a concise summary of the following conversation. ' +
        'Focus on: 1) What files were discussed/modified, 2) Key decisions made, ' +
        '3) Current state of the task. Keep it under 500 words.\n\n' +
        messagesText,
    },
  ];

  let summary = '';
  const stream = provider.stream({
    system: 'You are a conversation summarizer. Produce concise, factual summaries.',
    messages: summaryMessages,
    signal,
  });

  for await (const event of stream) {
    if (event.type === 'text_delta' && event.text) {
      summary += event.text;
    }
  }

  return summary;
}

// ---- Internal helpers ----

/**
 * Generate a local summary without LLM (fast, deterministic).
 * Extracts key information from messages.
 */
function generateLocalSummary(messages: Message[]): string {
  const parts: string[] = [];
  let toolCalls = 0;
  const filesModified = new Set<string>();
  const filesRead = new Set<string>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;

    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        toolCalls++;
        const path = block.input['path'] as string | undefined;
        if (block.name === 'edit_file' || block.name === 'write_file') {
          if (path) filesModified.add(path);
        } else if (block.name === 'read_file') {
          if (path) filesRead.add(path);
        }
      }
      if (block.type === 'text' && msg.role === 'assistant') {
        // Keep first 200 chars of each assistant text as context
        const snippet = block.text.slice(0, 200);
        if (snippet.trim()) parts.push(snippet);
      }
    }
  }

  const lines: string[] = ['[Conversation Summary]'];

  if (filesModified.size > 0) {
    lines.push(`Files modified: ${[...filesModified].join(', ')}`);
  }
  if (filesRead.size > 0) {
    lines.push(`Files read: ${[...filesRead].join(', ')}`);
  }
  if (toolCalls > 0) {
    lines.push(`Tool calls made: ${toolCalls}`);
  }
  if (parts.length > 0) {
    lines.push('Key points:');
    // Keep only first 5 snippets
    for (const part of parts.slice(0, 5)) {
      lines.push(`- ${part.replace(/\n/g, ' ').trim()}`);
    }
  }

  return lines.join('\n');
}

function formatContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map(block => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'tool_use':
          return `[Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})]`;
        case 'tool_result':
          return `[Result: ${block.content.slice(0, 200)}]`;
        default:
          return '';
      }
    })
    .join('\n');
}

function truncateSummaryToFit(summary: string, maxTokens: number): string {
  const tokens = countTokens(summary);
  if (tokens <= maxTokens) return summary;

  // Rough truncation: cut by character ratio
  const ratio = maxTokens / tokens;
  const maxChars = Math.floor(summary.length * ratio * 0.9); // 10% safety margin
  return summary.slice(0, maxChars) + '\n[...summary truncated due to token limit]';
}
