import { describe, expect, it } from 'vitest';
import { approve, cleanApprovals, currentStage, reopen, researchSummary, stageLabel, stageNote, stages, type StageEvidence } from './stages.js';
import type { ReviewRun, SketchScreen } from './design.js';

const none: StageEvidence = { brief: null, figma: false, sketch: null, design: null, review: null, decisions: null };
const dir = (id: string) => ({ id, name: id, rationale: '', w: 1, h: 1, items: [] });
const screen = (id: string, n: number, chosen?: string, chosenBy?: 'claude' | 'designer'): SketchScreen => ({ id, name: id, directions: Array.from({ length: n }, (_, i) => dir(`${id}${i}`)), chosen, chosenBy });
const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: ['1:1'], check: [], results: [], tokens: 0, costUsd: 0, ...over });
const finding = (severity: 'blocking' | 'major' | 'minor') => ({ id: severity, area: 'check' as const, node: '1:1', severity, rule: 'x', fix: 'y' });
const pair = { name: 'Home', items: [{ decision: 'A', why: 'B' }, { decision: 'C', why: 'D' }] as [{ decision: string; why: string }, { decision: string; why: string }] };

const byId = (e: StageEvidence, a = {}) => Object.fromEntries(stages(e, a).map((s) => [s.id, s]));

describe('stages', () => {
  it('starts at Spec with every later stage waiting', () => {
    const list = stages(none, {});
    expect(list.map((s) => s.state)).toEqual(['open', 'later', 'later', 'later', 'later', 'later']);
    expect(currentStage(list)?.id).toBe('spec');
  });

  it('is ready when every check is met, but stays current until approved', () => {
    const list = stages({ ...none, brief: 'Saved items screen\nfor a grocery app', figma: true, scope: { flows: ['Saved items'], parked: [] } }, {});
    expect(list[0].state).toBe('ready');
    expect(list[0].checks[0].detail).toBe('Saved items screen');
    expect(list[0].checks[1]).toMatchObject({ label: 'Research written', state: 'unchecked' });
    expect(list[0].checks[2]).toMatchObject({ label: 'Flows in scope named', state: 'met', detail: '1 flow' });
    expect(list[1].state).toBe('later');
  });

  it('moves on once a stage is approved', () => {
    const list = stages(none, { spec: { at: 5 } });
    expect(list[0]).toMatchObject({ state: 'approved', approval: { at: 5 } });
    expect(currentStage(list)?.id).toBe('explore');
  });

  it('ignores an approval that sits after the current stage', () => {
    const list = stages(none, { explore: { at: 5 } });
    expect(list[0].state).toBe('open');
    expect(list[1]).toMatchObject({ state: 'later', approval: undefined });
  });

  it('needs two directions on every screen to finish exploring', () => {
    expect(byId({ ...none, sketch: { screens: [screen('a', 2), screen('b', 1)] } }, { spec: { at: 1 } }).explore.checks[0]).toMatchObject({ state: 'open', detail: '2 screens, 1 with 2 or more directions' });
    expect(byId({ ...none, sketch: { screens: [screen('a', 2)] } }, { spec: { at: 1 } }).explore.state).toBe('ready');
  });

  it('says which picks Claude made', () => {
    const s = byId({ ...none, sketch: { screens: [screen('a', 2, 'a0', 'claude'), screen('b', 2, 'b1', 'designer'), screen('c', 2)] } });
    expect(s.decide.checks[0]).toMatchObject({ state: 'open', detail: '2 of 3 picked, 1 by Claude' });
  });

  it('wants frames and two decisions on each', () => {
    const design = { frames: [{ screen: 'Home', state: 'default', nodeId: '1:1' }, { screen: 'Home', state: 'empty', nodeId: '1:2' }] };
    const s = byId({ ...none, design, decisions: { '1:1': pair } });
    expect(s.build.checks.map((c) => [c.state, c.detail])).toEqual([['met', '2 frames'], ['open', '1 of 2 frames']]);
  });

  it('falls back to the frames of the last review', () => {
    expect(byId({ ...none, review: { runs: [run({ frames: ['1:1', '1:2'] })] } }).build.checks[0]).toMatchObject({ state: 'met', detail: '2 frames' });
  });

  it('counts blocking and major issues and failed house rules, not minor ones', () => {
    const review = { runs: [run({ check: [finding('minor')], results: [{ area: 'accessibility', pass: false, findings: [finding('major')] } as never], rules: [{ rule: 'a', state: 'fail', frames: [] }, { rule: 'b', state: 'pass', frames: [] }] })] };
    const s = byId({ ...none, review });
    expect(s.validate.checks.map((c) => [c.label, c.state, c.detail])).toEqual([
      ['Review run', 'met', 'Round 1, 1 frame'],
      ['No blocking or major issues', 'open', '1 issue open'],
      ['House rules followed', 'open', '1 of 2 failed'],
      ['Prototype wired', 'unchecked', 'Flow check has not run on this file'],
    ]);
  });

  it('marks house rules as not checked when the review had none, which does not block the gate', () => {
    const s = byId({ ...none, review: { runs: [run()] } }, { spec: { at: 1 }, explore: { at: 1 }, decide: { at: 1 }, build: { at: 1 } });
    expect(s.validate.checks[2].state).toBe('unchecked');
    expect(s.validate.state).toBe('ready');
  });
});

