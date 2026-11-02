import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { appendFile, cp, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { cleanBoard, emptyBoard, parseSrc, type Board, type CanvasElement, type CanvasOp, type CanvasStatus, type Manifest } from '../../shared/canvas.js';
import { toTheme } from '../../shared/tokens.js';
import { readProfile } from './profile.js';
import { gitFolder, runGit } from './projectGit.js';

// The Canvas tab: a prototype app in <project>/app (its own git repo, ignored by the project's), its Vite dev server,
// the board in <project>/canvas/boards, and inspector edits through canvas-core (Rust). Edits are only ever written
// to files under app/src, one at a time.

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TEMPLATE = path.join(REPO, 'canvas', 'template');
const PLUGIN = path.join(REPO, 'canvas', 'plugin');
export const CORE_BIN = path.join(REPO, 'canvas-core', 'target', 'release', 'canvas-core');

const exists = (p: string) => stat(p).then(() => true, () => false);

/** The project folder for a chat's folder: the project when the chat is in one, else the chat's own folder. */
export const projectOf = async (cwd: string) => (await gitFolder(cwd)) ?? cwd;
const appOf = (project: string) => path.join(project, 'app');
const boardFile = (project: string) => path.join(project, 'canvas', 'boards', 'main.json');

type Run = { status: CanvasStatus; proc?: ChildProcess; log: string[] };
const runs = new Map<string, Run>();

function run(project: string): Run {
  let r = runs.get(project);
  if (!r) runs.set(project, (r = { status: { state: 'none' }, log: [] }));
  return r;
}

export async function canvasStatus(project: string): Promise<CanvasStatus> {
  const r = run(project);
  const hasProfile = !!(await readProfile(project).catch(() => null));
  if (r.status.state === 'none' || r.status.state === 'stopped') {
    const state = (await exists(path.join(appOf(project), 'package.json'))) ? 'stopped' : 'none';
    return { state, hasProfile };
  }
  return { ...r.status, hasProfile };
}

// ---- canvas-core ----------------------------------------------------------------------------------------------

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

export async function inspect(project: string, src: string): Promise<CanvasElement> {
  const at = parseSrc(src);
  const file = at && (await srcFile(project, at.file));
  if (!at || !file) throw new Error('That element is not in the app\'s source');
  const r = await callCore({ cmd: 'inspect', path: file, line: at.line, col: at.col });
  return r.element as CanvasElement;
}

// One edit at a time across all projects: the engine reads, changes and renames the file in one call, and a queue
// keeps two quick edits to one file from reading the same old text.
let edits: Promise<unknown> = Promise.resolve();

export function edit(project: string, src: string, tag: string, op: CanvasOp): Promise<{ changed: boolean }> {
  const go = async () => {
    const at = parseSrc(src);
    const file = at && (await srcFile(project, at.file));
    if (!at || !file) throw new Error('That element is not in the app\'s source');
    if (op.kind === 'text' && op.value.length > 2000) throw new Error('That text is too long for one element');
    if (op.kind === 'attr' && (op.value?.length ?? 0) > 2000) throw new Error('That value is too long');
    const r = await callCore({ cmd: 'edit', path: file, line: at.line, col: at.col, tag, op });
    return { changed: r.changed === true };
  };
  const p = edits.then(go, go);
  edits = p.catch(() => undefined);
  return p;
}

// ---- the app ----------------------------------------------------------------------------------------------------

async function writeTokens(project: string) {
  const ds = await readProfile(project).catch(() => null);
  await writeFile(path.join(appOf(project), 'src', 'tokens.css'), toTheme(ds ?? {}));
}

export async function refreshTokens(project: string) {
  if (!(await exists(path.join(appOf(project), 'src')))) throw new Error('There is no prototype app yet');
  await writeTokens(project);
}

/** The plugin is Design Studio's, so each start copies the current one in. */
const copyPlugin = (project: string) => cp(PLUGIN, path.join(appOf(project), '.designstudio'), { recursive: true, force: true });

function sh(cmd: string, args: string[], cwd: string, r: Run, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, npm_config_update_notifier: 'false' } });
    const keep = (b: Buffer) => { r.log.push(...String(b).split('\n').filter(Boolean)); r.log.splice(0, Math.max(0, r.log.length - 60)); };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${cmd} took longer than ${timeoutMs / 1000} seconds`)); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(r.log.at(-1) ?? `${cmd} failed`)); });
  });
}

/** Makes the prototype app: template, tokens from the profile, its own git repo, packages, then starts it. */
export async function createApp(project: string): Promise<void> {
  const r = run(project);
  if (['creating', 'installing', 'starting'].includes(r.status.state)) return;
  const app = appOf(project);
  r.status = { state: 'creating', step: 'Copying the template' };
  if (await exists(path.join(app, 'package.json'))) return startApp(project, true);
  try {
    await cp(TEMPLATE, app, { recursive: true, errorOnExist: false, force: false });
    await copyPlugin(project);
    const pkg = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
    pkg.name = path.basename(project).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'prototype';
    await writeFile(path.join(app, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    await writeTokens(project);
    // The project repo commits with `add -A`; the app has its own repo and is committed only from the canvas.
    const ignore = path.join(project, '.gitignore');
    const has = await readFile(ignore, 'utf8').catch(() => null);
    if (has !== null && !/^\/?app\/?$/m.test(has)) await appendFile(ignore, `${has.endsWith('\n') ? '' : '\n'}app/\n`);
    await mkdir(path.dirname(boardFile(project)), { recursive: true });
    if (!(await exists(boardFile(project)))) await writeFile(boardFile(project), JSON.stringify(emptyBoard(), null, 2) + '\n');
    r.status = { state: 'installing', step: 'Installing packages, about 30 seconds' };
    await sh('npm', ['install', '--no-audit', '--no-fund'], app, r, 180_000);
    if (!(await exists(path.join(app, '.git')))) {
      await runGit(['init', '-q', '-b', 'main'], app);
      await runGit(['add', '-A'], app);
      await runGit(['commit', '-q', '-m', 'Prototype app created by Design Studio'], app);
    }
  } catch (err) {
    r.status = { state: 'failed', error: (err as Error).message };
    return;
  }
  return startApp(project, true);
}

function freePort(from: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', () => (from < 5300 ? freePort(from + 1).then(resolve, reject) : reject(new Error('No free port between 5180 and 5300'))));
    s.listen(from, '127.0.0.1', () => s.close(() => resolve(from)));
  });
}

export async function startApp(project: string, creating = false): Promise<void> {
  const r = run(project);
  if (r.proc && r.proc.exitCode === null) return;
  if (!creating && ['creating', 'installing', 'starting'].includes(r.status.state)) return;
  const app = appOf(project);
  r.status = { state: 'starting', step: 'Starting the app' };
  try {
    if (!(await exists(path.join(app, 'package.json')))) throw new Error('There is no prototype app yet');
    if (!(await exists(path.join(app, 'node_modules')))) {
      r.status = { state: 'installing', step: 'Installing packages, about 30 seconds' };
      await sh('npm', ['install', '--no-audit', '--no-fund'], app, r, 180_000);
    }
    await copyPlugin(project);
    const port = await freePort(5180);
    const vite = path.join(app, 'node_modules', 'vite', 'bin', 'vite.js');
    const proc = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
      cwd: app,
      env: { ...process.env, DS_CANVAS_CORE: CORE_BIN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    r.proc = proc;
    const keep = (b: Buffer) => { r.log.push(...String(b).split('\n').filter(Boolean)); r.log.splice(0, Math.max(0, r.log.length - 60)); };
    proc.stdout!.on('data', keep);
    proc.stderr!.on('data', keep);
    proc.on('exit', () => {
      if (r.proc === proc) { r.proc = undefined; if (r.status.state === 'running') r.status = { state: 'stopped' }; }
    });
    const url = `http://127.0.0.1:${port}`;
    // Up to 30 seconds for the first answer.
    for (let i = 0; i < 120; i++) {
      if (proc.exitCode !== null) throw new Error(r.log.at(-1) ?? 'The app stopped while starting');
      if (await fetch(url, { signal: AbortSignal.timeout(1000) }).then((x) => x.ok, () => false)) {
        r.status = { state: 'running', url };
        return;
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    proc.kill();
    throw new Error('The app did not answer within 30 seconds');
  } catch (err) {
    r.status = { state: 'failed', error: (err as Error).message };
  }
}

export function stopAll() {
  for (const r of runs.values()) r.proc?.kill();
  core?.proc.kill();
}

export async function manifest(project: string): Promise<Manifest> {
  const url = run(project).status.url;
  if (!url) throw new Error('The app is not running');
  const res = await fetch(`${url}/__ds/manifest`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Could not read the app\'s screens');
  return body as Manifest;
}

// ---- the board ----------------------------------------------------------------------------------------------------

export async function readBoard(project: string): Promise<Board> {
  const raw = await readFile(boardFile(project), 'utf8').catch(() => null);
  if (!raw) return emptyBoard();
  try {
    return cleanBoard(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

export async function writeBoard(project: string, board: unknown): Promise<Board> {
  const clean = cleanBoard(board);
  const file = boardFile(project);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n');
  await rename(tmp, file);
  return clean;
}
