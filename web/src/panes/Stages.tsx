import { useEffect, useState } from 'react';
import { api, getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { currentStage, type Stage, type StageCheck, type StageId, type StageOpen } from '../../../shared/stages';
import '../stages.css';

const OPEN_LABEL: Record<StageOpen, string> = { sketch: 'Open Sketch', figma: 'Open Figma', review: 'Open Review', decisions: 'Open Decisions', report: 'Open report', attach: 'Attach file' };

function go(to: StageOpen) {
  if (to === 'report') window.open(api('/api/report'), '_blank');
  else if (to === 'attach') window.dispatchEvent(new Event('designstudio:attach'));
  else window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: `page:${to}` } }));
}

function ago(at: number) {
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Loads the stages for the open chat and reloads when the chat moves on. */
export function useStages() {
  const chat = useStore((s) => s.session.id);
  const count = useStore((s) => s.events.length);
  const phase = useStore((s) => s.session.flow.phase);
  const figma = useStore((s) => s.session.figma?.key);
  const [list, setList] = useState<Stage[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => getJson<Stage[]>('/api/stages').then((l) => { if (alive) { setList(l); setError(''); } }).catch((e) => alive && setError(e.message)), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [chat, count, phase, figma]);
  const change = async (action: 'approve' | 'reopen', id: StageId, note?: string) => {
    try { setList(await postJson<Stage[]>('/api/stages', { action, id, note })); setError(''); } catch (e) { setError((e as Error).message); }
  };
  return { list, error, change };
}

export function StageButton({ list, open, onToggle }: { list: Stage[]; open: boolean; onToggle: () => void }) {
  const now = currentStage(list);
  const i = now ? list.indexOf(now) + 1 : list.length;
  return (
    <button className={`stage-btn ${now?.state ?? 'approved'}`} aria-expanded={open} aria-controls="stage-panel" title={open ? 'Hide stages' : 'Show stages and what passes each gate'} onClick={onToggle}>
      <span className="stage-mark" aria-hidden="true" />
      <span>{now ? <><span className="stage-long">Stage {i} of {list.length}: </span><span className="stage-short" aria-hidden="true">{i}/{list.length} </span><b>{now.name}</b></> : <b>All stages approved</b>}</span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
    </button>
  );
}

export function StagePanel({ list, error, change }: ReturnType<typeof useStages> & { list: Stage[] }) {
  const now = currentStage(list);
  const [picked, setPicked] = useState<StageId | null>(null);
  const shown = list.find((s) => s.id === picked) ?? now ?? list[list.length - 1];
  return (
    <section className="stage-panel" id="stage-panel" aria-label="Stages">
      <ol className="stage-rail">
        {list.map((s, i) => (
          <li key={s.id} className={`${s.state} ${s.id === shown.id ? 'shown' : ''}`}>
            <button title={s.name} aria-current={s === now ? 'step' : undefined} aria-pressed={s.id === shown.id} onClick={() => setPicked(s.id)}>
              <span className="stage-mark" aria-hidden="true">{s.state === 'approved' && <Icon name="check" small />}</span>
              <span className="stage-name">{s.name}</span>
              <span className="sr-only">{s.state === 'approved' ? ', approved' : s === now ? ', current stage' : ', later'}</span>
            </button>
            {i < list.length - 1 && <span className="stage-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <Gate stage={shown} current={shown === now} onChange={change} />
      {error && <div className="error-text" role="alert">{error}</div>}
    </section>
  );
}

function Gate({ stage, current, onChange }: { stage: Stage; current: boolean; onChange: (a: 'approve' | 'reopen', id: StageId, note?: string) => void }) {
  const open = stage.checks.filter((c) => c.state === 'open').length;
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setNoting(false); setNote(''); }, [stage.id]);
  return (
    <div className="gate">
      <div className="gate-head">
        <b>{stage.name}</b>
        <span className="muted">{stage.goal}</span>
      </div>
      <div className="gate-label">Passes when</div>
      <ul className="gate-checks">{stage.checks.map((c) => <Check key={c.label} c={c} />)}</ul>
      {stage.approval?.note && <p className="gate-note"><span className="muted">Note: </span>{stage.approval.note}</p>}
      {current && noting && (
        <label className="gate-note-field">
          <span>Note for Claude</span>
          <input autoFocus value={note} maxLength={400} placeholder="For example: direction B, keep the voice button" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onChange('approve', stage.id, note); if (e.key === 'Escape') { setNoting(false); setNote(''); } }} />
        </label>
      )}
      <div className="gate-foot">
        <span className="muted">Approves: <b>You</b></span>
        {stage.state === 'approved' && stage.approval ? (
          <span className="gate-done">
            Approved {ago(stage.approval.at)}
            <button className="link" onClick={() => onChange('reopen', stage.id)}>Reopen</button>
          </span>
        ) : current ? (
          <span className="gate-act">
            {open > 0 && <span className="muted">{open === 1 ? '1 check is not met yet' : `${open} checks are not met yet`}</span>}
            {!noting && <button className="link" onClick={() => setNoting(true)}>Add a note</button>}
            <button onClick={() => onChange('approve', stage.id, note)}>Approve {stage.name}</button>
          </span>
        ) : (
          <span className="muted">Opens after the stages before it are approved</span>
        )}
      </div>
    </div>
  );
}

function Check({ c }: { c: StageCheck }) {
  return (
    <li className={`gate-check ${c.state}`}>
      <span className="gate-icon" aria-hidden="true">{c.state === 'met' ? <Icon name="check" small /> : c.state === 'open' ? <i /> : <Icon name="dash" small />}</span>
      <span className="gate-text">
        <span>{c.label}<span className="sr-only">{c.state === 'met' ? ': met' : c.state === 'open' ? ': not met' : ': not checked'}</span></span>
        <span className="muted">{c.detail}</span>
      </span>
      {c.open && <button className="link" onClick={() => go(c.open!)}>{OPEN_LABEL[c.open]}</button>}
    </li>
  );
}
