import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';

export type RunProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
};

function killProcessTree(pid: number): void {
  // Best-effort: kill the process group first (works when spawned with detached: true).
  try {
    process.kill(-pid, 'SIGKILL');
    return;
  } catch {
    // fall back
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore
  }
}

/**
 * Run a process and collect stdout/stderr with timeout + AbortSignal support.
 *
 * Notes:
 * - We avoid using spawn(..., { timeout }) since it is not consistently supported.
 * - If `detached` is true, we'll attempt to kill the whole process group on timeout/abort.
 */
export function runProcess(params: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  detached?: boolean;
}): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const {
      command,
      args,
      cwd,
      env,
      timeoutMs,
      signal,
      detached = false,
    } = params;

    const options: SpawnOptionsWithoutStdio = {
      cwd,
      env,
      shell: false,
      detached,
    };

    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const stop = (): void => {
      if (!child.pid) return;
      if (detached) {
        killProcessTree(child.pid);
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('close', (code, sig) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: sig,
        timedOut,
        aborted,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += (stderr ? '\n' : '') + err.message;
      resolve({
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        timedOut,
        aborted,
      });
    });
  });
}