describe('flow check on the Validate gate', () => {
  const flow = (id: string, counts: Record<string, number>, state: 'pass' | 'fail' | 'unchecked' = 'pass') => ({ id, name: id, path: [], page: 'p', screens: 1, state, counts, unchecked: [], findings: [], more: 0 });
  const fc = (flows: ReturnType<typeof flow>[]) => ({ id: 'f', at: 1, fileKey: 'k', flows, unchecked: [] });
  it('blocks while a flow has issues and ignores flows it could not check', () => {
    const s = byId({ ...none, review: { runs: [run()] }, flowcheck: fc([flow('a', { 'no-hover': 2 }, 'fail'), flow('b', {}), flow('c', {}, 'unchecked')]) });
    expect(s.validate.checks.at(-1)).toMatchObject({ label: 'Prototype wired', state: 'open', detail: 'Flow check: issues in 1 of 2 flows' });
  });
  it('passes when every flow passed', () => {
    const s = byId({ ...none, review: { runs: [run()] }, flowcheck: fc([flow('a', {})]) });
    expect(s.validate.checks.at(-1)).toMatchObject({ state: 'met', detail: 'Flow check: the flow passed' });
  });
});

describe('research', () => {
  it('counts references and options in research.md', () => {
    const md = '# Saved items\n## Question\n- How do others save items?\n## Looked at\n- Ocado: lists\n  - nested note\n- Oda: hearts\n- Instacart: lists\n## Findings\n- a\n## Options\n1. A lists\n2. B hearts\n## Sources\n- x';
    expect(researchSummary(md)).toBe('3 references, 2 options');
    expect(researchSummary('Some notes')).toBe('Findings written');
  });
  it('is met once research.md exists, and never blocks Spec', () => {
    expect(byId({ ...none, research: '## Looked at\n- A' }).spec.checks[1]).toMatchObject({ state: 'met', detail: '1 reference', open: 'research' });
  });
});

describe('approve and reopen', () => {
  it('keeps earlier approvals and drops later ones', () => {
    const a = { spec: { at: 1 }, explore: { at: 2 }, decide: { at: 3 } };
    expect(approve(a, 'explore', 9, '  looks good ')).toEqual({ spec: { at: 1 }, explore: { at: 9, note: 'looks good' } });
    expect(reopen(a, 'explore')).toEqual({ spec: { at: 1 } });
  });

  it('cleans stored approvals', () => {
    expect(cleanApprovals({ spec: { at: 1, note: ' ' }, nope: { at: 2 }, build: { at: 'x' } })).toEqual({ spec: { at: 1 } });
    expect(cleanApprovals([1])).toEqual({});
  });
});

describe('stageNote', () => {
  it('says nothing until a stage is approved', () => expect(stageNote({})).toBe(''));
  it('names the approved stages, the current one and the notes', () => {
    const t = stageNote({ spec: { at: 1, note: 'Mobile only' }, explore: { at: 2 } });
    expect(t).toContain('approved Spec, Explore. Current stage: Decide (pick one direction per screen).');
    expect(t).toContain('ask before doing it');
    expect(t).toContain('Approval notes: Spec: Mobile only');
  });
  it('says the work is handed off when every stage is approved', () => {
    expect(stageNote(Object.fromEntries(['spec', 'explore', 'decide', 'build', 'validate', 'ship'].map((id) => [id, { at: 1 }])))).toMatch(/^Stages: the designer approved every stage/);
  });
});

describe('stageLabel', () => {
  it('is empty until a stage is approved, then names the current one', () => {
    expect(stageLabel({})).toBeNull();
    expect(stageLabel({ spec: { at: 1 } })).toBe('Explore');
    expect(stageLabel(Object.fromEntries(['spec', 'explore', 'decide', 'build', 'validate', 'ship'].map((id) => [id, { at: 1 }])))).toBe('Shipped');
  });
});
