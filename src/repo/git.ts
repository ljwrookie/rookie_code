/**
 * Git operations wrapper and checkpoint system.
 *
 * Provides:
 * - Git repo detection
 * - Branch and status queries
 * - Checkpoint creation (auto-commit before edits)
 * - Checkpoint rollback (undo support)
 */

import { spawn } from 'node:child_process';

// ---- Public API ----

export interface CheckpointInfo {
  hash: string;
  message: string;
  date: string;
}

const CHECKPOINT_PREFIX = '[rookie-code checkpoint]';

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

  /**
   * Check if there are uncommitted changes.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.getStatus();
    return status.trim().length > 0;
  }

  /**
   * Create a checkpoint commit.
   * Stages all changes and creates a commit with the checkpoint prefix.
   * Returns the commit hash.
   */
  async createCheckpoint(description: string): Promise<string> {
    const hasChanges = await this.hasUncommittedChanges();
    if (!hasChanges) {
      return ''; // Nothing to checkpoint
    }

    // Stage all changes
    await this.git(['add', '-A']);

    // Create checkpoint commit
    const message = `${CHECKPOINT_PREFIX} ${description}`;
    await this.git(['commit', '-m', message, '--no-verify']);

    // Return the commit hash
    const hash = await this.git(['rev-parse', 'HEAD']);
    return hash.trim();
  }

  /**
   * Revert to a specific checkpoint commit.
   * Uses `git reset --hard` to the given commit hash.
   */
  async revertToCheckpoint(commitHash: string): Promise<void> {
    // Verify the commit is a checkpoint
    const message = await this.git(['log', '-1', '--format=%s', commitHash]);
    if (!message.trim().startsWith(CHECKPOINT_PREFIX)) {
      throw new Error(`Commit ${commitHash} is not a rookie-code checkpoint.`);
    }
    await this.git(['reset', '--hard', commitHash]);
  }

  /**
   * Undo the last checkpoint (revert to one commit before the latest checkpoint).
   * Returns true if successful, false if no checkpoint found.
   */
  async undoLastCheckpoint(): Promise<boolean> {
    const checkpoints = await this.listCheckpoints(1);
    if (checkpoints.length === 0) return false;

    // Reset to the commit before the checkpoint
    await this.git(['reset', '--hard', 'HEAD~1']);
    return true;
  }

  /**
   * List recent checkpoint commits.
   */
  async listCheckpoints(limit: number = 10): Promise<CheckpointInfo[]> {
    try {
      const log = await this.git([
        'log',
        `--max-count=${limit * 3}`, // fetch extra to filter
        '--format=%H|%s|%ai',
      ]);

      const lines = log.trim().split('\n').filter(Boolean);
      const checkpoints: CheckpointInfo[] = [];

      for (const line of lines) {
        const [hash, message, date] = line.split('|');
        if (message?.startsWith(CHECKPOINT_PREFIX)) {
          checkpoints.push({
            hash: hash!,
            message: message!,
            date: date!,
          });
          if (checkpoints.length >= limit) break;
        }
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
      const proc = spawn('git', args, {
        cwd: this.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`git ${args.join(' ')} failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`git ${args.join(' ')} error: ${err.message}`));
      });
    });
  }
}
