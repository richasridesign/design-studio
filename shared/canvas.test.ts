import { describe, expect, it } from 'vitest';
import { cleanBoard, placeAfter, renumber, type Frame } from './canvas';

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
