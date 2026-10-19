import { useEffect, useState } from 'react';
import { api, getJson, postJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { WORKFLOW_INFO, type CardAction, type StepCard, type StepId, type StepView, type WorkflowState } from '../../../shared/workflow';
import type { Project } from '../../../shared/project';
import { focusComposer, insertPrompt } from './composerEvents';
import { AdoptDialog, NewIterationDialog, PROJECTS_CHANGED, Shell } from './ProjectDialogs';
import '../workflow.css';

// The workflow strip and the step card above a flow chat: which step the flow's iteration is at, and the one next
// action. Steps are a guide, never a gate: any step can be made current. The card's copy comes from the server
// (shared/workflow.ts STEP_CARDS), so this file only renders it and runs the button.

export type FlowView = {
  scope: 'flow';
  root: string;
  project: Project;
  flow: { n: number; name: string; slug: string };
  iteration: { id: string; state: 'working' | 'frozen' };
  state: WorkflowState;
  steps: StepView[];
  card: StepCard;
  label: string | null;
  screens: { frames: Array<{ id: string; name: string }> };
};
export type WorkflowView = { scope: 'none' } | { scope: 'unadopted'; root: string; name: string } | FlowView;

type Post = { action: 'step' | 'done' | 'skip' | 'ask'; step: StepId } | { action: 'again' } | { action: 'switch'; workflow: WorkflowState['workflow'] } | { action: 'pick'; id: 'A' | 'B' | 'C'; why?: string };

/** The view for the open chat. Reloads when workflow.json or review.json change, and when a review starts or ends. */
export function useWorkflow() {
  const chat = useStore((s) => s.session.id);
  const rev = useRev('workflow.json');
  const reviewRev = useRev('review.json');
  const reviewing = useStore((s) => (s.session.flow.reviewers ?? []).some((r) => r.state === 'running'));
  const preset = useStore((s) => s.session.flow.preset);
  const [view, setView] = useState<WorkflowView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    getJson<WorkflowView>('/api/workflow').then((v) => { if (alive) { setView(v); setError(''); } }).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [chat, rev, reviewRev, reviewing, preset]);
  useEffect(() => setView(null), [chat]);
  const post = async (body: Post) => {
    const v = await postJson<WorkflowView>('/api/workflow', body);
    setView(v);
    setError('');
    // The project row tag in the sidebar reads the step too.
    window.dispatchEvent(new Event('designstudio:stages'));
    return v;
  };
  return { view, error, setError, post };
}

const STATE_WORD: Record<StepView['state'], string> = { current: 'current step', done: 'done', skipped: 'not needed', todo: 'to do' };

function Mark({ state }: { state: StepView['state'] }) {
  return (
    <span className={`wf-mark ${state}`} aria-hidden="true">
      {state === 'done' ? <Icon name="check" small /> : state === 'skipped' ? <Icon name="dash" small /> : null}
    </span>
  );
}

/** One row: the workflow's name, then its steps as text buttons, and the round once it is above 1. */
export function WorkflowStrip({ view, onStep, disabled }: { view: FlowView; onStep: (s: StepId) => void; disabled?: boolean }) {
  const round = view.state.round;
  return (
    <nav className="wf-strip" aria-label={`Workflow: ${WORKFLOW_INFO[view.state.workflow].name}`}>
      <span className="wf-name">{WORKFLOW_INFO[view.state.workflow].name}</span>
      <ol className="wf-steps">
        {view.steps.map((s, i) => (
          <li key={s.id} className={`wf-step ${s.state}`}>
            {i > 0 && <Icon name="chevron-right" small />}
            <button
              className="wf-step-btn"
              aria-current={s.state === 'current' ? 'step' : undefined}
              disabled={disabled}
              title={s.state === 'current' ? `${s.name} is the current step` : `Make ${s.name} the current step`}
              onClick={() => s.state !== 'current' && onStep(s.id)}
            >
              <Mark state={s.state} />
              <span className="wf-step-n" aria-hidden="true">{i + 1}</span>
              <span className="wf-step-name">{s.name}</span>
              <span className="sr-only">, {STATE_WORD[s.state]}</span>
            </button>
          </li>
        ))}
      </ol>
      {round > 1 && <span className="wf-round">Round {round}</span>}
    </nav>
  );
}

/** Which step a card action asks Claude for, and the short message she sees in the chat. */
const ASKS: Partial<Record<CardAction, { step: StepId; text: (v: FlowView) => string }>> = {
  'plan-updates': { step: 'update', text: (v) => `Plan the updates for Flow ${v.flow.n} · ${v.flow.name}.` },
  explore: { step: 'explore', text: (v) => `Explore options for Flow ${v.flow.n} · ${v.flow.name}.` },
  build: { step: 'hifi', text: (v) => `Build the picked option of Flow ${v.flow.n} · ${v.flow.name} in high fidelity.` },
  system: { step: 'system', text: (v) => `Make the design system for Flow ${v.flow.n} · ${v.flow.name}.` },
};
/** Actions that send a message: they wait while Claude is in a turn. */
const SENDS = new Set<CardAction>(['review', 'review-again', ...(Object.keys(ASKS) as CardAction[])]);

