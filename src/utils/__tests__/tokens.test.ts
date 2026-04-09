import { describe, it, expect } from 'vitest';
import { countTokens, estimateTokens, countMessagesTokens, isWithinBudget } from '../tokens.js';
import type { Message } from '../../types.js';

describe('tokens', () => {
  describe('countTokens', () => {
    it('should return exact token count for simple English text', () => {
      const tokens = countTokens('hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(2); // "hello" and " world"
    });

    it('should handle empty string', () => {
      expect(countTokens('')).toBe(0);
    });

    it('should handle code content', () => {
      const code = 'function foo() { return 42; }';
      const tokens = countTokens(code);
      // Code tokens are typically more than word count
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(20);
    });

    it('should handle Chinese text', () => {
      const text = '你好世界';
      const tokens = countTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('should be an alias for countTokens', () => {
      const text = 'The quick brown fox jumps over the lazy dog.';
      expect(estimateTokens(text)).toBe(countTokens(text));
    });
  });

  describe('countMessagesTokens', () => {
    it('should count tokens across messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const tokens = countMessagesTokens(messages);
      // Each message has ~4 overhead + content tokens
      expect(tokens).toBeGreaterThan(8);
    });

    it('should handle content blocks', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', id: '1', name: 'read_file', input: { path: 'test.ts' } },
          ],
        },
      ];
      const tokens = countMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(10);
    });
  });

  describe('isWithinBudget', () => {
    it('should return true when within budget', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      expect(isWithinBudget(messages, 1000)).toBe(true);
    });

    it('should return false when over budget', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      expect(isWithinBudget(messages, 1)).toBe(false);
    });
  });
});
