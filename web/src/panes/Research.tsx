import { useEffect, useRef, useState } from 'react';
import { api, getJson } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import '../research.css';

// Pictures Claude saved next to research.md load from the chat folder.
const withImages = (md: string) => md.replace(/!\[([^\]]*)\]\((?![a-z]+:|\/)([^)\s]+)\)/gi, (_, alt, src) => `![${alt}](${api(`/api/chat-file/${src.split('/').map(encodeURIComponent).join('/')}`)})`);

/** Reads research.md from the Research first recipe. Opens from the Spec gate. */
export function Research() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    const el = trigger.current;
    trigger.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  };
  useEffect(() => {
    const show = () => {
      trigger.current = document.activeElement as HTMLElement | null;
      setText(null);
      setOpen(true);
      getJson<{ content: string }>('/api/file?path=research.md').then((f) => setText(f.content)).catch(() => setText(''));
    };
    window.addEventListener('designstudio:research', show);
    return () => window.removeEventListener('designstudio:research', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLElement>('.rs-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key !== 'Tab') return;
      // Keep focus inside the dialog while it is open.
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="overlay settings-overlay rs-overlay" onClick={close}>
      <div ref={dialog} className="settings-dialog rs-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id="rs-title">Research</h2>
          <button className="icon-btn rs-close" title="Close" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="settings-dialog-body rs-body" tabIndex={0} aria-label="Research notes">
          {text === null ? <p className="muted" role="status">Loading research…</p> : text.trim() ? <Markdown text={withImages(text)} /> : <p className="muted">No research yet. Use the Research first recipe from the message box.</p>}
        </div>
      </div>
    </div>
  );
}
