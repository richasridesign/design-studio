import { describe, expect, it } from 'vitest';
import { MAX_AWAIT, addFindings, addQuestions, answerPrompt, approvePrompt, awaitKey, awaitState, capAwaiting, cleanAwaiting, decide, openCount, sentFor, sentKey, stillAwaiting, type AwaitItem } from './awaiting';
import type { Finding } from './design';

const f = (rule: string, decide?: string): Finding => ({ id: rule, area: 'system', node: '1:2', nodeName: 'Home', severity: 'major', rule, fix: 'Darken text/muted to #5B5B5B', ...(decide ? { decide } : {}) });
const file = { key: 'KEY', name: 'Harisson' };

describe('awaiting your decision', () => {
  it('adds only findings that need a decision, once per file and problem', () => {
    let list = addFindings([], [f('Muted text fails contrast', 'text/muted token, about 70 layers'), f('Card is shorter')], file, 1);
    expect(list.map((x) => [x.rule, x.impact, x.state, x.fileName])).toEqual([['Muted text fails contrast', 'text/muted token, about 70 layers', 'open', 'Harisson']]);
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
    expect(text).not.toContain('Save a version');
  });
});

describe('stillAwaiting', () => {
  it('counts the run findings that are still open on the list', () => {
    const file = { key: 'KEY', name: 'Harisson' };
    const fs = [f('Muted text fails contrast', 'token'), f('Loose dialog', 'main component'), f('13px text')];
    const list = addFindings([], fs, file, 1);
    expect(stillAwaiting(fs, 'KEY', list)).toBe(2);
    expect(stillAwaiting(fs, 'KEY', decide(list, list[0].id, 'parked', 2))).toBe(1);
    expect(stillAwaiting(fs, 'KEY', null)).toBe(0);
    expect(stillAwaiting(fs, undefined, list)).toBe(0);
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

describe('openCount', () => {
  it('counts only the open items among the ids', () => {
    const list = addFindings([], [{ area: 'system', severity: 'major', node: '1:2', rule: 'A', fix: 'f', decide: 'token' }, { area: 'system', severity: 'major', node: '1:3', rule: 'B', fix: 'f', decide: 'token' }] as never, { key: 'K', name: 'F' }, 1);
    const ids = list.map((x) => x.id);
    expect(openCount(list, ids)).toBe(2);
    expect(openCount(decide(list, ids[0], 'approved', 2), ids)).toBe(1);
    expect(openCount(list, [ids[1], 'other'])).toBe(1);
  });
  it('keys a Code scan finding the same when its count of copies changes', () => {
    const a = { ...f('Button "Next" changes on hover to Type=Secondary (and 1 more like it).', 'main'), node: 'I1:5;2:3' };
    const b = { ...a, rule: 'Button "Next" changes on hover to Type=Secondary (and 4 more like it).' };
    expect(awaitKey('KEY', a)).toBe(awaitKey('KEY', b));
    expect(addFindings(addFindings([], [a], file, 1), [b], file, 2)).toHaveLength(1);
  });
});

const item = (i: number, state: AwaitItem['state'] = 'open', decidedAt?: number): AwaitItem => ({ id: `i${i}`, at: i, fileKey: 'KEY', fileName: 'F', node: '1:2', area: 'system', severity: 'major', rule: `rule ${i}`, fix: '', impact: '', state, ...(decidedAt ? { decidedAt } : {}) });

describe('a full list', () => {
  it('drops decided items first, the oldest decision first, and keeps the order', () => {
    const list = [item(1), item(2, 'approved', 50), item(3, 'parked', 10), item(4), item(5, 'rejected', 30)];
    expect(capAwaiting(list, 3).map((x) => x.id)).toEqual(['i1', 'i2', 'i4']);
  });
  it('never drops an open item, so a list of open items can run over', () => {
    const list = [item(1), item(2), item(3, 'approved', 5)];
    expect(capAwaiting(list, 1).map((x) => x.id)).toEqual(['i1', 'i2']);
  });
  it('keeps unanswered long run questions when new findings arrive', () => {
    const full = Array.from({ length: MAX_AWAIT }, (_, i) => (i < 2 ? { ...item(i), area: 'long_run' as const } : item(i, 'approved', 1000 + i)));
    const next = addFindings(full, [f('New shared change', 'token')], file, 9999);
    expect(next).toHaveLength(MAX_AWAIT);
    expect(next.slice(0, 2).map((x) => x.state)).toEqual(['open', 'open']);
    expect(next.some((x) => x.id === 'i2')).toBe(false);
    expect(next.at(-1)?.rule).toBe('New shared change');
  });
  it('applies the same rule when the file is read', () => {
    const raw = [...Array.from({ length: MAX_AWAIT }, (_, i) => item(i)), item(400, 'parked', 1)];
    expect(cleanAwaiting(raw)).toHaveLength(MAX_AWAIT);
    expect(cleanAwaiting([...raw, item(401)])).toHaveLength(MAX_AWAIT + 1);
  });
});

describe('approve and answer wait for the message', () => {
  it('counts a sent message that starts with the prompt, even when she edited the rest', () => {
    const it1 = { area: 'system' as const, rule: 'Muted text fails contrast.' };
    const prompt = approvePrompt({ ...it1, fix: 'Darken it', impact: 'token', node: '1:2' });
    expect(prompt.startsWith(sentKey(it1))).toBe(true);
    expect(sentFor(it1, prompt.replace('Darken it', 'Use #5B5B5B'))).toBe(true);
    expect(sentFor(it1, 'Fix this  across the file, I approved it:\nMuted text fails contrast. Go')).toBe(true);
    expect(sentFor(it1, 'What does muted text mean?')).toBe(false);
  });
  it('matches a long run answer by its question', () => {
    const q = { area: 'long_run' as const, rule: 'Keep [Toast](https://x) on top?' };
    expect(sentFor(q, `${answerPrompt(q.rule)}yes, keep it`)).toBe(true);
    expect(sentFor(q, 'yes')).toBe(false);
  });
});

describe('awaitState', () => {
  it('says whether a finding is on the list, and how it stands', () => {
    const list = decide(addFindings([], [f('A', 'token'), f('B', 'token')], file, 1), awaitKey('KEY', f('B')), 'parked', 2);
    expect(awaitState(f('A'), 'KEY', list)).toBe('open');
    expect(awaitState(f('B'), 'KEY', list)).toBe('parked');
    expect(awaitState(f('Auto check only'), 'KEY', list)).toBeNull();
    expect(awaitState(f('A'), 'KEY', null)).toBeNull();
  });
});
