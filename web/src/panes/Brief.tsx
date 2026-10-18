import { useEffect, useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Pending } from './Pending';
import { Composer } from './Chat';
import { RunCard } from './RunCard';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Transcript, type ChatView } from './Transcript';
import { LongRunLine } from './LongRun';
import { COMPACT_AT, type ChatEvent } from '../../../shared/protocol';
import { runningText } from '../StatusBar';
import { StageButton, StagePanel, useStages } from './Stages';

export function nextSteps(events: ChatEvent[]) {
  let next: string[] = [];
  for (const e of events) {
    if (e.kind === 'user') next = [];
    else if (e.kind === 'plan') next = e.next;
    else if (e.kind === 'tool_use' && e.name.endsWith('__set_status') && Array.isArray(e.input.next)) next = e.input.next.filter((x): x is string => typeof x === 'string');
  }
  return next;
}

const VIEW_KEY = 'designstudio.chatView';
const STEPS_KEY = 'designstudio.nextSteps';
const STAGES_KEY = 'designstudio.stages';

function load(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

const VIEWS: Array<{ id: ChatView; label: string; title: string }> = [
  { id: 'timeline', label: 'Timeline', title: 'Your prompts, finished work and the latest replies' },
  { id: 'transcript', label: 'Transcript', title: 'Every step Claude took' },
];

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const context = useStore((s) => s.session.context);
  const compacting = useStore((s) => s.session.compacting);
  const stopping = useStore((s) => s.session.stopping);
  const next = useMemo(() => nextSteps(events), [events]);
  const lastTool = useMemo(() => [...events].reverse().find((e) => e.kind === 'tool_use' && !e.name.endsWith('__set_status')), [events]);
  const lastReply = useMemo(() => [...events].reverse().find((e) => e.kind === 'assistant' && e.text.trim()), [events]);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ChatView>(() => (load(VIEW_KEY) === 'transcript' ? 'transcript' : 'timeline'));
  const [stepsOpen, setStepsOpen] = useState(() => load(STEPS_KEY) !== '0');
  const pick = (v: ChatView) => { setView(v); save(VIEW_KEY, v); };
  const toggleSteps = () => { setStepsOpen(!stepsOpen); save(STEPS_KEY, stepsOpen ? '0' : '1'); };
  const stages = useStages();
  const [stagesOpen, setStagesOpen] = useState(() => load(STAGES_KEY) === '1');
  const toggleStages = () => { setStagesOpen(!stagesOpen); save(STAGES_KEY, stagesOpen ? '0' : '1'); };
  const hasSteps = next.length > 0 || adding || running;
  const [, tick] = useState(0);
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="brief">
      <div className="brief-status">
        {events.length > 0 && (
          <div className="chat-head">
            <div className="seg chat-view" role="group" aria-label="Chat view">
              {VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} title={v.title} onClick={() => pick(v.id)}>{v.label}</button>)}
            </div>
            {stages.list && <StageButton list={stages.list} open={stagesOpen} onToggle={toggleStages} />}
          </div>
        )}
        {events.length > 0 && stagesOpen && stages.list && <StagePanel {...stages} list={stages.list} />}
        <Transcript view={view}>
          <RunCard />
          <div className="tl-foot">
            <div className={`tl-now ${state}`}>
              <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
              <span className="text">
                {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : state === 'running' ? runningText(status) : lastReply ? 'Idle · last reply' : 'Idle'}
                {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
              </span>
              <span className="tl-side">
                {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
                {hasSteps && (
                  <button className="tl-steps-toggle" aria-expanded={stepsOpen} title={stepsOpen ? 'Hide the next steps' : 'Show the next steps'} onClick={toggleSteps}>
                    {next.length ? `${next.length} next ${next.length === 1 ? 'step' : 'steps'}` : 'Next steps'}<Icon name={stepsOpen ? 'chevron-up' : 'chevron-down'} small />
                  </button>
                )}
              </span>
              <ReadAloud />
            </div>
            {hasSteps && stepsOpen && (
              <ul className="steps">
                {next.map((t, i) => (
                  <Step key={`${i}:${t}`} text={t} onSave={(v) => setNext(next.map((x, j) => (j === i ? v : x)).filter(Boolean))} onDrop={() => setNext(next.filter((_, j) => j !== i))} />
                ))}
                {adding ? (
                  <Step text="" editing onSave={(v) => { setAdding(false); if (v) setNext([...next, v]); }} onDrop={() => setAdding(false)} />
                ) : (
                  <li className="step add"><button className="link" onClick={() => setAdding(true)}><Icon name="add" small /> Add a step</button></li>
                )}
              </ul>
            )}
          </div>
        </Transcript>
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <LongRunLine />
        <Composer />
        {compacting ? (
          <div className="ctx-line"><Icon name="loading" small spin /> Compacting the conversation…</div>
        ) : context !== null && context >= COMPACT_AT && (
          <div className="ctx-line">
            <span><b>{Math.round(context / 1000)}k</b> context · {running ? 'compacts when this turn ends' : 'compact to keep turns cheap'}</span>
            {!running && <button className="link" title="Run /compact" onClick={() => send({ type: 'prompt', text: '/compact' })}>Compact now</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ text, editing = false, onSave, onDrop }: { text: string; editing?: boolean; onSave: (v: string) => void; onDrop: () => void }) {
  const [edit, setEdit] = useState(editing);
  const [value, setValue] = useState(text);
  if (edit) {
    const done = () => { setEdit(false); if (value.trim() !== text) onSave(value.trim()); else if (!text) onDrop(); };
    return (
      <li className="step editing">
        <input
          autoFocus
          value={value}
          placeholder="Describe the step"
          onChange={(e) => setValue(e.target.value)}
          onBlur={done}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done();
            if (e.key === 'Escape') { setValue(text); setEdit(false); if (!text) onDrop(); }
          }}
        />
      </li>
    );
  }
  return (
    <li className="step">
      <span className="text" onClick={() => { if (!touch()) setEdit(true); }}>{text}</span>
      <span className="acts">
        <button className="icon-btn" title="Edit step" onClick={() => setEdit(true)}><Icon name="edit" small /></button>
        <button className="icon-btn" title="Remove step" onClick={onDrop}><Icon name="close" small /></button>
      </span>
    </li>
  );
}

function time(at: number) {
  const ago = Date.now() - at;
  if (ago < 60000) return 'now';
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
