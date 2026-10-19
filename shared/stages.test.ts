import { describe, expect, it } from 'vitest';
import { KIND_INFO, PHASE_STAGE, approvalReply, planApprovedOnCard, chatKind, cleanApprovals, cleanChatSteps, guessKind, markStep, phaseLine, researchSummary, stageFrames, stageLabel, stageNote, stages, stepLine, type ChatSteps, type StageEvidence } from './stages.js';
import type { ReviewRun, SketchScreen } from './design.js';

const none: StageEvidence = { brief: null, figma: false, sketch: null, design: null, review: null };
const dir = (id: string) => ({ id, name: id, rationale: '', w: 1, h: 1, items: [] });
const screen = (id: string, n: number, chosen?: string, chosenBy?: 'claude' | 'designer'): SketchScreen => ({ id, name: id, directions: Array.from({ length: n }, (_, i) => dir(`${id}${i}`)), chosen, chosenBy });
const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: ['1:1'], check: [], results: [], tokens: 0, costUsd: 0, ...over });
const finding = (severity: 'blocking' | 'major' | 'minor') => ({ id: severity, area: 'check' as const, node: '1:1', severity, rule: 'x', fix: 'y' });
const empty: ChatSteps = { marks: {} };

// Every step a check can sit on, in one list, so the check tests do not depend on a kind.
const byId = (e: StageEvidence, c: ChatSteps = empty) => Object.fromEntries([...stages(e, c, 'new'), ...stages(e, c, 'explore')].map((s) => [s.id, s]));

describe('kinds', () => {
  it('shows only the steps a kind needs', () => {
    expect(stages(none, empty, 'review').map((s) => s.name)).toEqual(['Review']);
    expect(stages(none, empty, 'fix').map((s) => s.name)).toEqual(['Plan', 'Build', 'Review']);
    expect(stages(none, empty, 'new').map((s) => s.name)).toEqual(['Plan', 'Sketch', 'Build', 'Review']);
    expect(stages(none, empty, 'explore').map((s) => s.name)).toEqual(['Research', 'Sketch']);
    expect(stages(none, empty, 'batch').map((s) => s.name)).toEqual(['Plan', 'Review']);
  });

  it('shows no steps for a plain chat', () => expect(stages(none, empty, null)).toEqual([]));

  it('guesses the kind from the first message', () => {
    expect(guessKind('Review only, do not build anything. Run the accessibility review on the LATEST flows.')).toBe('review');
    expect(guessKind("Review the cards, don't change anything")).toBe('review');
    expect(guessKind('The close icon is missing on the dialogs. Fix it across all 8 flows.')).toBe('fix');
    expect(guessKind('icons colour differ, apply it to every screen in all the flows')).toBe('fix');
    expect(guessKind('Design a new onboarding flow for HR admins')).toBe('new');
    expect(guessKind('What if the approvals lived in Slack? Explore some ideas')).toBe('explore');
    expect(guessKind('Run all of this until 4 AM, figure out yourself')).toBe('batch');
    expect(guessKind('loop until 5')).toBe('batch');
    expect(guessKind('keep fixing until 5 flows are done')).not.toBe('batch');
    expect(guessKind('What does this error mean?')).toBeNull();
    expect(guessKind('')).toBeNull();
  });

  it('uses her pick over the guess, and none turns the steps off', () => {
    expect(chatKind(empty, 'Fix it across all 8 flows')).toEqual({ kind: 'fix', guessed: true });
    expect(chatKind({ marks: {}, kind: 'review' }, 'Fix it across all 8 flows')).toEqual({ kind: 'review', guessed: false });
    expect(chatKind({ marks: {}, kind: 'none' }, 'Fix it across all 8 flows')).toEqual({ kind: null, guessed: false });
  });
});

