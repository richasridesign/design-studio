import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { IconButton, useTip } from '../Tip';
import { useStore, postJson } from '../store';
import { useDialogFocus } from '../useDialog';
import '../figmaapp.css';

// The Figma tab: her Figma app window, view only. The server captures the frontmost Figma window (only while this tab
// is shown and the page is visible) and sends it here as JPEG frames over /ws?figma-app. A click brings Figma forward.
// In the Design Studio Mac window the tab is figma.com itself instead: the app lays its own Figma view over the stage
// (embedStage tells it where, when and which file), so she can zoom, pan, click and edit without the Figma app.

type CaptureState = 'on' | 'noperm' | 'nofigma' | 'nowindow' | 'error' | 'nohelper' | 'stopped' | 'starting';
/** `offline`: the socket to Design Studio's server is closed and reconnecting. */
type Capture = { state: CaptureState | 'offline'; detail?: string; plain?: boolean };
/** A Design Studio plugin running in a file in the Figma app. `key` is null until the file is matched by its name. */
type Plugin = { key: string | null; name: string; page: string; following: boolean; stalled: boolean; screen: string; embed: boolean };
/** Follow Claude in Figma: whether the setting is on, the files where she paused it, where the plugin runs, and the files Claude edits now. */
type Follow = { on: boolean; paused: string[]; plugins: Plugin[]; editing: string[] };

const SAMPLE = 'sample';
const SWITCH = 'Click to switch to Figma';
const norm = (s: string) => s.trim().toLowerCase();

/** The Mac window's bridge to its Figma view; absent in a plain browser. */
const stageBridge = (): { postMessage: (m: object) => void } | undefined => (window as any).webkit?.messageHandlers?.dsFigmaStage;
const EMBED = !!stageBridge();
/** Web menus and dialogs cannot draw over the native Figma view, so it steps aside while one overlaps the stage. */
const OVERLAYS = '[role="dialog"], [role="menu"], [role="listbox"], [role="alertdialog"]';

