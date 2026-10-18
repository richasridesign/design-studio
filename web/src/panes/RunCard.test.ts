import { describe, expect, it } from 'vitest';
import { flowOff, type FlowPhase, type FlowState } from '../../../shared/design';
import { runRows } from './RunCard';

const flow = (phase: FlowPhase | null, over: Partial<FlowState> = {}): FlowState => ({ ...flowOff(), mode: 'design', phase, ...over });

describe('runRows', () => {
  it('is null when idle, done or stopped', () => {
    for (const p of [null, 'done', 'stopped'] as const) expect(runRows(flow(p))).toBeNull();
  });

  it('marks earlier steps done and the current one now', () => {
    const run = runRows(flow('review', { round: 1, preset: 'quick', tokens: 12000 }))!;
    expect(run.title).toBe('Design run');
    expect(run.rows.map((r) => r.state)).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(run.rows[4].detail).toBe('Review 1 · Quick');
    expect(run.tokens).toBe(12000);
    expect(run.waiting).toBe(false);
  });

  it('shows three rows for a sketch run', () => {
    const run = runRows(flow('plan', { kind: 'sketch' }))!;
    expect(run.title).toBe('Sketch run');
    expect(run.rows.map((r) => r.label)).toEqual(['Spec', 'Explore', 'Decide']);
    expect(run.rows[0].detail).toBe('Writing the plan');
  });

  it('waits on the Decide row when picking', () => {
    const run = runRows(flow('pick'))!;
    expect(run.waiting).toBe(true);
    expect(run.rows[1]).toMatchObject({ label: 'Explore', state: 'done' });
    expect(run.rows[2]).toMatchObject({ label: 'Decide', state: 'now' });
    expect(run.rows[3].state).toBe('idle');
  });

  it('waits on the Build row when there is no Figma file', () => {
    const run = runRows(flow('file'))!;
    expect(run.waiting).toBe(true);
    expect(run.rows.map((r) => r.state)).toEqual(['done', 'done', 'done', 'now', 'idle']);
    expect(run.rows[3]).toMatchObject({ label: 'Build', detail: 'Waiting for a Figma file' });
  });

  it('lists reviewers under the Validate row', () => {
    const run = runRows(flow('review', { reviewers: [{ area: 'check', state: 'pass' }, { area: 'all', state: 'running' }, { area: 'spacing', state: 'fail' }] }))!;
    expect(run.rows[4].subs).toEqual([
      { label: 'Design system check', state: 'pass' },
      { label: 'All areas', state: 'running' },
      { label: 'Spacing and layout', state: 'fail' },
    ]);
    expect(run.rows[3].subs).toBeUndefined();
  });

  it('has no sub-rows without reviewers or outside Validate', () => {
    expect(runRows(flow('review'))!.rows[4].subs).toBeUndefined();
    expect(runRows(flow('design', { reviewers: [{ area: 'check', state: 'running' }] }))!.rows[3].subs).toBeUndefined();
    expect(runRows(flow('design'))!.rows[3].detail).toBe('Designing in Figma');
  });
});
