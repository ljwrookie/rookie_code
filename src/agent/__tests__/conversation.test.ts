import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../conversation.js';
import { trimToFit } from '../context.js';
import type { Message } from '../../types.js';

describe('ConversationManager', () => {
  it('should add and retrieve messages', () => {
    const cm = new ConversationManager();
    cm.addMessage({ role: 'user', content: 'hello' });
    cm.addMessage({ role: 'assistant', content: 'hi' });

    const msgs = cm.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toBe('hello');
    expect(msgs[1]!.content).toBe('hi');
  });

  it('should include summary prefix when set', () => {
    const cm = new ConversationManager();
    cm.setSummary('We discussed file editing.');
    cm.addMessage({ role: 'user', content: 'continue please' });

    const msgs = cm.getMessages();
    // Summary adds 2 messages (summary user + ack assistant) + 1 real
    expect(msgs).toHaveLength(3);
    expect(msgs[0]!.content).toContain('Previous conversation summary');
    expect(msgs[0]!.content).toContain('file editing');
  });

  it('should compact by replacing old messages with summary', () => {
    const cm = new ConversationManager();
    cm.addMessage({ role: 'user', content: 'msg1' });
    cm.addMessage({ role: 'assistant', content: 'resp1' });
    cm.addMessage({ role: 'user', content: 'msg2' });
    cm.addMessage({ role: 'assistant', content: 'resp2' });

    cm.compact('Summary of msg1/resp1', [
      { role: 'user', content: 'msg2' },
      { role: 'assistant', content: 'resp2' },
    ]);

    expect(cm.length).toBe(2);
    expect(cm.getSummary()).toContain('Summary of msg1');

    const msgs = cm.getMessages();
    // 2 summary + 2 real = 4
    expect(msgs).toHaveLength(4);
  });

  it('should clear all history', () => {
    const cm = new ConversationManager();
    cm.setSummary('old summary');
    cm.addMessage({ role: 'user', content: 'msg' });
    cm.clear();

    expect(cm.length).toBe(0);
    expect(cm.getSummary()).toBe('');
    expect(cm.getMessages()).toHaveLength(0);
  });

  it('should estimate tokens', () => {
    const cm = new ConversationManager();
    cm.addMessage({ role: 'user', content: 'hello world this is a test message' });
    const tokens = cm.estimateTokens();
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50);
  });
});

describe('trimToFit', () => {
  function makeMessages(count: number): Message[] {
    const msgs: Message[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: 'user', content: `User message ${i}: ${'x'.repeat(100)}` });
      msgs.push({ role: 'assistant', content: `Assistant response ${i}: ${'y'.repeat(100)}` });
    }
    return msgs;
  }

  it('should return all messages if within budget', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = trimToFit(msgs, 100000);

    expect(result.messages).toHaveLength(2);
    expect(result.trimmedCount).toBe(0);
    expect(result.summary).toBeUndefined();
  });

  it('should trim old messages when over budget', () => {
    const msgs = makeMessages(20); // 40 messages total
    const result = trimToFit(msgs, 500, 3); // Very tight budget, keep 3 rounds

    expect(result.messages.length).toBeLessThan(40);
    expect(result.trimmedCount).toBeGreaterThan(0);
  });

  it('should preserve recent messages', () => {
    const msgs = makeMessages(10);
    const result = trimToFit(msgs, 500, 2);

    // The last 4 messages (2 rounds) should be preserved
    const lastUserMsg = result.messages.at(-2);
    expect(lastUserMsg?.content).toContain('User message 9');
  });

  it('should generate summary for trimmed messages', () => {
    const msgs = makeMessages(20);
    const result = trimToFit(msgs, 500, 2);

    if (result.trimmedCount > 0) {
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('Summary');
    }
  });
});
