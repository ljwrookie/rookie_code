import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillManager } from '../manager.js';

describe('SkillManager', () => {
  it('loads SKILL.md with frontmatter and markdown body', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rookie-skill-test-'));
    const skillDir = path.join(tmp, 'omc');
    await fs.mkdir(skillDir, { recursive: true });

    const skillFile = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(
      skillFile,
      [
        '---',
        'name: omc',
        'description: Unified task router',
        'type: router',
        '---',
        '',
        '# Title',
        'Body line',
      ].join('\n'),
      'utf-8',
    );

    const manager = new SkillManager({ directories: [tmp] });
    await manager.init();

    expect(manager.has('omc')).toBe(true);
    const skill = manager.get('omc');
    expect(skill?.name).toBe('omc');
    expect(skill?.description).toBe('Unified task router');
    expect(skill?.type).toBe('router');
    expect(skill?.content).toContain('# Title');
    expect(skill?.sourcePath).toBe(skillFile);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

