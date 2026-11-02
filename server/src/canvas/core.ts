import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, realpath } from 'node:fs/promises';
import { parseSrc, type CanvasComponent, type CanvasElement, type CanvasOp } from '../../../shared/canvas.js';
import { record } from './changes.js';
import { appOf, CORE_BIN, exists } from './paths.js';

// canvas-core (Rust) reads and edits the app's source. Edits are only ever written to files under app/src, one at
// a time; the engine checks the same root again before it reads or writes.

type Pending = (msg: Record<string, unknown>) => void;
let core: { proc: ChildProcess; waiting: Map<number, Pending>; next: number } | null = null;

function coreProc() {
  if (core && core.proc.exitCode === null) return core;
  const proc = spawn(CORE_BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const c = { proc, waiting: new Map<number, Pending>(), next: 1 };
  createInterface({ input: proc.stdout! }).on('line', (line) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line); } catch { return; }
    c.waiting.get(Number(msg.id))?.(msg);
    c.waiting.delete(Number(msg.id));
  });
  const fail = (why: string) => { for (const done of c.waiting.values()) done({ error: why }); c.waiting.clear(); };
  proc.on('error', (e) => fail(`canvas-core did not start: ${e.message}`));
  proc.on('exit', () => fail('canvas-core stopped'));
  core = c;
  return c;
}

async function callCore(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!(await exists(CORE_BIN))) throw new Error('The canvas engine is not built yet. Run npm run core in the Design Studio folder');
  const c = coreProc();
  const msg = await new Promise<Record<string, unknown>>((resolve) => {
    const id = c.next++;
    const timer = setTimeout(() => { c.waiting.delete(id); resolve({ error: 'canvas-core did not answer in 10 seconds' }); }, 10_000);
    c.waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
    c.proc.stdin!.write(JSON.stringify({ ...req, id }) + '\n');
  });
  if (typeof msg.error === 'string') throw new Error(msg.error);
  return msg;
}

/**
 * The absolute file for a data-ds-src path, or null when it is not a source file under app/src. Symlinks are
 * resolved first, so a link inside src cannot point an edit outside it.
 */
export async function srcFile(project: string, rel: string): Promise<string | null> {
  if (!/\.[jt]sx$/.test(rel) || rel.includes('\0')) return null;
  const root = path.join(appOf(project), 'src');
  const file = path.resolve(appOf(project), rel);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    const [r, f] = await Promise.all([realpath(root), realpath(file)]);
    return f.startsWith(r + path.sep) ? f : null;
  } catch {
    return null;
  }
}

const srcRoot = (project: string) => path.join(appOf(project), 'src');

export async function inspect(project: string, src: string): Promise<CanvasElement> {
  const at = parseSrc(src);
  const file = at && (await srcFile(project, at.file));
  if (!at || !file) throw new Error('That element is not in the app\'s source');
  const r = await callCore({ cmd: 'inspect', path: file, line: at.line, col: at.col, root: srcRoot(project) });
  return r.element as CanvasElement;
}

/**
 * The props of the components a file defines (variant options, defaults), for the inspector. With a name, the file
 * is where the component is used, and the engine follows that file's import to where it is defined.
 */
export async function props(project: string, rel: string, name?: string): Promise<{ file: string; components: CanvasComponent[] }> {
  const file = await srcFile(project, rel);
  if (!file) throw new Error('That component is not in the app\'s source');
  const r = await callCore({ cmd: 'props', path: file, root: srcRoot(project), ...(name ? { name } : {}) });
  return { file: path.relative(appOf(project), String(r.file)), components: r.components as CanvasComponent[] };
}

// One change at a time across all projects: the engine reads, changes and renames the file in one call, and a queue
// keeps two quick edits (or an edit and an undo) to one file from reading the same old text.
let edits: Promise<unknown> = Promise.resolve();

export function queued<T>(go: () => Promise<T>): Promise<T> {
  const p = edits.then(go, go);
  edits = p.catch(() => undefined);
  return p;
}

export function edit(project: string, src: string, tag: string, op: CanvasOp, label = ''): Promise<{ changed: boolean }> {
  return queued(async () => {
    const at = parseSrc(src);
    const file = at && (await srcFile(project, at.file));
    if (!at || !file) throw new Error('That element is not in the app\'s source');
    if (op.kind === 'text' && op.value.length > 2000) throw new Error('That text is too long for one element');
    if (op.kind === 'attr' && (op.value?.length ?? 0) > 2000) throw new Error('That value is too long');
    const before = await readFile(file, 'utf8');
    const r = await callCore({ cmd: 'edit', path: file, line: at.line, col: at.col, tag, op, root: srcRoot(project) });
    if (r.changed === true) record(project, { file, rel: at.file, before, after: await readFile(file, 'utf8'), label: label.slice(0, 200) || `${tag} in ${at.file}` });
    return { changed: r.changed === true };
  });
}

export const stopCore = () => core?.proc.kill();
