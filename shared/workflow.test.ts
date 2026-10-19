import { describe, expect, it } from 'vitest';
import type { MapPages, MapRow, Project } from './project.js';
import type { ReviewRun } from './design.js';
import {
  WORKFLOW_STEPS, cleanState, defaultState, flowFrames, nextState, nothingDone, reviewTally, stepCard, stepViews, workflowLabel, workflowNote,
  type WorkflowEvidence, type WorkflowState,
} from './workflow.js';

const t = (n: number) => 1_000 + n;

describe('workflow state', () => {
  it('starts with Review and update at Review when the flow has screens, From scratch at Explore when none', () => {
    expect(defaultState(true)).toMatchObject({ workflow: 'review-update', step: 'review', round: 1, marks: {} });
    expect(defaultState(false)).toMatchObject({ workflow: 'scratch', step: 'explore', round: 1 });
  });

  it('lists the steps of both workflows', () => {
    expect(WORKFLOW_STEPS['review-update']).toEqual(['review', 'update']);
    expect(WORKFLOW_STEPS.scratch).toEqual(['explore', 'pick', 'hifi', 'system', 'iterate']);
  });

  it('a finished review makes Update current', () => {
    const s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    expect(s).toMatchObject({ step: 'update', round: 1, marks: { review: { state: 'done' } } });
    expect(s.fromFeedback).toBeUndefined();
  });

  it('a Figma edit while Review is current is feedback: Update is current, Review not done', () => {
    const s = nextState(defaultState(true), { type: 'edited', at: t(1) });
    expect(s).toMatchObject({ step: 'update', fromFeedback: true, marks: {} });
    expect(nextState(s, { type: 'edited', at: t(2) })).toBe(s);
  });

  it('Mark done finishes the round; an edit or a review after it starts round 2', () => {
    let s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    s = nextState(s, { type: 'done', step: 'update', at: t(2) });
    expect(s).toMatchObject({ step: 'update', marks: { update: { state: 'done' } } });
    expect(workflowLabel(s)).toBe('Update');
    const edited = nextState(s, { type: 'edited', at: t(3) });
    expect(edited).toMatchObject({ round: 2, step: 'update', fromFeedback: true, marks: {} });
    expect(workflowLabel(edited)).toBe('Update, round 2');
    expect(nextState(s, { type: 'reviewed', at: t(3) })).toMatchObject({ round: 2, step: 'update', marks: { review: { state: 'done' } } });
  });

  it('Review again starts a new round at Review with no marks', () => {
    let s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    s = nextState(s, { type: 'changes', count: 3, screens: ['Home', 'Detail'], at: t(2) });
    s = nextState(s, { type: 'again', at: t(3) });
    expect(s).toMatchObject({ round: 2, step: 'review', marks: {} });
    expect(s.work).toBeUndefined();
  });

  it('a step can be made current at any time, with a one-shot ask for one chat', () => {
    const s = nextState(defaultState(true), { type: 'step', step: 'update', at: t(1), ask: { chat: 'c1' } });
    expect(s).toMatchObject({ step: 'update', ask: { step: 'update', chat: 'c1' } });
    expect(nextState(s, { type: 'step', step: 'hifi', at: t(2) })).toBe(s);
  });

  it('counts changes and screens, without duplicates', () => {
    let s = nextState(defaultState(true), { type: 'changes', count: 2, screens: ['Home'], at: t(1) });
    s = nextState(s, { type: 'changes', count: 1, screens: ['Home', 'Detail'], at: t(2) });
    expect(s.work).toEqual({ changes: 3, screens: ['Home', 'Detail'] });
  });

  it('switching workflow resets marks and the round', () => {
    let s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    expect(nothingDone(s)).toBe(false);
    s = nextState(s, { type: 'switch', workflow: 'scratch', at: t(2) });
    expect(s).toEqual({ workflow: 'scratch', step: 'explore', round: 1, marks: {}, at: t(2) });
    expect(nothingDone(s)).toBe(true);
  });

  it('From scratch: options make Pick current, a pick makes High fidelity current', () => {
    let s = defaultState(false);
    s = nextState(s, { type: 'options', options: [{ id: 'B', name: 'Wizard', node: '1:2' }, { id: 'A', name: 'One page', node: '1:1' }], at: t(1) });
    expect(s).toMatchObject({ step: 'pick', marks: { explore: { state: 'done' } } });
    expect(s.options?.map((o) => o.id)).toEqual(['A', 'B']);
    expect(nextState(s, { type: 'pick', id: 'C', at: t(2) })).toBe(s);
    s = nextState(s, { type: 'pick', id: 'B', why: 'Fewer steps for new hires', at: t(2) });
    expect(s).toMatchObject({ step: 'hifi', picked: { id: 'B', why: 'Fewer steps for new hires' }, marks: { pick: { state: 'done' } } });
    s = nextState(s, { type: 'done', step: 'hifi', at: t(3) });
    expect(s.step).toBe('system');
    s = nextState(s, { type: 'skip', step: 'system', at: t(4) });
    expect(s.step).toBe('iterate');
    expect(stepViews(s).map((v) => v.state)).toEqual(['done', 'done', 'done', 'skipped', 'current']);
  });

  it('review events are ignored in From scratch', () => {
    const s = defaultState(false);
    expect(nextState(s, { type: 'reviewed', at: t(1) })).toBe(s);
    expect(nextState(s, { type: 'edited', at: t(1) })).toBe(s);
  });

  it('reads a broken file as the default, and drops steps of the other workflow', () => {
    const d = defaultState(true);
    expect(cleanState(null, d)).toBe(d);
    expect(cleanState({ workflow: 'nope' }, d)).toBe(d);
    expect(cleanState({ workflow: 'review-update', step: 'hifi', round: -3, marks: { hifi: { state: 'done', at: 5 } } }, d)).toEqual({ workflow: 'review-update', step: 'review', round: 1, marks: {}, at: 0 });
    const s = nextState(nextState(defaultState(true), { type: 'edited', at: t(1) }), { type: 'changes', count: 2, screens: ['Home'], at: t(2) });
    expect(cleanState(JSON.parse(JSON.stringify(s)), d)).toEqual(s);
  });

  it('tells Claude the step, the round and what is done', () => {
    const s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    expect(workflowNote(s, { n: 3, name: 'Connectors' }, '1.19')).toBe('Workflow: Review and update (Review, Update), a guide only. Step: Update. Done this round: Review. The designer can also give feedback directly: make it in your flow subsection.');
  });
});

