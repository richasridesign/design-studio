import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fetchTo } from './frameRead.js';
import { SAMPLE_KEY } from './figma.js';
import { pluginScript, pluginShots, type ReadDeps } from './pluginRead.js';
import { projectRoot } from './roots.js';

// What the UI shows from a Figma file (the outline of top-level frames and thumbnails) is read through
// the plugin and kept on disk in the chat folder, so showing it never starts a Claude run. It is read again when a
// file is attached, after a run that edited the file, and when the designer asks for a refresh.

export type FrameInfo = { id: string; name: string; page: string; type: string; w: number; h: number };
export type Outline = { name: string; lastModified: string; thumbnail: string; readAt?: number; pages: Array<{ id: string; name: string; frames: FrameInfo[] }> };

export const CACHE_DIR = '.figma-cache';
const THUMB_MAX = 480;
const MAX_THUMBS = 24;

/** One cache per project (at its root), shared by every chat on the file. */
export const cacheDir = (dir: string, key: string) => path.join(projectRoot(dir), CACHE_DIR, key.replace(/[^A-Za-z0-9]/g, ''));

const SAMPLE: Outline = (() => {
  const frame = (id: string, name: string): FrameInfo => ({ id, name, page: 'Design', type: 'FRAME', w: 390, h: 844 });
  return { name: 'Grocery app (sample)', lastModified: '', thumbnail: '', pages: [{ id: '0:1', name: 'Design', frames: [frame('12:3', 'Cart'), frame('12:4', 'Empty cart')] }] };
})();

/** Top-level frames, components and sections of every page. Only reads: pages are loaded, never switched to. */
export const OUTLINE_SCRIPT = `const pages = [];
for (const page of figma.root.children) {
  await page.loadAsync();
  const frames = [];
  for (const n of page.children) {
    if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(n.type)) frames.push([n.id, String(n.name).slice(0, 200), n.type, Math.round(n.width), Math.round(n.height)]);
  }
  pages.push([page.id, String(page.name).slice(0, 200), frames]);
}
return pages;`;

type RawPages = Array<[string, string, Array<[string, string, string, number, number]>]>;

export function outlineFrom(raw: RawPages, name: string): Outline {
  return {
    name,
    lastModified: '',
    thumbnail: '',
    readAt: Date.now(),
    pages: raw.map(([id, pageName, frames]) => ({ id, name: pageName, frames: frames.map(([fid, fname, type, w, h]) => ({ id: fid, name: fname, page: pageName, type, w, h })) })),
  };
}

const fileName = (dir: string) => readFile(path.join(projectRoot(dir), 'figma.json'), 'utf8').then((t) => String(JSON.parse(t).name ?? ''), () => '');

/** The outline saved on disk, or null when it has not been read yet. */
export async function cachedOutline(dir: string, key: string): Promise<Outline | null> {
  if (key === SAMPLE_KEY) return SAMPLE;
  return readFile(path.join(cacheDir(dir, key), 'outline.json'), 'utf8').then(JSON.parse, () => null);
}

/**
 * The file outline: from disk when it is there, read through the plugin when it is not or `fresh` is set.
 * Reads of the same file share one run.
 */
export async function fileOutline(dir: string, key: string, opts: { fresh?: boolean; signal?: AbortSignal } & ReadDeps = {}): Promise<Outline> {
  if (key === SAMPLE_KEY) return SAMPLE;
  if (!opts.fresh) {
    const hit = await cachedOutline(dir, key);
    if (hit) return hit;
  }
  const r = await pluginScript<RawPages>(key, OUTLINE_SCRIPT, 'List the frames on each page (read only)', { ...opts, dir, key: 'outline' });
  const outline = outlineFrom(r.value ?? [], await fileName(dir));
  await mkdir(cacheDir(dir, key), { recursive: true });
  await writeFile(path.join(cacheDir(dir, key), 'outline.json'), JSON.stringify(outline));
  return outline;
}

/** Reads the outline again in the background, for after an attach or a run. Errors are logged, not shown. */
export function refreshOutlineSoon(dir: string, key: string, deps: ReadDeps = {}) {
  if (key === SAMPLE_KEY) return;
  fileOutline(dir, key, { ...deps, fresh: true }).catch((err) => console.error('outline refresh:', (err as Error).message));
}

/**
 * For each id, the screen it sits in: the frame whose parent is the page, a section, or a frame that holds sections.
 * A section, or a frame that holds sections, is never a screen, so touching one checks nothing. Only reads.
 */
export const containingScript = (ids: string[]) => `const out = {};
const holder = (p) => p.type === 'PAGE' || p.type === 'DOCUMENT' || p.type === 'SECTION' || (p.type === 'FRAME' && (p.children || []).some((c) => c.type === 'SECTION'));
const screen = (n) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'GROUP' || (n.type === 'INSTANCE' && n.width >= 900);
for (const id of ${JSON.stringify(ids)}) {
  let n = await figma.getNodeByIdAsync(id);
  while (n && n.parent && !holder(n.parent)) n = n.parent;
  if (n && n.parent && !holder(n) && screen(n)) out[id] = n.id;
}
return out;`;

