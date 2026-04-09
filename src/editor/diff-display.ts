/**
 * Diff display utilities.
 * Generates colored unified diff output for terminal display.
 */

import { createTwoFilesPatch } from 'diff';
import chalk from 'chalk';

export interface DiffDisplayOptions {
  filePath: string;
  contextLines?: number;  // default 3
}

/**
 * Generate a colored unified diff string for terminal display.
 */
export function formatDiff(
  oldContent: string,
  newContent: string,
  options: DiffDisplayOptions,
): string {
  const { filePath, contextLines = 3 } = options;

  const patch = createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: contextLines },
  );

  return colorizePatch(patch);
}

/**
 * Generate a compact diff showing only the changed region.
 * Useful for inline display in tool results.
 */
export function formatCompactDiff(
  oldText: string,
  newText: string,
  filePath: string,
): string {
  if (oldText === newText) return chalk.gray('(no changes)');

  const lines: string[] = [];
  lines.push(chalk.bold(`--- ${filePath}`));

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  for (const line of oldLines) {
    lines.push(chalk.red(`- ${line}`));
  }
  for (const line of newLines) {
    lines.push(chalk.green(`+ ${line}`));
  }

  return lines.join('\n');
}

/**
 * Colorize a unified diff patch string.
 */
function colorizePatch(patch: string): string {
  return patch
    .split('\n')
    .map(line => {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return chalk.bold(line);
      }
      if (line.startsWith('+')) {
        return chalk.green(line);
      }
      if (line.startsWith('-')) {
        return chalk.red(line);
      }
      if (line.startsWith('@@')) {
        return chalk.cyan(line);
      }
      return chalk.gray(line);
    })
    .join('\n');
}
