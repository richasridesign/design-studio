import { useState } from 'react';
import { postJson } from '../store';
import { Icon } from '../Icon';
import { Shell } from './ProjectDialogs';
import { iterationLabel, vId, workingIteration, type Project } from '../../../shared/project';
import { DEFAULT_TASK_MODEL, TASK_MODELS, mentionsComponents, type Task } from '../../../shared/tasks';
import { tasksChanged, weeklyLine } from './taskStore';
import '../tasks.css';

// One prompt, one chat per flow in the working iteration. A few run at once (Parallel chats in Settings), the rest
// wait their turn, and the run pauses at the weekly cap. Opus is the default model.

type Phase = { kind: 'form' } | { kind: 'submitting' } | { kind: 'error'; text: string } | { kind: 'done'; task: Task };

export function RunAcrossFlowsDialog({ cwd, name, project, weeklyPct, cap, parallel, onClose, onOpenTask }: {
  cwd: string;
  name: string;
  project: Project;
  weeklyPct: number | null;
  cap: number;
  parallel: number;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const it = workingIteration(project);
  const inIt = new Set(Object.keys(it?.flows ?? {}));
  // Flows with a subsection in the iteration are ticked; when none has one yet, every flow is.
  const [flows, setFlows] = useState<string[]>(project.flows.filter((f) => !inIt.size || inIt.has(f.slug)).map((f) => f.slug));
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_TASK_MODEL);
  const [components, setComponents] = useState(false);
  const [componentsTouched, setComponentsTouched] = useState(false);
  const [promptTouched, setPromptTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const usage = weeklyLine(weeklyPct, cap);
  const first = componentsTouched ? components : mentionsComponents(prompt);
  const promptErr = prompt.trim() ? '' : 'Write the prompt first';
  const flowsErr = flows.length ? '' : 'Pick at least one flow';
  const why = !it ? 'There is no working iteration' : usage.blocked ? 'Weekly usage is above the cap' : promptErr || flowsErr;
  const busy = phase.kind === 'submitting';
  const chats = flows.length + (first ? 1 : 0);
  const now = Math.min(first ? 1 : parallel, chats);
  const toggle = (slug: string) => setFlows((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : project.flows.map((f) => f.slug).filter((s) => s === slug || prev.includes(s))));
  const allOn = flows.length === project.flows.length;

  const submit = async () => {
    setPromptTouched(true);
    if (why) return;
    setPhase({ kind: 'submitting' });
    try {
      const r = await postJson<{ task: Task }>(`/api/tasks?cwd=${encodeURIComponent(cwd)}`, { prompt: prompt.trim(), flows, model, componentsFirst: first });
      tasksChanged();
      setPhase({ kind: 'done', task: r.task });
    } catch (err) {
      setPhase({ kind: 'error', text: (err as Error).message });
    }
  };

  if (phase.kind === 'done') {
    const t = phase.task;
    const running = [t.components, ...t.flows].filter((f) => f && (f.state === 'running' || f.state === 'needs_you')).length;
    const waiting = t.flows.filter((f) => f.state === 'waiting').length;
    return (
      <Shell title={`Run across flows on ${name}`} onClose={onClose}>
        <p className="project-dialog-note" role="status">
          {t.state === 'paused' ? 'Saved, but paused: weekly usage reached the cap before the first chat started.' : `Started: ${running} running, ${waiting} waiting their turn.`} Follow it in the sidebar under {name}.
        </p>
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => onOpenTask(t.id)}>Open task</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={`Run across flows on ${name}`} onClose={onClose} busy={busy}>
      <form className="project-dialog-body" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <p className="project-dialog-note">
          {it ? <>Iteration: {iterationLabel(it)}. One chat per flow, {parallel} at a time, the rest wait their turn. Each chat edits only its own flow.</> : 'There is no working iteration. Create one first from the project menu (New iteration).'}
        </p>
        <p className={`tk-usage ${usage.blocked ? 'blocked' : ''}`} role={usage.blocked ? 'alert' : undefined}>
          {usage.blocked && <Icon name="warning" small />}{usage.text}
        </p>
        {phase.kind === 'error' && <p className="project-dialog-note error-text" role="alert">{phase.text}</p>}
        <label className="field">
          <span>Prompt *</span>
          <textarea
            className="tk-prompt"
            autoFocus
            value={prompt}
            rows={4}
            maxLength={4000}
            placeholder="For example: move every toast to 24px from the top of the screen"
            aria-invalid={promptTouched && promptErr ? true : undefined}
            aria-describedby="tk-prompt-help"
            required
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => setPromptTouched(true)}
          />
          <span id="tk-prompt-help" className={promptTouched && promptErr ? 'error-text small' : 'muted small'}>{(promptTouched && promptErr) || 'Every flow\'s chat gets the same prompt.'}</span>
        </label>
        <fieldset className="project-fields" aria-describedby={flowsErr ? 'tk-flows-err' : undefined} disabled={busy}>
          <legend>Flows * <button type="button" className="link tk-all" onClick={() => setFlows(allOn ? [] : project.flows.map((f) => f.slug))}>{allOn ? 'Clear all' : 'Select all'}</button></legend>
          {project.flows.map((f) => (
            <label key={f.slug} className="project-check">
              <input type="checkbox" checked={flows.includes(f.slug)} onChange={() => toggle(f.slug)} />
              <span className="tk-flow">{f.n} · {f.name}</span>
              {it && !inIt.has(f.slug) && <span className="muted small">Adds it to {vId(it.id)}</span>}
            </label>
          ))}
          {flowsErr && <span id="tk-flows-err" className="error-text small">{flowsErr}</span>}
        </fieldset>
        <div className="field">
          <span id="tk-model-l">Model</span>
          <div className="seg" role="radiogroup" aria-labelledby="tk-model-l" aria-describedby="tk-model-help">
            {TASK_MODELS.map((m) => <button key={m.value} type="button" role="radio" aria-checked={model === m.value} className={model === m.value ? 'on' : ''} disabled={busy} onClick={() => setModel(m.value)}>{m.label}</button>)}
          </div>
          <span id="tk-model-help" className="muted small">{TASK_MODELS.find((m) => m.value === model)?.hint}.</span>
        </div>
        <label className="project-check tk-first">
          <input type="checkbox" checked={first} disabled={busy} aria-describedby="tk-first-help" onChange={(e) => { setComponentsTouched(true); setComponents(e.target.checked); }} />
          <span>Fix the shared component first</span>
        </label>
        <p id="tk-first-help" className="muted small tk-first-help">One chat changes the main components (new variants only), then the flow chats start.</p>
        <p className="muted small" aria-live="polite">{!chats ? 'No chats yet.' : chats === now ? `${chats} chat${chats === 1 ? '' : 's'}, ${chats === 1 ? 'it starts' : 'all start'} now.` : `${chats} chats: ${now} start${now === 1 ? 's' : ''} now, ${chats - now} wait${chats - now === 1 ? 's' : ''} their turn.`}</p>
        <p className="muted small">* Required</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || Boolean(why)} title={why || undefined} aria-describedby={why ? 'tk-why' : undefined}>
            {busy ? 'Starting…' : `Run on ${flows.length} flow${flows.length === 1 ? '' : 's'}`}
          </button>
        </div>
        {why && !busy && <span id="tk-why" className="sr-only">{why}</span>}
      </form>
    </Shell>
  );
}
