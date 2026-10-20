import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { IconButton, useTip } from '../Tip';
import { useStore, postJson } from '../store';
import { useDialogFocus } from '../useDialog';
import '../figmaapp.css';

// The Figma tab: her Figma app window, view only. The server captures the frontmost Figma window (only while this tab
// is shown and the page is visible) and sends it here as JPEG frames over /ws?figma-app. A click brings Figma forward.

type CaptureState = 'on' | 'noperm' | 'nofigma' | 'nowindow' | 'error' | 'nohelper' | 'stopped' | 'starting';
/** `offline`: the socket to Design Studio's server is closed and reconnecting. */
type Capture = { state: CaptureState | 'offline'; detail?: string; plain?: boolean };
/** A Design Studio plugin running in a file in the Figma app. `key` is null until the file is matched by its name. */
type Plugin = { key: string | null; name: string; page: string; following: boolean };
/** Follow Claude in Figma: whether the setting is on, the files where she paused it, and where the plugin runs. */
type Follow = { on: boolean; paused: string[]; plugins: Plugin[] };

const SAMPLE = 'sample';
const SWITCH = 'Click to switch to Figma';
const norm = (s: string) => s.trim().toLowerCase();

export function BrowserPane() {
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const size = useRef<{ w: number; h: number } | null>(null);
  const [capture, setCapture] = useState<Capture>({ state: 'starting' });
  const [hasFrame, setHasFrame] = useState(false);
  const [follow, setFollow] = useState<Follow>({ on: true, paused: [], plugins: [] });
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
      const on = inSight();
      if (on !== sent) sent = send({ t: 'visible', on }) ? on : null;
    };
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const s = new WebSocket(`${proto}://${location.host}/ws?figma-app`);
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
            plugins: Array.isArray(m.plugins) ? m.plugins.filter((p: any) => p && typeof p.name === 'string').map((p: any) => ({ key: typeof p.key === 'string' ? p.key : null, name: p.name, page: typeof p.page === 'string' ? p.page : '', following: p.following === true })) : [],
          });
        } else if (m.t === 'plugin' && typeof m.manifest === 'string') setManifest(m.manifest);
      };
      s.onclose = () => {
        if (!alive) return;
        setCapture({ state: 'offline' });
        setHasFrame(false);
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 10000);
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
  const mine = chatFile ? follow.plugins.find((p) => p.key === chatFile.key || (!!p.name && norm(p.name) === norm(chatFile.name))) : undefined;
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

  const showing = capture.state === 'on' && hasFrame;
  const strip = !showing || !chatFile || mine ? null : follow.plugins.length ? 'other' : 'none';

  return (
    <div className="browser-pane">
      <div className="pane-bar browser-bar">
        <span className="fa-where">
          {fileName && <span className="fa-file">{fileName}</span>}
          {fileName && page && <span className="fa-page"> · {page}</span>}
        </span>
        {followKey && <FollowButton on={follow.on} paused={follow.paused.includes(followKey)} onClick={toggleFollow} />}
      </div>
      {strip === 'none' && <PluginStrip manifest={manifest} />}
      {strip === 'other' && chatFile && (
        <div className="fa-strip" role="status">
          <span>Figma shows a different file than this chat. Open {chatFile.name} to follow.</span>
        </div>
      )}
      <div className="frame-host" ref={host}>
        <FrameButton hidden={!showing} img={img} onClick={() => send({ t: 'front' })} />
        {!showing && <CaptureState capture={capture} send={send} />}
      </div>
    </div>
  );
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

/** Shows whether her Figma follows Claude, by shape and words: a filled dot while following, a hollow one when not. */
function FollowButton({ on, paused, onClick }: { on: boolean; paused: boolean; onClick: () => void }) {
  const active = on && !paused;
  const label = !on ? 'Follow Claude' : paused ? 'Paused, click to follow' : 'Following Claude';
  const tip = useTip(!on ? 'Turn on Follow Claude in Figma' : paused ? 'Follow Claude again' : 'Pause following Claude');
  return (
    <>
      <button type="button" className={`follow-btn${active ? ' on' : ''}`} aria-pressed={active} onClick={onClick} {...tip.props}>
        <span className="follow-dot" aria-hidden="true" />
        <span className="follow-label">{label}</span>
        <span className="follow-short" aria-hidden="true">{!on ? 'Follow' : paused ? 'Paused' : 'Following'}</span>
      </button>
      {tip.tip}
    </>
  );
}
