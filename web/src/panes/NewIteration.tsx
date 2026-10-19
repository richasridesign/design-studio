import { useReducer } from 'react';
import { postJson } from '../store';
import { PROJECTS_CHANGED, Shell } from './ProjectDialogs';
import { iterationLabel, vId, weekdayDate, type Iteration, type Project } from '../../../shared/project';
import { busy as isBusy, initial, isValid, payload, reduce, sectionPreview, shown, startFrom, type Event as DialogEvent, type FigmaOutcome, type State } from './newIterationState';
import '../newIteration.css';

// A new working iteration: project.json and the flow folders, then its section in Figma (800px above the newest
// one, a subsection per ticked flow with copies of its entry screens). The Figma step can fail on its own (Figma
// closed, plugin not connected): the iteration is kept and Retry makes only the section.

const withCwd = (path: string, cwd: string) => `${path}?cwd=${encodeURIComponent(cwd)}`;
const changed = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));

/** About 20 seconds: one plugin script through a short Claude call. An estimate to confirm on real files. */
const WAIT = 'Creating in Figma, about 20 seconds. Keep this open.';

export function NewIterationDialog({ cwd, name, project, onClose, onCreated }: { cwd: string; name: string; project: Project; onClose: () => void; onCreated?: (it: Iteration) => void }) {
  const [s, dispatch] = useReducer((st: State, e: DialogEvent) => reduce(st, e, project), project, (p) => initial(p));
  const f = s.fields;
  const err = shown(s, project);
  const valid = isValid(f, project);
  const busy = isBusy(s);
  const ph = s.phase;

  const submit = async () => {
    dispatch({ type: 'submit' });
    if (!valid) return;
    try {
      const r = await postJson<{ iteration: Iteration; figma: FigmaOutcome }>(withCwd('/api/projects/iteration', cwd), payload(f));
      changed();
      dispatch({ type: 'created', it: r.iteration, figma: r.figma });
      if (r.figma.ok) onCreated?.(r.iteration);
    } catch (e) {
      dispatch({ type: 'rejected', error: (e as Error).message });
    }
  };
  const retry = async (it: Iteration) => {
    dispatch({ type: 'retry' });
    try {
      const figma = await postJson<FigmaOutcome>(withCwd('/api/projects/iteration/sections', cwd), { id: it.id, flows: f.flows });
      changed();
      dispatch({ type: 'retried', figma });
      if (figma.ok) onCreated?.(it);
    } catch (e) {
      dispatch({ type: 'retried', figma: { ok: false, error: (e as Error).message } });
    }
  };

  if (ph.kind === 'done') {
    return (
      <Shell title={`New iteration on ${name}`} onClose={onClose}>
        <div className="project-dialog-body">
          <p className="project-dialog-note" role="status">
            Iteration {iterationLabel(ph.it)} is ready. Its section is in Figma above the newest one, with a subsection per flow.
            {ph.missing.length ? ` ${ph.missing.length} entry screen${ph.missing.length > 1 ? 's were' : ' was'} not found, so ${ph.missing.length > 1 ? 'they were' : 'it was'} not copied.` : ''}
          </p>
          <div className="dialog-actions"><button className="primary" autoFocus onClick={onClose}>Done</button></div>
        </div>
      </Shell>
    );
  }

  if (ph.kind === 'failed' || ph.kind === 'retrying') {
    return (
      <Shell title={`New iteration on ${name}`} onClose={onClose} busy={busy}>
        <div className="project-dialog-body">
          {ph.kind === 'failed' ? (
            <p className="project-dialog-note error-text" role="alert">Iteration {vId(ph.it.id)} is saved, but its Figma section was not made: {ph.error}</p>
          ) : (
            <p className="project-dialog-note ni-wait" role="status"><span className="ni-spin" aria-hidden="true" />{WAIT}</p>
          )}
          <p className="muted small ni-line">Retry makes only the section. If you close this, the first chat in {vId(ph.it.id)} makes it.</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>Close</button>
            <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void retry(ph.it)}>{busy ? 'Retrying…' : 'Retry'}</button>
          </div>
        </div>
      </Shell>
    );
  }

  const why = !valid ? Object.values(err).find(Boolean) || 'Fill in the required fields first' : undefined;
  return (
    <Shell title={`New iteration on ${name}`} onClose={onClose} busy={busy}>
      <form className="project-dialog-body" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        {ph.kind === 'form' && ph.error && <p className="project-dialog-note error-text" role="alert">{ph.error}</p>}
        <fieldset className="ni-fields" disabled={busy}>
          <div className="field">
            <span className="ni-label-row">
              <label htmlFor="ni-id">Id *</label>
              <button type="button" className="link" onClick={() => dispatch({ type: 'bump' })}>Bump major</button>
            </span>
            <input id="ni-id" value={f.id} inputMode="decimal" maxLength={9} required aria-invalid={err.id ? true : undefined} aria-describedby="ni-id-help"
              onChange={(e) => dispatch({ type: 'edit', field: 'id', value: e.target.value })} onBlur={() => dispatch({ type: 'leave', field: 'id' })} />
            <span id="ni-id-help" className={err.id ? 'error-text small' : 'muted small'}>{err.id || `Section: ${sectionPreview(f)}`}</span>
          </div>
          <label className="field">
            <span>Topic *</span>
            <input value={f.topic} maxLength={80} required aria-invalid={err.topic ? true : undefined} aria-describedby={err.topic ? 'ni-topic-err' : undefined}
              onChange={(e) => dispatch({ type: 'edit', field: 'topic', value: e.target.value })} onBlur={() => dispatch({ type: 'leave', field: 'topic' })} />
            {err.topic && <span id="ni-topic-err" className="error-text small">{err.topic}</span>}
          </label>
          <label className="field">
            <span>Date *</span>
            <input type="date" value={f.date} required aria-invalid={err.date ? true : undefined} aria-describedby="ni-date-help" onChange={(e) => dispatch({ type: 'edit', field: 'date', value: e.target.value })} />
            <span id="ni-date-help" className={err.date ? 'error-text small' : 'muted small'}>{err.date || weekdayDate(f.date)}</span>
          </label>
          <fieldset className="project-fields" aria-describedby={err.flows ? 'ni-flows-err' : undefined}>
            <legend>Flows in this iteration *</legend>
            {project.flows.map((fl) => (
              <label key={fl.slug} className="project-check"><input type="checkbox" checked={f.flows.includes(fl.slug)} onChange={() => dispatch({ type: 'toggle', slug: fl.slug })} /> {fl.n} · {fl.name}</label>
            ))}
            {err.flows && <span id="ni-flows-err" className="error-text small">{err.flows}</span>}
          </fieldset>
          {f.flows.length > 0 && <p className="muted small ni-line">Start from: {startFrom(project, f.flows)}. Entry screens are copied unchanged.</p>}
        </fieldset>
        {ph.kind === 'creating' ? <p className="project-dialog-note ni-wait" role="status"><span className="ni-spin" aria-hidden="true" />{WAIT}</p> : <p className="muted small">* Required</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !valid} title={busy ? undefined : why}>{busy ? 'Creating…' : 'Create iteration'}</button>
        </div>
      </form>
    </Shell>
  );
}
