import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export type SkillType = string;

export interface Skill {
  name: string;
  description?: string;
  type?: SkillType;
  /** Markdown body (frontmatter removed). */
  content: string;
  /** Absolute path to the SKILL.md */
  sourcePath: string;
}

export interface SkillManagerOptions {
  /** Directories to scan for skills (each skill is typically in <dir>/<name>/SKILL.md). */
  directories: string[];
  /** Maximum directory recursion depth while scanning. */
  maxDepth?: number;
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---\n') && !trimmed.startsWith('---\r\n')) {
    return { meta: {}, body: trimmed };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines[0] !== '---') return { meta: {}, body: trimmed };

  const meta: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') {
      i += 1;
      break;
    }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] ?? '';
    const raw = (m[2] ?? '').trim();
    const value = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (key) meta[key] = value;
  }

  const body = lines.slice(i).join('\n');
  return { meta, body };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class SkillManager {
  private skills = new Map<string, Skill>();
  private initialized = false;

  constructor(private options: SkillManagerOptions) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.reload();
  }

  async reload(): Promise<void> {
    this.skills.clear();
    const maxDepth = this.options.maxDepth ?? 6;

    for (const dir of this.options.directories) {
      if (!dir) continue;
      const abs = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
      if (!(await pathExists(abs))) continue;
      await this.scanDir(abs, 0, maxDepth);
    }
  }

  list(): Skill[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  get(name: string): Skill | null {
    return this.skills.get(name) ?? null;
  }

  private async scanDir(root: string, depth: number, maxDepth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (ent) => {
      const full = path.join(root, ent.name);
      if (ent.isDirectory()) {
        await this.scanDir(full, depth + 1, maxDepth);
        return;
      }
      if (!ent.isFile()) return;
      if (ent.name !== 'SKILL.md') return;

      await this.loadSkillFile(full);
    }));
  }

  private async loadSkillFile(filePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      const name = (meta['name'] ?? '').trim();
      if (!name) return;

      const skill: Skill = {
        name,
        description: (meta['description'] ?? '').trim() || undefined,
        type: (meta['type'] ?? '').trim() || undefined,
        content: body.trim(),
        sourcePath: filePath,
      };

      if (this.skills.has(name)) {
        const existing = this.skills.get(name);
        logger.warn(`Duplicate skill name "${name}" ignored: ${filePath} (kept ${existing?.sourcePath ?? 'unknown'})`);
        return;
      }
      this.skills.set(name, skill);
    } catch {
      // ignore invalid skills
    }
  }
}

