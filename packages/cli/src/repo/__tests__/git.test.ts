import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitOperations } from '../git.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

let tmpDir: string;
let git: GitOperations;

function run(cmd: string) {
  execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-git-test-'));
  git = new GitOperations(tmpDir);

  // Init a git repo with an initial commit
  run('git init');
  run('git config user.email "test@test.com"');
  run('git config user.name "Test"');
  await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test\n');
  run('git add -A');
  run('git commit -m "initial commit"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitOperations', () => {
  it('isGitRepo should return true in a git repo', async () => {
    expect(await git.isGitRepo()).toBe(true);
  });

  it('isGitRepo should return false outside a git repo', async () => {
    const noGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-git-'));
    const noGit = new GitOperations(noGitDir);
    expect(await noGit.isGitRepo()).toBe(false);
    await fs.rm(noGitDir, { recursive: true, force: true });
  });

  it('getCurrentBranch should return current branch', async () => {
    const branch = await git.getCurrentBranch();
    // Could be main or master depending on git config
    expect(['main', 'master']).toContain(branch);
  });

  it('getStatus should show modified files', async () => {
    await fs.writeFile(path.join(tmpDir, 'new.txt'), 'hello\n');
    const status = await git.getStatus();
    expect(status).toContain('new.txt');
  });

  it('hasUncommittedChanges should detect changes', async () => {
    expect(await git.hasUncommittedChanges()).toBe(false);
    await fs.writeFile(path.join(tmpDir, 'change.txt'), 'data\n');
    expect(await git.hasUncommittedChanges()).toBe(true);
  });

  it('createCheckpoint should create a checkpoint commit', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content\n');
    const hash = await git.createCheckpoint('before edit: file.txt');
    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThanOrEqual(7);

    // Verify stash message
    const list = execSync('git stash list -1', { cwd: tmpDir }).toString().trim();
    expect(list).toContain('[rookie-code checkpoint]');
    expect(list).toContain('before edit: file.txt');
  });

  it('createCheckpoint should return empty string when no changes', async () => {
    const hash = await git.createCheckpoint('nothing');
    expect(hash).toBe('');
  });

  it('listCheckpoints should list checkpoint commits', async () => {
    // Create two checkpoints
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'a\n');
    await git.createCheckpoint('edit a');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'b\n');
    await git.createCheckpoint('edit b');

    const checkpoints = await git.listCheckpoints(10);
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0]!.message).toContain('edit b');
    expect(checkpoints[1]!.message).toContain('edit a');
  });

  it('undoLastCheckpoint should revert the latest checkpoint', async () => {
    // Create a checkpoint of the current working tree (before agent run)
    await fs.writeFile(path.join(tmpDir, 'before.txt'), 'before\n');
    await git.createCheckpoint('before agent run');

    // Simulate agent creating a new file after the checkpoint
    await fs.writeFile(path.join(tmpDir, 'after.txt'), 'after\n');

    // Undo
    const undone = await git.undoLastCheckpoint();
    expect(undone).toBe(true);

    // after.txt should be gone
    expect(await fileExists(path.join(tmpDir, 'after.txt'))).toBe(false);
    // before.txt should still exist
    expect(await fileExists(path.join(tmpDir, 'before.txt'))).toBe(true);
  });

  it('revertToCheckpoint should reject non-checkpoint commits', async () => {
    const hash = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();
    await expect(git.revertToCheckpoint(hash)).rejects.toThrow('not a rookie-code checkpoint');
  });

  it('getDiff should return diff for staged changes', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Updated\n');
    run('git add -A');
    const diff = await git.getDiff({ staged: true });
    expect(diff).toContain('Updated');
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
