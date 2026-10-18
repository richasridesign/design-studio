import { describe, expect, it } from 'vitest';
import { cleanRecipes } from './recipes.js';

const ok = { id: 'a', title: 'Title', blurb: 'Blurb', prompt: 'Do it', group: 'ship' };

describe('cleanRecipes', () => {
  it('returns an empty list for non arrays', () => {
    expect(cleanRecipes(null)).toEqual([]);
    expect(cleanRecipes({})).toEqual([]);
  });
  it('keeps valid recipes', () => expect(cleanRecipes([ok])).toEqual([ok]));
  it('drops entries without a title or prompt', () => {
    expect(cleanRecipes([{ ...ok, title: ' ' }, { ...ok, prompt: '' }, 5, null])).toEqual([]);
  });
  it('clamps field sizes', () => {
    const [r] = cleanRecipes([{ ...ok, title: 'x'.repeat(100), blurb: 'y'.repeat(300), prompt: 'z'.repeat(5000) }]);
    expect([r.title.length, r.blurb.length, r.prompt.length]).toEqual([60, 140, 4000]);
  });
  it('falls back to make for an unknown group', () => {
    expect(cleanRecipes([{ ...ok, group: 'nope' }])[0].group).toBe('make');
  });
  it('limits to 50 and makes ids unique', () => {
    const list = cleanRecipes(Array.from({ length: 60 }, () => ok));
    expect(list).toHaveLength(50);
    expect(new Set(list.map((r) => r.id)).size).toBe(50);
  });
  it('assigns an id when missing', () => {
    expect(cleanRecipes([{ ...ok, id: undefined }])[0].id).toMatch(/^custom-/);
  });
});
