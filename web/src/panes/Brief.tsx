import { useEffect, useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { ago } from '../ago';
import { IconButton } from '../Tip';
import { Pending } from './Pending';
import { Composer } from './Chat';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Transcript, type ChatView } from './Transcript';
import { LongRunLine } from './LongRun';
import { ScopeSwitch } from './ScopeSwitch';
import { ChatPlace, useChatPlace } from './ChatPlace';
import { COMPACT_AT, type ChatEvent } from '../../../shared/protocol';
import { runningText } from '../StatusBar';
import { WorkflowPanel } from './Workflow';
import { stepLabel } from './steps';
import { insertPrompt } from './composerEvents';
import { quickReplies, replyToAnswer } from './quickReplies';

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
const FOOT_KEY = 'designstudio.chatFoot';

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
  const cwd = useStore((s) => s.session.cwd);
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
  // The foot's details (quick replies, Up next) fold away so the conversation gets the room; the status line stays.
  const [footOpen, setFootOpen] = useState(() => load(FOOT_KEY) !== '0');
  const toggleFoot = () => { setFootOpen(!footOpen); save(FOOT_KEY, footOpen ? '0' : '1'); };
  // Up next, Claude's own list of what it does after this turn: shown when it has items, hidden when empty (Add to Up next lives with the items).
  const hasSteps = next.length > 0 || adding;
  const answerTo = useMemo(() => replyToAnswer(events), [events]);
  const [, tick] = useState(0);
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';
  const quick = state === 'idle' && answerTo ? quickReplies(answerTo) : [];
  const toolLine = lastTool?.kind === 'tool_use' ? stepLabel(lastTool.name, lastTool.input, cwd) : null;
  const where = useChatPlace();
  const frozen = where.place?.iteration?.state === 'frozen';

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="brief">
      <div className="brief-status">
        {/* Where the chat works shows from the start; the views once there is something to show. */}
        {(events.length > 0 || where.place) && (
          <div className="chat-head">
            <ChatPlace {...where} />
            {events.length > 0 && <div className="seg chat-view" role="group" aria-label="Chat view">
              {VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} title={v.title} onClick={() => pick(v.id)}>{v.label}</button>)}
            </div>}
            {/* A frozen chat only reads Figma, so there is no scope to widen. */}
            {!frozen && <ScopeSwitch />}
          </div>
        )}
        {/* A flow chat's workflow: shown from the start, before the first message. */}
        <WorkflowPanel />
        <Transcript view={view}>
          {(events.length > 0 || running) && <div className="tl-foot">
            <div className={`tl-now ${state}`}>
              <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
              <span className="text">
                {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : state === 'running' ? runningText(status) : lastReply ? '' : 'Idle'}
                {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>Last reply: {ago(lastReply.at)}</span>}
                {state === 'running' && toolLine && <span className={`tool ${toolLine.mono ? 'mono' : ''}`} title={toolLine.object}>{toolLine.verb} {toolLine.object}</span>}
              </span>
              <span className="tl-now-acts">
                <ReadAloud />
                {(quick.length > 0 || hasSteps) && <>
                  {!footOpen && next.length > 0 && <span className="badge" title={`Up next: ${next.length}`}><span className="sr-only">Up next: </span>{next.length}</span>}
                  <IconButton label={footOpen ? 'Hide details' : 'Show details'} place="top" aria-expanded={footOpen} aria-controls="tl-foot-details" onClick={toggleFoot}>
                    <Icon name={footOpen ? 'chevron-up' : 'chevron-down'} small />
                  </IconButton>
                </>}
              </span>
            </div>
            <div className="tl-foot-details" id="tl-foot-details" hidden={!footOpen}>
            {quick.length > 0 && (
              <div className="quick-replies" role="group" aria-label="Quick replies">
                {quick.map((q) => (
                  <button key={q.label} className={q.main ? 'qr qr-main' : 'qr'} title={q.title} onClick={() => (q.send ? send({ type: 'prompt', text: q.text }) : insertPrompt(q.text))}>{q.label}</button>
                ))}
              </div>
            )}
            {/* Up next: what Claude plans to do after this turn. "Steps" is kept for the workflow in the chat head. */}
            {hasSteps && (
              <section className="up-next" aria-labelledby="up-next-h">
                <h3 className="up-next-h" id="up-next-h">
                  <button className="up-next-toggle" aria-expanded={stepsOpen} aria-controls="up-next-list" title={stepsOpen ? 'Hide what Claude does next' : 'Show what Claude does next'} onClick={toggleSteps}>
                    Up next{next.length > 0 && <span className="badge">{next.length}</span>}<Icon name={stepsOpen ? 'chevron-up' : 'chevron-down'} small />
                  </button>
                </h3>
                {stepsOpen && (
                  <ul className="steps" id="up-next-list">
                    {next.map((t, i) => (
                      <UpNextItem key={`${i}:${t}`} text={t} onSave={(v) => setNext(next.map((x, j) => (j === i ? v : x)).filter(Boolean))} onDrop={() => setNext(next.filter((_, j) => j !== i))} />
                    ))}
                    {adding ? (
                      <UpNextItem text="" editing onSave={(v) => { setAdding(false); if (v) setNext([...next, v]); }} onDrop={() => setAdding(false)} />
                    ) : (
                      <li className="step add"><button className="link" onClick={() => setAdding(true)}><Icon name="add" small /><span>Add to Up next</span></button></li>
                    )}
                  </ul>
                )}
              </section>
            )}
            </div>
          </div>}
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

function UpNextItem({ text, editing = false, onSave, onDrop }: { text: string; editing?: boolean; onSave: (v: string) => void; onDrop: () => void }) {
  const [edit, setEdit] = useState(editing);
  const [value, setValue] = useState(text);
  if (edit) {
    const done = () => { setEdit(false); if (value.trim() !== text) onSave(value.trim()); else if (!text) onDrop(); };
    return (
      <li className="step editing">
        <input
          autoFocus
          value={value}
          placeholder="What should Claude do next?"
          aria-label={text ? `Edit: ${text}` : 'Add to Up next'}
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
        <IconButton label={`Edit: ${text}`} tip="Edit" place="top" onClick={() => setEdit(true)}><Icon name="edit" small /></IconButton>
        <IconButton label={`Remove from Up next: ${text}`} tip="Remove from Up next" place="top" onClick={onDrop}><Icon name="close" small /></IconButton>
      </span>
    </li>
  );
}
