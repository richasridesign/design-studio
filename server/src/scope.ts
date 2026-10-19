import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { changeScope, cleanScope, type Scope, type ScopeChange } from '../../shared/scope.js';
import { projectRoot } from './roots.js';

export const SCOPE_FILE = 'scope.json';

/** Scope is per project (the file), kept at the project root, shared by every chat on it. */
export const readScope = (dir: string): Promise<Scope> =>
  readFile(path.join(projectRoot(dir), SCOPE_FILE), 'utf8').then((t) => cleanScope(JSON.parse(t))).catch(() => cleanScope(null));

export async function updateScope(dir: string, input: unknown, now = Date.now()): Promise<Scope> {
  const c = (input ?? {}) as ScopeChange;
  if (!['add', 'remove', 'park', 'restore'].includes(c.action)) throw new Error('Pick add, remove, park or restore');
  const next = changeScope(await readScope(dir), c, now);
  await writeFile(path.join(projectRoot(dir), SCOPE_FILE), JSON.stringify(next, null, 2));
  return next;
}
