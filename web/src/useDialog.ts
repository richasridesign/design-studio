import { useEffect, useRef, type RefObject } from 'react';

// Open dialogs, newest last. Only the top one handles Esc and Tab, so a dialog opened over Settings closes alone.
const stack: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog focus: moves focus in when it opens (unless something inside already took it),
 * keeps Tab inside, closes on Escape and gives focus back to whatever opened it.
 */
export function useDialogFocus(open: boolean, box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  // What opened it, read while rendering: a child with autoFocus takes focus at commit, before any effect runs.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    const trigger = opener.current?.isConnected && !box.current?.contains(opener.current) ? opener.current : (document.activeElement as HTMLElement | null);
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
    const root = box.current;
    if (root && !root.contains(document.activeElement)) (root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
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
      stack.splice(stack.indexOf(me), 1);
      // Not when a dialog opened over it has taken focus (Change connection over the portfolio page).
      if (trigger?.isConnected) requestAnimationFrame(() => {
        const at = document.activeElement;
        if (at && at !== document.body && !root?.contains(at) && at.closest('[role="dialog"], [role="alertdialog"]')) return;
        trigger.focus();
      });
    };
  }, [open, box]);
}
