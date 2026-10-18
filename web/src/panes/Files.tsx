import { useEffect, useState } from 'react';
import { getJson, postJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, FilesArt } from './Empty';
import { Changes } from './Changes';
import { Comments } from './Comments';
import { Section } from '../Section';

type Project = { id: string; name: string };
type FileRow = { key: string; name: string; thumbnail_url: string; last_modified: string };

export const insertPrompt = (text: string) => window.dispatchEvent(new CustomEvent('designstudio:insert', { detail: text }));
/** Shows and focuses the message box without changing its text. */
export const focusComposer = () => window.dispatchEvent(new Event('designstudio:compose'));
export const attachFigma = () => window.dispatchEvent(new Event('designstudio:attach'));
export const showNode = (nodeId: string) => postJson('/api/figma/focus', { nodeId }).catch(() => {});

export const openFigmaTab = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } }));

/** The file's comments and versions. Its frames live on the Figma tab, so they are listed once. */
export function Files() {
  const figma = useStore((s) => s.session.figma);
  return (
    <div className="side-scroll">
      {figma ? (
        <>
          <section className="side-section">
            <div className="file-head">
              <div className="file-name">{figma.name}</div>
            </div>
            <p className="file-frames-hint muted small">Frames: on the Figma tab. <button className="link" onClick={openFigmaTab}>Open Figma tab</button></p>
          </section>
          <Section view="files" id="comments" title="Comments"><Comments /></Section>
          <Section view="files" id="versions" title="Versions"><Changes /></Section>
        </>
      ) : (
        <Empty art={<FilesArt />} title="No Figma file yet" text="Attach a Figma file to see its comments and versions here." action={{ label: 'Attach Figma file', onClick: attachFigma }} />
      )}
      <TeamFiles />
    </div>
  );
}

function TeamFiles() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [files, setFiles] = useState<Record<string, FileRow[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getJson<Project[]>('/api/figma/projects').then(setProjects).catch((e) => setError(e.message));
  }, []);
  const toggle = (id: string) => {
    setOpen((o) => (o === id ? null : id));
    if (!files[id]) getJson<FileRow[]>(`/api/figma/files?project=${id}`).then((f) => setFiles((x) => ({ ...x, [id]: f }))).catch((e) => setError(e.message));
  };
  if (error || !projects?.length) return null;
  return (
    <section className="side-section">
      <div className="side-label">Team files</div>
      {projects.map((p) => (
        <div key={p.id}>
          <button className="page-row" aria-expanded={open === p.id} onClick={() => toggle(p.id)}><Icon name={open === p.id ? 'chevron-down' : 'chevron-right'} small /> {p.name}</button>
          {open === p.id && (
            <ul className="frame-list">
              {(files[p.id] ?? []).map((f) => (
                <li key={f.key}>
                  <button className="frame" title="Start a chat on this file" onClick={() => send({ type: 'new_chat', url: `https://www.figma.com/design/${f.key}` })}>
                    <span className="thumb">{f.thumbnail_url ? <img src={f.thumbnail_url} alt="" loading="lazy" /> : <Icon name="file-media" small />}</span>
                    <span className="frame-name">{f.name}</span>
                  </button>
                </li>
              ))}
              {!files[p.id] && <li className="hint">Loading…</li>}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
