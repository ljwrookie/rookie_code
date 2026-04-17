import path from 'node:path';

export type ChangeRisk = {
  needsConfirmation: boolean;
  reasons: string[];
};

const RISKY_BASENAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  '.mcp.json',
  '.env',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
]);

const RISKY_DIR_PREFIXES = [
  '.git' + path.sep,
  '.github' + path.sep,
  '.rookie-code' + path.sep,
  'scripts' + path.sep,
];

export function assessTextChangeRisk(params: {
  filePath: string;
  oldContent: string;
  newContent: string;
  maxAutoEditLines: number;
}): ChangeRisk {
  const reasons: string[] = [];

  const rel = normalizeRelPath(params.filePath);
  const base = path.basename(rel);

  if (RISKY_BASENAMES.has(base)) {
    reasons.push(`high-impact file: ${base}`);
  }
  for (const prefix of RISKY_DIR_PREFIXES) {
    if (rel.startsWith(prefix)) {
      reasons.push(`high-impact directory: ${prefix.replace(path.sep, '')}`);
      break;
    }
  }

  const lineDelta = estimateTouchedLines(params.oldContent, params.newContent);
  if (lineDelta >= params.maxAutoEditLines) {
    reasons.push(`large change: ~${lineDelta} lines`);
  }

  // If it looks like it adds executable shell scripts, treat as risky.
  if (base.endsWith('.sh') || base.endsWith('.bash')) {
    reasons.push('script file');
  }

  return {
    needsConfirmation: reasons.length > 0,
    reasons,
  };
}

function normalizeRelPath(p: string): string {
  // Tool inputs are generally relative; keep it stable for prefix checks.
  // Also normalize Windows separators defensively.
  return p.replaceAll('\\', '/');
}

function estimateTouchedLines(oldText: string, newText: string): number {
  if (oldText === newText) return 0;
  // Fast heuristic: count changed lines by comparing line arrays.
  // (We avoid a full diff for performance; tool already generates a unified diff separately.)
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  let touched = 0;
  for (let i = 0; i < max; i++) {
    if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) touched += 1;
  }
  return touched;
}

