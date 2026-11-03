import type { Board, Frame, Link } from './types.js';

// A board read from disk or sent by the page, cleaned before it is used or saved.

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
      ...(Array.isArray(o.clicks) && o.clicks.length ? { clicks: o.clicks.slice(0, 10).map((c) => str(c, 60)).filter(Boolean) } : {}),
      ...(o.parked === true ? { parked: true } : {}),
      ...(isFigmaLink(o.figma) ? { figma: str(o.figma, 300) } : {}),
      ...(str(o.group, 80).trim() ? { group: str(o.group, 80).trim() } : {}),
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

/** Only figma.com links are kept, so a frame's link can never open anything else. */
export const isFigmaLink = (v: unknown): v is string => typeof v === 'string' && v.length <= 300 && /^https:\/\/(www\.)?figma\.com\//.test(v);

/** "src/screens/People.tsx:12:7" into its parts, or null. */
export function parseSrc(src: string): { file: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(src);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
}
