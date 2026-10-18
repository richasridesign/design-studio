import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getJson, postJson, setUi, useRev, useStore } from '../store';
import { CHECKS } from '../setupChecks';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { FileIcon } from './Explorer';
import { insertPrompt, showNode } from './Files';
import { openSample } from './Chats';
import { useThumbs } from '../useThumbs';
import { frameName, splitFrameLinks, useOutline } from '../outline';
import { FrameNames } from '../FrameNames';
import { Confirm } from '../Confirm';
import { buildTranscript, duration, firstLine, groupTurns, recentTurns, relPath, stepLabel, timelineTurns, type Block, type Item, type ToolResult, type ToolUse } from './steps';
import { MakeRule } from './MakeRule';
import { press } from '../press';
import { LongRunReport } from './LongRun';
import { focusReview } from './reviewFocus';
import { areaRows, canGoDeeper, isStale, retryPrompt, rulesTone, runLabel, summarize, unposted } from './reviewRuns';
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

export function Transcript({ view = 'transcript', children }: { view?: ChatView; children?: ReactNode }) {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const status = useStore((s) => s.status);
  const figmaKey = useStore((s) => s.session.figma?.key);
  return <TranscriptView events={events} cwd={cwd} running={running} stopping={stopping} status={status} figmaKey={figmaKey} view={view}>{children}</TranscriptView>;
}

export function welcomeChips(fileName: string | null): Array<{ label: string; attach?: boolean }> {
  if (fileName) return [`Review the frames in ${fileName} for spacing and contrast`, 'Add missing empty, loading and error states to the selected frame', 'Suggest three layout options for the selected frame', `Write a design brief for the next screen in ${fileName}`].map((label) => ({ label }));
  return [{ label: 'Attach Figma file', attach: true }, { label: 'Suggest three layout options for a pricing page' }, { label: 'Write empty, loading and error states for a sign-up screen' }, { label: 'Turn these notes into a design brief' }];
}

