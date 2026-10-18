import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { changeTriage, cleanTriage, type Triage, type TriageChange } from '../../shared/triage.js';

export const TRIAGE_FILE = 'triage.json';

export const readTriage = (dir: string): Promise<Triage> =>
  readFile(path.join(dir, TRIAGE_FILE), 'utf8').then((t) => cleanTriage(JSON.parse(t))).catch(() => ({}));

export async function updateTriage(dir: string, input: unknown, now = Date.now()): Promise<Triage> {
  const c = (input ?? {}) as TriageChange;
  if (c.action !== 'close' && c.action !== 'reopen') throw new Error('Pick close or reopen');
  const next = changeTriage(await readTriage(dir), c, now);
  await writeFile(path.join(dir, TRIAGE_FILE), JSON.stringify(next, null, 2));
  return next;
}
