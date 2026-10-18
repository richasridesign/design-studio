import { describe, expect, it } from 'vitest';
import { cleanDecisions, draftPrompt, isValidKey, matchDecisions, mergeDecisions, parseDecisions, stickyPrompt, wordCount, type DecisionDoc } from './decisions';

const screens = [{ id: '1:2', name: 'Home' }, { id: '1:3', name: 'Activate' }, { id: '2:1', name: 'Activate' }];

describe('wordCount', () => {
  it('counts words across parts and skips punctuation', () => {
    expect(wordCount('Show setup first.', 'Why: new admins — need it')).toBe(8);
    expect(wordCount('', '  ')).toBe(0);
  });
});

describe('parseDecisions', () => {
  it('reads headers, decision and why lines', () => {
    const text = '```\r\n**Decision 1 · Home (1:2)**\r\n**Show setup before the colleague list.**\r\nWhy: New admins need a first step.\r\n\r\nDecision 2 · Home\r\nKeep one prompt.\r\n```';
    expect(parseDecisions(text)).toEqual([
      { n: 1, screen: 'Home', id: '1:2', decision: 'Show setup before the colleague list.', why: 'New admins need a first step.' },
      { n: 2, screen: 'Home', id: undefined, decision: 'Keep one prompt.', why: '' },
    ]);
  });
  it('accepts other separators, list markers and dashed node ids', () => {
    const [a] = parseDecisions('- Decision 2 - Activate (12-34)\n- Decision: Ask once.\n- Why: Less friction\nfor admins.');
    expect(a).toEqual({ n: 2, screen: 'Activate', id: '12:34', decision: 'Ask once.', why: 'Less friction for admins.' });
  });
  it('ignores text before the first header and empty entries', () => {
    expect(parseDecisions('Here you go\nDecision 1 · Home\n\nDecision 3 · Home\nx')).toEqual([]);
  });
});

describe('matchDecisions', () => {
  it('matches by id first, then by a unique name', () => {
    const parsed = parseDecisions('Decision 1 · Activate (2:1)\nA\nDecision 1 · home\nB\nDecision 2 · Activate\nC\nDecision 1 · Gone\nD');
    const { matched, unmatched } = matchDecisions(parsed, screens);
    expect(matched.map((m) => m.id)).toEqual(['2:1', '1:2']);
    expect(unmatched).toEqual(['Activate', 'Gone']);
  });
});

describe('mergeDecisions', () => {
  const base: DecisionDoc = { '1:2': { name: 'Home', items: [{ decision: 'Old', why: 'Kept' }, { decision: '', why: '' }] } };
  it('overwrites only the fields that came back', () => {
    const out = mergeDecisions(base, [{ n: 1, screen: 'Home', id: '1:2', decision: 'New', why: '' }, { n: 2, screen: 'Home', id: '1:2', decision: 'Two', why: 'Because' }]);
    expect(out['1:2'].items).toEqual([{ decision: 'New', why: 'Kept' }, { decision: 'Two', why: 'Because' }]);
    expect(base['1:2'].items[0].decision).toBe('Old');
  });
  it('uses the frame name when given', () => {
    expect(mergeDecisions({}, [{ n: 1, screen: 'home', id: '1:2', decision: 'A', why: '' }], { '1:2': 'Home' })['1:2'].name).toBe('Home');
  });
});

describe('cleanDecisions', () => {
  it('drops bad ids, empty pairs and non-objects, and caps text', () => {
    const out = cleanDecisions({ '../x': { items: [{ decision: 'a' }] }, '1:2': { name: 'Home', items: [{ decision: 'x'.repeat(500), why: 3 }] }, '1:3': { items: [] }, '1:4': 'no' });
    expect(Object.keys(out)).toEqual(['1:2']);
    expect(out['1:2'].items[0].decision).toHaveLength(400);
    expect(out['1:2'].items[1]).toEqual({ decision: '', why: '' });
    expect(cleanDecisions([1, 2])).toEqual({});
  });
  it('validates file keys', () => {
    expect(isValidKey('AbCdEf123456')).toBe(true);
    expect(isValidKey('../etc')).toBe(false);
  });
});

describe('prompts', () => {
  it('lists only screens that still need decisions, with ids and links', () => {
    const doc: DecisionDoc = { '1:2': { name: 'Home', items: [{ decision: 'a', why: 'b' }, { decision: 'c', why: 'd' }] } };
    const p = draftPrompt('KEY123', screens, doc);
    expect(p).toContain('- Activate (1:3): https://www.figma.com/design/KEY123?node-id=1-3');
    expect(p).not.toContain('- Home (1:2)');
    expect(p).toContain('Decision 1 · <screen name> (<node id>)');
    expect(p).not.toContain('—');
  });
  it('puts the sticky text verbatim with 96px and one height', () => {
    const p = stickyPrompt('KEY123', screens[0], [{ decision: 'Show setup first.', why: 'New admins.' }, { decision: 'One prompt.', why: 'Focus.' }]);
    expect(p).toContain('96px');
    expect(p).toContain('one height');
    expect(p).toContain('Decision 2 · Home\nOne prompt.\nWhy: Focus.');
  });
});
