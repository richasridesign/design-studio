import { useEffect, useRef, useState } from 'react';
import { api, getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { ago } from '../ago';
import { CHAT_KINDS, KIND_INFO, REPEATS, stepLine, type ChatKind, type Stage, type StageCheck, type StageId, type StageOpen, type StagesView, type StepAction } from '../../../shared/stages';
import { RECIPES } from '../../../shared/recipes';
import { focusComposer, insertPrompt } from './Files';
import { ScopeBox } from './Scope';
import { StateBox } from './StateMap';
import { IconButton } from '../Tip';
import { narrowNow } from '../touch';
import { useDialogFocus } from '../useDialog';
import '../stages.css';

const OPEN_LABEL: Record<StageOpen, string> = { sketch: 'Open Sketch', figma: 'Open Figma', review: 'Open Review', decisions: 'Open Decisions', report: 'Open handoff report', attach: 'Attach Figma file', research: 'Open research', states: 'Show states' };

function go(to: StageOpen) {
  if (to === 'report') window.open(api('/api/report'), '_blank');
  else if (to === 'attach') window.dispatchEvent(new Event('designstudio:attach'));
  else if (to === 'research') window.dispatchEvent(new Event('designstudio:research'));
  else if (to === 'states') window.dispatchEvent(new Event('designstudio:states'));
  else window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: `page:${to}` } }));
}

export const FIX_ASK = "Fix the blocking and major issues and the failed house rules from the last review. Skip the findings and rules I closed by hand (fixed, won't fix or parked). Plan the fixes first and wait for my approval.";
const PLAN_ASK = 'Plan this before building: screens, buttons, copy and states. Wait for my approval.';
const RESEARCH_ASK = RECIPES.find((r) => r.id === 'research')?.prompt ?? 'Research this before any design: ';

/** One way to move a step on. Fills the message box, never sends. */
export function nextStep(stage: Stage, brief: string): { label: string; run: () => void } | null {
  const missing = (label: string) => stage.checks.find((c) => c.label === label)?.state === 'open';
  const about = brief ? ` ${brief}` : '';
  switch (stage.id) {
    case 'spec':
      if (missing('Brief written')) return { label: 'Describe the work', run: focusComposer };
      return { label: 'Ask Claude for a plan', run: () => insertPrompt(PLAN_ASK) };
    case 'research': return missing('Research written') ? { label: 'Ask Claude to research it', run: () => insertPrompt(`${RESEARCH_ASK}${brief}`) } : null;
    case 'explore': return missing('Directions sketched') ? { label: 'Sketch directions', run: () => insertPrompt(`/sketch${about}`) } : null;
    case 'build': return missing('Frames in Figma') ? { label: 'Design it in Figma', run: () => insertPrompt(`/design${about}`) } : null;
    case 'validate':
      if (missing('Review run')) return { label: 'Run a review', run: () => insertPrompt('/review') };
      if (missing('No blocking or major issues') || missing('House rules followed')) return { label: 'Ask Claude to fix the open issues', run: () => insertPrompt(FIX_ASK) };
      return null;
    default: return null;
  }
}

export type StageChange = { action: StepAction; id: StageId; note?: string } | { action: 'kind'; kind: ChatKind | 'none' };

/** Loads the steps for the open chat and reloads when the chat moves on. */
export function useStages() {
  const chat = useStore((s) => s.session.id);
  const count = useStore((s) => s.events.length);
  const phase = useStore((s) => s.session.flow.phase);
  const figma = useStore((s) => s.session.figma?.key);
  const [view, setView] = useState<StagesView | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => getJson<StagesView>('/api/stages').then((v) => { if (alive) { setView(v); setError(''); } }).catch((e) => alive && setError(e.message)), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [chat, count, phase, figma, tick]);
  // Work done outside the chat, like a Flow check run, changes the checks too.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('designstudio:evidence', bump);
    return () => window.removeEventListener('designstudio:evidence', bump);
  }, []);
  const change = async (c: StageChange) => {
    try { setView(await postJson<StagesView>('/api/stages', c)); setError(''); window.dispatchEvent(new Event('designstudio:stages')); } catch (e) { setError((e as Error).message); }
  };
  return { view, error, change, reload: () => setTick((t) => t + 1) };
}

/**
 * Open or closed, remembered per chat. Closed by default, so the chat keeps its room.
 * On a phone the panel is a full-height sheet, so it always starts closed there: opening a chat never covers it.
 */
