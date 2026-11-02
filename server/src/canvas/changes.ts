import path from 'node:path';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { CanvasChanges } from '../../../shared/canvas.js';
import { runGit } from '../projectGit.js';
import { queued } from './core.js';
import { appOf } from './paths.js';

// What the canvas changed in the app: an undo list of this session's edits, and the app repo's uncommitted files.
// Commits stay in app/ and are never pushed. The undo list lives in memory; after a restart git still has the rest.

type Entry = { file: string; rel: string; before: string; after: string; label: string; at: number };
const MAX = 100;
const history = new Map<string, Entry[]>();

export function record(project: string, e: Omit<Entry, 'at'>) {
  const list = history.get(project) ?? [];
  list.push({ ...e, at: Date.now() });
  list.splice(0, Math.max(0, list.length - MAX));
  history.set(project, list);
}

/**
 * Puts back the file as it was before the last edit, but only when nothing else changed it since (Claude, an editor,
 * a later edit that failed to record). Otherwise the newer work would be lost, so it refuses.
 */
export function undo(project: string): Promise<{ label: string }> {
  return queued(async () => {
    const list = history.get(project) ?? [];
    const last = list.at(-1);
    if (!last) throw new Error('Nothing to undo');
    const now = await readFile(last.file, 'utf8').catch(() => null);
    if (now !== last.after) {
      list.pop();
      throw new Error(`${last.rel} changed after that edit, so it was not undone. Discard it from Changes instead`);
    }
    const tmp = path.join(path.dirname(last.file), `.${path.basename(last.file)}.ds-undo`);
    await writeFile(tmp, last.before);
    await rename(tmp, last.file);
    list.pop();
    return { label: last.label };
  });
}

const git = (project: string, args: string[]) => runGit(args, appOf(project));

export async function changes(project: string): Promise<CanvasChanges> {
  const status = await git(project, ['status', '--porcelain', '--untracked-files=all']);
  const counts = new Map<string, [number, number]>();
  for (const line of (await git(project, ['diff', '--numstat', 'HEAD'])).split('\n')) {
    const [a, r, f] = line.split('\t');
    if (f) counts.set(f, [Number(a) || 0, Number(r) || 0]);
  }
  const files = status.split('\n').filter(Boolean).map((l) => {
    const file = l.slice(3).replace(/^.* -> /, '');
    const [added, removed] = counts.get(file) ?? [0, 0];
    return { file, state: l.slice(0, 2).trim() === '??' ? 'new' as const : l.includes('D') && !l.slice(0, 2).includes('M') ? 'deleted' as const : 'changed' as const, added, removed };
  });
  const edits = (history.get(project) ?? []).map((e) => ({ label: e.label, file: e.rel, at: e.at })).reverse();
  return { files, edits };
}

export async function diff(project: string, file: string): Promise<string> {
  if (!file || file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Not a file in the app');
  const tracked = await git(project, ['ls-files', '--', file]);
  const out = tracked.trim() ? await git(project, ['diff', 'HEAD', '--', file]) : await readFile(path.join(appOf(project), file), 'utf8').then((t) => t.split('\n').map((l) => `+${l}`).join('\n'));
  return out.slice(0, 200_000);
}

/** Commits every change in the app, locally. The undo list is cleared, since those edits are now history. */
export async function commit(project: string, message: string): Promise<{ hash: string; message: string }> {
  const msg = message.trim().slice(0, 2000) || 'Canvas edits';
  return queued(async () => {
    await git(project, ['add', '-A']);
    if (!(await git(project, ['diff', '--cached', '--name-only'])).trim()) throw new Error('Nothing to commit');
    await git(project, ['commit', '-q', '-m', msg]);
    history.delete(project);
    return { hash: (await git(project, ['rev-parse', '--short', 'HEAD'])).trim(), message: msg.split('\n')[0] };
  });
}

/** Throws away uncommitted changes to one file (a new file is deleted). */
export async function discard(project: string, file: string): Promise<void> {
  if (!file || file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Not a file in the app');
  return queued(async () => {
    const tracked = (await git(project, ['ls-files', '--', file])).trim();
    if (tracked) await git(project, ['checkout', 'HEAD', '--', file]);
    else await git(project, ['clean', '-fq', '--', file]);
    const list = history.get(project);
    if (list) history.set(project, list.filter((e) => e.rel !== file));
  });
}
