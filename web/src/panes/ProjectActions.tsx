import { useEffect, useRef, useState } from 'react';
import { postJson } from '../store';
import { Icon } from '../Icon';
import { PROJECTS_CHANGED, Shell } from './ProjectDialogs';
import { tasksChanged } from './taskStore';
import { renameLabel } from '../../../shared/projectNames';
import { cleanProjectName, projectNameProblem } from '../../../shared/newProject';
import '../tasks.css';

// Project chores from the sidebar menu. Remove project moves the folder to .trash (nothing is deleted, Figma is
// not touched). Rename project changes only the name Design Studio shows. Rename to the convention renames the
// working iteration's sections in Figma.

const changed = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));
const withCwd = (p: string, cwd: string) => `${p}?cwd=${encodeURIComponent(cwd)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Phase<T> = { kind: 'ask' } | { kind: 'submitting' } | { kind: 'error'; text: string } | { kind: 'done'; r: T };

export function RemoveProjectDialog({ cwd, name, chats, tasks, onClose }: { cwd: string; name: string; chats: number; tasks: number; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase<{ to: string }>>({ kind: 'ask' });
  const busy = phase.kind === 'submitting';
  const go = async () => {
    setPhase({ kind: 'submitting' });
    try {
      const r = await postJson<{ to: string }>(withCwd('/api/projects/remove', cwd), {});
      changed();
      tasksChanged();
      setPhase({ kind: 'done', r });
    } catch (err) {
      setPhase({ kind: 'error', text: (err as Error).message });
    }
  };
  if (phase.kind === 'done') {
    return (
      <Shell title={`Removed ${name}`} onClose={onClose}>
        <p className="project-dialog-note" role="status">The folder is in the trash: {phase.r.to}. Move it back to restore the project.</p>
        <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Shell>
    );
  }
  return (
    <Shell title={`Remove ${name}?`} onClose={onClose} busy={busy}>
      <div className="project-dialog-body">
        {phase.kind === 'error' && <p className="project-dialog-note error-text" role="alert">{phase.text}</p>}
        <dl className="tk-facts tk-facts-top">
          <div><dt>Open chats</dt><dd>{chats ? `${plural(chats, 'chat')} close` : 'None'}</dd></div>
          <div><dt>Tasks</dt><dd>{tasks ? `${plural(tasks, 'open task')} stop` : 'None open'}</dd></div>
          <div><dt>Folder</dt><dd>Moves to .trash, nothing is deleted</dd></div>
          <div><dt>Figma</dt><dd>Not touched</dd></div>
        </dl>
        <div className="dialog-actions">
          <button autoFocus onClick={onClose} disabled={busy}>Cancel</button>
          <button className="destructive" onClick={() => void go()} disabled={busy}>{busy ? 'Removing…' : 'Remove project'}</button>
        </div>
      </div>
    </Shell>
  );
}

export function RenameDialog({ cwd, name, count, onClose }: { cwd: string; name: string; count: number; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase<{ renamed: number; missing: string[] }>>({ kind: 'ask' });
  const busy = phase.kind === 'submitting';
  const go = async () => {
    setPhase({ kind: 'submitting' });
    try {
      const r = await postJson<{ renamed: number; missing: string[] }>(withCwd('/api/projects/rename', cwd), {});
      setTimeout(changed, 30000);
      setPhase({ kind: 'done', r });
    } catch (err) {
      setPhase({ kind: 'error', text: (err as Error).message });
    }
  };
  if (phase.kind === 'done') {
    const { renamed, missing } = phase.r;
    return (
      <Shell title="Sections renamed" onClose={onClose}>
        <p className="project-dialog-note" role="status">
          Renamed {plural(renamed, 'section')} in Figma.{missing.length ? ` ${plural(missing.length, 'section was', 'sections were')} not found (${missing.join(', ')}).` : ''} The sidebar updates when the file map is read again, in about 30 seconds.
        </p>
        <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Shell>
    );
  }
  return (
    <Shell title={renameLabel(count)} onClose={onClose} busy={busy}>
      <div className="project-dialog-body">
        <p className="project-dialog-note">
          The working iteration's sections get their convention names in Figma, like "V1.19 · Flow 1 · Onboarding". Frozen versions keep their names.
        </p>
        {phase.kind === 'error' && <p className="project-dialog-note error-text" role="alert">{phase.text}</p>}
        {busy && <p className="muted small" role="status"><Icon name="loading" spin small /> Renaming in Figma, about 30 seconds.</p>}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" autoFocus onClick={() => void go()} disabled={busy}>{busy ? 'Renaming…' : phase.kind === 'error' ? 'Try again' : `Rename ${plural(count, 'section')}`}</button>
        </div>
      </div>
    </Shell>
  );
}

/** Rename project: the name in project.json only. The folder keeps its name, since saved chats are tied to it. */
export function RenameProjectDialog({ cwd, name, onClose, onRenamed }: { cwd: string; name: string; onClose: () => void; onRenamed?: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.select(), []);
  const folder = cwd.split('/').filter(Boolean).at(-1) ?? cwd;
  const clean = cleanProjectName(value);
  // Same rules as Add project. An empty name says so only on the button, not as an error.
  const live = clean ? projectNameProblem(value) : '';
  const shown = error || live;
  const why = !clean ? 'Type a project name first' : clean === name ? 'Change the name first' : live || undefined;
  const save = async () => {
    if (why || busy) return;
    setBusy(true);
    try {
      const r = await postJson<{ name: string }>(withCwd('/api/projects/name', cwd), { name: clean });
      changed();
      onRenamed?.(r.name);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Shell title="Rename project" onClose={onClose} busy={busy}>
      <form className="project-dialog-body rp-body" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field">
          <label htmlFor="rp-name">Project name <span aria-hidden="true">*</span></label>
          <input id="rp-name" ref={field} autoFocus required autoComplete="off" spellCheck={false} maxLength={80} value={value} readOnly={busy}
            aria-invalid={shown ? true : undefined} aria-describedby={shown ? 'rp-error rp-folder' : 'rp-folder'}
            onChange={(e) => { setValue(e.target.value); setError(''); }} />
          {shown && <span id="rp-error" className="error-text small"><Icon name="error" small /> {shown}</span>}
          <span id="rp-folder" className="muted small">The folder stays {folder}.</span>
        </div>
        <p className="muted small">* Required</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={Boolean(why) || busy} title={why}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Shell>
  );
}
