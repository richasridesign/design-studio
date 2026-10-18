import { useEffect, useId, useRef, useState } from 'react';
import { getJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { insertPrompt } from './Files';
import { REASON_TEXT, hhmm, isActive, stallReason, untilFrom, usedPct, type LongRun, type Report } from '../../../shared/longRun';
import '../longrun.css';

const TWO_HOURS = 2 * 3600_000;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Composer control: starts a long run with the message as the task. */
export function LongRunButton({ text, onStart }: { text: string; onStart: (until: number, cap: number) => void }) {
  const run = useStore((s) => s.session.longRun);
  const running = useStore((s) => s.session.running);
  const limit = useStore((s) => s.session.limit);
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [cap, setCap] = useState('90');
  const mode = useStore((s) => s.session.permissionMode);
  const [askBeforeEdit, setAskBeforeEdit] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setUntil(hhmm(Date.now() + TWO_HOURS));
    getJson<{ askBeforeEdit?: boolean }>('/api/settings').then((x) => setAskBeforeEdit(Boolean(x.askBeforeEdit)), () => {});
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  if (isActive(run)) return null;
  const end = untilFrom(until, Date.now());
  const pct = Number(cap);
  const capOk = Number.isFinite(pct) && pct >= 1 && pct <= 100;
  const used = Math.round(usedPct(limit));
  const problem = !text.trim() ? 'Write the task in the message box first.' : running ? 'Wait for Claude to finish this turn.' : !end ? 'Pick a time.' : !capOk ? 'Use a number from 1 to 100.' : used >= pct ? `Plan usage is already at ${used}%.` : '';
  const start = () => {
    if (problem || !end) return;
    onStart(end, Math.round(pct));
    setOpen(false);
  };

  return (
    <div className="lr-start" ref={box}>
      <button className="cp-pill lr-btn" aria-haspopup="dialog" aria-expanded={open} title="Long run: Claude keeps working on its own until a time or usage cap" aria-label="Long run" onClick={() => setOpen((o) => !o)}>
        <Icon name="watch" small /><span>Long run</span>
      </button>
      {open && (
        <div className="lr-pop" role="dialog" aria-labelledby={`${id}-t`}>
          <div className="lr-pop-head">
            <b id={`${id}-t`}>Long run</b>
            <button className="icon-btn" title="Close" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" small /></button>
          </div>
          <p className="lr-pop-sub">Claude works on your message alone, then reports what needs your decision.</p>
          <label className="lr-field" htmlFor={`${id}-u`}>
            <span>Run until</span>
            <input id={`${id}-u`} type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
          {end && <span className="lr-help">{new Date(end).toDateString() === new Date().toDateString() ? 'Today' : 'Tomorrow'} at {clock(end)}</span>}
          <label className="lr-field" htmlFor={`${id}-c`}>
            <span>Stop at plan usage</span>
            <span className="lr-pct"><input id={`${id}-c`} type="number" inputMode="numeric" min={1} max={100} value={cap} onChange={(e) => setCap(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />%</span>
          </label>
          <span className="lr-help">Of the 5-hour limit{limit?.kind === 'five_hour' && limit.used !== null ? `. Now ${used}% used.` : '.'}</span>
          {stallReason(mode, askBeforeEdit) && (
            <p className="lr-warn" role="note">
              <span className="lr-warn-mark" aria-hidden />
              <span>{stallReason(mode, askBeforeEdit)}{askBeforeEdit && <> <button className="link" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } })); }}>Open Settings</button></>}</span>
            </p>
          )}
          <div className="lr-pop-foot">
            <button className="primary" disabled={!!problem} onClick={start}>Start long run</button>
            {problem && <span className="lr-help" role="status">{problem}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const dotFor = (r: LongRun) => (r.state === 'reporting' ? 'report' : 'run');

export function lineText(r: LongRun, used: number | null) {
  const turns = `${r.turns} ${r.turns === 1 ? 'turn' : 'turns'}`;
  const pct = used === null ? '' : ` · ${Math.round(used)}% used`;
  if (r.state === 'running') return `Long run: until ${clock(r.until)}${pct} · ${turns}`;
  if (r.state === 'reporting') return `Long run: writing the report${pct} · ${turns}`;
  if (r.state === 'done') return `Long run finished · ${turns}`;
  return `Long run stopped: ${REASON_TEXT[r.reason ?? 'user']} · ${turns}`;
}

/** Quiet status line under the chat while a long run is on. */
export function LongRunLine() {
  const run = useStore((s) => s.session.longRun);
  const limit = useStore((s) => s.session.limit);
  // An ended run already has its note (and report) in the chat, so the line only shows while it runs.
  if (!run || !isActive(run)) return null;
  const used = limit?.kind === 'five_hour' && limit.used !== null ? limit.used * 100 : null;
  return (
    <div className="lr-line" role="status">
      <span className={`lr-dot ${dotFor(run)}`} aria-hidden />
      <span className="lr-text">{lineText(run, used)}</span>
      <button className="link" title="Stop the long run and the current turn" onClick={() => send({ type: 'long_run_stop' })}>End long run</button>
    </div>
  );
}

function Section({ title, items, open: start, answer }: { title: string; items: string[]; open: boolean; answer?: boolean }) {
  const [open, setOpen] = useState(start && items.length > 0);
  const id = useId();
  return (
    <section className={`lr-sec ${open ? 'open' : ''}`}>
      <button className="lr-sec-head" aria-expanded={open} aria-controls={id} disabled={!items.length} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span>{title}</span>
        <span className="lr-count">{items.length}</span>
      </button>
      {open && (
        <ul id={id}>
          {items.map((t, i) => (
            <li key={i}>
              <Markdown text={t} />
              {answer && <button className="link lr-answer" title="Put this question in the message box with your answer" onClick={() => insertPrompt(`About "${t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ')}": `)}>Answer</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The report Claude writes at the end of a long run. */
export function LongRunReport({ report }: { report: Report }) {
  return (
    <div className="tr-assistant">
      {report.intro && <div className="lr-intro"><Markdown text={report.intro} /></div>}
      <div className="lr-report">
        <div className="lr-report-head"><b>Long run report</b></div>
        <Section title="Needs your decision" items={report.decide} open answer />
        <Section title="Not checked" items={report.unchecked} open />
        <Section title="Fixed" items={report.fixed} open={false} />
      </div>
    </div>
  );
}
