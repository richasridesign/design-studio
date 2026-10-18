import { describe, expect, it } from 'vitest';
import { hasReview, hasSketch } from './canvasContent';

describe('hasSketch', () => {
  it('counts a sketch doc', () => expect(hasSketch({ screens: [] }, [])).toBe(true));
  it('ignores null and errors', () => {
    expect(hasSketch(null, [])).toBe(false);
    expect(hasSketch({ error: 'bad' }, null)).toBe(false);
  });
  it('counts a non-empty board', () => expect(hasSketch(null, [{ id: 'a' }])).toBe(true));
  it('ignores an empty or invalid board', () => {
    expect(hasSketch(null, [])).toBe(false);
    expect(hasSketch(null, { error: 'x' })).toBe(false);
  });
});

describe('hasReview', () => {
  it('needs at least one run', () => {
    expect(hasReview({ runs: [{ id: 'r1' }] })).toBe(true);
    expect(hasReview({ runs: [] })).toBe(false);
  });
  it('ignores bad shapes', () => {
    expect(hasReview(null)).toBe(false);
    expect(hasReview({ error: 'x' })).toBe(false);
  });
});
