import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

export async function listFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split('\n').filter(Boolean).sort();
  } catch {
    return walk(cwd, '');
  }
}

async function walk(root: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, p)));
    else out.push(p);
  }
  return out;
}

const HIDDEN = new Set(['node_modules', '.git', 'dist']);

export async function listDir(cwd: string, rel: string) {
  const abs = safeResolve(cwd, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (e) => ({
      name: e.name,
      path: rel ? `${rel}/${e.name}` : e.name,
      dir: e.isDirectory() || (e.isSymbolicLink() && !!(await stat(path.join(abs, e.name)).catch(() => null))?.isDirectory()),
    })),
  );
  const ignored = new Set(
    items.length
      ? (await exec('git', ['check-ignore', '--', ...items.map((i) => i.path)], { cwd }).catch((e) => e)).stdout?.split('\n') ?? []
      : [],
  );
  return items
    .map((i) => ({ name: i.name, dir: i.dir, hidden: HIDDEN.has(i.name) || ignored.has(i.path) }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
}

export function safeResolve(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  if (!abs.startsWith(path.resolve(cwd) + path.sep) && abs !== path.resolve(cwd)) {
    throw new Error('path outside project');
  }
  return abs;
}

export async function readFileWithOriginal(cwd: string, rel: string) {
  const abs = safeResolve(cwd, rel);
  const content = await readFile(abs, 'utf8').catch(() => '');
  let original = '';
  try {
    const { stdout } = await exec('git', ['show', `HEAD:${rel}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
    original = stdout;
  } catch {
    original = '';
  }
  return { path: rel, content, original };
}
