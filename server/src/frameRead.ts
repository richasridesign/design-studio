import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { FigmaError } from './figmaError.js';
import { pluginRead, type ReadDeps } from './pluginRead.js';

// Reads whole frames through the Figma plugin for Review, Crit, Copy and Build check, and rebuilds the shape the
// REST nodes endpoint gave (only the properties checkFrames, outline and textNodes read), so those stay unchanged.

/** Frames per script part: each page call walks only its own part. */
export const FRAMES_PER_PART = 3;
export const MAX_NODES = 12000;
const MAX_CHARS = 600;

export type Loaded = { id: string; document: any; components: Record<string, any> };

/**
 * Plugin API code that walks the given frames and returns a compact tree per frame. It only reads.
 * Keys: i id, n name, t type, h hidden, o opacity, f fills, s strokes, bv bound variable keys, y style ids
 * (fill, stroke, text), b box, fs font size, fw font weight, x characters, r reaction count, ra reactions
 * ([trigger, [[action type, destination, navigation]]]), m main component, lm layout mode, sp item spacing,
 * p paddings, cr corner radius, c children. Components carry their set's name, and hover targets are looked up so
 * the Code scan can compare a hover variant with the instance's own. `where` names, per id, the screen it sits in and
 * that screen's section, so a review can show "Activate · Empty state" instead of the id.
 */
export function framesScript(ids: string[], maxNodes = MAX_NODES) {
  return `const IDS = ${JSON.stringify(ids)};
const MAX_NODES = ${maxNodes};
const components = {};
const dests = new Set();
const missing = [];
let count = 0;
let truncated = false;
const r4 = (v) => Math.round(Number(v || 0) * 10000) / 10000;
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const get = (n, k) => { try { return n[k]; } catch (e) { return undefined; } };
const real = (v) => v !== undefined && v !== null && typeof v !== 'symbol';
function paints(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.map((p) => p.type === 'SOLID'
    ? ['S', r4(p.color.r), r4(p.color.g), r4(p.color.b), p.opacity === undefined ? 1 : r4(p.opacity), p.visible === false ? 0 : 1]
    : [String(p.type), p.visible === false ? 0 : 1]);
}
function textFirst(n, k, range) {
  const v = get(n, k);
  if (typeof v !== 'symbol') return v;
  try { return n[range](0, 1); } catch (e) { return undefined; }
}
async function walk(n) {
  if (count >= MAX_NODES) { truncated = true; return null; }
  count++;
  const o = { i: n.id, n: String(n.name == null ? '' : n.name).slice(0, 200), t: n.type };
  if (n.visible === false) { o.h = 1; return o; }
  const op = get(n, 'opacity');
  if (real(op) && op !== 1) o.o = r4(op);
  const text = n.type === 'TEXT';
  const f = paints(text ? textFirst(n, 'fills', 'getRangeFills') : get(n, 'fills'));
  if (f) o.f = f;
  const s = paints(get(n, 'strokes'));
  if (s) o.s = s;
  const bv = get(n, 'boundVariables');
  if (bv && typeof bv === 'object') { const k = Object.keys(bv).filter((x) => bv[x] && (!Array.isArray(bv[x]) || bv[x].length)); if (k.length) o.bv = k; }
  const fsid = get(n, 'fillStyleId'), ssid = get(n, 'strokeStyleId'), tsid = text ? textFirst(n, 'textStyleId', 'getRangeTextStyleId') : '';
  if (fsid || ssid || tsid) o.y = [fsid ? 1 : 0, ssid ? 1 : 0, tsid ? 1 : 0];
  const b = get(n, 'absoluteBoundingBox');
  if (b) o.b = [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  if (text) {
    const fs = textFirst(n, 'fontSize', 'getRangeFontSize');
    const fw = textFirst(n, 'fontWeight', 'getRangeFontWeight');
    if (real(fs)) o.fs = fs;
    if (real(fw)) o.fw = fw;
    const x = get(n, 'characters');
    if (x) o.x = String(x).slice(0, ${MAX_CHARS});
  }
  const re = get(n, 'reactions');
  if (Array.isArray(re) && re.length) {
    o.r = re.length;
    const ra = [];
    for (const x of re) {
      if (!x || !x.trigger || !x.trigger.type) continue;
      const acts = [];
      const flat = (list) => {
        for (const a of list || []) {
          if (!a || typeof a !== 'object') continue;
          if (a.type === 'CONDITIONAL') { for (const b of a.conditionalBlocks || []) flat(b && b.actions); continue; }
          acts.push([String(a.type || ''), a.destinationId || null, a.navigation || null]);
          if (a.navigation === 'CHANGE_TO' && a.destinationId) dests.add(a.destinationId);
        }
      };
      flat(x.actions || (x.action ? [x.action] : []));
      if (acts.length) ra.push([String(x.trigger.type), acts]);
    }
    if (ra.length) o.ra = ra;
  }
  if (n.type === 'INSTANCE') {
    try {
      const m = await n.getMainComponentAsync();
      if (m) {
        o.m = m.id;
        if (!components[m.id]) {
          const p = m.parent;
          const set = p && p.type === 'COMPONENT_SET' ? p : null;
          components[m.id] = { name: m.name, remote: !!m.remote, ...(set ? { componentSetId: set.id, setName: set.name } : {}) };
        }
      }
    } catch (e) {}
  }
  const lm = get(n, 'layoutMode');
  if (lm && lm !== 'NONE') {
    o.lm = lm;
    o.sp = get(n, 'itemSpacing');
    o.p = [get(n, 'paddingTop'), get(n, 'paddingRight'), get(n, 'paddingBottom'), get(n, 'paddingLeft')];
  }
  const cr = get(n, 'cornerRadius');
  if (typeof cr === 'number' && cr > 0) o.cr = cr;
  const ch = get(n, 'children');
  if (ch && ch.length) {
    const c = [];
    for (const k of ch) {
      if (count >= MAX_NODES) { truncated = true; break; }
      const w = await walk(k);
      if (w) c.push(w);
    }
    if (c.length) o.c = c;
  }
  return o;
}
const frames = [];
const where = {};
const holder = (p) => p.type === 'PAGE' || p.type === 'DOCUMENT' || p.type === 'SECTION' || (p.type === 'FRAME' && (p.children || []).some((c) => c.type === 'SECTION'));
for (const id of IDS) {
  const n = await figma.getNodeByIdAsync(id);
  if (!n || n.type === 'PAGE' || n.type === 'DOCUMENT') { missing.push(id); continue; }
  frames.push(await walk(n));
  try {
    let s = n;
    while (s.parent && !holder(s.parent)) s = s.parent;
    const p = s.parent;
    where[id] = [String(s.name == null ? '' : s.name).slice(0, 200), p && p.type !== 'PAGE' && p.type !== 'DOCUMENT' ? String(p.name == null ? '' : p.name).slice(0, 200) : ''];
  } catch (e) {}
}
for (const id of dests) {
  if (components[id]) continue;
  try {
    const d = await figma.getNodeByIdAsync(id);
    if (!d || d.type !== 'COMPONENT') continue;
    const p = d.parent;
    const set = p && p.type === 'COMPONENT_SET' ? p : null;
    components[id] = { name: d.name, remote: !!d.remote, ...(set ? { componentSetId: set.id, setName: set.name } : {}) };
  } catch (e) {}
}
return { frames, components, missing, nodes: count, truncated, where };`;
}