function SetupBanner() {
  const [problem, setProblem] = useState<{ tone: 'warn' | 'bad'; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([CHECKS.figma(), CHECKS.mcp()]).then((r) => {
      // The Figma tools matter most for a chat, so their state wins over the token's.
      const c = [r[1], r[0]].find((x) => x.tone !== 'ok');
      if (live && c && c.tone !== 'ok') setProblem({ tone: c.tone, text: [c.detail, c.fix].filter(Boolean).join('. ').replace(/\.\./g, '.') });
    });
    return () => { live = false; };
  }, []);
  if (!problem) return null;
  return (
    <div className="tl-setup" role="status">
      <span className={`tl-setup-mark ${problem.tone}`} aria-hidden />
      <span>{problem.text} <button className="link" onClick={() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } }))}>Open Settings</button></span>
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
      <p>Ask Claude about a design. Design mode (⌥M) plans, sketches, designs and reviews it.</p>
      {attach && (
        <div className="tl-start">
          <button className="tl-attach" onClick={() => window.dispatchEvent(new Event('designstudio:attach'))}><Icon name="file-media" small />{attach.label}</button>
          <button className="link" onClick={() => { setSampleError(''); openSample().catch((e: Error) => setSampleError(e.message)); }}>Try the sample tour</button>
        </div>
      )}
      {sampleError && <p className="error-text" role="alert">{sampleError}</p>}
      <div className="tl-suggest-label" id="tl-suggest-label">Or start from a prompt</div>
      <ul className="tl-suggest" aria-labelledby="tl-suggest-label">
        {chips.filter((c) => !c.attach).map((c) => (
          <li key={c.label}>
            <button title="Put this prompt in the message box" onClick={() => insertPrompt(c.label)}>
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

  return (
    <Settle.Provider value={scroll}>
      <div ref={box} className={`tr ${view}`} onScroll={recheck}>
        {items.length === 0 && (
          <Welcome fileName={fileName} />
        )}
        {hidden > 0 && <div className="tl-earlier"><button className="link" onClick={() => setEarly(true)}>Show {hidden} earlier {hidden === 1 ? 'prompt' : 'prompts'}</button></div>}
        {turns.map((t, i) => t.blocks.map((b) => <BlockRow key={b.id} b={b} cwd={cwd} thumb={thumb} live={running && i === turns.length - 1} />))}
        {running && children === undefined && (
          <div className="tr-working">
            <span className="tr-mark"><Icon name="loading" small spin /></span>
            <span className="tr-text">{stopping ? 'Stopping…' : runningText(status)}</span>
          </div>
        )}
        {children}
      </div>
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
          {!it.stopping && <UserRule text={it.text} />}
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

function HouseRulesRow({ run }: { run: ReviewRun }) {
  const tone = rulesTone(run);
  const go = () => focusReview({ runId: run.id, area: 'rules' });
  return (
    <li className={`tr-review-go ${tone === 'pass' ? 'pass' : `fail ${tone}`}`}>
      <button className="tr-review-btn" title="Show house rules" onClick={go}>
        <Icon name={tone === 'pass' ? 'check' : tone === 'major' ? 'warning' : tone === 'error' ? 'close' : 'circle-large-outline'} small />
        <span className="tr-review-name">House rules: {rulesLine(run.rules!)}</span>
      </button>
    </li>
  );
}

function ReviewCard({ runAt }: { runAt: number }) {
  const chat = useStore((s) => s.session.id);
  const hasFile = useStore((s) => !!s.session.figma);
  const figmaKey = useStore((s) => s.session.figma?.key);
  const fileName = useStore((s) => s.session.figma?.name) ?? 'the Figma file';
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const postBtn = useRef<HTMLButtonElement>(null);
  const rev = useRev('review.json');
  const [doc, setDoc] = useState<ReviewDoc | null>(null);
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { getJson<ReviewDoc>('/api/review').then(setDoc).catch(() => {}); }, [chat, rev]);
  const { triage } = useTriage();
  const latestAt = doc?.runs.length ? Math.max(...doc.runs.map((r) => r.at)) : 0;
  const outline = useOutline(figmaKey);
  const lastModified = latestAt === runAt && figmaKey !== 'sample' ? outline?.lastModified : null;
  const full = doc?.runs.find((r) => r.at === runAt);
  if (!doc || !full) return <div className="tr-system">Review finished</div>;
  // Findings closed by hand in the Review pane leave the counts, the area rows and the Figma post.
  const run = openRun(full, triage);
  const pending = unposted(run, doc);
  const post = async () => {
    setPosting(true);
    try {
      const r = await postJson<{ posted: number }>('/api/review/post', { runId: run.id, ids: pending.map((f) => f.id) });
      setNote(`Posted ${r.posted} ${r.posted === 1 ? 'comment' : 'comments'} in Figma`);
      setDoc(await getJson<ReviewDoc>('/api/review'));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setPosting(false);
    }
  };
  const hasFindings = run.check.length + run.results.reduce((n, r) => n + r.findings.length, 0) > 0;
  const copy = () => {
    navigator.clipboard.writeText(reviewChecklist(run, figmaKey && figmaKey !== 'sample' ? figmaKey : null)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="tr-review">
      <div className="tr-review-head">
        <b>{runLabel(run)}</b>
        <span className="tr-review-sum">{summarize({ kind: run.kind === 'audit' ? 'audit' : 'review', id: run.id, at: run.at, tokens: run.tokens, run })}</span>
        {run.tokens > 0 && <span className="tr-dur">{Math.round(run.tokens / 1000)}k tokens</span>}
      </div>
      {run.frames.length > 0 && <div className="tr-review-frames"><FrameNames ids={run.frames} /></div>}
      <ul className="tr-review-rows">
        {areaRows(run).map((a) => (
          <li key={a.key} className={a.pass ? 'pass' : `fail tr-review-go ${a.tone}`}>
            {a.pass ? (
              <><Icon name="check" small /><span className="tr-review-name">{a.name}</span></>
            ) : (
              <button className="tr-review-btn" title="Show findings" onClick={() => focusReview({ runId: run.id, area: a.key })}>
                <Icon name={a.tone === 'major' ? 'warning' : 'close'} small />
                <span className="tr-review-name">{a.name}</span>
                {a.failed && <span className="tr-review-failed">failed</span>}
              </button>
            )}
          </li>
        ))}
        {!!run.rules?.length && <HouseRulesRow run={run} />}
      </ul>
      {isStale(run, lastModified, latestAt) && <div className="tr-review-stale">File changed since this review. <button className="link" onClick={() => insertPrompt(`/review check ${run.frames.join(' ')}`)}>Check again</button></div>}
      <div className="tr-review-actions">
        <button onClick={() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:review' } }))}>Open Review</button>
        {hasFile && pending.length > 0 && <button ref={postBtn} className="link" disabled={posting} title={`Post ${pending.length} ${pending.length === 1 ? 'finding' : 'findings'} as Figma comments`} onClick={() => setAsking(true)}>Post {pending.length} to Figma</button>}
        {hasFindings && <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy as checklist'}</button>}
        {retryPrompt(run) && <button className="link" title="Put this review in the composer to run it again" onClick={() => insertPrompt(retryPrompt(run)!)}>Retry</button>}
        {canGoDeeper(run) && <button className="link" onClick={() => insertPrompt('/review full')}>Review deeper</button>}
        {note && <span className="tr-review-note" role="status">{note}</span>}
      </div>
      {asking && (
        <Confirm
          safe
          icon="comment"
          title={`Post ${pending.length} ${pending.length === 1 ? 'comment' : 'comments'} to Figma?`}
          detail={`Each finding becomes a comment on its frame in ${fileName}.`}
          warning="Everyone with access to the file sees them."
          action={`Post ${pending.length}`}
          run={post}
          onClose={() => { setAsking(false); requestAnimationFrame(() => postBtn.current?.focus()); }}
        />
      )}
    </div>
  );
}
