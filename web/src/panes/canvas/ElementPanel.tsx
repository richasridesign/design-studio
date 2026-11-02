import { useEffect, useState } from 'react';
import { postJson } from '../../store';
import { Icon } from '../../Icon';
import type { CanvasElement, CanvasOp } from '../../../../shared/canvas';

export type Picked = { frame: string; src: string; tag: string; element?: CanvasElement; error?: string };

export function ElementPanel({ picked, onEdited }: { picked: Picked; onEdited: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newAttr, setNewAttr] = useState({ name: '', value: '' });
  const el = picked.element;
  useEffect(() => setError(''), [picked.src]);

  const apply = async (op: CanvasOp) => {
    if (!el) return;
    setBusy(true);
    try {
      await postJson('/api/canvas/edit', { src: picked.src, tag: el.tag, op });
      setError('');
      onEdited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = picked.src.replace(/:\d+$/, '');
  return (
    <div className="cv-panel" aria-busy={busy}>
      <h2><code>&lt;{el?.tag ?? picked.tag}&gt;</code></h2>
      <p className="cv-src" title={picked.src}>{file}</p>
      {/^src\/components\//.test(file) && <p className="cv-note">This is inside a base component, so a change here applies to every use of it.</p>}
      {picked.error && <p className="cv-error" role="alert">{picked.error}</p>}
      {el && (
        <>
          {el.text !== null && <Field key={`text:${picked.src}:${el.text}`} label="Text" value={el.text} multiline onCommit={(v) => apply({ kind: 'text', value: v })} />}
          {el.attrs.map((a) =>
            a.kind === 'string' ? (
              <Field key={`${picked.src}:${a.name}:${a.value}`} label={a.name} value={a.value ?? ''} multiline={a.name === 'className'} mono={a.name === 'className'}
                onCommit={(v) => apply({ kind: 'attr', name: a.name, value: v })} onRemove={() => apply({ kind: 'attr', name: a.name, value: null })} />
            ) : a.kind === 'bool' ? (
              <div key={a.name} className="cv-field cv-row"><span>{a.name}</span><button className="ghost" onClick={() => apply({ kind: 'attr', name: a.name, value: null })}>Remove</button></div>
            ) : (
              <div key={a.name} className="cv-field"><span>{a.name}</span><code className="cv-expr" title="Set by code. Ask Claude to change it">{a.raw}</code></div>
            ),
          )}
          <form className="cv-add" onSubmit={(e) => { e.preventDefault(); if (newAttr.name) void apply({ kind: 'attr', name: newAttr.name.trim(), value: newAttr.value }).then(() => setNewAttr({ name: '', value: '' })); }}>
            <span>Add a property</span>
            <div className="cv-row">
              <input aria-label="Property name" placeholder="name" value={newAttr.name} onChange={(e) => setNewAttr({ ...newAttr, name: e.target.value })} />
              <input aria-label="Property value" placeholder="value" value={newAttr.value} onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })} />
              <button type="submit" disabled={!newAttr.name.trim()} aria-label="Add property"><Icon name="add" small /></button>
            </div>
          </form>
        </>
      )}
      {error && <p className="cv-error" role="alert">{error}</p>}
    </div>
  );
}

function Field({ label, value, multiline, mono, onCommit, onRemove }: { label: string; value: string; multiline?: boolean; mono?: boolean; onCommit: (v: string) => void; onRemove?: () => void }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v !== value) onCommit(v); };
  const props = {
    value: v,
    className: mono ? 'mono' : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') setV(value);
    },
  };
  return (
    <label className="cv-field">
      <span className="cv-row">{label}{onRemove && <button type="button" className="ghost cv-remove" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={onRemove}><Icon name="close" small /></button>}</span>
      {multiline ? <textarea rows={Math.min(5, Math.max(2, Math.ceil(v.length / 34)))} {...props} /> : <input {...props} />}
    </label>
  );
}