type Compact = { i: string; n: string; t: string; h?: 1; o?: number; f?: any[]; s?: any[]; bv?: string[]; y?: number[]; b?: number[]; fs?: number; fw?: number; x?: string; r?: number; ra?: Array<[string, Array<[string, string | null, string | null]>]>; m?: string; lm?: string; sp?: number; p?: number[]; cr?: number; c?: Compact[] };
/** `where`: per id, [screen name, section name or '']. Missing in reads made before it was added. */
export type FramesPart = { frames: Compact[]; components: Record<string, any>; missing: string[]; nodes: number; truncated: boolean; where?: Record<string, [string, string]> };

const paint = (p: any[]) => (p[0] === 'S' ? { type: 'SOLID', color: { r: p[1], g: p[2], b: p[3], a: 1 }, opacity: p[4], visible: p[5] !== 0 } : { type: p[0], visible: p[1] !== 0 });

/** Back to the REST node shape. */
export function expandFrame(c: Compact): any {
  const n: any = { id: c.i, name: c.n, type: c.t };
  if (c.h) return { ...n, visible: false };
  if (c.o !== undefined) n.opacity = c.o;
  if (c.f) n.fills = c.f.map(paint);
  if (c.s) n.strokes = c.s.map(paint);
  if (c.bv) n.boundVariables = Object.fromEntries(c.bv.map((k) => [k, true]));
  if (c.y) {
    const styles: Record<string, string> = {};
    if (c.y[0]) styles.fill = 'style';
    if (c.y[1]) styles.stroke = 'style';
    if (c.y[2]) styles.text = 'style';
    n.styles = styles;
  }
  if (c.b) n.absoluteBoundingBox = { x: c.b[0], y: c.b[1], width: c.b[2], height: c.b[3] };
  if (c.t === 'TEXT') {
    n.style = { ...(c.fs !== undefined ? { fontSize: c.fs } : {}), ...(c.fw !== undefined ? { fontWeight: c.fw } : {}) };
    n.characters = c.x ?? '';
  }
  // Plugin API reactions, so the Code scan's prototype rules read them like the Flow check does.
  if (c.ra) n.reactions = c.ra.map(([type, acts]) => ({ trigger: { type }, actions: acts.map(([t, destinationId, navigation]) => ({ type: t, destinationId, navigation })) }));
  else if (c.r) n.reactions = Array.from({ length: c.r }, () => ({}));
  if (c.m) n.componentId = c.m;
  if (c.lm) {
    n.layoutMode = c.lm;
    n.itemSpacing = c.sp;
    [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] = c.p ?? [];
  }
  if (c.cr !== undefined) n.cornerRadius = c.cr;
  if (c.c) n.children = c.c.map(expandFrame);
  return n;
}

