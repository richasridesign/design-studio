import { stepKey } from './flow.js';
import type { Frame } from './types.js';

// Where frames sit on the board. Frames with the same group sit in one section, drawn as a box with its name above,
// like the sections of her Figma flows ("Happy path", "Empty", "Error"); parked frames are the "Tried options"
// section. Tidy lays every section out as one band, the bands stacked in their current order.

export const TRIED = 'Tried options';
/** Room around a section's frames: the frame names above, the notes below. */
export const SECTION_PAD = { side: 80, top: 120, bottom: 80, note: 360 };

export type Section = { name: string; ids: string[]; x: number; y: number; w: number; h: number };

/** The section a frame sits in; '' for none. */
export const groupOf = (f: Frame) => (f.parked ? TRIED : f.group ?? '');

/** Where the frame after `from` goes: to its right, moved down until it covers no other frame. */
export function placeAfter(frames: Frame[], from: Frame, gap: number): { x: number; y: number } {
  const x = from.x + from.w + gap;
  let y = from.y;
  const hits = (yy: number) => frames.find((f) => f.x < x + from.w && f.x + f.w > x && f.y < yy + from.h && f.y + f.h > yy);
  for (let hit = hits(y), i = 0; hit && i < 50; hit = hits(y), i++) y = hit.y + hit.h + gap;
  return { x, y };
}

/** Where a side state of `from` goes: under it (and its note), moved down until it covers no other frame. */
export function placeBelow(frames: Frame[], from: Frame, gap: number): { x: number; y: number } {
  const x = from.x;
  const room = (f: Frame) => f.h + (f.note ? SECTION_PAD.note : 0);
  let y = from.y + room(from) + gap;
  const hits = (yy: number) => frames.find((f) => f.x < x + from.w && f.x + f.w > x && f.y < yy + from.h && f.y + room(f) > yy);
  for (let hit = hits(y), i = 0; hit && i < 50; hit = hits(y), i++) y = hit.y + room(hit) + gap;
  return { x, y };
}

/** The box of each named section around its frames, in the order the sections sit from top to bottom. */
export function sections(frames: Frame[]): Section[] {
  const by = new Map<string, Frame[]>();
  for (const f of frames) {
    const g = groupOf(f);
    if (g) by.set(g, [...(by.get(g) ?? []), f]);
  }
  return [...by].map(([name, fs]) => {
    const x = Math.min(...fs.map((f) => f.x)) - SECTION_PAD.side;
    const y = Math.min(...fs.map((f) => f.y)) - SECTION_PAD.top;
    const bottom = Math.max(...fs.map((f) => f.y + f.h + (f.note ? SECTION_PAD.note : 0))) + SECTION_PAD.bottom;
    return { name, ids: fs.map((f) => f.id), x, y, w: Math.max(...fs.map((f) => f.x + f.w)) + SECTION_PAD.side - x, h: bottom - y };
  }).sort((a, b) => (a.name === TRIED ? 1 : b.name === TRIED ? -1 : a.y - b.y || a.x - b.x));
}

/** One band: whole steps in a row in step order, each side state in a column under its step, the rest after. */
function band(frames: Frame[], gapX: number, gapY: number): { at: Map<string, { x: number; y: number }>; h: number } {
  const cols: Frame[][] = [];
  const sorted = [...frames].sort((a, b) => { const [x, y] = [stepKey(a.n), stepKey(b.n)]; return x[0] - y[0] || x[1] - y[1] || a.x - b.x; });
  for (const f of sorted) {
    const [main, side] = stepKey(f.n);
    const col = side && main !== Infinity ? cols.find((c) => stepKey(c[0].n)[0] === main) : undefined;
    if (col) col.push(f); else cols.push([f]);
  }
  const at = new Map<string, { x: number; y: number }>();
  let x = 0;
  let h = 0;
  for (const col of cols) {
    let y = 0;
    for (const f of col) { at.set(f.id, { x, y }); y += f.h + gapY + (f.note ? SECTION_PAD.note : 0); }
    h = Math.max(h, y - gapY);
    x += Math.max(...col.map((f) => f.w)) + gapX;
  }
  return { at, h };
}

/**
 * Lays the board out like her Figma flow sections: frames with no section first, then each section as a band in the
 * order the sections sit now, tried options last. Within a band, steps run in order with side states under them.
 */
export function tidy(frames: Frame[], gapX = 240, gapY = 320): Frame[] {
  const loose = frames.filter((f) => !groupOf(f));
  const groups = [...(loose.length ? [loose] : []), ...sections(frames).map((s) => frames.filter((f) => s.ids.includes(f.id)))];
  const at = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const fs of groups) {
    const named = !!groupOf(fs[0]);
    if (named && at.size) y += SECTION_PAD.top;
    const b = band(fs, gapX, gapY);
    for (const [id, p] of b.at) at.set(id, { x: p.x, y: y + p.y });
    y += b.h + gapY + (named ? SECTION_PAD.bottom : 0);
  }
  return frames.map((f) => ({ ...f, ...at.get(f.id)! }));
}
