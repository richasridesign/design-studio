import { useEffect, useState } from 'react';
import { TRIED, type Frame, type Section } from '../../../../../shared/canvas';

/** A section of the board: its name, its frames (a click selects one), and what can be done to it as a whole. */
export function SectionPanel({ section, frames, rename, ungroup, remove, show, select }: {
  section: Section; frames: Frame[]; rename: (to: string) => void; ungroup: () => void; remove: () => void; show: () => void; select: (id: string) => void;
}) {
  const [name, setName] = useState(section.name);
  useEffect(() => setName(section.name), [section.name]);
  const tried = section.name === TRIED;
  const commit = () => { const v = name.trim(); if (v && v !== section.name) rename(v); else setName(section.name); };
  const members = frames.filter((f) => section.ids.includes(f.id));
  return (
    <div className="cv-panel">
      <h2>Section</h2>
      {tried ? <p className="cv-muted">Tried options: frames parked out of the flow. Bring one back from its frame panel.</p>
        : <label>Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setName(section.name); }} /></label>}
      <div className="cv-field">
        <span>{members.length} {members.length === 1 ? 'frame' : 'frames'}</span>
        <ul className="cv-members">
          {members.map((f) => <li key={f.id}><button className="ghost" onClick={() => select(f.id)}>{f.n ? `${f.n} ` : ''}{f.name}</button></li>)}
        </ul>
      </div>
      <div className="cv-actions">
        <button onClick={show}>Zoom to section</button>
        {!tried && <button onClick={ungroup}>Ungroup</button>}
      </div>
      <button className="danger" onClick={remove}>Delete section and its frames</button>
    </div>
  );
}

/** The board itself, when nothing is selected: what is on it and the actions on all of it. */
export function BoardPanel({ name, frames, sections, tidy, groupByState, fit }: { name: string; frames: number; sections: number; tidy: (() => void) | null; groupByState: (() => void) | null; fit: () => void }) {
  return (
    <div className="cv-panel">
      <h2>{name}</h2>
      <p className="cv-muted">{frames} {frames === 1 ? 'frame' : 'frames'}{sections ? `, ${sections} ${sections === 1 ? 'section' : 'sections'}` : ''}. Pick an element in a frame to edit it, a frame's name to change its screen and state, or a section's name.</p>
      <div className="cv-actions">
        <button onClick={fit}>Fit the board</button>
        {tidy && <button onClick={tidy}>Tidy up</button>}
        {groupByState && <button onClick={groupByState} title="A section per state for frames not in a section yet, named after the state">Group by state</button>}
      </div>
    </div>
  );
}
