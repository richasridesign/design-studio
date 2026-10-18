import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

type ImageBlockParam = { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } };

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MEDIA = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m])) as Record<string, ImageBlockParam['source']['media_type']>;

export const refPath = (name: string) => /^refs\/[\w.-]+\.(png|jpg|webp|gif)$/.test(name);

export function refsLine(refs: string[]) {
  return refs.length ? `Reference images: ${refs.join(', ')}` : '';
}

export function withRefs(text: string, refs: string[]) {
  return refs.length ? `${text}\n\n${refsLine(refs)}` : text;
}

export function userContent(text: string, blocks: ImageBlockParam[]) {
  return blocks.length ? [...blocks, { type: 'text' as const, text }] : text;
}

export class AttachError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function sniffType(data: Buffer): string | null {
  const at = (off: number, s: string | number[]) => (typeof s === 'string' ? data.subarray(off, off + s.length).toString('latin1') === s : s.every((b, i) => data[off + i] === b));
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return null;
}

export async function saveImage(dir: string, contentType: string, data: Buffer) {
  const claimed = contentType.split(';')[0].trim().toLowerCase();
  const ext = IMAGE_EXT[claimed];
  if (!ext) throw new AttachError('Only png, jpeg, webp and gif images can be attached', 415);
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw new AttachError('Images must be 5 MB or smaller', 413);
  if (sniffType(data) !== claimed) throw new AttachError('The file content does not match its image type', 415);
  const name = `refs/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  await mkdir(path.join(dir, 'refs'), { recursive: true });
  await writeFile(path.join(dir, name), data);
  return name;
}

export type Images = { refs: string[]; blocks: ImageBlockParam[] };

export async function loadImages(dir: string, refs: unknown): Promise<Images> {
  if (!Array.isArray(refs) || !refs.length) return { refs: [], blocks: [] };
  const ok = refs.filter((r): r is string => typeof r === 'string' && refPath(r)).slice(0, MAX_IMAGES);
  const out: Images = { refs: [], blocks: [] };
  for (const r of ok) {
    const data = await readFile(path.join(dir, r)).catch(() => null);
    if (!data) continue;
    out.refs.push(r);
    out.blocks.push({ type: 'image', source: { type: 'base64', media_type: MEDIA[path.extname(r).slice(1)], data: data.toString('base64') } });
  }
  return out;
}
