import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
import { insertPrompt } from './panes/composerEvents';
import { Empty, PrototypeArt } from './panes/Empty';
import { DesignSystem } from './panes/DesignSystem';
import { Review } from './panes/Review';
import { History } from './panes/History';
import { Settings } from './panes/Settings';
import { RecipeEditorHost } from './RecipeEditorHost';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';
import { AttachHost } from './AttachFile';
import { ConnectPopover } from './ConnectPopover';
import { McpItem, McpPage } from './panes/McpStatus';
import { FigmaItem, StatusBar, runningText } from './StatusBar';
import { IconButton } from './Tip';
import { SpendPill } from './SpendPill';
import { Shortcuts } from './Shortcuts';
import { Research } from './panes/Research';
import { openSection } from './Section';
import { canNotify, toggleNotify, useNotify } from './notify';
import { FigmaLoginHost } from './FigmaLogin';
import './page.css';
import './design.css';

type Center = 'figma' | 'review' | 'history' | 'preview' | 'code';
type Tab = 'chat' | 'figma' | 'review' | 'history' | 'more';
const MOBILE_CENTER: Center[] = ['figma', 'review', 'history'];
const isMobileCenter = (t: string): t is Center & Tab => MOBILE_CENTER.some((c) => c === t);

const VIEW_IDS = ['chats', 'system', 'explorer'] as const;
type View = (typeof VIEW_IDS)[number];
const isView = (v: unknown): v is View => VIEW_IDS.some((x) => x === v);

const VIEWS: { id: View; icon: string; title: string; dev?: boolean }[] = [
  { id: 'chats', icon: 'comment-discussion', title: 'Chats' },
  { id: 'system', icon: 'symbol-color', title: 'Design system' },
  { id: 'explorer', icon: 'files', title: 'Chat folder', dev: true },
];

const CENTER: { id: Center; icon: string; label: string; dev?: boolean }[] = [
  { id: 'figma', icon: 'browser', label: 'Figma' },
  { id: 'review', icon: 'checklist', label: 'Review' },
  { id: 'history', icon: 'history', label: 'History' },
  { id: 'preview', icon: 'play', label: 'Preview', dev: true },
  { id: 'code', icon: 'code', label: 'Files', dev: true },
];

const narrow = () => window.innerWidth <= 900;
// Visually hidden, still read by screen readers (the page's one h1).
const HIDDEN: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' };

// The left sidebar is half size by default and can be dragged wider for long names.
const SIDE_MIN = 160;
const SIDE_MAX = 360;
const clampSide = (n: number) => Math.round(Math.min(Math.max(n, SIDE_MIN), SIDE_MAX));

function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

