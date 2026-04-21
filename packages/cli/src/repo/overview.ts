import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../utils/process.js';
import { truncateByLines } from '../utils/truncate.js';

const DEFAULT_TIMEOUT_MS = 5_000;

async function tryGitFileList(root: string, maxFiles: number): Promise<string[] | null> {
  const result = await runProcess({
    command: 'git',
    args: ['ls-files', '--cached', '--others', '--exclude-standard'],
    cwd: root,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    detached: false,
  });
  if (result.exitCode !== 0) return null;
  const files = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxFiles);
  return files;
}

async function fsFileList(root: string, maxFiles: number): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const ent of entries) {
    if (files.length >= maxFiles) break;
    if (!ent.isFile()) continue;
    const rel = ent.parentPath
      ? path.relative(root, path.join(ent.parentPath, ent.name))
      : ent.name;
    files.push(rel);
  }
  return files;
}

export async function buildRepoOverview(params: {
  rootDir: string;
  maxFiles: number;
}): Promise<string> {
  const maxFiles = Math.max(20, Math.min(params.maxFiles, 500));
  const root = params.rootDir;

  const files = (await tryGitFileList(root, maxFiles)) ?? (await fsFileList(root, maxFiles));
  const shown = files.slice(0, maxFiles);

  const header = [
    '## Repo Overview (auto)',
    `- Files: showing ${shown.length}${files.length > shown.length ? ` of ${files.length}` : ''}`,
  ];

  const body = shown.map((f) => `- ${f}`).join('\n');
  return truncateByLines([...header, '', body].join('\n'), 180);
}

