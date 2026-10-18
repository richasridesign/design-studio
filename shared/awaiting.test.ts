import { describe, expect, it } from 'vitest';
import { addFindings, addQuestions, answerPrompt, approvePrompt, awaitKey, cleanAwaiting, decide, stillAwaiting } from './awaiting';
import type { Finding } from './design';

const f = (rule: string, decide?: string): Finding => ({ id: rule, area: 'system', node: '1:2', nodeName: 'Home', severity: 'major', rule, fix: 'Darken text/muted to #5B5B5B', ...(decide ? { decide } : {}) });
const file = { key: 'KEY', name: 'Atlas' };

describe('awaiting your decision', () => {
  it('adds only findings that need a decision, once per file and problem', () => {
    let list = addFindings([], [f('Muted text fails contrast', 'text/muted token, about 70 layers'), f('Card is shorter')], file, 1);
    expect(list.map((x) => [x.rule, x.impact, x.state, x.fileName])).toEqual([['Muted text fails contrast', 'text/muted token, about 70 layers', 'open', 'Atlas']]);
    list = addFindings(list, [f('Muted text fails contrast', 'text/muted, 72 layers')], file, 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ impact: 'text/muted, 72 layers', at: 1 });
  });

  it('keeps a decision when the same finding comes back', () => {
    const list = decide(addFindings([], [f('Muted text fails contrast', 'token')], file, 1), awaitKey('KEY', f('Muted text fails contrast')), 'parked', 5);
    expect(list[0]).toMatchObject({ state: 'parked', decidedAt: 5 });
    expect(addFindings(list, [f('Muted text fails contrast', 'token')], file, 9)[0].state).toBe('parked');
    expect(decide(list, list[0].id, 'open')[0].decidedAt).toBeUndefined();
  });

  it('drops broken rows from the file', () => {
    expect(cleanAwaiting([{ id: 'a', at: 1, rule: 'r', state: 'open' }, { id: 'b', at: 1, rule: 'r', state: 'odd' }, null, { rule: 'r' }]).map((x) => x.id)).toEqual(['a']);
    expect(cleanAwaiting('nope')).toEqual([]);
  });

  it('asks for a plan first in the approval prompt', () => {
    const text = approvePrompt({ rule: 'Muted text fails contrast.', fix: 'Darken it', impact: 'text/muted token', node: '1:2', nodeName: 'Home' }, 'https://figma.com/x');
    expect(text).toContain('I approved it: Muted text fails contrast.');
    expect(text).toContain('wait for my go');
    expect(text).not.toContain('—');
  });
});

describe('stillAwaiting', () => {
  it('counts the run findings that are still open on the list', () => {
    const file = { key: 'KEY', name: 'Atlas' };
    const fs = [f('Muted text fails contrast', 'token'), f('Loose dialog', 'main component'), f('13px text')];
    const list = addFindings([], fs, file, 1);
    expect(stillAwaiting(fs, 'KEY', list)).toBe(2);
    expect(stillAwaiting(fs, 'KEY', decide(list, list[0].id, 'parked', 2))).toBe(1);
    expect(stillAwaiting(fs, undefined, null)).toBe(2);
  });
});

describe('long run questions', () => {
  it('adds each question once, with its node and file name only for this file', () => {
    const items = [{ text: 'Move the toast? Left it.', fileKey: 'KEY', node: '1:2' }, { text: 'Other file question', fileKey: 'OTHER', node: '' }];
    const list = addQuestions([], items, { key: 'KEY', name: 'Checkout' }, 5);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ area: 'long_run', node: '1:2', fileName: 'Checkout', state: 'open', fix: '' });
    expect(list[1].fileName).toBe('');
    expect(addQuestions(list, items, { key: 'KEY', name: 'Checkout' }, 6)).toHaveLength(2);
    expect(cleanAwaiting(JSON.parse(JSON.stringify(list)))[0].area).toBe('long_run');
  });
  it('answers in plain text without the link markup', () => {
    expect(answerPrompt('Keep [Toast](https://x) on top?')).toBe('About "Keep Toast on top?": ');
  });
});
