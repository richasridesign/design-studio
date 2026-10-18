import { useState } from 'react';
import { postJson } from '../store';
import { Icon } from '../Icon';
import { PERSONAS, PERSONA_NAMES, copyTable, critMarkdown, type CopyItem, type CopyRun, type CritRun, type Persona } from '../../../shared/design';
import { showNode, insertPrompt } from './Files';

const PERSONA_ICON: Record<Persona, string> = { 'new-user': 'person', 'power-user': 'zap', accessibility: 'eye', product: 'target' };
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const cost = (r: { tokens: number; costUsd: number }) => `${k(r.tokens)} tokens · $${r.costUsd.toFixed(2)}`;

export function CritDetail({ run }: { run: CritRun }) {
  return (
    <>
      <div className="crit-head">
        <p className="crit-summary">{run.summary}</p>
        <div className="muted small">{when(run.at)} · {run.frames.length} {run.frames.length === 1 ? 'frame' : 'frames'} · {cost(run)}</div>
        <CopyButton label="Copy notes" text={() => critMarkdown(run)} />
      </div>
      <div className="crit-grid">
        {PERSONAS.map((id) => run.personas.find((p) => p.id === id)).filter((p) => !!p).map((p) => (
          <section key={p!.id} className="crit-card">
            <header>
              <span className="crit-icon"><Icon name={PERSONA_ICON[p!.id]} /></span>
              <h3>{PERSONA_NAMES[p!.id]}</h3>
            </header>
            <p className="crit-verdict">{p!.verdict}</p>
            <ul>
              {p!.points.map((pt, i) => (
                <li key={i}>
                  <span className={`crit-dot ${pt.kind}`} title={pt.kind} />
                  <div>
                    <span>{pt.text}</span>
                    {pt.nodeId && <> <button className="node-chip" onClick={() => showNode(pt.nodeId!)}>{pt.nodeId}</button></>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function CopyButton({ text, label }: { text: () => string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return <button onClick={copy}><Icon name="copy" small /> {copied ? 'Copied' : label}</button>;
}

const grow = (e: { currentTarget: HTMLTextAreaElement }) => {
  const el = e.currentTarget;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

export function CopyDetail({ run }: { run: CopyRun }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(run.items.map((i) => i.nodeId)));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const allOn = picked.size === run.items.length;
  const apply = async () => {
    try {
      const r = await postJson<{ prompt: string }>('/api/copy/apply', { runId: run.id, nodeIds: [...picked], edits });
      insertPrompt(r.prompt);
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <>
      <div className="review-summary">
        <div><b>{run.items.length} suggested changes</b> · {run.tone} · {when(run.at)}</div>
        <div className="muted small">{cost(run)}</div>
        {run.items.length > 0 && (
          <>
            <button onClick={() => setPicked(allOn ? new Set() : new Set(run.items.map((i) => i.nodeId)))}>{allOn ? 'Select none' : 'Accept all'}</button>
            <button className="primary" disabled={!picked.size} onClick={apply}>Apply selected in Figma ({picked.size})</button>
            <CopyButton label="Copy as table" text={() => copyTable(run)} />
          </>
        )}
        {note && <span className="muted">{note}</span>}
      </div>
      {run.items.length === 0 ? <p className="muted">Nothing worth changing in these frames.</p> : (
        <div className="copy-scroll">
          <table className="copy-table">
            <thead><tr><th /><th>Before</th><th>After</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {run.items.map((i: CopyItem) => (
                <tr key={i.nodeId}>
                  <td><input type="checkbox" checked={picked.has(i.nodeId)} onChange={() => toggle(i.nodeId)} aria-label={`Accept ${i.before}`} /></td>
                  <td className="before">{i.before}</td>
                  <td><textarea rows={1} value={edits[i.nodeId] ?? i.after} onChange={(e) => setEdits((m) => ({ ...m, [i.nodeId]: e.target.value }))} onInput={grow} ref={(el) => { if (el) grow({ currentTarget: el }); }} /></td>
                  <td className="reason">{i.reason}</td>
                  <td><button className="node-chip" onClick={() => showNode(i.nodeId)}>{i.nodeId}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
