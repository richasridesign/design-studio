import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './tip.css';

export type Place = 'top' | 'bottom' | 'right';

type Pos = { left: number; top: number; place: Place };

const GAP = 4;
const LEAVE_MS = 120;

function position(el: HTMLElement, tip: HTMLElement, place: Place): Pos {
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let p = place;
  if (p === 'bottom' && r.bottom + GAP + h > vh) p = 'top';
  if (p === 'top' && r.top - GAP - h < 0) p = 'bottom';
  if (p === 'right' && r.right + GAP + w > vw) p = 'bottom';
  let left = p === 'right' ? r.right + GAP : r.left + r.width / 2 - w / 2;
  let top = p === 'right' ? r.top + r.height / 2 - h / 2 : p === 'bottom' ? r.bottom + GAP : r.top - GAP - h;
  left = Math.max(8, Math.min(left, vw - w - 8));
  top = Math.max(8, Math.min(top, vh - h - 8));
  return { left, top, place: p };
}

/**
 * A tooltip that shows on hover and on keyboard focus, stays while the pointer is on it,
 * and hides on Esc (WCAG 1.4.13). Spread `props` on the trigger and render `tip` next to it.
 */
export function useTip(text: string, place: Place = 'bottom') {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const leave = useRef<number>(0);
  const id = useId();

  const show = useCallback(() => { window.clearTimeout(leave.current); setOpen(true); }, []);
  const hide = useCallback(() => { window.clearTimeout(leave.current); leave.current = window.setTimeout(() => setOpen(false), LEAVE_MS); }, []);
  const now = useCallback(() => { window.clearTimeout(leave.current); setOpen(false); }, []);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const el = trigger.current;
    const tip = box.current;
    if (el && tip) setPos(position(el, tip, place));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') now(); };
    const onScroll = () => now();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place, text, now]);

  useEffect(() => () => window.clearTimeout(leave.current), []);

  const props = {
    ref: (el: HTMLElement | null) => { trigger.current = el; },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) show(); },
    onBlur: now,
    onPointerDown: now,
  };

  const tip = open
    ? createPortal(
        <div
          ref={box}
          id={id}
          role="tooltip"
          className={`tip tip-${pos?.place ?? place}`}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {text}
        </div>,
        document.body,
      )
    : null;

  return { props, tip, id, open };
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  /** Accessible name, and the tooltip text unless `tip` is given. */
  label: string;
  /** Tooltip text when it should say more than the name, e.g. with a shortcut. */
  tip?: string;
  place?: Place;
  children: ReactNode;
};

/** Icon-only button: an aria-label plus a tooltip on hover and keyboard focus, never a bare title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tip, place = 'bottom', className, children, onMouseEnter, onMouseLeave, onFocus, onBlur, onPointerDown, ...rest },
  ref,
) {
  const t = useTip(tip ?? label, place);
  return (
    <>
      <button
        {...rest}
        ref={(el) => {
          t.props.ref(el);
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type={rest.type ?? 'button'}
        className={className ?? 'icon-btn'}
        aria-label={label}
        onMouseEnter={(e) => { t.props.onMouseEnter(); onMouseEnter?.(e); }}
        onMouseLeave={(e) => { t.props.onMouseLeave(); onMouseLeave?.(e); }}
        onFocus={(e) => { t.props.onFocus(e); onFocus?.(e); }}
        onBlur={(e) => { t.props.onBlur(); onBlur?.(e); }}
        onPointerDown={(e) => { t.props.onPointerDown(); onPointerDown?.(e); }}
      >
        {children}
      </button>
      {t.tip}
    </>
  );
});
