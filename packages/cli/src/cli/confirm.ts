import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { withUiPaused } from './active-ui.js';

/**
 * Ask user for confirmation before executing a potentially dangerous action.
 * Returns true if the user approves (y/Y), false otherwise.
 * Default is N (deny) for safety.
 */
export async function confirm(message: string): Promise<boolean> {
  return withUiPaused(async () => {
    const rl = readline.createInterface({ input, output, terminal: true });
    try {
      const answer = await rl.question(
        chalk.yellow('⚠ ') + message + chalk.gray(' [y/N] '),
      );
      return answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  });
}