export function useStepsOpen() {
  const sid = useStore((s) => s.session.sessionId);
  const key = `designstudio.steps.${sid ?? 'new'}`;
  const read = () => { try { return !narrowNow() && localStorage.getItem(key) === '1'; } catch { return false; } };
  const [open, setOpen] = useState(read);
  useEffect(() => setOpen(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: boolean) => { setOpen(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch {} };
  return { open, toggle: () => set(!open), close: () => set(false) };
}

/** Phone: the steps open as a full-height sheet over the chat, with a heading, a close button, Esc and focus kept inside. */
export function StepsSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(true, box, onClose);
  return (
    <div className="steps-sheet-overlay" onClick={onClose}>
      <div ref={box} className="steps-sheet" role="dialog" aria-modal="true" aria-labelledby="steps-sheet-h" onClick={(e) => e.stopPropagation()}>
        <div className="steps-sheet-head">
          <h2 id="steps-sheet-h">Steps</h2>
          <IconButton label="Close steps" tip="Close" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="steps-sheet-body">{children}</div>
      </div>
    </div>
  );
}

const STATE_WORD: Record<Stage['state'], string> = { done: 'done', skipped: 'not needed', todo: 'to do' };

function Mark({ s }: { s: Pick<Stage, 'state' | 'next'> }) {
  return <span className={`step-mark ${s.state}${s.next ? ' next' : ''}`} aria-hidden="true">{s.state === 'done' ? <Icon name="check" small /> : s.state === 'skipped' ? <Icon name="dash" small /> : null}</span>;
}

/** The compact line in the chat header: a mark per step and the next one. A plain chat shows a quiet Steps button. */
export function StepsButton({ view, open, onToggle }: { view: StagesView; open: boolean; onToggle: () => void }) {
  const kind = view.kind;
  const line = stepLine(view.steps);
  const done = view.steps.filter((s) => s.state !== 'todo').length;
  const title = open ? 'Hide steps' : kind ? `Steps: ${done} of ${view.steps.length} done or not needed` : 'Show steps for this chat';
  return (
    <button className={`steps-btn${kind ? '' : ' plain'}`} aria-expanded={open} aria-controls="steps-panel" title={title} onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); onToggle(); } }}>
      {kind ? (
        <>
          <span className="steps-marks" aria-hidden="true">{view.steps.map((s) => <Mark key={s.id} s={s} />)}</span>
          <span className="steps-kind">{KIND_INFO[kind].label}<span aria-hidden="true"> ·</span></span>
          <span className="sr-only">, next: </span>
          <b>{line}</b>
        </>
      ) : <span>Steps</span>}
      <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
    </button>
  );
}

// Esc closes the panel and puts focus back on the Steps button. Fields handle their own Esc first.
function closeOnEscape(e: React.KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || (e.target as Element).closest('input, textarea, select, .dialog-overlay')) return;
  const btn = document.querySelector<HTMLButtonElement>('.steps-btn[aria-controls="steps-panel"]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
  btn.focus();
}

const KIND_CHOICES: Array<ChatKind | 'none'> = [...CHAT_KINDS, 'none'];
const kindLabel = (k: ChatKind | 'none') => (k === 'none' ? 'No steps' : KIND_INFO[k].label);

