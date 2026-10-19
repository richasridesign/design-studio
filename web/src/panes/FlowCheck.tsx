import { useEffect, useState } from 'react';
import { getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { FLOW_RULES, FLOW_RULE_LABEL, flowFixPrompt, flowIssues, flowLabel, type FlowCheckRun, type FlowFinding, type FlowResult } from '../../../shared/flowcheck';
import { attachFigma, insertPrompt, showNode } from './composerEvents';
import { Empty, ReviewArt } from './Empty';
import { ago } from '../ago';
import { useOutline } from '../outline';
import { FigmaErrorText } from '../FigmaLogin';
import '../flowcheck.css';

const SEV = { major: 'Major', minor: 'Minor' } as const;

/** Rough wait for a flow check. 161 top-level frames took 36 seconds on a large test file. An assumption to confirm on more files. */
export function flowEstimate(frames: number) {
  const s = 15 + frames * 0.13;
  return s < 60 ? `about ${Math.max(15, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} ${Math.round(s / 60) === 1 ? 'minute' : 'minutes'}`;
}

function byScreen(findings: FlowFinding[]) {
  const out: Array<{ id: string; name: string; items: FlowFinding[] }> = [];
  for (const f of findings) {
    const id = f.screen?.id ?? f.flow.id;
    const g = out.find((x) => x.id === id) ?? (out.push({ id, name: f.screen?.name ?? 'Section', items: [] }), out[out.length - 1]);
    g.items.push(f);
  }
  return out;
}

const screensText = (n: number) => `${n} ${n === 1 ? 'screen' : 'screens'}`;

function counts(flow: FlowResult) {
  // Parked sections are frozen references, so no rule runs on them.
  if (flow.skipped === 'parked') return flow.screens ? `Reason: Parked · ${screensText(flow.screens)}` : 'Reason: Parked';
  if (flow.skipped === 'cut') return 'Reason: Not fully read, the file is over the 20,000 layer limit';
  if (flow.state === 'unchecked') return 'No screens in this section';
  const parts = FLOW_RULES.filter((r) => flow.counts[r]).map((r) => `${FLOW_RULE_LABEL[r]} ${flow.counts[r]}`);
  return parts.length ? parts.join(' · ') : screensText(flow.screens);
}

function FlowRow({ flow, open, onToggle }: { flow: FlowResult; open: boolean; onToggle: () => void }) {
  const canOpen = flow.findings.length > 0;
  return (
    <li className={`fc-flow ${flow.state}`}>
      <button className="fc-row" aria-expanded={canOpen ? open : undefined} disabled={!canOpen} onClick={onToggle}>
        <span className="fc-chev" aria-hidden="true">{canOpen && <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</span>
        <span className={`fc-state ${flow.state}`}>{flowLabel(flow)}</span>
        <span className="fc-name">
          <span className="fc-flowname">{flow.name}{flow.path.length > 0 && <span className="fc-path"> in {flow.path.join(' / ')}</span>}</span>
          <span className="fc-counts">{counts(flow)}</span>
        </span>
      </button>
      {open && canOpen && (
        <div className="fc-detail">
          <button className="node-chip fc-section-chip" title="Show in Figma" onClick={() => showNode(flow.id)}>Open section in Figma</button>
          {byScreen(flow.findings).map((g) => (
            <section key={g.id} className="fc-screen" aria-label={g.name}>
              <h4>
                <span>{g.name}</span>
                <button className="node-chip" title="Show in Figma" aria-label={`Show ${g.name} in Figma`} onClick={() => showNode(g.id)}>{g.id}</button>
              </h4>
              <ul className="findings">
                {g.items.map((f) => (
                  <li key={f.id} className={f.severity}>
                    <span className={`sev ${f.severity}`}>{SEV[f.severity]}</span>
                    <div className="f-body">
                      <div className="f-rule"><span className="fc-rule">{FLOW_RULE_LABEL[f.rule]}</span> {f.message}</div>
                      <div className="f-fix">{f.fix}</div>
                      <button className="node-chip" title="Show in Figma" onClick={() => showNode(f.nodeId)}>{f.nodeName} · {f.nodeId}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {flow.more > 0 && <p className="fc-more">And {flow.more} more. Fix these, then run the check again.</p>}
        </div>
      )}
    </li>
  );
}

export function FlowCheck() {
  const figma = useStore((s) => s.session.figma);
  const chat = useStore((s) => s.session.id);
  const [run, setRun] = useState<FlowCheckRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [asked, setAsked] = useState(false);
  const outline = useOutline(figma?.key);
  const frames = outline ? outline.pages.reduce((n, p) => n + p.frames.length, 0) : 0;

  useEffect(() => {
    setRun(null);
    setError('');
    setOpen({});
    getJson<{ runs: FlowCheckRun[] }>('/api/flowcheck').then((d) => setRun(d.runs.filter((r) => r.fileKey === figma?.key).at(-1) ?? null)).catch(() => {});
  }, [chat, figma?.key]);

  if (!figma) return <Empty art={<ReviewArt />} title="No Figma file yet" text="Add a Figma file as a project to review it and check its flows." secondary={{ label: 'Add project', onClick: attachFigma }} />;

  const check = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ run: FlowCheckRun }>('/api/flowcheck', {});
      setRun(r.run);
      // The Validate gate counts this run.
      window.dispatchEvent(new Event('designstudio:evidence'));
      const first = r.run.flows.find((f) => f.state === 'fail');
      setOpen(first ? { [first.id]: true } : {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const failed = run?.flows.filter((f) => f.state === 'fail') ?? [];
  const issues = failed.reduce((n, f) => n + flowIssues(f), 0);
  const ask = () => {
    if (!run) return;
    insertPrompt(flowFixPrompt(run));
    setAsked(true);
    setTimeout(() => setAsked(false), 2000);
  };

  return (
    <section className="fc" aria-labelledby="fc-title">
      <div className="fc-head">
        <div className="fc-intro">
          <h2 id="fc-title">Flow check</h2>
          <p>Clicks, hovers, close icons, tooltips, toasts, links, overlaps, stickies and notes in each section. Costs under a cent.</p>
        </div>
        <button className="fc-run" disabled={busy} onClick={check}><Icon name={busy ? 'loading' : 'play'} small spin={busy} /> {busy ? 'Checking…' : 'Run flow check'}</button>
      </div>
      {error && <p className="fc-error" role="alert"><FigmaErrorText text={error} /></p>}
      {/* The check runs inside Figma through the plugin: one short Claude call plus the read. */}
      {busy && <p className="fc-meta" role="status">{frames ? `Checking ${frames} ${frames === 1 ? 'frame' : 'frames'} in Figma, ${flowEstimate(frames)}.` : 'Checking the file in Figma, about a minute.'}</p>}
      {run && !busy && (
        <div className="fc-meta" role="status">
          <span>Checked {ago(run.at)} · {run.flows.length} {run.flows.length === 1 ? 'flow' : 'flows'} · {issues ? `${issues} ${issues === 1 ? 'issue' : 'issues'} in ${failed.length} ${failed.length === 1 ? 'flow' : 'flows'}` : 'no issues'}</span>
          {run.truncated && <span className="fc-note">Large file: the check stopped at 20,000 layers. It reads LATEST and Parked first, and skips sections it could not finish.</span>}
          {run.unchecked.includes('no-stickies') && <span className="fc-note">Stickies not checked: this file has no Decision stickies.</span>}
          {issues > 0 && <button className="fc-ask" onClick={ask}>{asked ? 'Added to the message box' : 'Fix the issues'}</button>}
        </div>
      )}
      {run && !busy && !!run.missing?.length && (
        <p className="fc-missing"><span className="fc-tri" aria-hidden="true" />Not found in the file: {run.missing.join(', ')}</p>
      )}
      {run && !run.flows.length && <p className="fc-meta">No sections found. Flow check reads each Figma section as one flow.</p>}
      {run && run.flows.length > 0 && (
        <ul className="fc-flows">
          {run.flows.map((f) => <FlowRow key={f.id} flow={f} open={!!open[f.id]} onToggle={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))} />)}
        </ul>
      )}
    </section>
  );
}
