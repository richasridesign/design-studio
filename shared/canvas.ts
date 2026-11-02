// The Canvas tab's board: frames of the prototype app (a route, a scenario and a size) placed on a plane. Saved as
// canvas/boards/<id>.json in the project. A frame never copies a screen; it points at the running app.

/** n is the step in a flow ("1", "3.1"), note the short text under the frame, as on her Figma flow sections. */
export type Frame = { id: string; name: string; route: string; scenario: string; x: number; y: number; w: number; h: number; n?: string; note?: string };
/** An arrow from one frame to the next, labelled with the click that leads there ("Click Open"). */
export type Link = { id: string; from: string; to: string; label: string };
export type Board = { version: 1; name: string; frames: Frame[]; links: Link[] };

export const SIZES = [
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet', w: 834, h: 1112 },
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
] as const;

export type CanvasState = 'none' | 'creating' | 'installing' | 'starting' | 'running' | 'stopped' | 'failed';
export type CanvasStatus = { state: CanvasState; step?: string; error?: string; url?: string; hasProfile?: boolean };
export type Manifest = { screens: { route: string; name: string }[]; scenarios: { id: string; name: string }[] };

/** One inspector change: the element's text, or one attribute (value null removes it). */
export type CanvasOp = { kind: 'text'; value: string } | { kind: 'attr'; name: string; value: string | null } | { kind: 'flag'; name: string; value: boolean };
export type CanvasAttr = { name: string; kind: 'string' | 'expr' | 'bool'; value?: string; raw?: string };
/** A component's props as canvas-core reads them from its file: variants, strings, numbers, switches. */
export type CanvasPropType = { kind: 'variant'; options: string[] } | { kind: 'string' } | { kind: 'number' } | { kind: 'boolean' } | { kind: 'other'; raw: string };
export type CanvasProp = { name: string; optional: boolean; type: CanvasPropType; default?: string };
export type CanvasComponent = { name: string; line: number; props: CanvasProp[] };
/** What the canvas changed in the app: uncommitted files, and this session's edits (newest first) for undo. */
export type CanvasChanges = { files: { file: string; state: 'changed' | 'new' | 'deleted'; added: number; removed: number }[]; edits: { label: string; file: string; at: number }[] };
export type CanvasElement = { tag: string; line: number; col: number; attrs: CanvasAttr[]; text: string | null; selfClosing: boolean };

export const emptyBoard = (): Board => ({ version: 1, name: 'Main board', frames: [], links: [] });

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback);
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);

/** A board read from disk or sent by the page, cleaned: unknown fields dropped, numbers clamped, routes kept local. */
export function cleanBoard(raw: unknown): Board {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const frames = (Array.isArray(b.frames) ? b.frames : []).slice(0, 200).flatMap((f): Frame[] => {
    if (!f || typeof f !== 'object') return [];
    const o = f as Record<string, unknown>;
    const route = str(o.route, 300);
    const id = str(o.id, 40);
    if (!id || !route.startsWith('/') || route.startsWith('//')) return [];
    return [{
      id,
      name: str(o.name, 120, 'Screen'),
      route,
      scenario: str(o.scenario, 60, 'default').replace(/[^\w-]/g, '') || 'default',
      x: num(o.x, -1e6, 1e6, 0),
      y: num(o.y, -1e6, 1e6, 0),
      w: num(o.w, 240, 4000, 1280),
      h: num(o.h, 240, 4000, 800),
      ...(str(o.n, 12).trim() ? { n: str(o.n, 12).trim() } : {}),
      ...(str(o.note, 600).trim() ? { note: str(o.note, 600) } : {}),
    }];
  });
  const ids = new Set(frames.map((f) => f.id));
  // An arrow whose frame was removed goes with it.
  const links = (Array.isArray(b.links) ? b.links : []).slice(0, 400).flatMap((l): Link[] => {
    const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const [id, from, to] = [str(o.id, 40), str(o.from, 40), str(o.to, 40)];
    return id && ids.has(from) && ids.has(to) && from !== to ? [{ id, from, to, label: str(o.label, 120) }] : [];
  });
  return { version: 1, name: str(b.name, 120, 'Main board') || 'Main board', frames, links };
}

/** "src/screens/People.tsx:12:7" into its parts, or null. */
export function parseSrc(src: string): { file: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(src);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
}

/** The next main step on a flow board: one more than the highest whole step. */
export function nextStep(frames: Frame[]): string {
  return String(frames.reduce((m, f) => Math.max(m, /^\d+$/.test(f.n ?? '') ? Number(f.n) : 0), 0) + 1);
}

/**
 * Steps back in order with no gaps after a frame goes: whole steps become 1, 2, 3 in their old order, and a side
 * state N.k follows its step (its own k also closes up). A side state whose step is gone becomes a whole step.
 */
export function renumber(frames: Frame[]): Frame[] {
  const key = (n: string) => n.split('.').map(Number);
  const numbered = frames.filter((f) => /^\d+(\.\d+)?$/.test(f.n ?? ''));
  const mains = numbered.filter((f) => !f.n!.includes('.') || !numbered.some((g) => g.n === f.n!.split('.')[0]));
  const order = [...new Set(mains.map((f) => key(f.n!)[0]))].sort((a, b) => a - b);
  const main = new Map(order.map((n, i) => [n, i + 1]));
  const sub = new Map<string, string>();
  for (const n of order) {
    const sides = numbered.filter((f) => f.n!.includes('.') && key(f.n!)[0] === n && numbered.some((g) => g.n === String(n))).sort((a, b) => key(a.n!)[1] - key(b.n!)[1]);
    sides.forEach((f, i) => sub.set(f.id, `${main.get(n)}.${i + 1}`));
  }
  return frames.map((f) => {
    if (!f.n || !numbered.includes(f)) return f;
    const n = sub.get(f.id) ?? String(main.get(key(f.n)[0]));
    return n === f.n ? f : { ...f, n };
  });
}

/** Where the frame after `from` goes: to its right, moved down until it covers no other frame. */
export function placeAfter(frames: Frame[], from: Frame, gap: number): { x: number; y: number } {
  const x = from.x + from.w + gap;
  let y = from.y;
  const hits = (yy: number) => frames.find((f) => f.x < x + from.w && f.x + f.w > x && f.y < yy + from.h && f.y + f.h > yy);
  for (let hit = hits(y), i = 0; hit && i < 50; hit = hits(y), i++) y = hit.y + hit.h + gap;
  return { x, y };
}
