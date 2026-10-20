import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { approvalReply } from '../../../shared/stages';
import { stillAwaiting, waitText, type AwaitItem } from '../../../shared/awaiting';
import { FIX_ASK } from '../../../shared/workflow';
import { getJson, setUi, useRev, useStore } from '../store';
import { CHECKS, lastMcp } from '../setupChecks';
import { RECHECK, openFigmaLogin } from '../FigmaLogin';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { FileIcon } from './Explorer';
import { focusComposer, insertPrompt, showNode } from './composerEvents';
import { openSample } from './Chats';
import { useThumbs } from '../useThumbs';
import { frameName, splitFrameLinks, useOutline } from '../outline';
import { FrameNames } from '../FrameNames';
import { FoldButton, FoldLine, useFold } from '../Fold';
import { buildTranscript, duration, firstLine, groupTurns, recentTurns, relPath, replySummary, stepLabel, timelineTurns, type Block, type Item, type ToolResult, type ToolUse, type Turn } from './steps';
import { MakeRule } from './MakeRule';
import { press } from '../press';
import { LongRunReport } from './LongRun';
import { focusReview } from './reviewFocus';
import { TONE_MARK, areaRows, canGoDeeper, isStale, retryPrompt, rulesTone, runLabel, summarize } from './reviewRuns';
import '../marks';
import { rulesLine } from '../../../shared/rules';
import { openRun } from '../../../shared/triage';
import { useTriage } from './Triage';
import { reviewChecklist, type ReviewDoc, type ReviewRun } from '../../../shared/design';
import type { ChatEvent } from '../../../shared/protocol';
import '../transcript.css';
import '../timeline.css';
import { runningText } from '../StatusBar';

export type ChatView = 'timeline' | 'transcript';

const Settle = createContext({ settle: () => {}, recheck: () => {} });
// The run time of the last review card in this chat: that card stays open, older ones fold to their title line.
const NewestReview = createContext<number | null>(null);

export function Transcript({ view = 'transcript', children }: { view?: ChatView; children?: ReactNode }) {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const status = useStore((s) => s.status);
  const figmaKey = useStore((s) => s.session.figma?.key);
  return <TranscriptView events={events} cwd={cwd} running={running} stopping={stopping} status={status} figmaKey={figmaKey} view={view}>{children}</TranscriptView>;
}

/**
 * The four ways she starts a chat: a frame link with a note, a new flow plan, a fix across all flows, a review only.
 * A chip with text puts the start of a prompt in the box for her to finish; one without text just opens the box for a paste.
 */
export type WelcomeChip = { label: string; text?: string; attach?: boolean };
export function welcomeChips(fileName: string | null): WelcomeChip[] {
  const starts: WelcomeChip[] = [
    { label: 'Fix a frame: paste its link and a note' },
    { label: 'Plan a new flow', text: 'List the screens, states and buttons for a new flow, then wait for my go. The flow:' },
    ...(fileName ? [{ label: 'Fix something across all flows', text: 'Fix this across all flows:' }] : []),
    { label: 'Review only, no changes', text: fileName ? `Review only, do not change anything. Review the latest flows in ${fileName}` : 'Review only, do not change anything. Review:' },
  ];
  return fileName ? starts : [{ label: 'Add project', attach: true }, ...starts];
}

function SetupBanner() {
  const [problem, setProblem] = useState<{ tone: 'warn' | 'bad'; text: string; login: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    // On open it checks; after a check elsewhere (Settings, the login dialog) it reads that result instead of asking again.
    const run = (fresh: boolean) => void (fresh ? CHECKS.mcp() : lastMcp()).then((r) => {
      const c = r.tone !== 'ok' && !r.optional ? r : undefined;
      if (!live) return;
      // Needing login, the login lives in the Log in to Figma dialog, so the notice keeps one short line and one action.
      const login = c?.fixId === 'figma-login';
      setProblem(c && c.tone !== 'ok' ? { tone: c.tone, text: login ? `${c.detail}.` : [c.detail, c.fix].filter(Boolean).join('. ').replace(/\.\./g, '.'), login } : null);
    });
    run(true);
    // Try again in the login dialog checks again, so the notice goes once Figma connects.
    const after = () => run(false);
    window.addEventListener(RECHECK, after);
    return () => { live = false; window.removeEventListener(RECHECK, after); };
  }, []);
  if (!problem) return null;
  return (
    <div className="tl-setup" role="status">
      <span className={`tl-setup-mark ${problem.tone}`} aria-hidden />
      <span>{problem.text}{' '}
        {problem.login
          ? <button className="link" onClick={openFigmaLogin}>Log in to Figma</button>
          : <button className="link" onClick={() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } }))}>Open Settings</button>}
      </span>
    </div>
  );
}

