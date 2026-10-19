import { describe, expect, it } from 'vitest';
import { buildBlocked, buildLabel, buildMessage, canBuild, initialPick, pickBody, whyCount, whyError } from './pickState';
import { switchCopy } from './WorkflowMenu';

const options = [{ id: 'A' as const, name: 'Cards', node: '9:1' }, { id: 'B' as const, name: 'Table', node: '9:2' }];

describe('pick card', () => {
  it('no pick: Build is off and says why; a pick names it', () => {
    const f = initialPick({ options });
    expect(f).toEqual({ id: null, why: '' });
    expect([canBuild(f), buildBlocked(f, false), buildLabel(f, false)]).toEqual([false, 'Pick an option first', 'Build in high fidelity']);
    const b = { ...f, id: 'B' as const };
    expect([canBuild(b), buildBlocked(b, false), buildLabel(b, false), buildLabel(b, true)]).toEqual([true, '', 'Build B in high fidelity', 'Starting…']);
    expect(buildBlocked(b, true)).toBe('Wait for Claude to finish this turn');
  });

  it('Why: optional, a count past 120, an error past 160 or on two lines', () => {
    expect([whyCount('x'.repeat(120)), whyCount('x'.repeat(132))]).toEqual(['', '132 of 160']);
    expect(whyError('x'.repeat(160))).toBe('');
    expect(whyError('x'.repeat(161))).toBe('Keep it to one line, 160 characters at most');
    expect(whyError('one\ntwo')).toBe('Keep it to one line, 160 characters at most');
    expect(canBuild({ id: 'A', why: 'x'.repeat(161) })).toBe(false);
    expect(buildBlocked({ id: 'A', why: 'x'.repeat(161) }, false)).toBe('Shorten the reason first');
  });

  it('keeps an earlier pick, posts the trimmed reason only when given, and names the option in the chat', () => {
    expect(initialPick({ options, picked: { id: 'B', why: 'Scans fast' } })).toEqual({ id: 'B', why: 'Scans fast' });
    expect(initialPick({ options, picked: { id: 'C' } }).id).toBeNull();
    expect(pickBody({ id: 'A', why: '  ' })).toEqual({ action: 'pick', id: 'A' });
    expect(pickBody({ id: 'A', why: ' Scans fast ' })).toEqual({ action: 'pick', id: 'A', why: 'Scans fast' });
    expect(buildMessage({ options }, 'B', { n: 3, name: 'Connectors' })).toBe('Build Option B: Table of Flow 3 · Connectors in high fidelity.');
  });
});

describe('workflow switch', () => {
  it('the confirm says what stays and where the steps start', () => {
    expect(switchCopy('Connectors', '1.19', 'scratch')).toEqual({ title: 'Switch Connectors to From scratch?', body: 'Your work in 1.19 stays. Nothing in Figma changes. The steps start again at Explore.' });
    expect(switchCopy('Connectors', '1.19', 'review-update').body).toBe('Your work in 1.19 stays. Nothing in Figma changes. The steps start again at Review.');
  });
});
