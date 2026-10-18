import { describe, expect, it } from 'vitest';
import { afterFix, afterReview, designPrompt, designerPicksKey, parseCommand, picksNote } from './flow.js';

const f = { id: 'x', area: 'system' as const, node: '1:1', severity: 'major' as const, rule: 'r', fix: 'f' };

describe('afterReview', () => {
  it('finishes when nothing needs fixing', () => expect(afterReview('full', 0, []).next).toBe('done'));
  it('fixes once for quick, then stops', () => {
    expect(afterReview('quick', 0, [f]).next).toBe('fix');
    expect(afterReview('quick', 1, [f]).next).toBe('done');
  });
  it('uses the Fix rounds setting for full and focused, three by default', () => {
    expect(afterReview('full', 2, [f]).next).toBe('fix');
    expect(afterReview('full', 3, [f]).next).toBe('done');
    expect(afterReview('focused', 1, [f], 2).next).toBe('fix');
    expect(afterReview('focused', 2, [f], 2).next).toBe('done');
  });
  it('fixes once for quick whatever the setting says', () => expect(afterReview('quick', 1, [f], 4).next).toBe('done'));
});

describe('afterFix', () => {
  it('verifies with the free check after the last fix round', () => expect(afterFix('quick', 1)).toBe('verify'));
  it('re-reviews failed areas when full has rounds left', () => expect(afterFix('full', 1)).toBe('review'));
  it('verifies after the last round of the setting', () => expect(afterFix('full', 4, 4)).toBe('verify'));
});

describe('parseCommand', () => {
  it('reads design commands', () => {
    expect(parseCommand('/design a checkout flow')).toEqual({ cmd: 'design', arg: 'a checkout flow' });
    expect(parseCommand('/review full')).toEqual({ cmd: 'review', arg: 'full' });
    expect(parseCommand('/buildcheck http://localhost:3000 1:2')).toEqual({ cmd: 'buildcheck', arg: 'http://localhost:3000 1:2' });
    expect(parseCommand('/compact')).toBeNull();
    expect(parseCommand('make it bigger')).toBeNull();
  });
});

describe('designPrompt', () => {
  it('says the version is saved for Claude and names the chosen sketch', () => {
    const sketch = { screens: [{ id: 'home', name: 'Home', chosen: 'b', directions: [
      { id: 'a', name: 'List', rationale: 'dense', w: 390, h: 844, items: [] },
      { id: 'b', name: 'Cards', rationale: 'scannable', w: 390, h: 844, items: [] },
    ] }] };
    const p = designPrompt(sketch, true, "Bob's checkout");
    expect(p).toContain('saves a version in Figma history');
    expect(p).not.toContain('saveVersionHistoryAsync');
    expect(p).toContain('sketches/home--b.svg');
    expect(p).toContain('Home: Cards. scannable');
    expect(p).toContain('Picked over List.');
  });

  it("passes on the designer's reason and the directions it was picked over", () => {
    const sketch = { screens: [{ id: 'home', name: 'Home', chosen: 'a', chosenBy: 'designer' as const, reason: 'Long lists scan faster', rejected: ['Cards', 'Map'], directions: [
      { id: 'a', name: 'List', rationale: 'dense', w: 390, h: 844, items: [] },
      { id: 'b', name: 'Cards', rationale: 'scannable', w: 390, h: 844, items: [] },
      { id: 'c', name: 'Map', rationale: 'spatial', w: 390, h: 844, items: [] },
    ] }] };
    expect(designPrompt(sketch, true, 'x')).toContain('- Home: List. dense. The designer picked it over Cards, Map. Why: Long lists scan faster.');
  });

  it('does not repeat the rationale when the designer confirmed Claude\'s pick', () => {
    const sketch = { screens: [{ id: 'home', name: 'Home', chosen: 'a', chosenBy: 'designer' as const, reason: 'dense', directions: [
      { id: 'a', name: 'List', rationale: 'dense', w: 390, h: 844, items: [] },
      { id: 'b', name: 'Cards', rationale: 'scannable', w: 390, h: 844, items: [] },
    ] }] };
    const p = designPrompt(sketch, true, 'x');
    expect(p).toContain('- Home: List. dense. The designer picked it over Cards.');
    expect(p).not.toContain('Why:');
  });
});

describe('picks after the design phase', () => {
  const dirs = [
    { id: 'a', name: 'List', rationale: 'dense', w: 390, h: 844, items: [] },
    { id: 'b', name: 'Cards', rationale: 'scannable', w: 390, h: 844, items: [] },
  ];
  const doc = (chosen: string, by: 'designer' | 'claude', reason?: string) => ({ screens: [{ id: 'home', name: 'Home', chosen, chosenBy: by, reason, directions: dirs }] });

  it("changes only with the designer's own picks and reasons", () => {
    expect(designerPicksKey(doc('a', 'claude'))).toBe(designerPicksKey(doc('b', 'claude')));
    expect(designerPicksKey(doc('a', 'designer'))).not.toBe(designerPicksKey(doc('a', 'designer', 'Long lists scan faster')));
    expect(designerPicksKey(null)).toBe('[]');
  });

  it('tells Claude the current picks with the reason', () => {
    expect(picksNote(doc('b', 'designer', 'Photos sell'))).toBe('The designer changed the sketch picks. Follow these from now on:\n- Home: Cards. scannable. The designer picked it over List. Why: Photos sell.');
    expect(picksNote(null)).toBe('');
  });
});
