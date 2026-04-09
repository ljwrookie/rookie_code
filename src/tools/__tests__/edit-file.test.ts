import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditFileTool } from '../edit-file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('EditFileTool', () => {
  let tmpDir: string;
  let tool: EditFileTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-test-'));
    tool = new EditFileTool(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should replace exact match successfully', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.ts'), 'const x = 1;\nconst y = 2;\n');

    const result = await tool.execute({
      path: 'test.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 42;',
    });

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('File edited');

    const content = await fs.readFile(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('const x = 42;\nconst y = 2;\n');
  });

  it('should return error when old_string not found', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.ts'), 'const x = 1;');

    const result = await tool.execute({
      path: 'test.ts',
      old_string: 'nonexistent text',
      new_string: 'replacement',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('should return error when old_string matches multiple times', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'test.ts'),
      'const x = 1;\nconst y = 1;\nconst z = 1;\n',
    );

    const result = await tool.execute({
      path: 'test.ts',
      old_string: '= 1;',
      new_string: '= 2;',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('3 times');
  });

  it('should create new file when old_string is empty and file does not exist', async () => {
    const result = await tool.execute({
      path: 'new-file.ts',
      old_string: '',
      new_string: 'export const hello = "world";',
    });

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Created new file');

    const content = await fs.readFile(path.join(tmpDir, 'new-file.ts'), 'utf-8');
    expect(content).toBe('export const hello = "world";');
  });

  it('should error when creating file that already exists with empty old_string', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.ts'), 'content');

    const result = await tool.execute({
      path: 'existing.ts',
      old_string: '',
      new_string: 'new content',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('already exists');
  });

  it('should reject path traversal', async () => {
    const result = await tool.execute({
      path: '../../etc/passwd',
      old_string: 'root',
      new_string: 'hacked',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('outside the working directory');
  });

  it('should create parent directories for new file', async () => {
    const result = await tool.execute({
      path: 'deep/nested/dir/file.ts',
      old_string: '',
      new_string: 'content',
    });

    expect(result.is_error).toBe(false);
    const content = await fs.readFile(
      path.join(tmpDir, 'deep/nested/dir/file.ts'),
      'utf-8',
    );
    expect(content).toBe('content');
  });
});
