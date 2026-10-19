import { useState } from 'react';
import { postJson, send, useStore } from '../store';
import { press } from '../press';
import { Icon } from '../Icon';
import { Shell } from './ProjectDialogs';
import { STATE_TEXT, TASK_STATE_TEXT, modelName, pauseText, rollup, taskTitle, tokenText, type Task, type TaskFlow, type TaskFlowState } from '../../../shared/tasks';
import { tasksChanged } from './taskStore';
import '../tasks.css';

// One run across flows: the roll-up, each flow's state, model and tokens, a link to its chat, and Pause, Resume or
// Stop. Opened from the task row in the sidebar.

/** The state as a shape and a word: ring waiting, dot running, diamond needs you, square done, triangle failed, bar stopped. */
export function FlowState({ state }: { state: TaskFlowState }) {
  return (
    <span className={`tk-state ${state}`}>
      <span className={`tk-dot ${state}`} aria-hidden />
      {STATE_TEXT[state]}
    </span>
  );
}

const SHOWN_DONE = 3;

/**
 * A project's runs across flows in the sidebar: every open one plus the last few finished. Each row shows the run's
 * state as a shape, the roll-up ("5 of 8 done, 2 running") and opens its task card.
 */
export function TaskRows({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const open = tasks.filter((t) => t.state === 'running' || t.state === 'paused');
  const done = tasks.filter((t) => t.state === 'done' || t.state === 'stopped').slice(0, SHOWN_DONE);
  return (
    <>
      {[...open, ...done].map((t) => {
        const r = rollup(t);
        const mark: TaskFlowState = t.state === 'running' ? (r.needsYou ? 'needs_you' : 'running') : t.state === 'paused' ? 'waiting' : t.state === 'stopped' ? 'stopped' : r.failed ? 'failed' : 'done';
        const state = t.state === 'running' && r.needsYou ? STATE_TEXT.needs_you : TASK_STATE_TEXT[t.state];
        return (
          <div key={t.id} className="row session live two task d1" title={`Task: ${taskTitle(t)}. ${state}, ${r.line}`} onClick={() => onOpen(t.id)}>
            <span className={`tk-dot ${mark}`} aria-hidden />
            <span className="lines" {...press(() => onOpen(t.id))}>
              <span className="l1"><span className="name">Task: {taskTitle(t)}</span></span>
              <span className="l2"><span className="sub">{t.state === 'paused' || t.state === 'stopped' || (t.state === 'running' && r.needsYou) ? `${state}: ${r.line}` : r.line}</span></span>
            </span>
          </div>
        );
      })}
    </>
  );
}

export function TaskCard({ task, onClose }: { task: Task; onClose: () => void }) {
  const live = useStore((s) => s.live);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Stop asks in place: the actions turn into the question, so focus stays inside this one dialog.
  const [asking, setAsking] = useState(false);
  const r = rollup(task);
  const act = async (what: 'pause' | 'resume' | 'stop') => {
    setBusy(what);
    setError('');
    try {
      await postJson(`/api/tasks/${what}`, { id: task.id });
      tasksChanged();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  };
  const open = r.running + r.needsYou;
  const stopText = `${open} running chat${open === 1 ? '' : 's'} stop and ${r.waiting} waiting flow${r.waiting === 1 ? '' : 's'} will not start. Edits already made in Figma stay.`;
  const models = [...new Set(task.flows.map((f) => modelName(f.model)))];
  const rows: TaskFlow[] = [...(task.components ? [task.components] : []), ...task.flows];
  const openChat = (f: TaskFlow) => {
    const open = f.chatId && live.find((c) => c.id === f.chatId);
    if (open) send({ type: 'view', id: open.id });
    else if (f.sessionId) send({ type: 'open_session', sessionId: f.sessionId });
    onClose();
  };

  return (
    <Shell title={`Task: ${taskTitle(task)}`} onClose={onClose} busy={busy !== null}>
      <div className="project-dialog-body tk-card">
        <dl className="tk-facts">
          <div><dt>Iteration</dt><dd>{task.iteration}</dd></div>
          <div><dt>State</dt><dd>{TASK_STATE_TEXT[task.state]}</dd></div>
          <div><dt>Progress</dt><dd aria-live="polite">{r.line}</dd></div>
          <div><dt>Model</dt><dd>{models.join(', ')}</dd></div>
          <div><dt>Tokens</dt><dd>{tokenText(r.tokens)} in total</dd></div>
        </dl>
        {task.state === 'paused' && <p className="tk-usage blocked" role="status"><Icon name="debug-pause" small />{pauseText(task)}</p>}
        {error && <p className="project-dialog-note error-text" role="alert">{error}</p>}
        <details className="tk-prompt-view">
          <summary>Prompt</summary>
          <p>{task.prompt}</p>
        </details>
        <ul className="tk-flows" aria-label="Flows">
          {rows.map((f) => (
            <li key={f.slug}>
              <div className="tk-row">
                <span className="tk-name">{f.slug === 'components' ? 'Shared components' : `${f.n} · ${f.name}`}</span>
                <FlowState state={f.state} />
              </div>
              <div className="tk-meta">
                <span>Model: {modelName(f.model)}</span>
                <span>Tokens: {tokenText(f.tokens)}</span>
                {(f.chatId || f.sessionId) && <button className="link" onClick={() => openChat(f)}>Open chat</button>}
              </div>
              {f.note && <div className="tk-note muted small">{f.note}</div>}
            </li>
          ))}
        </ul>
      </div>
      {asking && (task.state === 'running' || task.state === 'paused') ? (
        <div className="tk-ask" role="group" aria-labelledby="tk-ask-t">
          <p id="tk-ask-t"><strong>Stop this task?</strong> {stopText}</p>
          <div className="dialog-actions">
            <button autoFocus onClick={() => setAsking(false)}>Keep running</button>
            <button className="destructive" disabled={busy !== null} onClick={() => void act('stop').then(() => setAsking(false))}>{busy === 'stop' ? 'Stopping…' : 'Stop task'}</button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions">
          {task.state === 'running' && (
            <>
              <button className="link danger tk-stop" disabled={busy !== null} onClick={() => setAsking(true)}>Stop task</button>
              <button disabled={busy !== null} onClick={() => void act('pause')}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</button>
            </>
          )}
          {task.state === 'paused' && (
            <>
              <button className="link danger tk-stop" disabled={busy !== null} onClick={() => setAsking(true)}>Stop task</button>
              <button className="primary" disabled={busy !== null} onClick={() => void act('resume')}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</button>
            </>
          )}
          {(task.state === 'done' || task.state === 'stopped') && <button onClick={onClose}>Close</button>}
        </div>
      )}
    </Shell>
  );
}
