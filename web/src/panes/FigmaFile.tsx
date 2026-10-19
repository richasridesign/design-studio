import { useEffect, useState, type ReactNode } from 'react';
import { figmaNodeUrl, type DesignDoc, type DesignFrame } from '../../../shared/design';
import { api, getJson, useRev, useStore } from '../store';
import { useThumbs } from '../useThumbs';
import { Icon } from '../Icon';
import { Empty, BrowserArt } from './Empty';
import { SelectionFigma } from './SelectionFigma';
import '../figmafile.css';

const SAMPLE = 'sample';

export const frameLabel = (f: DesignFrame) => f.name || [f.screen, f.state].filter(Boolean).join(' / ') || f.nodeId;

/** Where a review saved this frame's screenshot in the chat folder. */
export const shotPath = (nodeId: string) => `/api/chat-file/review/shots/${nodeId.replace(/[:;]/g, '-')}.png`;

const attach = () => window.dispatchEvent(new Event('designstudio:attach'));

/** The Figma tab when Chrome is not showing: the attached file and its designed frames. */
export function FigmaFile({ chrome }: { chrome: ReactNode }) {
  const figma = useStore((s) => s.session.figma);
  const chat = useStore((s) => s.session.id);
  const rev = useRev('design.json');
  const [doc, setDoc] = useState<DesignDoc | null | undefined>(undefined);
  const sel = useStore((s) => s.ui.selection);

  useEffect(() => {
    if (!figma) return;
    let live = true;
    setDoc(undefined);
    getJson<DesignDoc | null>('/api/design').then((d) => live && setDoc(d), () => live && setDoc(null));
    return () => { live = false; };
  }, [chat, figma?.key, rev]);

  if (sel) return <SelectionFigma sel={sel} chrome={chrome} />;
  if (!figma) {
    return (
      <div className="browser-pane ff-pane">
        <Empty art={<BrowserArt />} title="No Figma file yet" text="Add a Figma file as a project to see its screens here." action={{ label: 'Add project', onClick: attach }} />
        {chrome}
      </div>
    );
  }

  const sample = figma.key === SAMPLE;
  const frames = doc?.frames ?? [];
  return (
    <div className="browser-pane ff-pane">
      <div className="ff-body">
        <header className="ff-head">
          <h2 className="ff-name">{figma.name}</h2>
          {sample
            ? <span className="ff-meta">Sample file, it is not in your Figma</span>
            : <a className="link ff-open" href={figma.url} target="_blank" rel="noopener noreferrer">Open in Figma<span className="sr-only"> (opens in a new tab)</span></a>}
        </header>
        {doc === undefined ? (
          <p className="ff-line" role="status">Loading frames…</p>
        ) : frames.length ? (
          <>
            <p className="ff-line">Designed frames: {frames.length}</p>
            <FrameGrid fileKey={sample ? null : figma.key} frames={frames} />
          </>
        ) : (
          <p className="ff-line">No designed frames yet. They show here once Claude designs in this file.</p>
        )}
      </div>
      {chrome}
    </div>
  );
}

function FrameGrid({ fileKey, frames }: { fileKey: string | null; frames: DesignFrame[] }) {
  const thumb = useThumbs(fileKey ?? undefined, frames.map((f) => [f.nodeId, 0]));
  return (
    <ul className="ff-grid">
      {frames.map((f) => (
        <li key={f.nodeId}>
          <FrameCard frame={f} href={fileKey ? figmaNodeUrl(fileKey, f.nodeId) : null} remote={thumb(f.nodeId)} />
        </li>
      ))}
    </ul>
  );
}

function FrameCard({ frame, href, remote }: { frame: DesignFrame; href: string | null; remote: string | null }) {
  // The review shot first, then the thumbnail read through the Figma plugin.
  const sources = [api(shotPath(frame.nodeId)), remote].filter((s): s is string => !!s);
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((s) => !failed.includes(s));
  const label = frameLabel(frame);
  const body = (
    <>
      <div className="ff-thumb">
        {src
          ? <img src={src} alt="" loading="lazy" onError={() => setFailed((x) => [...x, src])} />
          : <span className="ff-nothumb">No preview</span>}
      </div>
      <div className="ff-card-foot">
        <span className="ff-card-name" title={label}>{label}</span>
        {href && <Icon name="link-external" small />}
      </div>
    </>
  );
  if (!href) return <div className="ff-card">{body}</div>;
  return (
    <a className="ff-card ff-card-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}, open in Figma`}>
      {body}
    </a>
  );
}
