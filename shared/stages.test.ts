import { describe, expect, it } from 'vitest';
import { PHASE_STAGE, approvalReply, phaseLine, planApprovedOnCard, stageFrames } from './stages.js';

describe('approvalReply', () => {
  it('takes her short approvals and nothing longer', () => {
    for (const t of ['go', 'Go ahead', 'approved', 'A', 'option B', 'ok go', 'go, keep the voice button', 'go with A', 'Go with option B', 'lgtm', 'sure, go', 'okay go ahead']) expect(approvalReply(t)).toBe(t);
    for (const t of ['a lot of blue here', 'good morning', 'go through every dialog and list the ones with no close icon please']) expect(approvalReply(t)).toBeNull();
    // A bare yes or ok in the chat could answer any question, so the You said go check does not count it.
    for (const t of ['y', 'yes', 'ok', 'okay', 'sure', 'yes please', 'no', 'not yet']) expect(approvalReply(t)).toBeNull();
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

describe('stageFrames', () => {
  it('reads frames from design.json, or from the last review when it has none', () => {
    expect(stageFrames({ frames: [{ nodeId: '1:2', screen: 'Cart' }] } as never, null)).toEqual([{ nodeId: '1:2', screen: 'Cart' }]);
    expect(stageFrames(null, { runs: [{ frames: ['3:4'] }] } as never)).toEqual([{ nodeId: '3:4' }]);
    expect(stageFrames(null, null)).toEqual([]);
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