// ---------- flowFrames ----------

const F = (id: string, name: string): MapRow => ['F', id, name, 0, 0, 390, 800];
const S = (id: string, name: string, kids: MapRow[], tag?: string): MapRow => ['S', id, name, 0, 0, 2000, 2000, kids, 0, tag ?? null];
const sticky: MapRow = ['I', '9:9', 'Decision 1 · Home', 0, 900, 240, 120];

const project = (iterations: Project['iterations']): Project => ({ key: 'k', flows: [{ n: 3, slug: '03-connectors', name: 'Connectors', entry: [], baseline: '1:0' }], iterations });
const flow = { slug: '03-connectors', baseline: '1:0' };

describe('flowFrames', () => {
  const pages = (inner: MapRow[]): MapPages => [['0:1', 'Flows', [S('1:0', 'Flow 3 · Connectors', [F('1:1', 'Home'), F('1:2', 'Detail')]), ...inner]]];

  it('takes the working iteration subsection, leaving out entry copies and stickies', () => {
    const sub = S('20:1', 'V1.19 · Flow 3 · Connectors', [F('20:2', 'Home (Entry, unchanged)'), F('20:3', 'Detail'), sticky]);
    const p = project([{ id: '1.19', state: 'working', flows: { '03-connectors': { node: '20:1' } } }]);
    expect(flowFrames(pages([sub]), p, flow, '1.19')).toEqual({ frames: [{ id: '20:3', name: 'Detail' }], source: { kind: 'iteration', iteration: '1.19', node: '20:1' } });
  });

  it('falls back to the newest older iteration with screens, found by tag when project.json does not know it', () => {
    const old = S('10:1', 'V1.18 · Flow 3', [F('10:2', 'Home')], 'flow;1.18;03-connectors');
    const older = S('5:1', 'V1.17 · Flow 3', [F('5:2', 'Home'), F('5:3', 'Detail')], 'flow;1.17;03-connectors');
    const empty = S('20:1', 'V1.19 · Flow 3', [sticky], 'flow;1.19;03-connectors');
    const p = project([{ id: '1.17', state: 'frozen' }, { id: '1.19', state: 'working' }]);
    const r = flowFrames(pages([old, older, empty]), p, flow, '1.19');
    expect(r.source).toEqual({ kind: 'older', iteration: '1.18', node: '10:1' });
    expect(r.frames.map((f) => f.id)).toEqual(['10:2']);
  });

  it('falls back to the baseline, then to none', () => {
    const p = project([{ id: '1.19', state: 'working' }]);
    expect(flowFrames(pages([]), p, flow, '1.19')).toMatchObject({ source: { kind: 'baseline', node: '1:0' }, frames: [{ id: '1:1' }, { id: '1:2' }] });
    expect(flowFrames(null, p, flow, '1.19')).toEqual({ frames: [], source: { kind: 'none' } });
  });
});

