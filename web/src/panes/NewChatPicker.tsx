import { useState } from 'react';
import { Icon } from '../Icon';
import { iterationLabel, type Project } from '../../../shared/project';
import { send } from '../store';
import { Shell } from './ProjectDialogs';
import { defaultIteration, iterationsFor, needsCopy, startFlowChat, vId } from './chatPlaceState';
import '../chatPlace.css';

// The project row "+": where the new chat works. No flow is a project-wide chat, as the "+" was before; a flow picks
// its iteration, the newest working one by default. A frozen iteration opens read only. One primary action.

const NONE = '';

export function NewChatPicker({ cwd, name, project, onClose, onNewFlow, onNote }: {
  cwd: string;
  name: string;
  project: Project | null;
  onClose: () => void;
  onNewFlow: () => void;
  /** The chat started, with something to say in the sidebar (its Figma subsection was not made). */
  onNote: (text: string) => void;
}) {
  const flows = project?.flows ?? [];
  const [slug, setSlug] = useState(NONE);
  const flow = flows.find((f) => f.slug === slug) ?? null;
  const its = project && flow ? iterationsFor(project, flow.slug) : [];
  const [picked, setPicked] = useState<Record<string, string>>({});
  const it = its.find((x) => x.id === picked[slug]) ?? defaultIteration(its);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = Boolean(flow && !it);

  const start = async () => {
    if (busy || blocked) return;
    if (!flow || !it) {
      send({ type: 'new_session', cwd });
      return onClose();
    }
    setBusy(true);
    setError('');
    try {
      const warn = await startFlowChat(cwd, flow, it);
      if (warn) onNote(warn);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(`${flow.name} was not added to ${vId(it.id)}: ${(e as Error).message}`);
    }
  };

  const note = !flow || !it ? null
    : busy ? null
    : it.state === 'frozen' ? `${vId(it.id)} is frozen: this chat reads it but cannot change it in Figma.`
    : needsCopy(it, flow.slug) ? `${flow.name} is not in ${vId(it.id)} yet. Starting copies its entry screens into a new subsection first, about 20 seconds.`
    : null;

  return (
    <Shell title={`New chat in ${name}`} onClose={onClose} busy={busy}>
      <form className="project-dialog-body ncp" onSubmit={(e) => { e.preventDefault(); void start(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLInputElement).type === 'radio') { e.preventDefault(); void start(); } }}>
        <fieldset className="ncp-group" disabled={busy}>
          <legend>Flow</legend>
          <label className="ncp-opt">
            <input type="radio" name="ncp-flow" checked={slug === NONE} data-autofocus={slug === NONE || undefined} onChange={() => setSlug(NONE)} />
            <span className="ncp-name">No flow (whole project)</span>
          </label>
          {flows.map((f) => (
            <label key={f.slug} className="ncp-opt">
              <input type="radio" name="ncp-flow" checked={slug === f.slug} onChange={() => setSlug(f.slug)} />
              <span className="ncp-name">{f.n} · {f.name}</span>
            </label>
          ))}
          <button type="button" className="ncp-new" onClick={onNewFlow}><Icon name="add" small /><span>New flow…</span></button>
        </fieldset>
        {flow && (
          <fieldset className="ncp-group" disabled={busy}>
            <legend>Iteration</legend>
            {its.map((x) => (
              <label key={x.id} className="ncp-opt">
                <input type="radio" name="ncp-it" checked={it?.id === x.id} onChange={() => setPicked({ ...picked, [slug]: x.id })} />
                <span className="ncp-name">V{iterationLabel(x)}</span>
                <span className={`ncp-state ${x.state}`}><span className={`state-dot ${x.state}`} aria-hidden />{x.state === 'working' ? 'Working' : 'Frozen, read only'}</span>
              </label>
            ))}
            {!its.length && <p className="muted small ncp-line">No iteration yet. Add one from the project menu: New iteration.</p>}
          </fieldset>
        )}
        {busy && flow && it && <p className="ncp-line ni-wait" role="status"><span className="ni-spin" aria-hidden="true" />Adding {flow.name} to {vId(it.id)} in Figma, about 20 seconds.</p>}
        {note && <p className="muted small ncp-line" role="status">{note}</p>}
        {error && <p className="error-text small ncp-line" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy} aria-disabled={blocked || undefined} title={blocked ? 'This flow has no iteration yet' : undefined}>{busy ? 'Starting…' : 'Start chat'}</button>
        </div>
      </form>
    </Shell>
  );
}
