import { forwardRef, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton, useTip } from './Tip';
import './fold.css';

// Cards in the chat that fold to one line: the workflow card above the conversation and older review cards in it.
// Open, the card's head has a chevron (Collapse). Folded, the whole line is one button that opens it (Expand).
// The two are different elements, so focus follows the toggle to whichever is shown.

export function useFold(open: boolean, setOpen: (v: boolean) => void) {
  const id = useId();
  const control = useRef<HTMLButtonElement | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) control.current?.focus();
    moved.current = false;
  }, [open]);
  const toggle = () => { moved.current = true; setOpen(!open); };
  return { bodyId: `fold-${id}`, control, toggle };
}

/** The chevron in an open card's head. */
export const FoldButton = forwardRef<HTMLButtonElement, { controls: string; describedBy?: string; onClick: () => void; className?: string }>(function FoldButton({ controls, describedBy, onClick, className }, ref) {
  return (
    <IconButton ref={ref} label="Collapse" place="top" aria-expanded aria-controls={controls} aria-describedby={describedBy} className={`icon-btn fold-btn${className ? ` ${className}` : ''}`} onClick={onClick}>
      <Icon name="chevron-up" small />
    </IconButton>
  );
});

/** A folded card: one line, clickable as a whole, with the chevron at its end. */
export const FoldLine = forwardRef<HTMLButtonElement, { controls: string; onClick: () => void; className?: string; children: ReactNode }>(function FoldLine({ controls, onClick, className, children }, ref) {
  const t = useTip('Expand', 'top');
  return (
    <>
      <button
        ref={(el) => {
          t.props.ref(el);
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="button"
        className={`fold-line${className ? ` ${className}` : ''}`}
        aria-expanded={false}
        aria-controls={controls}
        onMouseEnter={t.props.onMouseEnter}
        onMouseLeave={t.props.onMouseLeave}
        onFocus={t.props.onFocus}
        onBlur={t.props.onBlur}
        onPointerDown={t.props.onPointerDown}
        onClick={onClick}
      >
        <span className="fold-text">{children}</span>
        <span className="fold-mark" aria-hidden="true"><Icon name="chevron-down" small /></span>
      </button>
      {t.tip}
    </>
  );
});
