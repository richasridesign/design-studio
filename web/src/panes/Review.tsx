import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getJson, postJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { AREAS, AREA_NAMES, PRESET_INFO, type Area, type CopyRun, type CritRun, type Finding, type ReviewDoc, type ReviewRun, reviewChecklist } from '../../../shared/design';
import { showNode, insertPrompt } from './Files';
import { Empty, ReviewArt } from './Empty';
import { CopyDetail, CritDetail } from './Crit';
import { BuildCheck } from './BuildCheck';
import { FrameNames } from '../FrameNames';
import { takeReviewFocus, type ReviewFocus } from './reviewFocus';
import { KIND_LABEL, ago, areaTone, mergeRuns, rulesTone, runLabel, shownPreset, summarize, unposted, type RulesTone, type RunRow } from './reviewRuns';
import { rulesLine, type RuleResult } from '../../../shared/rules';
import { frameName, useOutline } from '../outline';

const SEV: Record<Finding['severity'], string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };
const TONE_ICON: Record<RulesTone, string> = { pass: 'pass-filled', major: 'warning', blocking: 'error', error: 'error', unchecked: 'circle-large-outline' };
const RULE_STATE: Record<RuleResult['state'], string> = { pass: 'Passed', fail: 'Failed', unchecked: 'Not checked' };
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Review({ dev = false }: { dev?: boolean }) {
  const chat = useStore((s) => s.session.id);
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  const reviewRev = useRev('review.json');
  const critRev = useRev('crit.json');
  const copyRev = useRev('copy.json');
  const [doc, setDoc] = useState<ReviewDoc>({ runs: [] });
  const [crit, setCrit] = useState<CritRun[]>([]);
  const [copy, setCopy] = useState<CopyRun[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [build, setBuild] = useState(false);
  const [focus, setFocus] = useState<(ReviewFocus & { at: number }) | null>(null);

  useEffect(() => { getJson<ReviewDoc>('/api/review').then(setDoc).catch(() => {}); }, [chat, reviewRev]);
  useEffect(() => { getJson<{ runs: CritRun[] }>('/api/crit').then((d) => setCrit(d.runs)).catch(() => {}); }, [chat, critRev]);
  useEffect(() => { getJson<{ runs: CopyRun[] }>('/api/copy').then((d) => setCopy(d.runs)).catch(() => {}); }, [chat, copyRev]);
  useEffect(() => { setOpen({}); }, [chat]);
  useEffect(() => {
    const take = () => {
      const f = takeReviewFocus();
      if (!f) return;
      setFocus({ ...f, at: Date.now() });
      setOpen((o) => ({ ...o, [f.runId]: true }));
    };
    take();
    window.addEventListener('designstudio:review-focus', take);
    return () => window.removeEventListener('designstudio:review-focus', take);
  }, []);

  const rows = mergeRuns(doc.runs, crit, copy);

  return (
    <div className="review-page">
      <div className="review-bar">
        <button className="primary" onClick={() => insertPrompt('/review ')}><Icon name="play" small /> Review</button>
        <div className="seg" role="radiogroup" aria-label="Review depth">
          {(['quick', 'full'] as const).map((p) => (
            <button key={p} role="radio" aria-checked={preset === p} className={preset === p ? 'on' : ''} title={PRESET_INFO[p].detail} onClick={() => send({ type: 'set_flow', patch: { preset: p } })}>{PRESET_INFO[p].label}</button>
          ))}
        </div>
        <span className="spacer" />
        <button className="ghost export-report" onClick={() => window.open(api('/api/report'), '_blank')}>Export report</button>
        <a className="ghost" href={api('/api/report?download=1')} download aria-label="Download report" title="Download report"><Icon name="cloud-download" /></a>
      </div>
      {!rows.length && <Empty art={<ReviewArt />} title="Nothing reviewed yet" text="Reviews run after every Design run, or type /review with frame links." />}
      {!!rows.length && (
        <ul className="run-list">
          {rows.map((row, i) => {
            const on = open[row.id] ?? i === 0;
            return (
              <li key={row.id} className={on ? 'open' : ''}>
                <button className="run-row" aria-expanded={on} onClick={() => setOpen((o) => ({ ...o, [row.id]: !on }))}>
                  <Icon name={on ? 'chevron-down' : 'chevron-right'} small />
                  <span className={`run-kind ${row.kind}`}>{KIND_LABEL[row.kind]}</span>
                  <span className="muted" title={when(row.at)}>{ago(row.at)}</span>
                  <span className="run-sum">{summarize(row)}</span>
                </button>
                {on && <div className="run-detail"><RunDetail row={row} doc={doc} onDoc={setDoc} focus={focus?.runId === row.id ? focus : undefined} /></div>}
              </li>
            );
          })}
        </ul>
      )}
      {dev && (
        <section className="run-dev">
          <button className="run-row" aria-expanded={build} onClick={() => setBuild((v) => !v)}><Icon name={build ? 'chevron-down' : 'chevron-right'} small /> Build check</button>
          {build && <BuildCheck />}
        </section>
      )}
    </div>
  );
}

function RunDetail({ row, doc, onDoc, focus }: { row: RunRow; doc: ReviewDoc; onDoc: (d: ReviewDoc) => void; focus?: { area: string; at: number } }) {
  if (row.kind === 'crit') return <CritDetail run={row.run} />;
  if (row.kind === 'copy') return <CopyDetail run={row.run} />;
  return <ReviewDetail run={row.run} doc={doc} onDoc={onDoc} focus={focus} />;
}

function ReviewDetail({ run, doc, onDoc, focus }: { run: ReviewRun; doc: ReviewDoc; onDoc: (d: ReviewDoc) => void; focus?: { area: string; at: number } }) {
  const focusAt = (area: string) => (focus?.area === area ? focus.at : 0);
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const figmaKey = useStore((s) => s.session.figma?.key);
  const pending = unposted(run, doc);
  const hasFindings = run.check.length + run.results.reduce((n, r) => n + r.findings.length, 0) > 0;
  const copy = () => {
    navigator.clipboard.writeText(reviewChecklist(run, figmaKey && figmaKey !== 'sample' ? figmaKey : null)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const post = async () => {
    setPosting(true);
    try {
      const r = await postJson<{ posted: number }>('/api/review/post', { ids: pending.map((f) => f.id) });
      setNote(`Posted ${r.posted} comments in Figma`);
      onDoc(await getJson<ReviewDoc>('/api/review'));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      <div className="review-summary">
        <div><b>{runLabel(run)}</b> · {when(run.at)} · <FrameNames ids={run.frames} /></div>
        <div className="muted">{run.tokens ? `${k(run.tokens)} tokens · $${run.costUsd.toFixed(2)}` : 'No tokens used'}</div>
        {pending.length > 0 && <button disabled={posting} title={`Post ${pending.length} findings as Figma comments`} onClick={post}><Icon name="comment" small /> Post {pending.length} to Figma</button>}
        {hasFindings && <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy as checklist'}</button>}
        {note && <span className="muted">{note}</span>}
      </div>
      <div className="review-grid">
        <AreaCard title="Design system check" sub={run.checkError ?? (run.check.length ? `${run.check.length} issues` : 'No issues')} tone={areaTone(!run.checkError && !run.check.some((f) => f.severity !== 'minor'), !!run.checkError, run.check)} tokens={0} findings={run.check} grouped focusAt={focusAt('check')} />
        {!!run.rules?.length && (
          <AreaCard title="House rules" sub={run.rulesError ? `${rulesLine(run.rules)}. ${run.rulesError}` : rulesLine(run.rules)} tone={rulesTone(run)} tokens={0} findings={[]} focusAt={focusAt('rules')}>
            <RuleList rules={run.rules} />
          </AreaCard>
        )}
        {run.results.map((r) => (
          <AreaCard key={r.area} title={r.area === 'all' ? 'Reviewer · all areas' : AREA_NAMES[r.area]} sub={r.error ? `Failed: ${r.error}` : r.summary} tone={areaTone(r.pass, !!r.error, r.findings)} tokens={r.tokens} findings={r.findings} focusAt={focusAt(r.area)} />
        ))}
      </div>
    </>
  );
}

function RuleList({ rules }: { rules: RuleResult[] }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  return (
    <ul className="findings rule-list">
      {rules.map((r, i) => (
        <li key={i} className={`rule ${r.state}`}>
          <span className={`rule-state ${r.state}`}>{r.state === 'pass' && <Icon name="check" small />}{RULE_STATE[r.state]}</span>
          <div className="f-body">
            <div className="f-rule">{r.rule}</div>
            {r.frames.length > 0 && (
              <div className="rule-frames">
                {r.frames.map((id) => <button key={id} className="link" title="Show in Figma" onClick={() => showNode(id)}>{frameName(outline, id) ?? id}</button>)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AreaCard({ title, sub, tone, tokens, findings, grouped = false, focusAt = 0, children }: { title: string; sub: string; tone: RulesTone; tokens: number; findings: Finding[]; grouped?: boolean; focusAt?: number; children?: ReactNode }) {
  const pass = tone === 'pass';
  const [open, setOpen] = useState(!pass);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusAt) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusAt]);
  const shown = grouped ? [...findings].sort((a, b) => AREAS.indexOf(a.area as Area) - AREAS.indexOf(b.area as Area)) : findings;
  return (
    <section ref={ref} className={`area-card ${pass ? 'pass' : 'fail'} ${tone}${focusAt ? ' focused' : ''}`}>
      <header role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}>
        <Icon name={TONE_ICON[tone]} />
        <div className="area-title">
          <div className="t">{title}</div>
          <div className="s">{sub}</div>
        </div>
        {tokens > 0 && <span className="chip" title="Tokens this reviewer used">{k(tokens)}</span>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </header>
      {open && findings.length > 0 && (
        <ul className="findings">
          {shown.slice(0, 60).map((f) => (
            <li key={f.id} className={f.severity}>
              <span className={`sev ${f.severity}`}>{SEV[f.severity]}</span>
              <div className="f-body">
                <div className="f-rule">{f.rule}</div>
                <div className="f-fix">{f.fix}</div>
                <button className="link" onClick={() => showNode(f.node)}>{grouped ? `${AREA_NAMES[f.area as Area] ?? f.area} · ` : ''}{f.nodeName ?? f.node}</button>
              </div>
            </li>
          ))}
          {shown.length > 60 && <li className="muted">…and {shown.length - 60} more</li>}
        </ul>
      )}
      {open && children}
    </section>
  );
}
