import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { claudeMdExcludes, designCore, skillImports } from './designRules.js';

describe('design rules', () => {
  it('leaves out of CLAUDE.md only the imported rule files she can still load as skills', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ds-rules-'));
    for (const f of ['design-process', 'visual-craft-review', 'loose']) {
      await mkdir(path.join(home, 'design-skills', f), { recursive: true });
      await writeFile(path.join(home, 'design-skills', f, 'SKILL.md'), `# ${f}`);
    }
    await mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
    await symlink(path.join(home, 'design-skills', 'design-process'), path.join(home, '.claude', 'skills', 'design-process'));
    await symlink(path.join(home, 'design-skills', 'visual-craft-review'), path.join(home, '.claude', 'skills', 'visual-craft-review'));
    await writeFile(path.join(home, '.claude', 'CLAUDE.md'), '- Follow: @~/design-skills/design-process/SKILL.md @~/design-skills/visual-craft-review/SKILL.md @~/design-skills/loose/SKILL.md');
    const skills = skillImports(home);
    // "loose" is not a skill, so its import stays in CLAUDE.md and nothing becomes unreachable.
    expect(skills.map((s) => s.folder)).toEqual(['design-process', 'visual-craft-review']);
    expect(claudeMdExcludes(skills).some((f) => f.includes('loose'))).toBe(false);
    expect(designCore(skills)).toContain('Load design-process with the Skill tool');
    expect(designCore(skillImports(path.join(home, 'nobody')))).toBe('');
  });
});
