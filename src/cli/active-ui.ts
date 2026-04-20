export type ActiveUIController = {
  pause(): void;
  resume(): void;
};

let activeUI: ActiveUIController | null = null;

export function registerActiveUI(ui: ActiveUIController | null): void {
  activeUI = ui;
}

export async function withUiPaused<T>(fn: () => Promise<T>): Promise<T> {
  if (!activeUI) return fn();
  activeUI.pause();
  try {
    return await fn();
  } finally {
    activeUI.resume();
  }
}

