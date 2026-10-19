import { useEffect, useRef, useState } from 'react';
import { getJson, send, useStore } from './store';
import { Icon } from './Icon';
import { IconButton } from './Tip';
import { useDialogFocus } from './useDialog';
import { parseFigmaUrl } from '../../shared/design';
import type { LiveChat } from '../../shared/protocol';
import './attach.css';

export function recentFiles(live: LiveChat[], currentUrl?: string, max = 5) {
  const seen = new Set<string>(currentUrl ? [currentUrl] : []);
  const out: Array<{ url: string; name: string }> = [];
  for (const c of [...live].sort((a, b) => b.lastActive - a.lastActive)) {
    if (!c.fileUrl || seen.has(c.fileUrl)) continue;
    seen.add(c.fileUrl);
    out.push({ url: c.fileUrl, name: c.file ?? c.fileUrl });
  }
  return out.slice(0, max);
}

/** One name for the action everywhere: the sidebar, the Stages gate, empty states and the welcome. */
export const ATTACH = 'Add project';

const EVENT = 'designstudio:attach';
type Anchor = { top: number; left: number };

/** Opens the Add project popover, under `from` when given (the sidebar button), else under the top bar. */
export function openAttach(from?: Element | null) {
  const r = from?.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent<Anchor | undefined>(EVENT, { detail: r ? { top: r.bottom + 4, left: r.left } : undefined }));
}

const WIDTH = 360;
const GUTTER = 8;
/** Keeps the popover on screen: a phone is narrower than 360 plus the gutters. */
const place = (a: Anchor | undefined): React.CSSProperties => {
  const top = a?.top ?? (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 44) + 4;
  const left = Math.max(GUTTER, Math.min(a?.left ?? 16, window.innerWidth - Math.min(WIDTH, window.innerWidth - 2 * GUTTER) - GUTTER));
  return { top, left };
};

/** The Add project popover. Mounted once in App with no button of its own: ⌘O, the sidebar and the empty states open it. */
export function AttachHost() {
  const figma = useStore((s) => s.session.figma);
  const live = useStore((s) => s.live);
  const [anchor, setAnchor] = useState<Anchor | undefined | null>(null);
  const [url, setUrl] = useState('');
  const [tabs, setTabs] = useState<Array<{ title: string; url: string }>>([]);
  const box = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  const trimmed = url.trim();
  const valid = Boolean(parseFigmaUrl(trimmed));
  const invalid = trimmed !== '' && !valid;
  const recent = recentFiles(live, figma?.url);
  const chromeTabs = tabs.filter((t) => parseFigmaUrl(t.url)?.key !== figma?.key);
  const close = () => setAnchor(null);
  useDialogFocus(open, box, close);

  useEffect(() => {
    const show = (e: Event) => setAnchor((e as CustomEvent<Anchor | undefined>).detail);
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    getJson<Array<{ title: string; url: string }>>('/api/chrome/figma-tabs').then(setTabs).catch(() => setTabs([]));
    // A click outside closes it, like the menus. Focus goes back to whatever opened it.
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setAnchor(null);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  if (!open) return null;

  const attach = (link: string) => {
    send({ type: 'set_figma', url: link });
    close();
  };

  return (
    <div ref={box} className="switcher attach-pop" role="dialog" aria-modal="false" aria-labelledby="attach-title" style={place(anchor)}>
      <div className="attach-head">
        <h2 id="attach-title">{ATTACH}</h2>
        <IconButton label="Close" tip="Close (Esc)" className="icon-btn" onClick={close}><Icon name="close" small /></IconButton>
      </div>
      {figma && (
        <div className="attach-current">
          <span className="attach-current-name"><b>Open now:</b> {figma.name}</span>
          <a className="link" href={figma.url} target="_blank" rel="noreferrer">Open in Figma</a>
        </div>
      )}
      <form className="attach-form" onSubmit={(e) => { e.preventDefault(); if (valid) attach(trimmed); }}>
        <label htmlFor="attach-url">Figma file link</label>
        <div className="attach-row">
          <input id="attach-url" data-autofocus placeholder="https://www.figma.com/design/…" aria-invalid={invalid || undefined} aria-describedby={invalid ? 'attach-error' : figma ? 'attach-other' : undefined}
            value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="primary" disabled={!valid}>{figma ? 'Open' : 'Add'}</button>
        </div>
        {invalid
          ? <div className="attach-note error-text" id="attach-error"><Icon name="error" small /> That is not a Figma file link. It starts with figma.com/design/.</div>
          : figma && <div className="attach-note" id="attach-other">A chat keeps one file, so another link opens in its own chat.</div>}
      </form>
      {chromeTabs.length > 0 && (
        <>
          <div className="attach-label">Open in Chrome</div>
          <ul>
            {chromeTabs.map((t) => (
              <li key={t.url}><button type="button" title={t.url} onClick={() => attach(t.url)}><Icon name="browser" small /><span className="attach-name">{t.title}</span></button></li>
            ))}
          </ul>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="attach-label">Recent files</div>
          <ul>
            {recent.map((f) => (
              <li key={f.url}><button type="button" title={f.url} onClick={() => attach(f.url)}><Icon name="file-media" small /><span className="attach-name">{f.name}</span></button></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
