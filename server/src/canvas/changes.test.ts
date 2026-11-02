import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { record, undo } from './changes.js';

// Undo writes an old copy of a file back, so it must never overwrite work that came after the edit.
describe('undo', () => {
  it('puts the file back, newest edit first, and refuses when the file changed since', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'ds-undo-'));
    const file = path.join(project, 'A.tsx');
    await writeFile(file, 'v3');
    record(project, { file, rel: 'src/A.tsx', before: 'v1', after: 'v2', label: 'first' });
    record(project, { file, rel: 'src/A.tsx', before: 'v2', after: 'v3', label: 'second' });

    expect(await undo(project)).toEqual({ label: 'second' });
    expect(await readFile(file, 'utf8')).toBe('v2');

    await writeFile(file, 'edited by hand');
    await expect(undo(project)).rejects.toThrow(/changed after that edit/);
    expect(await readFile(file, 'utf8')).toBe('edited by hand');
    await expect(undo(project)).rejects.toThrow(/Nothing to undo/);
  });
});