/** Map rows: [letter, id, name, x, y, w, h, children?]. Letters as in fileMap's MAP_SCRIPT. */
type MapRow = [string, string, string, number, number, number, number, MapRow[]?, number?, ...unknown[]];

/** Screen ids in a file map: frames on a page, in a section or in a frame that holds sections. Sections are left out. */
export function mapScreens(pages: Array<[string, string, MapRow[], ...unknown[]]>): string[] {
  const out: string[] = [];
  const walk = (n: MapRow) => {
    const kids = n[7] ?? [];
    const box = n[0] === 'S' || kids.some((k) => k[0] === 'S');
    if (!box) out.push(n[1]);
    for (const k of kids) walk(k);
  };
  for (const [, , top] of pages) for (const n of top) walk(n);
  return out;
}

/**
 * The screens that hold any of the ids, in the order first touched. `screens` are known screen ids (from the file
 * map): a touched id that is one counts as itself and needs no read. Sections never count, only screens inside them.
 */
export async function framesContaining(dir: string, key: string, ids: string[], screens: string[] = [], deps: ReadDeps = {}): Promise<string[]> {
  const known = new Set(screens);
  const rest = ids.filter((id) => !known.has(id));
  const found = rest.length
    ? (await pluginScript<Record<string, string>>(key, containingScript(rest.slice(0, 50)), 'Find the frames that hold the edited layers (read only)', { ...deps, dir })).value ?? {}
    : {};
  const out = new Set<string>();
  for (const id of ids) {
    const top = known.has(id) ? id : found[id];
    if (typeof top === 'string' && top) out.add(top);
  }
  return [...out];
}

const fileFor = (id: string) => `${id.replace(/[^0-9A-Za-z]+/g, '-')}.png`;
const rel = (dir: string, file: string) => path.relative(dir, file).split(path.sep).join('/');
// Thumbnails sit in the project's cache, so the path is relative to the project root (chat-file serves both).
const servedAt = async (dir: string, file: string) => {
  const s = await stat(file).catch(() => null);
  return s ? `/api/chat-file/${rel(projectRoot(dir), file)}?v=${Math.round(s.mtimeMs)}` : null;
};

type ThumbIndex = Record<string, { rev: number; at: number }>;
const thumbRuns = new Map<string, Promise<void>>();

/**
 * Thumbnail paths (served from the chat folder) for frames. `rev` is the UI's edit count for a frame: a thumbnail
 * saved at a lower rev is taken again. Ids already being taken wait for that read instead of starting another.
 */
export async function thumbs(dir: string, key: string, want: Array<[string, number]>, deps: ReadDeps = {}): Promise<Record<string, string | null>> {
  if (key === SAMPLE_KEY || !want.length) return {};
  const base = path.join(cacheDir(dir, key), 'thumbs');
  const indexFile = path.join(base, 'index.json');
  const index: ThumbIndex = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({}));
  const list = [...new Map(want.slice(0, MAX_THUMBS)).entries()];
  const stale = list.filter(([id, rev]) => !index[id] || index[id].rev < rev).map(([id]) => id);
  const waits = stale.map((id) => thumbRuns.get(`${dir}|${key}|${id}`)).filter((p): p is Promise<void> => !!p);
  const fresh = stale.filter((id) => !thumbRuns.has(`${dir}|${key}|${id}`));
  if (fresh.length) {
    const run = (async () => {
      const urls = await pluginShots(key, fresh, THUMB_MAX, { ...deps, dir });
      await mkdir(base, { recursive: true });
      const latest: ThumbIndex = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({}));
      for (const id of fresh) {
        const url = urls[id];
        if (!url) continue;
        const ok = await fetchTo(url, path.join(base, fileFor(id))).then(() => true, () => false);
        if (ok) latest[id] = { rev: Math.max(...list.filter(([x]) => x === id).map(([, r]) => r)), at: Date.now() };
      }
      await writeFile(indexFile, JSON.stringify(latest));
    })();
    for (const id of fresh) thumbRuns.set(`${dir}|${key}|${id}`, run);
    const clear = () => { for (const id of fresh) if (thumbRuns.get(`${dir}|${key}|${id}`) === run) thumbRuns.delete(`${dir}|${key}|${id}`); };
    run.then(clear, clear);
    waits.push(run);
  }
  await Promise.all(waits.map((p) => p.catch((err) => console.error('thumbs:', (err as Error).message))));
  const out: Record<string, string | null> = {};
  for (const [id] of list) out[id] = await servedAt(dir, path.join(base, fileFor(id)));
  return out;
}
