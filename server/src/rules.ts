import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOME } from './settings.js';
import { projectRoot } from './roots.js';
import { readScope } from './scope.js';
import { scopeBlock, type Scope } from '../../shared/scope.js';

const MAX_RULES = 20 * 1024;

export type Rules = { global: string; file: string; scope?: Scope };

const GLOBAL = path.join(HOME, 'rules.md');
const read = (p: string) => readFile(p, 'utf8').catch(() => '');

/** The file's rules live at the project root, shared by every chat on the file. */
export const readRules = async (dir: string): Promise<Rules> => ({ global: await read(GLOBAL), file: await read(path.join(projectRoot(dir), 'rules.md')), scope: await readScope(dir) });

export async function writeRules(dir: string, patch: Partial<Rules>) {
  await mkdir(HOME, { recursive: true });
  if (typeof patch.global === 'string') await writeFile(GLOBAL, patch.global.slice(0, MAX_RULES));
  if (typeof patch.file === 'string') await writeFile(path.join(projectRoot(dir), 'rules.md'), patch.file.slice(0, MAX_RULES));
  return readRules(dir);
}

export function rulesBlock(r: Rules) {
  const text = [r.global, r.file].map((t) => t.trim()).filter(Boolean).join('\n');
  return [text ? `House rules from the designer, follow them:\n${text}` : '', scopeBlock(r.scope)].filter(Boolean).join('\n\n');
}
