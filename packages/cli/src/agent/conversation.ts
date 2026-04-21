/**
 * Conversation history manager.
 *
 * Tracks all messages and provides access to the current history.
 * Works with ContextManager for token budget enforcement.
 */

import type { Message } from '../types.js';
import { countMessagesTokens } from '../utils/tokens.js';

export class ConversationManager {
  private messages: Message[] = [];
  private summaryPrefix: string = '';

  /**
   * Add a message to the conversation history.
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * Add multiple messages to the conversation history.
   */
  addMessages(messages: Message[]): void {
    this.messages.push(...messages);
  }

  /**
   * Get all messages (including any summary prefix as the first user message).
   */
  getMessages(): Message[] {
    if (this.summaryPrefix) {
      return [
        {
          role: 'user',
          content: `[Previous conversation summary]\n${this.summaryPrefix}`,
        },
        {
          role: 'assistant',
          content: 'I understand the context from our previous conversation. How can I help you continue?',
        },
        ...this.messages,
      ];
    }
    return [...this.messages];
  }

  /**
   * Get the raw messages without summary prefix.
   */
  getRawMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Replace the current history with a compacted version.
   * Moves old messages into a summary, keeping only recent ones.
   */
  compact(summary: string, recentMessages: Message[]): void {
    this.summaryPrefix = summary;
    this.messages = recentMessages;
  }

  /**
   * Set the summary prefix directly.
   */
  setSummary(summary: string): void {
    this.summaryPrefix = summary;
  }

  /**
   * Get the current summary prefix.
   */
  getSummary(): string {
    return this.summaryPrefix;
  }

  /**
   * Estimate the total token count for the current conversation.
   */
  estimateTokens(): number {
    return countMessagesTokens(this.getMessages());
  }

  /**
   * Get the number of messages (excluding summary).
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Clear all history and summary.
   */
  clear(): void {
    this.messages = [];
    this.summaryPrefix = '';
  }
}
