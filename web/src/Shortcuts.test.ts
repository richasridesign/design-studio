import { describe, expect, it } from 'vitest';
import { pagesFor } from './Shortcuts';

describe('pagesFor', () => {
  it('maps Cmd+1 to 3 to Figma, Review and History, and Cmd+, to Settings', () => {
    expect(pagesFor(false).map((p) => [p.key, p.label])).toEqual([['1', 'Figma'], ['2', 'Review'], ['3', 'History'], [',', 'Settings']]);
  });

  it('adds Preview only with Developer tools on', () => {
    expect(pagesFor(true).find((p) => p.page === 'preview')?.key).toBe('4');
  });
});
