export type ActiveUIController = {
  pause(): void;
  resume(): void;
  suspendForPrompt?(): void;
  resumeFromPrompt?(): void;
};

let activeUI: ActiveUIController | null = null;

export function registerActiveUI(ui: ActiveUIController | null): void {
  activeUI = ui;
}

export async function withUiPaused<T>(fn: () => Promise<T>): Promise<T> {
  if (!activeUI) return fn();
  const suspend = activeUI.suspendForPrompt?.bind(activeUI) ?? activeUI.pause.bind(activeUI);
  const resume = activeUI.resumeFromPrompt?.bind(activeUI) ?? activeUI.resume.bind(activeUI);
  suspend();
  try {
    return await fn();
  } finally {
    resume();
    // Some prompt libs pause stdin; ensure it is flowing so the process doesn't exit.
    if (process.stdin.isTTY) process.stdin.resume();
  }
}
