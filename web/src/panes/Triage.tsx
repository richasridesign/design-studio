import { useEffect, useId, useRef, useState } from 'react';
import { getJson, postJson, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { AREA_NAMES, type Area } from '../../../shared/design';
import { TRIAGE_LABEL, TRIAGE_STATES, needsWhy, type ClosedFinding, type Triage, type TriageChange, type TriageState } from '../../../shared/triage';
import { showNode } from './Files';

const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SEV: Record<string, string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };

/** The open chat's triage.json. Saving tells the Stages gate to reload. */
export function useTriage() {
  const chat = useStore((s) => s.session.id);
  const rev = useRev('triage.json');
  const [triage, setTriage] = useState<Triage>({});
  useEffect(() => {
    let alive = true;
    getJson<Triage>('/api/triage').then((t) => alive && setTriage(t)).catch(() => {});
    return () => { alive = false; };
  }, [chat, rev]);
  const change = async (c: TriageChange) => {
    setTriage(await postJson<Triage>('/api/triage', c));
    window.dispatchEvent(new Event('designstudio:evidence'));
  };
  return { triage, change };
}

/** Inline form under a finding: Fixed, Won't fix or Parked, with a why for the last two. Enter saves, Esc cancels. */
export function CloseForm({ rule, onSave, onCancel }: { rule: string; onSave: (state: TriageState, why: string) => Promise<void>; onCancel: () => void }) {
  const [state, setState] = useState<TriageState | null>(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { first.current?.focus(); }, []);
  const asks = !!state && needsWhy(state);
  const ready = !!state && (!asks || !!why.trim()) && !saving;
  const save = async () => {
    if (!ready || !state) return;
    setSaving(true);
    try {
      await onSave(state, asks ? why : '');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); save(); }
  };
  return (
    <div className="triage-form" role="group" aria-label={`Close finding: ${rule}`} onKeyDown={keys}>
      <fieldset>
        <legend>Close as</legend>
        <div className="triage-choices">
          {TRIAGE_STATES.map((s, i) => (
            <label key={s} className="triage-choice">
              <input ref={i === 0 ? first : undefined} type="radio" name={`${id}-state`} value={s} checked={state === s} onChange={() => setState(s)} />
              <span>{TRIAGE_LABEL[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {asks && (
        <>
          <label className="field">
            <span>Why<span aria-hidden="true"> *</span></span>
            <input required value={why} maxLength={200} aria-describedby={`${id}-req`} placeholder={state === 'parked' ? 'For example: next release' : 'For example: the brand colour is set by marketing'} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <span id={`${id}-req`} className="muted triage-req">* Required</span>
        </>
      )}
      {error && <div className="error-text" role="alert">{error}</div>}
      <div className="triage-foot">
        <button disabled={!ready} onClick={save}>Close finding</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Findings closed by hand, collapsed at the bottom of a run. Each one can be reopened. */
export function ClosedGroup({ closed, grouped, onReopen, headRef }: { closed: Array<ClosedFinding & { key: string }>; grouped: (f: ClosedFinding) => boolean; onReopen: (key: string, rule: string) => void; headRef: React.RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const bodyId = `closed-${useId()}`;
  if (!closed.length) return null;
  return (
    <section className="area-card triage-closed">
      <header>
        <button ref={headRef} type="button" className="area-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          <span className="area-title"><span className="t">Closed by hand ({closed.length})</span></span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
        </button>
      </header>
      {open && (
        <ul className="findings" id={bodyId}>
          {closed.map((f) => (
            <li key={f.key}>
              <span className={`tri ${f.triage.state}`}>{TRIAGE_LABEL[f.triage.state]}</span>
              <div className="f-body">
                <div className="f-rule">{f.rule}</div>
                <div className="f-fix">{[`Was: ${SEV[f.severity] ?? f.severity}`, f.triage.why && `Why: ${f.triage.why}`, `Closed: ${day(f.triage.at)}`].filter(Boolean).join(' · ')}</div>
                <div className="f-foot">
                  <button className="link" onClick={() => showNode(f.node)}>{grouped(f) ? `${AREA_NAMES[f.area as Area] ?? f.area} · ` : ''}{f.nodeName ?? f.node}</button>
                  <button className="triage-link" aria-label={`Reopen finding: ${f.rule}`} onClick={() => onReopen(f.key, f.rule)}>Reopen</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
