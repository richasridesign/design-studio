import { describe, expect, it } from 'vitest';
import { decide, longRunPrompt, nodeLink, plainLine, reportQuestions, parseReport, roundFrom, stallReason, untilFrom, usedPct, windowPct, withLimit, type LongRun } from './longRun.js';
import type { PlanLimit } from './protocol.js';

const now = 1_000_000;
const run = (p: Partial<LongRun> = {}): LongRun => ({ until: now + 60_000, cap: 90, startedAt: now - 1000, turns: 1, state: 'running', ...p });
const lim = (used: number | null, status: PlanLimit['status'] = 'allowed', kind = 'five_hour'): PlanLimit => ({ kind, used, resetsAt: null, status });
const end = (p: Partial<Parameters<typeof decide>[1]> = {}) => ({ now, limit: lim(0.3), errorStreak: 0, reported: false, ...p });

describe('decide', () => {
  it('does nothing without an active run', () => {
    expect(decide(null, end())).toEqual({ action: 'none' });
    expect(decide(run({ state: 'done' }), end())).toEqual({ action: 'none' });
    expect(decide(run({ state: 'stopped' }), end())).toEqual({ action: 'none' });
  });
  it('continues while there is time and usage left', () => {
    expect(decide(run(), end())).toEqual({ action: 'continue' });
    expect(decide(run(), end({ limit: null }))).toEqual({ action: 'continue' });
  });
  it('is done when the reply has the report', () => {
    expect(decide(run(), end({ reported: true }))).toEqual({ action: 'done' });
    expect(decide(run({ state: 'reporting', reason: 'time' }), end({ reported: true }))).toEqual({ action: 'done' });
  });
  it('asks for the report once when time is up', () => {
    expect(decide(run(), end({ now: now + 60_000 }))).toEqual({ action: 'ask_report', reason: 'time' });
    expect(decide(run({ state: 'reporting', reason: 'time' }), end({ now: now + 120_000 }))).toEqual({ action: 'stop', reason: 'time' });
  });
  it('compares the cap as a percent of a 0..1 usage', () => {
    expect(decide(run(), end({ limit: lim(0.89) }))).toEqual({ action: 'continue' });
    expect(decide(run(), end({ limit: lim(0.9) }))).toEqual({ action: 'ask_report', reason: 'cap' });
    expect(usedPct(lim(0.95, 'allowed', 'seven_day'))).toBe(0);
  });
  it('keeps the 5-hour cap when the latest event is the weekly one', () => {
    const limits = withLimit(withLimit(null, lim(0.92)), lim(0.1, 'allowed', 'seven_day'));
    expect(decide(run(), end({ limit: lim(0.1, 'allowed', 'seven_day'), limits }))).toEqual({ action: 'ask_report', reason: 'cap' });
  });
  it('asks for the report at the weekly cap, 70% by default', () => {
    const at = (used: number, kind = 'seven_day') => end({ limits: withLimit(withLimit(null, lim(0.2)), lim(used, 'allowed', kind)) });
    expect(decide(run(), at(0.69))).toEqual({ action: 'continue' });
    expect(decide(run(), at(0.7))).toEqual({ action: 'ask_report', reason: 'weekly' });
    expect(decide(run({ weeklyCap: 85 }), at(0.8))).toEqual({ action: 'continue' });
    expect(decide(run(), at(0.75, 'seven_day_opus'))).toEqual({ action: 'ask_report', reason: 'weekly' });
    expect(decide(run(), end({ limit: lim(0.71, 'allowed', 'seven_day') }))).toEqual({ action: 'ask_report', reason: 'weekly' });
  });
  it('reads the highest weekly window and nothing when no event came', () => {
    const limits = withLimit(withLimit(null, lim(0.3, 'allowed', 'seven_day')), lim(0.6, 'allowed', 'seven_day_opus'));
    expect(windowPct(limits, 'weekly')).toBeCloseTo(60);
    expect(windowPct(limits, 'five_hour')).toBeNull();
    expect(windowPct(null, 'weekly')).toBeNull();
  });
  it('stops without asking when the limit rejects', () => {
    expect(decide(run(), end({ limit: lim(1, 'rejected') }))).toEqual({ action: 'stop', reason: 'rejected' });
  });
  it('stops after two error turns in a row', () => {
    expect(decide(run(), end({ errorStreak: 1 }))).toEqual({ action: 'continue' });
    expect(decide(run(), end({ errorStreak: 2 }))).toEqual({ action: 'stop', reason: 'errors' });
  });
});

describe('untilFrom', () => {
  const base = new Date(2026, 9, 18, 22, 30).getTime();
  it('uses today when the time is still ahead', () => {
    expect(untilFrom('23:15', base)).toBe(new Date(2026, 9, 18, 23, 15).getTime());
  });
  it('rolls to tomorrow when the time has passed', () => {
    expect(untilFrom('04:00', base)).toBe(new Date(2026, 9, 19, 4, 0).getTime());
    expect(untilFrom('22:30', base)).toBe(new Date(2026, 9, 19, 22, 30).getTime());
  });
  it('rejects bad input', () => {
    expect(untilFrom('', base)).toBeNull();
    expect(untilFrom('25:00', base)).toBeNull();
  });
});

