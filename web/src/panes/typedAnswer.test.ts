import { describe, expect, it } from 'vitest';
import { goWithNote, plainGo, typedAnswer, waitingPlaceholder } from './typedAnswer';
import type { PendingRequest } from '../../../shared/protocol';

const plan: PendingRequest = { id: 'p1', kind: 'permission', toolName: 'ExitPlanMode', title: 'Plan', input: { plan: 'x' }, canAlwaysAllow: false };
const bash: PendingRequest = { id: 'b1', kind: 'permission', toolName: 'Bash', title: 'Run', input: {}, canAlwaysAllow: true };
const question: PendingRequest = { id: 'q1', kind: 'question', questions: [
  { question: 'Which error message?', header: 'Error', options: [{ label: 'A', description: '' }] },
  { question: 'Which voice?', header: 'Voice', options: [{ label: '1', description: '' }] },
] };

describe('plainGo', () => {
  it('takes bare go words', () => {
    for (const t of ['go', 'Go.', 'go ahead', 'ok, go', 'approved', 'build it', 'yes, go ahead please']) expect(plainGo(t)).toBe(true);
  });
  it('leaves choices and notes to Claude', () => {
    for (const t of ['A', 'option b', 'go, keep the voice button', 'error message B, voice 2', 'make it calmer']) expect(plainGo(t)).toBe(false);
  });
});

describe('goWithNote', () => {
  it('takes letters and go with words, not bare go or new asks', () => {
    for (const t of ['A', 'go with B', 'go, keep it', 'go but drop the toast', 'ok, go and park flow 3']) expect(goWithNote(t)).toBe(true);
    for (const t of ['go', 'approved', 'go through every dialog', 'make it calmer']) expect(goWithNote(t)).toBe(false);
  });
  it('takes ok, okay, yes and sure before go with words', () => {
    for (const lead of ['ok', 'okay', 'yes', 'sure']) {
      for (const tail of ['but keep the mic', 'and park flow 3', 'with option B', ', keep the toast']) expect(goWithNote(`${lead}, go ${tail}`.replace(' ,', ','))).toBe(true);
      expect(goWithNote(`${lead} go through every dialog`)).toBe(false);
      expect(plainGo(`${lead}, go`)).toBe(true);
      expect(goWithNote(`${lead}, go`)).toBe(false);
    }
  });
});

describe('typedAnswer', () => {
  it('approves a plan on go', () => {
    expect(typedAnswer(' go ', plan)).toEqual({ type: 'permission', id: 'p1', allow: true });
  });
  it('approves with her words when go or a letter carries a note', () => {
    expect(typedAnswer('A', plan)).toEqual({ type: 'permission', id: 'p1', allow: true, note: 'A' });
    expect(typedAnswer('go, keep the voice button', plan)).toEqual({ type: 'permission', id: 'p1', allow: true, note: 'go, keep the voice button' });
    expect(typedAnswer('go but keep the mic on the right and the paperclip on the left in every flow', plan)).toMatchObject({ allow: true });
  });
  it('sends anything else on a plan as what to change, never an abort', () => {
    expect(typedAnswer('make it calmer', plan)).toEqual({ type: 'permission', id: 'p1', allow: false, note: 'make it calmer' });
    expect(typedAnswer('go through every dialog and list the ones with no close icon', plan)).toMatchObject({ allow: false });
  });
  it('sends her words once as the free text reply, never copied into every question', () => {
    expect(typedAnswer(' error message B, voice 2 ', question)).toEqual({ type: 'answer', id: 'q1', answers: { 'Which error message?': 'error message B, voice 2' }, response: 'error message B, voice 2' });
    expect(typedAnswer('option A', { ...question, questions: question.questions.slice(0, 1) })).toEqual({ type: 'answer', id: 'q1', answers: { 'Which error message?': 'option A' }, response: 'option A' });
  });
  for (const t of ['y', 'Y', 'yes', 'Yes.', 'ok', 'OK', 'okay', 'yes please', 'Yes, please', 'lgtm', 'LGTM!', 'sure', 'sure go', 'Sure, go ahead', 'okay, go']) {
    it(`approves a waiting plan on "${t}"`, () => {
      expect(typedAnswer(t, plan)).toEqual({ type: 'permission', id: 'p1', allow: true });
    });
  }
  for (const t of ['no', 'No.', 'not yet', 'nope', 'change the toast copy', 'yes but change the toast', 'ok, make it calmer', 'sure, what about the mic?']) {
    it(`does not approve a waiting plan on "${t}"`, () => {
      expect(typedAnswer(t, plan)).toMatchObject({ type: 'permission', allow: false, note: t });
    });
  }
  it('leaves other cards and empty text alone', () => {
    expect(typedAnswer('stop that', bash)).toBeNull();
    expect(typedAnswer('  ', plan)).toBeNull();
    expect(typedAnswer('go', undefined)).toBeNull();
  });
  it('names what typing does', () => {
    expect(waitingPlaceholder(plan)).toBe('Type go to approve, or what to change');
    expect(waitingPlaceholder(question)).toBe('Type your answer, or pick one above');
    expect(waitingPlaceholder(bash)).toBe('Answer above, or steer Claude');
  });
});
