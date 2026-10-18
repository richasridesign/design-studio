// Decision log: what was chosen, what it was chosen over, and why.
// Built from the sketch picks (sketch.json) and the stage approvals with a note (stages.json).

import type { SketchDoc } from './design.js';
import { STAGE_IDS, STAGE_INFO, type StageApprovals, type StageId } from './stages.js';

export type LogRow = {
  id: string;
  kind: 'pick' | 'stage';
  /** Screen name for a pick, "Stage" for an approval. */
  title: string;
  /** "Chose Classic list" or "Approved Decide". */
  choice: string;
  over: string[];
  why: string;
  by: 'designer' | 'claude';
  /** Claude picks made before this log existed have no time. */
  at?: number;
  screen?: string;
  direction?: string;
};

export function decisionLog(sketch: SketchDoc | null, approvals: StageApprovals): LogRow[] {
  const picks: LogRow[] = (sketch?.screens ?? []).flatMap((s) => {
    const d = s.directions.find((x) => x.id === s.chosen);
    if (!d) return [];
    const claude = s.chosenBy !== 'designer';
    return [{
      id: `pick:${s.id}`,
      kind: 'pick',
      title: s.name,
      choice: `Chose ${d.name}`,
      over: s.rejected ?? s.directions.filter((x) => x.id !== d.id).map((x) => x.name),
      why: (claude ? s.reason || d.rationale : s.reason) ?? '',
      by: claude ? 'claude' : 'designer',
      at: s.at,
      screen: s.id,
      direction: d.id,
    }];
  });
  const stages: LogRow[] = STAGE_IDS.flatMap((id: StageId) => {
    const a = approvals[id];
    if (!a?.note) return [];
    return [{ id: `stage:${id}`, kind: 'stage', title: 'Stage', choice: `Approved ${STAGE_INFO[id].name}`, over: [], why: a.note, by: 'designer', at: a.at }];
  });
  // Newest first. Rows without a time come last, in screen order.
  return [...picks, ...stages].map((r, i) => ({ r, i })).sort((a, b) => (b.r.at ?? -1) - (a.r.at ?? -1) || a.i - b.i).map(({ r }) => r);
}

/** "you" in the app, "the designer" in the handoff report. */
export const whoLabel = (r: LogRow, designer = 'you') => `${r.kind === 'stage' ? 'Approved' : 'Picked'} by ${r.by === 'claude' ? 'Claude' : designer}`;