const REPORT = `Done for tonight.

## Fixed
- Close icon on [Dialog](https://www.figma.com/design/abcdefghij1/F?node-id=1-2)
- Toast offset
  on all screens

## Needs your decision
1. Keep Fixed collapsed?
2. Rename the tab

### Not checked
* None`;

describe('parseReport', () => {
  it('reads the three sections, intro and links', () => {
    const r = parseReport(REPORT)!;
    expect(r.intro).toBe('Done for tonight.');
    expect(r.fixed).toEqual(['Close icon on [Dialog](https://www.figma.com/design/abcdefghij1/F?node-id=1-2)', 'Toast offset on all screens']);
    expect(r.decide).toEqual(['Keep Fixed collapsed?', 'Rename the tab']);
    expect(r.unchecked).toEqual([]);
  });
  it('needs all three headings at the start of a line', () => {
    expect(parseReport('I will end with ## Fixed, ## Needs your decision and ## Not checked.')).toBeNull();
    expect(parseReport('## Fixed\n- a\n## Needs your decision\n- b')).toBeNull();
  });
  it('accepts headings in any case and with a colon', () => {
    const r = parseReport('## fixed:\n- a\n## NEEDS YOUR DECISION\n- b\n## Not checked\n- c')!;
    expect(r).toMatchObject({ fixed: ['a'], decide: ['b'], unchecked: ['c'] });
  });
  it('accepts counts after headings, other heading levels and plural decisions', () => {
    expect(parseReport('# Fixed (2)\n- a\n- b\n#### Needs your decisions: 1\n- c\n## Not checked 0\n- None')).toMatchObject({ fixed: ['a', 'b'], decide: ['c'], unchecked: [] });
    expect(parseReport('## **Fixed** - 1\n- a\n## Needs your decision\n- b\n## Not checked\n- c')!.fixed).toEqual(['a']);
  });
  it('stops a section at an unrelated heading', () => {
    const r = parseReport('## Fixed\n- a\n## Needs your decision\n- b\n## Not checked\n- c\n## Notes\n- extra')!;
    expect(r.unchecked).toEqual(['c']);
  });
});

describe('stallReason', () => {
  it('warns when a run would wait for approvals', () => {
    expect(stallReason('auto', true)).toMatch(/Ask before changing the file/);
    expect(stallReason('default', false)).toMatch(/asks before Claude uses tools/);
    expect(stallReason('auto', false)).toBe('');
    expect(stallReason(null, false)).toBe('');
  });
});

describe('rounds and links', () => {
  it('reads the last round Claude names', () => {
    expect(roundFrom('Round 1 of 3 done. Round 2 of 3: fixing hover.')).toBe(2);
    expect(roundFrom('round 3 of 3')).toBe(3);
    expect(roundFrom('Three rounds left')).toBeNull();
  });
  it('finds the file key and node in a report line', () => {
    expect(nodeLink('Move it? [Toast](https://www.figma.com/design/Ab12Cd/Flows?node-id=12-345&t=x)')).toEqual({ fileKey: 'Ab12Cd', node: '12:345' });
    expect(nodeLink('Rename the tab')).toBeNull();
  });
  it('asks for rounds, both caps and the file map in the prompt', () => {
    const p = longRunPrompt('Review the flows', new Date(2026, 9, 19, 4, 0).getTime(), { cap: 90, weeklyCap: 70, rounds: 3, mapFile: '/x/map.md' });
    expect(p).toMatch(/up to 3/);
    expect(p).toMatch(/"Round 2 of 3"/);
    expect(p).toMatch(/own subagent/);
    expect(p).toMatch(/90% of the 5-hour plan limit or 70% of the weekly limit/);
    expect(p).toMatch(/cached file map \(\/x\/map\.md\)/);
    expect(p).not.toMatch(/\u2014/);
  });
});

describe('report questions for the Awaiting list', () => {
  it('keeps link labels and drops link targets', () => {
    expect(plainLine('Move the toast on [Cart](https://www.figma.com/design/Ab1/F?node-id=1-2)? Left it.')).toBe('Move the toast on Cart? Left it.');
    expect(plainLine('Rename the tab? Kept it (https://www.figma.com/design/Ab1/F?node-id=1-2).')).toBe('Rename the tab? Kept it.');
    expect(plainLine('Rename the tab https://figma.com/design/Ab1/F?node-id=1-2 or keep it')).toBe('Rename the tab or keep it');
  });
  it('takes the node from the link, else the chat file, and saves nothing without a real file', () => {
    const decide = ['Move it? [Toast](https://www.figma.com/design/Ab1/F?node-id=3-4)', 'Rename the tab?'];
    expect(reportQuestions(decide, 'Chat9')).toEqual([{ text: 'Move it? Toast', fileKey: 'Ab1', node: '3:4' }, { text: 'Rename the tab?', fileKey: 'Chat9', node: '' }]);
    expect(reportQuestions(['Rename the tab?'], null)).toEqual([]);
    expect(reportQuestions(['Rename the tab?'], 'sample')).toEqual([]);
  });
});
