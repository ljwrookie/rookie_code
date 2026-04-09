import chalk from 'chalk';

export type LogLevel = 'verbose' | 'normal' | 'quiet';

let currentLevel: LogLevel = 'normal';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    if (currentLevel === 'quiet') return;
    console.error(chalk.blue('ℹ'), message, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    if (currentLevel === 'quiet') return;
    console.error(chalk.yellow('⚠'), message, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    console.error(chalk.red('✖'), message, ...args);
  },

  debug(message: string, ...args: unknown[]): void {
    if (currentLevel !== 'verbose') return;
    console.error(chalk.gray('⋯'), message, ...args);
  },

  tool(name: string, message: string): void {
    if (currentLevel === 'quiet') return;
    console.error(chalk.cyan('⚡'), chalk.bold(name), chalk.gray(message));
  },

  success(message: string, ...args: unknown[]): void {
    if (currentLevel === 'quiet') return;
    console.error(chalk.green('✔'), message, ...args);
  },
};
