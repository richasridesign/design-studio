import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { emptyBoard, type CanvasStatus, type Manifest } from '../../../shared/canvas/index.js';
import { toTheme } from '../../../shared/tokens.js';
import { readTokens, type Tokens } from '../../../shared/canvas/index.js';
import { readProfile } from '../profile.js';
import { runGit } from '../projectGit.js';
import { stopCore } from './core.js';
import { appOf, boardFile, CORE_BIN, exists, PLUGIN, TEMPLATE } from './paths.js';

// The prototype app: made from the template, started with its own Vite dev server, one per project.

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


async function writeTokens(project: string) {
  const ds = await readProfile(project).catch(() => null);
  await writeFile(path.join(appOf(project), 'src', 'tokens.css'), toTheme(ds ?? {}));
}

/** The colour, text size and radius tokens the app's theme defines, for the inspector's style menus. */
export async function appTokens(project: string): Promise<Tokens> {
  const src = path.join(appOf(project), 'src');
  const css = await Promise.all(['tokens.css', 'index.css'].map((f) => readFile(path.join(src, f), 'utf8').catch(() => '')));
  return readTokens(css.join('\n'));
}

export async function refreshTokens(project: string) {
  if (!(await exists(path.join(appOf(project), 'src')))) throw new Error('There is no prototype app yet');
  await writeTokens(project);
}

/**
 * The plugin is Design Studio's, so each start copies the current one in. It is not the app's own code, so the app's
 * repo ignores it (apps made before that rule stop tracking it on their next start).
 */
async function copyPlugin(project: string) {
  const app = appOf(project);
  await cp(PLUGIN, path.join(app, '.designstudio'), { recursive: true, force: true });
  const ignore = path.join(app, '.gitignore');
  const has = await readFile(ignore, 'utf8').catch(() => '');
  if (/^\/?\.designstudio\/?$/m.test(has)) return;
  await writeFile(ignore, `${has}${has && !has.endsWith('\n') ? '\n' : ''}.designstudio/\n`);
  if (await exists(path.join(app, '.git'))) await runGit(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.designstudio'], app).catch(() => undefined);
}

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
  stopCore();
}

export async function manifest(project: string): Promise<Manifest> {
  const url = run(project).status.url;
  if (!url) throw new Error('The app is not running');
  const res = await fetch(`${url}/__ds/manifest`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Could not read the app\'s screens');
  return body as Manifest;
}