export function StepsPanel({ view, error, change, reload, sheet = false }: ReturnType<typeof useStages> & { view: StagesView; sheet?: boolean }) {
  const spec = view.steps.find((s) => s.id === 'spec')?.checks[0];
  const brief = spec?.state === 'met' ? spec.detail : '';
  const [shown, setShown] = useState<StageId | null>(null);
  useEffect(() => setShown(null), [view.kind]);
  const hasSpec = view.steps.some((s) => s.id === 'spec');
  const current = view.kind ?? 'none';
  return (
    <section className="steps-panel" id="steps-panel" aria-label={sheet ? undefined : 'Steps'} onKeyDown={sheet ? undefined : closeOnEscape}>
      <div className="steps-kind-row">
        <label htmlFor="steps-kind">Kind of work</label>
        <select id="steps-kind" value={current} aria-describedby={view.kind ? 'steps-guess' : undefined} onChange={(e) => change({ action: 'kind', kind: e.target.value as ChatKind | 'none' })}>
          {KIND_CHOICES.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
      </div>
      {view.kind && <p className="steps-hint" id="steps-guess">{view.guessed ? 'Guessed from your first message. ' : ''}A guide, not a gate: take the steps in any order.</p>}
      {view.kind ? (
        <ol className="steps-list">
          {view.steps.map((s) => (
            <Step key={s.id} s={s} open={shown === s.id} onOpen={() => setShown(shown === s.id ? null : s.id)} brief={brief} change={change}>
              {s.id === 'spec' && <ScopeBox onChange={reload} />}
              {s.id === 'build' && <StateBox />}
            </Step>
          ))}
        </ol>
      ) : (
        <p className="steps-hint">This chat shows no steps. Pick a kind above to see the steps it usually takes.</p>
      )}
      {/* Scope matters to every kind of work, so it stays in reach when the list has no Plan step. */}
      {!hasSpec && <div className="steps-scope"><ScopeBox onChange={reload} /></div>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </section>
  );
}

function Step({ s, open, onOpen, brief, change, children }: { s: Stage; open: boolean; onOpen: () => void; brief: string; change: (c: StageChange) => void; children?: React.ReactNode }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setNoting(false); setNote(''); }, [s.id, s.state]);
  const next = s.state === 'todo' ? nextStep(s, brief) : null;
  const met = s.checks.filter((c) => c.state === 'met').length;
  const counted = s.checks.filter((c) => c.state !== 'unchecked').length;
  const round = s.round > 1 ? `Round ${s.round}` : '';
  const meta = s.state === 'done' && s.mark ? `Done ${ago(s.mark.at)}` : s.state === 'skipped' ? 'Not needed' : s.mark && s.round < 2 ? `Reopened ${ago(s.mark.at)}` : counted ? `${met} of ${counted} checks met` : '';
  const done = () => change({ action: 'done', id: s.id, note });
  const bodyId = `step-${s.id}`;
  return (
    <li className={`step-row ${s.state}${s.next ? ' next' : ''}${open ? ' shown' : ''}`}>
      <button className="step-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onOpen}>
        <Mark s={s} />
        <span className="step-name">{s.name}<span className="sr-only">, {STATE_WORD[s.state]}{s.next ? ', next' : ''}</span></span>
        {(round || meta) && <span className="step-meta">{[round, meta].filter(Boolean).join(' · ')}{s.stale && <span className="step-stale"> · May be out of date</span>}</span>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </button>
      {/* Actions sit under the step they change: on the next step, and on any step she opens. The main action is a
          Secondary button and the other a Ghost button, so the two never share one weight. */}
      {(open || s.next) && (
        <div className="step-acts">
          {s.state === 'todo' && (
            <>
              <button className="step-btn" onClick={done}>Mark done</button>
              <button className="step-btn ghost" onClick={() => change({ action: 'skip', id: s.id })}>Not needed</button>
            </>
          )}
          {s.state === 'done' && REPEATS.includes(s.id) && <button className="step-btn" onClick={() => change({ action: 'again', id: s.id })}>Start round {s.round + 1}</button>}
          {s.state !== 'todo' && <button className={REPEATS.includes(s.id) && s.state === 'done' ? 'step-btn ghost' : 'step-btn'} onClick={() => change({ action: 'undo', id: s.id })}>Undo</button>}
        </div>
      )}
      {open && (
        <div className="step-body" id={bodyId}>
          <p className="step-goal">{s.goal}</p>
          {s.stale && <p className="step-stale-note">A step before this one was reopened or run again after you marked this done. Check it still holds, then mark it done again.</p>}
          {next && <p className="step-next"><span className="muted">Next: </span><button className="link" onClick={next.run}>{next.label}</button></p>}
          {s.checks.length > 0 && (
            <>
              <div className="step-label">What the app sees</div>
              <ul className="step-checks">{s.checks.map((c, i) => <Check key={c.label} c={c} link={c.open !== s.checks[i - 1]?.open} />)}</ul>
            </>
          )}
          {children}
          {s.mark?.note && <p className="step-note"><span className="muted">Note: </span>{s.mark.note}</p>}
          {s.state === 'todo' && (noting ? (
            <label className="step-note-field">
              <span>Note for Claude</span>
              <input autoFocus value={note} maxLength={400} placeholder="For example: option B, keep the voice button" onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) done(); if (e.key === 'Escape') { e.preventDefault(); setNoting(false); setNote(''); } }} />
              <span className="muted step-note-help">Saved with Mark done, and shown in the decision log.</span>
            </label>
          ) : <button className="link step-add-note" onClick={() => setNoting(true)}>Add a note</button>)}
        </div>
      )}
    </li>
  );
}

// Checks in a row that open the same place share one link, on the first of them.
function Check({ c, link }: { c: StageCheck; link: boolean }) {
  return (
    <li className={`step-check ${c.state}`}>
      <span className="step-check-icon" aria-hidden="true">{c.state === 'met' ? <Icon name="check" small /> : c.state === 'open' ? <i /> : <Icon name="dash" small />}</span>
      <span className="step-check-text">
        <span>{c.label}<span className="sr-only">{c.state === 'met' ? ': yes' : c.state === 'open' ? ': not yet' : ': not checked'}</span></span>
        <span className="muted">{c.detail}</span>
      </span>
      {c.open && link && <button className="link" onClick={() => go(c.open!)}>{OPEN_LABEL[c.open]}</button>}
    </li>
  );
}
