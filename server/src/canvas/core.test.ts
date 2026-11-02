import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { srcFile } from './core.js';

// The inspector writes to whatever file the page names, so the guard is the only thing keeping edits inside app/src.
describe('srcFile', () => {
  it('allows only .jsx and .tsx files inside app/src', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'ds-canvas-'));
    await mkdir(path.join(project, 'app', 'src', 'screens'), { recursive: true });
    await writeFile(path.join(project, 'app', 'src', 'screens', 'A.tsx'), '');
    await writeFile(path.join(project, 'app', 'vite.config.jsx'), '');
    await writeFile(path.join(project, 'outside.tsx'), '');
    await symlink(path.join(project, 'outside.tsx'), path.join(project, 'app', 'src', 'link.tsx'));

    expect(await srcFile(project, 'src/screens/A.tsx')).toMatch(/A\.tsx$/);
    expect(await srcFile(project, 'src/screens/A.ts')).toBeNull();
    expect(await srcFile(project, 'vite.config.jsx')).toBeNull();
    expect(await srcFile(project, 'src/../../outside.tsx')).toBeNull();
    expect(await srcFile(project, '/etc/x.tsx')).toBeNull();
    expect(await srcFile(project, 'src/link.tsx')).toBeNull();
    expect(await srcFile(project, 'src/missing.tsx')).toBeNull();
  });
});
