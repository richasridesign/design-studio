import { describe, expect, it } from 'vitest';
import { nextSteps } from './Brief';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const status = (input: Record<string, unknown>): ChatEvent => ({ id: `s${at()}`, kind: 'tool_use', name: 'mcp__designstudio__set_status', input, summary: '', at: n });

describe('nextSteps', () => {
  it('takes next steps from the latest status', () => {
    expect(nextSteps([user('go'), status({ text: 'a', next: ['b', 'c'] }), status({ text: 'b', next: ['c'] })])).toEqual(['c']);
  });

  it('clears next steps when a new prompt starts', () => {
    expect(nextSteps([user('go'), status({ text: 'a', next: ['b'] }), user('steer')])).toEqual([]);
  });

  it('lets a plan change from the user replace the next steps', () => {
    const plan: ChatEvent = { id: `p${at()}`, kind: 'plan', next: ['curl /check'], at: n };
    expect(nextSteps([user('go'), status({ text: 'a', next: ['b', 'c'] }), plan])).toEqual(['curl /check']);
    expect(nextSteps([user('go'), plan, status({ text: 'a', next: ['d'] })])).toEqual(['d']);
  });
});
