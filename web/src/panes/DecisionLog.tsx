import { useEffect, useMemo, useState } from 'react';
import { getJson, useRev, useStore } from '../store';
import { ago } from './reviewRuns';
import { decisionLog, whoLabel } from '../../../shared/decisionLog';
import type { SketchDoc } from '../../../shared/design';
import type { Stage, StageApprovals } from '../../../shared/stages';

const openSketch = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:sketch' } }));
const fullDate = (at: number) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Sketch picks and stage approvals with a note, newest first. */
export function DecisionLog() {
  const chat = useStore((s) => s.session.id);
  const sketchRev = useRev('sketch.json');
  const stagesRev = useRev('stages.json');
  const [sketch, setSketch] = useState<SketchDoc | null>(null);
  const [approvals, setApprovals] = useState<StageApprovals>({});

  useEffect(() => {
    let live = true;
    getJson<SketchDoc | { error: string } | null>('/api/sketch').then((d) => live && setSketch(d && 'screens' in d ? d : null), () => live && setSketch(null));
    return () => { live = false; };
  }, [chat, sketchRev]);

  useEffect(() => {
    let live = true;
    getJson<Stage[]>('/api/stages')
      .then((list) => live && setApprovals(Object.fromEntries(list.filter((s) => s.approval).map((s) => [s.id, s.approval]))))
      .catch(() => live && setApprovals({}));
    return () => { live = false; };
  }, [chat, stagesRev]);

  const rows = useMemo(() => decisionLog(sketch, approvals), [sketch, approvals]);

  return (
    <section className="dec-group" aria-labelledby="dlog-title">
      <h3 id="dlog-title">Decision log {rows.length > 0 && <span className="dec-count">{rows.length} {rows.length === 1 ? 'decision' : 'decisions'}</span>}</h3>
      {rows.length === 0 ? (
        <p className="dec-empty">No decisions yet. Your sketch picks and stage approvals with a note show up here.</p>
      ) : (
        <ul className="dec-list">
          {rows.map((r) => (
            <li key={r.id} className="dlog-row">
              <div className="dlog-what">
                <span className="dlog-title">{r.title}</span>
                <span className="dlog-meta">
                  {whoLabel(r)}
                  {r.at && <> · <time dateTime={new Date(r.at).toISOString()} title={fullDate(r.at)}>{ago(r.at)}</time></>}
                </span>
              </div>
              <div className="dlog-body">
                <span className="dlog-choice">{r.choice}</span>
                {r.over.length > 0 && <span>Over: {r.over.join(', ')}</span>}
                {r.why && <span>Why: {r.why}</span>}
                {r.by === 'claude' && <button className="link" onClick={openSketch}>Confirm or change on Sketch</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
