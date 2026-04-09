import type { Config } from '../types.js';
import path from 'node:path';
import fs from 'node:fs';

/** Dangerous shell patterns to detect and block */
const DANGEROUS_PATTERNS = [
  /\$\(.*\)/,        // $(command substitution)
  /`.*`/,            // `backtick substitution`
  /;\s*rm\s/,        // ; rm
  /&&\s*rm\s/,       // && rm
  /\|\s*rm\s/,       // | rm
  />\s*\/dev\//,     // redirect to /dev/
  /rm\s+-rf\s+\//,   // rm -rf /
];

/** Environment variables to strip from child processes */
const SENSITIVE_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'PRIVATE_KEY',
];

export class Sandbox {
  private allowedCommands: Set<string>;
  private blockedPaths: string[];

  constructor(config: Config['security']) {
    this.allowedCommands = new Set(config.allowedCommands);
    this.blockedPaths = config.blockedPaths;
  }

  /**
   * Check if a command is allowed, needs confirmation, or is blocked.
   */
  checkCommand(command: string): 'allowed' | 'needs_confirmation' | 'blocked' {
    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return 'blocked';
      }
    }

    // Extract the executable name
    const executable = this.extractExecutable(command);
    if (!executable) return 'needs_confirmation';

    // Check whitelist
    if (this.allowedCommands.has(executable)) {
      return 'allowed';
    }

    return 'needs_confirmation';
  }

  /**
   * Check if a file path is within the allowed working directory.
   * Resolves symlinks before checking.
   */
  checkPath(filePath: string, workingDir: string): boolean {
    try {
      // Resolve symlinks
      const resolved = fs.realpathSync(path.resolve(workingDir, filePath));
      const resolvedWorkDir = fs.realpathSync(workingDir);

      // Check against working directory
      if (!resolved.startsWith(resolvedWorkDir)) {
        return false;
      }

      // Check against blocked paths
      for (const blocked of this.blockedPaths) {
        if (resolved.startsWith(blocked)) {
          return false;
        }
      }

      return true;
    } catch {
      // If symlink resolution fails, default to path-based check
      const resolved = path.resolve(workingDir, filePath);
      return resolved.startsWith(workingDir);
    }
  }

  /**
   * Get a sanitized environment for child processes.
   * Strips sensitive variables to prevent leakage.
   */
  getSanitizedEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of SENSITIVE_ENV_VARS) {
      delete env[key];
    }
    return env;
  }

  /**
   * Extract the executable name from a command string.
   */
  private extractExecutable(command: string): string | null {
    const trimmed = command.trim();
    // Handle env prefixes like "FOO=bar command"
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)*/, '');
    // Get the first word
    const match = withoutEnvVars.match(/^(\S+)/);
    return match?.[1] ?? null;
  }
}
