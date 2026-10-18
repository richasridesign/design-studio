import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import type { PendingPermission, PendingQuestion } from '../../../shared/protocol';
import '../pending.css';

export function Pending() {
  const pending = useStore((s) => s.pending);
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  if (!pending.length) return null;
  return (
    <div className="pd-list">
      {pending.map((p, n) => {
        const first = n === 0;
        if (p.kind === 'question') return <QuestionCard key={p.id} q={p} first={first} />;
        if (p.toolName === 'ExitPlanMode') return <PlanCard key={p.id} p={p} mode={mode} first={first} />;
        return <PermissionCard key={p.id} p={p} mode={mode} first={first} />;
      })}
    </div>
  );
}

function useKeys(ref: RefObject<HTMLElement | null>, first: boolean, onKey: (key: string) => boolean | void) {
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || document.querySelector('.overlay')) return;
      const el = document.activeElement;
      if (el?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (!first && !(el && ref.current?.contains(el))) return;
      if (cb.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [first, ref]);
}

const MODE_HINTS: Record<string, string> = {
  auto: 'Auto mode asks only for risky actions',
  default: 'Default mode asks before edits and commands',
  acceptEdits: 'Accept edits mode asks before commands, not file edits',
  plan: 'Plan mode asks before it starts building',
};

const ICONS: Record<string, string> = {
  Bash: 'terminal', Edit: 'edit', MultiEdit: 'edit', Write: 'new-file', WebFetch: 'globe', WebSearch: 'search', Agent: 'sparkle', Task: 'sparkle',
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

type CardProps = { p: PendingPermission; mode: string; first: boolean };

export function PermissionCard({ p, mode, first }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const Body = BODIES[p.toolName] ?? RowsBody;
  return (
    <div ref={ref} className="pd" tabIndex={-1} role="group" aria-label={p.title}>
      <div className="pd-head">
        <Icon name={ICONS[p.toolName] ?? 'tools'} />
        <span className="pd-title" title={p.title}>{p.title}</span>
      </div>
      <Body tool={p.toolName} input={p.input} title={p.title} />
      {p.detail && <div className="pd-desc">{p.detail}</div>}
      <Decision p={p} mode={mode} first={first} cardRef={ref} yes="Allow" no="Deny" />
    </div>
  );
}

export function PlanCard({ p, mode, first }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const plan = str(p.input.plan);
  return (
    <div ref={ref} className="pd" tabIndex={-1} role="group" aria-label={p.title}>
      <div className="pd-head">
        <Icon name="checklist" />
        <span className="pd-title" title={p.title}>{p.title}</span>
      </div>
      {plan && <div className="pd-plan"><Markdown text={plan} /></div>}
      {p.detail && <div className="pd-desc">{p.detail}</div>}
      <Decision p={p} mode={mode} first={first} cardRef={ref} yes="Approve" no="Keep planning" />
    </div>
  );
}

function Decision({ p, mode, first, cardRef, yes, no }: CardProps & { cardRef: RefObject<HTMLDivElement | null>; yes: string; no: string }) {
  const always = p.canAlwaysAllow && p.toolName !== 'ExitPlanMode';
  const keys = !p.confirmFirst;
  const reply = (allow: boolean, all?: boolean) => send({ type: 'permission', id: p.id, allow, always: all });
  useKeys(cardRef, first, (k) => {
    if (k === 'n') reply(false);
    else if (k === 'y' && keys) reply(true);
    else if (k === 'a' && keys && always) reply(true, true);
    else return false;
    return true;
  });
  return (
    <>
      <div className="pd-actions">
        <button className="pd-btn primary" onClick={() => reply(true)}>{yes}{keys && <kbd>Y</kbd>}</button>
        {always && <button className="pd-btn" onClick={() => reply(true, true)}>Always allow{keys && <kbd>A</kbd>}</button>}
        <button className="pd-btn" autoFocus={p.confirmFirst} onClick={() => reply(false)}>{no}<kbd>N</kbd></button>
      </div>
      {MODE_HINTS[mode] && <div className="pd-hint">{MODE_HINTS[mode]}</div>}
    </>
  );
}

type BodyProps = { tool: string; input: Record<string, unknown>; title: string };

function BashBody({ input, title }: BodyProps) {
  const description = str(input.description);
  return (
    <>
      {description && description !== title && <div className="pd-desc">{description}</div>}
      <pre className="pd-code">{str(input.command)}</pre>
    </>
  );
}

function EditBody({ tool, input }: BodyProps) {
  const edits = tool === 'Write' ? [{ new_string: input.content }] : tool === 'Edit' ? [input] : Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
  return (
    <>
      <div className="pd-path">{str(input.file_path)}</div>
      {edits.map((e, n) => <Diff key={n} a={str(e.old_string)} b={str(e.new_string)} />)}
    </>
  );
}

function WebFetchBody({ input }: BodyProps) {
  const url = str(input.url);
  const prompt = str(input.prompt);
  return (
    <>
      <a className="pd-path" href={url} target="_blank" rel="noreferrer">{url}</a>
      {prompt && <div className="pd-desc">{prompt}</div>}
    </>
  );
}

function WebSearchBody({ input }: BodyProps) {
  return <div className="pd-path">{str(input.query)}</div>;
}

function RowsBody({ input }: BodyProps) {
  const rows = Object.entries(input).filter(([, v]) => v !== undefined && v !== '');
  if (!rows.length) return null;
  return <div className="pd-rows">{rows.map(([k, v]) => <Row key={k} k={k} v={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} />)}</div>;
}

const BODIES: Record<string, (props: BodyProps) => ReactNode> = {
  Bash: BashBody, Edit: EditBody, Write: EditBody, MultiEdit: EditBody, WebFetch: WebFetchBody, WebSearch: WebSearchBody,
};

function Row({ k, v }: { k: string; v: string }) {
  const [open, setOpen] = useState(false);
  const long = v.length > 160 || v.split('\n').length > 3;
  return (
    <>
      <span className="pd-key">{k}</span>
      <span className="pd-val">
        <span className={long && !open ? 'pd-clip' : undefined}>{v}</span>
        {long && <button className="pd-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
      </span>
    </>
  );
}

const MAX_LINES = 200;

function Diff({ a, b }: { a: string; b: string }) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  return (
    <pre className="pd-diff">
      {lines.slice(0, MAX_LINES).map(([t, l], n) => <div key={n} className={t === '+' ? 'add' : t === '-' ? 'del' : undefined}>{t} {l}</div>)}
      {lines.length > MAX_LINES && <div className="pd-cut">{lines.length - MAX_LINES} more lines</div>}
    </pre>
  );
}

export type DiffLine = [' ' | '-' | '+', string];

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  const n = x.length, m = y.length;
  if (n * m > 250_000) return [...x.map((l): DiffLine => ['-', l]), ...y.map((l): DiffLine => ['+', l])];
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) out.push([' ', x[i++]]), j++;
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push(['-', x[i++]]);
    else out.push(['+', y[j++]]);
  }
  return out;
}

