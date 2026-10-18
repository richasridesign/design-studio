import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SKETCH_ITEMS, type SketchDirection, type SketchDoc, type SketchItem, type SketchScreen } from '../../shared/design.js';

export const SKETCH_FILE = 'sketch.json';

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = (v: unknown, fallback: string) => (str(v, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || fallback);

export function parseSketch(raw: unknown): SketchDoc {
  const doc = raw as { screens?: unknown };
  if (!doc || !Array.isArray(doc.screens) || doc.screens.length === 0) throw new Error('sketch.json needs a non-empty "screens" array');
  const screens = doc.screens.slice(0, 12).map((s: any, i): SketchScreen => {
    if (!Array.isArray(s?.directions) || s.directions.length === 0) throw new Error(`Screen ${i + 1} has no "directions"`);
    const directions = s.directions.slice(0, 4).map((d: any, j: number): SketchDirection => {
      if (!Array.isArray(d?.items)) throw new Error(`Screen ${i + 1}, direction ${j + 1} has no "items" array`);
      const w = Math.min(2000, Math.max(200, num(d.w, 390)));
      const h = Math.min(4000, Math.max(200, num(d.h, 844)));
      const items = d.items.slice(0, 200).map((it: any): SketchItem => ({
        t: SKETCH_ITEMS.includes(it?.t) ? it.t : 'box',
        x: Math.min(w, Math.max(0, num(it?.x))),
        y: Math.min(h, Math.max(0, num(it?.y))),
        w: Math.max(1, num(it?.w, 40)),
        h: Math.max(1, num(it?.h, 20)),
        label: str(it?.label, 120) || undefined,
      }));
      return { id: id(d.id, String.fromCharCode(97 + j)), name: str(d.name, 60) || `Direction ${String.fromCharCode(65 + j)}`, rationale: str(d.rationale, 300), w, h, items };
    });
    const chosen = typeof s.chosen === 'string' && directions.some((d: SketchDirection) => d.id === s.chosen) ? s.chosen : undefined;
    return { id: id(s.id, `screen-${i + 1}`), name: str(s.name, 80) || `Screen ${i + 1}`, directions, chosen, chosenBy: chosen ? (s.chosenBy === 'designer' ? 'designer' : 'claude') : undefined };
  });
  return { screens };
}

export async function readSketch(dir: string): Promise<SketchDoc | null> {
  const text = await readFile(path.join(dir, SKETCH_FILE), 'utf8').catch(() => null);
  if (!text) return null;
  return parseSketch(JSON.parse(text));
}

export async function writeSketch(dir: string, doc: SketchDoc) {
  await writeFile(path.join(dir, SKETCH_FILE), JSON.stringify(doc, null, 2));
  await renderAll(dir, doc);
}

export async function pickDirection(dir: string, screen: string, direction: string) {
  const doc = await readSketch(dir);
  const s = doc?.screens.find((x) => x.id === screen);
  if (!doc || !s || !s.directions.some((d) => d.id === direction)) throw new Error('No such sketch direction');
  s.chosen = direction;
  s.chosenBy = 'designer';
  await writeSketch(dir, doc);
  return doc;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function item(it: SketchItem) {
  const { x, y, w, h } = it;
  const label = it.label ? esc(it.label) : '';
  const text = (size: number, weight = 400, anchor: 'start' | 'middle' = 'start', fill = '#1e1e1e') =>
    label ? `<text x="${anchor === 'middle' ? x + w / 2 : x + 2}" y="${y + h / 2}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle" fill="${fill}">${label}</text>` : '';
  switch (it.t) {
    case 'text': return text(14);
    case 'heading': return text(22, 700);
    case 'note': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff3bf" stroke="#e0b100"/>${text(13, 400, 'start', '#5c4b00')}`;
    case 'button': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h / 2, 10)}" fill="#1e1e1e"/>${text(14, 600, 'middle', '#ffffff')}`;
    case 'input': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff" stroke="#868e96"/>${label ? `<text x="${x + 10}" y="${y + h / 2}" font-size="14" dominant-baseline="middle" fill="#868e96">${label}</text>` : ''}`;
    case 'image': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e9ecef" stroke="#adb5bd"/><path d="M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}" stroke="#adb5bd"/>${text(12, 400, 'middle', '#495057')}`;
    case 'icon': case 'circle': return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="#495057" stroke-width="1.5"/>`;
    case 'line': return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + (h <= 2 ? 0 : h)}" stroke="#adb5bd" stroke-width="1.5"/>`;
    default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="#495057" stroke-width="1.5"/>${text(13, 400, 'start', '#495057')}`;
  }
}

export function renderSvg(d: SketchDirection) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}" font-family="Virgil, 'Comic Sans MS', system-ui, sans-serif"><rect width="${d.w}" height="${d.h}" fill="#ffffff" stroke="#1e1e1e" stroke-width="2"/>${d.items.map(item).join('')}</svg>`;
}

export async function renderAll(dir: string, doc: SketchDoc) {
  const out = path.join(dir, 'sketches');
  await mkdir(out, { recursive: true });
  await Promise.all(doc.screens.flatMap((s) => s.directions.map((d) => writeFile(path.join(out, `${s.id}--${d.id}.svg`), renderSvg(d)))));
}

export function chosenSummary(doc: SketchDoc) {
  return doc.screens.map((s) => {
    const d = s.directions.find((x) => x.id === s.chosen) ?? s.directions[0];
    return { screen: s, direction: d, file: `sketches/${s.id}--${d.id}.svg` };
  });
}

export const BOARD_FILE = 'sketch-board.json';

export async function readBoard(dir: string): Promise<unknown[]> {
  return readFile(path.join(dir, BOARD_FILE), 'utf8').then((t) => JSON.parse(t)).then((x) => (Array.isArray(x) ? x : [])).catch(() => []);
}

export async function writeBoard(dir: string, elements: unknown) {
  if (!Array.isArray(elements)) throw new Error('Expected a list of elements');
  await writeFile(path.join(dir, BOARD_FILE), JSON.stringify(elements.slice(0, 5000)));
}

export async function boardNotes(dir: string) {
  const els = (await readBoard(dir)) as Array<{ type?: string; text?: string; isDeleted?: boolean }>;
  return els.filter((e) => e.type === 'text' && !e.isDeleted && e.text?.trim()).map((e) => e.text!.trim()).slice(0, 40);
}
