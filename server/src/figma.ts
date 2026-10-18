import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { parseFigmaUrl, type FigmaFile } from '../../shared/design.js';
import { CHATS_ROOT, settings } from './settings.js';

const API = 'https://api.figma.com/v1';
const SKILLS = fileURLToPath(new URL('../../skills', import.meta.url));

export class FigmaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function figmaGet<T = any>(route: string, init: RequestInit = {}): Promise<T> {
  const { figmaToken } = await settings();
  if (!figmaToken) throw new FigmaError('No Figma personal access token is saved. Add one in Settings, under Figma access.', 412);
  const res = await fetch(`${API}${route}`, { ...init, headers: { 'X-Figma-Token': figmaToken, 'content-type': 'application/json', ...init.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = body?.err ?? body?.message ?? res.statusText;
    if (res.status === 403) throw new FigmaError(`Figma refused the request (${why}). Check the token and its scopes.`, 403);
    if (res.status === 404) throw new FigmaError('Figma file not found, or the token cannot open it', 404);
    if (res.status === 429) throw new FigmaError('Figma rate limit reached, try again in a minute', 429);
    throw new FigmaError(`Figma API error ${res.status}: ${why}`, res.status);
  }
  return body as T;
}

export const SAMPLE_KEY = 'sample';

export type FrameInfo = { id: string; name: string; page: string; type: string; w: number; h: number };

export type Outline = { name: string; lastModified: string; thumbnail: string; pages: Array<{ id: string; name: string; frames: FrameInfo[] }> };

export async function fileOutline(key: string): Promise<Outline> {
  if (key === SAMPLE_KEY) {
    const frame = (id: string, name: string): FrameInfo => ({ id, name, page: 'Design', type: 'FRAME', w: 390, h: 844 });
    return { name: 'Grocery app (sample)', lastModified: '', thumbnail: '', pages: [{ id: '0:1', name: 'Design', frames: [frame('12:3', 'Cart'), frame('12:4', 'Empty cart')] }] };
  }
  const f = await figmaGet<any>(`/files/${key}?depth=2`);
  const pages = (f.document?.children ?? []).map((p: any) => ({
    id: p.id as string,
    name: p.name as string,
    frames: (p.children ?? [])
      .filter((n: any) => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(n.type))
      .map((n: any): FrameInfo => ({ id: n.id, name: n.name, page: p.name, type: n.type, w: Math.round(n.absoluteBoundingBox?.width ?? 0), h: Math.round(n.absoluteBoundingBox?.height ?? 0) })),
  }));
  return { name: f.name as string, lastModified: f.lastModified as string, thumbnail: f.thumbnailUrl as string, pages };
}

const holds = (n: any, ids: string[]): boolean => ids.includes(n.id) || (n.children ?? []).some((c: any) => holds(c, ids));

export function topFramesFor(doc: any, frameIds: string[], ids: string[]): string[] {
  const tops = (doc?.children ?? []).flatMap((p: any) => p.children ?? []);
  return frameIds.filter((id) => tops.some((n: any) => n.id === id && holds(n, ids)));
}

export async function framesContaining(key: string, frameIds: string[], ids: string[]): Promise<string[]> {
  if (ids.every((id) => frameIds.includes(id))) return frameIds.filter((f) => ids.includes(f));
  const f = await figmaGet<any>(`/files/${key}?ids=${encodeURIComponent(ids.slice(0, 50).join(','))}`);
  return topFramesFor(f.document, frameIds, ids);
}

const imageCache = new Map<string, { at: number; urls: Record<string, string | null> }>();

export async function images(key: string, ids: string[], scale = 0.5, format: 'png' | 'jpg' = 'png', version?: string, fresh = false) {
  const want = [...new Set(ids)].slice(0, 100);
  if (!want.length || key === SAMPLE_KEY) return {};
  const cacheKey = `${key}:${scale}:${format}:${version ?? ''}:${want.join(',')}`;
  const hit = imageCache.get(cacheKey);
  if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.urls;
  const r = await figmaGet<{ images: Record<string, string | null> }>(`/images/${key}?ids=${encodeURIComponent(want.join(','))}&scale=${scale}&format=${format}${version ? `&version=${encodeURIComponent(version)}` : ''}`);
  imageCache.set(cacheKey, { at: Date.now(), urls: r.images });
  return r.images;
}

export const VERSION_PREFIX = 'Design Studio';

export type FigmaVersion = { id: string; at: string; label: string; description: string; user: string; checkpoint: boolean };

export function mapVersions(raw: any[]): FigmaVersion[] {
  return raw
    .map((v): FigmaVersion => {
      const label = v.label ?? '';
      const description = v.description ?? '';
      return { id: String(v.id), at: v.created_at, label, description, user: v.user?.handle ?? 'Unknown', checkpoint: label.startsWith(VERSION_PREFIX) || description.startsWith(VERSION_PREFIX) };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function versions(key: string) {
  if (key === SAMPLE_KEY) return [];
  const r = await figmaGet<{ versions: any[] }>(`/files/${key}/versions`);
  return mapVersions(r.versions ?? []);
}

export async function nodes(key: string, ids: string[]) {
  if (key === SAMPLE_KEY) return { name: 'Grocery app (sample)', nodes: {} };
  return figmaGet<{ name: string; nodes: Record<string, { document: any; components: Record<string, any>; componentSets?: Record<string, any>; styles: Record<string, any> } | null> }>(
    `/files/${key}/nodes?ids=${encodeURIComponent(ids.join(','))}`,
  );
}

export async function postComment(key: string, message: string, nodeId?: string) {
  if (key === SAMPLE_KEY) return {};
  const body: Record<string, unknown> = { message };
  if (nodeId) body.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } };
  return figmaGet(`/files/${key}/comments`, { method: 'POST', body: JSON.stringify(body) });
}

export type CommentUser = { handle: string; img_url: string };
export type CommentReply = { id: string; message: string; user: CommentUser; created_at: string };
export type CommentThread = CommentReply & { resolved_at: string | null; nodeId: string | null; replies: CommentReply[] };

export function flattenComments(raw: any[]): CommentThread[] {
  const user = (c: any): CommentUser => ({ handle: c.user?.handle ?? 'Unknown', img_url: c.user?.img_url ?? '' });
  const reply = (c: any): CommentReply => ({ id: c.id, message: c.message ?? '', user: user(c), created_at: c.created_at });
  const byTime = (a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at);
  const roots = raw.filter((c) => !c.parent_id);
  const threads = roots.map((c): CommentThread => ({
    ...reply(c),
    resolved_at: c.resolved_at ?? null,
    nodeId: c.client_meta?.node_id ?? null,
    replies: raw.filter((r) => r.parent_id === c.id).map(reply).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
  return threads.sort((a, b) => Number(!!a.resolved_at) - Number(!!b.resolved_at) || byTime(a, b));
}

export async function listComments(key: string) {
  if (key === SAMPLE_KEY) return [];
  const r = await figmaGet<{ comments: any[] }>(`/files/${key}/comments?as_md=true`);
  return flattenComments(r.comments ?? []);
}

export async function replyComment(key: string, commentId: string, message: string) {
  if (key === SAMPLE_KEY) return {};
  return figmaGet(`/files/${key}/comments`, { method: 'POST', body: JSON.stringify({ message, comment_id: commentId }) });
}

export async function teamProjects(teamId: string) {
  return (await figmaGet<{ projects: Array<{ id: string; name: string }> }>(`/teams/${teamId}/projects`)).projects;
}

export async function projectFiles(projectId: string) {
  return (await figmaGet<{ files: Array<{ key: string; name: string; thumbnail_url: string; last_modified: string }> }>(`/projects/${projectId}/files`)).files;
}

export async function me() {
  return figmaGet<{ id: string; handle: string; email: string; img_url: string }>('/me');
}

export async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

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

async function lookupName(key: string) {
  try {
    return (await figmaGet<{ name: string }>(`/files/${key}?depth=1`)).name;
  } catch (err) {
    if (err instanceof FigmaError && err.status === 412) throw err;
    throw new FigmaError(`Could not open the file: ${(err as Error).message}`);
  }
}

const figmaFile = (key: string, name: string): FigmaFile => ({ key, name, url: `https://www.figma.com/design/${key}` });

export async function folderFor(url: string) {
  const parsed = parseUrl(url);
  const existing = (await chatFolders()).find((f) => f.figma?.key === parsed.key);
  if (existing) {
    await installSkills(existing.dir);
    return existing.dir;
  }
  const name = await lookupName(parsed.key);
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
  const figma = figmaFile(parsed.key, await lookupName(parsed.key));
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify(figma, null, 2));
  return figma;
}
