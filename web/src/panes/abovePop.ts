import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** Gap between a composer menu and the message card it sits above. */
export const POP_GAP = 4;

/**
 * Where a composer menu (mode, model) sits: above the whole message card, 4px clear of it, so it never covers what
 * she typed. `wrap` is the positioned box around the menu's trigger; the menu keeps its left edge on that trigger.
 * The card can grow while the menu is open (dictation, an attached image), so the lift follows its size.
 */
export function usePopAbove(open: boolean, wrap: RefObject<HTMLElement | null>): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const box = wrap.current;
    const card = box?.closest('.cp-card');
    if (!open || !box || !card) { setStyle(undefined); return; }
    const measure = () => {
      const b = box.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const bottom = Math.round(b.bottom - c.top + POP_GAP);
      // A menu taller than the room above the card scrolls instead of running off the top. Only then: a scroll box
      // would clip the focus rings of the items at its edges.
      const room = Math.max(160, Math.floor(c.top - POP_GAP - 8));
      const pop = box.querySelector<HTMLElement>('[role="menu"]');
      setStyle(pop && pop.scrollHeight > room ? { bottom, maxHeight: room, overflowY: 'auto' } : { bottom });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [open, wrap]);
  return style;
}
