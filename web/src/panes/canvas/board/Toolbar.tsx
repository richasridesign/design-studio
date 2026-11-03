import { Icon } from '../../../Icon';

// The floating tools under the board: modes, board actions, the Changes panel and zoom.

export type Mode = 'select' | 'hand' | 'interact';

type Props = {
  mode: Mode; setMode: (m: Mode) => void; zoom: number;
  canAdd: boolean; addFrame: () => void; fit: () => void; tidy: (() => void) | null;
  rec: boolean | null; toggleRec: () => void; states: boolean; toggleStates: () => void;
  changes: number; showChanges: boolean; toggleChanges: () => void;
  zoomBy: (f: number) => void; zoomTo: (z: number) => void;
};

const MODES = [['select', 'select', 'Select an element (V)'], ['hand', 'hand', 'Move around (H)'], ['interact', 'interact', 'Use the app (I)']] as const;

export function Toolbar(p: Props) {
  return (
    <div className="cv-tools" role="toolbar" aria-label="Canvas tools">
      {MODES.map(([m, icon, tip]) => (
        <button key={m} className={p.mode === m ? 'active' : ''} aria-pressed={p.mode === m} title={tip} aria-label={tip} onClick={() => p.setMode(m)}><Icon name={icon} /></button>
      ))}
      <span className="cv-sep" />
      <button title="Add a frame" aria-label="Add a frame" onClick={p.addFrame} disabled={!p.canAdd}><Icon name="add" /></button>
      <button title="Fit the board (Shift+1)" aria-label="Fit the board" onClick={p.fit}><Icon name="screen-full" /></button>
      {p.tidy && <button title="Tidy up (Ctrl+Alt+T)" aria-label="Tidy up" onClick={p.tidy}><Icon name="tidy" /></button>}
      {p.rec !== null && <button className={p.rec ? 'active cv-rec' : 'cv-rec'} aria-pressed={p.rec} title="Record the flow by clicking through the app (R)" aria-label="Record the flow" onClick={p.toggleRec}><Icon name="record" /></button>}
      <button className={p.states ? 'active' : ''} aria-pressed={p.states} title="All states of the selected screen (S)" aria-label="All states of the selected screen" onClick={p.toggleStates}><Icon name="layers" /></button>
      <span className="cv-sep" />
      <button className={p.showChanges ? 'active cv-changes-btn' : 'cv-changes-btn'} aria-pressed={p.showChanges} title="Changes to the app's code" onClick={p.toggleChanges}>
        <Icon name="git-commit" />{p.changes ? <span className="cv-count">{p.changes}</span> : null}
      </button>
      <span className="cv-sep" />
      <button title="Zoom out (-)" aria-label="Zoom out" onClick={() => p.zoomBy(0.8)}><Icon name="zoom-out" /></button>
      <button className="cv-zoom" title="Zoom to 100% (Shift+0)" aria-label={`Zoom ${Math.round(p.zoom * 100)}%, set to 100%`} onClick={() => p.zoomTo(1)}>{Math.round(p.zoom * 100)}%</button>
      <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => p.zoomBy(1.25)}><Icon name="zoom-in" /></button>
    </div>
  );
}
