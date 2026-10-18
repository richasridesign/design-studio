import { describe, expect, it } from 'vitest';
import { allRules, parseRules, ruleResults, rulesLine } from './rules.js';

describe('parseRules', () => {
  it('takes one rule per line and strips bullets', () => {
    expect(parseRules('- No drop shadows\n* Use an 8px grid\n+ Plain words\n• Light mode only\n1. Sentence case\n2) One primary button')).toEqual([
      'No drop shadows', 'Use an 8px grid', 'Plain words', 'Light mode only', 'Sentence case', 'One primary button',
    ]);
  });
  it('skips blank lines, headings and repeats', () => {
    expect(parseRules('# Writing\r\n\r\n  - No em dashes  \n\n## Layout\n- No em dashes\n- [ ] 4px grid\n- [x] Done item')).toEqual(['No em dashes', '4px grid', 'Done item']);
  });
  it('keeps numbers that are part of the rule', () => {
    expect(parseRules('12px minimum text\n4px grid')).toEqual(['12px minimum text', '4px grid']);
  });
  it('is empty for empty text', () => expect(parseRules('  \n\n')).toEqual([]));
  it('joins all files then this file without repeats', () => {
    expect(allRules({ global: '- A\n- B', file: '- B\n- C' })).toEqual(['A', 'B', 'C']);
  });
});

describe('ruleResults', () => {
  const rules = ['No shadows', '4px grid', 'Sentence case'];
  const frames = ['12:3', '12:4'];
  it('maps verdicts by number and keeps rule order', () => {
    const r = ruleResults(rules, [{ n: 3, state: 'pass', frames: [] }, { n: 1, state: 'fail', frames: ['12-3', '12:3', '99:1', 'Home'] }], frames);
    expect(r).toEqual([
      { rule: 'No shadows', state: 'fail', frames: ['12:3'] },
      { rule: '4px grid', state: 'unchecked', frames: [] },
      { rule: 'Sentence case', state: 'pass', frames: [] },
    ]);
  });
  it('drops bad numbers, unknown states and repeats', () => {
    const r = ruleResults(rules, [{ n: 0, state: 'pass' }, { n: 4, state: 'fail' }, { n: 2, state: 'unclear' }, { n: 1, state: 'pass' }, { n: 1, state: 'fail', frames: ['12:4'] }], frames);
    expect(r.map((x) => x.state)).toEqual(['pass', 'unchecked', 'unchecked']);
  });
  it('marks everything not checked without a result', () => {
    expect(ruleResults(rules, undefined, frames).every((x) => x.state === 'unchecked')).toBe(true);
  });
  it('writes the summary line', () => {
    expect(rulesLine(ruleResults(rules, [{ n: 1, state: 'pass' }, { n: 2, state: 'pass' }, { n: 3, state: 'fail' }], frames))).toBe('2 of 3 passed');
    expect(rulesLine(ruleResults(rules, [{ n: 1, state: 'pass' }], frames))).toBe('1 of 3 passed, 2 not checked');
  });
});
