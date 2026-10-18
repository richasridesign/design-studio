import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import { getJson, useStore } from './store';
import { useDialogFocus } from './useDialog';
import { useDevTools } from './devTools';
import { IconButton } from './Tip';

export type Today = { today: { costUsd: number; tokens: number }; budgetUsd: number };

const PHASES = ['plan', 'sketch', 'design', 'review', 'system', 'chat'];
const money = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reads /api/spend. Anything that is not the expected shape gives null, so a bad reply never breaks the page. */
export function parseSpend(d: unknown): Today | null {
  const o = d as { today?: { costUsd?: unknown; tokens?: unknown }; budgetUsd?: unknown } | null;
  const cost = num(o?.today?.costUsd);
  if (cost === null) return null;
  return { today: { costUsd: cost, tokens: num(o?.today?.tokens) ?? 0 }, budgetUsd: num(o?.budgetUsd) ?? 0 };
}

function SpendPop({ day, dev, onClose }: { day: Today | null; dev: boolean; onClose: () => void }) {
  const spend = useStore((s) => s.session.spend);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, box, onClose);
  const ratio = day && day.budgetUsd > 0 ? day.today.costUsd / day.budgetUsd : 0;
  const level = ratio > 1 ? 'err' : ratio > 0.8 ? 'warn' : '';
  const phases = PHASES.map((p) => [p, spend.byPhase[p]] as const).filter(([, v]) => v && (v.tokens || v.costUsd)) as [string, { tokens: number; costUsd: number }][];
  return (
    <>
      <div className="spend-scrim" onClick={onClose} />
      <div ref={box} className="spend-pop" role="dialog" aria-labelledby={titleId}>
        <div className="spend-title">
          <h2 id={titleId}>Cost</h2>
          <IconButton label="Close" className="icon-btn" onClick={onClose}><Icon name="close" small /></IconButton>
        </div>
        <div className="spend-head">This chat <span>{money(spend.costUsd)}</span></div>
        {phases.length ? (
          phases.map(([name, p]) => <div key={name} className="spend-row"><span>{cap(name)}</span><span>{money(p.costUsd)}</span></div>)
        ) : (
          <div className="muted small">Nothing spent yet</div>
        )}
        {day && (
          <>
            <div className="spend-head">Today, all chats <span>{money(day.today.costUsd)}</span></div>
            {day.budgetUsd > 0 && (
              <>
                <div className={`spend-bar ${level}`} aria-hidden="true"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                <div className="muted small">Daily budget: {money(day.today.costUsd)} of {money(day.budgetUsd)}</div>
              </>
            )}
          </>
        )}
        {dev && (
          <>
            <h3 className="spend-head">Details</h3>
            <div className="spend-row"><span>Tokens, this chat</span><span>{tok(spend.tokens)}</span></div>
            {phases.map(([name, p]) => <div key={name} className="spend-row muted"><span>{cap(name)}</span><span>{tok(p.tokens)}</span></div>)}
            {day && <div className="spend-row"><span>Tokens, today</span><span>{tok(day.today.tokens)}</span></div>}
          </>
        )}
      </div>
    </>
  );
}

export function SpendPill() {
  const spend = useStore((s) => s.session.spend);
  const dev = useDevTools();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Today | null>(null);

  useEffect(() => {
    getJson<unknown>('/api/spend').then((d) => setDay(parseSpend(d))).catch(() => {});
  }, [open, spend.costUsd]);

  const ratio = day && day.budgetUsd > 0 ? day.today.costUsd / day.budgetUsd : 0;
  const level = ratio > 1 ? 'err' : ratio > 0.8 ? 'warn' : '';

  return (
    <span className="spend">
      <button className={`spend-pill ${level}`} aria-label={`Cost: ${money(spend.costUsd)}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="credit-card" small /> {money(spend.costUsd)}
      </button>
      {open && <SpendPop day={day} dev={dev} onClose={() => setOpen(false)} />}
    </span>
  );
}
