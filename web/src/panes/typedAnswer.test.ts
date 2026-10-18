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
  it('answers every question with her words', () => {
    expect(typedAnswer('error message B, voice 2', question)).toEqual({ type: 'answer', id: 'q1', answers: { 'Which error message?': 'error message B, voice 2', 'Which voice?': 'error message B, voice 2' } });
  });
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
