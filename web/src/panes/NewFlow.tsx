import { useReducer } from 'react';
import { postJson } from '../store';
import { PROJECTS_CHANGED, Shell } from './ProjectDialogs';
import type { Project } from '../../../shared/project';
import { busy as isBusy, initial, isValid, iterationFor, needsTopic, payload, reduce, shown, type Created, type Event as DialogEvent, type FigmaOutcome, type State } from './newFlowState';
import '../newIteration.css';

// New flow, from the project row menu: adds the flow (and project.json on a file that has none), its folders and its
// Figma subsection, then opens a chat on it. A new flow has no screens, so its chat starts From scratch at Explore.

const withCwd = (path: string, cwd: string) => `${path}?cwd=${encodeURIComponent(cwd)}`;
const changed = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));

/** About 20 seconds, like a new iteration: one plugin script through a short Claude call. An estimate to confirm. */
const WAIT = 'Creating in Figma, about 20 seconds. Keep this open.';

export function NewFlowDialog({ cwd, name, project, onClose, onCreated }: { cwd: string; name: string; project: Project | null; onClose: () => void; onCreated: (made: Created) => void }) {
  const [s, dispatch] = useReducer((st: State, e: DialogEvent) => reduce(st, e, project), undefined, initial);
  const f = s.fields;
  const err = shown(s, project);
  const valid = isValid(f, project);
  const busy = isBusy(s);
  const ph = s.phase;
  const topic = needsTopic(project);
  const iteration = iterationFor(project);
  const finish = (made: Created) => { onCreated(made); onClose(); };

  const submit = async () => {
    dispatch({ type: 'submit' });
    if (!valid) return;
    try {
      const made = await postJson<Created>(withCwd('/api/projects/flow', cwd), payload(f, project));
      changed();
      dispatch({ type: 'created', made });
      if (made.figma.ok) finish(made);
    } catch (e) {
      dispatch({ type: 'rejected', error: (e as Error).message });
    }
  };
  const retry = async (made: Created) => {
    dispatch({ type: 'retry' });
    try {
      const figma = await postJson<FigmaOutcome>(withCwd('/api/projects/iteration/sections', cwd), { id: made.iteration.id, flows: [made.flow.slug] });
      changed();
      dispatch({ type: 'retried', figma });
      if (figma.ok) finish({ ...made, figma });
    } catch (e) {
      dispatch({ type: 'retried', figma: { ok: false, error: (e as Error).message } });
    }
  };

  if (ph.kind === 'failed' || ph.kind === 'retrying') {
    const made = ph.made;
    return (
      <Shell title={`New flow on ${name}`} onClose={onClose} busy={busy}>
        <div className="project-dialog-body">
          {ph.kind === 'failed'
            ? <p className="project-dialog-note error-text" role="alert">Flow {made.flow.n} · {made.flow.name} is saved, but its Figma subsection was not made: {ph.error.replace(/[.\s]+$/, '')}.</p>
            : <p className="project-dialog-note ni-wait" role="status"><span className="ni-spin" aria-hidden="true" />{WAIT}</p>}
          <p className="muted small ni-line">Retry makes only the subsection. If you start the chat now, Claude makes it.</p>
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => finish(made)}>Start the chat</button>
            <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void retry(made)}>{busy ? 'Retrying…' : 'Retry'}</button>
          </div>
        </div>
      </Shell>
    );
  }

  const why = !valid ? Object.values(shown({ ...s, seen: { name: true, topic: true } }, project)).find(Boolean) : undefined;
  return (
    <Shell title={`New flow on ${name}`} onClose={onClose} busy={busy}>
      <form className="project-dialog-body" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <p className="project-dialog-note">Starts From scratch: Claude explores 2 or 3 low fidelity options in this flow first.</p>
        {ph.kind === 'form' && ph.error && <p className="project-dialog-note error-text" role="alert">{ph.error}</p>}
        <fieldset className="ni-fields" disabled={busy}>
          <div className="field">
            <label htmlFor="nf-name">Flow name *</label>
            <input id="nf-name" value={f.name} maxLength={80} required data-autofocus autoComplete="off" aria-invalid={err.name ? true : undefined} aria-describedby="nf-name-help"
              readOnly={busy} onChange={(e) => dispatch({ type: 'edit', field: 'name', value: e.target.value })} onBlur={() => dispatch({ type: 'leave', field: 'name' })} />
            <span id="nf-name-help" className={err.name ? 'error-text small' : 'muted small'}>{err.name || `Flow ${Math.max(0, ...(project?.flows ?? []).map((x) => x.n)) + 1} in ${name}`}</span>
          </div>
          {topic && (
            <div className="field">
              <label htmlFor="nf-topic">Iteration topic *</label>
              <input id="nf-topic" value={f.topic} maxLength={80} required autoComplete="off" aria-invalid={err.topic ? true : undefined} aria-describedby="nf-topic-help"
                readOnly={busy} onChange={(e) => dispatch({ type: 'edit', field: 'topic', value: e.target.value })} onBlur={() => dispatch({ type: 'leave', field: 'topic' })} />
              <span id="nf-topic-help" className={err.topic ? 'error-text small' : 'muted small'}>{err.topic || (project ? `Iteration: ${iteration}. No iteration is working, so this starts one.` : `Iteration: ${iteration}, the first in this file.`)}</span>
            </div>
          )}
          {!topic && <p className="muted small ni-line">Iteration: {iteration}</p>}
        </fieldset>
        {ph.kind === 'creating' ? <p className="project-dialog-note ni-wait" role="status"><span className="ni-spin" aria-hidden="true" />{WAIT}</p> : <p className="muted small">* Required</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !valid} title={busy ? undefined : why}>{busy ? 'Creating…' : 'Create flow'}</button>
        </div>
      </form>
    </Shell>
  );
}
