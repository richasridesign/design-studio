import { useEffect, useId, useRef, useState } from 'react';
import { connect, getJson, useStore } from './store';
import { Brief } from './panes/Brief';
import { ErrorBoundary } from './ErrorBoundary';
import { Terminal } from './panes/Terminal';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Palette } from './panes/Palette';
import { Explorer } from './panes/Explorer';
import { Chats } from './panes/Chats';
import { Files, insertPrompt } from './panes/Files';
import { Empty, PrototypeArt } from './panes/Empty';
import { DesignSystem } from './panes/DesignSystem';
import { Sketch } from './panes/Sketch';
import { Review } from './panes/Review';
import { Decisions } from './panes/Decisions';
import { Settings } from './panes/Settings';
import { RecipeEditorHost } from './RecipeEditorHost';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';
import { FilePill } from './AttachFile';
import { ConnectPopover } from './ConnectPopover';
import { McpItem, McpPage } from './panes/McpStatus';
import { FigmaItem, StatusBar, runningText } from './StatusBar';
import { IconButton } from './Tip';
import { SpendPill } from './SpendPill';
import { Shortcuts } from './Shortcuts';
import { Research } from './panes/Research';
import { openSection } from './Section';
import { useCanvasContent } from './canvasContent';
import { canNotify, toggleNotify, useNotify } from './notify';
import { FigmaLoginHost } from './FigmaLogin';
import './page.css';
import './design.css';

type Center = 'figma' | 'sketch' | 'review' | 'decisions' | 'preview' | 'code';
type Tab = 'chat' | 'figma' | 'sketch' | 'review' | 'decisions' | 'more';
const MOBILE_CENTER: Center[] = ['figma', 'sketch', 'review', 'decisions'];
const isMobileCenter = (t: string): t is Center & Tab => MOBILE_CENTER.some((c) => c === t);

const VIEW_IDS = ['chats', 'files', 'system', 'explorer'] as const;
type View = (typeof VIEW_IDS)[number];
const isView = (v: unknown): v is View => VIEW_IDS.some((x) => x === v);

const VIEWS: { id: View; icon: string; title: string; dev?: boolean }[] = [
  { id: 'chats', icon: 'comment-discussion', title: 'Chats' },
  { id: 'files', icon: 'file-media', title: 'File' },
  { id: 'system', icon: 'symbol-color', title: 'Design system' },
  { id: 'explorer', icon: 'files', title: 'Chat folder', dev: true },
];

const CENTER: { id: Center; icon: string; label: string; dev?: boolean }[] = [
  { id: 'figma', icon: 'browser', label: 'Figma' },
  { id: 'sketch', icon: 'edit', label: 'Sketch' },
  { id: 'review', icon: 'checklist', label: 'Review' },
  { id: 'decisions', icon: 'lightbulb', label: 'Decisions' },
  { id: 'preview', icon: 'play', label: 'Preview', dev: true },
  { id: 'code', icon: 'code', label: 'Files', dev: true },
];

const PHASE_TAB: Record<string, Center> = { sketch: 'sketch', pick: 'sketch', file: 'figma', design: 'figma', fix: 'figma', review: 'review' };
const PHASE_LABEL: Record<string, string> = { plan: 'Plan', sketch: 'Sketch', pick: 'Pick a direction', file: 'Attach Figma file', system: 'Design system', design: 'Design', review: 'Review', fix: 'Fix', done: 'Done', stopped: 'Stopped' };
const narrow = () => window.innerWidth <= 900;
// Visually hidden, still read by screen readers (the page's one h1).
const HIDDEN: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' };

function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function Offline() {
  const connected = useStore((s) => s.ui.connected);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (connected) return;
    const t = setTimeout(() => setLate(true), 2000);
    return () => clearTimeout(t);
  }, [connected]);
  if (connected || !late) return null;
  return <div className="app-update offline"><Icon name="plug" small /><span>Disconnected from Design Studio, reconnecting</span></div>;
}

function Preview() {
  const chat = useStore((s) => s.session.id);
  const rev = useStore((s) => s.ui.revs['prototype/index.html'] ?? 0);
  const [ok, setOk] = useState<boolean | null>(null);
  const src = `/api/chat-file/prototype/index.html?chat=${encodeURIComponent(chat)}&r=${rev}`;
  useEffect(() => {
    fetch(src, { method: 'GET' }).then((r) => setOk(r.ok)).catch(() => setOk(false));
  }, [src]);
  if (!ok) return <Empty art={<PrototypeArt />} title="No prototype yet" text="Claude can turn your frames into a clickable HTML prototype that you can try here and on your phone." action={{ label: 'Build a prototype', onClick: () => insertPrompt('/prototype ') }} />;
  return <iframe className="preview-frame" title="Prototype" src={src} />;
}

