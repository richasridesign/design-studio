import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';
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