/** Joins the parts in the order the frames were asked for. */
export function framesFromParts(ids: string[], parts: FramesPart[]) {
  const components = Object.assign({}, ...parts.map((p) => p.components ?? {}));
  const byId = new Map(parts.flatMap((p) => p.frames).map((f) => [f.i, f]));
  const docs: Loaded[] = ids.filter((id) => byId.has(id)).map((id) => ({ id, document: expandFrame(byId.get(id)!), components }));
  const where: Record<string, [string, string]> = Object.assign({}, ...parts.map((p) => p.where ?? {}));
  return { docs, names: screenNames(docs, where), missing: parts.flatMap((p) => p.missing), truncated: parts.some((p) => p.truncated), nodes: parts.reduce((n, p) => n + p.nodes, 0) };
}

/**
 * Per frame id, the name she knows it by: "Section · Screen", or the screen alone outside a section. A read without
 * `where` falls back to the frame's own name.
 */
export function screenNames(docs: Loaded[], where: Record<string, [string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of docs) {
    const [screen, section] = Array.isArray(where[d.id]) ? where[d.id] : [String(d.document?.name ?? ''), ''];
    const label = [section, screen].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(' · ');
    if (label) out[d.id] = label;
  }
  return out;
}

/** Rough wait for a read of this many frames. 6 frames with screenshots took 22 seconds on a large test file. */
export function readEstimate(frames: number, shots = true) {
  const s = 10 + Math.ceil(frames / FRAMES_PER_PART) * 4 + (shots ? frames : 0);
  return s < 60 ? `about ${Math.round(s / 5) * 5 || 5} seconds` : `about ${Math.round(s / 60)} ${Math.round(s / 60) === 1 ? 'minute' : 'minutes'}`;
}

export const readingText = (frames: number, shots = true) => `Reading ${frames === 1 ? 'the frame' : `${frames} frames`} from Figma, ${readEstimate(frames, shots)}`;

export type FrameRead = { docs: Loaded[]; shots: string[]; missing: string[]; truncated: boolean; costUsd: number; ms: number; /** Per frame id: "Section · Screen". */ names?: Record<string, string> };

const shotFile = (id: string) => `${id.replace(/[:;]/g, '-')}.png`;

/**
 * Reads frames, and when `shots` is set also screenshots them into `dir/shots.dir`, all in one plugin read.
 * Returns the shot paths relative to `dir`.
 */
export async function readFrames(fileKey: string, ids: string[], opts: { dir: string; signal?: AbortSignal; shots?: { dir: string; maxDimension: number } } & ReadDeps): Promise<FrameRead> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { docs: [], shots: [], missing: [], truncated: false, costUsd: 0, ms: 0 };
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += FRAMES_PER_PART) groups.push(unique.slice(i, i + FRAMES_PER_PART));
  const r = await pluginRead({
    fileKey,
    dir: opts.dir,
    what: `Read ${unique.length === 1 ? 'a frame' : `${unique.length} frames`} for Design Studio (read only)`,
    body: groups.map((g) => framesScript(g)),
    shots: opts.shots ? { ids: unique, maxDimension: opts.shots.maxDimension } : undefined,
    signal: opts.signal,
    key: `frames:${opts.shots?.maxDimension ?? 0}:${unique.join(',')}`,
  }, opts);
  const { docs, names, missing, truncated } = framesFromParts(unique, r.value as FramesPart[]);
  if (!docs.length) throw new FigmaError('Figma could not find those frames. They may have been deleted.', 404);
  const shots: string[] = [];
  if (opts.shots) {
    await mkdir(path.join(opts.dir, opts.shots.dir), { recursive: true });
    for (const d of docs) {
      const url = r.shots[d.id];
      if (!url) continue;
      const file = path.join(opts.shots.dir, shotFile(d.id));
      await fetchTo(url, path.join(opts.dir, file)).then(() => shots.push(file)).catch((err) => console.error('frame shot:', (err as Error).message));
    }
  }
  return { docs, names, shots, missing, truncated, costUsd: r.costUsd, ms: r.ms };
}

/** Saves a short-lived screenshot url to a file. */
export async function fetchTo(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}
