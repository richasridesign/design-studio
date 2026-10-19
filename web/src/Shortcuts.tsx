import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { IconButton } from './Tip';
import { useDevTools } from './devTools';
import './shortcuts.css';

type Page = { key: string; page: string; label: string; dev?: boolean };

/** One list for the key handler and the sheet, so the sheet always says what the keys do. */
export const PAGES: Page[] = [
  { key: '1', page: 'figma', label: 'Figma' },
  { key: '2', page: 'review', label: 'Review' },
  { key: '3', page: 'history', label: 'History' },
  { key: '4', page: 'preview', label: 'Preview', dev: true },
  { key: ',', page: 'settings', label: 'Settings' },
];

export const pagesFor = (dev: boolean) => PAGES.filter((p) => !p.dev || dev);

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'General',
    rows: [
      [['⌘', '⇧', 'P'], 'Command palette (or F1)'],
      [['⌘', 'O'], 'Add project'],
      [['⌘', 'K'], 'Switch flow or chat'],
      [['⌘', 'B'], 'Toggle sidebar'],
      [['⌘', '.'], 'Toggle focus mode'],
      [['⌘', 'J'], 'Toggle terminal (dev tools)'],
      [['/'], 'Focus the composer'],
      [['?'], 'Show this sheet'],
    ],
  },
  {
    title: 'Composer',
    rows: [
      [['Enter'], 'Send'],
      [['⇧', 'Enter'], 'New line'],
      [['↑'], 'Previous message'],
      [['Tab'], 'Accept suggestion'],
      [['Esc'], 'Close suggestions'],
      [['⌥', 'M'], 'Switch mode: Chat, Design, Review'],
      [['/'], 'Commands and recipes, e.g. /copy tone:formal'],
      [['@'], 'Files in the chat folder'],
      [['#'], 'Frames in the attached file'],
    ],
  },
  {
    title: 'Permission cards',
    rows: [
      [['y'], 'Allow'],
      [['a'], 'Always allow'],
      [['n'], 'Deny'],
    ],
  },
];

const typing = (el: Element | null) => !!el?.matches('input, textarea, select, [contenteditable="true"]');
const command = (id: string) => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id } }));

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const dev = useDevTools();
  const pages = pagesFor(dev);
  const groups = [GROUPS[0], { title: 'Tabs', rows: pages.map((p): [string[], string] => [['⌘', p.key], p.label]) }, ...GROUPS.slice(1)];
  const show = () => { trigger.current = document.activeElement as HTMLElement | null; setOpen(true); };
  const close = () => {
    setOpen(false);
    const el = trigger.current;
    trigger.current = null;
    if (el?.isConnected && el !== document.body) requestAnimationFrame(() => el.focus());
  };

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>('.sc-close')?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (open) close(); return; }
      if (open && e.key === 'Tab') {
        // Keep focus inside the sheet while it is open.
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
        return;
      }
      const page = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey ? pages.find((p) => p.key === e.key) : undefined;
      if (page) {
        e.preventDefault();
        command(`page:${page.page}`);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(document.activeElement)) return;
      if (e.key === '?') { e.preventDefault(); if (open) close(); else show(); }
      else if (e.key === '/' && !open) {
        const ta = document.querySelector<HTMLTextAreaElement>('.cp-card textarea');
        if (ta) { e.preventDefault(); ta.focus(); }
      }
    };
    const onCommand = (e: Event) => { if ((e as CustomEvent<{ id: string }>).detail.id === 'shortcuts' && !open) show(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('designstudio:command', onCommand);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('designstudio:command', onCommand);
    };
  }, [open, dev]);

  if (!open) return null;
  return (
    <div className="overlay settings-overlay sc-overlay" onClick={close}>
      <div ref={dialog} className="settings-dialog sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id="sc-title">Keyboard shortcuts</h2>
          <IconButton label="Close" className="icon-btn sc-close" onClick={close}><Icon name="close" /></IconButton>
        </div>
        <div className="settings-dialog-body sc-grid">
          {groups.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, label]) => (
                  <div key={label}>
                    <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