/** The strip, the step card and their dialogs, for the chat's flow. Nothing for chats that are not on a flow. */
export function WorkflowPanel() {
  const { view, error, setError, post } = useWorkflow();
  const running = useStore((s) => s.session.running);
  // A permission, question or plan card is up: the step card's button steps back to Secondary.
  const busy = useStore((s) => s.pending.length > 0);
  const fileName = useStore((s) => s.session.figma?.name ?? 'this file');
  const [dialog, setDialog] = useState<'freeze' | 'next' | 'adopt' | null>(null);
  const [working, setWorking] = useState(false);

  if (!view || view.scope === 'none') return null;
  if (view.scope === 'unadopted') {
    return (
      <div className="wf">
        <div className="wf-card">
          <p className="wf-line">Adopt this file to use the workflows. Until then, chat works as usual.</p>
          <div className="wf-acts"><button onClick={() => setDialog('adopt')}>Adopt this file</button></div>
        </div>
        {dialog === 'adopt' && <AdoptDialog cwd={view.root} name={view.name} onClose={() => setDialog(null)} />}
      </div>
    );
  }

  const v = view;
  const card = v.card;
  const run = async (fn: () => Promise<unknown>) => {
    setWorking(true);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  };
  const act = (a: CardAction) => {
    const ask = ASKS[a];
    if (ask) return run(async () => { await post({ action: 'ask', step: ask.step }); send({ type: 'prompt', text: ask.text(v) }); });
    switch (a) {
      case 'review': return run(async () => { await post({ action: 'step', step: 'review' }); send({ type: 'prompt', text: '/review' }); });
      case 'review-again': return run(async () => { await post({ action: 'again' }); send({ type: 'prompt', text: '/review' }); });
      case 'mark-done': return run(() => post({ action: 'done', step: v.state.step }));
      case 'skip-system': return run(() => post({ action: 'skip', step: 'system' }));
      case 'switch-review-update': return run(() => post({ action: 'switch', workflow: 'review-update' }));
      case 'feedback': return focusComposer();
      case 'pick-screens': return insertPrompt('/review ');
      case 'open-review': return window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:review' } }));
      case 'freeze': return setDialog('freeze');
      case 'next-iteration': return setDialog('next');
      case 'adopt': return setDialog('adopt');
    }
  };
  const wait = (a: CardAction) => running && SENDS.has(a);
  const b = card.button;
  const primary = b?.primary && !busy;

  return (
    <div className="wf">
      <WorkflowStrip view={v} disabled={working} onStep={(step) => void run(() => post({ action: 'step', step }))} />
      <div className="wf-card" aria-live="polite">
        <p className="wf-line">{card.line}</p>
        {(b || card.link) && (
          <div className="wf-acts">
            {b && (
              <button
                className={primary ? 'primary' : undefined}
                aria-disabled={wait(b.action) || working || undefined}
                title={wait(b.action) ? 'Wait for Claude to finish this turn' : undefined}
                onClick={() => !wait(b.action) && !working && void act(b.action)}
              >
                {working ? 'Starting…' : b.label}
              </button>
            )}
            {card.link && <button className="link" onClick={() => void act(card.link!.action)}>{card.link.label}</button>}
          </div>
        )}
        {error && <p className="error-text small" role="alert">{error}</p>}
      </div>
      {dialog === 'freeze' && <FreezeDialog view={v} onClose={() => setDialog(null)} />}
      {dialog === 'next' && (
        <NewIterationDialog
          cwd={v.root}
          name={fileName}
          project={v.project}
          onClose={() => setDialog(null)}
          onCreated={(it) => send({ type: 'new_session', cwd: v.root, flow: v.flow.slug, iteration: it.id })}
        />
      )}
    </div>
  );
}

type Phase = { kind: 'ready' } | { kind: 'saving' } | { kind: 'error'; text: string };

/** Freezes the whole iteration (every flow in it), then reads the Decision stickies into History. */
function FreezeDialog({ view, onClose }: { view: FlowView; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const id = view.iteration.id;
  const busy = phase.kind === 'saving';
  const freeze = async () => {
    setPhase({ kind: 'saving' });
    try {
      await postJson(`/api/projects/iteration?cwd=${encodeURIComponent(view.root)}`, { id, state: 'frozen' });
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
      // Best effort: History shows the last sync and says so when Figma cannot be read.
      void fetch(api('/api/history/sync'), { method: 'POST' }).catch(() => {});
      onClose();
    } catch (e) {
      setPhase({ kind: 'error', text: (e as Error).message });
    }
  };
  return (
    <Shell title={`Freeze ${id}?`} onClose={onClose} busy={busy}>
      <div className="project-dialog-body">
        <p>Every flow in {id} becomes read only. Chats can still read {id} but not change it.</p>
        {phase.kind === 'error' && <p className="project-dialog-note error-text" role="alert">Could not freeze: {phase.text}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void freeze()}>{busy ? 'Freezing…' : 'Freeze'}</button>
        </div>
      </div>
    </Shell>
  );
}
