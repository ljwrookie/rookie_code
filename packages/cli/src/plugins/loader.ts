import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HookManager } from '../hooks/manager.js';
import { logger } from '../utils/logger.js';

export type PluginContext = {
  cwd: string;
  hooks: HookManager;
  logger: typeof logger;
};

type PluginRegisterFn = (ctx: PluginContext) => void | Promise<void>;

function asRegisterFn(mod: any): PluginRegisterFn | null {
  if (!mod) return null;
  if (typeof mod === 'function') return mod as PluginRegisterFn;
  if (typeof mod.default === 'function') return mod.default as PluginRegisterFn;
  if (typeof mod.register === 'function') return mod.register as PluginRegisterFn;
  if (typeof mod.plugin === 'function') return mod.plugin as PluginRegisterFn;
  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listPluginFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Load hook plugins from:
 * - `<cwd>/rookie.plugins.mjs` (single entry file)
 * - `<cwd>/.rookie-code/plugins/*.(mjs|js)` (directory of plugins)
 *
 * This is a best-effort loader: plugin errors are isolated and won't crash the agent.
 */
export async function loadHookPlugins(params: {
  cwd: string;
  hooks: HookManager;
}): Promise<{ loaded: number }> {
  const ctx: PluginContext = { cwd: params.cwd, hooks: params.hooks, logger };

  const entryFile = path.join(params.cwd, 'rookie.plugins.mjs');
  const pluginsDir = path.join(params.cwd, '.rookie-code', 'plugins');

  const files: string[] = [];
  if (await fileExists(entryFile)) files.push(entryFile);
  files.push(...(await listPluginFiles(pluginsDir)));

  let loaded = 0;
  for (const filePath of files) {
    try {
      const url = pathToFileURL(filePath).href;
      // Add a cache-buster so edits during dev are picked up if process restarts quickly.
      const mod = await import(url + `?t=${Date.now()}`);
      const register = asRegisterFn(mod);
      if (!register) {
        logger.warn(`Plugin "${filePath}" has no export (default/register/plugin) function. Skipped.`);
        continue;
      }
      await register(ctx);
      loaded += 1;
      logger.debug(`Loaded plugin: ${filePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to load plugin "${filePath}": ${msg}`);
    }
  }

  if (loaded > 0) {
    logger.success(`Loaded ${loaded} hook plugin(s).`);
  }
  return { loaded };
}

