import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOME } from './settings.js';

const MAX_RULES = 20 * 1024;

export type Rules = { global: string; file: string };

const GLOBAL = path.join(HOME, 'rules.md');
const read = (p: string) => readFile(p, 'utf8').catch(() => '');

export const readRules = async (dir: string): Promise<Rules> => ({ global: await read(GLOBAL), file: await read(path.join(dir, 'rules.md')) });

export async function writeRules(dir: string, patch: Partial<Rules>) {
  await mkdir(HOME, { recursive: true });
  if (typeof patch.global === 'string') await writeFile(GLOBAL, patch.global.slice(0, MAX_RULES));
  if (typeof patch.file === 'string') await writeFile(path.join(dir, 'rules.md'), patch.file.slice(0, MAX_RULES));
  return readRules(dir);
}

export function rulesBlock(r: Rules) {
  const text = [r.global, r.file].map((t) => t.trim()).filter(Boolean).join('\n');
  return text ? `House rules from the designer, follow them:\n${text}` : '';
}
