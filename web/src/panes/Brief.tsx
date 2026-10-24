import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { IconButton } from '../Tip';
import { Pending } from './Pending';
import { Composer } from './Chat';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Transcript, type ChatView } from './Transcript';
import { LongRunLine } from './LongRun';
import { ScopeSwitch } from './ScopeSwitch';
import { ChatPlace, useChatPlace } from './ChatPlace';
import { type ChatEvent } from '../../../shared/protocol';
import { compactAt } from '../../../shared/models';
import { runningText } from '../StatusBar';
import { WorkflowPanel } from './Workflow';
import { stepLabel } from './steps';
import { Brainstorm, BrainstormLine } from './Brainstorm';

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
  { id: 'brainstorm', label: 'Brainstorm', title: 'Options, rough sketches and questions before building' },
  { id: 'timeline', label: 'Timeline', title: 'Your prompts, finished work and the latest replies' },
  { id: 'transcript', label: 'Transcript', title: 'Every step Claude took' },
];

/** The view each chat was last on in this window. Brainstorm is never the saved default for other chats. */
const viewByChat = new Map<string, ChatView>();
const savedView = (): ChatView => (load(VIEW_KEY) === 'transcript' ? 'transcript' : 'timeline');

type Expand = { expanded: boolean; canExpand: boolean; toggleRef: RefObject<HTMLButtonElement | null>; onExpand: () => void };

/** Expand chat: the chat covers the window (desktop only, a phone already shows it full screen). */
function ExpandButton({ expanded, toggleRef, onExpand }: Expand) {
  const label = expanded ? 'Collapse chat' : 'Expand chat';
  return (
    <IconButton ref={toggleRef} label={label} tip={expanded ? 'Collapse chat (Esc)' : label} aria-keyshortcuts={expanded ? 'Escape' : undefined} aria-pressed={expanded} className="icon-btn chat-expand desktop-only" onClick={onExpand}>
      <Icon name={expanded ? 'minimize-2' : 'maximize-2'} small />
    </IconButton>
  );
}