export function BrowserPane() {
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const size = useRef<{ w: number; h: number } | null>(null);
  const [capture, setCapture] = useState<Capture>({ state: 'starting' });
  const [hasFrame, setHasFrame] = useState(false);
  const [follow, setFollow] = useState<Follow>({ on: true, paused: [], plugins: [], editing: [] });
  const [manifest, setManifest] = useState('');
  const figma = useStore((s) => s.session.figma);

  const send = (m: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify(m));
    return true;
  };

  useEffect(() => {
    let alive = true;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout>;
    // Frames come only while the pane is in sight: the page is visible, the pane has a size (on a phone the Chat tab
    // hides it, an expanded chat takes its place). Back in Design Studio, Screen Recording is checked again.
    let sent: boolean | null = null;
    const report = () => {
      // In the Mac window figma.com is shown instead, so her Figma app window is never captured.
      const on = !EMBED && inSight();
      if (on !== sent) sent = send({ t: 'visible', on }) ? on : null;
    };
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const s = new WebSocket(`${proto}://${location.host}/ws?figma-app${EMBED ? '&embed' : ''}`);
      ws.current = s;
      s.onopen = () => {
        delay = 1000;
        if (size.current) s.send(JSON.stringify({ t: 'size', ...size.current }));
        sent = null;
        report();
      };
      s.onmessage = (ev) => {
        let m: any;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === 'capture') {
          setCapture({ state: m.state, detail: typeof m.detail === 'string' ? m.detail : undefined, plain: m.plain === true });
          if (m.state !== 'on') setHasFrame(false);
        } else if (m.t === 'frame' && img.current) {
          img.current.src = `data:image/jpeg;base64,${m.data}`;
          setHasFrame(true);
        } else if (m.t === 'follow') {
          setFollow({
            on: m.on !== false,
            paused: Array.isArray(m.paused) ? m.paused : [],
            plugins: Array.isArray(m.plugins) ? m.plugins.filter((p: any) => p && typeof p.name === 'string').map((p: any) => ({ key: typeof p.key === 'string' ? p.key : null, name: p.name, page: typeof p.page === 'string' ? p.page : '', following: p.following === true, stalled: p.stalled === true, screen: typeof p.screen === 'string' ? p.screen : '', embed: p.embed === true })) : [],
            editing: Array.isArray(m.editing) ? m.editing.filter((k: unknown) => typeof k === 'string') : [],
          });
        } else if (m.t === 'plugin' && typeof m.manifest === 'string') setManifest(m.manifest);
      };
      s.onclose = () => {
        if (!alive) return;
        setCapture({ state: 'offline' });
        setHasFrame(false);
        timer = setTimeout(open, delay);
        // The server runs on this Mac and is back a few seconds after a restart: tried every 2 s at most, not 10.
        delay = Math.min(delay * 2, 2000);
      };
    };
    open();
    const el = host.current;
    const onFocus = () => send({ t: 'recheck' });
    document.addEventListener('visibilitychange', report);
    window.addEventListener('focus', onFocus);
    // The pane's size in device pixels: the window is scaled down to fit it, never up.
    const ro = new ResizeObserver(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (r.width && r.height) {
        size.current = { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) };
        send({ t: 'size', ...size.current });
      }
      report();
    });
    if (el) ro.observe(el);
    const covers = el?.closest('.workbench');
    const mo = new MutationObserver(report);
    if (covers) mo.observe(covers, { attributes: true, attributeFilter: ['data-chat-expanded'] });
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('focus', onFocus);
      ro.disconnect();
      mo.disconnect();
      ws.current?.close();
    };
  }, []);

  const inSight = () => {
    const el = host.current;
    if (document.visibilityState !== 'visible' || !el || !el.offsetWidth || !el.offsetHeight) return false;
    return !el.closest('.workbench[data-chat-expanded="true"]');
  };

  const chatFile = figma && figma.key !== SAMPLE ? figma : null;
  const inFile = chatFile ? follow.plugins.filter((p) => p.key === chatFile.key || (!!p.name && norm(p.name) === norm(chatFile.name))) : [];
  // In the Mac window the Figma view is what she sees, so its entry counts over the Figma app's plugin in that file.
  const mine = (EMBED ? inFile.find((p) => p.embed) : undefined) ?? inFile[0];
  const shown = mine ?? (!chatFile && follow.plugins.length === 1 ? follow.plugins[0] : undefined);
  const fileName = shown?.name || chatFile?.name || '';
  const page = shown?.page || '';

  const followKey = chatFile?.key ?? null;
  const toggleFollow = () => {
    if (!followKey) return;
    if (!follow.on) {
      setFollow((f) => ({ ...f, on: true, paused: f.paused.filter((k) => k !== followKey) }));
      postJson('/api/settings', { followClaude: true }).then(() => send({ t: 'follow', key: followKey }), () => {});
      return;
    }
    send({ t: 'follow', key: followKey, pause: !follow.paused.includes(followKey) });
  };

  // The view in this file said hello: it is up, so nothing needs reloading. Offline, the list says nothing.
  const embedUp = !!chatFile && inFile.some((p) => p.embed);
  useEmbedStage(EMBED ? host : null, chatFile?.key ?? null, inSight, capture.state === 'offline' ? null : embedUp);

  const showing = capture.state === 'on' && hasFrame;
  // No plugin runs in this chat's file: said whenever following is on, whatever the capture shows, since nothing
  // else tells her why Figma does not move. Offline, the plugin list is stale, so nothing is claimed.
  const other = chatFile && !mine ? follow.plugins[0] : undefined;
  const strip = EMBED || capture.state === 'offline' || !chatFile || !follow.on ? null : mine ? (mine.stalled ? 'stalled' : null) : other ? 'other' : 'none';

  return (
    <div className="browser-pane">
      <div className="pane-bar browser-bar">
        <span className="fa-where">
          {fileName && <span className="fa-file">{fileName}</span>}
          {fileName && page && <span className="fa-page"> · {page}</span>}
        </span>
        {followKey && <FollowButton on={follow.on} paused={follow.paused.includes(followKey)} ready={!!mine} stalled={!!mine?.stalled} embed={EMBED} onClick={toggleFollow} />}
        {EMBED && (
          <IconButton label="Open in Figma app" place="top" className="icon-btn" onClick={() => send({ t: 'front', key: chatFile?.key })}>
            <Icon name="link-external" small />
          </IconButton>
        )}
      </div>
      {EMBED && chatFile && follow.editing.includes(chatFile.key) && (
        <div className="fa-strip fa-working" role="status">
          <Icon name="loading" small spin />
          <span>Claude is editing: {mine?.screen || chatFile.name}</span>
        </div>
      )}
      {strip === 'none' && <PluginStrip manifest={manifest} />}
      {strip === 'stalled' && chatFile && (
        <div className="fa-strip" role="status">
          <span>The plugin is open but Figma is not answering it. Click into {chatFile.name} in Figma, so it is the front tab.</span>
        </div>
      )}
      {strip === 'other' && chatFile && other && (
        <div className="fa-strip" role="status">
          <span>The plugin runs in {other.name}. To follow Claude here, start it in {chatFile.name}: Plugins &gt; Development &gt; Design Studio.</span>
        </div>
      )}
      <div className="frame-host" ref={host}>
        {EMBED ? (
          <StateBlock text="Opening Figma…" status />
        ) : (
          <>
            <FrameButton hidden={!showing} img={img} onClick={() => send({ t: 'front' })} />
            {!showing && <CaptureState capture={capture} send={send} />}
          </>
        )}
      </div>
    </div>
  );
}

