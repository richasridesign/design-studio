import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { changeDesignSystem, listSkills, readCodeTokens, skillRulesFor, switchStarter } from './dsSources.js';
import { starterProfile } from '../../shared/dsProfiles.js';
import { profileOff } from './profile.js';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'ds-'));

async function skillsDir() {
  const root = await tmp();
  for (const [folder, text] of [['accessibility-review', '# A11y\n- Contrast 4.5:1\n- Targets 24px'], ['design-process', '# Process\n- Plan first'], ['notes', 'no skill file']]) {
    await mkdir(path.join(root, folder));
    if (folder !== 'notes') await writeFile(path.join(root, folder, 'SKILL.md'), text);
  }
  return root;
}

describe('rule files', () => {
  it('lists folders with a SKILL.md and their areas', async () => {
    const list = await listSkills(await skillsDir());
    expect(list.map((s) => [s.folder, s.area, s.lines])).toEqual([['accessibility-review', 'accessibility', 2], ['design-process', null, 1]]);
  });
  it('reads the rules live for a reviewer, and nothing without the source', async () => {
    const dir = await skillsDir();
    const ds = { ...starterProfile('nordic', 1), sources: [{ kind: 'skills' as const, dir, off: [] }] };
    expect(await skillRulesFor(ds, ['accessibility'])).toContain('- Contrast 4.5:1');
    await writeFile(path.join(dir, 'accessibility-review', 'SKILL.md'), '- Edited rule');
    expect(await skillRulesFor(ds, ['accessibility'])).toContain('- Edited rule');
    expect(await skillRulesFor(starterProfile('lofi', 1), ['accessibility'])).toBe('');
  });
});

describe('code tokens', () => {
  it('reads a CSS file and refuses other types', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'tokens.css'), ':root { --ink: #000; }');
    expect((await readCodeTokens(path.join(dir, 'tokens.css'))).found.colors).toHaveLength(1);
    await expect(readCodeTokens(path.join(dir, 'tokens.ts'))).rejects.toThrow('.css or .json');
  });
});

describe('changeDesignSystem', () => {
  it('starts from a starter, adds code tokens, drops one, and clears', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 't.css'), ':root { --brand: #2257d6; --space-2: 8px; }');
    let r = await changeDesignSystem(dir, null, { action: 'starter', id: 'lofi' });
    expect(r.ds?.name).toBe('Lo-fi sketch');
    r = await changeDesignSystem(dir, null, { action: 'code', path: path.join(dir, 't.css') });
    expect(r.ds?.colors.map((c) => c.name)).toEqual(['ink', 'paper', 'grey', 'brand']);
    r = await changeDesignSystem(dir, null, { action: 'drop', kind: 'color', name: 'brand' });
    expect(r.ds?.dropped).toEqual(['color:brand']);
    expect(JSON.parse(await readFile(path.join(dir, 'design-system.json'), 'utf8')).colors).toHaveLength(3);
    r = await changeDesignSystem(dir, null, { action: 'clear' });
    expect(r.ds).toBeNull();
    await expect(readFile(path.join(dir, 'design-system.json'), 'utf8')).rejects.toThrow();
  });
  it('keeps a removed profile off until she adds one', async () => {
    const dir = await tmp();
    expect(await profileOff(dir)).toBe(false);
    await changeDesignSystem(dir, null, { action: 'starter', id: 'nordic' });
    await changeDesignSystem(dir, null, { action: 'clear' });
    expect(await profileOff(dir)).toBe(true);
    await changeDesignSystem(dir, null, { action: 'starter', id: 'lofi' });
    expect(await profileOff(dir)).toBe(false);
  });
  it('keeps her principles on a starter switch, and takes the starter\'s when she never changed them', async () => {
    const dir = await tmp();
    await changeDesignSystem(dir, null, { action: 'starter', id: 'nordic' });
    let r = await changeDesignSystem(dir, null, { action: 'starter', id: 'lofi' });
    expect(r.kept).toEqual([]);
    expect(r.ds?.rules).toEqual(starterProfile('lofi', 1).rules);
    await changeDesignSystem(dir, null, { action: 'edit', rules: ['Dialogs always have a close icon.'] });
    r = await changeDesignSystem(dir, null, { action: 'starter', id: 'nordic' });
    expect(r.kept).toEqual(['principles']);
    expect(r.ds?.rules).toEqual(['Dialogs always have a close icon.']);
    expect(r.ds?.name).toBe('Nordic calm B2B');
    expect(r.ds?.starter).toBe('nordic');
  });
  it('keeps a name and note that are not the old starter\'s', () => {
    const mine = { ...starterProfile('nordic', 1), name: 'Atlas', note: 'Our product', rules: starterProfile('nordic', 1).rules };
    const r = switchStarter(mine, 'lofi', 2);
    expect(r.kept).toEqual(['name', 'note']);
    expect(r.ds).toMatchObject({ name: 'Atlas', note: 'Our product', starter: 'lofi', rules: starterProfile('lofi', 2).rules });
  });
  it('records a failed Figma read on the source instead of failing', async () => {
    const dir = await tmp();
    const run = vi.fn(async () => ({ data: null, error: 'Figma is closed', tokens: 0, costUsd: 0, text: '' }));
    const mcp = { servers: {}, plugins: [], name: 'figma', configured: true } as never;
    const r = await changeDesignSystem(dir, { key: 'K', name: 'File', url: 'u' }, { action: 'figma' }, { run: run as never, mcp });
    expect(r.ds?.sources?.[0]).toMatchObject({ kind: 'figma', key: 'K' });
    expect((r.ds?.sources?.[0] as { error?: string }).error).toBeTruthy();
  });
});
