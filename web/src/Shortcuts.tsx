import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './shortcuts.css';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'General',
    rows: [
      [['⌘', '⇧', 'P'], 'Command palette (or F1)'],
      [['⌘', 'O'], 'Attach a Figma file'],
      [['⌘', 'B'], 'Toggle sidebar'],
      [['⌘', '.'], 'Toggle focus mode'],
      [['⌘', 'J'], 'Toggle terminal (dev tools)'],
      [['/'], 'Focus the composer'],
      [['?'], 'Show this sheet'],
    ],
  },
  {
    title: 'Tabs',
    rows: ['Figma', 'Sketch', 'Review', 'Preview', 'Settings'].map((t, i): [string[], string] => [['⌘', String(i + 1)], t]),
  },
  {
    title: 'Composer',
    rows: [
      [['Enter'], 'Send'],
      [['⇧', 'Enter'], 'New line'],
      [['↑'], 'Previous message'],
      [['Tab'], 'Accept suggestion'],
      [['Esc'], 'Close suggestions'],
      [['⇧', 'Tab'], 'Switch mode: Chat, Design, Review'],
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

const PAGES = ['figma', 'sketch', 'review', 'preview', 'settings'];
const typing = (el: Element | null) => !!el?.matches('input, textarea, select, [contenteditable="true"]');
const command = (id: string) => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id } }));

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        command(`page:${PAGES[Number(e.key) - 1]}`);
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
  }, [open]);

  if (!open) return null;
  return (
    <div className="overlay settings-overlay sc-overlay" onClick={close}>
      <div ref={dialog} className="settings-dialog sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id="sc-title">Keyboard shortcuts</h2>
          <button className="icon-btn sc-close" title="Close" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="settings-dialog-body sc-grid">
          {GROUPS.map((g) => (
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
