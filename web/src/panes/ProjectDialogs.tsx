import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { useDialogFocus } from '../useDialog';
import { getJson, postJson } from '../store';
import { cleanId, iterationLabel, nextIterationId, weekdayDate, todayIso, type AdoptProposal, type Flow, type Iteration, type Project } from '../../../shared/project';

// Adopting a Figma file (its sections become flows and iterations) and starting a new iteration. Both run from the
// chat list's project menu on any project folder, so each call names the folder with ?cwd=.

export const PROJECTS_CHANGED = 'designstudio:projects';
const changed = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));
const withCwd = (path: string, cwd: string) => `${path}?cwd=${encodeURIComponent(cwd)}`;

function Shell({ title, onClose, children, busy }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(true, box, () => busy || onClose());
  return (
    <div className="overlay dialog-overlay" onClick={() => busy || onClose()}>
      <div ref={box} className="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy || undefined} onClick={(e) => e.stopPropagation()}>
        <div className="project-dialog-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" aria-label="Close" title="Close" disabled={busy} onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Proposal = AdoptProposal & { adopted: Project | null };
type Phase = { kind: 'loading' } | { kind: 'waiting'; text: string } | { kind: 'error'; text: string } | { kind: 'ready' } | { kind: 'submitting' } | { kind: 'done'; flows: number; iterations: number; tagError: string | null };

/**
 * Reads the proposal from the saved file map, lets the designer name the flows, and writes project.json. Nothing
 * in Figma moves: the sections only get a plugin data tag so Design Studio finds them after a cut and paste.
 */
export function AdoptDialog({ cwd, name, onClose }: { cwd: string; name: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const tries = useRef(0);

  const load = () => {
    setPhase({ kind: 'loading' });
    getJson<Proposal>(withCwd('/api/projects/adopt', cwd))
      .then((p) => {
        setProposal(p);
        setNames(p.flows.map((f) => f.name));
        setPhase({ kind: 'ready' });
      })
      .catch((err: Error) => {
        // The map is read in the background the first time: wait for it a few times before giving up.
        if (/being read/.test(err.message) && tries.current++ < 6) { setPhase({ kind: 'waiting', text: err.message }); setTimeout(load, 6000); } else setPhase({ kind: 'error', text: err.message });
      });
  };
  useEffect(load, [cwd]);

  const problems = names.map((n) => (n.trim() ? '' : 'Give this flow a name'));
  const valid = proposal !== null && names.length > 0 && problems.every((p) => !p);
  const submit = async () => {
    setTouched(true);
    if (!valid || !proposal) return;
    setPhase({ kind: 'submitting' });
    try {
      const r = await postJson<{ project: Project; tagError: string | null }>(withCwd('/api/projects/adopt', cwd), {
        page: proposal.page,
        flows: proposal.flows.map((f, i) => ({ ...f, name: names[i].trim() })),
        iterations: proposal.iterations.map((it) => ({ id: it.id, node: it.node, name: it.name, topic: it.topic, date: it.date, flows: it.flows })),
        parked: proposal.parked,
      });
      changed();
      setPhase({ kind: 'done', flows: r.project.flows.length, iterations: r.project.iterations.length, tagError: r.tagError });
    } catch (err) {
      setPhase({ kind: 'error', text: (err as Error).message });
    }
  };
  const busy = phase.kind === 'submitting';
  const again = proposal?.adopted ? 'again' : '';

  return (
    <Shell title={`Adopt ${name}`} onClose={onClose} busy={busy}>
      {phase.kind === 'loading' && <p className="project-dialog-note" role="status">Reading the file map…</p>}
      {phase.kind === 'waiting' && <p className="project-dialog-note" role="status"><Icon name="loading" spin small /> {phase.text}</p>}
      {phase.kind === 'error' && (
        <>
          <p className="project-dialog-note error-text" role="alert">{phase.text}</p>
          <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={load}>Try again</button></div>
        </>
      )}
      {phase.kind === 'done' && (
        <>
          <p className="project-dialog-note" role="status">Adopted: {phase.flows} flows, {phase.iterations} iterations. {phase.tagError ? `The sections were not tagged yet (${phase.tagError}). They are tagged the next time a chat edits the file.` : 'The sections are tagged in Figma.'}</p>
          <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
        </>
      )}
      {(phase.kind === 'ready' || busy) && proposal && (
        <form className="project-dialog-body" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <p className="project-dialog-note">
            {proposal.page ? `Page: ${proposal.page.name}. ` : ''}
            Flows are the subsections of LATEST, iterations the dated sections. Nothing moves or is renamed in Figma: each section gets a tag so Design Studio keeps finding it.
            {proposal.adopted ? ' This file is adopted already: adopting again rewrites its flow list and keeps the iterations made since.' : ''}
          </p>
          <fieldset className="project-fields">
            <legend>Flows ({proposal.flows.length})</legend>
            {proposal.flows.length === 0 && <p className="project-dialog-note error-text">No LATEST section with flow subsections was found. Name the flows in Figma first.</p>}
            {proposal.flows.map((f, i) => {
              const bad = touched && problems[i];
              return (
                <label key={f.n} className="field project-flow">
                  <span>Flow {f.n} *</span>
                  <input value={names[i] ?? ''} aria-invalid={bad ? true : undefined} aria-describedby={bad ? `flow-err-${f.n}` : undefined} required maxLength={80} onChange={(e) => setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))} />
                  <span className="muted small">{f.entry.length ? `${f.entry.length} entry screen${f.entry.length > 1 ? 's' : ''}` : 'No entry screen found'}{f.baseline ? `, baseline ${f.baseline}` : ''}</span>
                  {bad && <span id={`flow-err-${f.n}`} className="error-text small">{bad}</span>}
                </label>
              );
            })}
          </fieldset>
          <fieldset className="project-fields">
            <legend>Iterations ({proposal.iterations.length})</legend>
            <ul className="project-list">
              {proposal.iterations.map((it) => (
                <li key={it.id}><span className="state-tag frozen">Frozen</span><span className="name">{iterationLabel(it)}{it.date ? `, ${weekdayDate(it.date)}` : ''}</span><span className="muted small">{it.screens} screens</span></li>
              ))}
            </ul>
            <p className="muted small">{proposal.parked ? 'Parked section found. ' : ''}{proposal.skipped.length ? `${proposal.skipped.length} other sections stay outside the flows.` : ''}</p>
          </fieldset>
          <p className="muted small">* Required</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !proposal.flows.length}>{busy ? 'Adopting…' : `Adopt ${again}`.trim()}</button>
          </div>
        </form>
      )}
    </Shell>
  );
}

