import type { SketchDoc, SketchItem } from '../../../shared/design';

export type Skeleton = Record<string, unknown> & { type: string; x: number; y: number };

const GAP_X = 120;
const GAP_Y = 200;
const HEAD = 90;
const INK = '#1e1e1e';
const SOFT = '#868e96';

function item(it: SketchItem, ox: number, oy: number): Skeleton[] {
  const x = ox + it.x;
  const y = oy + it.y;
  const base = { x, y, width: it.w, height: it.h, strokeColor: INK, roughness: 1 };
  const label = it.label ? { text: it.label, fontSize: 16 } : undefined;
  switch (it.t) {
    case 'text':
      return it.label ? [{ type: 'text', x, y, text: it.label, fontSize: 16, strokeColor: INK }] : [];
    case 'heading':
      return it.label ? [{ type: 'text', x, y, text: it.label, fontSize: 26, strokeColor: INK }] : [];
    case 'button':
      return [{ ...base, type: 'rectangle', backgroundColor: INK, fillStyle: 'solid', roundness: { type: 3 }, label: label && { ...label, strokeColor: '#ffffff' } }];
    case 'input':
      return [{ ...base, type: 'rectangle', strokeColor: SOFT, roundness: { type: 3 }, label: label && { ...label, strokeColor: SOFT, textAlign: 'left' } }];
    case 'image':
      return [{ ...base, type: 'rectangle', backgroundColor: '#dee2e6', fillStyle: 'cross-hatch', strokeColor: SOFT, label }];
    case 'icon':
    case 'circle':
      return [{ ...base, type: 'ellipse', label }];
    case 'line':
      return [{ type: 'line', x, y, points: [[0, 0], [it.w, it.h <= 2 ? 0 : it.h]], strokeColor: SOFT }];
    case 'note':
      return [{ ...base, type: 'rectangle', backgroundColor: '#ffec99', fillStyle: 'solid', strokeColor: '#e0b100', label: label && { ...label, fontSize: 14, textAlign: 'left' } }];
    default:
      return [{ ...base, type: 'rectangle', roundness: { type: 3 }, label: label && { ...label, fontSize: 14 } }];
  }
}

export function layoutSketch(doc: SketchDoc): Skeleton[] {
  const out: Skeleton[] = [];
  let oy = 0;
  for (const s of doc.screens) {
    out.push({ type: 'text', x: 0, y: oy, text: s.name, fontSize: 36, strokeColor: INK });
    let ox = 0;
    let rowH = 0;
    for (const [i, d] of s.directions.entries()) {
      const chosen = s.chosen === d.id;
      const top = oy + HEAD;
      out.push({ type: 'text', x: ox, y: top - 44, text: `${String.fromCharCode(65 + i)} · ${d.name}${chosen ? '  ✓ chosen' : ''}`, fontSize: 20, strokeColor: chosen ? '#5b4fe0' : INK });
      out.push({ type: 'rectangle', x: ox, y: top, width: d.w, height: d.h, strokeColor: chosen ? '#5b4fe0' : INK, strokeWidth: chosen ? 4 : 2, backgroundColor: '#ffffff', fillStyle: 'solid', roughness: 0 });
      for (const it of d.items) out.push(...item(it, ox, top));
      if (d.rationale) out.push({ type: 'text', x: ox, y: top + d.h + 16, text: wrap(d.rationale, Math.max(24, Math.floor(d.w / 9))), fontSize: 16, strokeColor: SOFT });
      ox += d.w + GAP_X;
      rowH = Math.max(rowH, d.h);
    }
    oy += HEAD + rowH + GAP_Y;
  }
  return out.map((e) => ({ ...e, customData: { generated: true } }));
}

function wrap(text: string, width: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
