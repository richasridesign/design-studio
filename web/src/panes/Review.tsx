import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, getJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { AREAS, AREA_NAMES, PRESET_INFO, type Area, type CopyRun, type CritRun, type Finding, type ReviewDoc, type ReviewRun, reviewChecklist } from '../../../shared/design';
import { attachFigma, showNode, insertPrompt } from './Files';
import { Empty, ReviewArt } from './Empty';
import { CopyDetail, CritDetail } from './Crit';
import { BuildCheck } from './BuildCheck';
import { FlowCheck } from './FlowCheck';
import { FrameNames } from '../FrameNames';
import { takeReviewFocus, type ReviewFocus } from './reviewFocus';
import { KIND_LABEL, TONE_MARK, ago, areaTone, mergeRuns, rulesTone, runLabel, shownPreset, summarize, type RulesTone, type RunRow } from './reviewRuns';
import { rulesLine, type RuleResult } from '../../../shared/rules';
import { openRun, resolvedRules, ruleKey, splitFindings, splitRun, triageKey, type Triage, type TriageChange, type TriageState } from '../../../shared/triage';
import { ClosedGroup, CloseForm, useNodeLabel, useTriage } from './Triage';
import '../review.css';
import '../marks';

const SEV: Record<Finding['severity'], string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };
const SEV_ORDER: Record<Finding['severity'], number> = { blocking: 0, major: 1, minor: 2 };
const RULE_STATE: Record<RuleResult['state'], string> = { pass: 'Passed', fail: 'Failed', unchecked: 'Not checked' };
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Review({ dev = false }: { dev?: boolean }) {
  const chat = useStore((s) => s.session.id);
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  const hasFigma = useStore((s) => !!s.session.figma);
  const reviewRev = useRev('review.json');
  const critRev = useRev('crit.json');
  const copyRev = useRev('copy.json');
  const [doc, setDoc] = useState<ReviewDoc>({ runs: [] });
  const [crit, setCrit] = useState<CritRun[]>([]);
  const [copy, setCopy] = useState<CopyRun[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [build, setBuild] = useState(false);
  const [focus, setFocus] = useState<(ReviewFocus & { at: number }) | null>(null);
  const { triage, change } = useTriage();

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
        <button className="ghost" title="Open the handoff report in a new tab" onClick={() => window.open(api('/api/report'), '_blank')}>Handoff report</button>
        <a className="ghost report-download" href={api('/api/report?download=1')} download aria-label="Download handoff report" title="Download handoff report"><Icon name="cloud-download" /></a>
      </div>
      <FlowCheck />
      {!rows.length && (hasFigma
        ? <Empty art={<ReviewArt />} title="Nothing reviewed yet" text="Reviews run after every Design run, or type /review with frame links." />
        : <Empty art={<ReviewArt />} title="Nothing to review yet" text="Reviews check the frames in a Figma file. Attach one to start." secondary={{ label: 'Attach Figma file', onClick: attachFigma }} />)}
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
                  <span className="run-sum">{summarize(row.kind === 'crit' || row.kind === 'copy' ? row : { ...row, run: openRun(row.run, triage) })}</span>
                </button>
                {on && <div className="run-detail"><RunDetail row={row} doc={doc} onDoc={setDoc} focus={focus?.runId === row.id ? focus : undefined} triage={triage} change={change} dev={dev} /></div>}
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

type TriageProps = { triage: Triage; change: (c: TriageChange) => Promise<void>; dev?: boolean };

function RunDetail({ row, doc, onDoc, focus, triage, change, dev }: { row: RunRow; doc: ReviewDoc; onDoc: (d: ReviewDoc) => void; focus?: { area: string; at: number } } & TriageProps) {
  if (row.kind === 'crit') return <CritDetail run={row.run} />;
  if (row.kind === 'copy') return <CopyDetail run={row.run} />;
  return <ReviewDetail run={row.run} doc={doc} onDoc={onDoc} focus={focus} triage={triage} change={change} dev={dev} />;
}

function ReviewDetail({ run, doc, onDoc, focus, triage, change, dev = false }: { run: ReviewRun; doc: ReviewDoc; onDoc: (d: ReviewDoc) => void; focus?: { area: string; at: number } } & TriageProps) {
  const focusAt = (area: string) => (focus?.area === area ? focus.at : 0);
  const [copied, setCopied] = useState(false);
  const figmaKey = useStore((s) => s.session.figma?.key);
  // Findings resolved by hand (fixed, won't fix, parked) leave the area cards and the checklist; resolved rules leave the rule list.
  const split = splitRun(run, triage);
  const openOf = (list: Finding[]) => splitFindings(run, list, triage).open;
  const check = openOf(run.check);
  const closedHead = useRef<HTMLButtonElement>(null);
  const [said, setSaid] = useState('');
  const triageOps: FindingTriage = {
    runId: run.id,
    close: async (f, state, why) => {
      await change({ action: 'close', key: triageKey(run, f), state, why });
      setSaid(`Resolved: ${f.rule}`);
      requestAnimationFrame(() => closedHead.current?.focus());
    },
  };
  const resolveRule = async (rule: string, state: TriageState, why: string) => {
    await change({ action: 'close', key: ruleKey(run, rule), state, why });
    setSaid(`Resolved: ${rule}`);
    requestAnimationFrame(() => closedHead.current?.focus());
  };
  const resolved = resolvedRules(run, triage);
  const reopen = async (key: string, rule: string, kind: 'finding' | 'rule') => {
    try {
      await change({ action: 'reopen', key });
      setSaid(`Reopened: ${rule}`);
      // The group closes when the last one is reopened, so focus moves to that item's Resolve link.
      requestAnimationFrame(() => (closedHead.current ?? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`Resolve ${kind}: ${rule}`)}"]`))?.focus());
    } catch (e) {
      setSaid((e as Error).message);
    }
  };
  const hasFindings = split.open.length > 0;
  const shown = openRun(run, triage);
  const copy = () => {
    navigator.clipboard.writeText(reviewChecklist(openRun(run, triage), figmaKey && figmaKey !== 'sample' ? figmaKey : null)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="review-summary">
        <div><b>{runLabel(run)}</b> · {when(run.at)} · <FrameNames ids={run.frames} /></div>
        {run.costUsd > 0 && <div className="muted">Cost: ${run.costUsd.toFixed(2)}{dev && run.tokens ? ` · ${k(run.tokens)} tokens` : ''}</div>}
        {hasFindings && <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy as checklist'}</button>}
      </div>
      <div className="review-grid">
        <AreaCard title="Design system check" sub={run.checkError ?? (check.length ? `${check.length} ${check.length === 1 ? 'issue' : 'issues'}` : 'No issues')} tone={areaTone(!run.checkError && !check.some((f) => f.severity !== 'minor'), !!run.checkError, check)} tokens={0} dev={dev} frames={run.frames} findings={check} grouped focusAt={focusAt('check')} triage={triageOps} />
        {!!shown.rules?.length && (
          <AreaCard title="House rules" sub={run.rulesError ? `${rulesLine(shown.rules)}. ${run.rulesError}` : rulesLine(shown.rules)} tone={rulesTone(shown)} tokens={0} frames={run.frames} findings={[]} focusAt={focusAt('rules')}>
            <RuleList rules={shown.rules} frames={run.frames} onResolve={resolveRule} />
          </AreaCard>
        )}
        {shown.results.map((r) => (
          <AreaCard key={r.area} title={r.area === 'all' ? 'All areas' : AREA_NAMES[r.area]} sub={r.error ? `Failed: ${r.error}` : r.summary} tone={areaTone(r.pass, !!r.error, r.findings)} tokens={r.tokens} dev={dev} frames={run.frames} findings={r.findings} focusAt={focusAt(r.area)} triage={triageOps} />
        ))}
      </div>
      <ClosedGroup closed={split.closed.map((f) => ({ ...f, key: triageKey(run, f) }))} rules={resolved} frames={run.frames} grouped={(f) => run.check.some((c) => c.id === f.id)} onReopen={reopen} headRef={closedHead} />
      <span className="sr-only" role="status">{said}</span>
    </>
  );
}

const RULE_MARK: Record<RuleResult['state'], string> = { pass: 'pass', fail: 'fail', unchecked: 'unchecked' };

/** Rules still to act on. A failed rule can be resolved by hand like a finding; resolved rules move to Resolved by hand. */
function RuleList({ rules, frames, onResolve }: { rules: RuleResult[]; frames: string[]; onResolve: (rule: string, state: TriageState, why: string) => Promise<void> }) {
  const label = useNodeLabel(frames);
  const [resolving, setResolving] = useState<string | null>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const cancel = (rule: string) => { setResolving(null); requestAnimationFrame(() => triggers.current[rule]?.focus()); };
  return (
    <ul className="findings rule-list">
      {rules.filter((r) => !r.triage).map((r) => (
        <li key={r.rule} className={`rule ${r.state}`}>
          <span className={`rule-state mk ${RULE_MARK[r.state]}`}>{RULE_STATE[r.state]}</span>
          <div className="f-body">
            <div className="f-rule">{r.rule}</div>
            {(r.frames.length > 0 || r.state === 'fail') && (
              <div className="f-foot">
                {r.frames.map((id) => <button key={id} className="link" title="Show in Figma" onClick={() => showNode(id)}>{label(id)}</button>)}
                {r.state === 'fail' && resolving !== r.rule && <button ref={(el) => { triggers.current[r.rule] = el; }} className="triage-link" aria-label={`Resolve rule: ${r.rule}`} onClick={() => setResolving(r.rule)}>Resolve</button>}
              </div>
            )}
            {resolving === r.rule && <CloseForm rule={r.rule} kind="rule" onSave={async (state, why) => { await onResolve(r.rule, state, why); setResolving(null); }} onCancel={() => cancel(r.rule)} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

type FindingTriage = { runId: string; close: (f: Finding, state: TriageState, why: string) => Promise<void> };

function AreaCard({ title, sub, tone, tokens, dev = false, frames, findings, grouped = false, focusAt = 0, triage, children }: { title: string; sub: string; tone: RulesTone; tokens: number; dev?: boolean; frames: string[]; findings: Finding[]; grouped?: boolean; focusAt?: number; triage?: FindingTriage; children?: ReactNode }) {
  const label = useNodeLabel(frames);
  const pass = tone === 'pass';
  // One finding's resolve form open at a time; Cancel returns focus to its Resolve link.
  const [closing, setClosing] = useState<string | null>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const cancel = (id: string) => { setClosing(null); requestAnimationFrame(() => triggers.current[id]?.focus()); };
  const [open, setOpen] = useState(!pass);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusAt) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusAt]);
  const bodyId = `area-${useId()}`;
  // Blocking first, then major, then minor; the design system check keeps its areas together within each level.
  const shown = [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (grouped ? AREAS.indexOf(a.area as Area) - AREAS.indexOf(b.area as Area) : 0));
  return (
    <section ref={ref} className={`area-card ${pass ? 'pass' : 'fail'} ${tone}${focusAt ? ' focused' : ''}`}>
      <header>
        <button type="button" className="area-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          <span className={`mk area-mark ${TONE_MARK[tone]}`} aria-hidden="true" />
          <span className="area-title">
            <span className="t">{title}</span>
            <span className="s">{sub}</span>
          </span>
          {dev && tokens > 0 && <span className="chip" title="Tokens this reviewer used">{k(tokens)} tokens</span>}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
        </button>
      </header>
      {open && findings.length > 0 && (
        <ul className="findings" id={bodyId}>
          {shown.slice(0, 60).map((f) => (
            <li key={f.id} className={f.severity}>
              <span className={`sev mk ${f.severity}`}>{SEV[f.severity]}</span>
              <div className="f-body">
                <div className="f-rule">{f.rule}</div>
                <div className="f-fix">{f.fix}</div>
                <div className="f-foot">
                  <button className="link" title="Show in Figma" onClick={() => showNode(f.node)}>{grouped ? `${AREA_NAMES[f.area as Area] ?? f.area} · ` : ''}{label(f.node, f.nodeName)}</button>
                  {triage && closing !== f.id && <button ref={(el) => { triggers.current[f.id] = el; }} className="triage-link" aria-label={`Resolve finding: ${f.rule}`} onClick={() => setClosing(f.id)}>Resolve</button>}
                </div>
                {triage && closing === f.id && <CloseForm rule={f.rule} onSave={async (state, why) => { await triage.close(f, state, why); setClosing(null); }} onCancel={() => cancel(f.id)} />}
              </div>
            </li>
          ))}
          {shown.length > 60 && <li className="muted">…and {shown.length - 60} more</li>}
        </ul>
      )}
      {open && children && <div id={findings.length ? undefined : bodyId}>{children}</div>}
    </section>
  );
}