describe('steps', () => {
  it('suggests the first step still to do, and locks none', () => {
    const list = stages(none, empty, 'fix');
    expect(list.map((s) => [s.state, s.next])).toEqual([['todo', true], ['todo', false], ['todo', false]]);
    expect(stepLine(list)).toBe('Plan');
  });

  it('takes steps in any order', () => {
    const c = markStep(empty, 'validate', 'done', 5);
    const list = stages(none, c, 'fix');
    expect(list.map((s) => s.state)).toEqual(['todo', 'todo', 'done']);
    expect(list[2]).toMatchObject({ approval: { at: 5 }, next: false });
  });

  it('never clears another step when one is reopened, and flags the later ones as maybe out of date', () => {
    let c = markStep(markStep(markStep(empty, 'spec', 'done', 1), 'build', 'done', 2), 'validate', 'done', 3, 'all clean');
    c = markStep(c, 'spec', 'undo', 4);
    expect(c.marks).toEqual({ spec: { state: 'todo', at: 4 }, build: { state: 'done', at: 2 }, validate: { state: 'done', at: 3, note: 'all clean' } });
    c = markStep(c, 'explore', 'skip', 5);
    const list = stages(none, c, 'new');
    expect(list.map((s) => s.state)).toEqual(['todo', 'skipped', 'done', 'done']);
    expect(list.map((s) => s.stale)).toEqual([false, false, true, true]);
    // Done again after the reopen: up to date.
    expect(stages(none, markStep(c, 'build', 'done', 6), 'new').map((s) => s.stale)).toEqual([false, false, false, true]);
  });

  it('flags Review as maybe out of date when Build runs another round after it', () => {
    let c = markStep(markStep(empty, 'build', 'done', 1), 'validate', 'done', 2);
    c = markStep(c, 'build', 'again', 3);
    expect(stages(none, c, 'fix').map((s) => [s.id, s.stale])).toEqual([['spec', false], ['build', false], ['validate', true]]);
  });

  it('runs a step again as round 2 and keeps the round when undone or done', () => {
    let c = markStep(markStep(empty, 'build', 'done', 1), 'build', 'again', 2);
    expect(c.marks.build).toEqual({ state: 'todo', at: 2, round: 2 });
    expect(stepLine(stages(none, markStep(c, 'spec', 'done', 3), 'fix'))).toBe('Build, round 2');
    c = markStep(c, 'build', 'done', 3);
    expect(c.marks.build).toEqual({ state: 'done', at: 3, round: 2 });
    expect(markStep(c, 'build', 'undo', 4).marks.build).toEqual({ state: 'todo', at: 4, round: 2 });
  });

  it('counts review rounds from the review runs', () => {
    const review = { runs: [run({ round: 2, at: 10 })] };
    expect(stages({ ...none, review }, empty, 'review')[0]).toMatchObject({ state: 'todo', round: 2 });
    expect(markStep(empty, 'validate', 'again', 11, undefined, 2).marks.validate).toEqual({ state: 'todo', at: 11, round: 3 });
    // The review round never leaks into the other steps.
    expect(markStep(empty, 'spec', 'done', 11, undefined, 2).marks.spec).toEqual({ state: 'done', at: 11 });
  });

  it('opens Review again on its own when a newer review run comes in', () => {
    const c = markStep(empty, 'validate', 'done', 20);
    expect(stages({ ...none, review: { runs: [run({ round: 1, at: 10 })] } }, c, 'review')[0].state).toBe('done');
    expect(stages({ ...none, review: { runs: [run({ round: 2, at: 30 })] } }, c, 'review')[0]).toMatchObject({ state: 'todo', round: 2, next: true });
  });

  it('says All done when nothing is left', () => {
    expect(stepLine(stages(none, markStep(empty, 'validate', 'skip', 1), 'review'))).toBe('All done');
  });

  it('keeps checks as information: a step with open checks can be done', () => {
    const list = stages(none, markStep(empty, 'spec', 'done', 1), 'fix');
    expect(list[0].checks.some((c) => c.state === 'open')).toBe(true);
    expect(list[0].state).toBe('done');
  });

  it('reads the spec checks', () => {
    const s = byId({ ...none, brief: 'Saved items screen\nfor a grocery app', figma: true, scope: { flows: ['Saved items'], parked: [] } });
    expect(s.spec.checks[0].detail).toBe('Saved items screen');
    expect(s.spec.checks[1]).toMatchObject({ label: 'Research written', state: 'unchecked' });
    expect(s.spec.checks[2]).toMatchObject({ label: 'Flows in scope named', state: 'met', detail: '1 flow' });
  });

  it('hints at research for new work only, and shows research that exists for any kind', () => {
    const labels = (kind: 'new' | 'fix' | 'batch', research: string | null = null) => stages({ ...none, research }, empty, kind)[0].checks.map((c) => c.label);
    expect(labels('new')).toContain('Research written');
    expect(labels('fix')).not.toContain('Research written');
    expect(labels('batch')).not.toContain('Research written');
    expect(labels('fix', '## Looked at\n- Linear')).toContain('Research written');
  });

  it('is happy with one direction per screen, and says how many have more', () => {
    expect(byId({ ...none, sketch: { screens: [screen('a', 2), screen('b', 1)] } }).explore.checks[0]).toMatchObject({ state: 'met', detail: '2 screens, 1 with 2 or more directions' });
  });

  it('says which picks Claude made', () => {
    const s = byId({ ...none, sketch: { screens: [screen('a', 2, 'a0', 'claude'), screen('b', 2, 'b1', 'designer'), screen('c', 2)] } });
    expect(s.explore.checks[1]).toMatchObject({ state: 'open', detail: '2 of 3 picked, 1 by Claude' });
  });

  it('wants frames and their states (decisions live on the Decision stickies in Figma)', () => {
    const design = { frames: [{ screen: 'Home', state: 'default', nodeId: '1:1' }, { screen: 'Home', state: 'empty', nodeId: '1:2' }] };
    const s = byId({ ...none, design });
    expect(s.build.checks.map((c) => [c.state, c.detail])).toEqual([['met', '2 frames'], ['unchecked', 'The brief lists no states']]);
  });

  it('checks every state the brief lists against the frames', () => {
    const plan = '## States\n- Home: default, empty\n- Cart: default, payment failed, signed out';
    const design = { frames: [{ screen: 'home', state: 'default', nodeId: '1:1' }, { screen: 'home', state: 'empty', nodeId: '1:2' }, { screen: 'cart', state: 'payment-failed', nodeId: '1:3' }] };
    expect(byId({ ...none, plan, design }).build.checks[1]).toEqual({ label: 'Every state designed', state: 'open', detail: '2 of 5 states missing', open: 'states' });
    const all = { frames: [...design.frames, { screen: 'cart', state: 'default', nodeId: '1:4' }, { screen: 'cart', state: 'signed out', nodeId: '1:5' }] };
    expect(byId({ ...none, plan, design: all }).build.checks[1]).toMatchObject({ state: 'met', detail: 'All 5 states designed' });
    expect(byId({ ...none, plan: '## States\n- Home: empty', design: { frames: [{ screen: 'Home', state: 'Empty', nodeId: '1:1' }] } }).build.checks[1].detail).toBe('The state is designed');
  });

  it('lists every state as missing before any frame exists', () => {
    expect(byId({ ...none, plan: '## States\n- Home: default, empty' }).build.checks[1]).toMatchObject({ state: 'open', detail: '2 of 2 states missing' });
  });

  it('reads the states from the first message when there is no plan.md', () => {
    expect(byId({ ...none, brief: 'Design a cart\n\n## States\n- Cart: default' }).build.checks[1]).toMatchObject({ state: 'open', detail: '1 of 1 state missing' });
  });

  it('reads frames from design.json, or from the last review when it has none', () => {
    const design = { frames: [{ screen: 'Home', state: 'empty', nodeId: '1:1' }] };
    expect(stageFrames(design, { runs: [run({ frames: ['9:9'] })] })).toEqual(design.frames);
    expect(stageFrames({ frames: [] }, { runs: [run({ frames: ['9:9'] })] })).toEqual([{ nodeId: '9:9' }]);
    expect(stageFrames(null, null)).toEqual([]);
  });

  it('does not judge states when the frames have no names', () => {
    const s = byId({ ...none, plan: '## States\n- Home: default', review: { runs: [run({ frames: ['1:1'] })] } });
    expect(s.build.checks[1]).toMatchObject({ state: 'unchecked', detail: 'The frames have no names to match states against' });
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

  it('counts only open issues and names the ones closed by hand', () => {
    const review = { runs: [run({ check: [{ ...finding('major'), id: 'a' }, { ...finding('blocking'), id: 'b' }, { ...finding('major'), id: 'c' }, { ...finding('minor'), id: 'd' }] })] };
    const triage = { 'r:a': { state: 'wontfix' as const, why: 'brand colour', at: 2 }, 'r:d': { state: 'fixed' as const, why: '', at: 2 }, 'old:b': { state: 'fixed' as const, why: '', at: 1 } };
    expect(byId({ ...none, review, triage }).validate.checks[1]).toMatchObject({ state: 'open', detail: "2 issues open, 1 won't fix" });
    const all = { ...triage, 'r:b': { state: 'fixed' as const, why: '', at: 3 }, 'r:c': { state: 'parked' as const, why: 'next release', at: 3 } };
    expect(byId({ ...none, review, triage: all }).validate.checks[1]).toMatchObject({ state: 'met', detail: "None open, 1 fixed, 1 won't fix, 1 parked" });
  });

  it('marks house rules as not checked when the review had none', () => {
    expect(byId({ ...none, review: { runs: [run()] } }).validate.checks[2].state).toBe('unchecked');
  });
});

describe('flow check on the Review step', () => {
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
  it('lets toast, note and loose screen issues through the gate, and names them', () => {
    const s = byId({ ...none, review: { runs: [run()] }, flowcheck: fc([flow('a', { toast: 1, 'long-note': 1 }, 'fail'), flow('b', {})]) });
    expect(s.validate.checks.at(-1)).toMatchObject({ state: 'met', detail: 'Flow check: wired, 2 other issues to tidy' });
  });
  it('keeps Prototype wired open while a flow named in Scope is not in the file', () => {
    const s = byId({ ...none, review: { runs: [run()] }, flowcheck: { ...fc([flow('a', {})]), missing: ['Checkout'] } });
    expect(s.validate.checks.at(-1)).toMatchObject({ state: 'open', detail: 'Flow check: not found in the file: Checkout' });
  });
  it('does not pass a clean run that read only part of a large file', () => {
    const s = byId({ ...none, review: { runs: [run()] }, flowcheck: { ...fc([flow('a', {})]), truncated: true } });
    expect(s.validate.checks.at(-1)).toMatchObject({ state: 'open', detail: 'Flow check: the file is too large to read in full, so some flows were not checked' });
  });
});

describe('research', () => {
  it('counts references and options in research.md', () => {
    const md = '# Saved items\n## Question\n- How do others save items?\n## Looked at\n- Ocado: lists\n  - nested note\n- Oda: hearts\n- Instacart: lists\n## Findings\n- a\n## Options\n1. A lists\n2. B hearts\n## Sources\n- x';
    expect(researchSummary(md)).toBe('3 references, 2 options');
    expect(researchSummary('Some notes')).toBe('Findings written');
  });
  it('is met once research.md exists, on Plan and on the Research step', () => {
    const s = byId({ ...none, research: '## Looked at\n- A' });
    expect(s.spec.checks[1]).toMatchObject({ state: 'met', detail: '1 reference', open: 'research' });
    expect(s.research.checks[0]).toMatchObject({ state: 'met', detail: '1 reference', open: 'research' });
  });
});

describe('stored steps', () => {
  it('cleans what it reads', () => {
    expect(cleanChatSteps({ kind: 'fix', marks: { build: { state: 'done', at: 1, note: ' ok ', round: 2 }, spec: { state: 'todo', at: 1 }, nope: { state: 'done', at: 1 }, validate: { state: 'x', at: 1 } } }))
      .toEqual({ kind: 'fix', marks: { build: { state: 'done', at: 1, note: 'ok', round: 2 }, spec: { state: 'todo', at: 1 } } });
    expect(cleanChatSteps({ kind: 'other' })).toEqual({ marks: {} });
    expect(cleanChatSteps([1])).toEqual({ marks: {} });
  });

  it('still reads old approvals', () => {
    expect(cleanApprovals({ spec: { at: 1, note: ' ' }, nope: { at: 2 }, build: { at: 'x' }, chats: {} })).toEqual({ spec: { at: 1 } });
    expect(cleanApprovals([1])).toEqual({});
  });
});

describe('approvalReply', () => {
  it('takes her short approvals and nothing longer', () => {
    for (const t of ['go', 'Go ahead', 'approved', 'A', 'option B', 'ok go', 'go, keep the voice button', 'go with A', 'Go with option B', 'lgtm', 'sure, go', 'okay go ahead']) expect(approvalReply(t)).toBe(t);
    for (const t of ['a lot of blue here', 'good morning', 'go through every dialog and list the ones with no close icon please']) expect(approvalReply(t)).toBeNull();
    // A bare yes or ok in the chat could answer any question, so the You said go check does not count it.
    for (const t of ['y', 'yes', 'ok', 'okay', 'sure', 'yes please', 'no', 'not yet']) expect(approvalReply(t)).toBeNull();
  });
  it('shows on Plan as information, with or without a written plan', () => {
    expect(byId({ ...none, approvedInChat: 'go' }).spec.checks.at(-1)).toMatchObject({ label: 'You said go', state: 'met', detail: '"go", no written plan' });
    expect(byId(none).spec.checks.at(-1)).toMatchObject({ state: 'unchecked' });
  });
  it('ticks when the plan was approved on its card, by a click or a typed go', () => {
    expect(byId({ ...none, planApproved: true }).spec.checks.at(-1)).toMatchObject({ label: 'You said go', state: 'met', detail: 'Approved on the plan card' });
  });
});

describe('planApprovedOnCard', () => {
  const plan = { id: 't1', kind: 'tool_use', name: 'ExitPlanMode' };
  it('counts a plan call whose result is not an error', () => {
    expect(planApprovedOnCard([plan, { id: 'r1', kind: 'tool_result', toolUseId: 't1', isError: false }])).toBe(true);
  });
  it('leaves out changes asked for, a plan still waiting and other tools', () => {
    expect(planApprovedOnCard([plan, { id: 'r1', kind: 'tool_result', toolUseId: 't1', isError: true }])).toBe(false);
    expect(planApprovedOnCard([plan])).toBe(false);
    expect(planApprovedOnCard([{ id: 't2', kind: 'tool_use', name: 'Bash' }, { id: 'r2', kind: 'tool_result', toolUseId: 't2', isError: false }])).toBe(false);
  });
  it('reads the latest brief from this chat\'s own events, not from when plan.md was saved', () => {
    const ok = (id: string) => ({ id: `r${id}`, kind: 'tool_result', toolUseId: id, isError: false });
    const card = (id: string) => ({ id, kind: 'tool_use', name: 'ExitPlanMode' });
    const ask = { id: 'u2', kind: 'user' };
    const writePlan = { id: 'w1', kind: 'tool_use', name: 'Write', input: { file_path: '/Users/r/DesignStudio/atlas-mvp/plan.md' } };
    const approved = [card('t1'), ok('t1')];
    // Another chat in the folder saving plan.md leaves no event here, so this chat's approval still ticks.
    expect(planApprovedOnCard(approved)).toBe(true);
    // Claude saving the approved plan to plan.md in the same turn keeps it.
    expect(planApprovedOnCard([...approved, writePlan])).toBe(true);
    // A newer message, then a new plan.md: the approval was for older work.
    expect(planApprovedOnCard([...approved, ask, writePlan])).toBe(false);
    // A newer plan card waiting, or one she asked to change, unticks the older approval.
    expect(planApprovedOnCard([...approved, ask, card('t3')])).toBe(false);
    expect(planApprovedOnCard([...approved, ask, card('t3'), { ...ok('t3'), isError: true }])).toBe(false);
    // A new plan approved after the new brief ticks again.
    expect(planApprovedOnCard([...approved, ask, writePlan, card('t3'), ok('t3')])).toBe(true);
    // The flow moving on to its sketch saved a new plan without a card: the older approval does not count.
    expect(planApprovedOnCard([...approved, { id: 'u3', kind: 'user', phase: 'sketch' }])).toBe(false);
    // Other files written after a new message leave it ticked.
    expect(planApprovedOnCard([...approved, ask, { ...writePlan, input: { file_path: '/x/research.md' } }])).toBe(true);
  });

});

describe('stageNote', () => {
  it('says nothing until she sets something', () => expect(stageNote(empty)).toBe(''));
  it('names the kind, the marks and the notes, and never asks Claude to hold back', () => {
    let c: ChatSteps = { kind: 'fix', marks: {} };
    c = markStep(markStep(markStep(c, 'spec', 'done', 1, 'Mobile only'), 'build', 'done', 2), 'build', 'again', 3);
    const t = stageNote(markStep(c, 'validate', 'skip', 4));
    expect(t).toContain('a guide only');
    expect(t).toContain('Fix across flows (Plan, Build, Review)');
    expect(t).toContain('Done: Plan.');
    expect(t).toContain('Not needed: Review.');
    expect(t).toContain('Started again: Build round 2.');
    expect(t).toContain('Notes: Plan: Mobile only');
    expect(t).not.toMatch(/ask before|wait|jumps ahead/i);
  });
  it('names a kind with nothing marked yet', () => expect(stageNote({ kind: 'review', marks: {} })).toContain('Review only (Review)'));
});

describe('stageLabel', () => {
  it('is empty until a step is done, then names the next one of a new flow', () => {
    expect(stageLabel({})).toBeNull();
    expect(stageLabel({ spec: { at: 1 } })).toBe('Sketch');
    expect(stageLabel(Object.fromEntries(KIND_INFO.new.steps.map((id) => [id, { at: 1 }])))).toBe('All done');
  });
});

describe('phaseLine', () => {
  it('names a run phase by its stage, with the phase as the sub-line', () => {
    expect(phaseLine('design')).toBe('Build: designing in Figma');
    expect(phaseLine('plan')).toBe('Plan: writing the plan');
    expect(phaseLine('pick')).toBe('Sketch: pick a direction');
    expect(phaseLine('fix')).toBe('Review: fixing issues');
  });

  it('keeps done and stopped as run states', () => {
    expect(phaseLine(null)).toBe('No design run');
    expect(phaseLine('done')).toBe('Design run done');
    expect(phaseLine('stopped')).toBe('Design run stopped');
  });

  it('maps phases onto the steps in order', () => {
    const order = ['spec', 'explore', 'build', 'validate'];
    const seen = Object.values(PHASE_STAGE).map((p) => order.indexOf(p.stage));
    expect(seen.every((i, k) => i >= 0 && (k === 0 || i >= seen[k - 1]))).toBe(true);
  });
});
