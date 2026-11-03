import { useEffect, useRef } from 'react';

// A right-click menu at the pointer. It closes on any click outside it, on Escape, or when an item runs.

export type MenuItem = { label: string; keys?: string; run: () => void; danger?: boolean } | 'sep';

export function Menu({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    ref.current?.querySelector('button')?.focus();
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); };
  }, [close]);
  return (
    <div ref={ref} className="cv-menu" role="menu" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === 'sep' ? <hr key={i} /> : (
        <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { close(); it.run(); }}>
          <span>{it.label}</span>{it.keys && <kbd>{it.keys}</kbd>}
        </button>
      ))}
    </div>
  );
}
