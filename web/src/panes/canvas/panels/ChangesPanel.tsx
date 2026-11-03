import { useEffect, useState } from 'react';
import { getJson, postJson } from '../../store';
import { Icon } from '../../Icon';
import type { CanvasChanges } from '../../../../shared/canvas';

// What the canvas changed in the app's code: this session's edits (the newest can be undone, also with Cmd+Z), the
// files with uncommitted changes and their diffs, and a commit. Commits stay in the app's own repo on this Mac.

export function ChangesPanel({ changes, reload, undo, close }: { changes: CanvasChanges | null; reload: () => Promise<unknown>; undo: () => Promise<void>; close: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDiff('');
    getJson<{ diff: string }>(`/api/canvas/diff?file=${encodeURIComponent(open)}`).then((r) => setDiff(r.diff), (e) => setDiff(e.message));
  }, [open, changes]);

  const run = async (go: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await go();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const commit = () => run(async () => {
    await postJson('/api/canvas/commit', { message: message || defaultMessage(changes) });
    setMessage('');
    setOpen(null);
  });

  const files = changes?.files ?? [];
  const edits = changes?.edits ?? [];
  return (
    <div className="cv-panel" aria-busy={busy}>
      <h2 className="cv-row">Changes<button className="ghost cv-remove" aria-label="Close changes" title="Close" onClick={close}><Icon name="close" small /></button></h2>
      {!files.length && !edits.length && <p className="cv-muted">No changes to the app since the last commit.</p>}
      {edits.length > 0 && (
        <section className="cv-group">
          <div className="cv-row"><span className="cv-label">Edits on the canvas</span><button className="ghost" onClick={() => run(undo)} title="Undo the last edit (Cmd+Z)">Undo last</button></div>
          <ol className="cv-edits">{edits.slice(0, 12).map((e) => <li key={e.at}>{e.label}</li>)}</ol>
        </section>
      )}
      {files.length > 0 && (
        <section className="cv-group">
          <span className="cv-label">Files</span>
          <ul className="cv-files">
            {files.map((f) => (
              <li key={f.file}>
                <button className={`cv-file${open === f.file ? ' active' : ''}`} aria-expanded={open === f.file} onClick={() => setOpen(open === f.file ? null : f.file)}>
                  <span className="cv-file-name" title={f.file}>{f.file.replace(/^src\//, '')}</span>
                  <span className="cv-stat">{f.state === 'new' ? 'new' : f.state === 'deleted' ? 'deleted' : <><ins>+{f.added}</ins> <del>-{f.removed}</del></>}</span>
                </button>
                {open === f.file && (
                  <>
                    <pre className="cv-diff">{diff.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).map((l, i) => <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l}</span>)}</pre>
                    {confirm === f.file
                      ? <div className="cv-row"><span className="cv-muted">Throw away these changes?</span><button className="danger" onClick={() => run(async () => { await postJson('/api/canvas/discard', { file: f.file }); setConfirm(null); setOpen(null); })}>Discard</button><button className="ghost" onClick={() => setConfirm(null)}>Keep</button></div>
                      : <button className="danger" onClick={() => setConfirm(f.file)}>Discard changes to this file</button>}
                  </>
                )}
              </li>
            ))}
          </ul>
          <label className="cv-field">
            <span>Commit message</span>
            <textarea rows={2} value={message} placeholder={defaultMessage(changes)} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <button className="primary" onClick={commit} disabled={busy}>Commit</button>
          <p className="cv-muted">Saved in the app's own history on this Mac. Nothing is pushed.</p>
        </section>
      )}
      {error && <p className="cv-error" role="alert">{error}</p>}
    </div>
  );
}

const defaultMessage = (c: CanvasChanges | null) => {
  const labels = (c?.edits ?? []).map((e) => e.label);
  return labels.length ? `Canvas: ${labels.slice(0, 5).join('; ')}${labels.length > 5 ? `; and ${labels.length - 5} more` : ''}` : 'Canvas edits';
};
