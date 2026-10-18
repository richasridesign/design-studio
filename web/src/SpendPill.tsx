import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getJson, useStore } from './store';

type Today = { today: { costUsd: number; tokens: number }; budgetUsd: number };

const PHASES = ['plan', 'sketch', 'design', 'review', 'system', 'chat'];
const money = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Rows({ rows }: { rows: [string, { tokens: number; costUsd: number }][] }) {
  return (
    <>
      {rows.map(([name, p]) => (
        <div key={name} className="spend-row"><span>{name}</span><span className="muted">{tok(p.tokens)} tok</span><span>{money(p.costUsd)}</span></div>
      ))}
    </>
  );
}

export function SpendPill() {
  const spend = useStore((s) => s.session.spend);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Today | null>(null);

  useEffect(() => {
    if (open) getJson<Today>('/api/spend').then(setDay).catch(() => {});
  }, [open, spend.costUsd]);

  useEffect(() => {
    getJson<Today>('/api/spend').then(setDay).catch(() => {});
  }, [spend.costUsd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ratio = day && day.budgetUsd > 0 ? day.today.costUsd / day.budgetUsd : 0;
  const level = ratio > 1 ? 'err' : ratio > 0.8 ? 'warn' : '';
  const phases = PHASES.map((p) => [p, spend.byPhase[p]] as const).filter(([, v]) => v && (v.tokens || v.costUsd)) as [string, { tokens: number; costUsd: number }][];

  return (
    <span className="spend">
      <button className={`spend-pill ${level}`} title="What this chat has cost" onClick={() => setOpen((v) => !v)}>
        <Icon name="credit-card" small /> {spend.costUsd > 0 ? money(spend.costUsd) : `${tok(spend.tokens)} tok`}
      </button>
      {open && (
        <>
          <div className="spend-scrim" onClick={() => setOpen(false)} />
          <div className="spend-pop">
            <div className="spend-head">This chat <span className="muted">{tok(spend.tokens)} tok · {money(spend.costUsd)}</span></div>
            {phases.length ? <Rows rows={phases} /> : <div className="muted small">Nothing spent yet</div>}
            {day && (
              <>
                <div className="spend-head">Today, all chats <span className="muted">{tok(day.today.tokens)} tok · {money(day.today.costUsd)}</span></div>
                {day.budgetUsd > 0 && (
                  <>
                    <div className={`spend-bar ${level}`}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                    <div className="muted small">{money(day.today.costUsd)} of {money(day.budgetUsd)} daily budget</div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </span>
  );
}