export function QuestionCard({ q, first }: { q: PendingQuestion; first: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState<string | null>(null);
  const qq = q.questions[step];
  const total = q.questions.length;
  const multi = Boolean(qq?.multiSelect);

  const go = (to: number) => { setStep(to); setPicked([]); setOther(null); };
  const answer = (value: string) => {
    const next = { ...answers, [qq.question]: value };
    if (step + 1 >= total) return send({ type: 'answer', id: q.id, answers: next });
    setAnswers(next);
    go(step + 1);
  };
  const pick = (label: string) => {
    if (!multi) return answer(label);
    setPicked(picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]);
  };
  const result = [...picked, other?.trim() ?? ''].filter(Boolean).join(', ');

  useKeys(ref, first, (k) => {
    const n = Number(k);
    if (!qq || !Number.isInteger(n) || n < 1) return false;
    if (n <= qq.options.length) pick(qq.options[n - 1].label);
    else if (n === qq.options.length + 1) setOther(other ?? '');
    else return false;
    return true;
  });
  if (!qq) return null;

  return (
    <div ref={ref} className="pd" tabIndex={-1} role="group" aria-label={qq.question}>
      <div className="pd-head">
        <span className="pd-label">{qq.header || 'Question'}</span>
        {total > 1 && <span className="pd-count">{step + 1} of {total}</span>}
      </div>
      <div className="pd-ask">{qq.question}</div>
      <div className="pd-options" role={multi ? 'group' : 'radiogroup'}>
        {qq.options.map((o, n) => (
          <Option key={o.label} n={n + 1} multi={multi} on={picked.includes(o.label) || answers[qq.question] === o.label} onPick={() => pick(o.label)} label={o.label} description={o.description} preview={o.preview} />
        ))}
        {other === null ? (
          <Option n={qq.options.length + 1} multi={multi} on={false} onPick={() => setOther('')} label="Other…" className="pd-other" />
        ) : (
          <input
            autoFocus
            className="pd-other-input"
            value={other}
            placeholder="Type your answer, Enter to send"
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && result) answer(result);
              if (e.key === 'Escape') setOther(null);
            }}
          />
        )}
      </div>
      {(step > 0 || multi || other !== null) && (
        <div className="pd-actions pd-nav">
          {step > 0 && <button className="pd-btn" onClick={() => go(step - 1)}>Back</button>}
          {(multi || other !== null) && (
            <button className="pd-btn" disabled={!result} onClick={() => answer(result)}>{step + 1 < total ? 'Next' : 'Done'}</button>
          )}
        </div>
      )}
    </div>
  );
}

type OptionProps = { n: number; multi: boolean; on: boolean; label: string; description?: string; preview?: string; className?: string; onPick: () => void };

function Option({ n, multi, on, label, description, preview, className, onPick }: OptionProps) {
  return (
    <button className={`pd-option${on ? ' on' : ''}${className ? ` ${className}` : ''}`} role={multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={onPick}>
      {multi ? <span className="pd-mark" aria-hidden>{on ? '[x]' : '[ ]'}</span> : <span className="pd-dot" aria-hidden />}
      <span className="pd-opt">
        <span className="pd-opt-label">{label}</span>
        {description && <span className="pd-opt-desc">{description}</span>}
        {preview && <pre className="pd-preview">{preview}</pre>}
      </span>
      <kbd>{n}</kbd>
    </button>
  );
}
