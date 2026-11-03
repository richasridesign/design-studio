import { describe, expect, it } from 'vitest';
import { cleanBoard, nextSide, park, placeAfter, renumber, sections, tidy, type Frame } from './index.js';

const f = (id: string, n?: string, x = 0, y = 0): Frame => ({ id, name: id, route: '/', scenario: 'default', x, y, w: 100, h: 100, ...(n ? { n } : {}) });

describe('flow steps', () => {
  it('closes gaps and keeps side states with their step', () => {
    const out = renumber([f('a', '1'), f('c', '3'), f('c1', '3.2'), f('c2', '3.4'), f('d', '4'), f('x')]);
    expect(out.map((x) => `${x.id}:${x.n ?? '-'}`)).toEqual(['a:1', 'c:2', 'c1:2.1', 'c2:2.2', 'd:3', 'x:-']);
  });

  it('turns an orphan side state into a step', () => {
    expect(renumber([f('a', '1'), f('b1', '2.1')]).map((x) => x.n)).toEqual(['1', '2']);
  });

  it('places the next frame to the right, below anything in the way', () => {
    expect(placeAfter([f('a', '1'), f('b', '2', 180, 0)], f('a', '1'), 80)).toEqual({ x: 180, y: 180 });
  });

  it('drops arrows whose frames are gone', () => {
    const b = cleanBoard({ frames: [f('a'), f('b')], links: [{ id: 'l1', from: 'a', to: 'b', label: 'Click Open' }, { id: 'l2', from: 'a', to: 'gone', label: '' }] });
    expect(b.links.map((l) => l.id)).toEqual(['l1']);
  });
});

describe('flow layout', () => {
  it('puts steps in a row, side states under their step and parked frames below', () => {
    const out = tidy([f('c', '2'), f('a', '1'), f('a1', '1.1'), f('p', '3'), f('x'), { ...f('old'), parked: true }], 20, 30);
    const pos = Object.fromEntries(out.map((o) => [o.id, `${o.x},${o.y}`]));
    expect(pos).toEqual({ a: '0,0', a1: '0,130', c: '120,0', p: '240,0', x: '360,0', old: '0,380' });
  });

  it('lays each section out as a band, in the order the sections sit', () => {
    const g = (id: string, group: string, y: number): Frame => ({ ...f(id, undefined, 0, y), group });
    const out = tidy([g('e1', 'Empty', 900), g('h1', 'Happy', 0), g('h2', 'Happy', 50), g('e2', 'Empty', 900)], 20, 30);
    expect(Object.fromEntries(out.map((o) => [o.id, `${o.x},${o.y}`]))).toEqual({ h1: '0,0', h2: '120,0', e1: '0,330', e2: '120,330' });
    expect(sections(out).map((s) => [s.name, s.y])).toEqual([['Happy', -120], ['Empty', 210]]);
  });

  it('numbers side states after the last one of their step', () => {
    expect(nextSide([f('a', '3'), f('b', '3.1'), f('c', '4.1')], '3')).toBe('3.2');
    expect(nextSide([f('a', '3')], '3.4')).toBe('3.1');
  });

  it('keeps only figma.com links', () => {
    const b = cleanBoard({ frames: [{ ...f('a'), figma: 'https://www.figma.com/design/KEY/x?node-id=1-2' }, { ...f('b'), figma: 'javascript:alert(1)' }] });
    expect(b.frames.map((x) => x.figma)).toEqual(['https://www.figma.com/design/KEY/x?node-id=1-2', undefined]);
  });
  it('parks a step with its side states and closes up the steps', () => {
    const out = park([f('a', '1'), f('d', '1.1'), f('b', '2'), f('c', '3')], 'a', true);
    expect(out.map((x) => [x.id, x.n ?? null, !!x.parked])).toEqual([['a', null, true], ['d', null, true], ['b', '1', false], ['c', '2', false]]);
    expect(park(out, 'a', false).find((x) => x.id === 'a')).toMatchObject({ n: '3', parked: undefined });
  });
});