export function Brief(expand: Expand) {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const context = useStore((s) => s.session.context);
  const model = useStore((s) => s.session.model);
  const cwd = useStore((s) => s.session.cwd);
  const compacting = useStore((s) => s.session.compacting);
  const stopping = useStore((s) => s.session.stopping);
  const next = useMemo(() => nextSteps(events), [events]);
  const lastTool = useMemo(() => [...events].reverse().find((e) => e.kind === 'tool_use' && !e.name.endsWith('__set_status')), [events]);
  const [adding, setAdding] = useState(false);
  const chatId = useStore((s) => s.session.id);
  const brainstorm = useStore((s) => Boolean(s.session.brainstorm));
  const rounds = useStore((s) => s.brainstorm?.length ?? 0);
  const [view, setView] = useState<ChatView>(savedView);
  // A chat opens on the view it was last on here; a brainstorming chat (a new flow or iteration) on Brainstorm.
  useLayoutEffect(() => {
    if (chatId) setView(viewByChat.get(chatId) ?? (brainstorm ? 'brainstorm' : savedView()));
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stepsOpen, setStepsOpen] = useState(() => load(STEPS_KEY) !== '0');
  const pick = (v: ChatView) => {
    setView(v);
    viewByChat.set(chatId, v);
    if (v !== 'brainstorm') save(VIEW_KEY, v);
  };
  const showViews = events.length > 0 || brainstorm || rounds > 0;
  const toggleSteps = () => { setStepsOpen(!stepsOpen); save(STEPS_KEY, stepsOpen ? '0' : '1'); };
  // The foot's details (Up next) fold away so the conversation gets the room; the status line stays.
  const [footOpen, setFootOpen] = useState(() => load(FOOT_KEY) !== '0');
  const toggleFoot = () => { setFootOpen(!footOpen); save(FOOT_KEY, footOpen ? '0' : '1'); };
  // Up next, Claude's own list of what it does after this turn: shown when it has items, hidden when empty (Add to Up next lives with the items).
  const hasSteps = next.length > 0 || adding;
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';
  const toolLine = lastTool?.kind === 'tool_use' ? stepLabel(lastTool.name, lastTool.input, cwd) : null;
  const where = useChatPlace();
  const frozen = where.place?.iteration?.state === 'frozen';

  return (
    <div className="brief">
      <div className="brief-status">
        {/* Where the chat works shows from the start; the views once there is something to show. */}
        {/* With nothing to show yet, the switcher still listens for ⌘K and the palette. */}
        {!showViews && !where.place && <ChatPlace {...where} />}
        {/* Before the first message the head has only the Expand chat button. */}
        {!showViews && !where.place && expand.canExpand && <div className="chat-head bare desktop-only"><ExpandButton {...expand} /></div>}
        {(showViews || where.place) && (
          <div className="chat-head">
            <ChatPlace {...where} />
            {showViews && <div className="seg chat-view" role="group" aria-label="Chat view">
              {VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} title={v.title} onClick={() => pick(v.id)}>{v.label}</button>)}
            </div>}
            {/* A frozen chat only reads Figma, so there is no scope to widen. */}
            {!frozen && <ScopeSwitch />}
            {expand.canExpand && <ExpandButton {...expand} />}
          </div>
        )}
        {/* A flow chat's workflow: shown from the start, before the first message. */}
        <WorkflowPanel />
        {view === 'brainstorm' ? <Brainstorm onBuilt={() => pick('timeline')} /> : <Transcript view={view}>
          {/* Idle, the foot is gone: no Last reply line and no quick reply chips. Up next stays while it has items, and Read
              aloud stays mounted (hidden) so a finished reply is still spoken. */}
          {state === 'idle' && <span hidden><ReadAloud /></span>}
          {(state !== 'idle' || (events.length > 0 && hasSteps)) && <div className="tl-foot">
            {state !== 'idle' && <div className={`tl-now ${state}`}>
              <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
              <span className="text">
                {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : runningText(status)}
                {state === 'running' && toolLine && <span className={`tool ${toolLine.mono ? 'mono' : ''}`} title={toolLine.object}>{toolLine.verb} {toolLine.object}</span>}
              </span>
              <span className="tl-now-acts">
                <ReadAloud />
                {hasSteps && <>
                  {!footOpen && next.length > 0 && <span className="badge" title={`Up next: ${next.length}`}><span className="sr-only">Up next: </span>{next.length}</span>}
                  <IconButton label={footOpen ? 'Hide details' : 'Show details'} place="top" aria-expanded={footOpen} aria-controls="tl-foot-details" onClick={toggleFoot}>
                    <Icon name={footOpen ? 'chevron-up' : 'chevron-down'} small />
                  </IconButton>
                </>}
              </span>
            </div>}
            <div className="tl-foot-details" id="tl-foot-details" hidden={state !== 'idle' && !footOpen}>
            {/* Up next: what Claude plans to do after this turn. "Steps" is kept for the workflow in the chat head. */}
            {hasSteps && (
              <section className="up-next" aria-labelledby="up-next-h">
                <h3 className="up-next-h" id="up-next-h">
                  <button className="up-next-toggle" aria-expanded={stepsOpen} aria-controls="up-next-list" title={stepsOpen ? 'Hide what Claude does next' : 'Show what Claude does next'} onClick={toggleSteps}>
                    Up next{next.length > 0 && <span className="badge">{next.length}</span>}<Icon name={stepsOpen ? 'chevron-down' : 'chevron-right'} small />
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
        </Transcript>}
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <LongRunLine />
        <BrainstormLine />
        <Composer />
        {compacting ? (
          <div className="ctx-line"><Icon name="loading" small spin /> Compacting the conversation…</div>
        ) : context !== null && context >= compactAt(model) && (
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
