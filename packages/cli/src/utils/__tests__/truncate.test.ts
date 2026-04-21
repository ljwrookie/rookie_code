import { describe, it, expect } from 'vitest';
import { truncateByLines, truncateByBytes, addLineNumbers } from '../truncate.js';

describe('truncate', () => {
  describe('truncateByLines', () => {
    it('should not truncate when within limit', () => {
      const text = 'line1\nline2\nline3';
      expect(truncateByLines(text, 5)).toBe(text);
    });

    it('should truncate when exceeding limit', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');
      const result = truncateByLines(text, 20);
      expect(result).toContain('line 1');
      expect(result).toContain('omitted');
      expect(result).toContain('line 100');
    });
  });

  describe('truncateByBytes', () => {
    it('should not truncate when within limit', () => {
      const text = 'short text';
      expect(truncateByBytes(text, 1000)).toBe(text);
    });

    it('should truncate when exceeding limit', () => {
      const text = 'x'.repeat(200 * 1024); // 200KB
      const result = truncateByBytes(text, 100 * 1024);
      expect(result).toContain('truncated');
      expect(Buffer.byteLength(result, 'utf-8')).toBeLessThan(200 * 1024);
    });
  });

  describe('addLineNumbers', () => {
    it('should add line numbers', () => {
      const text = 'foo\nbar\nbaz';
      const result = addLineNumbers(text);
      expect(result).toBe('1 | foo\n2 | bar\n3 | baz');
    });

    it('should pad line numbers for alignment', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line${i}`);
      const result = addLineNumbers(lines.join('\n'));
      expect(result).toContain(' 1 | line0');
      expect(result).toContain('12 | line11');
    });

    it('should support custom start line', () => {
      const result = addLineNumbers('a\nb', 10);
      expect(result).toBe('10 | a\n11 | b');
    });
  });
});
