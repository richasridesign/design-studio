import { useEffect, useMemo, useRef, useState } from 'react';
import { getJson, useStore } from '../store';
import { ReviewArt, Empty } from './Empty';
import type { DesignDoc } from '../../../shared/design';
import { useOutlineVersion, getOutline, type Outline } from '../outline';
import { laterSaves, reviewTarget } from './reviewNow';
import '../reviewNow.css';

type Version = { id: string; at: string; label: string; description: string; user: string; checkpoint: boolean };
type FrameRow = Outline["pages"][number]["frames"][number];
type Urls = Record<string, string | null>;

const EMPTY = 'Every time Claude edits Figma it saves a version first. Compare any version with now, side by side or with a slider.';

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  for (const [n, unit] of [[86400 * 7, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']] as const) if (s >= n) return `${Math.floor(s / n)}${unit} ago`;
  return 'just now';
}

export function Changes() {
  const figma = useStore((s) => s.session.figma);
  const v = useOutlineVersion();
  const chat = useStore((s) => s.session.id);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [frames, setFrames] = useState<FrameRow[]>([]);
  const [error, setError] = useState('');
  const [versionId, setVersionId] = useState<string | null>(null);
  const [frameId, setFrameId] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setVersions(null);
    setFrames([]);
    setError('');
    setVersionId(null);
    setFrameId(null);
    if (!figma) return;
    getJson<Version[]>('/api/figma/versions').then((v) => { setVersions(v); setVersionId((reviewTarget(v) ?? v[0])?.id ?? null); }).catch((e) => setError(e.message));
    Promise.all([getOutline(figma.key), getJson<DesignDoc>('/api/design').catch((): DesignDoc => ({ frames: [] }))])
      .then(([o, d]) => {
        const all = o.pages.flatMap((p) => p.frames);
        const mine = d.frames.map((f) => all.find((a) => a.id === f.nodeId)).filter((f): f is FrameRow => !!f);
        const list = [...new Map([...mine, ...all].map((f) => [f.id, f])).values()];
        setFrames(list);
        setFrameId(list[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, [figma?.key, chat, v]);

  useEffect(() => {
    const on = list.current?.querySelector<HTMLElement>('.ch-item.on');
    const box = list.current;
    if (!on || !box) return;
    const a = on.getBoundingClientRect(), b = box.getBoundingClientRect();
    box.scrollBy({ left: a.left < b.left || a.right > b.right ? a.left - b.left : 0, top: a.top < b.top || a.bottom > b.bottom ? a.top - b.top : 0, behavior: 'smooth' });
  }, [versionId, versions]);

  if (!figma || /access token/i.test(error)) return <Empty art={<ReviewArt />} title="No versions to compare" text={EMPTY} />;
  const version = versions?.find((v) => v.id === versionId);
  const target = versions ? reviewTarget(versions) : undefined;
  const later = target ? laterSaves(versions!, target) : 0;

  return (
    <div className="changes">
      <ul className="ch-list" aria-label="Versions" ref={list}>
        {!versions && !error && [0, 1, 2, 3].map((i) => <li key={i} className="ch-skel" />)}
        {versions && !versions.length && <li className="muted ch-note">No versions saved yet.</li>}
        {versions?.map((v) => (
          <li key={v.id}>
            <button className={`ch-item ${v.id === versionId ? 'on' : ''}`} onClick={() => setVersionId(v.id)}>
              <span className="ch-meta">
                {v.checkpoint && <span className="ch-dot" aria-hidden="true" />}
                <b>{v.checkpoint ? 'Claude' : v.user}</b>
                <span className="muted">{ago(v.at)}</span>
              </span>
              <span className="ch-label">{v.label || v.description || 'Autosave'}</span>
              {v.label && v.description && <span className="muted ch-desc">{v.description}</span>}
              {v.id === target?.id && <span className="rn-mark"><span className="rn-dot" aria-hidden="true" />Review this</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="ch-main">
        {error && <div className="ch-error" role="alert">{error}</div>}
        {versions && !versions.length && !error ? (
          <Empty art={<ReviewArt />} title="No versions yet" text={EMPTY} />
        ) : (
          <>
            {target && (
              <p className="rn-line">
                {target.id === versionId ? (
                  <><b>Reviewing:</b> Claude's last edit, {ago(target.at)}, compared with now{later > 0 && `, with ${later} ${later === 1 ? 'save' : 'saves'} made since`}.</>
                ) : (
                  <><b>Claude's last edit:</b> {ago(target.at)}. <button className="rn-link" onClick={() => { setVersionId(target.id); setFrameId(frames[0]?.id ?? null); }}>Review it</button></>
                )}
              </p>
            )}
            <div className="chips ch-frames">
              {frames.map((f) => (
                <button key={f.id} className={`ch-chip ${f.id === frameId ? 'on' : ''}`} onClick={() => setFrameId(f.id)}>{f.name}</button>
              ))}
            </div>
            {version && frameId && <Compare version={version} frameId={frameId} fileKey={figma.key} />}
          </>
        )}
      </div>
    </div>
  );
}

function Compare({ version, frameId, fileKey }: { version: Version; frameId: string; fileKey: string }) {
  const [before, setBefore] = useState<string | null | undefined>(undefined);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [side, setSide] = useState(false);
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAfter(undefined);
    setError('');
    getJson<Urls>(`/api/figma/render?ids=${encodeURIComponent(frameId)}`).then((u) => setAfter(u[frameId] ?? null)).catch((e) => setError(e.message));
  }, [frameId, fileKey]);

  useEffect(() => {
    setBefore(undefined);
    setError('');
    getJson<Urls>(`/api/figma/render?ids=${encodeURIComponent(frameId)}&version=${encodeURIComponent(version.id)}`).then((u) => setBefore(u[frameId] ?? null)).catch((e) => setError(e.message));
  }, [frameId, version.id, fileKey]);

  const move = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  const drag = {
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); },
  };

  const beforeLabel = `Before (${ago(version.at)})`;
  const loading = !error && (before === undefined || after === undefined);
  const missing = !error && !loading && (!before || !after);

  return (
    <div className="ch-compare">
      <div className="ch-bar">
        <div className="seg" role="radiogroup" aria-label="Compare mode">
          <button role="radio" aria-checked={!side} className={!side ? 'on' : ''} onClick={() => setSide(false)}>Slider</button>
          <button role="radio" aria-checked={side} className={side ? 'on' : ''} onClick={() => setSide(true)}>Side by side</button>
        </div>
        <a className="ch-figma" href={`https://www.figma.com/design/${fileKey}?version-id=${version.id}`} target="_blank" rel="noreferrer">Open version history in Figma</a>
      </div>
      {error && <div className="ch-error" role="alert">{error}</div>}
      {loading && <div className="ch-skel ch-stage" aria-label="Rendering" />}
      {missing && <div className="ch-error">{!before ? 'This frame did not exist in that version, or Figma could not render it.' : 'Figma could not render the current frame.'}</div>}
      {!loading && !missing && !error && !side && (
        <div className="ch-stage ch-slider" ref={box} {...drag}>
          <img src={after!} alt="Now" draggable={false} />
          <img className="ch-top" src={before!} alt={beforeLabel} draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
          <span className="ch-tag l">{beforeLabel}</span>
          <span className="ch-tag r">Now</span>
          <div className="ch-handle" style={{ left: `${pos}%` }}><span /></div>
        </div>
      )}
      {!loading && !missing && !error && side && (
        <div className="ch-side">
          <figure><figcaption>{beforeLabel}</figcaption><img src={before!} alt={beforeLabel} /></figure>
          <figure><figcaption>Now</figcaption><img src={after!} alt="Now" /></figure>
        </div>
      )}
    </div>
  );
}
