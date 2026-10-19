import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSample, SAMPLE_NAME } from './sample.js';

describe('loadSample', () => {
  it('writes the sample chat folder and can refresh it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dv-sample-'));
    const dir = await loadSample(root);
    expect(dir).toBe(path.join(root, SAMPLE_NAME));
    for (const _ of [1, 2]) {
      const files = await readdir(dir);
      for (const f of ['figma.json', 'plan.md', 'sketch.json', 'review.json', 'crit.json', 'copy.json', 'design-system.json', 'design-system.md', 'sketches', 'buildcheck.json', 'buildcheck']) expect(files).toContain(f);
      expect(await readdir(path.join(dir, 'sketches'))).toEqual(['cart--a.svg', 'cart--b.svg', 'empty--a.svg', 'empty--b.svg']);
      expect((await readdir(path.join(dir, 'buildcheck', 'sample'))).sort()).toEqual(['figma.png', 'site.png']);
      const figma = JSON.parse(await readFile(path.join(dir, 'figma.json'), 'utf8'));
      expect(figma).toMatchObject({ key: 'sample', name: 'Grocery app (sample)' });
      await loadSample(root);
    }
  });
});
