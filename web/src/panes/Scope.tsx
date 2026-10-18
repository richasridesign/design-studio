import { useEffect, useState } from 'react';
import { getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { scopeSummary, type Scope, type ScopeChange } from '../../../shared/scope';

const day = (at: number) => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** The chat's scope: flows the work must keep and features parked out of it. Claude and every review see it. */
export function ScopeBox({ onChange }: { onChange: () => void }) {
  const chat = useStore((s) => s.session.id);
  const [scope, setScope] = useState<Scope | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    getJson<Scope>('/api/scope').then((s) => alive && setScope(s)).catch(() => {});
    return () => { alive = false; };
  }, [chat]);
  // The Spec gate's "Edit scope" link opens this box.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('designstudio:scope', show);
    return () => window.removeEventListener('designstudio:scope', show);
  }, []);
  const change = async (c: ScopeChange) => {
    try {
      setScope(await postJson<Scope>('/api/scope', c));
      setError('');
      onChange();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  if (!scope) return null;
  return (
    <div className="scope">
      <div className="scope-head">
        <span>Scope: <b>{scope.flows.length || scope.parked.length ? scopeSummary(scope) : 'Not set'}</b></span>
        <button className="link" aria-expanded={open} aria-controls="scope-edit" onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit scope'}</button>
      </div>
      {open && <ScopeEdit scope={scope} change={change} />}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}

function ScopeEdit({ scope, change }: { scope: Scope; change: (c: ScopeChange) => Promise<boolean> }) {
  const [name, setName] = useState('');
  // Parking asks why first, so the dated note her process wants is never empty.
  const [parking, setParking] = useState<string | null>(null);
  const add = async () => { if (name.trim() && (await change({ action: 'add', name }))) setName(''); };
  return (
    <div className="scope-edit" id="scope-edit">
      <p className="muted">Claude keeps every flow here and keeps parked features out. Each review checks the parked ones.</p>
      <div className="scope-label">Flows in scope</div>
      {scope.flows.length > 0 && (
        <ul className="scope-list">
          {scope.flows.map((f) => (
            <li key={f}>
              <span className="scope-name">{f}</span>
              <button className="link" onClick={() => setParking(f)}>Park</button>
              <button className="icon-btn" title={`Remove ${f}`} aria-label={`Remove ${f}`} onClick={() => change({ action: 'remove', name: f })}><Icon name="close" small /></button>
            </li>
          ))}
        </ul>
      )}
      {parking !== null ? (
        <ParkForm name={parking} onCancel={() => setParking(null)} onPark={async (c) => { if (await change(c)) setParking(null); }} />
      ) : (
        <div className="scope-add">
          <input aria-label="Flow name" placeholder="For example: Checkout" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button onClick={add} disabled={!name.trim()}>Add flow</button>
          <button className="link" onClick={() => setParking('')}>Park a feature</button>
        </div>
      )}
      {scope.parked.length > 0 && (
        <>
          <div className="scope-label">Parked</div>
          <ul className="scope-list parked">
            {scope.parked.map((p) => (
              <li key={p.name}>
                <span className="scope-parked">
                  <span className="scope-name">{p.name}</span>
                  <span className="muted">Parked {day(p.at)}: {p.why}</span>
                  {p.restore && <span className="muted">To restore: {p.restore}</span>}
                </span>
                <button className="link" onClick={() => change({ action: 'restore', name: p.name })}>Restore</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ParkForm({ name: start, onPark, onCancel }: { name: string; onPark: (c: ScopeChange) => void; onCancel: () => void }) {
  const [name, setName] = useState(start);
  const [why, setWhy] = useState('');
  const [restore, setRestore] = useState('');
  const ready = name.trim() && why.trim();
  const submit = () => ready && onPark({ action: 'park', name, why, restore });
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); };
  return (
    <div className="scope-park" role="group" aria-label={start ? `Park ${start}` : 'Park a feature'}>
      {start ? <div className="scope-label">Park {start}</div> : (
        <label className="field"><span>Feature<span aria-hidden="true"> *</span></span><input autoFocus required value={name} maxLength={80} placeholder="For example: Gift cards" onChange={(e) => setName(e.target.value)} onKeyDown={keys} /></label>
      )}
      <label className="field"><span>Why it is parked<span aria-hidden="true"> *</span></span><input autoFocus={!!start} required value={why} maxLength={200} placeholder="For example: not in the MVP" onChange={(e) => setWhy(e.target.value)} onKeyDown={keys} /></label>
      <label className="field"><span>How to restore it</span><input value={restore} maxLength={200} placeholder="For example: add the button back on Home" onChange={(e) => setRestore(e.target.value)} onKeyDown={keys} /></label>
      <span className="muted scope-req">* Required</span>
      <div className="scope-park-foot">
        <button onClick={submit} disabled={!ready}>Park {start ? 'flow' : 'feature'}</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
