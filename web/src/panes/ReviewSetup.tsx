import { send, useStore } from '../store';
import { AREAS, AREA_NAMES, PRESET_INFO, SHOWN_PRESETS, roundCost, tickedAreas, type Area, type ShownPreset } from '../../../shared/design';
import { shownPreset } from './reviewRuns';

/** Who reviews and what one review costs, in one plain line. */
export function costLine(preset: ShownPreset, areas: Area[]) {
  const who = preset === 'quick' || !areas.length ? (areas.length ? 'One reviewer covers the ticked areas' : 'Nothing ticked, so one reviewer covers all five areas') : preset === 'focused' ? `${areas.length} ${areas.length === 1 ? 'reviewer' : 'reviewers'}, one per area` : 'Five reviewers, one per area';
  return `${who}. Cost per review: ${roundCost(preset, areas)}.`;
}

/**
 * Review depth for this chat's next review. The one place to change it for a chat: the message box's mode menu shows it
 * with a link here, and Settings sets the default for new chats. Labelled "Next review" so it never reads as the depth of
 * a run listed below.
 */
export function DepthSeg() {
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  return (
    <div className="rs-depth">
      <span id="rs-depth-l">Next review:</span>
      <div className="seg" role="radiogroup" aria-labelledby="rs-depth-l">
        {SHOWN_PRESETS.map((p) => (
          <button key={p} role="radio" aria-checked={preset === p} className={preset === p ? 'on' : ''} title={PRESET_INFO[p].detail} onClick={() => send({ type: 'set_flow', patch: { preset: p } })}>{PRESET_INFO[p].label}</button>
        ))}
      </div>
    </div>
  );
}

/** Settings sends this after each save. The dev tools switch and the Review tab's cost line read the settings again. */
export const SETTINGS_CHANGED = 'designstudio:settings';

export const openReviewTab = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:review' } }));

/** The chat's review depth as a line with a link to the Review tab, where it is changed. For the message box's mode menu. */
export function DepthLink() {
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  return (
    <span className="rs-depth-link">
      Review depth: {PRESET_INFO[preset].label} <button type="button" className="link" onClick={openReviewTab}>Change on the Review tab</button>
    </span>
  );
}

/**
 * The areas this chat's reviews cover, and what a review costs. Full always covers all five areas,
 * so the ticks only show for Quick and Focused.
 */
export function ReviewAreas() {
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  const saved = useStore((s) => s.session.flow.areas);
  const areas = tickedAreas(saved);
  const toggle = (a: Area) => send({ type: 'set_flow', patch: { areas: areas.includes(a) ? areas.filter((x) => x !== a) : AREAS.filter((x) => x === a || areas.includes(x)) } });

  return (
    <div className="review-areas">
      {preset === 'full'
        ? <p className="rs-all">Areas: all five.</p>
        : (
          <fieldset className="rs-areas">
            <legend>Areas:</legend>
            {AREAS.map((a) => (
              <label key={a} className="rs-area">
                <input type="checkbox" checked={areas.includes(a)} onChange={() => toggle(a)} />
                <span>{AREA_NAMES[a]}</span>
              </label>
            ))}
          </fieldset>
        )}
      <p className="rs-cost">{costLine(preset, areas)}</p>
    </div>
  );
}
