import { SIZES, type Frame, type Manifest } from '../../../../shared/canvas';

export function FramePanel({ frame, manifest, setFrame, remove }: { frame: Frame; manifest: Manifest | null; setFrame: (id: string, p: Partial<Frame>) => void; remove: (id: string) => void }) {
  return (
    <div className="cv-panel">
      <h2>Frame</h2>
      <label>Name<input value={frame.name} onChange={(e) => setFrame(frame.id, { name: e.target.value })} /></label>
      <label>Screen
        <select value={frame.route} onChange={(e) => setFrame(frame.id, { route: e.target.value, name: manifest?.screens.find((s) => s.route === e.target.value)?.name ?? frame.name })}>
          {(manifest?.screens ?? []).map((s) => <option key={s.route} value={s.route}>{s.name} ({s.route})</option>)}
          {!manifest?.screens.some((s) => s.route === frame.route) && <option value={frame.route}>{frame.route}</option>}
        </select>
      </label>
      <label>State
        <select value={frame.scenario} onChange={(e) => setFrame(frame.id, { scenario: e.target.value })}>
          {(manifest?.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="cv-field">
        <span>Size</span>
        <div className="cv-sizes" role="group" aria-label="Size">
          {SIZES.map((s) => <button key={s.id} className={frame.w === s.w && frame.h === s.h ? 'active' : ''} onClick={() => setFrame(frame.id, { w: s.w, h: s.h })}>{s.label}</button>)}
        </div>
        <span className="cv-muted">{frame.w} × {frame.h}</span>
      </div>
      <button className="danger" onClick={() => remove(frame.id)}>Delete frame</button>
    </div>
  );
}
