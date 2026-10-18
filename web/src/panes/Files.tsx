import { useEffect, useState } from 'react';
import { getJson, postJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, FilesArt } from './Empty';
import { Changes } from './Changes';
import { Comments } from './Comments';
import { Section } from '../Section';
import { figmaNodeUrl } from '../../../shared/design';
import { getOutline, refreshOutline, useOutlineVersion, type Outline } from '../outline';

type Project = { id: string; name: string };
type FileRow = { key: string; name: string; thumbnail_url: string; last_modified: string };

export const insertPrompt = (text: string) => window.dispatchEvent(new CustomEvent('designstudio:insert', { detail: text }));
/** Shows and focuses the message box without changing its text. */
export const focusComposer = () => window.dispatchEvent(new Event('designstudio:compose'));
export const attachFigma = () => window.dispatchEvent(new Event('designstudio:attach'));
export const showNode = (nodeId: string) => postJson('/api/figma/focus', { nodeId }).catch(() => {});

export function Files() {
  const figma = useStore((s) => s.session.figma);
  const focus = useStore((s) => s.ui.focus);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const v = useOutlineVersion();

  useEffect(() => {
    setOutline(null);
    setError('');
    if (!figma) return;
    getOutline(figma.key)
      .then((o) => {
        setOutline(o);
        const ids = o.pages.flatMap((p) => p.frames.slice(0, 12).map((f) => f.id)).slice(0, 60);
        if (ids.length) getJson<Record<string, string | null>>(`/api/figma/thumbs?ids=${encodeURIComponent(ids.join(','))}`).then(setThumbs).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [figma?.key, v]);

  return (
    <div className="side-scroll">
      {figma ? (
        <>
          <section className="side-section">
            <div className="file-head">
              <div className="file-name">{figma.name}</div>
              <div className="file-acts inline">
                <button onClick={() => postJson('/api/figma/show', {}).catch((e) => setError(e.message))}><Icon name="link-external" small /> Show in Chrome</button>
                <button className="icon-btn" title="Reload frames from Figma" aria-label="Reload frames from Figma" onClick={() => void refreshOutline(figma.key).catch(() => {})}><Icon name="refresh" small /></button>
              </div>
            </div>
            {error && <div className="error-text">{error}{/Settings/.test(error) && <> <button className="link" onClick={() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:settings' } }))}>Open Settings</button></>}</div>}
            {!outline && !error && <div className="hint">Loading frames…</div>}
            {outline?.pages.map((p) => (
              <div key={p.id} className="page-group">
                <button className="page-row" aria-expanded={open[p.id] ?? p.name !== 'Sketch'} onClick={() => setOpen((o) => ({ ...o, [p.id]: !(o[p.id] ?? p.name !== 'Sketch') }))}>
                  <Icon name={(open[p.id] ?? p.name !== 'Sketch') ? 'chevron-down' : 'chevron-right'} small /> {p.name} <span className="count">{p.frames.length}</span>
                </button>
                {(open[p.id] ?? p.name !== 'Sketch') && (
                  <ul className="frame-list">
                    {p.frames.map((f) => (
                      <li key={f.id} className={focus === f.id ? 'focused' : ''}>
                        <button className="frame" title={`${f.name} · ${f.w}×${f.h}\nShow in Figma`} onClick={() => showNode(f.id)}>
                          <span className="thumb">{thumbs[f.id] ? <img src={thumbs[f.id]!} alt="" loading="lazy" /> : <Icon name="symbol-misc" small />}</span>
                          <span className="frame-name">{f.name}</span>
                        </button>
                        <button className="icon-btn" title="Add to the prompt" aria-label={`Add ${f.name} to the prompt`} onClick={() => insertPrompt(`${f.name} (${figmaNodeUrl(figma.key, f.id)})`)}><Icon name="add" small /></button>
                      </li>
                    ))}
                    {!p.frames.length && <li className="hint">No frames on this page</li>}
                  </ul>
                )}
              </div>
            ))}
          </section>
          <Section view="files" id="comments" title="Comments"><Comments /></Section>
          <Section view="files" id="versions" title="Versions"><Changes /></Section>
        </>
      ) : (
        <Empty art={<FilesArt />} title="No Figma file yet" text="Attach a Figma file to open its frames here." action={{ label: 'Attach Figma file', onClick: attachFigma }} />
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
