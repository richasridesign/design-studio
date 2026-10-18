import { useEffect, useState } from 'react';
import { getJson, send, useStore } from '../store';
import { AREAS, AREA_NAMES, PRESET_INFO, SHOWN_PRESETS, fixRoundsFor, roundCost, tickedAreas, type Area, type Settings, type ShownPreset } from '../../../shared/design';
import { shownPreset } from './reviewRuns';

/** What one review costs and how many fix rounds follow, in one plain line. */
export function costLine(preset: ShownPreset, areas: Area[], fixRounds: number) {
  if (preset === 'focused' && !areas.length) return 'Tick at least one area for a Focused review.';
  const rounds = fixRoundsFor(preset, fixRounds);
  const who = preset === 'quick' ? (areas.length ? 'One reviewer covers the ticked areas' : 'Nothing ticked, so one reviewer covers all five areas') : preset === 'focused' ? `${areas.length} ${areas.length === 1 ? 'reviewer' : 'reviewers'}, one per area` : 'Five reviewers, one per area';
  return `${who}. Cost per review: ${roundCost(preset, areas)}. Fix rounds: ${rounds === 1 ? '1' : `up to ${rounds}`}.`;
}

/** Review depth for this chat. */
export function DepthSeg() {
  const preset = useStore((s) => shownPreset(s.session.flow.preset));
  return (
    <div className="seg" role="radiogroup" aria-label="Review depth">
      {SHOWN_PRESETS.map((p) => (
        <button key={p} role="radio" aria-checked={preset === p} className={preset === p ? 'on' : ''} title={PRESET_INFO[p].detail} onClick={() => send({ type: 'set_flow', patch: { preset: p } })}>{PRESET_INFO[p].label}</button>
      ))}
    </div>
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
  const [fixRounds, setFixRounds] = useState(3);
  useEffect(() => { getJson<Settings>('/api/settings').then((s) => setFixRounds(s.fixRounds ?? 3), () => {}); }, []);

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
      <p className="rs-cost">{costLine(preset, areas, fixRounds)}</p>
    </div>
  );
}