// ---------- The card ----------

const run = (at: number, kind: ReviewRun['kind'] = 'review'): ReviewRun => ({
  id: `r${at}`, kind, at, round: 1, preset: 'full' as ReviewRun['preset'], frames: [], tokens: 0, costUsd: 0,
  check: [{ id: 'c1', area: 'check', node: '1:1', severity: 'minor', rule: 'grid', fix: 'x' }],
  results: [{ area: 'all' as never, pass: false, summary: '', tokens: 0, costUsd: 0, findings: [
    { id: 'a', area: 'all' as never, node: '1:1', severity: 'major', rule: 'r', fix: 'x' },
    { id: 'b', area: 'all' as never, node: '1:1', severity: 'major', rule: 'r', fix: 'x' },
    { id: 'd', area: 'all' as never, node: '1:1', severity: 'major', rule: 'r', fix: 'x', decide: 'Changes the Button component' },
  ] }],
});

const ev = (over: Partial<WorkflowEvidence> = {}): WorkflowEvidence => ({
  flow: { n: 3, name: 'Connectors' }, iteration: { id: '1.19', state: 'working' }, screens: 6, source: { kind: 'iteration', iteration: '1.19', node: '20:1' },
  cost: 'about $0.40', depth: 'Full', review: null, reviewing: false, ...over,
});

describe('stepCard', () => {
  it('Review: one primary Start review, with the count, depth and cost', () => {
    expect(stepCard(defaultState(true), ev())).toEqual({
      line: 'Reviews 6 screens in 1.19 · Flow 3. Depth: Full, about $0.40.',
      button: { label: 'Start review', action: 'review', primary: true },
      link: { label: 'Or give feedback', action: 'feedback' },
    });
    expect(stepCard(defaultState(true), ev(), true).button?.primary).toBe(false);
    expect(stepCard(defaultState(true), ev({ source: { kind: 'older', iteration: '1.18', node: '10:1' }, screens: 1 })).line).toBe('Reviews 1 screen in 1.18, the newest iteration with screens · Flow 3. Depth: Full, about $0.40.');
    expect(stepCard(defaultState(true), ev({ reviewing: true })).button).toBeUndefined();
    expect(stepCard(defaultState(true), ev({ source: { kind: 'baseline', node: '1:0' } })).link).toEqual({ label: 'Pick screens', action: 'pick-screens' });
    const failed = nextState(defaultState(true), { type: 'failed', reason: 'Figma is not connected.', at: t(1) });
    expect(stepCard(failed, ev())).toMatchObject({ line: 'The review stopped: Figma is not connected. Nothing was changed.', button: { label: 'Try again', action: 'review', primary: false } });
    expect(nextState(failed, { type: 'reviewed', at: t(2) }).failed).toBeUndefined();
  });

  it('Update after a review: the open findings by severity and the ones waiting for her', () => {
    const tally = reviewTally([run(5), run(9, 'audit')], { 'r5:c1': { state: 'fixed', why: '', at: 1 } } as never);
    expect(tally).toMatchObject({ at: 5, decide: 1, open: { blocking: 0, major: 2 } });
    const s = nextState(defaultState(true), { type: 'reviewed', at: t(1) });
    const c = stepCard(s, ev({ review: tally }));
    expect(c.line).toBe('Review done: 2 major. 1 waits for your decision.');
    expect(c.button).toEqual({ label: 'Plan the updates', action: 'plan-updates', primary: true });
  });

  it('Update from feedback: Mark done is Secondary', () => {
    const s = nextState(defaultState(true), { type: 'edited', at: t(1) });
    expect(stepCard(s, ev()).button).toEqual({ label: 'Mark done', action: 'mark-done', primary: false });
  });

  it('Update done: the round summary, Review again and Freeze', () => {
    let s = nextState(defaultState(true), { type: 'edited', at: t(1) });
    s = nextState(s, { type: 'changes', count: 7, screens: ['A', 'B', 'C'], at: t(2) });
    s = nextState(s, { type: 'done', step: 'update', at: t(3) });
    expect(stepCard(s, ev())).toEqual({ line: 'Round 1 done: 7 fixes on 3 screens.', button: { label: 'Review again', action: 'review-again', primary: true }, link: { label: 'Freeze 1.19', action: 'freeze' } });
  });

  it('a frozen iteration offers the next one', () => {
    expect(stepCard(defaultState(true), ev({ iteration: { id: '1.19', state: 'frozen' } }))).toMatchObject({ line: '1.19 is frozen. Changes go in a new iteration.', button: { action: 'next-iteration' } });
  });
});
