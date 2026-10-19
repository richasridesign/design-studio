import { describe, expect, it } from 'vitest';
import { changeTriage, cleanTriage, closedTally, openIssues, openRun, resolvedRules, ruleKey, splitRun, triagedRules, triageKey, type Triage } from './triage.js';
import { rulesLine, rulesSummary } from './rules.js';
import { reviewChecklist } from './design.js';
import type { AreaResult, Finding, ReviewRun } from './design.js';

const f = (id: string, severity: Finding['severity'] = 'major'): Finding => ({ id, area: 'check', node: '1:1', severity, rule: 'x', fix: 'y' });
const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({ id: 'r1', kind: 'review', at: 1, round: 1, preset: 'quick', frames: [], check: [f('a'), f('b', 'blocking'), f('c', 'minor')], results: [], tokens: 0, costUsd: 0, ...over });

describe('triage', () => {
  it('keys a finding by its run, so a new round starts fresh', () => {
    expect(triageKey(run(), f('a'))).toBe('r1:a');
    const t = changeTriage({}, { action: 'close', key: 'r1:a', state: 'fixed' }, 5);
    expect(openIssues(run(), t).map((x) => x.id)).toEqual(['b']);
    expect(openIssues(run({ id: 'r2' }), t).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it("needs a why for Won't fix and Parked, not for Fixed", () => {
    expect(() => changeTriage({}, { action: 'close', key: 'r1:a', state: 'wontfix', why: '  ' }, 1)).toThrow(/why/);
    expect(() => changeTriage({}, { action: 'close', key: 'r1:a', state: 'parked' }, 1)).toThrow(/parked/);
    expect(changeTriage({}, { action: 'close', key: 'r1:a', state: 'parked', why: ' not in  MVP ' }, 7)).toEqual({ 'r1:a': { state: 'parked', why: 'not in MVP', at: 7 } });
    expect(() => changeTriage({}, { action: 'close', key: '', state: 'fixed' }, 1)).toThrow();
    expect(() => changeTriage({}, { action: 'close', key: 'k', state: 'done' as never }, 1)).toThrow();
  });

  it('reopens a finding', () => {
    const t = changeTriage({}, { action: 'close', key: 'r1:a', state: 'fixed' }, 1);
    expect(changeTriage(t, { action: 'reopen', key: 'r1:a' }, 2)).toEqual({});
  });

  it('cleans stored input', () => {
    expect(cleanTriage(null)).toEqual({});
    expect(cleanTriage([1])).toEqual({});
    expect(cleanTriage({ a: { state: 'fixed', why: 1, at: 3 }, b: { state: 'nope', why: '', at: 1 }, c: { state: 'wontfix', why: '', at: 1 }, d: { state: 'parked', why: 'later', at: 'x' } })).toEqual({ a: { state: 'fixed', why: '', at: 3 } });
  });

  it('splits a run and tallies the closed ones', () => {
    const t = { 'r1:a': { state: 'wontfix' as const, why: 'brand', at: 2 }, 'r1:c': { state: 'fixed' as const, why: '', at: 3 } };
    const s = splitRun(run(), t);
    expect(s.open.map((x) => x.id)).toEqual(['b']);
    expect(s.closed.map((x) => [x.id, x.triage.state])).toEqual([['a', 'wontfix'], ['c', 'fixed']]);
    expect(closedTally(s.closed)).toBe("1 fixed, 1 won't fix");
    expect(closedTally([])).toBe('');
    expect(openRun(run(), t).check.map((x) => x.id)).toEqual(['b']);
  });

  it('passes an area once its blocking and major findings are closed', () => {
    const area = (over: Partial<AreaResult> = {}): AreaResult => ({ area: 'all', pass: false, summary: '', findings: [f('x'), f('y', 'minor')], tokens: 0, costUsd: 0, ...over });
    const t = { 'r1:x': { state: 'fixed' as const, why: '', at: 1 } };
    expect(openRun(run({ results: [area()] }), t).results[0]).toMatchObject({ pass: true, findings: [{ id: 'y' }] });
    expect(openRun(run({ results: [area()] }), {}).results[0].pass).toBe(false);
    expect(openRun(run({ results: [area({ error: 'timeout' })] }), t).results[0].pass).toBe(false);
  });
});

describe('house rule triage', () => {
  const rules = [{ rule: 'One  primary\tbutton', state: 'fail' as const, frames: ['1:2'] }, { rule: 'No em dashes', state: 'pass' as const, frames: [] }];
  const r = run({ check: [], rules });

  it('keys a rule by its run and cleaned text, the same way changeTriage stores it', () => {
    const key = ruleKey(r, rules[0].rule);
    expect(key).toBe('r1:rule:One primary button');
    const t = changeTriage({}, { action: 'close', key: `r1:rule:One  primary\tbutton`, state: 'parked', why: 'next release' }, 3);
    expect(Object.keys(t)).toEqual([key]);
    expect(resolvedRules(r, t)).toMatchObject([{ rule: rules[0].rule, key, triage: { state: 'parked' } }]);
    expect(resolvedRules({ ...r, id: 'r2' }, t)).toEqual([]);
    expect(ruleKey(r, 'x'.repeat(400)).length).toBe(300);
  });

  it('counts a resolved rule as resolved, and only a failed rule can be resolved', () => {
    const t = changeTriage({}, { action: 'close', key: ruleKey(r, rules[0].rule), state: 'fixed' }, 3);
    expect(rulesSummary(openRun(r, t).rules!)).toMatchObject({ passed: 1, failed: 0, resolved: 1 });
    expect(rulesLine(openRun(r, t).rules!)).toBe('1 of 2 passed, 1 resolved by hand');
    // A passed rule with a stray key stays passed.
    expect(triagedRules(r, { [ruleKey(r, 'No em dashes')]: { state: 'fixed', why: '', at: 1 } })?.[1].triage).toBeUndefined();
    expect(reviewChecklist(openRun(r, t), null)).not.toContain('house rule');
  });
});