type NewPhase = { kind: 'form' } | { kind: 'submitting' } | { kind: 'error'; text: string } | { kind: 'done'; it: Iteration };

/** A new working iteration: its id, topic and the flows it covers. Folders are made now, the Figma section with the first chat. */
export function NewIterationDialog({ cwd, name, project, onClose }: { cwd: string; name: string; project: Project; onClose: () => void }) {
  const [id, setId] = useState(nextIterationId(project));
  const [topic, setTopic] = useState('');
  const [flows, setFlows] = useState<string[]>(project.flows.map((f) => f.slug));
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<NewPhase>({ kind: 'form' });
  const idErr = !cleanId(id) ? 'Use major.minor, like 1.19' : project.iterations.some((it) => it.id === cleanId(id)) ? `Iteration ${cleanId(id)} exists already` : '';
  const topicErr = topic.trim() ? '' : 'Give the iteration a topic';
  const flowsErr = flows.length ? '' : 'Pick at least one flow';
  const valid = !idErr && !topicErr && !flowsErr;
  const busy = phase.kind === 'submitting';
  const date = todayIso();
  const toggle = (f: Flow) => setFlows((prev) => (prev.includes(f.slug) ? prev.filter((s) => s !== f.slug) : [...prev, f.slug]));
  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setPhase({ kind: 'submitting' });
    try {
      const it = await postJson<Iteration>(withCwd('/api/projects/iteration', cwd), { id: cleanId(id), topic: topic.trim(), date, flows });
      changed();
      setPhase({ kind: 'done', it });
    } catch (err) {
      setPhase({ kind: 'error', text: (err as Error).message });
    }
  };
  return (
    <Shell title={`New iteration on ${name}`} onClose={onClose} busy={busy}>
      {phase.kind === 'done' && (
        <>
          <p className="project-dialog-note" role="status">Iteration {iterationLabel(phase.it)} is ready. Its Figma section is made when its first chat starts, 800px above the newest one.</p>
          <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
        </>
      )}
      {phase.kind !== 'done' && (
        <form className="project-dialog-body" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          {phase.kind === 'error' && <p className="project-dialog-note error-text" role="alert">{phase.text}</p>}
          <label className="field">
            <span>Id *</span>
            <input value={id} inputMode="decimal" maxLength={9} aria-invalid={touched && idErr ? true : undefined} aria-describedby="it-id-help" onChange={(e) => setId(e.target.value)} />
            <span id="it-id-help" className={touched && idErr ? 'error-text small' : 'muted small'}>{(touched && idErr) || `Section name: V${cleanId(id) ?? id} · ${topic.trim() || 'Topic'} · ${weekdayDate(date)}`}</span>
          </label>
          <label className="field">
            <span>Topic *</span>
            <input value={topic} maxLength={80} aria-invalid={touched && topicErr ? true : undefined} aria-describedby={touched && topicErr ? 'it-topic-err' : undefined} onChange={(e) => setTopic(e.target.value)} />
            {touched && topicErr && <span id="it-topic-err" className="error-text small">{topicErr}</span>}
          </label>
          <fieldset className="project-fields" aria-describedby={touched && flowsErr ? 'it-flows-err' : undefined}>
            <legend>Flows in this iteration *</legend>
            {project.flows.map((f) => (
              <label key={f.slug} className="project-check"><input type="checkbox" checked={flows.includes(f.slug)} onChange={() => toggle(f)} /> {f.n} · {f.name}</label>
            ))}
            {touched && flowsErr && <span id="it-flows-err" className="error-text small">{flowsErr}</span>}
          </fieldset>
          <p className="muted small">* Required</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create iteration'}</button>
          </div>
        </form>
      )}
    </Shell>
  );
}
