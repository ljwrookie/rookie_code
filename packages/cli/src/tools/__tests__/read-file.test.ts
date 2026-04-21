import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool } from '../read-file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('ReadFileTool', () => {
  let tmpDir: string;
  let tool: ReadFileTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-test-'));
    tool = new ReadFileTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should read a file with line numbers', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'line1\nline2\nline3');
    const result = await tool.execute({ path: 'test.txt' });

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('1 | line1');
    expect(result.content).toContain('2 | line2');
    expect(result.content).toContain('3 | line3');
  });

  it('should support offset and limit', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await fs.writeFile(path.join(tmpDir, 'big.txt'), lines.join('\n'));

    const result = await tool.execute({ path: 'big.txt', offset: 50, limit: 10 });
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('50 | line 50');
    expect(result.content).toContain('59 | line 59');
    expect(result.content).toContain('Showing lines');
  });

  it('should detect binary files', async () => {
    const buf = Buffer.alloc(100);
    buf[50] = 0; // null byte
    await fs.writeFile(path.join(tmpDir, 'binary.dat'), buf);

    const result = await tool.execute({ path: 'binary.dat' });
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('binary file');
  });

  it('should reject path traversal', async () => {
    const result = await tool.execute({ path: '../../etc/passwd' });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('outside the working directory');
  });

  it('should handle non-existent files', async () => {
    const result = await tool.execute({ path: 'nonexistent.txt' });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Error reading file');
  });
});
