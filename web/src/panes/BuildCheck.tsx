import { useEffect, useRef, useState } from 'react';
import { api, getJson, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { buildChecklist, figmaNodeUrl, type BuildRun, type DesignDoc } from '../../../shared/design';
import { showNode, insertPrompt } from './composerEvents';
import { Empty, ReviewArt } from './Empty';
import { useOutlineVersion, getOutline } from '../outline';

const SEV = { blocking: 'Blocking', major: 'Major', minor: 'Minor' } as const;
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const shot = (run: BuildRun, name: string) => api(`/api/chat-file/${run.dir}/${name}?r=${run.id}`);

function Ring({ score }: { score: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--err)';
  return (
    <svg className="bc-ring" viewBox="0 0 76 76" role="img" aria-label={`${score} percent match`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="44" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--fg)">{score}</text>
    </svg>
  );
}

function Compare({ run }: { run: BuildRun }) {
  const [side, setSide] = useState(false);
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  const drag = {
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); },
  };
  const figma = shot(run, 'figma.png');
  const site = shot(run, 'site.png');
  return (
    <div className="ch-compare">
      <div className="ch-bar">
        <div className="seg" role="radiogroup" aria-label="Compare mode">
          <button role="radio" aria-checked={!side} className={!side ? 'on' : ''} onClick={() => setSide(false)}>Slider</button>
          <button role="radio" aria-checked={side} className={side ? 'on' : ''} onClick={() => setSide(true)}>Side by side</button>
        </div>
      </div>
      {!side ? (
        <div className="ch-stage ch-slider" ref={box} {...drag}>
          <img src={site} alt="Live page" draggable={false} />
          <img className="ch-top" src={figma} alt="Figma frame" draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)`, height: 'auto' }} />
          <span className="ch-tag l">Figma</span>
          <span className="ch-tag r">Site</span>
          <div className="ch-handle" style={{ left: `${pos}%` }}><span /></div>
        </div>
      ) : (
        <div className="ch-side">
          <figure><figcaption>Figma</figcaption><img src={figma} alt="Figma frame" /></figure>
          <figure><figcaption>Site ({run.width}px)</figcaption><img src={site} alt="Live page" /></figure>
        </div>
      )}
    </div>
  );
}

export function BuildCheck() {
  const figma = useStore((s) => s.session.figma);
  const v = useOutlineVersion();
  const chat = useStore((s) => s.session.id);
  const focus = useStore((s) => s.ui.focus);
  const running = useStore((s) => s.session.running);
  const rev = useRev('buildcheck.json');
  const [runs, setRuns] = useState<BuildRun[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [frame, setFrame] = useState<{ id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getJson<{ runs: BuildRun[] }>('/api/buildcheck').then((d) => { setRuns([...d.runs].reverse()); setSel(null); }).catch(() => {});
  }, [chat, rev]);

  useEffect(() => {
    setFrame(null);
    if (!figma) return;
    Promise.all([getOutline(figma.key), getJson<DesignDoc | null>('/api/design').catch((): DesignDoc => ({ frames: [] }))])
      .then(([o, d]) => {
        const all = o.pages.flatMap((p) => p.frames);
        const id = focus && all.some((f) => f.id === focus) ? focus : (d?.frames[0]?.nodeId ?? all[0]?.id);
        setFrame(all.find((f) => f.id === id) ?? null);
      })
      .catch(() => {});
  }, [figma?.key, chat, focus, v]);

  const run = runs.find((r) => r.id === sel) ?? runs[0];
  const check = () => insertPrompt(`/buildcheck ${url.trim()}${frame && figma ? ` ${frame.name} (${figmaNodeUrl(figma.key, frame.id)})` : ''}`);
  const copy = async () => {
    await navigator.clipboard.writeText(buildChecklist(run!)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="review-page">
      <div className="review-bar">
        <input className="bc-url" type="url" value={url} placeholder="https://staging.example.com/page or http://localhost:3000" aria-label="Page address" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && check()} />
        {frame && <span className="chip" title="The frame to compare with">{frame.name}</span>}
        <button className="primary" disabled={running || !url.trim()} onClick={check}><Icon name="play" small /> Check build</button>
        <span className="spacer" />
        {runs.length > 1 && (
          <select value={run?.id} onChange={(e) => setSel(e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.frameName} · {when(r.at)}</option>)}
          </select>
        )}
      </div>
      {!run && <Empty art={<ReviewArt />} title="Check the build against the design" text="Paste a staging or localhost URL. Design Studio screenshots it at the frame's width and lists what differs from Figma." />}
      {run && (
        <>
          <div className="bc-head">
            <Ring score={run.matchScore} />
            <div>
              <p className="crit-summary">{run.summary}</p>
              <div className="muted small">{run.frameName} · {run.url} · {run.width}px · {when(run.at)} · {Math.round(run.tokens / 1000)}k tokens · ${run.costUsd.toFixed(2)}</div>
            </div>
          </div>
          <Compare run={run} />
          <div className="bc-list-head">
            <b>{run.diffs.length} {run.diffs.length === 1 ? 'difference' : 'differences'}</b>
            {run.diffs.length > 0 && <button onClick={copy}><Icon name={copied ? 'check' : 'copy'} small /> {copied ? 'Copied' : 'Send diffs to engineer'}</button>}
          </div>
          <ul className="findings bc-diffs">
            {run.diffs.map((d, i) => (
              <li key={i} className={d.severity}>
                <span className={`sev ${d.severity}`}>{SEV[d.severity]}</span>
                <div className="f-body">
                  <div className="f-rule"><span className="chip">{d.kind}</span> {d.area}</div>
                  <div className="muted small">Figma: {d.figma}</div>
                  <div className="muted small">Site: {d.site}</div>
                  <div className="f-fix">{d.fix}</div>
                  {d.nodeId && <button className="node-chip" onClick={() => showNode(d.nodeId!)}>{d.nodeId}</button>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
