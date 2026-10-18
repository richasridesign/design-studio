import { useEffect, useId, useRef, useState } from 'react';
import { getJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { insertPrompt } from './Files';
import { DEFAULT_CAP, DEFAULT_ROUNDS, DEFAULT_WEEKLY_CAP, MAX_ROUNDS, REASON_TEXT, hhmm, isActive, reportQuestions, stallReason, untilFrom, windowPct, withLimit, type Limits, type LongRun, type Report } from '../../../shared/longRun';
import type { PlanLimit } from '../../../shared/protocol';
import { answerPrompt } from '../../../shared/awaiting';
import '../longrun.css';

const TWO_HOURS = 2 * 3600_000;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Both windows, with the latest single event folded in. */
const allLimits = (limits: Limits | null | undefined, limit: PlanLimit | null | undefined) => (limit ? withLimit(limits, limit) : limits ?? {});
const pctOk = (n: number) => Number.isFinite(n) && n >= 1 && n <= 100;

/** Composer control: starts a long run with the message as the task. */
export function LongRunButton({ text, onStart }: { text: string; onStart: (until: number, cap: number) => void }) {
  const run = useStore((s) => s.session.longRun);
  const running = useStore((s) => s.session.running);
  const limit = useStore((s) => s.session.limit);
  const limitsRaw = useStore((s) => s.session.limits);
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [cap, setCap] = useState(String(DEFAULT_CAP));
  const [weekly, setWeekly] = useState(String(DEFAULT_WEEKLY_CAP));
  const [rounds, setRounds] = useState(String(DEFAULT_ROUNDS));
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
  const week = Number(weekly);
  const n = Number(rounds);
  const limits = allLimits(limitsRaw, limit);
  const used5 = windowPct(limits, 'five_hour');
  const usedWeek = windowPct(limits, 'weekly');
  const problem = !text.trim() ? 'Write the task in the message box first.'
    : running ? 'Wait for Claude to finish this turn.'
    : !end ? 'Pick a time.'
    : !pctOk(pct) || !pctOk(week) ? 'Use a number from 1 to 100 for usage.'
    : !Number.isInteger(n) || n < 1 || n > MAX_ROUNDS ? `Use 1 to ${MAX_ROUNDS} rounds.`
    : (used5 ?? 0) >= pct ? `5-hour usage is already at ${Math.round(used5 ?? 0)}%.`
    : (usedWeek ?? 0) >= week ? `Weekly usage is already at ${Math.round(usedWeek ?? 0)}%.`
    : '';
  const start = () => {
    if (problem || !end) return;
    // The composer sends the task with the time and 5-hour cap; the weekly cap and rounds go just before it.
    send({ type: 'long_run_options', weeklyCap: Math.round(week), rounds: n });
    onStart(end, Math.round(pct));
    setOpen(false);
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') start(); };

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
            <span>Stop at 5-hour usage</span>
            <span className="lr-pct"><input id={`${id}-c`} type="number" inputMode="numeric" min={1} max={100} value={cap} onChange={(e) => setCap(e.target.value)} onKeyDown={enter} />%</span>
          </label>
          {used5 !== null && <span className="lr-help">Now: {Math.round(used5)}% used</span>}
          <label className="lr-field" htmlFor={`${id}-w`}>
            <span>Stop at weekly usage</span>
            <span className="lr-pct"><input id={`${id}-w`} type="number" inputMode="numeric" min={1} max={100} value={weekly} onChange={(e) => setWeekly(e.target.value)} onKeyDown={enter} />%</span>
          </label>
          {usedWeek !== null && <span className="lr-help">Now: {Math.round(usedWeek)}% used</span>}
          <label className="lr-field" htmlFor={`${id}-r`}>
            <span>Rounds</span>
            <span className="lr-pct"><input id={`${id}-r`} type="number" inputMode="numeric" min={1} max={MAX_ROUNDS} value={rounds} onChange={(e) => setRounds(e.target.value)} onKeyDown={enter} /><span className="lr-unit" aria-hidden>%</span></span>
          </label>
          <span className="lr-help">Each round: review, fix, check again</span>
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

export function lineText(r: LongRun) {
  const turns = `${r.turns} ${r.turns === 1 ? 'turn' : 'turns'}`;
  const round = r.round ? ` · Round ${r.round} of ${r.rounds ?? r.round}` : '';
  if (r.state === 'running') return `Long run: until ${clock(r.until)}${round} · ${turns}`;
  if (r.state === 'reporting') return `Long run: writing the report · ${turns}`;
  if (r.state === 'done') return `Long run finished · ${turns}`;
  return `Long run stopped: ${REASON_TEXT[r.reason ?? 'user']} · ${turns}`;
}

/** The second line: usage of both windows and whether the Mac is kept awake. */
export function subText(r: LongRun, limits: Limits) {
  const five = windowPct(limits, 'five_hour');
  const week = windowPct(limits, 'weekly');
  const parts: string[] = [];
  if (five !== null || week !== null) {
    const used = [five !== null && `${Math.round(five)}% of 5-hour`, week !== null && `${Math.round(week)}% of weekly`].filter(Boolean).join(', ');
    parts.push(`Usage: ${used}`);
  }
  if (r.awakeUntil) parts.push(`Mac stays awake until ${clock(r.awakeUntil)}`);
  return parts.join(' · ');
}

/** Quiet status line under the chat while a long run is on. */
export function LongRunLine() {
  const run = useStore((s) => s.session.longRun);
  const limit = useStore((s) => s.session.limit);
  const limits = useStore((s) => s.session.limits);
  // An ended run already has its note (and report) in the chat, so the line only shows while it runs.
  if (!run || !isActive(run)) return null;
  const sub = subText(run, allLimits(limits, limit));
  return (
    <div className={`lr-line${sub ? ' two' : ''}`} role="status">
      <span className={`lr-dot ${dotFor(run)}`} aria-hidden />
      <span className="lr-lines">
        <span className="lr-text">{lineText(run)}</span>
        {sub && <span className="lr-sub">{sub}</span>}
      </span>
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
              {answer && <button className="link lr-answer" title="Put this question in the message box with your answer" onClick={() => insertPrompt(answerPrompt(t))}>Answer</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The report Claude writes at the end of a long run. */
export function LongRunReport({ report }: { report: Report }) {
  const fileKey = useStore((s) => s.session.figma?.key);
  // The same rule the server uses, so the line only says what was saved.
  const saved = reportQuestions(report.decide, fileKey).length;
  return (
    <div className="tr-assistant">
      {report.intro && <div className="lr-intro"><Markdown text={report.intro} /></div>}
      <div className="lr-report">
        <div className="lr-report-head"><b>Long run report</b></div>
        <Section title="Needs your decision" items={report.decide} open answer />
        {saved > 0 && <p className="lr-saved">{saved === report.decide.length ? 'These also wait' : `${saved} of these also wait`} in Awaiting your decision on the Review tab.</p>}
        <Section title="Not checked" items={report.unchecked} open />
        <Section title="Fixed" items={report.fixed} open={false} />
      </div>
    </div>
  );
}
