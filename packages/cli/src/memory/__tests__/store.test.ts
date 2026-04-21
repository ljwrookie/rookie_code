import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MemoryStore,
  resolveDefaultMemoryBaseDir,
  resolveMemoryFilePath,
  resolveProjectScope,
} from '../store.js';

let tempRoot: string;
let repoDir: string;
let repoSubDir: string;
let noGitDir: string;
let userHomeDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-memory-test-'));
  repoDir = path.join(tempRoot, 'repo');
  repoSubDir = path.join(repoDir, 'packages', 'agent');
  noGitDir = path.join(tempRoot, 'scratch');
  userHomeDir = path.join(tempRoot, 'user-home');

  await fs.mkdir(repoSubDir, { recursive: true });
  await fs.mkdir(noGitDir, { recursive: true });
  await fs.mkdir(userHomeDir, { recursive: true });

  run('git init', repoDir);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('memory scope resolution', () => {
  it('uses the same project key for different directories inside one git repo', async () => {
    const rootScope = await resolveProjectScope(repoDir);
    const nestedScope = await resolveProjectScope(repoSubDir);
    const realRepoDir = await fs.realpath(repoDir);

    expect(rootScope.resolver).toBe('git');
    expect(nestedScope.resolver).toBe('git');
    expect(rootScope.scope.projectKey).toBe(nestedScope.scope.projectKey);
    expect(rootScope.scopePath).toBe(realRepoDir);
  });

  it('falls back to a stable hashed realpath outside git repos', async () => {
    const first = await resolveProjectScope(noGitDir);
    const second = await resolveProjectScope(path.join(noGitDir, '.'));

    expect(first.resolver).toBe('path');
    expect(second.resolver).toBe('path');
    expect(first.scope.projectKey).toBe(second.scope.projectKey);
    expect(first.scope.projectKey.startsWith('path-')).toBe(true);
  });

  it('resolves store files into the user dir instead of the current working tree', async () => {
    const globalPath = await resolveMemoryFilePath(repoDir, 'global', userHomeDir);
    const projectPath = await resolveMemoryFilePath(repoSubDir, 'project', userHomeDir);

    expect(globalPath.startsWith(userHomeDir)).toBe(true);
    expect(projectPath.startsWith(userHomeDir)).toBe(true);
    expect(globalPath.startsWith(repoDir)).toBe(false);
    expect(projectPath.startsWith(repoDir)).toBe(false);
  });

  it('uses the OS home directory for the default base dir', () => {
    expect(resolveDefaultMemoryBaseDir()).toBe(path.join(os.homedir(), '.rookie-code', 'memory'));
  });
});

describe('MemoryStore', () => {
  it('persists global and project records with set and upsert semantics', async () => {
    const store = new MemoryStore({ cwd: repoSubDir, baseDir: userHomeDir });
    const globalRecord = await store.set({
      scope: 'global',
      source: 'manual',
      kind: 'preference',
      key: 'tone',
      value: 'concise',
      content: 'Prefer concise answers.',
      priority: 10,
      evidenceCount: 1,
    });
    const updatedProjectRecord = await store.upsert({
      scope: 'project',
      source: 'auto',
      kind: 'fact',
      key: 'repo-root',
      value: 'available',
      content: 'Detected from git root.',
      priority: 5,
      evidenceCount: 2,
    });
    const overwrittenProjectRecord = await store.upsert({
      scope: 'project',
      source: 'manual',
      kind: 'fact',
      key: 'repo-root',
      value: 'confirmed',
      content: 'Confirmed manually.',
      priority: 8,
      evidenceCount: 3,
    });

    expect(globalRecord.scope.level).toBe('global');
    expect(updatedProjectRecord.scope.level).toBe('project');
    expect(overwrittenProjectRecord.id).toBe(updatedProjectRecord.id);
    expect(overwrittenProjectRecord.createdAt).toBe(updatedProjectRecord.createdAt);
    expect(overwrittenProjectRecord.updatedAt >= updatedProjectRecord.updatedAt).toBe(true);

    const globalRecords = await store.list('global');
    const projectRecords = await store.list('project');
    expect(globalRecords).toHaveLength(1);
    expect(projectRecords).toHaveLength(1);
    expect(projectRecords[0]?.value).toBe('confirmed');
    expect(projectRecords[0]?.priority).toBe(8);

    const projectFile = await store.resolveFilePath('project');
    const persisted = JSON.parse(await fs.readFile(projectFile, 'utf8')) as { records: Array<{ key: string; value: string }> };
    expect(persisted.records[0]?.key).toBe('repo-root');
    expect(persisted.records[0]?.value).toBe('confirmed');
  });

  it('supports disable, ignore, and delete transitions', async () => {
    const store = new MemoryStore({ cwd: repoDir, baseDir: userHomeDir });
    const active = await store.set({
      scope: 'project',
      source: 'manual',
      kind: 'instruction',
      key: 'guardrail',
      value: 'minimal-diff',
      priority: 3,
      evidenceCount: 0,
    });

    const disabled = await store.disable('project', { id: active.id });
    const ignored = await store.ignore('project', { id: active.id }, { ignoreUntilTurn: 12 });
    const deleted = await store.delete('project', { id: active.id });

    expect(disabled?.status).toBe('disabled');
    expect(disabled?.ignoreUntilTurn).toBeNull();
    expect(ignored?.status).toBe('ignored');
    expect(ignored?.ignoreUntilTurn).toBe(12);
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.ignoreUntilTurn).toBeNull();

    const deletedOnly = await store.list('project', { status: 'deleted' });
    expect(deletedOnly).toHaveLength(1);
    expect(deletedOnly[0]?.id).toBe(active.id);
  });

  it('recovers from a corrupted store file by backing it up and returning an empty store', async () => {
    const store = new MemoryStore({ cwd: repoDir, baseDir: userHomeDir });
    const projectFile = await store.resolveFilePath('project');

    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(projectFile, '{ not-valid-json', 'utf8');

    const records = await store.list('project');
    expect(records).toEqual([]);

    const siblingFiles = await fs.readdir(path.dirname(projectFile));
    expect(siblingFiles.some((name) => name.includes('.corrupt-'))).toBe(true);

    const recovered = JSON.parse(await fs.readFile(projectFile, 'utf8')) as { records: unknown[] };
    expect(recovered.records).toEqual([]);
  });
});

function run(command: string, cwd: string): void {
  execSync(command, {
    cwd,
    stdio: 'pipe',
  });
}
