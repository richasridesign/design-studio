import { describe, expect, it } from 'vitest';
import { asksForGo, optionLetters, quickReplies, replyToAnswer } from './quickReplies';
import type { ChatEvent } from '../../../shared/protocol';

describe('optionLetters', () => {
  it('finds options on their own lines, bold or numbered', () => {
    expect(optionLetters('Two ways:\n\nA: inline error\nB: banner')).toEqual(['A', 'B']);
    expect(optionLetters('- **A.** Keep it\n- **B.** Drop it\n- **C.** Park it')).toEqual(['A', 'B', 'C']);
    expect(optionLetters('Option A keeps the mic, Option B moves it.')).toEqual(['A', 'B']);
  });
  it('ignores a lone letter or a gap', () => {
    expect(optionLetters('A. quick note on spacing')).toEqual([]);
    expect(optionLetters('A: one\nC: three')).toEqual([]);
    expect(optionLetters('I fixed the dialog.')).toEqual([]);
  });
});

describe('asksForGo', () => {
  it('reads the ask at the end of a plan', () => {
    expect(asksForGo('Plan: 3 screens.\n\nReply go to build.')).toBe(true);
    expect(asksForGo('Want me to apply it across all 8 flows?')).toBe(true);
    expect(asksForGo('Done. The close icon is on every dialog.')).toBe(false);
  });
});

describe('quickReplies', () => {
  it('offers the letters as answers that send', () => {
    const q = quickReplies('A: inline\nB: banner\n\nWhich one?');
    expect(q.slice(0, 2)).toMatchObject([{ label: 'Go with A', text: 'go with A', send: true }, { label: 'Go with B', send: true }]);
    expect(q).toHaveLength(4);
  });
  it('offers Go when the reply asks for it, and only follow-ups otherwise', () => {
    expect(quickReplies('Reply go to build.')[0]).toMatchObject({ label: 'Go', send: true });
    const done = quickReplies('Fixed the spacing.');
    expect(done.map((q) => q.label)).toEqual(['Apply across all flows', 'Why?', 'Add decision stickies']);
    expect(done.every((q) => !q.send)).toBe(true);
  });
});

describe('replyToAnswer', () => {
  const u = (text: string): ChatEvent => ({ id: text, kind: 'user', text, at: 1 });
  const a = (text: string, streaming = false): ChatEvent => ({ id: text, kind: 'assistant', text, streaming, at: 2 });
  it('takes the last finished reply after her message', () => {
    expect(replyToAnswer([u('hi'), a('Reply go')])).toBe('Reply go');
    expect(replyToAnswer([a('Reply go'), u('go')])).toBeNull();
    expect(replyToAnswer([u('hi'), a('typing', true)])).toBeNull();
  });
});
