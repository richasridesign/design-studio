import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog focus: moves focus in when it opens (unless something inside already took it),
 * keeps Tab inside, closes on Escape and gives focus back to whatever opened it.
 */
export function useDialogFocus(open: boolean, box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
    const root = box.current;
    if (root && !root.contains(document.activeElement)) (root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && !!box.current?.contains(at);
      if (!inside || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus());
    };
  }, [open, box]);
}
