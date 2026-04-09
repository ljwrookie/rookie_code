import { encodingForModel } from 'js-tiktoken';
import type { Message, ContentBlock } from '../types.js';

// Use cl100k_base encoding (works for Claude and GPT-4 class models)
const encoder = encodingForModel('gpt-4');

/**
 * Count exact tokens for a string using tiktoken.
 */
export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Alias for countTokens — kept for backward compatibility with plan.
 */
export function estimateTokens(text: string): number {
  return countTokens(text);
}

/**
 * Extract text content from a Message for token counting.
 */
function messageToText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .map((block: ContentBlock) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'tool_use':
          return `${block.name}(${JSON.stringify(block.input)})`;
        case 'tool_result':
          return block.content;
      }
    })
    .join('\n');
}

/**
 * Count total tokens across a list of messages.
 */
export function countMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // Role overhead: ~4 tokens per message
    total += 4;
    total += countTokens(messageToText(msg));
  }
  return total;
}

/**
 * Check if messages fit within a token budget.
 */
export function isWithinBudget(
  messages: Message[],
  budget: number,
): boolean {
  return countMessagesTokens(messages) <= budget;
}
