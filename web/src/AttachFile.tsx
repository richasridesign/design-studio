import { useEffect, useRef, useState } from 'react';
import { getJson, send, useStore } from './store';
import { Icon } from './Icon';
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

/** One name for the action everywhere: the top bar, the Stages gate, empty states and the welcome. */
export const ATTACH = 'Attach Figma file';

export function FilePill() {
  const figma = useStore((s) => s.session.figma);
  const live = useStore((s) => s.live);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [tabs, setTabs] = useState<Array<{ title: string; url: string }>>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const valid = Boolean(parseFigmaUrl(url));
  const recent = recentFiles(live, figma?.url);
  const chromeTabs = tabs.filter((t) => parseFigmaUrl(t.url)?.key !== figma?.key);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('designstudio:attach', show);
    return () => window.removeEventListener('designstudio:attach', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    getJson<Array<{ title: string; url: string }>>('/api/chrome/figma-tabs').then(setTabs).catch(() => setTabs([]));
    input.current?.focus();
    const down = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const attach = (link: string) => {
    send({ type: 'set_figma', url: link });
    setOpen(false);
  };

  return (
    <div className="file-wrap" ref={wrap}>
      {/* With no file, a phone shows the icon only, so the button carries the visible name as its accessible name. */}
      <button className={`file-pill${figma ? '' : ' no-file'}`} aria-haspopup="true" aria-expanded={open} aria-label={figma ? undefined : ATTACH} title={figma ? `${figma.url}\nOpen another Figma file (⌘O)` : `${ATTACH} (⌘O)`} onClick={() => setOpen((o) => !o)}>
        <Icon name="file-media" small /> <span className="file-label">{figma?.name ?? ATTACH}</span> <Icon name="chevron-down" small />
      </button>
      {open && (
        <div className="switcher attach-pop" role="dialog" aria-label={ATTACH}>
          <form className="attach-form" onSubmit={(e) => { e.preventDefault(); if (valid) attach(url.trim()); }}>
            <input ref={input} placeholder="Paste a Figma file link" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" className="primary" disabled={!valid}>Attach</button>
          </form>
          {url && !valid && <div className="attach-note error-text">That does not look like a Figma file link.</div>}
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
      )}
    </div>
  );
}
