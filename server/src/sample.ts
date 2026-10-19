import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { CHATS_ROOT } from './settings.js';
import { installSkills } from './figma.js';

const SAMPLE = fileURLToPath(new URL('../sample', import.meta.url));

export const SAMPLE_NAME = 'Sample - Grocery cart';

export const samplePath = (root = CHATS_ROOT) => path.join(root, SAMPLE_NAME);

export async function loadSample(root = CHATS_ROOT) {
  const dir = samplePath(root);
  await mkdir(dir, { recursive: true });
  await cp(SAMPLE, dir, { recursive: true, force: true });
  await freshen(dir);
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
}
