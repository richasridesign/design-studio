import { useEffect, useId, useRef, useState } from 'react';
import { touch } from './touch';
import { Icon } from './Icon';
import { useDialogFocus } from './useDialog';

export type PickItem = {
  value: string;
  label: string;
  detail?: string;
  /** Extra words the filter matches, e.g. the flow a chat belongs to. */
  keywords?: string;
  /** A codicon name, or a state shape: a filled dot for Working, a ring for Frozen. */
  icon?: string;
  mark?: 'working' | 'frozen';
  /** Nesting level, 16px each: a chat under its iteration. */
  indent?: number;
};

/**
 * A filterable list in a small dialog: type to filter, arrows move, Enter picks, Esc closes. Focus stays in it while
 * open and goes back to whatever opened it.
 */
export function QuickPick({ title, items, current, anchor, extra, className, width = 340, onPick, onClose }: {
  title: string;
  extra?: (q: string) => PickItem[];
  anchor?: DOMRect;
  items: PickItem[];
  current?: string | null;
  className?: string;
  /** Width when anchored, kept inside the window. */
  width?: number;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(Math.max(0, items.findIndex((i) => i.value === current)));
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useDialogFocus(true, box, onClose);
  useEffect(() => { if (!touch()) input.current?.focus(); }, []);
  const results = [...items.filter((i) => [i.label, i.detail, i.keywords].join(' ').toLowerCase().includes(q.toLowerCase())), ...(extra?.(q.trim()) ?? [])];
  useEffect(() => { list.current?.children[idx]?.scrollIntoView({ block: 'nearest' }); }, [idx]);
  const opt = (n: number) => `${id}-o${n}`;

  return (
    <div className={`overlay ${anchor ? 'anchored' : ''}`} onClick={onClose}>
      <div
        ref={box}
        className={`switcher${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={anchor && {
          width: Math.min(width, window.innerWidth - 16),
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8)),
          ...(anchor.top > window.innerHeight / 2 ? { bottom: window.innerHeight - anchor.top + 4, maxHeight: anchor.top - 12 } : { top: anchor.bottom + 4, maxHeight: window.innerHeight - anchor.bottom - 12 }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={q}
          placeholder={title}
          aria-label={title}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={results[idx] ? opt(idx) : undefined}
          aria-autocomplete="list"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && results[idx]) { e.preventDefault(); onPick(results[idx].value); }
          }}
        />
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={title}>
          {results.map((i, n) => (
            <li key={i.value} id={opt(n)} role="option" aria-selected={n === idx} className={n === idx ? 'active' : ''}
              style={i.indent ? { paddingLeft: 8 + i.indent * 16 } : undefined} onClick={() => onPick(i.value)} onMouseMove={() => n !== idx && setIdx(n)}>
              {i.mark ? <span className={`state-dot ${i.mark}`} aria-hidden /> : i.icon ? <Icon name={i.icon} small /> : null}
              <span className="label">{i.label}</span>
              {i.detail && <span className="muted small detail">{i.detail}</span>}
              {i.value === current && <span className="tag">current</span>}
            </li>
          ))}
          {results.length === 0 && <li className="muted" role="presentation">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
