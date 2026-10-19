import { useEffect, useState } from 'react';
import type { ReviewRun } from '../../../shared/design';
import { vId } from '../../../shared/project';
import { getJson, useStore, type Selection } from '../store';
import { ago } from '../ago';
import { FlowCheck } from './FlowCheck';
import { SelectionHead } from './SelectionFigma';
import { isAudit, runLabel, summarize } from './reviewRuns';
import '../selection.css';

// The Review tab for a project, flow or iteration picked in the sidebar: the flow check of its iteration, then the
// review runs of each flow chat folder in that iteration, newest first. A project or flow uses its working iteration.
// Open a flow's chat to see a run in full and act on it.

type FlowRuns = { flow: { slug: string; n: number; name: string }; runs: ReviewRun[] };

export function SelectionReview({ sel }: { sel: Selection }) {
  const it = sel.iteration;
  const [flows, setFlows] = useState<FlowRuns[] | null | 'error'>(null);
  const rev = useStore((s) => s.ui.revs['review.json'] ?? 0);
  useEffect(() => {
    if (!it) return;
    let live = true;
    setFlows(null);
    getJson<{ flows: FlowRuns[] }>(`/api/projects/reviews?cwd=${encodeURIComponent(sel.cwd)}&iteration=${encodeURIComponent(it.id)}`)
      .then((d) => live && setFlows(d.flows), () => live && setFlows('error'));
    return () => { live = false; };
  }, [sel.cwd, it?.id, rev]);

  const shown = flows && flows !== 'error' ? flows.filter((f) => !sel.flow || f.flow.slug === sel.flow.slug) : [];
  return (
    <div className="review-page">
      <div className="sel-review">
        <SelectionHead sel={sel} link={null} />
        {!it ? (
          <p className="ff-line">No working iteration yet. Make one from the project menu, New iteration.</p>
        ) : (
          <>
            <FlowCheck scope={{ cwd: sel.cwd, iteration: it.id, key: sel.key, ...(sel.flow && it.flowNodes ? { nodes: it.flowNodes } : {}) }} />
            {flows === null && <p className="ff-line" role="status">Loading reviews…</p>}
            {flows === 'error' && <p className="ff-line error-text" role="alert">The reviews could not be read. Select the row again to retry.</p>}
            {flows && flows !== 'error' && !shown.length && <p className="ff-line">No flows in {vId(it.id)} yet.</p>}
            {shown.map((f) => (
              <section key={f.flow.slug} className="sel-group" aria-label={`Flow ${f.flow.n} · ${f.flow.name}`}>
                <h3 className="sel-group-title">
                  <span>Flow {f.flow.n} · {f.flow.name}</span>
                  <span className="sel-count">Reviews: {f.runs.length}</span>
                </h3>
                {f.runs.length ? (
                  <ul className="sel-runs">
                    {f.runs.map((r) => (
                      <li key={r.id} className="sel-run">
                        <span>{runLabel(r)}</span>
                        <span className="muted">{ago(r.at)}</span>
                        <span>{summarize({ kind: isAudit(r) ? 'audit' : 'review', id: r.id, at: r.at, tokens: r.tokens, run: r })}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ff-line">No reviews yet. They run after each Design run in this flow's chat.</p>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
