import { describe, expect, it } from 'vitest';
import { changeScope, cleanScope, EMPTY_SCOPE, parkedRules, scopeBlock, scopeSummary } from './scope.js';

const s = (flows: string[], parked: string[] = []) => ({ flows, parked: parked.map((name) => ({ name, why: 'Not in the MVP', restore: '', at: Date.UTC(2026, 9, 1) })) });

describe('cleanScope', () => {
  it('trims, drops repeats and bad items, and keeps parked names out of the flows', () => {
    expect(cleanScope({ flows: [' Onboarding ', 'onboarding', '', 3, 'Add a workflow'], parked: [{ name: 'Add a workflow', why: 'Later', at: 1 }, { name: 'x' }] })).toEqual({
      flows: ['Onboarding'],
      parked: [{ name: 'Add a workflow', why: 'Later', restore: '', at: 1 }],
    });
    expect(cleanScope(null)).toEqual(EMPTY_SCOPE);
  });
});

describe('changeScope', () => {
  it('parks a flow out of scope with a date, and restores it back', () => {
    const parked = changeScope(s(['Onboarding', 'Add a workflow']), { action: 'park', name: 'add a workflow', why: ' Not in the MVP ', restore: 'Add the button back on Home' }, 7);
    expect(parked).toEqual({ flows: ['Onboarding'], parked: [{ name: 'add a workflow', why: 'Not in the MVP', restore: 'Add the button back on Home', at: 7 }] });
    expect(changeScope(parked, { action: 'restore', name: 'Add a workflow' }, 8)).toEqual({ flows: ['Onboarding', 'Add a workflow'], parked: [] });
  });

  it('needs a name, and a reason to park', () => {
    expect(() => changeScope(EMPTY_SCOPE, { action: 'add', name: ' ' }, 1)).toThrow('Name the flow');
    expect(() => changeScope(EMPTY_SCOPE, { action: 'park', name: 'X', why: '' }, 1)).toThrow('Say why');
  });

  it('adds and removes flows', () => {
    const added = changeScope(EMPTY_SCOPE, { action: 'add', name: 'Activate Harisson' }, 1);
    expect(added.flows).toEqual(['Activate Harisson']);
    expect(changeScope(added, { action: 'remove', name: 'activate harisson' }, 2).flows).toEqual([]);
  });
});

describe('what Claude and the review see', () => {
  it('turns each parked feature into a rule', () => {
    expect(parkedRules(s([], ['Add a workflow']))).toEqual(['Parked: "Add a workflow" stays out of the latest version, with no screens, entry points or links to it.']);
    expect(parkedRules(undefined)).toEqual([]);
  });

  it('writes the scope block, or nothing when there is no scope', () => {
    expect(scopeBlock(EMPTY_SCOPE)).toBe('');
    const t = scopeBlock(s(['Onboarding', 'Activate'], ['Add a workflow']));
    expect(t).toContain('Flows in scope: Onboarding, Activate.');
    expect(t).toContain('- Add a workflow (parked 1 Oct 2026): Not in the MVP');
  });

  it('sums it up in a few words', () => {
    expect(scopeSummary(s(['A']))).toBe('1 flow');
    expect(scopeSummary(s(['A', 'B'], ['C']))).toBe('2 flows, 1 parked');
  });
});
