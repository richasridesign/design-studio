import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { parseFigmaUrl, type FigmaFile } from '../../shared/design.js';
import { CHATS_ROOT } from './settings.js';

const SKILLS = fileURLToPath(new URL('../../skills', import.meta.url));

import { FigmaError } from './figmaError.js';

export { FigmaError };

export const SAMPLE_KEY = 'sample';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';

export const isChatFolder = (dir: string) => path.resolve(dir).startsWith(path.resolve(CHATS_ROOT) + path.sep);

export async function readFigma(dir: string): Promise<FigmaFile | null> {
  return readFile(path.join(dir, 'figma.json'), 'utf8').then(JSON.parse).catch(() => null);
}

export async function chatFolders() {
  const names = await readdir(CHATS_ROOT).catch(() => [] as string[]);
  const out: Array<{ dir: string; figma: FigmaFile | null }> = [];
  for (const n of names) {
    const dir = path.join(CHATS_ROOT, n);
    if (!(await stat(dir).then((s) => s.isDirectory()).catch(() => false))) continue;
    out.push({ dir, figma: await readFigma(dir) });
  }
  return out;
}

export async function installSkills(dir: string) {
  await mkdir(path.join(dir, '.claude'), { recursive: true });
  await cp(SKILLS, path.join(dir, '.claude', 'skills'), { recursive: true, force: true }).catch((err) => console.error('skills:', err.message));
}

export async function scratchFolder() {
  const dir = path.join(CHATS_ROOT, 'scratch');
  await mkdir(dir, { recursive: true });
  await installSkills(dir);
  return dir;
}

function parseUrl(url: string) {
  const parsed = parseFigmaUrl(url);
  if (!parsed) throw new FigmaError('That is not a Figma file link. Copy the link from the Share button or the address bar.');
  return parsed;
}

/** The file name from the link (figma.com/design/KEY/File-Name), since the plugin only knows the document as "Document". */
export function nameFromUrl(url: string, key: string) {
  const m = new RegExp(`/${key}/([^/?#]+)`).exec(url);
  if (!m) return 'Figma file';
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch {}
  return raw.replace(/-+/g, ' ').trim() || 'Figma file';
}

const figmaFile = (key: string, name: string): FigmaFile => ({ key, name, url: `https://www.figma.com/design/${key}` });

export async function folderFor(url: string) {
  const parsed = parseUrl(url);
  const existing = (await chatFolders()).find((f) => f.figma?.key === parsed.key);
  if (existing) {
    await installSkills(existing.dir);
    return existing.dir;
  }
  const name = nameFromUrl(url, parsed.key);
  const dir = path.join(CHATS_ROOT, `${slug(name)}-${parsed.key.slice(0, 6)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify(figmaFile(parsed.key, name), null, 2));
  await installSkills(dir);
  return dir;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export async function freshChatFolder(now = new Date()) {
  const base = path.join(CHATS_ROOT, `chat-${stamp(now)}`);
  let dir = base;
  while (await stat(dir).then(() => true, () => false)) dir = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  await mkdir(dir, { recursive: true });
  await installSkills(dir);
  return dir;
}

export async function attachFolder(dir: string, url: string) {
  const parsed = parseUrl(url);
  const figma = figmaFile(parsed.key, nameFromUrl(url, parsed.key));
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify(figma, null, 2));
  return figma;
}
