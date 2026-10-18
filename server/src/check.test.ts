import { describe, expect, it } from 'vitest';
import { checkFrames, contrast } from './check.js';

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 1, g: 1, b: 1, a: 1 };
const solid = (r: number, g: number, b: number) => [{ type: 'SOLID', color: { r, g, b, a: 1 } }];
const box = (w: number, h: number) => ({ x: 0, y: 0, width: w, height: h });

describe('contrast', () => {
  it('is 21 for black on white', () => expect(contrast(black, white)).toBeCloseTo(21, 0));
  it('is 1 for same colors', () => expect(contrast(white, white)).toBeCloseTo(1, 5));
});

describe('checkFrames', () => {
  const frame = (children: any[], extra = {}) => ({ document: { id: '1:1', name: 'Screen', type: 'FRAME', fills: solid(1, 1, 1), styles: { fill: 'S:1' }, absoluteBoundingBox: box(390, 844), children, ...extra }, components: {} });

  it('passes a styled, bound frame', () => {
    const text = { id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hi', style: { fontSize: 16 }, styles: { text: 'T:1' }, fills: solid(0, 0, 0), boundVariables: { fills: [{}] } };
    expect(checkFrames([frame([text])], null)).toEqual([]);
  });

  it('flags an unbound fill', () => {
    const f = checkFrames([frame([], { styles: {} })], null);
    expect(f.map((x) => x.id)).toEqual(['check:color-unbound:1:1']);
    expect(f[0].area).toBe('color');
  });

  it('flags unstyled text, small text and low contrast', () => {
    const text = { id: '1:3', name: 'Tiny', type: 'TEXT', characters: 'x', style: { fontSize: 10 }, fills: solid(0.85, 0.85, 0.85), boundVariables: { fills: [{}] } };
    const ids = checkFrames([frame([text])], null).map((x) => x.id.split(':')[1]);
    expect(ids).toEqual(['text-unstyled', 'text-too-small', 'contrast']);
  });

  it('flags small tap targets and hand-built buttons', () => {
    const btn = { id: '1:4', name: 'Button', type: 'FRAME', absoluteBoundingBox: box(80, 32), children: [] };
    const ids = checkFrames([frame([btn])], null).map((x) => x.id.split(':')[1]);
    expect(ids).toEqual(['target-size', 'hand-built']);
  });

  it('flags local components but not library ones, and skips instance internals', () => {
    const inner = { id: '1:6', name: 'label', type: 'TEXT', characters: 'Go', style: { fontSize: 14 }, fills: solid(1, 1, 1) };
    const local = { id: '1:5', name: 'Card', type: 'INSTANCE', componentId: 'C:1', absoluteBoundingBox: box(300, 100), children: [inner] };
    const lib = { id: '1:7', name: 'Card', type: 'INSTANCE', componentId: 'C:2', absoluteBoundingBox: box(300, 100), children: [] };
    const f = { ...frame([local, lib]), components: { 'C:1': { name: 'Card', remote: false }, 'C:2': { name: 'Card', remote: true } } };
    expect(checkFrames([f], null).map((x) => x.id)).toEqual(['check:local-component:1:5']);
  });

  it('flags spacing off the profile scale unless bound', () => {
    const row = { id: '1:8', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', itemSpacing: 13, paddingLeft: 16, absoluteBoundingBox: box(300, 50), children: [] };
    const boundRow = { ...row, id: '1:9', boundVariables: { itemSpacing: {} } };
    const ds = { builtAt: 0, libraries: [], colors: [], text: [], spacing: [0, 8, 16], radius: [], components: [], rules: [] };
    expect(checkFrames([frame([row, boundRow])], ds).map((x) => x.id)).toEqual(['check:spacing-off-scale:1:8']);
  });
});