/** A shown file whose view has not said hello for this long is asked to reload (apps that know {t:'reload'}). */
const EMBED_RELOAD_MS = 45_000;
/** Still nothing: the file is opened again by leaving it for a moment, which every app build does. */
const EMBED_REOPEN_MS = 60_000;
/** The app leaves a file for "no file" only after 1.5 s, so "no file" is held a little longer than that. */
const EMBED_LEAVE_MS = 2_500;

/**
 * Tells the Mac window where the stage is (CSS pixels), whether its Figma view shows there, and which file it opens.
 * It shows only while the stage is in sight and no web menu or dialog overlaps it; it hides when the tab goes away.
 * The stage can move without changing size (the sidebar or chat sash), so its place is read every frame.
 * `up`: the view in this file said hello (null while the server cannot say). A file shown that long without one
 * (on 23 Oct a view stayed blank all morning) is reloaded, then opened again, once each per file.
 */
function useEmbedStage(host: React.RefObject<HTMLDivElement | null> | null, fileKey: string | null, inSight: () => boolean, up: boolean | null) {
  const shownAt = useRef(0);
  const waited = useRef(0);
  const ask = useRef<'reload' | null>(null);
  const leaveUntil = useRef(0);
  useEffect(() => {
    waited.current = 0;
    if (!host || !fileKey || up !== false) return;
    let reloaded = false;
    let reopened = false;
    let lastTick = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      // Only time the view is shown counts: a hidden view may be held back.
      if (shownAt.current) waited.current += now - lastTick;
      lastTick = now;
      if (!reloaded && waited.current >= EMBED_RELOAD_MS) {
        reloaded = true;
        ask.current = 'reload';
      } else if (!reopened && waited.current >= EMBED_REOPEN_MS) {
        reopened = true;
        leaveUntil.current = now + EMBED_LEAVE_MS;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [host, fileKey, up]);
  useEffect(() => {
    const bridge = stageBridge();
    const el = host?.current;
    if (!bridge || !el) return;
    let last = '';
    let frame = 0;
    const covered = (r: DOMRect) => [...document.querySelectorAll(OVERLAYS)].some((o) => {
      const b = o.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
    });
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const r = el.getBoundingClientRect();
      const sight = inSight() && r.width > 0 && r.height > 0;
      const over = sight && covered(r);
      const show = sight && !over;
      shownAt.current = show && fileKey ? shownAt.current || Date.now() : 0;
      const leaving = show && Date.now() < leaveUntil.current;
      const t = show && ask.current ? ask.current : 'stage';
      const why = !sight ? 'out of sight' : over ? 'covered' : leaving ? 'no hello, opening the file again' : t === 'reload' ? 'no hello, reload' : '';
      const m = { t, show, why, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), key: leaving ? null : fileKey };
      const sig = JSON.stringify(m);
      if (sig === last) return;
      last = sig;
      if (t === 'reload') ask.current = null;
      try { bridge.postMessage(m); } catch {}
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      try { bridge.postMessage({ t: 'stage', show: false }); } catch {}
    };
  }, [host, fileKey]);
}

/** Her Figma window, view only: a click or Enter brings the Figma app forward. */
function FrameButton({ hidden, img, onClick }: { hidden: boolean; img: React.RefObject<HTMLImageElement | null>; onClick: () => void }) {
  return (
    <button type="button" className="fa-view" hidden={hidden} aria-label={SWITCH} onClick={onClick}>
      <img ref={img} alt="" draggable={false} />
      <span className="fa-hint" aria-hidden="true">{SWITCH}</span>
    </button>
  );
}

/** What stands between her and the Figma window, one at a time, with the one action that fixes it. */
function CaptureState({ capture, send }: { capture: Capture; send: (m: object) => void }) {
  const openFigma = <button type="button" className="primary" onClick={() => send({ t: 'front' })}>Open Figma</button>;
  switch (capture.state) {
    case 'nofigma':
      return <StateBlock text="Figma is not open.">{openFigma}</StateBlock>;
    case 'nowindow':
      return <StateBlock text="Figma has no file open.">{openFigma}</StateBlock>;
    case 'noperm':
      return (
        <StateBlock text="Design Studio needs Screen Recording to show your Figma window." note="Turn on Design Studio, then come back.">
          <button type="button" className="primary" onClick={() => send({ t: 'settings' })}>Open System Settings</button>
        </StateBlock>
      );
    case 'error':
    case 'nohelper': {
      const text = capture.state === 'nohelper' ? 'The helper that shows your Figma window is not set up yet.' : capture.plain && capture.detail ? capture.detail : 'Design Studio could not show your Figma window.';
      return <StateBlock text={text} alert><button type="button" className="primary" onClick={() => send({ t: 'retry' })}>Try again</button></StateBlock>;
    }
    case 'offline':
      return <StateBlock text="Connecting to Design Studio…" status />;
    default:
      return <StateBlock text="Looking for your Figma window…" status />;
  }
}