function Dialog({ title, onClose, extra, wide, children }: { title: string; onClose: () => void; extra?: string; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, box, onClose);
  return (
    <div className="overlay settings-overlay" onClick={onClose}>
      <div ref={box} className={`settings-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="settings-dialog-body">{extra && <div id={extra} className="dialog-extra" />}{children}</div>
      </div>
    </div>
  );
}

export function App() {
  const connected = useStore((s) => s.ui.connected);
  const pendingCount = useStore((s) => s.pending.length);
  const elsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const events = useStore((s) => s.events);
  const phase = useStore((s) => s.session.flow.phase);
  const [tab, setTab] = useState<Tab>('chat');
  const [center, setCenter] = useState<Center>('figma');
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<View>('chats');
  const [phone, setPhone] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const content = useCanvasContent();
  const [dev, setDev] = useState(false);
  const [chatW, setChatW] = useState(() => stored('designstudio.chatW', 460));
  const [termH, setTermH] = useState(() => stored('designstudio.termH', 240));
  const [terminal, setTerminal] = useState(false);
  const [focusMode, setFocusMode] = useState(() => {
    try {
      return localStorage.getItem('designstudio.focus') === '1';
    } catch {
      return false;
    }
  });
  const toggleFocus = () => setFocusMode((v) => !v);
  const notifying = useNotify();

  const loadDev = () => getJson<{ devTools: boolean }>('/api/settings').then((s) => setDev(s.devTools)).catch(() => {});
  useEffect(() => {
    void loadDev();
    window.addEventListener('designstudio:settings', loadDev);
    return () => window.removeEventListener('designstudio:settings', loadDev);
  }, []);

  const drag = (e: React.PointerEvent, move: (ev: PointerEvent) => void, cls: string) => {
    e.preventDefault();
    document.body.classList.add(cls);
    const up = () => {
      document.body.classList.remove(cls);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startResize = (e: React.PointerEvent) => drag(e, (ev) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 380), window.innerWidth - 480))), 'resizing');
  const startTermResize = (e: React.PointerEvent) => drag(e, (ev) => setTermH(Math.round(Math.min(Math.max(window.innerHeight - 30 - ev.clientY, 100), window.innerHeight - 200))), 'resizing-v');

  const showView = (v: View) => {
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };
  const open = (c: Center) => {
    setCenter(c);
    setOpened(true);
    if (narrow()) setTab(isMobileCenter(c) ? c : 'more');
  };

  useEffect(() => {
    if (pendingCount > 0) setTab('chat');
  }, [pendingCount]);

  const empty = !session.figma || session.id === '' || events.length === 0;
  useEffect(() => {
    setOpened(false);
    if (empty) setCenter('figma');
  }, [session.id]);

  useEffect(() => {
    const next = phase ? PHASE_TAB[phase] : undefined;
    if (next && !narrow()) { setCenter(next); setOpened(true); }
  }, [phase]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.focus', focusMode ? '1' : '0');
    } catch {}
  }, [focusMode]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.chatW', String(chatW));
      localStorage.setItem('designstudio.termH', String(termH));
    } catch {}
  }, [chatW, termH]);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); window.dispatchEvent(new Event('designstudio:attach')); }
      if (k === '.' && !narrow()) { e.preventDefault(); toggleFocus(); }
      if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
      if (k === 'j' && dev) { e.preventDefault(); setTerminal((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dev]);

  useEffect(() => {
    const onCommand = (e: Event) => {
      const [kind, arg] = (e as CustomEvent<{ id: string }>).detail.id.split(':');
      if (kind === 'view') {
        if (arg === 'comments') openSection('files', 'comments');
        else if (arg === 'rules') openSection('system', 'rules');
        else if (isView(arg)) { setView(arg); setSidebar(true); if (narrow()) setTab('more'); }
      }
      else if (kind === 'page') { if (arg === 'settings') setSettings(true); else if (arg === 'mcp') setMcpOpen(true); else open(arg as Center); }
      else if (kind === 'focus') { if (!narrow()) toggleFocus(); }
      else if (kind === 'phone') setPhone((v) => !v);
      else if (kind === 'tab') setTab(arg as Tab);
    };
    const onSection = (e: Event) => {
      const next = (e as CustomEvent<{ view?: unknown }>).detail?.view;
      if (!isView(next)) return;
      setView(next);
      setSidebar(true);
      if (narrow()) setTab('more');
    };
    window.addEventListener('designstudio:command', onCommand);
    window.addEventListener('designstudio:section', onSection);
    return () => {
      window.removeEventListener('designstudio:command', onCommand);
      window.removeEventListener('designstudio:section', onSection);
    };
  }, []);

  const figma = session.figma;
  const title = figma?.name ?? 'No Figma file';
  const centers = CENTER.filter((c) => (c.dev ? dev : content[c.id as keyof typeof content] || (opened && center === c.id)));
  const collapsed = centers.length === 0;
  const views = VIEWS.filter((v) => !v.dev || dev);
  const wanted = narrow() && isMobileCenter(tab) ? tab : center;
  const shownCenter = centers.some((c) => c.id === wanted) ? wanted : centers[0]?.id;
  const [rove, setRove] = useState<string | null>(null);
  const tabKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'));
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setRove(tabs[to].id.replace('tab-', ''));
    tabs[to].focus();
  };

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-focus={focusMode} data-collapsed={collapsed} style={{ '--chat-w': `${chatW}px` } as React.CSSProperties}>
      <Offline />
      <header className="topbar">
        <h1 style={HIDDEN}>Design Studio</h1>
        <span className="brand" aria-hidden><span className="logo" />Design Studio</span>
        <FilePill />
        <span className="spacer" />
        <span className={`run-state ${session.running ? 'busy' : ''}`}>
          <Icon name={session.running ? 'loading' : 'circle-large-outline'} small spin={session.running} /> <span className="label">{session.running ? runningText(status) : 'Idle'}</span>
        </span>
        <span className="mobile-only top-meta"><ErrorBoundary label="cost"><SpendPill /></ErrorBoundary>{dev ? <McpItem /> : <FigmaItem />}</span>
        {canNotify && <IconButton label="Notify me" tip={notifying ? 'Notifications on: Claude tells you when it finishes or needs you' : 'Notify me when Claude finishes or needs me'} aria-pressed={notifying} onClick={toggleNotify}><Icon name={notifying ? 'bell' : 'bell-slash'} /></IconButton>}
        <IconButton label="Open on phone" className="icon-btn phone-btn" aria-haspopup="dialog" aria-expanded={phone} onClick={() => setPhone((v) => !v)}><Icon name="device-mobile" /></IconButton>
        <IconButton label="Settings" tip="Settings (⌘,)" aria-keyshortcuts="Meta+Comma" className={`icon-btn ${settings ? 'active' : ''}`} onClick={() => setSettings(true)}><Icon name="settings-gear" /></IconButton>
        {!connected && <span className="error-text">Disconnected</span>}
      </header>
      <div className="body">
        <nav className="activitybar desktop-only" aria-label="Views">
          {views.map((v) => {
            const badge = v.id === 'chats' && elsewhere > 0;
            return (
              <IconButton key={v.id} label={v.title} place="right" className={`${sidebar && view === v.id ? 'active' : ''}${badge ? ' has-alert' : ''}`} aria-pressed={sidebar && view === v.id}
                aria-describedby={badge ? 'chats-badge' : undefined} onClick={() => showView(v.id)}>
                <Icon name={v.icon} />
                {badge && <span className="badge"><span aria-hidden="true">{elsewhere}</span><span id="chats-badge" className="sr-only">{elsewhere === 1 ? '1 chat needs you' : `${elsewhere} chats need you`}</span></span>}
              </IconButton>
            );
          })}
        </nav>

        {/* Desktop: named regions so every part sits in a landmark. Phone: the shown part is the one main. */}
        <section className="sidebar pane side" role={narrow() && tab === 'more' ? 'main' : undefined} aria-label={narrow() ? (tab === 'more' ? 'More' : undefined) : (VIEWS.find((v) => v.id === view) ?? VIEWS[0]).title}>
          <div className="sidebar-title">{(VIEWS.find((v) => v.id === view) ?? VIEWS[0]).title}</div>
          {tab === 'more' && (
            <div className="side-switch mobile-only">
              {views.map((v) => <button key={v.id} className={view === v.id ? 'active' : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.title}</button>)}
              {content.decisions && <button onClick={() => open('decisions')}>Decisions</button>}
              <button onClick={() => setSettings(true)}>Settings</button>
            </div>
          )}
          <ErrorBoundary label="sidebar">
            {view === 'chats' ? <Chats /> : view === 'files' ? <Files /> : view === 'system' ? <DesignSystem /> : <Explorer />}
          </ErrorBoundary>
        </section>

        {/* On a phone the chat is hidden behind the Figma or Review tab, so the shown panel is the main landmark. */}
        <section className="editor-group pane code" role={narrow() && isMobileCenter(tab) ? 'main' : undefined} aria-label={!narrow() || isMobileCenter(tab) ? 'Panels' : undefined}>
          <div className="tabs">
            {/* Tabs for screen readers: arrows move between tabs, Enter or Space opens one. */}
            <div role="tablist" aria-label="Panels" style={{ display: 'contents' }} onKeyDown={tabKeys}>
              {centers.map((c) => (
                <button key={c.id} id={`tab-${c.id}`} role="tab" aria-selected={shownCenter === c.id} aria-controls={`panel-${c.id}`} tabIndex={(centers.some((x) => x.id === rove) ? rove : shownCenter) === c.id ? 0 : -1}
                  className={`tab ${shownCenter === c.id ? 'active' : ''}`} onClick={() => { setRove(null); open(c.id); }}>
                  <Icon name={c.icon} small /> {c.label}
                  {c.id === 'sketch' && phase === 'pick' && <span className="badge waiting" title="Waiting for your pick" aria-label="Waiting for your pick">!</span>}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <IconButton label="Focus mode" tip={focusMode ? 'Exit focus mode (⌘.)' : 'Focus mode (⌘.)'} aria-pressed={focusMode} aria-keyshortcuts="Meta+Period" className="icon-btn focus-btn desktop-only" onClick={toggleFocus}><Icon name={focusMode ? 'screen-normal' : 'screen-full'} small /></IconButton>
          </div>
          <ErrorBoundary label="panel">
          <div className={`editor browser ${shownCenter === 'figma' ? 'shown' : ''}`} id="panel-figma" role="tabpanel" aria-labelledby="tab-figma">{shownCenter === 'figma' && <BrowserPane />}</div>
          <div className={`editor ${shownCenter === 'sketch' ? 'shown' : ''}`} id="panel-sketch" role="tabpanel" aria-labelledby="tab-sketch">{shownCenter === 'sketch' && <Sketch />}</div>
          <div className={`editor ${shownCenter === 'review' ? 'shown' : ''}`} id="panel-review" role="tabpanel" aria-labelledby="tab-review">{shownCenter === 'review' && <Review dev={dev} />}</div>
          <div className={`editor ${shownCenter === 'decisions' ? 'shown' : ''}`} id="panel-decisions" role="tabpanel" aria-labelledby="tab-decisions">{shownCenter === 'decisions' && <Decisions />}</div>
          <div className={`editor ${shownCenter === 'preview' ? 'shown' : ''}`} id="panel-preview" role="tabpanel" aria-labelledby="tab-preview">{shownCenter === 'preview' && <Preview />}</div>
          {dev && <div className={`editor ${shownCenter === 'code' ? 'shown' : ''}`} id="panel-code" role="tabpanel" aria-labelledby="tab-code"><CodePane /></div>}
          </ErrorBoundary>
          {focusMode && (
            <div className="focus-pill desktop-only">
              <Icon name={session.running ? 'loading' : 'circle-large-outline'} small spin={session.running} />
              <span>{PHASE_LABEL[phase ?? ''] ?? 'No design run'}</span>
              <span className="sep">·</span>
              <span>{session.running ? 'Running' : 'Idle'}</span>
              <IconButton label="Exit focus mode" tip="Exit focus mode (⌘.)" aria-keyshortcuts="Meta+Period" place="top" onClick={toggleFocus}><Icon name="screen-normal" small /></IconButton>
            </div>
          )}
          {dev && (
            <div className="panel" style={terminal ? { height: termH } : undefined}>
              {terminal && <div className="panel-sash" onPointerDown={startTermResize} />}
              <Terminal key={session.id} chat={session.id} project={title} open={terminal} onToggle={() => setTerminal((v) => !v)} />
            </div>
          )}
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <main className="main pane center" aria-label="Chat">
          <ErrorBoundary label="chat">
            <Brief />
          </ErrorBoundary>
        </main>
      </div>

      <ErrorBoundary label="status bar">
        <StatusBar />
      </ErrorBoundary>

      <nav className="tabbar mobile-only" aria-label="Sections">
        {([['chat', 'comment-discussion', 'Chat'], ['figma', 'browser', 'Figma'], ['sketch', 'edit', 'Sketch'], ['review', 'checklist', 'Review'], ['more', 'ellipsis', 'More']] as const).filter(([id]) => id === 'chat' || id === 'more' || content[id] || tab === id).map(([id, icon, label]) => (
          <button key={id} className={tab === id || (id === 'more' && tab === 'decisions') ? 'active' : ''} aria-current={tab === id || (id === 'more' && tab === 'decisions') ? 'page' : undefined} onClick={() => { setTab(id); if (id !== 'chat' && id !== 'more') { setCenter(id); setOpened(true); } }}>
            <Icon name={icon} />
            <span>{label}</span>
            {id === 'chat' && pendingCount > 0 && <span className="badge"><span aria-hidden="true">{pendingCount}</span><span className="sr-only">{pendingCount === 1 ? ', 1 request waiting' : `, ${pendingCount} requests waiting`}</span></span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
      <Palette />
      <RecipeEditorHost />
      <Shortcuts />
      <Research />
      <FigmaLoginHost />
      {settings && <Dialog title="Settings" onClose={() => setSettings(false)}><Settings /></Dialog>}
      {mcpOpen && <Dialog title="MCP servers" extra="page-mcp-extra" wide onClose={() => setMcpOpen(false)}><McpPage /></Dialog>}
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
    </div>
  );
}
