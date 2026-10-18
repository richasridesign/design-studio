import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';
import { getJson, postJson, send, useStore } from './store';
import { CHECKS } from './setupChecks';
import { figmaState } from './StatusBar';
import './research.css';
import './figmalogin.css';

/** A command she types, with a Copy button. */
export function Command({ id, text }: { id: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <span className="fl-cmd">
      <code id={id}>{text}</code>
      <button className="icon-btn" title="Copy" aria-label="Copy" aria-describedby={id} onClick={copy}><Icon name={copied ? 'check' : 'copy'} small /></button>
      <span className="sr-only" role="status">{copied ? 'Copied' : ''}</span>
    </span>
  );
}

type LoginRun = { state: 'idle' | 'waiting' | 'done' | 'failed'; url?: string; error?: string };

/** Runs the plugin's sign-in from the server: Figma opens in the browser and the dialog waits for her to approve. */
function useLoginRun(onDone: () => void) {
  const [run, setRun] = useState<LoginRun>({ state: 'idle' });
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (run.state !== 'waiting') return;
    const t = setInterval(() => {
      getJson<LoginRun>('/api/figma/login').then((r) => {
        setRun(r);
        if (r.state === 'done') done.current();
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [run.state]);
  const start = () => { setRun({ state: 'waiting' }); postJson<LoginRun>('/api/figma/login', {}).then(setRun).catch((e) => setRun({ state: 'failed', error: (e as Error).message })); };
  const cancel = () => { setRun({ state: 'idle' }); getJson<LoginRun>('/api/figma/login', { method: 'DELETE' }).catch(() => {}); };
  return { run, start, cancel };
}

/** Logs in to the official Figma plugin. Design Studio runs the same sign-in as /mcp in the Claude CLI; the terminal steps stay as a fallback. */
export function FigmaLogin({ name, tone, label, onClose, onRetry }: { name: string; tone: string; label: string; onClose: () => void; onRetry: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const connected = tone === 'ok';
  const { run, start, cancel } = useLoginRun(onRetry);
  const waiting = run.state === 'waiting';
  useDialogFocus(true, box, () => { if (waiting) cancel(); onClose(); });
  const settings = () => {
    onClose();
    // Wait for the dialog to hand focus back to its trigger, then open Settings so focus lands there.
    setTimeout(() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } })), 50);
  };
  const close = () => { if (waiting) cancel(); onClose(); };
  return createPortal(
    <div className="overlay settings-overlay rs-overlay" onClick={close}>
      <div ref={box} className="settings-dialog rs-dialog fl-dialog" role="dialog" aria-modal="true" aria-labelledby="fl-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id="fl-title">Log in to Figma</h2>
          <button className="icon-btn rs-close" title="Close" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="settings-dialog-body fl-body">
          <p className="fl-lead">{connected ? 'Claude can edit your Figma files in every chat.' : 'Claude edits your file through the Figma plugin. Log in once and every chat can use it.'}</p>
          {waiting && (
            <p className="fl-wait" role="status">
              Figma opened in your browser. Approve access there, then come back here.{' '}
              {run.url && <a className="link" href={run.url} target="_blank" rel="noreferrer">Open the Figma page again</a>}
            </p>
          )}
          {run.state === 'failed' && <p className="fl-error" role="alert">Login did not finish: {run.error ?? 'Figma did not approve it.'}</p>}
          {!connected && (
            <details className="fl-other">
              <summary>Log in from Terminal instead</summary>
              <ol className="fl-steps">
                <li>On your Mac, open Terminal and run <Command id="fl-c1" text="claude" /></li>
                <li>Type <Command id="fl-c2" text="/mcp" /> and press Return.</li>
                <li>Pick <Command id="fl-c3" text={name} /> and log in in the browser window that opens.</li>
                <li>Come back here and <button className="link" onClick={onRetry}>check again</button>.</li>
              </ol>
            </details>
          )}
          <p className="fl-alt">
            A Figma token in Settings also lets Design Studio read your file and show previews. Claude still needs this login to edit in Figma.{' '}
            <button className="link" onClick={settings}>Open Settings</button>
          </p>
        </div>
        <div className="fl-foot">
          <span className="fl-status" role="status"><span className={`sb-dot ${waiting ? 'wait' : tone}`} aria-hidden="true" /> Figma: {waiting ? 'Waiting for you in the browser' : label}</span>
          {connected
            ? <button className="primary" onClick={onClose}>Done</button>
            : waiting
              ? <button onClick={cancel}>Cancel login</button>
              : <button className="primary" onClick={start}>{run.state === 'failed' ? 'Try again' : 'Log in to Figma'}</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const OPEN = 'designstudio:figma-login';
/** Other places that show the Figma plugin's state listen for this to check it again. */
export const RECHECK = 'designstudio:setup-recheck';
const PLUGIN = 'plugin:figma:figma';

/** Opens the one Log in to Figma dialog. The status bar, the welcome notice and Settings all call it, so a phone has a way in too. */
export const openFigmaLogin = () => window.dispatchEvent(new Event(OPEN));

const PROBED: Record<string, [tone: string, label: string]> = { ok: ['ok', 'Connected'], warn: ['warn', 'Needs login'], bad: ['bad', 'Not connected'] };

/**
 * The dialog, mounted once for the whole app. While Claude runs in the chat, its live Figma status and Reconnect drive it.
 * Before that (a new chat) there is no live status, so it shows the setup check and Try again runs the check again.
 */
export function FigmaLoginHost() {
  const live = useStore((s) => s.session.mcp.find((m) => /figma/i.test(m.name)));
  const [open, setOpen] = useState(false);
  const [probed, setProbed] = useState<[tone: string, label: string]>(PROBED.warn);
  useEffect(() => {
    // Check on open, so a login made elsewhere (Terminal, another app) shows as Connected.
    const show = () => {
      setProbed(['wait', 'Checking']);
      setOpen(true);
      void CHECKS.mcp().then((r) => setProbed(PROBED[r.tone]));
    };
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);
  if (!open) return null;
  const [tone, label] = live ? figmaState([live]) : probed;
  const retry = () => {
    if (live) return send({ type: 'mcp_reconnect', name: live.name });
    setProbed(['wait', 'Checking']);
    void CHECKS.mcp().then((r) => { setProbed(PROBED[r.tone]); window.dispatchEvent(new Event(RECHECK)); });
  };
  const close = () => {
    setOpen(false);
    // The Log in to Figma link is gone once Figma connects, so focus goes to the Figma status:
    // the status bar on a desktop, the MCP status in the top bar on a phone.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const status = [...document.querySelectorAll<HTMLElement>('.statusbar .sb-item, .topbar .mcp-item')].find((el) => el.getClientRects().length);
      status?.focus();
    }));
  };
  return <FigmaLogin name={live?.name ?? PLUGIN} tone={tone} label={label} onClose={close} onRetry={retry} />;
}