function StateBlock({ text, note, status, alert, children }: { text: string; note?: string; status?: boolean; alert?: boolean; children?: React.ReactNode }) {
  return (
    <div className="fa-state">
      <p className="fa-state-text" role={status ? 'status' : alert ? 'alert' : undefined}>{text}</p>
      {children}
      {note && <p className="fa-state-note">{note}</p>}
    </div>
  );
}

/** No plugin runs in this chat's file: how to start it, and a one-time setup in a small popover. */
function PluginStrip({ manifest }: { manifest: string }) {
  const [open, setOpen] = useState(false);
  const link = useRef<HTMLButtonElement>(null);
  return (
    <div className="fa-strip">
      <span>To follow Claude, start the Design Studio plugin in Figma: Plugins &gt; Development &gt; Design Studio.</span>
      <button ref={link} type="button" className="link fa-link" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>How to add it</button>
      {open && <SetupPop anchor={link} manifest={manifest} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SetupPop({ anchor, manifest, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; manifest: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pathId = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useDialogFocus(true, box, onClose);

  // Opens 4px under its link, kept inside the window.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const w = box.current?.offsetWidth ?? 360;
      if (a) setPos({ left: Math.max(16, Math.min(a.left, window.innerWidth - w - 16)), top: a.bottom + 4 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  const copy = () => {
    navigator.clipboard.writeText(manifest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  return (
    <>
      <div className="fa-pop-scrim" onClick={onClose} />
      <div ref={box} className="fa-pop" role="dialog" aria-labelledby={titleId} style={pos ?? { left: -9999, top: 0 }}>
        <div className="fa-pop-head">
          <h2 id={titleId}>Add the Design Studio plugin</h2>
          <IconButton label="Close" className="icon-btn" onClick={onClose}><Icon name="close" small /></IconButton>
        </div>
        <p>You do this once in the Figma app.</p>
        <ol>
          <li>In Figma, choose Plugins &gt; Development &gt; Import plugin from manifest.</li>
          <li>
            Pick this file:
            <span className="fa-path">
              <code id={pathId}>{manifest || 'figma-plugin/manifest.json in the Design Studio folder'}</code>
              {manifest && <button type="button" aria-describedby={pathId} onClick={copy}>{copied ? 'Copied' : 'Copy path'}</button>}
            </span>
          </li>
          <li>Start it from Plugins &gt; Development &gt; Design Studio, and keep its window open while you work.</li>
        </ol>
        <span className="sr-only" role="status">{copied ? 'Path copied' : ''}</span>
      </div>
    </>
  );
}

/**
 * Shows whether her Figma follows Claude, by shape and words: a filled dot while following, a hollow one when not.
 * `ready`: the plugin runs in this chat's file, so following can happen; without it the button says it is waiting.
 * `stalled`: it runs, but Figma does not answer it (the file is not the front tab), so the button waits for Figma.
 */
function FollowButton({ on, paused, ready, stalled, embed, onClick }: { on: boolean; paused: boolean; ready: boolean; stalled: boolean; embed: boolean; onClick: () => void }) {
  const active = on && !paused && ready && !stalled;
  // In the Mac window the Figma view covers everything under the bar, so tips open above it.
  // In the Mac window, "not ready" means figma.com has not opened the file for editing yet (still loading, or signed out).
  const label = !on ? 'Follow Claude' : paused ? 'Paused, click to follow' : !ready ? (embed ? 'Waiting for Figma' : 'Waiting for the plugin') : stalled ? 'Waiting for Figma' : 'Following Claude';
  const tip = useTip(!on ? 'Turn on Follow Claude in Figma' : paused ? 'Follow Claude again' : !ready ? (embed ? 'Figma is opening the file. If it asks, log in to Figma below. Click to pause following.' : 'Start the Design Studio plugin in Figma to follow Claude. Click to pause following.') : stalled ? 'Click into the file in Figma so it answers the plugin. Click to pause following.' : 'Pause following Claude', embed ? 'top' : 'bottom');
  return (
    <>
      <button type="button" className={`follow-btn${active ? ' on' : ''}`} aria-pressed={active} onClick={onClick} {...tip.props}>
        <span className="follow-dot" aria-hidden="true" />
        <span className="follow-label">{label}</span>
        <span className="follow-short" aria-hidden="true">{!on ? 'Follow' : paused ? 'Paused' : ready && !stalled ? 'Following' : 'Waiting'}</span>
      </button>
      {tip.tip}
    </>
  );
}
