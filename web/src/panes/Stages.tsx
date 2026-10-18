import { useEffect, useState } from 'react';
import { api, getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { currentStage, type Stage, type StageCheck, type StageId, type StageOpen } from '../../../shared/stages';
import { insertPrompt } from './Files';
import { ScopeBox } from './Scope';
import '../stages.css';

const OPEN_LABEL: Record<StageOpen, string> = { sketch: 'Open Sketch', figma: 'Open Figma', review: 'Open Review', decisions: 'Open Decisions', report: 'Open report', attach: 'Attach file', research: 'Open research', states: 'Show states' };

function go(to: StageOpen) {
  if (to === 'report') window.open(api('/api/report'), '_blank');
  else if (to === 'attach') window.dispatchEvent(new Event('designstudio:attach'));
  else if (to === 'research') window.dispatchEvent(new Event('designstudio:research'));
  else if (to === 'states') window.dispatchEvent(new Event('designstudio:states'));
  else window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: `page:${to}` } }));
}

const FIX_ASK = 'Fix the blocking and major issues and the failed house rules from the last review. Plan the fixes first and wait for my approval.';
const PLAN_ASK = 'Plan this before building: screens, buttons, copy and states. Wait for my approval.';

/** The one thing to do next in a stage that is not ready yet. Fills the message box, never sends. */
export function nextStep(stage: Stage, brief: string): { label: string; run: () => void } | null {
  const missing = (label: string) => stage.checks.find((c) => c.label === label)?.state === 'open';
  const about = brief ? ` ${brief}` : '';
  switch (stage.id) {
    case 'spec':
      if (missing('Figma file attached')) return null;
      return missing('Brief written') ? { label: 'Describe the work in the message box', run: () => document.querySelector<HTMLTextAreaElement>('.cp textarea')?.focus() } : { label: 'Ask Claude for a plan', run: () => insertPrompt(PLAN_ASK) };
    case 'explore': return { label: 'Sketch directions', run: () => insertPrompt(`/sketch${about}`) };
    // Decide and the decisions check already link to where the work happens.
    case 'decide': return null;
    case 'build': return missing('Frames in Figma') ? { label: 'Design it in Figma', run: () => insertPrompt(`/design${about}`) } : null;
    case 'validate':
      if (missing('Review run')) return { label: 'Run a review', run: () => insertPrompt('/review') };
      if (missing('No blocking or major issues') || missing('House rules followed')) return { label: 'Ask Claude to fix the open issues', run: () => insertPrompt(FIX_ASK) };
      return null;
    case 'ship': return null;
  }
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => getJson<Stage[]>('/api/stages').then((l) => { if (alive) { setList(l); setError(''); } }).catch((e) => alive && setError(e.message)), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [chat, count, phase, figma, tick]);
  // Work done outside the chat, like a Flow check run, moves the gates too.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('designstudio:evidence', bump);
    return () => window.removeEventListener('designstudio:evidence', bump);
  }, []);
  const change = async (action: 'approve' | 'reopen', id: StageId, note?: string) => {
    try { setList(await postJson<Stage[]>('/api/stages', { action, id, note })); setError(''); window.dispatchEvent(new Event('designstudio:stages')); } catch (e) { setError((e as Error).message); }
  };
  return { list, error, change, reload: () => setTick((t) => t + 1) };
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

// Esc closes the panel and puts focus back on the Stages button. Fields handle their own Esc first.
function closeOnEscape(e: React.KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || (e.target as Element).closest('input, textarea, .dialog-overlay')) return;
  const btn = document.querySelector<HTMLButtonElement>('.stage-btn[aria-controls="stage-panel"]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
  btn.focus();
}

export function StagePanel({ list, error, change, reload }: ReturnType<typeof useStages> & { list: Stage[] }) {
  const now = currentStage(list);
  const [picked, setPicked] = useState<StageId | null>(null);
  const shown = list.find((s) => s.id === picked) ?? now ?? list[list.length - 1];
  const spec = list.find((s) => s.id === 'spec')?.checks[0];
  const brief = spec?.state === 'met' ? spec.detail : '';
  return (
    <section className="stage-panel" id="stage-panel" aria-label="Stages" onKeyDown={closeOnEscape}>
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
      <ScopeBox onChange={reload} />
      <Gate stage={shown} current={shown === now} brief={brief} onChange={change} />
      {error && <div className="error-text" role="alert">{error}</div>}
    </section>
  );
}

function Gate({ stage, current, brief, onChange }: { stage: Stage; current: boolean; brief: string; onChange: (a: 'approve' | 'reopen', id: StageId, note?: string) => void }) {
  const open = stage.checks.filter((c) => c.state === 'open').length;
  const next = nextStep(stage, brief);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setNoting(false); setNote(''); }, [stage.id]);
  // Approving with open checks needs a reason, so the gate never passes by a stray click.
  const needsNote = open > 0 && !note.trim();
  const approve = () => {
    if (needsNote) return setNoting(true);
    onChange('approve', stage.id, note);
  };
  return (
    <div className="gate">
      <div className="gate-head">
        <b>{stage.name}</b>
        <span className="muted">{stage.goal}</span>
      </div>
      {current && stage.state === 'open' && next && <p className="gate-next"><span className="muted">Next: </span><button className="link" onClick={next.run}>{next.label}</button></p>}
      <div className="gate-label">Passes when{open > 0 && <span className="gate-open"> · {open} not met yet</span>}</div>
      <ul className="gate-checks">{stage.checks.map((c, i) => <Check key={c.label} c={c} link={c.open !== stage.checks[i - 1]?.open} />)}</ul>
      {stage.approval?.note && <p className="gate-note"><span className="muted">Note: </span>{stage.approval.note}</p>}
      {current && noting && (
        <label className="gate-note-field">
          <span>{open > 0 ? <>Why approve with {open === 1 ? '1 check' : `${open} checks`} open?<span aria-hidden="true"> *</span></> : 'Note for Claude'}</span>
          <input autoFocus required={open > 0} value={note} maxLength={400} placeholder={open > 0 ? 'For example: the brief is in the Figma file' : 'For example: direction B, keep the voice button'} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) approve(); if (e.key === 'Escape') { setNoting(false); setNote(''); } }} />
          {open > 0 && <span className="muted gate-req">* Required</span>}
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
            {!noting && <button className="link" onClick={() => setNoting(true)}>Add a note</button>}
            <button disabled={noting && needsNote} title={noting && needsNote ? 'Write why first' : undefined} onClick={approve}>Approve {stage.name}</button>
          </span>
        ) : (
          <span className="muted">Opens after the stages before it are approved</span>
        )}
      </div>
    </div>
  );
}

// Checks in a row that open the same place share one link, on the first of them.
function Check({ c, link }: { c: StageCheck; link: boolean }) {
  return (
    <li className={`gate-check ${c.state}`}>
      <span className="gate-icon" aria-hidden="true">{c.state === 'met' ? <Icon name="check" small /> : c.state === 'open' ? <i /> : <Icon name="dash" small />}</span>
      <span className="gate-text">
        <span>{c.label}<span className="sr-only">{c.state === 'met' ? ': met' : c.state === 'open' ? ': not met' : ': not checked'}</span></span>
        <span className="muted">{c.detail}</span>
      </span>
      {c.open && link && <button className="link" onClick={() => go(c.open!)}>{OPEN_LABEL[c.open]}</button>}
    </li>
  );
}
