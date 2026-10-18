import { describe, expect, it } from 'vitest';
import { topFramesFor } from './figma.js';

const doc = {
  children: [
    { id: '0:1', children: [{ id: '1:1', children: [{ id: '1:2', children: [{ id: '1:3' }] }] }, { id: '2:1', children: [{ id: '2:2' }] }] },
    { id: '0:2' },
  ],
};
const frames = ['1:1', '2:1'];

describe('topFramesFor', () => {
  it('maps a nested id to its top-level frame', () => {
    expect(topFramesFor(doc, frames, ['1:3'])).toEqual(['1:1']);
  });

  it('maps a top-level id to itself', () => {
    expect(topFramesFor(doc, frames, ['2:1'])).toEqual(['2:1']);
  });

  it('returns frames in frameIds order', () => {
    expect(topFramesFor(doc, frames, ['2:2', '1:2'])).toEqual(['1:1', '2:1']);
  });

  it('returns nothing for unknown ids', () => {
    expect(topFramesFor(doc, frames, ['9:9'])).toEqual([]);
  });

  it('handles pages without children', () => {
    expect(topFramesFor({ children: [{ id: '0:2' }] }, frames, ['1:1'])).toEqual([]);
    expect(topFramesFor({}, frames, ['1:1'])).toEqual([]);
  });
});
