import { Fragment } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { AREA_NAMES, FLOW_ACTIVE, PRESET_INFO, type FlowPhase, type FlowState, type ReviewerState } from '../../../shared/design';
import { PHASE_STAGE, STAGE_INFO } from '../../../shared/stages';

// Rows use the step names from the Steps panel; the phase is the row's sub-line.
const STEPS: Array<{ label: string; phases: FlowPhase[] }> = (['spec', 'explore', 'build', 'validate'] as const).map((id) => ({
  label: STAGE_INFO[id].name,
  phases: (Object.keys(PHASE_STAGE) as Array<keyof typeof PHASE_STAGE>).filter((p) => PHASE_STAGE[p].stage === id),
}));
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export type RunSubRow = { label: string; state: ReviewerState['state'] };
export type RunRow = { label: string; state: 'done' | 'now' | 'idle'; detail?: string; subs?: RunSubRow[] };

const areaLabel = (a: ReviewerState['area']) => (a === 'check' ? 'Design system check' : a === 'all' ? 'All areas' : AREA_NAMES[a]);

export function runRows(flow: FlowState): { title: string; rows: RunRow[]; tokens: number; waiting: boolean } | null {
  const phase = flow.phase;
  if (!phase || (!FLOW_ACTIVE.includes(phase) && phase !== 'pick' && phase !== 'file')) return null;
  const at = STEPS.findIndex((s) => s.phases.includes(phase));
  const detail = phase === 'pick' ? 'Pick directions on the Sketch tab'
    : phase === 'file' ? 'Waiting for a Figma file'
    : phase === 'fix' ? `Fixing round ${flow.round}`
    : phase === 'review' ? `Review ${flow.round} · ${PRESET_INFO[flow.preset].label}`
    : cap(PHASE_STAGE[phase as keyof typeof PHASE_STAGE].doing);
  // A sketch run stops once a direction is picked.
  const steps = flow.kind === 'sketch' ? STEPS.slice(0, 2) : STEPS;
  const rows = steps.map((s, i): RunRow => (i < at ? { label: s.label, state: 'done' } : i === at ? { label: s.label, state: 'now', detail, ...(s.label === STAGE_INFO.validate.name && flow.reviewers?.length ? { subs: flow.reviewers.map((r) => ({ label: areaLabel(r.area), state: r.state })) } : {}) } : { label: s.label, state: 'idle' }));
  return { title: flow.kind === 'sketch' ? 'Sketch run' : 'Design run', rows, tokens: flow.tokens, waiting: phase === 'pick' || phase === 'file' };
}

export function RunCard() {
  const flow = useStore((s) => s.session.flow);
  const stopping = useStore((s) => s.session.stopping);
  const run = runRows(flow);
  if (!run) return null;
  return (
    <div className="run-card">
      <div className="run-head">
        <b>{run.title}</b>
        {run.tokens > 0 && <span className="run-tokens">{Math.round(run.tokens / 1000)}k tokens</span>}
      </div>
      <ol className="run-rows">
        {run.rows.map((r) => (
          <Fragment key={r.label}>
            <li className={r.state}>
              <span className="mark">{r.state === 'done' ? <Icon name="check" small /> : <i className="dot" />}</span>
              <span>{r.label}</span>
              {r.detail && <span className="detail">{r.detail}</span>}
            </li>
            {r.subs?.map((s) => (
              <li key={s.label} className={`sub ${s.state}`}>
                <span className="mark">{s.state === 'running' ? <Icon name="loading" small spin /> : s.state === 'pass' ? <Icon name="check" small /> : s.state === 'fail' ? <Icon name="close" small /> : null}</span>
                <span>{s.label}</span>
                {s.state === 'error' && <span className="detail">failed</span>}
              </li>
            ))}
          </Fragment>
        ))}
      </ol>
      <div className="run-acts">
        {flow.phase === 'file' ? (
          <>
            <button className="primary" onClick={() => window.dispatchEvent(new Event('designstudio:attach'))}>Attach Figma file</button>
            <button disabled={stopping} onClick={() => send({ type: 'interrupt' })}>Stop</button>
          </>
        ) : run.waiting ? (
          <button className="primary" onClick={() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:sketch' } }))}>Open Sketch</button>
        ) : (
          <button disabled={stopping} onClick={() => send({ type: 'interrupt' })}>Stop</button>
        )}
      </div>
    </div>
  );
}
