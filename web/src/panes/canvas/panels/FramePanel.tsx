import { useEffect, useState } from 'react';
import { isFigmaLink, SIZES, type Frame, type Manifest } from '../../../../../shared/canvas';
import { Icon } from '../../../Icon';

type Actions = { duplicate: () => void; focus: () => void; reload: () => void; review: () => void; park: (on: boolean) => void; remove: () => void };

/** A number field that only commits a whole size of 100 to 4000 pixels. */
function Px({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Math.round(Number(v)); if (n >= 100 && n <= 4000) set(n); else setV(String(value)); };
  return <label>{label}<input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label>;
}

export function FramePanel({ frame, manifest, groups, failed, setFrame, act }: {
  frame: Frame; manifest: Manifest | null; groups: string[]; failed: string | undefined; setFrame: (id: string, p: Partial<Frame>) => void; act: Actions;
}) {
  const set = (p: Partial<Frame>) => setFrame(frame.id, p);
  const [figma, setFigma] = useState(frame.figma ?? '');
  useEffect(() => setFigma(frame.figma ?? ''), [frame.figma]);
  const badLink = figma !== '' && !isFigmaLink(figma);
  return (
    <div className="cv-panel">
      <h2>Frame</h2>
      <label>Name<input value={frame.name} onChange={(e) => set({ name: e.target.value })} /></label>
      {frame.n !== undefined && <label>Step<input value={frame.n} placeholder="3 or 3.1" onChange={(e) => set({ n: e.target.value })} /></label>}
      {frame.n !== undefined && <label>Note<textarea rows={3} value={frame.note ?? ''} placeholder="What happens on this step" onChange={(e) => set({ note: e.target.value })} /></label>}
      <label>Screen
        <select value={frame.route} onChange={(e) => set({ route: e.target.value, name: manifest?.screens.find((s) => s.route === e.target.value)?.name ?? frame.name })}>
          {(manifest?.screens ?? []).map((s) => <option key={s.route} value={s.route}>{s.name} ({s.route})</option>)}
          {!manifest?.screens.some((s) => s.route === frame.route) && <option value={frame.route}>{frame.route}</option>}
        </select>
      </label>
      <label>State
        <select value={frame.scenario} onChange={(e) => set({ scenario: e.target.value })}>
          {(manifest?.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {!frame.parked && (
        <label>Section
          <input list="cv-groups" value={frame.group ?? ''} placeholder="None, like Happy path or Empty" onChange={(e) => set({ group: e.target.value || undefined })} />
          <datalist id="cv-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
      )}
      {!!frame.clicks?.length && (
        <div className="cv-field">
          <span>Clicks after load</span>
          <ol className="cv-clicks">
            {frame.clicks.map((c, i) => (
              <li key={i} className={failed === c ? 'failed' : ''}>
                <span>{c}</span>
                <button className="ghost" title="Remove this click and the ones after it" aria-label={`Remove ${c}`} onClick={() => set({ clicks: frame.clicks!.slice(0, i) })}><Icon name="close" /></button>
              </li>
            ))}
          </ol>
          {failed && <span className="cv-error">"{failed}" was not found on the screen.</span>}
        </div>
      )}
      <div className="cv-field">
        <span>Size</span>
        <div className="cv-sizes" role="group" aria-label="Size">
          {SIZES.map((s) => <button key={s.id} className={frame.w === s.w && frame.h === s.h ? 'active' : ''} onClick={() => set({ w: s.w, h: s.h })}>{s.label}</button>)}
        </div>
        <div className="cv-row"><Px label="W" value={frame.w} set={(w) => set({ w })} /><Px label="H" value={frame.h} set={(h) => set({ h })} /></div>
      </div>
      <label>Figma link
        <div className="cv-row">
          <input value={figma} placeholder="https://www.figma.com/design/..." onChange={(e) => setFigma(e.target.value)}
            onBlur={() => { if (figma === '') set({ figma: undefined }); else if (isFigmaLink(figma)) set({ figma }); }} />
          {frame.figma && <a className="cv-icon-link" href={frame.figma} target="_blank" rel="noreferrer" title="Open in Figma" aria-label="Open in Figma"><Icon name="link-external" /></a>}
        </div>
        {badLink && <span className="cv-error">A link to figma.com</span>}
      </label>
      <div className="cv-actions">
        <button onClick={act.focus}>Zoom to frame</button>
        <button onClick={act.reload}>Reload</button>
        <button onClick={act.duplicate}>Duplicate</button>
        <button onClick={act.review} title="Ask Claude for a design system and visual craft review of this screen">Review</button>
        {frame.n !== undefined && <button onClick={() => act.park(!frame.parked)}>{frame.parked ? 'Back into the flow' : 'Park as tried option'}</button>}
      </div>
      <button className="danger" onClick={act.remove}>Delete frame</button>
    </div>
  );
}
