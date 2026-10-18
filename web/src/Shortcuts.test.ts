import { describe, expect, it } from 'vitest';
import { pagesFor } from './Shortcuts';

describe('pagesFor', () => {
  it('maps Cmd+1 to 4 to Figma, Sketch, Review and Decisions, and Cmd+, to Settings', () => {
    expect(pagesFor(false).map((p) => [p.key, p.label])).toEqual([['1', 'Figma'], ['2', 'Sketch'], ['3', 'Review'], ['4', 'Decisions'], [',', 'Settings']]);
  });

  it('adds Preview only with Developer tools on', () => {
    expect(pagesFor(true).find((p) => p.page === 'preview')?.key).toBe('5');
  });
});
