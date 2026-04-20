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
  /\b(curl|wget)\b[\s\S]*\|\s*(sh|bash)\b/i, // curl/wget | sh
  />\s*\/dev\//,     // redirect to /dev/
  /rm\s+-rf\s+\//,   // rm -rf /
];

/** Whitelisted but still high-risk commands that should generally require confirmation. */
const HIGH_RISK_COMMANDS = new Set([
  // Package managers frequently change disk state and may execute lifecycle scripts.
  'npm',
  'pnpm',
  'npx',
]);

/**
 * Allowlist of safe environment variable patterns to pass to child processes.
 *
 * This approach (allowlist) is much safer than a denylist because it only
 * passes through known-safe variables, preventing accidental leakage of
 * secrets or credentials that we haven't explicitly enumerated.
 */
const ENV_ALLOWLIST_PATTERNS: Array<RegExp | string> = [
  // Common system vars
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'TERM',
  'SHELL',
  'EDITOR',
  'VISUAL',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TZ',
  'HOSTNAME',
  'NODE_ENV',
  // Node.js / npm vars
  /^NODE_/,
  /^npm_config_/,
  /^NPM_CONFIG_/,
  // Locale
  'LC_ALL',
  'LC_CTYPE',
  'LOCALE',
  // XDG (common on Linux)
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  // Color support
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  // Less pager
  'LESS',
  'PAGER',
  // Rookie-code non-sensitive vars
  'ROOKIE_MAX_AGENT_DEPTH',
  'ROOKIE_MAX_PARALLEL_AGENTS',
  'ROOKIE_SKILLS_DIRS',
  'CUSTOM_MODELS',
];

function isAllowedEnvVar(key: string): boolean {
  for (const pattern of ENV_ALLOWLIST_PATTERNS) {
    if (typeof pattern === 'string') {
      if (key === pattern) return true;
    } else {
      if (pattern.test(key)) return true;
    }
  }
  return false;
}

/**
 * Best-effort security sandbox for shell command execution.
 *
 * ⚠️ IMPORTANT — This is NOT a security sandbox in the container/isolation sense.
 *
 * This class provides a best-effort risk reduction layer that:
 * - Restricts which commands can be executed via a whitelist
 * - Detects common dangerous shell patterns (command substitution, pipe-to-shell, etc.)
 * - Protects against path traversal attacks (including symlink-based bypasses)
 * - Filters environment variables to prevent credential leakage
 *
 * For stronger isolation and security guarantees, use container/Docker-based
 * execution environments. The current approach reduces low-level mistakes but
 * cannot prevent all shell-based risks — a determined attacker with shell
 * access can bypass these restrictions.
 */
export class CommandGuard {
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
      if (HIGH_RISK_COMMANDS.has(executable)) {
        return 'needs_confirmation';
      }
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
   * Uses an allowlist approach: only known-safe environment variables are passed through.
   * This is much safer than a denylist because it prevents leakage of any
   * secrets or credentials we haven't explicitly enumerated.
   */
  getSanitizedEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (isAllowedEnvVar(key)) {
        env[key] = value;
      }
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
