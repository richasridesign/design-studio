import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';
import { send, useStore } from './store';
import { CHECKS } from './setupChecks';
import { figmaState } from './StatusBar';
import './research.css';
import './figmalogin.css';

function Command({ id, text }: { id: string; text: string }) {
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

/** Steps to log in to the official Figma plugin, which only works from the terminal. */
export function FigmaLogin({ name, tone, label, onClose, onRetry }: { name: string; tone: string; label: string; onClose: () => void; onRetry: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const done = tone === 'ok';
  useDialogFocus(true, box, onClose);
  const settings = () => {
    onClose();
    // Wait for the dialog to hand focus back to its trigger, then open Settings so focus lands there.
    setTimeout(() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } })), 50);
  };
  return createPortal(
    <div className="overlay settings-overlay rs-overlay" onClick={onClose}>
      <div ref={box} className="settings-dialog rs-dialog fl-dialog" role="dialog" aria-modal="true" aria-labelledby="fl-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id="fl-title">Log in to Figma</h2>
          <button className="icon-btn rs-close" title="Close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="settings-dialog-body fl-body">
          <p className="fl-lead">Claude edits your file through the Figma plugin. You log in to it once, from the terminal.</p>
          <ol className="fl-steps">
            <li>Open Terminal and run <Command id="fl-c1" text="claude" /></li>
            <li>Type <Command id="fl-c2" text="/mcp" /> and press Return.</li>
            <li>Pick <Command id="fl-c3" text={name} /> and log in in the browser window that opens.</li>
            <li>Come back here and press Try again.</li>
          </ol>
          <p className="fl-alt">
            A Figma token in Settings also lets Design Studio read your file and show previews. Claude still needs this login to edit in Figma.{' '}
            <button className="link" onClick={settings}>Open Settings</button>
          </p>
        </div>
        <div className="fl-foot">
          <span className="fl-status" role="status"><span className={`sb-dot ${tone}`} aria-hidden="true" /> Figma: {label}</span>
          {done
            ? <button className="primary" onClick={onClose}>Done</button>
            : <button className="primary" onClick={onRetry}>Try again</button>}
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
    const show = () => { setProbed(PROBED.warn); setOpen(true); };
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
    // The How to log in link is gone once Figma connects, so focus goes to the Figma status:
    // the status bar on a desktop, the MCP status in the top bar on a phone.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const status = [...document.querySelectorAll<HTMLElement>('.statusbar .sb-item, .topbar .mcp-item')].find((el) => el.getClientRects().length);
      status?.focus();
    }));
  };
  return <FigmaLogin name={live?.name ?? PLUGIN} tone={tone} label={label} onClose={close} onRetry={retry} />;
}