// The chat's reading place: the first row of the conversation in view and its distance from the top. Widening the chat
// rewraps every line, so scrollTop alone would land somewhere else.
type ReadPlace = { index: number; offset: number } | 'end' | null;
const chatScroller = () => document.querySelector<HTMLElement>('.brief .tr');
function readPlace(): ReadPlace {
  const el = chatScroller();
  if (!el) return null;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) return 'end';
  const top = el.getBoundingClientRect().top;
  // The first row that starts in view: a row half scrolled past may shrink below the top once its lines rewrap.
  const rows = Array.from(el.children) as HTMLElement[];
  const starts = rows.findIndex((r) => r.getBoundingClientRect().top >= top);
  const index = starts >= 0 ? starts : rows.findIndex((r) => r.getBoundingClientRect().bottom > top);
  return index < 0 ? null : { index, offset: rows[index].getBoundingClientRect().top - top };
}
function keepPlace(place: ReadPlace) {
  const el = chatScroller();
  if (!el || !place) return;
  if (place === 'end') { el.scrollTop = el.scrollHeight; return; }
  const row = el.children[place.index] as HTMLElement | undefined;
  if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - place.offset;
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
  const [tab, setTab] = useState<Tab>('chat');
  const [center, setCenter] = useState<Center>('figma');
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<View>('chats');
  const [phone, setPhone] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [dev, setDev] = useState(false);
  const [chatW, setChatW] = useState(() => stored('designstudio.chatW', 460));
  const [sideW, setSideW] = useState(() => clampSide(stored('designstudio.sideW', SIDE_MIN)));
  // The chat column folds away so the Figma tab gets the width. ⌥⌘B, like the secondary sidebar in VS Code.
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem('designstudio.chatOpen') !== '0';
    } catch {
      return true;
    }
  });
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
  // Expand chat: the chat takes the panel area (Figma, Review, History), its conversation in a 720px column. The top
  // bar, the activity bar and the sidebar stay as they are. Desktop only; a phone already shows the chat full screen.
  // The Figma tab is out of sight meanwhile, so its capture pauses.
  const [chatWide, setChatWide] = useState(() => {
    try {
      return localStorage.getItem('designstudio.chatExpanded') === '1';
    } catch {
      return false;
    }
  });
  // A phone or a narrow window shows one part at a time, so nothing is covered there.
  const [small, setSmall] = useState(narrow);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setSmall(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const wideToggle = useRef<HTMLButtonElement>(null);
  const wideNow = useRef(false);
  const place = useRef<ReadPlace>(null);
  const setWide = (next: boolean) => {
    if (wideNow.current !== next) place.current = readPlace();
    setChatWide(next);
  };
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
  // The chat leaves the panel area at least 480px beside the sidebar.
  const startResize = (e: React.PointerEvent) => drag(e, (ev) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 380), window.innerWidth - 480 - (sidebar ? sideW : 0)))), 'resizing');
  const startSideResize = (e: React.PointerEvent) => {
    const left = (e.currentTarget.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().left ?? 48;
    drag(e, (ev) => setSideW(clampSide(ev.clientX - left)), 'resizing');
  };
  const sideKeys = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
    if (step) { e.preventDefault(); setSideW((w) => clampSide(w + step)); }
    else if (e.key === 'Home') { e.preventDefault(); setSideW(SIDE_MIN); }
    else if (e.key === 'End') { e.preventDefault(); setSideW(SIDE_MAX); }
  };
  const startTermResize = (e: React.PointerEvent) => drag(e, (ev) => setTermH(Math.round(Math.min(Math.max(window.innerHeight - 30 - ev.clientY, 100), window.innerHeight - 200))), 'resizing-v');

  const showView = (v: View) => {
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };
  const open = (c: Center) => {
    setCenter(c);
    setWide(false);
    if (narrow()) setTab(isMobileCenter(c) ? c : 'more');
  };

  useEffect(() => {
    if (pendingCount > 0) setTab('chat');
  }, [pendingCount]);

  const empty = !session.figma || session.id === '' || events.length === 0;
  useEffect(() => {
    if (empty) setCenter('figma');
  }, [session.id]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.focus', focusMode ? '1' : '0');
    } catch {}
  }, [focusMode]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.chatOpen', chatOpen ? '1' : '0');
    } catch {}
  }, [chatOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.chatExpanded', chatWide ? '1' : '0');
    } catch {}
  }, [chatWide]);

  // Hiding the chat or entering focus mode gives the window back to the panels, so the chat comes back at its width.
  useEffect(() => {
    if (!chatOpen || focusMode) setChatWide(false);
  }, [chatOpen, focusMode]);

  useEffect(() => {
    try {
      localStorage.setItem('designstudio.chatW', String(chatW));
      localStorage.setItem('designstudio.termH', String(termH));
      localStorage.setItem('designstudio.sideW', String(sideW));
    } catch {}
  }, [chatW, termH, sideW]);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); window.dispatchEvent(new Event('designstudio:attach')); }
      if (k === '.' && !narrow()) { e.preventDefault(); toggleFocus(); }
      if (e.code === 'KeyB' && e.altKey && !narrow()) { e.preventDefault(); setChatOpen((v) => !v); }
      // The sidebar stays beside the expanded chat, so ⌘B shows or hides it as always.
      else if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
      if (k === 'j' && dev) { e.preventDefault(); setTerminal((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dev]);

  useEffect(() => {
    const onCommand = (e: Event) => {
      const [kind, arg] = (e as CustomEvent<{ id: string }>).detail.id.split(':');
      // A sidebar view opens beside the expanded chat; only a panel (open) makes the chat give the room back.
      if (kind === 'view') {
        if (arg === 'rules') openSection('system', 'rules');
        else if (isView(arg)) { setView(arg); setSidebar(true); if (narrow()) setTab('more'); }
      }
      else if (kind === 'page') {
        if (arg === 'settings') setSettings(true);
        else if (arg === 'mcp') setMcpOpen(true);
        // A link inside Settings or the MCP dialog that opens a page closes the dialog, so the page shows.
        else { setSettings(false); setMcpOpen(false); open(arg as Center); }
      }
      else if (kind === 'focus') { if (!narrow()) toggleFocus(); }
      else if (kind === 'phone') setPhone((v) => !v);
      else if (kind === 'tab') setTab(arg as Tab);
      // Filling the message box while the chat is hidden shows the chat again.
      else if (kind === 'chat' && arg === 'show') setChatOpen(true);
      // A frame link shows the frame in the Figma tab, so an expanded chat makes room for it.
      else if (kind === 'chat' && arg === 'collapse') setWide(false);
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
  // Every chat shows the same tabs as the Sample tour. A tab with nothing yet shows its own empty state.
  const centers = CENTER.filter((c) => !c.dev || dev);
  const collapsed = centers.length === 0;
  const views = VIEWS.filter((v) => !v.dev || dev);
  const wide = chatWide && chatOpen && !focusMode && !collapsed && !small;
  wideNow.current = wide;
  // Same chat, same reading place: the row that was at the top of the conversation stays there.
  // Long replies re-measure their Show more link after the rewrap, so for half a second every row that changes size
  // sets the place again, unless she scrolls herself.
  useLayoutEffect(() => {
    const at = place.current;
    place.current = null;
    const el = chatScroller();
    if (!at || !el) return;
    keepPlace(at);
    const ro = new ResizeObserver(() => keepPlace(at));
    for (const row of Array.from(el.children)) ro.observe(row);
    const end = () => ro.disconnect();
    const stop = setTimeout(end, 500);
    el.addEventListener('wheel', end, { once: true, passive: true });
    el.addEventListener('touchstart', end, { once: true, passive: true });
    return () => { clearTimeout(stop); end(); el.removeEventListener('wheel', end); el.removeEventListener('touchstart', end); };
  }, [wide]);
  // Esc collapses, unless it belongs to something open (a menu, dialog, the composer's suggestions or a field that
  // cancels its own edit) or to the sidebar, which stays usable beside the chat. Focus goes back to the Expand chat
  // button.
  useEffect(() => {
    if (!wide) return;
    // Popovers close on their own document listeners, which run first, so whether one was open is read in the
    // capture phase, before any of them.
    let popupOpen = false;
    const before = (e: KeyboardEvent) => {
      if (e.key === 'Escape') popupOpen = Boolean(document.querySelector('[aria-modal=true], [aria-haspopup][aria-expanded=true]'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || narrow() || popupOpen) return;
      const at = e.target instanceof Element ? e.target : null;
      if (at && at !== document.body && !at.closest('.main')) return;
      if (at?.closest('[role=dialog], [role=alertdialog], [role=menu], [role=listbox]')) return;
      if (at?.closest('input, select, [contenteditable=true]') || (at?.matches('textarea') && !at.closest('.cp-text'))) return;
      setWide(false);
      wideToggle.current?.focus();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', before, true); window.removeEventListener('keydown', onKey); };
  }, [wide]);
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

  const appActions = (place: 'right' | 'bottom') => <>
    {canNotify && <IconButton label="Notify me" place={place} tip={notifying ? 'Notifications on: Claude tells you when it finishes or needs you' : 'Notify me when Claude finishes or needs me'} aria-pressed={notifying} onClick={toggleNotify}><Icon name={notifying ? 'bell' : 'bell-slash'} /></IconButton>}
    <IconButton label="Open on phone" place={place} className="icon-btn phone-btn" aria-haspopup="dialog" aria-expanded={phone} onClick={() => setPhone((v) => !v)}><Icon name="device-mobile" /></IconButton>
    <IconButton label="Settings" place={place} tip="Settings (⌘,)" aria-keyshortcuts="Meta+Comma" className={`icon-btn ${settings ? 'active' : ''}`} onClick={() => setSettings(true)}><Icon name="settings-gear" /></IconButton>
  </>;

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-focus={focusMode} data-collapsed={collapsed} data-chat={chatOpen || collapsed} data-chat-expanded={wide} style={{ '--chat-w': `${chatW}px`, '--side-w': `${sideW}px` } as React.CSSProperties}>
      <Offline />
      <h1 style={HIDDEN}>Design Studio</h1>
      <header className="topbar mobile-only">
        <span className="brand" aria-hidden><span className="logo" />Design Studio</span>
        <span className="spacer" />
        <span className={`run-state ${session.running ? 'busy' : ''}`}>
          <Icon name={session.running ? 'loading' : 'circle-large-outline'} small spin={session.running} /> <span className="label">{session.running ? runningText(status) : 'Idle'}</span>
        </span>
        <span className="mobile-only top-meta"><ErrorBoundary label="cost"><SpendPill /></ErrorBoundary>{dev ? <McpItem /> : <FigmaItem />}</span>
        {/* On desktop these three sit at the bottom of the side nav; the top bar keeps them on a phone. */}
        <span className="mobile-only top-acts">{appActions('bottom')}</span>
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
          <span className="activity-end">{appActions('right')}</span>
        </nav>

        {/* Desktop: named regions so every part sits in a landmark. Phone: the shown part is the one main. */}
        <section className="sidebar pane side" role={narrow() && tab === 'more' ? 'main' : undefined} aria-label={narrow() ? (tab === 'more' ? 'More' : undefined) : (VIEWS.find((v) => v.id === view) ?? VIEWS[0]).title}>
          {/* On desktop the brand heads the sidebar, so the top bar's row goes to the columns. */}
          <div className="side-brand desktop-only" aria-hidden><span className="logo" />Design Studio</div>
          {!connected && <span className="side-offline error-text desktop-only">Disconnected</span>}
          <div className="sidebar-title">
            {(VIEWS.find((v) => v.id === view) ?? VIEWS[0]).title}
            <span className="spacer" />
            <IconButton label="Hide sidebar" tip="Hide sidebar (⌘B)" aria-keyshortcuts="Meta+B" className="icon-btn side-hide desktop-only" onClick={() => setSidebar(false)}><Icon name="layout-sidebar-left" small /></IconButton>
          </div>
          {tab === 'more' && (
            <div className="side-switch mobile-only">
              {views.map((v) => <button key={v.id} className={view === v.id ? 'active' : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.title}</button>)}
              {/* Settings is the gear in the top bar, so it is not repeated here. */}
            </div>
          )}
          <ErrorBoundary label="sidebar">
            {view === 'chats' ? <Chats /> : view === 'system' ? <DesignSystem /> : <Explorer />}
          </ErrorBoundary>
        </section>
        {/* Drag to widen the sidebar, double-click for the default width. Arrow keys move it by 16px. */}
        <div className="side-sash desktop-only" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={sideW}
          tabIndex={0} title="Drag to resize, double-click to reset" onPointerDown={startSideResize} onDoubleClick={() => setSideW(SIDE_MIN)} onKeyDown={sideKeys} />

        {/* On a phone the chat is hidden behind the Figma or Review tab, so the shown panel is the main landmark. */}
        <section className="editor-group pane code" inert={wide} role={narrow() && isMobileCenter(tab) ? 'main' : undefined} aria-label={!narrow() ? 'Panel area' : isMobileCenter(tab) ? 'Panels' : undefined}>
          <div className="tabs">
            {/* Tabs for screen readers: arrows move between tabs, Enter or Space opens one. */}
            <div role="tablist" aria-label="Panels" style={{ display: 'contents' }} onKeyDown={tabKeys}>
              {centers.map((c) => (
                <button key={c.id} id={`tab-${c.id}`} role="tab" aria-selected={shownCenter === c.id} aria-controls={`panel-${c.id}`} tabIndex={(centers.some((x) => x.id === rove) ? rove : shownCenter) === c.id ? 0 : -1}
                  className={`tab ${shownCenter === c.id ? 'active' : ''}`} onClick={() => { setRove(null); open(c.id); }}>
                  <Icon name={c.icon} small /> {c.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            {/* With no panels the chat is the whole window, so it has nothing to fold into. */}
            {!collapsed && (
              <IconButton label={chatOpen ? 'Hide chat' : 'Show chat'} tip={chatOpen ? 'Hide chat (⌥⌘B)' : 'Show chat (⌥⌘B)'} aria-pressed={chatOpen} aria-keyshortcuts="Alt+Meta+B" className="icon-btn chat-toggle desktop-only" onClick={() => setChatOpen((v) => !v)}>
                <Icon name={chatOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} small />
                {!chatOpen && pendingCount > 0 && <span className="badge waiting"><span aria-hidden="true">{pendingCount}</span><span className="sr-only">{pendingCount === 1 ? ', 1 request waiting' : `, ${pendingCount} requests waiting`}</span></span>}
              </IconButton>
            )}
            <IconButton label="Focus mode" tip={focusMode ? 'Exit focus mode (⌘.)' : 'Focus mode (⌘.)'} aria-pressed={focusMode} aria-keyshortcuts="Meta+Period" className="icon-btn focus-btn desktop-only" onClick={toggleFocus}><Icon name={focusMode ? 'screen-normal' : 'screen-full'} small /></IconButton>
          </div>
          <ErrorBoundary label="panel">
          <div className={`editor browser ${shownCenter === 'figma' ? 'shown' : ''}`} id="panel-figma" role="tabpanel" aria-labelledby="tab-figma">{shownCenter === 'figma' && <BrowserPane />}</div>
          <div className={`editor ${shownCenter === 'review' ? 'shown' : ''}`} id="panel-review" role="tabpanel" aria-labelledby="tab-review">{shownCenter === 'review' && <Review dev={dev} />}</div>
          <div className={`editor ${shownCenter === 'history' ? 'shown' : ''}`} id="panel-history" role="tabpanel" aria-labelledby="tab-history">{shownCenter === 'history' && <History />}</div>
          <div className={`editor ${shownCenter === 'preview' ? 'shown' : ''}`} id="panel-preview" role="tabpanel" aria-labelledby="tab-preview">{shownCenter === 'preview' && <Preview />}</div>
          {dev && <div className={`editor ${shownCenter === 'code' ? 'shown' : ''}`} id="panel-code" role="tabpanel" aria-labelledby="tab-code"><CodePane /></div>}
          </ErrorBoundary>
          {focusMode && (
            <div className="focus-pill desktop-only">
              <Icon name={session.running ? 'loading' : 'circle-large-outline'} small spin={session.running} />
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

        <div className="sash desktop-only" inert={wide} onPointerDown={startResize} />

        <main className="main pane center" aria-label="Chat">
          <ErrorBoundary label="chat">
            <Brief expanded={wide} canExpand={!collapsed} toggleRef={wideToggle} onExpand={() => setWide(!wide)} />
          </ErrorBoundary>
        </main>
      </div>

      <ErrorBoundary label="status bar">
        <StatusBar />
      </ErrorBoundary>

      <nav className="tabbar mobile-only" aria-label="Sections">
        {([['chat', 'comment-discussion', 'Chat'], ['figma', 'browser', 'Figma'], ['review', 'checklist', 'Review'], ['history', 'history', 'History'], ['more', 'ellipsis', 'More']] as const).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); if (id !== 'chat' && id !== 'more') setCenter(id); }}>
            <Icon name={icon} />
            <span>{label}</span>
            {id === 'chat' && pendingCount > 0 && <span className="badge"><span aria-hidden="true">{pendingCount}</span><span className="sr-only">{pendingCount === 1 ? ', 1 request waiting' : `, ${pendingCount} requests waiting`}</span></span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
      <AttachHost />
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
