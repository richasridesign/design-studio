import { describe, expect, it } from 'vitest';
import { MAX_INSERTED, forgetInserted, noteInserted, readInserted, routeMessage, sentItems } from './awaitingSent';
import type { PendingRequest } from '../../../shared/protocol';
import { answerPrompt, approvePrompt, startsWithPrompt } from '../../../shared/awaiting';

/** A Storage kept in memory: a new read from it stands in for a reload. */
function memory(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => void m.delete(k), setItem: (k, v) => void m.set(k, v) };
}

const fix = { id: 'K|1:3|card radius', area: 'system' as const, rule: 'Card radius', fileKey: 'K', fix: 'Use radius 8', impact: 'Card main component', node: '1:3', nodeName: 'Home' };
const question = { id: 'K||which toast', area: 'long_run' as const, rule: 'Which toast?', fileKey: 'K' };
const url = 'https://www.figma.com/design/K/Checkout?node-id=1-3';

describe('Awaiting prompts waiting to be sent', () => {
  it('survives a reload and is forgotten on Park, Reject or a send', () => {
    const store = memory();
    noteInserted(fix, 1000, store);
    noteInserted(question, 2000, store);
    expect(readInserted(store).map((x) => x.id)).toEqual([fix.id, question.id]);
    expect(readInserted(store)[1]).toMatchObject({ question: true, rule: 'Which toast?' });
    forgetInserted([fix.id], store);
    expect(readInserted(store).map((x) => x.id)).toEqual([question.id]);
  });

  it('keeps one entry per item, the newest last, and at most MAX_INSERTED', () => {
    const store = memory();
    for (let i = 0; i < MAX_INSERTED + 5; i++) noteInserted({ ...fix, id: `i${i}`, rule: `Rule ${i}` }, i, store);
    noteInserted({ ...fix, id: 'i10', rule: 'Rule 10' }, 999, store);
    const ids = readInserted(store).map((x) => x.id);
    expect(ids).toHaveLength(MAX_INSERTED);
    expect(ids.filter((x) => x === 'i10')).toHaveLength(1);
    expect(ids.at(-1)).toBe('i10');
  });

  it('reads nothing from a broken store', () => {
    const store = memory();
    store.setItem('designstudio.awaiting.inserted', '{not json');
    expect(readInserted(store)).toEqual([]);
  });

  it('matches a sent message that starts with the prompt, on the same file only', () => {
    const store = memory();
    noteInserted(fix, 1, store);
    noteInserted(question, 2, store);
    const list = readInserted(store);
    // The message box sends a frame link of the open file first, as a chip.
    const prompt = approvePrompt(fix, url).replace(` ${url}`, '');
    expect(sentItems(`${url} ${prompt}`, 'K', list).map((x) => x.id)).toEqual([fix.id]);
    expect(sentItems(`${answerPrompt(question.rule)}the short one`, 'K', list).map((x) => x.id)).toEqual([question.id]);
    expect(sentItems(prompt, 'OTHER', list)).toEqual([]);
    expect(sentItems(prompt, undefined, list)).toEqual([]);
    expect(sentItems('go', 'K', list)).toEqual([]);
  });

  it('skips leading links only, not a prompt in the middle of a message', () => {
    expect(startsWithPrompt('About "Which toast?"', `${url} ${url} About "Which toast?": short`)).toBe(true);
    expect(startsWithPrompt('About "Which toast?"', 'Before that: About "Which toast?"')).toBe(false);
  });
});

describe('routeMessage', () => {
  const plan: PendingRequest = { id: 'p1', kind: 'permission', toolName: 'ExitPlanMode', title: 'Plan', input: { plan: 'x' }, canAlwaysAllow: false };
  const ask: PendingRequest = { id: 'q1', kind: 'question', questions: [{ header: 'E', question: 'Which error message?', options: [], multiSelect: false }] };
  const store = memory();
  noteInserted(fix, 1, store);
  noteInserted(question, 2, store);
  const list = readInserted(store);
  const prompt = approvePrompt(fix);

  it('holds an Approve or Answer prompt while a plan or question card waits, and never answers the card with it', () => {
    for (const pending of [plan, ask]) {
      for (const text of [prompt, `${answerPrompt(question.rule)}the short one`]) {
        const r = routeMessage(text, 'K', list, pending);
        expect(r.hold).toBe(true);
        expect(r.answer).toBeNull();
        expect(r.decided).toHaveLength(1);
      }
    }
  });

  it('sends the prompt and marks it decided when no card waits', () => {
    expect(routeMessage(prompt, 'K', list, undefined)).toMatchObject({ hold: false, answer: null, decided: [{ id: fix.id }] });
  });

  it('still answers the card with any other message', () => {
    expect(routeMessage('go', 'K', list, plan)).toMatchObject({ hold: false, decided: [], answer: { type: 'permission', allow: true } });
    expect(routeMessage('B', 'K', list, ask)).toMatchObject({ hold: false, decided: [], answer: { type: 'answer', response: 'B' } });
    // A prompt from another file is her own words here: it answers the card.
    expect(routeMessage(prompt, 'OTHER', list, plan).answer).toMatchObject({ type: 'permission' });
  });
});
