import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { CHATS_ROOT } from './settings.js';
import { installSkills } from './figma.js';
import { readSketch, renderAll } from './sketch.js';
import { DECISIONS_LOG_FILE } from '../../shared/decisionLog.js';

const SAMPLE = fileURLToPath(new URL('../sample', import.meta.url));

export const SAMPLE_NAME = 'Sample - Grocery cart';

export const samplePath = (root = CHATS_ROOT) => path.join(root, SAMPLE_NAME);

export async function loadSample(root = CHATS_ROOT) {
  const dir = samplePath(root);
  await mkdir(dir, { recursive: true });
  await cp(SAMPLE, dir, { recursive: true, force: true });
  await freshen(dir);
  const sketch = await readSketch(dir);
  if (sketch) await renderAll(dir, sketch);
  await installSkills(dir);
  return dir;
}

const RUNS = ['buildcheck.json', 'copy.json', 'crit.json', 'review.json'];

async function freshen(dir: string) {
  const now = Date.now();
  await Promise.all(RUNS.map(async (name, i) => {
    const file = path.join(dir, name);
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text) await writeFile(file, text.replace(/"at": *\d+/g, `"at": ${now - (RUNS.length - i) * 60_000}`));
  }));
  // Chat decisions a few minutes apart, so the log reads as made during the work.
  const log = path.join(dir, DECISIONS_LOG_FILE);
  const items = JSON.parse(await readFile(log, 'utf8').catch(() => '[]')) as Array<{ at?: number }>;
  if (items.length) await writeFile(log, JSON.stringify(items.map((d, i) => ({ ...d, at: now - (items.length - i) * 7 * 60_000 })), null, 2));
}
