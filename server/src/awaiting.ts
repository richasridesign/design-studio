import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOME } from './settings.js';
import { AWAIT_STATES, addFindings, cleanAwaiting, decide, type AwaitItem, type AwaitState } from '../../shared/awaiting.js';
import type { Finding } from '../../shared/design.js';

// One list for every chat, so a decision waits for the designer wherever the review ran.
const FILE = () => path.join(HOME, 'awaiting.json');

let chain: Promise<unknown> = Promise.resolve();
/** Writes run one at a time, so two reviews finishing together do not drop each other's items. */
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

export const readAwaiting = async (): Promise<AwaitItem[]> => cleanAwaiting(await readFile(FILE(), 'utf8').then(JSON.parse, () => []));

async function save(list: AwaitItem[]) {
  await mkdir(path.dirname(FILE()), { recursive: true });
  await writeFile(FILE(), JSON.stringify(list, null, 2));
  return list;
}

const fileName = (dir: string) => readFile(path.join(dir, 'figma.json'), 'utf8').then((t) => String(JSON.parse(t).name ?? ''), () => '');

export function awaitFindings(dir: string, fileKey: string, findings: Finding[]) {
  if (!findings.some((f) => f.decide)) return Promise.resolve(null);
  return serial(async () => save(addFindings(await readAwaiting(), findings, { key: fileKey, name: await fileName(dir) })));
}

export function updateAwaiting(body: unknown) {
  const b = (body ?? {}) as { id?: unknown; state?: unknown };
  if (typeof b.id !== 'string' || !AWAIT_STATES.includes(b.state as AwaitState)) throw new Error('Send an id and a state');
  return serial(async () => save(decide(await readAwaiting(), b.id as string, b.state as AwaitState)));
}
