import type { Frame, Link } from '../../../../../shared/canvas';

/** An arrow between two frames: its label (the click that leads there) and Delete. */
export function LinkPanel({ link, frames, setLink, remove }: { link: Link; frames: Frame[]; setLink: (id: string, p: Partial<Link>) => void; remove: (id: string) => void }) {
  const name = (id: string) => { const f = frames.find((x) => x.id === id); return f ? `${f.n ? `${f.n} ` : ''}${f.name}` : ''; };
  return (
    <div className="cv-panel">
      <h2>Arrow</h2>
      <p className="cv-muted">{name(link.from)} to {name(link.to)}</p>
      <label>Label<input value={link.label} placeholder="Click Open" onChange={(e) => setLink(link.id, { label: e.target.value })} /></label>
      <button className="danger" onClick={() => remove(link.id)}>Delete arrow</button>
    </div>
  );
}