function Welcome({ fileName }: { fileName: string | null }) {
  const chips = welcomeChips(fileName);
  const attach = chips.find((c) => c.attach);
  const [sampleError, setSampleError] = useState('');
  return (
    <div className="tl-welcome">
      <SetupBanner />
      <h2>What are we working on?</h2>
      <p>Paste a frame link with a note, or start from one of these. Design mode plans, builds and reviews in Figma.</p>
      {attach && (
        <div className="tl-start">
          <button className="tl-attach" onClick={() => window.dispatchEvent(new Event('designstudio:attach'))}><Icon name="file-media" small />{attach.label}</button>
          <button className="link" onClick={() => { setSampleError(''); openSample().catch((e: Error) => setSampleError(e.message)); }}>Try the sample tour</button>
        </div>
      )}
      {sampleError && <p className="error-text" role="alert">{sampleError}</p>}
      <div className="tl-suggest-label" id="tl-suggest-label">Start with</div>
      <ul className="tl-suggest" aria-labelledby="tl-suggest-label">
        {chips.filter((c) => !c.attach).map((c) => (
          <li key={c.label}>
            <button title={c.text ? 'Put the start of this prompt in the message box' : 'Go to the message box to paste a frame link'} onClick={() => (c.text ? insertPrompt(c.text) : focusComposer())}>
              <span>{c.label}</span>
              <Icon name="arrow-right" small />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TranscriptView({ events, cwd, running, stopping, status, figmaKey, view = 'transcript', children }: { events: ChatEvent[]; cwd: string; running: boolean; stopping: boolean; status: string; figmaKey?: string; view?: ChatView; children?: ReactNode }) {
  const items = useMemo(() => buildTranscript(events), [events]);
  const all = useMemo(() => (view === 'timeline' ? timelineTurns(items) : groupTurns(items)), [items, view]);
  const [early, setEarly] = useState(false);
  const { from, hidden } = view === 'timeline' && !early ? recentTurns(all) : { from: 0, hidden: 0 };
  const turns = all.slice(from);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const wanted = new Map<string, number>();
  for (const it of items.filter((x) => x.kind === 'done' && x.nodes.length).slice(-10)) for (const [id, rev] of (it as DoneItem).nodes) wanted.set(id, Math.max(wanted.get(id) ?? 0, rev));
  const fileName = useStore((s) => s.session.figma?.name ?? null);
  const thumb = useThumbs(figmaKey, [...wanted]);

  const settle = useCallback(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(settle);

  useEffect(() => { stick.current = true; settle(); }, [view, settle]);

  const recheck = useCallback(() => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  const scroll = useMemo(() => ({ settle, recheck }), [settle, recheck]);
  const newestReview = useMemo(() => [...items].reverse().find((x): x is Extract<Item, { kind: 'review' }> => x.kind === 'review')?.runAt ?? null, [items]);

  return (
    <Settle.Provider value={scroll}>
      <NewestReview.Provider value={newestReview}>
      <div ref={box} className={`tr ${view}`} onScroll={recheck}>
        {items.length === 0 && (
          <Welcome fileName={fileName} />
        )}
        {hidden > 0 && <div className="tl-earlier"><button className="link" onClick={() => setEarly(true)}>Show {hidden} earlier {hidden === 1 ? 'prompt' : 'prompts'}</button></div>}
        {view === 'timeline'
          ? turns.map((t) => <TimelineTurn key={t.id} t={t} cwd={cwd} thumb={thumb} />)
          : turns.map((t, i) => t.blocks.map((b) => <BlockRow key={b.id} b={b} cwd={cwd} thumb={thumb} live={running && i === turns.length - 1} />))}
        {running && children === undefined && (
          <div className="tr-working">
            <span className="tr-mark"><Icon name="loading" small spin /></span>
            <span className="tr-text">{stopping ? 'Stopping…' : runningText(status)}</span>
          </div>
        )}
        {children}
      </div>
      </NewestReview.Provider>
    </Settle.Provider>
  );
}

type DoneItem = Extract<Item, { kind: 'done' }>;

function BlockRow({ b, cwd, thumb, live }: { b: Block; cwd: string; thumb: (id: string) => string | null; live: boolean }) {
  if (b.kind === 'steps') return <Steps b={b} cwd={cwd} thumb={thumb} live={live} />;
  return <Row it={b} cwd={cwd} thumb={thumb} />;
}

function latest(items: Item[], cwd: string) {
  const it = [...items].reverse().find((x) => x.kind === 'step' || x.kind === 'file' || x.kind === 'agent');
  if (!it) return '';
  if (it.kind === 'file') return `Edited ${relPath(it.path, cwd)}`;
  if (it.kind === 'agent') return typeof it.use.input.description === 'string' && it.use.input.description ? it.use.input.description : 'Sub-agent';
  const { verb, object } = stepLabel(it.use.name, it.use.input, cwd);
  return `${verb} ${object}`;
}

function Steps({ b, cwd, thumb, live }: { b: Extract<Block, { kind: 'steps' }>; cwd: string; thumb: (id: string) => string | null; live: boolean }) {
  const [open, setOpen] = useState(false);
  const dur = duration(b.ms);
  return (
    <div className={`tr-steps ${open ? 'open' : ''}`}>
      <div className="tr-steps-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} {...press(() => setOpen((v) => !v))}>
        <span className="tr-mark">{live ? <Icon name="loading" small spin /> : <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</span>
        <span className="tr-text">{live ? latest(b.items, cwd) : `${b.count} ${b.count === 1 ? 'step' : 'steps'}`}</span>
        <span className="tr-dur">{live ? `${b.count}` : dur}</span>
      </div>
      {open && <div className="tr-steps-body">{b.items.map((it) => <Row key={it.id} it={it} cwd={cwd} thumb={thumb} />)}</div>}
    </div>
  );
}

function Row({ it, cwd, thumb }: { it: Item; cwd: string; thumb: (id: string) => string | null }) {
  switch (it.kind) {
    case 'user':
      return (
        <div className="tr-user-wrap">
          <div className={`tr-user ${it.stopping ? 'stopping' : ''}`}><UserText text={it.text} />{it.stopping && <span className="tr-stop"><Icon name="loading" small spin /></span>}</div>
          {/* A one-word answer (go, A) is not a rule. */}
          {!it.stopping && !approvalReply(it.text) && <UserRule text={it.text} />}
        </div>
      );
    case 'phase':
      return <div className="tr-phase"><Icon name="sync" small />{it.text}</div>;
    case 'assistant':
      return <Reply text={it.text} streaming={it.streaming} />;
    case 'system':
      return <div className="tr-system">{it.text}</div>;
    case 'step':
      return <Step use={it.use} result={it.result} cwd={cwd} />;
    case 'file':
      return <FileCard it={it} cwd={cwd} />;
    case 'agent':
      return <AgentRow use={it.use} result={it.result} />;
    case 'done':
      return (
        <div className="tr-done tr-act">
          <span className="tr-mark"><Icon name="check" small /></span>
          <span className="tr-text" title={it.text}>{it.text}</span>
          {it.nodes.some(([id]) => thumb(id)) && (
            <span className="tl-thumbs">
              {it.nodes.filter(([id]) => thumb(id)).map(([id]) => (
                <button key={id} title="Show in Figma" onClick={() => showNode(id)}><img src={thumb(id)!} alt="" loading="lazy" /></button>
              ))}
            </span>
          )}
        </div>
      );
    case 'review':
      return <ReviewCard runAt={it.runAt} />;
    case 'report':
      return <LongRunReport report={it.report} />;
    case 'note':
      return <div className="tr-note tr-act"><span className="tr-mark"><i className="tr-dot" /></span><span className="tr-text" title={it.text}>{it.text}</span></div>;
  }
}

function Reply({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const clamp = !streaming && !open;
  const { settle, recheck } = useContext(Settle);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !clamp) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, text]);
  useEffect(() => { if (open) recheck(); else settle(); }, [long, open, settle, recheck]);
  return (
    <div className={`tr-assistant ${streaming ? 'streaming' : ''}`}>
      <div ref={body} className={`tr-reply ${clamp ? 'clamp' : ''} ${clamp && long ? 'clipped' : ''}`}><Markdown text={text} /></div>
      {!streaming && (long || open) && <button className="link tr-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

type Thumb = (id: string) => string | null;
type Bulleted = Extract<Item, { kind: 'done' | 'note' | 'system' | 'assistant' | 'phase' }>;
const BULLETED = new Set<Item['kind']>(['done', 'note', 'system', 'assistant', 'phase']);

/**
 * One prompt in the Timeline: her prompt as one quiet line, then a bullet list of what came of it (finished work, notes,
 * notices and the first sentence of Claude's reply). Review cards and run reports keep their own cards, in order.
 */
function TimelineTurn({ t, cwd, thumb }: { t: Turn; cwd: string; thumb: Thumb }) {
  const items = t.blocks.filter((b): b is Item => b.kind !== 'steps');
  const head = items[0]?.kind === 'user' ? items[0] : null;
  const head2 = items[0]?.kind === 'phase' ? items[0] : null;
  const parts: Array<Bulleted[] | Item> = [];
  for (const it of items.slice(head || head2 ? 1 : 0)) {
    if (!BULLETED.has(it.kind)) parts.push(it);
    else if (Array.isArray(parts[parts.length - 1])) (parts[parts.length - 1] as Bulleted[]).push(it as Bulleted);
    else parts.push([it as Bulleted]);
  }
  return (
    <div className="tl-turn">
      {head && <PromptLine text={head.text} stopping={!!head.stopping} />}
      {head2 && <Row it={head2} cwd={cwd} thumb={thumb} />}
      {parts.map((p) => (Array.isArray(p)
        ? <ul key={p[0].id} className="tl-list">{p.map((it) => <Bullet key={it.id} it={it} thumb={thumb} />)}</ul>
        : <Row key={p.id} it={p} cwd={cwd} thumb={thumb} />))}
    </div>
  );
}

/** Her prompt in one muted line. A long prompt opens to the full text, frame links and all. */
function PromptLine({ text, stopping }: { text: string; stopping: boolean }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const line = useRef<HTMLSpanElement>(null);
  const less = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const { settle, recheck } = useContext(Settle);
  useLayoutEffect(() => {
    const el = line.current;
    if (!el || open) return;
    const measure = () => setLong(text.trim().includes('\n') || el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, long, text]);
  useEffect(() => {
    if (open) recheck(); else settle();
    // Focus follows the toggle, so the keyboard never lands on a control that just went away.
    if (moved.current) (open ? less : more).current?.focus();
    moved.current = false;
  }, [open, long, settle, recheck]);
  const toggle = (v: boolean) => { moved.current = true; setOpen(v); };
  const spin = stopping && <span className="tl-prompt-stop" role="img" aria-label="Stopping"><Icon name="loading" small spin /></span>;
  if (open) {
    return (
      <div className="tl-prompt open">
        <div className="tl-prompt-full"><UserText text={text} /></div>
        {spin}
        <button ref={less} className="link tl-more" aria-expanded onClick={() => toggle(false)}>Show less</button>
      </div>
    );
  }
  // Inside the one-line button, frame links are styled names that still open the frame on click.
  const flat = <span ref={line} className="tl-prompt-text">{splitFrameLinks(text.replace(/\s+/g, ' ').trim()).map((p, i) => (typeof p === 'string'
    ? p
    : long ? <span key={i} className="frame-chip" data-node={p.id} title={p.url}>{frameName(outline, p.id) ?? p.id}</span>
      : <button key={i} className="frame-chip" title={p.url} onClick={() => showNode(p.id)}>{frameName(outline, p.id) ?? p.id}</button>))}</span>;
  if (!long) return <div className="tl-prompt">{flat}{spin}</div>;
  return (
    <div className="tl-prompt">
      <button
        ref={more}
        className="tl-prompt-open"
        aria-expanded={false}
        title="Show the full prompt"
        onClick={(e) => {
          const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-node]');
          if (chip) void showNode(chip.dataset.node!);
          else toggle(true);
        }}
      >
        {flat}
        <Icon name="chevron-down" small />
      </button>
      {spin}
    </div>
  );
}

function Bullet({ it, thumb }: { it: Bulleted; thumb: Thumb }) {
  switch (it.kind) {
    case 'done': {
      const shown = it.nodes.filter(([id]) => thumb(id));
      return (
        <li className="tl-li done">
          <span className="tl-mark"><Icon name="check" small /></span>
          <span className="tl-say">{it.text}</span>
          {shown.length > 0 && (
            <span className="tl-thumbs">
              {shown.map(([id]) => <button key={id} title="Show in Figma" onClick={() => showNode(id)}><img src={thumb(id)!} alt="" loading="lazy" /></button>)}
            </span>
          )}
        </li>
      );
    }
    case 'note':
      return <li className="tl-li note"><span className="tl-mark"><i className="tr-dot" /></span><span className="tl-say"><b>Note:</b> {it.text}</span></li>;
    case 'assistant':
      return <ReplyBullet text={it.text} streaming={it.streaming} />;
    default:
      return <li className={`tl-li ${it.kind}`}><span className="tl-mark"><i className="tl-bullet" /></span><span className="tl-say">{it.text}</span></li>;
  }
}

/** Claude's reply as its first sentence. Show reply opens the whole reply in place. */
function ReplyBullet({ text, streaming }: { text: string; streaming: boolean }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  const [open, setOpen] = useState(false);
  const { settle, recheck } = useContext(Settle);
  const sum = useMemo(() => replySummary(text, (url) => {
    const p = splitFrameLinks(url)[0];
    return typeof p === 'object' ? frameName(outline, p.id) ?? p.id : null;
  }), [text, outline]);
  const btn = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (open) recheck(); else settle();
    if (moved.current) btn.current?.focus();
    moved.current = false;
  }, [open, settle, recheck]);
  const toggle = () => { moved.current = true; setOpen((v) => !v); };
  const full = open && !streaming;
  return (
    <li className={`tl-li reply ${full ? 'open' : ''}`}>
      <span className="tl-mark"><i className="tl-bullet" /></span>
      {full ? (
        <div className="tl-say">
          <div className="tr-assistant"><Markdown text={text} /></div>
          <button ref={btn} className="link tl-more" aria-expanded onClick={toggle}>Show less</button>
        </div>
      ) : (
        <span className="tl-say">
          {sum.text || (streaming ? 'Writing a reply…' : '')}
          {!streaming && sum.more && <button ref={btn} className="link tl-more" aria-expanded={false} onClick={toggle}>Show reply</button>}
        </span>
      )}
    </li>
  );
}

function UserRule({ text }: { text: string }) {
  const hasFile = useStore((s) => Boolean(s.session.figma));
  return <MakeRule text={text} hasFile={hasFile} />;
}

function UserText({ text }: { text: string }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  return <>{splitFrameLinks(text).map((p, i) => typeof p === 'string' ? p : <button key={i} className="frame-chip" title={p.url} onClick={() => showNode(p.id)}>{frameName(outline, p.id) ?? p.id}</button>)}</>;
}

function Step({ use, result, cwd }: { use: ToolUse; result?: ToolResult; cwd: string }) {
  const [open, setOpen] = useState(false);
  const { verb, object, mono } = stepLabel(use.name, use.input, cwd);
  const state = !result ? 'pending' : result.isError ? 'err' : 'ok';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-step tr-act ${state} ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} {...press(() => setOpen((v) => !v))}>
      <span className="tr-mark">{state === 'pending' ? <Icon name="loading" small spin /> : state === 'err' ? <Icon name="close" small /> : <i className="tr-hex" />}</span>
      <span className="tr-text" title={object}>{verb} <span className={`tr-obj ${mono ? 'mono' : ''}`}>{object}</span></span>
      <span className="tr-dur">{dur}</span>
      {state === 'err' && !open && <span className="tr-err">{firstLine(result!.text) || 'Failed'}</span>}
      {open && <Detail use={use} result={result} />}
    </div>
  );
}

function Detail({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const input = typeof use.input.command === 'string' ? use.input.command : JSON.stringify(use.input, null, 2);
  return (
    <div className="tr-detail" onClick={(e) => e.stopPropagation()}>
      <pre>{input}</pre>
      {result && <pre className={result.isError ? 'err' : ''}>{result.text || '(no output)'}</pre>}
    </div>
  );
}

function FileCard({ it, cwd }: { it: Extract<Item, { kind: 'file' }>; cwd: string }) {
  const rel = relPath(it.path, cwd);
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  return (
    <div className={`tr-file tr-act ${it.error ? 'err' : ''}`} title={rel} aria-label={`Open ${rel}`} onClick={() => setUi({ openFile: rel, follow: false })} {...press(() => setUi({ openFile: rel, follow: false }))}>
      <FileIcon name={name} />
      <span className="tr-path"><span className="tr-dir">{cut >= 0 ? rel.slice(0, cut + 1) : ''}</span>{name}</span>
      {it.error ? (
        <span className="tr-err">{it.error}</span>
      ) : (
        <span className="tr-count"><span className="add">+{it.count.add}</span> <span className="del">-{it.count.del}</span></span>
      )}
    </div>
  );
}

function AgentRow({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const desc = typeof use.input.description === 'string' && use.input.description ? use.input.description : 'Sub-agent';
  const dur = result ? duration(result.at - use.at) : '';
  return (
    <div className={`tr-agent tr-act ${!result ? 'running' : result.isError ? 'err' : 'done'} ${open ? 'open' : ''}`} onClick={() => result && setOpen((v) => !v)} {...(result ? { 'aria-expanded': open, ...press(() => setOpen((v) => !v)) } : {})}>
      <span className="tr-mark"><i className="tr-ring" /></span>
      <span className="tr-text" title={desc}>
        {desc}
        <span className="tr-state"> · {!result ? 'running' : result.isError ? 'failed' : 'done'}</span>
        {!result && <Icon name="loading" small spin />}
      </span>
      <span className="tr-dur">{dur}</span>
      {open && result && <div className="tr-detail" onClick={(e) => e.stopPropagation()}><div className="tr-report"><Markdown text={result.text || '(no output)'} /></div></div>}
    </div>
  );
}

// Every mark on the card has a word next to it, so the shape and colour are never the only cue.
const TONE_WORD = { pass: 'Passed', blocking: 'Blocking issues', major: 'Major issues', error: 'Failed' } as const;

function HouseRulesRow({ run }: { run: ReviewRun }) {
  const tone = rulesTone(run);
  const go = () => focusReview({ runId: run.id, area: 'rules' });
  return (
    <li className={`tr-review-go ${tone === 'pass' ? 'pass' : `fail ${tone}`}`}>
      <button className="tr-review-btn" title="Show house rules" onClick={go}>
        <span className={`mk tr-mark ${TONE_MARK[tone]}`} aria-hidden="true" />
        <span className="tr-review-name">House rules: {rulesLine(run.rules!)}</span>
      </button>
    </li>
  );
}

function ReviewCard({ runAt }: { runAt: number }) {
  const chat = useStore((s) => s.session.id);
  const figmaKey = useStore((s) => s.session.figma?.key);
  const [copied, setCopied] = useState(false);
  const rev = useRev('review.json');
  const [doc, setDoc] = useState<ReviewDoc | null>(null);
  useEffect(() => { getJson<ReviewDoc>('/api/review').then(setDoc).catch(() => {}); }, [chat, rev]);
  const [awaiting, setAwaiting] = useState<AwaitItem[] | null>(null);
  useEffect(() => { getJson<AwaitItem[]>('/api/awaiting').then(setAwaiting).catch(() => {}); }, [chat, rev]);
  const { triage } = useTriage();
  const latestAt = doc?.runs.length ? Math.max(...doc.runs.map((r) => r.at)) : 0;
  const outline = useOutline(figmaKey);
  const lastModified = latestAt === runAt && figmaKey !== 'sample' ? outline?.lastModified : null;
  const full = doc?.runs.find((r) => r.at === runAt);
  // The newest card stays open, older ones fold to their title line, until she opens or folds one herself.
  const newest = useContext(NewestReview) === runAt;
  const [mine, setMine] = useState<boolean | null>(null);
  const open = mine ?? newest;
  const fold = useFold(open, setMine);
  const titleId = useId();
  const { settle, recheck } = useContext(Settle);
  useEffect(() => { if (mine === null) settle(); else recheck(); }, [open, mine, settle, recheck]);
  if (!doc || !full) return <div className="tr-system">Review finished</div>;
  // Findings closed by hand in the Review pane leave the counts, the area rows and the checklist.
  const run = openRun(full, triage);
  const findings = run.results.flatMap((r) => r.findings);
  const hasFindings = run.check.length + findings.length > 0;
  // Fix rounds skip the findings that wait for her decision, so Fix the issues shows only when something else is left.
  const fixable = findings.some((f) => !f.decide && f.severity !== 'minor') || rulesTone(run) === 'fail';
  const deciding = stillAwaiting(findings, figmaKey, awaiting);
  const openReview = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:review' } }));
  const copy = () => {
    navigator.clipboard.writeText(reviewChecklist(run, figmaKey && figmaKey !== 'sample' ? figmaKey : null)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const sum = summarize({ kind: run.kind === 'audit' ? 'audit' : 'review', id: run.id, at: run.at, tokens: run.tokens, run });
  return (
    <div className={`tr-review${open ? '' : ' folded'}`}>
      {!open && <FoldLine ref={fold.control} controls={fold.bodyId} className="tr-review-line" onClick={fold.toggle}><b>{runLabel(run)}</b> · {sum}</FoldLine>}
      <div className="tr-review-body" id={fold.bodyId} hidden={!open}>
      <div className="tr-review-head">
        <b id={titleId}>{runLabel(run)}</b>
        <span className="tr-review-sum">{sum}{deciding > 0 && <> · <button className="link tr-review-await" title="Open Review: findings that change something shared wait for your decision" onClick={openReview}>{waitText(deciding)}</button></>}</span>
      </div>
      {open && <FoldButton ref={fold.control} controls={fold.bodyId} describedBy={titleId} onClick={fold.toggle} />}
      {run.frames.length > 0 && <div className="tr-review-frames"><FrameNames ids={run.frames} names={run.names} /></div>}
      <ul className="tr-review-rows">
        {areaRows(run).map((a) => (
          <li key={a.key} className={a.pass ? 'pass' : `fail tr-review-go ${a.tone}`}>
            {a.pass ? (
              <><span className="mk tr-mark pass" aria-hidden="true" /><span className="tr-review-name">{a.name}</span><span className="tr-review-state">Passed</span></>
            ) : (
              <button className="tr-review-btn" title="Show findings" onClick={() => focusReview({ runId: run.id, area: a.key })}>
                <span className={`mk tr-mark ${TONE_MARK[a.tone]}`} aria-hidden="true" />
                <span className="tr-review-name">{a.name}</span>
                <span className={a.failed ? 'tr-review-failed' : 'tr-review-state'}>{TONE_WORD[a.tone]}</span>
              </button>
            )}
          </li>
        ))}
        {!!run.rules?.length && <HouseRulesRow run={run} />}
      </ul>
      {isStale(run, lastModified, latestAt) && <div className="tr-review-stale">File changed since this review. <button className="link" onClick={() => insertPrompt(`/review check ${run.frames.join(' ')}`)}>Check again</button></div>}
      <div className="tr-review-actions">
        {fixable ? (
          <>
            <button title="Put the fix request in the message box" onClick={() => insertPrompt(FIX_ASK)}>Fix the issues</button>
            <button className="link" onClick={openReview}>Open Review</button>
          </>
        ) : <button onClick={openReview}>Open Review</button>}
        {hasFindings && <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy as checklist'}</button>}
        {retryPrompt(run) && <button className="link" title="Put this review in the composer to run it again" onClick={() => insertPrompt(retryPrompt(run)!)}>Retry</button>}
        {canGoDeeper(run) && <button className="link" onClick={() => insertPrompt('/review full')}>Review deeper</button>}
      </div>
      </div>
    </div>
  );
}
