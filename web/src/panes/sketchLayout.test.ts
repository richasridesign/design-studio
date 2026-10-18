import { describe, expect, it } from 'vitest';
import { layoutSketch } from './sketchLayout';

describe('layoutSketch', () => {
  const doc = { screens: [{ id: 'home', name: 'Home', chosen: 'b', directions: [
    { id: 'a', name: 'List', rationale: 'dense', w: 390, h: 844, items: [{ t: 'button' as const, x: 24, y: 700, w: 342, h: 48, label: 'Pay' }] },
    { id: 'b', name: 'Cards', rationale: 'scannable', w: 390, h: 844, items: [] },
  ] }] };

  it('places directions side by side and offsets items', () => {
    const els = layoutSketch(doc);
    const frames = els.filter((e) => e.type === 'rectangle' && e.width === 390);
    expect(frames.map((f) => f.x)).toEqual([0, 510]);
    const btn = els.find((e) => (e.label as { text?: string } | undefined)?.text === 'Pay')!;
    expect([btn.x, btn.y]).toEqual([24, 90 + 700]);
  });

  it('marks the chosen direction and tags everything as generated', () => {
    const els = layoutSketch(doc);
    expect(els.some((e) => e.type === 'text' && String(e.text).includes('Cards  ✓ chosen'))).toBe(true);
    expect(els.every((e) => (e.customData as { generated: boolean }).generated)).toBe(true);
  });
});
