// The Canvas tab's board: frames of the prototype app (a route, a scenario and a size) placed on a plane. Saved as
// canvas/boards/<id>.json in the project. A frame never copies a screen; it points at the running app.

export type Frame = { id: string; name: string; route: string; scenario: string; x: number; y: number; w: number; h: number };
export type Board = { version: 1; name: string; frames: Frame[] };

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
export type CanvasOp = { kind: 'text'; value: string } | { kind: 'attr'; name: string; value: string | null };
export type CanvasAttr = { name: string; kind: 'string' | 'expr' | 'bool'; value?: string; raw?: string };
export type CanvasElement = { tag: string; line: number; col: number; attrs: CanvasAttr[]; text: string | null; selfClosing: boolean };

export const emptyBoard = (): Board => ({ version: 1, name: 'Main board', frames: [] });

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
    }];
  });
  return { version: 1, name: str(b.name, 120, 'Main board') || 'Main board', frames };
}

/** "src/screens/People.tsx:12:7" into its parts, or null. */
export function parseSrc(src: string): { file: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(src);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
}
