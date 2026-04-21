/**
 * Git operations wrapper and checkpoint system.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../utils/process.js';


// ---- Public API ----

export interface CheckpointInfo {
  hash: string;
  message: string;
  date: string;
}

const CHECKPOINT_PREFIX = '[rookie-code checkpoint]';
const CHECKPOINT_META_VERSION = 1;
const CHECKPOINT_META_FILE = 'rookie-code-checkpoint.json';

type CheckpointMeta = {
  version: number;
  lastCheckpoint?: {
    stashHash: string;
    message: string;
    createdAt: string;
  };
};

export class GitOperations {
  constructor(private workingDir: string) {}

  /**
   * Check if the working directory is inside a git repository.
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    const result = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  /**
   * Get git status (short format).
   */
  async getStatus(): Promise<string> {
    return this.git(['status', '--short']);
  }

  /**
   * Get diff output.
   */
  async getDiff(options?: { staged?: boolean; file?: string }): Promise<string> {
    const args = ['diff'];
    if (options?.staged) args.push('--staged');
    if (options?.file) args.push('--', options.file);
    return this.git(args);
  }

  async addAll(): Promise<void> {
    await this.git(['add', '-A']);
  }

  async addPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git(['add', '--', ...paths]);
  }

  async commit(message: string): Promise<string> {
    const msg = message.trim();
    if (!msg) throw new Error('commit message cannot be empty');
    await this.git(['commit', '-m', msg, '--no-verify']);
    const hash = await this.git(['rev-parse', 'HEAD']);
    return hash.trim();
  }

  async restore(paths: string[], options?: { staged?: boolean }): Promise<void> {
    const args = ['restore'];
    if (options?.staged) args.push('--staged');
    if (paths.length > 0) args.push('--', ...paths);
    await this.git(args);
  }

  async stashPush(message: string, options?: { includeUntracked?: boolean }): Promise<void> {
    const args = ['stash', 'push', '-m', message.trim() || 'stash'];
    if (options?.includeUntracked) args.splice(2, 0, '-u');
    await this.git(args);
  }

  async stashList(limit: number = 20): Promise<string> {
    return this.git(['stash', 'list', `--max-count=${Math.min(limit, 200)}`]);
  }

  async stashApply(refOrHash: string): Promise<void> {
    const ref = refOrHash.trim();
    if (!ref) throw new Error('stash ref/hash cannot be empty');
    await this.git(['stash', 'apply', '--index', ref]);
  }

  async stashPop(ref?: string): Promise<void> {
    const args = ['stash', 'pop'];
    if (ref?.trim()) args.push(ref.trim());
    await this.git(args);
  }

  /**
   * Check if there are uncommitted changes.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.getStatus();
    return status.trim().length > 0;
  }

  /**
   * Create a checkpoint snapshot using git stash, without modifying the working tree.
   *
   * Implementation:
   * - `git stash push -u -m "<prefix> <description>"` (creates a stash and cleans tree)
   * - `git stash apply --index stash@{0}` (restores tree back)
   *
   * Returns the stash commit hash, or empty string if no changes to checkpoint.
   */
  async createCheckpoint(description: string): Promise<string> {
    const hasChanges = await this.hasUncommittedChanges();
    if (!hasChanges) {
      return ''; // Nothing to checkpoint
    }

    const message = `${CHECKPOINT_PREFIX} ${description}`.trim();

    // Create a stash snapshot (includes untracked). This will clean the working tree...
    await this.git(['stash', 'push', '-u', '-m', message]);

    // ...then immediately restore it so the agent sees the real current state.
    try {
      await this.git(['stash', 'apply', '--index', 'stash@{0}']);
    } catch (error) {
      // This is extremely unlikely right after creating the stash, but if it happens the
      // user's working tree is now clean and the checkpoint is in stash@{0}. Surface this.
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to re-apply checkpoint stash after creation: ${msg}\n` +
          `Your changes are saved in git stash (most likely stash@{0}).`,
      );
    }

    const stashHash = (await this.git(['rev-parse', 'stash@{0}'])).trim();
    await this.writeCheckpointMeta({
      version: CHECKPOINT_META_VERSION,
      lastCheckpoint: { stashHash, message, createdAt: new Date().toISOString() },
    });
    return stashHash;
  }

  /**
   * Revert to a specific checkpoint stash (by stash commit hash).
   * This is non-destructive: it first stashes current changes as a backup, then applies the checkpoint.
   */
  async revertToCheckpoint(commitHash: string): Promise<void> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) throw new Error('Not a git repository.');
    await this.assertCheckpointHash(commitHash);

    // Best-effort backup of current changes (including untracked)
    if (await this.hasUncommittedChanges()) {
      await this.git(['stash', 'push', '-u', '-m', '[rookie-code undo backup] before revert']);
    }

    // Apply checkpoint stash commit. If it conflicts, git will return non-zero.
    await this.git(['stash', 'apply', '--index', commitHash]);
  }

  /**
   * Undo the last checkpoint by restoring the saved stash snapshot.
   *
   * Behavior:
   * - Stashes current changes as a safety backup (so undo is recoverable).
   * - Applies the last checkpoint stash snapshot (by stash commit hash).
   */
  async undoLastCheckpoint(): Promise<boolean> {
    const meta = await this.readCheckpointMeta();
    const stashHash = meta?.lastCheckpoint?.stashHash?.trim();
    if (!stashHash) return false;
    await this.assertCheckpointHash(stashHash);

    // Safety backup of current state (including untracked)
    const hasChanges = await this.hasUncommittedChanges();
    if (hasChanges) {
      await this.git(['stash', 'push', '-u', '-m', '[rookie-code undo backup] before /undo']);
    }

    // Apply checkpoint snapshot
    await this.git(['stash', 'apply', '--index', stashHash]);
    return true;
  }

  /**
   * List recent checkpoint snapshots from git stash list.
   */
  async listCheckpoints(limit: number = 10): Promise<CheckpointInfo[]> {
    try {
      const list = await this.git(['stash', 'list', `--max-count=${limit * 5}`]);
      const lines = list.trim().split('\n').filter(Boolean);
      const checkpoints: CheckpointInfo[] = [];

      for (const line of lines) {
        // Format: "stash@{0}: On <branch>: <message>"
        const idx = line.indexOf(': ');
        if (idx === -1) continue;
        const ref = line.slice(0, idx).trim();
        const last = line.lastIndexOf(': ');
        const message = (last === -1 ? '' : line.slice(last + 2)).trim();
        if (!message.startsWith(CHECKPOINT_PREFIX)) continue;

        const hash = (await this.git(['rev-parse', ref])).trim();
        const date = (await this.git(['log', '-1', '--format=%ai', ref])).trim();
        checkpoints.push({
          hash,
          message,
          date,
        });
        if (checkpoints.length >= limit) break;
      }

      return checkpoints;
    } catch {
      return [];
    }
  }

  // ---- Internal ----

  /**
   * Execute a git command and return stdout.
   */
  private git(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      runProcess({
        command: 'git',
        args,
        cwd: this.workingDir,
        timeoutMs: 30_000,
        detached: false,
      }).then(({ stdout, stderr, exitCode, timedOut, aborted }) => {
        if (aborted) {
          reject(new Error('git aborted'));
          return;
        }
        if (timedOut) {
          reject(new Error(`git ${args.join(' ')} timed out`));
          return;
        }
        if (exitCode === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`git ${args.join(' ')} failed (code ${exitCode}): ${stderr}`));
      });
    });
  }

  private async resolveGitDir(): Promise<string> {
    const raw = (await this.git(['rev-parse', '--git-dir'])).trim();
    // rev-parse can return a relative path (e.g. ".git")
    const abs = path.isAbsolute(raw) ? raw : path.resolve(this.workingDir, raw);
    return abs;
  }

  private async readCheckpointMeta(): Promise<CheckpointMeta | null> {
    try {
      const gitDir = await this.resolveGitDir();
      const metaPath = path.join(gitDir, CHECKPOINT_META_FILE);
      const raw = await fs.readFile(metaPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as CheckpointMeta;
    } catch {
      return null;
    }
  }

  private async writeCheckpointMeta(meta: CheckpointMeta): Promise<void> {
    const gitDir = await this.resolveGitDir();
    const metaPath = path.join(gitDir, CHECKPOINT_META_FILE);
    await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  private async assertCheckpointHash(hash: string): Promise<void> {
    const subject = (await this.git(['log', '-1', '--format=%s', hash])).trim();
    // Stash subjects are typically like "On main: [rookie-code checkpoint] ...".
    if (!subject.includes(CHECKPOINT_PREFIX)) {
      throw new Error(`Hash ${hash} is not a rookie-code checkpoint stash.`);
    }
  }
}
